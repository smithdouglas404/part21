import { describe, expect, it } from "vitest";
import { calculateDueAt } from "./temporal/calendar";
import { deadlineStatuses, initialCaseState, reduceCaseEvent } from "./temporal/domain";
import type { CalendarSnapshot, CaseEventData, CaseState, EvidenceRef, PolicySnapshot } from "./temporal/contracts";
const proof: EvidenceRef[] = [{ recordId: "synthetic-proof", version: "test-1", sha256: "a".repeat(64) }];
const approval = { id: "synthetic-policy", version: "test-1", sha256: "b".repeat(64), approvalDecisionId: "synthetic-decision", approvedBy: "synthetic-reviewer", approvedAt: "2026-01-01T00:00:00Z", sourceIds: ["synthetic-source"] };
const calendar: CalendarSnapshot = { ...approval, id: "synthetic-calendar", timezone: "America/New_York", workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-01-01", "2026-12-25"], validFrom: "2020-01-01", validThrough: "2040-12-31", triggerDay: "exclude", cutoff: "same-local-time", ambiguousTime: "earlier", nonexistentTime: "reject" };
function policy(): PolicySnapshot {
  return { ...approval, rules: { evaluation: { amount: 60, unit: "calendar-days", calendar }, supplier: { amount: 5, unit: "working-days", calendar }, officer: { amount: 5, unit: "working-days", calendar }, "nrc-initial": { amount: 2, unit: "calendar-days", calendar }, "nrc-written": { amount: 30, unit: "calendar-days", calendar } }, reminderLeadMilliseconds: [86400000] };
}
function initial(): CaseState { return initialCaseState({ caseId: "synthetic-case", auditId: "synthetic-audit", actor: "synthetic-human", eventId: "synthetic-create", policy: policy(), discovery: { documentedAt: "2026-03-01T15:00:00Z", discoveryDecisionId: "synthetic-discovery", evidence: proof } }); }
function event(state: CaseState, data: CaseEventData): CaseState { return reduceCaseEvent(state, { caseId: state.caseId, auditId: state.auditId, actor: state.actor, eventId: `synthetic-event-${state.version}`, expectedVersion: state.version, occurredAt: "2026-03-15T00:00:00Z", event: data }); }

describe("approved calendar arithmetic", () => {
  it("counts calendar days across spring DST without 48-hour substitution", () => {
    const result = calculateDueAt("2026-03-07T12:00:00-05:00", { amount: 2, unit: "calendar-days", calendar });
    expect(result.dueAt).toBe("2026-03-09T16:00:00.000Z");
    expect(Date.parse(result.dueAt) - Date.parse("2026-03-07T12:00:00-05:00")).toBe(47 * 3600000);
  });
  it("preserves local clock over fall DST", () => {
    expect(calculateDueAt("2026-10-31T12:00:00-04:00", { amount: 2, unit: "calendar-days", calendar }).dueAt).toBe("2026-11-02T17:00:00.000Z");
  });
  it("counts five working days with year boundary/weekends/holiday, not 120 hours", () => {
    expect(calculateDueAt("2025-12-31T10:00:00-05:00", { amount: 5, unit: "working-days", calendar }).dueAt).toBe("2026-01-08T15:00:00.000Z");
  });
  it("uses holiday snapshot and reviewed cutoff", () => {
    expect(calculateDueAt("2026-12-24T10:00:00-05:00", { amount: 1, unit: "working-days", calendar: { ...calendar, cutoff: "17:00:00" } }).dueAt).toBe("2026-12-28T22:00:00.000Z");
  });
  it("supports explicit included trigger date", () => {
    expect(calculateDueAt("2026-03-09T10:00:00-04:00", { amount: 1, unit: "working-days", calendar: { ...calendar, triggerDay: "include" } }).dueAt).toBe("2026-03-09T14:00:00.000Z");
  });
  it("rejects nonexistent local DST due time unless approved next-valid interpretation", () => {
    expect(() => calculateDueAt("2026-03-07T02:30:00-05:00", { amount: 1, unit: "calendar-days", calendar })).toThrow("nonexistent");
    expect(calculateDueAt("2026-03-07T02:30:00-05:00", { amount: 1, unit: "calendar-days", calendar: { ...calendar, nonexistentTime: "next-valid" } }).dueAt).toBe("2026-03-08T07:30:00.000Z");
  });
  it("uses explicit earlier/later fall overlap interpretation", () => {
    const trigger = "2026-10-31T01:30:00-04:00";
    expect(calculateDueAt(trigger, { amount: 1, unit: "calendar-days", calendar }).dueAt).toBe("2026-11-01T05:30:00.000Z");
    expect(calculateDueAt(trigger, { amount: 1, unit: "calendar-days", calendar: { ...calendar, ambiguousTime: "later" } }).dueAt).toBe("2026-11-01T06:30:00.000Z");
  });
  it("fails unknown calendar coverage and missing timezone/approval", () => {
    expect(() => calculateDueAt("2040-12-31T00:00:00Z", { amount: 60, unit: "calendar-days", calendar })).toThrow("does not cover");
    expect(() => calculateDueAt("2026-03-01T00:00:00Z", { amount: 1, unit: "calendar-days", calendar: { ...calendar, timezone: "invalid" } })).toThrow("timezone");
    expect(() => initialCaseState({ caseId: "synthetic", auditId: "synthetic", actor: "synthetic", eventId: "synthetic", policy: { ...policy(), approvalDecisionId: "" }, discovery: initial().discovery })).toThrow("approvalDecisionId");
  });
});
describe("independent branch facts", () => {
  it("starts 2/30-day receipt branches without waiting for evaluation/officer escalation", () => {
    const next = event(initial(), { type: "officer-information-received", receivedAt: "2026-03-02T15:00:00Z", officerId: "synthetic-officer", decisionId: "synthetic-receipt-decision", evidence: proof, disposition: "unknown" });
    expect(next.deadlines.find(d => d.branch === "nrc-initial")?.dueAt).toBe("2026-03-04T15:00:00.000Z");
    expect(next.deadlines.find(d => d.branch === "nrc-written")?.dueAt).toBe("2026-04-01T14:00:00.000Z");
    expect(next.evaluationCompletedAt).toBeUndefined();
    expect(deadlineStatuses(next, "2026-03-10T00:00:00Z").find(d => d.branch === "nrc-initial")).toMatchObject({ overdue: true, unknown: true });
  });
  it("never uses discovery as a missing officer receipt fallback", () => {
    const state = initial();
    expect(state.deadlines.some(d => d.branch.startsWith("nrc"))).toBe(false);
    expect(() => event(state, { type: "transmission-recorded", transmission: { branch: "nrc-initial", transmittedAt: "2026-03-03T00:00:00Z", method: "test-human-phone", transmittingActor: state.actor, approvedDecisionId: "synthetic-approval", artifact: proof[0], verification: proof, recipients: ["synthetic-nrc-recipient"] } })).toThrow("Missing qualifying trigger");
  });
  it("reminders and human/LLM holds preserve every original deadline", () => {
    const state = initial(); const next = event(event(event(state, { type: "reminder", reason: "synthetic-reminder" }), { type: "human-hold", reason: "synthetic-human-review" }), { type: "llm-hold", reason: "synthetic-provider-unavailable" });
    expect(next.deadlines).toEqual(state.deadlines); expect(next.holds).toHaveLength(2);
    expect(deadlineStatuses(next, "2026-06-01T00:00:00Z")[0].overdue).toBe(true);
  });
  it("preserves same discovery due date for required interim; expected completion is not an extension", () => {
    const state = initial(); const next = event(state, { type: "interim-required", expectedCompletionAt: "2026-08-01T00:00:00Z", decisionId: "synthetic-interim", evidence: proof });
    expect(next.deadlines.find(d => d.branch === "interim")?.dueAt).toBe(state.deadlines[0].dueAt);
    expect(next.deadlines.find(d => d.branch === "evaluation")?.dueAt).toBe(state.deadlines[0].dueAt);
    expect(next.deadlines.find(d => d.branch === "interim-expected-completion")?.dueAt).toBe("2026-08-01T00:00:00Z");
  });
  it("resolves interim as not applicable only when qualifying evaluation completes before the outer date", () => {
    const state = initial();
    const before = event(state, { type: "evaluation-completed", completedAt: "2026-04-01T15:00:00Z", qualifies: true, decisionId: "synthetic-evaluation", evidence: proof });
    expect(before.deadlines.find(d => d.branch === "interim")?.status).toBe("not-applicable");
    const late = event(state, { type: "evaluation-completed", completedAt: "2026-05-15T15:00:00Z", qualifies: true, decisionId: "synthetic-late-evaluation", evidence: proof });
    expect(late.deadlines.find(d => d.branch === "interim")?.status).toBe("pending");
    expect(late.deadlines.find(d => d.branch === "evaluation")?.missedAt).toBe(late.deadlines.find(d => d.branch === "evaluation")?.dueAt);
    expect(() => event(late, { type: "interim-required", expectedCompletionAt: "2026-07-01T00:00:00Z", decisionId: "synthetic-too-late", evidence: proof })).toThrow("after evaluation completion");
  });
  it("five-working-day officer and supplier branches use different trigger facts", () => {
    let state = event(initial(), { type: "evaluation-completed", completedAt: "2026-03-06T15:00:00Z", qualifies: true, decisionId: "synthetic-evaluation", evidence: proof });
    state = event(state, { type: "supplier-incapable", determinedAt: "2026-03-09T14:00:00Z", decisionId: "synthetic-incapable", recipients: ["synthetic-purchaser"], evidence: proof });
    expect(state.deadlines.find(d => d.branch === "officer")?.dueAt).toBe("2026-03-13T14:00:00.000Z");
    expect(state.deadlines.find(d => d.branch === "supplier")?.dueAt).toBe("2026-03-16T14:00:00.000Z");
  });
  it("requires actual receipt/verification evidence and keeps written notice independent of initial", () => {
    const state = event(initial(), { type: "officer-information-received", receivedAt: "2026-03-02T15:00:00Z", officerId: "synthetic-officer", decisionId: "synthetic-receipt", evidence: proof, disposition: "required" });
    const transmission = { branch: "nrc-initial" as const, transmittedAt: "2026-03-03T15:00:00Z", method: "test-human-phone", transmittingActor: state.actor, approvedDecisionId: "synthetic-approval", artifact: proof[0], verification: proof, recipients: ["synthetic-nrc"] };
    expect(() => event(state, { type: "transmission-recorded", transmission: { ...transmission, verification: [] } })).toThrow("evidence");
    const next = event(state, { type: "transmission-recorded", transmission });
    expect(next.deadlines.find(d => d.branch === "nrc-initial")?.status).toBe("satisfied");
    expect(next.deadlines.find(d => d.branch === "nrc-written")).toEqual(state.deadlines.find(d => d.branch === "nrc-written"));
  });
  it("rejects empty recipient lists and unversioned evidence", () => {
    const state = initial();
    expect(() => event(state, { type: "supplier-incapable", determinedAt: "2026-03-02T15:00:00Z", decisionId: "synthetic-capability", recipients: [], evidence: proof })).toThrow("purchasers/licensees");
    expect(() => event(state, { type: "evaluation-completed", completedAt: "2026-04-01T15:00:00Z", qualifies: true, decisionId: "synthetic-evaluation", evidence: [{ recordId: "synthetic-proof", version: "", sha256: "a".repeat(64) }] })).toThrow("evidence version");
  });
  it("requires all supplier recipients and retains transmission evidence", () => {
    let state = event(initial(), { type: "supplier-incapable", determinedAt: "2026-03-02T15:00:00Z", decisionId: "synthetic-capability", recipients: ["synthetic-p1", "synthetic-p2"], evidence: proof });
    const tx = { branch: "supplier" as const, transmittedAt: "2026-03-03T15:00:00Z", method: "test-human-letter", transmittingActor: state.actor, approvedDecisionId: "synthetic-approval", artifact: proof[0], verification: proof, recipients: ["synthetic-p1"] };
    state = event(state, { type: "transmission-recorded", transmission: tx }); expect(state.deadlines.find(d => d.branch === "supplier")?.status).toBe("pending");
    state = event(state, { type: "transmission-recorded", transmission: { ...tx, recipients: ["synthetic-p2"] } }); expect(state.deadlines.find(d => d.branch === "supplier")?.status).toBe("satisfied");
  });
  it("backdated discovery and corrected earlier receipt recalculate without silent reset", () => {
    let state = event(initial(), { type: "officer-information-received", receivedAt: "2026-03-06T15:00:00Z", officerId: "synthetic-officer", decisionId: "synthetic-receipt", evidence: proof, disposition: "required" });
    state = event(state, { type: "officer-receipt-corrected", receivedAt: "2026-03-02T15:00:00Z", decisionId: "synthetic-correction", reason: "synthetic-earlier-proof", evidence: proof });
    expect(state.deadlines.find(d => d.branch === "nrc-initial")?.dueAt).toBe("2026-03-04T15:00:00.000Z");
    state = event(state, { type: "discovery-corrected", discovery: { ...state.discovery, documentedAt: "2026-02-01T15:00:00Z" }, decisionId: "synthetic-correction", reason: "synthetic-earlier-discovery" });
    expect(state.deadlines.find(d => d.branch === "evaluation")?.dueAt).toBe("2026-04-02T14:00:00.000Z");
  });
  it("rejects cross-audit, stale version, unsupported event and hold-based closure", () => {
    const state = initial(); const input = { auditId: "wrong-audit", caseId: state.caseId, actor: state.actor, eventId: "synthetic-event", expectedVersion: state.version, occurredAt: "2026-03-02T00:00:00Z", event: { type: "reminder", reason: "synthetic" } as const };
    expect(() => reduceCaseEvent(state, input)).toThrow("requested audit");
    expect(() => reduceCaseEvent(state, { ...input, auditId: state.auditId, expectedVersion: 0 })).toThrow("version conflict");
    expect(() => event(state, { type: "close", decisionId: "synthetic-close", evidence: proof })).toThrow("cannot stop");
  });
});
