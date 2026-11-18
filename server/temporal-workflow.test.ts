import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { initialCaseState, reduceCaseEvent } from "./temporal/domain";
import type { CalendarSnapshot, CaseState, CommittedCaseEvent, DeadlineActivities, DeadlineNotice, EventApplication, PolicySnapshot } from "./temporal/contracts";
// Never imports DB initialization, application server or operational fixture modules.
const evidence = [{ recordId: "synthetic-test-proof", version: "test", sha256: "c".repeat(64) }];
function fixture(timestamp: string): CaseState {
  const approved = { id: "synthetic-test-policy", version: "test", sha256: "d".repeat(64), approvalDecisionId: "synthetic-test-approval", approvedBy: "synthetic-test-reviewer", approvedAt: "2020-01-01T00:00:00Z", sourceIds: ["synthetic-test-source"] };
  const calendar: CalendarSnapshot = { ...approved, id: "synthetic-test-calendar", timezone: "America/New_York", workingWeekdays: [1, 2, 3, 4, 5], holidays: [], validFrom: "1970-01-01", validThrough: "2100-12-31", triggerDay: "exclude", cutoff: "same-local-time", ambiguousTime: "earlier", nonexistentTime: "next-valid" };
  const policy: PolicySnapshot = { ...approved, reminderLeadMilliseconds: [86400000], rules: { evaluation: { amount: 60, unit: "calendar-days", calendar }, supplier: { amount: 5, unit: "working-days", calendar }, officer: { amount: 5, unit: "working-days", calendar }, "nrc-initial": { amount: 2, unit: "calendar-days", calendar }, "nrc-written": { amount: 30, unit: "calendar-days", calendar } } };
  return initialCaseState({ caseId: `synthetic-case-${randomUUID()}`, auditId: "synthetic-test-audit", actor: "synthetic-human", eventId: "synthetic-test-create", policy, discovery: { documentedAt: timestamp, discoveryDecisionId: "synthetic-discovery-proof", evidence } });
}
function envelope(state: CaseState, eventId: string): CommittedCaseEvent { return { caseId: state.caseId, auditId: state.auditId, eventId, expectedVersion: state.version - 1, version: state.version, state }; }
function seed(state: CaseState): CaseState { return { ...state, version: 0, deadlines: [], transmissions: [], holds: [], closed: false }; }

describe("real finite Temporal service, workflow replay and skipped time", () => {
  let env: TestWorkflowEnvironment;
  let bundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
  beforeAll(async () => {
    // Official ephemeral test server only; no DATABASE_URL or production connection is used.
    env = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({ workflowsPath: resolve("server/temporal/workflows.ts") });
  }, 120000);
  afterAll(async () => { await env?.teardown(); });

  it("supervises independent 2/30/60-day branches under human/LLM holds, deduplicates and replays", async () => {
    const now = new Date(await env.currentTimeMs()).toISOString();
    let state = fixture(now);
    const committed = new Map<string, CommittedCaseEvent>();
    const notices: DeadlineNotice[] = []; const applied: EventApplication[] = [];
    const activities: DeadlineActivities = {
      loadCommittedDeadlineEvent: async event => { const saved = committed.get(event.eventId); if (!saved) throw new Error("Missing committed DB event"); return saved; },
      recordDeadlineApplication: async (_event, result) => { if (!applied.some(r => r.eventId === result.eventId)) applied.push(result); },
      recordDeadlineNotice: async notice => { if (!notices.some(n => n.branch === notice.branch && n.kind === notice.kind && n.dueAt === notice.dueAt)) notices.push(notice); },
    };
    const taskQueue = `synthetic-q-${randomUUID()}`;
    const worker = await Worker.create({ connection: env.nativeConnection, namespace: "default", taskQueue, workflowBundle: bundle, activities });
    const handle = await env.client.workflow.start("Part21CaseWorkflow", { taskQueue, workflowId: state.caseId, args: [{ state: seed(state) }] });
    await worker.runUntil(async () => {
      const first = envelope(state, "synthetic-test-create"); committed.set(first.eventId, first);
      const result = await handle.executeUpdate<EventApplication, [CommittedCaseEvent]>("part21.apply-committed-case-event", { args: [first], updateId: first.eventId });
      expect(result.status).toBe("applied");
      // Duplicate delivery with another Temporal Update ID is still a business duplicate.
      await handle.signal("part21.committed-case-event", first);
      const again = await handle.executeUpdate<EventApplication, [CommittedCaseEvent]>("part21.apply-committed-case-event", { args: [first], updateId: "synthetic-transport-retry" });
      expect(again.version).toBe(1); expect(applied.filter(r => r.eventId === first.eventId)).toHaveLength(1);
      state = reduceCaseEvent(state, { auditId: state.auditId, caseId: state.caseId, actor: state.actor, eventId: "synthetic-receipt", expectedVersion: state.version, occurredAt: now, event: { type: "officer-information-received", receivedAt: now, officerId: "synthetic-officer", decisionId: "synthetic-receipt-approval", evidence, disposition: "unknown" } });
      const receipt = envelope(state, "synthetic-receipt"); committed.set(receipt.eventId, receipt);
      await handle.executeUpdate("part21.apply-committed-case-event", { args: [receipt], updateId: receipt.eventId });
      for (const type of ["human-hold", "llm-hold"] as const) {
        const eventId = `synthetic-${type}`;
        state = reduceCaseEvent(state, { auditId: state.auditId, caseId: state.caseId, actor: state.actor, eventId, expectedVersion: state.version, occurredAt: now, event: { type, reason: "synthetic review/provider hold" } });
        const command = envelope(state, eventId); committed.set(eventId, command);
        await handle.executeUpdate("part21.apply-committed-case-event", { args: [command], updateId: eventId });
      }
      await env.sleep("3 days");
      const snapshot = await handle.query<{ state: CaseState }>("part21.deadline-state");
      expect(snapshot.state.version).toBe(4); expect(snapshot.state.evaluationCompletedAt).toBeUndefined();
      expect(snapshot.state.officerReceipt?.receivedAt).toBe(now);
      expect(notices.some(n => n.branch === "nrc-initial" && n.kind === "overdue")).toBe(true);
      expect(notices.some(n => n.branch === "nrc-written" && n.kind === "overdue")).toBe(false);
      await env.sleep("28 days");
      await handle.query("part21.deadline-state");
      expect(notices.some(n => n.branch === "nrc-written" && n.kind === "overdue")).toBe(true);
      expect(notices.some(n => n.branch === "evaluation" && n.kind === "overdue")).toBe(false);
      await env.sleep("30 days");
      await handle.query("part21.deadline-state");
      expect(notices.some(n => n.branch === "evaluation" && n.kind === "overdue")).toBe(true);
      expect(notices.some(n => n.branch === "interim" && n.kind === "overdue")).toBe(true);
      await expect(handle.executeUpdate("part21.apply-committed-case-event", { args: [{ ...receipt, auditId: "synthetic-wrong-audit" }], updateId: "synthetic-cross-audit" })).rejects.toThrow();
      await handle.terminate("finite synthetic test complete");
    });
    const history = await handle.fetchHistory();
    await Worker.runReplayHistory({ workflowBundle: bundle }, history, state.caseId);
  }, 120000);

  it("restarts a worker and catches up backdated officer receipt without replacing original due dates", async () => {
    const now = new Date(await env.currentTimeMs()).toISOString(); let state = fixture(now);
    const committed = new Map<string, CommittedCaseEvent>(); const notices: DeadlineNotice[] = [];
    const activities: DeadlineActivities = { loadCommittedDeadlineEvent: async m => committed.get(m.eventId)!, recordDeadlineApplication: async () => {}, recordDeadlineNotice: async n => { notices.push(n); } };
    const taskQueue = `synthetic-restart-q-${randomUUID()}`;
    const handle = await env.client.workflow.start("Part21CaseWorkflow", { taskQueue, workflowId: state.caseId, args: [{ state: seed(state) }] });
    const first = envelope(state, "synthetic-genesis"); committed.set(first.eventId, first);
    // Non-sticky cache makes the simulated process handoff independent of a dead worker's sticky cache.
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowBundle: bundle, activities, maxCachedWorkflows: 0 });
    await worker.runUntil(async () => { await handle.executeUpdate("part21.apply-committed-case-event", { args: [first], updateId: first.eventId }); });
    await env.sleep("4 days");
    const earlierReceipt = now;
    state = reduceCaseEvent(state, { auditId: state.auditId, caseId: state.caseId, actor: state.actor, eventId: "synthetic-late-intake", expectedVersion: state.version, occurredAt: new Date(await env.currentTimeMs()).toISOString(), event: { type: "officer-information-received", receivedAt: earlierReceipt, officerId: "synthetic-officer", decisionId: "synthetic-late-proof", evidence, disposition: "required" } });
    const receipt = envelope(state, "synthetic-late-intake"); committed.set(receipt.eventId, receipt);
    const originalDue = state.deadlines.find(d => d.branch === "nrc-initial")!.dueAt;
    const restartedWorker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowBundle: bundle, activities, maxCachedWorkflows: 0 });
    await restartedWorker.runUntil(async () => {
      try {
        await env.client.workflow.withDeadline(Date.now() + 15000, () => handle.query("part21.deadline-state"));
        await env.client.workflow.withDeadline(Date.now() + 15000, () => handle.executeUpdate("part21.apply-committed-case-event", { args: [receipt], updateId: receipt.eventId }));
        await env.sleep("1 minute"); await handle.query("part21.deadline-state");
        expect(notices.some(n => n.branch === "nrc-initial" && n.kind === "overdue" && n.dueAt === originalDue)).toBe(true);
        expect(Date.parse(notices.find(n => n.branch === "nrc-initial" && n.kind === "overdue")!.observedAt)).toBeGreaterThan(Date.parse(originalDue));
      } finally { await handle.terminate("finite restart test complete"); }
    });
  }, 120000);
});
