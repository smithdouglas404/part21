import { allHandlersFinished, condition, continueAsNew, defineQuery, defineSignal, defineUpdate, patched, proxyActivities, setHandler, sleep, workflowInfo } from "@temporalio/workflow";
import type { CaseState, CommittedCaseEvent, DeadlineActivities, DeadlineNotice, EventApplication, WorkflowSeed } from "./contracts";
import { APPLY_COMMITTED_CASE_EVENT_UPDATE, COMMITTED_CASE_EVENT_SIGNAL, DEADLINE_STATE_QUERY } from "./names";

export const committedCaseEventSignal = defineSignal<[CommittedCaseEvent]>(COMMITTED_CASE_EVENT_SIGNAL);
export const applyCommittedCaseEventUpdate = defineUpdate<EventApplication, [CommittedCaseEvent]>(APPLY_COMMITTED_CASE_EVENT_UPDATE);
export const deadlineStateQuery = defineQuery<{ state: CaseState; blocked: string[]; pendingApplications: number; pendingNotices: number }>(DEADLINE_STATE_QUERY);

/** No I/O, live clock/calendar lookup, provider calls, or legal-duration constants in Workflow code. */
export async function Part21CaseWorkflow(seed: WorkflowSeed): Promise<CaseState> {
  patched("part21-independent-deadlines-v1");
  let state = seed.state;
  const activities = proxyActivities<DeadlineActivities>({ startToCloseTimeout: "30 seconds", scheduleToCloseTimeout: "5 minutes", retry: { initialInterval: "1 second", maximumInterval: "30 seconds" } });
  const queue: CommittedCaseEvent[] = [];
  const notices: DeadlineNotice[] = [];
  const recordedNotices = new Set(seed.notices ?? []);
  const receipts = new Map((seed.receipts ?? []).map(r => [r.eventId, r]));
  const blocked = new Set<string>();
  let applying = false; let deliveringNotices = false; let stop = false; let change = 0;
  let closeAcknowledged = false;

  function validate(message: CommittedCaseEvent): void {
    if (!message || message.auditId !== state.auditId || message.caseId !== state.caseId || message.state?.auditId !== state.auditId || message.state?.caseId !== state.caseId) throw new Error("Committed message audit/case scope mismatch");
    if (!message.eventId || !Number.isSafeInteger(message.expectedVersion) || message.expectedVersion < 0 || message.version !== message.expectedVersion + 1 || message.state.version !== message.version) throw new Error("Invalid committed event/revision envelope");
  }
  function enqueue(message: CommittedCaseEvent): void {
    try { validate(message); }
    catch (error) { blocked.add(String(error)); change++; return; }
    if (!receipts.has(message.eventId) && !queue.some(m => m.eventId === message.eventId)) { queue.push(message); change++; }
  }
  setHandler(committedCaseEventSignal, enqueue);
  setHandler(applyCommittedCaseEventUpdate, async message => {
    enqueue(message);
    await condition(() => receipts.has(message.eventId));
    if (state.closed && message.version === state.version) { closeAcknowledged = true; change++; }
    return receipts.get(message.eventId)!;
  }, { validator: validate });
  setHandler(deadlineStateQuery, () => ({ state, blocked: [...blocked], pendingApplications: queue.length + Number(applying), pendingNotices: notices.length + Number(deliveringNotices) }));

  // Business application runs separately from deadline supervision; slow/failing Activities never stop timers.
  async function applyEvents(): Promise<void> {
    while (!stop) {
      await condition(() => stop || queue.length > 0);
      if (stop) break;
      queue.sort((a, b) => a.expectedVersion - b.expectedVersion);
      const message = queue.shift()!; applying = true;
      try {
        const saved = await activities.loadCommittedDeadlineEvent(message);
        let result: EventApplication;
        if (saved.version <= state.version) result = { eventId: saved.eventId, version: saved.version, status: "duplicate" };
        else if (saved.expectedVersion !== state.version) {
          // Missing earlier committed delivery must be retried, not overwrite state or invent a predecessor.
          queue.push(message); blocked.add(`Waiting for case revision ${state.version + 1}`);
          await sleep("5 seconds"); continue;
        } else {
          state = saved.state; change++;
          result = { eventId: saved.eventId, version: saved.version, status: "applied" };
          blocked.delete(`Waiting for case revision ${saved.version}`);
        }
        await activities.recordDeadlineApplication(saved, result);
        receipts.set(saved.eventId, result);
        // Persistent event/version deduplication remains in MySQL across runs; bounded run-local receipts.
        if (receipts.size > 256) receipts.delete(receipts.keys().next().value!);
        blocked.delete(`Application activity unavailable: ${message.eventId}`);
      } catch {
        blocked.add(`Application activity unavailable: ${message.eventId}`);
        queue.push(message); await sleep("5 seconds");
      } finally { applying = false; change++; }
    }
  }
  async function deliverNotices(): Promise<void> {
    while (!stop) {
      await condition(() => stop || notices.length > 0);
      if (stop) break;
      const notice = notices.shift()!; deliveringNotices = true;
      try { await activities.recordDeadlineNotice(notice); blocked.delete("Deadline notice activity unavailable"); }
      catch { blocked.add("Deadline notice activity unavailable"); notices.push(notice); await sleep("5 seconds"); }
      finally { deliveringNotices = false; change++; }
    }
  }
  const applyingTask = applyEvents(); const noticeTask = deliverNotices();
  while (true) {
    const now = Date.now(); // Temporal's deterministic replay clock, never wall-clock I/O.
    let nextWake = Infinity;
    for (const deadline of state.deadlines) {
      if (deadline.status !== "pending") continue;
      const due = Date.parse(deadline.dueAt);
      const boundaries = [
        ...state.policy.reminderLeadMilliseconds.map(lead => ({ at: due - lead, kind: "reminder" as const, lead })),
        { at: due, kind: "overdue" as const, lead: undefined },
      ];
      for (const boundary of boundaries) {
        const key = JSON.stringify([state.auditId, state.caseId, deadline.branch, deadline.dueAt, boundary.kind, boundary.lead ?? null]);
        if (recordedNotices.has(key)) continue;
        if (now >= boundary.at) {
          recordedNotices.add(key);
          notices.push({ auditId: state.auditId, caseId: state.caseId, branch: deadline.branch, dueAt: deadline.dueAt, observedAt: new Date(now).toISOString(), kind: boundary.kind, leadMilliseconds: boundary.lead, version: state.version, policyId: state.policy.id, policyVersion: state.policy.version });
          change++;
        } else nextWake = Math.min(nextWake, boundary.at);
      }
    }
    const idle = () => queue.length === 0 && !applying && notices.length === 0 && !deliveringNotices && allHandlersFinished();
    if (state.closed && closeAcknowledged && idle()) {
      stop = true; await Promise.all([applyingTask, noticeTask]); return state;
    }
    if (workflowInfo().continueAsNewSuggested && idle()) {
      stop = true; await Promise.all([applyingTask, noticeTask]);
      // Retain current due dates, original triggers and deduplication markers, not recovery-time clocks.
      await continueAsNew<typeof Part21CaseWorkflow>({ state, receipts: [...receipts.values()], notices: [...recordedNotices] });
    }
    const observedChange = change;
    if (nextWake < Infinity) await condition(() => change !== observedChange, Math.max(1, nextWake - Date.now()));
    else await condition(() => change !== observedChange);
  }
}
