import { buildDeadline, requireInstant, requireText, validatePolicy } from "./calendar";
import type { ApplyPart21CaseEventInput, CaseState, CreatePart21CaseInput, Deadline, EvidenceRef, PolicySnapshot } from "./contracts";

export function validateEvidence(refs: EvidenceRef[]): void {
  if (!refs?.length) throw new Error("Original/versioned evidence is required; missing evidence is unknown");
  refs.forEach(ref => {
    requireText(ref.recordId, "evidence recordId"); requireText(ref.version, "evidence version");
    if (!/^[a-f0-9]{64}$/i.test(ref.sha256)) throw new Error("Evidence sha256 is required");
  });
}
function decision(id: string, refs: EvidenceRef[]): void { requireText(id, "qualified decision ID"); validateEvidence(refs); }
function discovery(input: CreatePart21CaseInput["discovery"]): void {
  requireInstant(input.documentedAt, "original documented discovery"); decision(input.discoveryDecisionId, input.evidence);
}
export function initialCaseState(input: CreatePart21CaseInput): CaseState {
  for (const key of ["caseId", "auditId", "actor", "eventId"] as const) requireText(input[key], key);
  validatePolicy(input.policy); discovery(input.discovery);
  const evaluation = buildDeadline("evaluation", input.discovery.documentedAt, input.policy);
  const interim = { ...buildDeadline("interim", input.discovery.documentedAt, input.policy, "evaluation"), applicability: "unknown" as const };
  return { caseId: input.caseId, auditId: input.auditId, actor: input.actor, version: 1, policy: structuredClone(input.policy), discovery: structuredClone(input.discovery), deadlines: [evaluation, interim], transmissions: [], closed: false, holds: [] };
}
function replace(state: CaseState, deadline: Deadline): void {
  const i = state.deadlines.findIndex(d => d.branch === deadline.branch);
  if (i < 0) state.deadlines.push(deadline); else state.deadlines[i] = deadline;
}
function satisfy(deadline: Deadline, at: string, evidence: EvidenceRef[]): void {
  deadline.status = "satisfied"; deadline.satisfiedAt = at; deadline.evidence = evidence;
  if (Date.parse(at) > Date.parse(deadline.dueAt)) deadline.missedAt = deadline.dueAt;
}
function nrcDeadlines(state: CaseState, at: string, disposition: "required" | "unknown" | "prior-written-notification-exception", evidence?: EvidenceRef[]): void {
  for (const branch of ["nrc-initial", "nrc-written"] as const) {
    const next = buildDeadline(branch, at, state.policy);
    next.applicability = disposition === "prior-written-notification-exception" ? "reviewed-exception" : disposition;
    if (disposition === "prior-written-notification-exception") { next.status = "not-applicable"; next.evidence = evidence; }
    const transmission = state.transmissions.find(t => t.branch === branch);
    if (transmission) satisfy(next, transmission.transmittedAt, [transmission.artifact, ...transmission.verification]);
    replace(state, next);
  }
}
/** Business transitions run inside the authoritative transaction, not in LLM/Workflow code. */
export function reduceCaseEvent(current: CaseState, input: ApplyPart21CaseEventInput): CaseState {
  for (const key of ["caseId", "auditId", "actor", "eventId"] as const) requireText(input[key], key);
  requireInstant(input.occurredAt, "occurredAt");
  if (current.auditId !== input.auditId || current.caseId !== input.caseId) throw new Error("Case does not belong to requested audit");
  if (input.expectedVersion !== current.version) throw new Error(`Case version conflict: expected ${input.expectedVersion}, actual ${current.version}`);
  if (current.closed) throw new Error("Closed case cannot accept new facts without a controlled reopening process");
  const state: CaseState = structuredClone(current); const e = input.event;
  const evaluation = state.deadlines.find(d => d.branch === "evaluation")!;
  const interim = state.deadlines.find(d => d.branch === "interim")!;
  switch (e.type) {
    case "evaluation-completed": {
      requireInstant(e.completedAt, "evaluationCompletedAt"); decision(e.decisionId, e.evidence);
      if (state.evaluationCompletedAt) throw new Error("Evaluation already recorded; use a reviewed correction process");
      if (Date.parse(e.completedAt) < Date.parse(state.discovery.documentedAt)) throw new Error("Evaluation completion cannot precede documented discovery");
      state.evaluationCompletedAt = e.completedAt; satisfy(evaluation, e.completedAt, e.evidence);
      const interimTransmission = state.transmissions.find(t => t.branch === "interim");
      if (interimTransmission) satisfy(interim, interimTransmission.transmittedAt, [interimTransmission.artifact, ...interimTransmission.verification]);
      else if (Date.parse(e.completedAt) <= Date.parse(interim.dueAt)) { interim.status = "not-applicable"; interim.evidence = e.evidence; }
      if (e.qualifies) {
        const officer = buildDeadline("officer", e.completedAt, state.policy);
        if (state.officerReceipt) satisfy(officer, state.officerReceipt.receivedAt, state.officerReceipt.evidence);
        replace(state, officer);
      }
      break;
    }
    case "interim-required": {
      decision(e.decisionId, e.evidence); requireInstant(e.expectedCompletionAt, "expectedCompletionAt");
      if (state.evaluationCompletedAt) throw new Error("Interim requirement cannot be added after evaluation completion");
      if (Date.parse(e.expectedCompletionAt) <= Date.parse(state.discovery.documentedAt)) throw new Error("Expected completion must follow discovery");
      interim.applicability = "required"; if (interim.status === "not-applicable") interim.status = "pending";
      const stated: Deadline = { ...interim, branch: "interim-expected-completion", dueAt: e.expectedCompletionAt, localDue: e.expectedCompletionAt, status: "pending", explanation: "Human-reviewed expected completion stated in interim report; not an automatic extension of discovery deadlines.", evidence: e.evidence };
      delete stated.satisfiedAt; delete stated.missedAt;
      if (state.evaluationCompletedAt) satisfy(stated, state.evaluationCompletedAt, evaluation.evidence!);
      replace(state, stated); break;
    }
    case "supplier-incapable": {
      requireInstant(e.determinedAt, "supplier capability determination"); decision(e.decisionId, e.evidence);
      if (!e.recipients?.length) throw new Error("Affected purchasers/licensees are required");
      e.recipients.forEach(id => requireText(id, "recipient ID"));
      if (state.deadlines.some(d => d.branch === "supplier")) throw new Error("Supplier trigger already recorded; cannot silently restart it");
      replace(state, { ...buildDeadline("supplier", e.determinedAt, state.policy), expectedRecipients: [...new Set(e.recipients)] }); break;
    }
    case "officer-information-received": {
      requireInstant(e.receivedAt, "actual officer information receipt"); requireText(e.officerId, "officer ID"); decision(e.decisionId, e.evidence);
      if (state.officerReceipt) throw new Error("Actual receipt already recorded; use officer-receipt-corrected");
      if (!["required", "unknown", "prior-written-notification-exception"].includes(e.disposition)) throw new Error("Explicit notification applicability is required");
      if (e.disposition === "prior-written-notification-exception") validateEvidence(e.exceptionEvidence!);
      state.officerReceipt = { receivedAt: e.receivedAt, officerId: e.officerId, evidence: e.evidence };
      const officer = state.deadlines.find(d => d.branch === "officer"); if (officer) satisfy(officer, e.receivedAt, e.evidence);
      // Receipt is an independent trigger: never wait for evaluation/officer escalation/LLM holds.
      nrcDeadlines(state, e.receivedAt, e.disposition, e.exceptionEvidence); break;
    }
    case "officer-receipt-corrected": {
      requireInstant(e.receivedAt, "corrected actual receipt"); decision(e.decisionId, e.evidence); requireText(e.reason, "correction reason");
      if (!state.officerReceipt) throw new Error("Missing actual receipt; correction cannot invent a receipt");
      const prior = state.deadlines.find(d => d.branch === "nrc-initial")!;
      state.officerReceipt.receivedAt = e.receivedAt; state.officerReceipt.evidence = e.evidence;
      nrcDeadlines(state, e.receivedAt, prior.applicability === "reviewed-exception" ? "prior-written-notification-exception" : prior.applicability, prior.evidence);
      const officer = state.deadlines.find(d => d.branch === "officer"); if (officer) satisfy(officer, e.receivedAt, e.evidence); break;
    }
    case "discovery-corrected": {
      discovery(e.discovery); requireText(e.reason, "correction reason"); decision(e.decisionId, e.discovery.evidence);
      if (state.evaluationCompletedAt && Date.parse(e.discovery.documentedAt) > Date.parse(state.evaluationCompletedAt)) throw new Error("Corrected discovery cannot follow evaluation completion");
      state.discovery = structuredClone(e.discovery);
      for (const branch of ["evaluation", "interim"] as const) {
        const old = state.deadlines.find(d => d.branch === branch)!;
        const next = { ...old, ...buildDeadline(branch, e.discovery.documentedAt, state.policy, "evaluation"), status: old.status, applicability: old.applicability, evidence: old.evidence, satisfiedAt: old.satisfiedAt, missedAt: old.missedAt };
        if (old.satisfiedAt) satisfy(next, old.satisfiedAt, old.evidence!);
        replace(state, next);
      }
      break;
    }
    case "transmission-recorded": {
      const t = e.transmission;
      requireInstant(t.transmittedAt, "actual transmission time"); requireText(t.method, "transmission method"); requireText(t.transmittingActor, "transmitting human");
      if (t.transmittingActor !== input.actor) throw new Error("Transmission attestation must be made by authenticated transmitting human");
      decision(t.approvedDecisionId, [t.artifact]); validateEvidence(t.verification);
      if (!Array.isArray(t.recipients) || t.recipients.length === 0) throw new Error("Explicit recipient IDs are required");
      t.recipients.forEach(id => requireText(id, "recipient ID"));
      const due = state.deadlines.find(d => d.branch === t.branch);
      if (!due) throw new Error("Missing qualifying trigger/actual officer receipt; drafts cannot satisfy notification obligations");
      if (Date.parse(t.transmittedAt) < Date.parse(due.triggerAt)) throw new Error("Transmission precedes its trigger; prior-notification exception requires a separate qualified decision");
      if (due.status !== "pending") throw new Error("Transmission obligation already satisfied or reviewed not applicable");
      state.transmissions.push(structuredClone(t));
      const all = state.transmissions.filter(v => v.branch === t.branch);
      if (!due.expectedRecipients || due.expectedRecipients.every(id => all.some(v => v.recipients.includes(id)))) satisfy(due, t.transmittedAt, all.flatMap(v => [v.artifact, ...v.verification]));
      break;
    }
    case "human-hold": case "llm-hold": case "reminder":
      requireText(e.reason, "reason");
      if (e.type !== "reminder") state.holds.push({ eventId: input.eventId, reason: e.reason, recordedAt: input.occurredAt });
      break;
    case "close":
      decision(e.decisionId, e.evidence);
      if (state.deadlines.some(d => d.status === "pending")) throw new Error("Human closure cannot stop unresolved deadlines, including unknown applicability");
      state.closed = true; break;
    default: throw new Error("Unknown Part 21 case event");
  }
  const stated = state.deadlines.find(d => d.branch === "interim-expected-completion");
  if (stated && state.evaluationCompletedAt && stated.status === "pending") satisfy(stated, state.evaluationCompletedAt, evaluation.evidence!);
  state.version++; return state;
}
export function deadlineStatuses(state: CaseState, asOf: string) {
  requireInstant(asOf, "asOf");
  return state.deadlines.map(deadline => ({ ...deadline, overdue: deadline.status === "pending" && Date.parse(asOf) >= Date.parse(deadline.dueAt), missed: Boolean(deadline.missedAt) || (deadline.status === "satisfied" && Date.parse(deadline.satisfiedAt!) > Date.parse(deadline.dueAt)), unknown: deadline.applicability === "unknown", asOf }));
}
export function evidenceForEvent(event: ApplyPart21CaseEventInput["event"]): EvidenceRef[] {
  if (event.type === "transmission-recorded") return [event.transmission.artifact, ...event.transmission.verification];
  if (event.type === "discovery-corrected") return event.discovery.evidence;
  return "evidence" in event ? [...event.evidence, ...("exceptionEvidence" in event ? event.exceptionEvidence ?? [] : [])] : [];
}
export function approvedSnapshots(policy: PolicySnapshot) {
  const all = [policy, ...Object.values(policy.rules).map(r => r.calendar)];
  return all.filter((value, index) => all.findIndex(other => other.id === value.id && other.version === value.version && other.sha256 === value.sha256) === index);
}
