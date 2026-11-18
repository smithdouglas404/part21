export const DEADLINE_BRANCHES = ["evaluation", "interim", "supplier", "officer", "nrc-initial", "nrc-written", "interim-expected-completion"] as const;
export type DeadlineBranch = typeof DEADLINE_BRANCHES[number];
export type EvidenceRef = { recordId: string; version: string; sha256: string };
export type ApprovedSnapshot = { id: string; version: string; sha256: string; approvalDecisionId: string; approvedBy: string; approvedAt: string; sourceIds: string[] };
export type CalendarSnapshot = ApprovedSnapshot & {
  timezone: string; workingWeekdays: number[]; holidays: string[]; validFrom: string; validThrough: string;
  triggerDay: "exclude" | "include"; cutoff: "same-local-time" | string; ambiguousTime: "earlier" | "later"; nonexistentTime: "reject" | "next-valid";
};
export type DurationRule = { amount: number; unit: "calendar-days" | "working-days"; calendar: CalendarSnapshot };
export type PolicySnapshot = ApprovedSnapshot & {
  rules: Record<"evaluation" | "supplier" | "officer" | "nrc-initial" | "nrc-written", DurationRule>;
  reminderLeadMilliseconds: number[];
};
export type DiscoveryProof = { documentedAt: string; discoveryDecisionId: string; evidence: EvidenceRef[] };
export type Deadline = {
  branch: DeadlineBranch; triggerAt: string; dueAt: string; localDue: string; explanation: string;
  policyId: string; policyVersion: string; calendarId: string; calendarVersion: string; sourceIds: string[];
  status: "pending" | "satisfied" | "not-applicable"; satisfiedAt?: string; evidence?: EvidenceRef[];
  applicability: "required" | "unknown" | "reviewed-exception"; expectedRecipients?: string[]; missedAt?: string;
};
export type Transmission = { branch: Exclude<DeadlineBranch, "evaluation" | "interim-expected-completion">; transmittedAt: string; method: string; transmittingActor: string; approvedDecisionId: string; artifact: EvidenceRef; verification: EvidenceRef[]; recipients: string[] };
export type CaseState = {
  caseId: string; auditId: string; actor: string; version: number; policy: PolicySnapshot; discovery: DiscoveryProof;
  deadlines: Deadline[]; transmissions: Transmission[]; closed: boolean;
  evaluationCompletedAt?: string; officerReceipt?: { receivedAt: string; officerId: string; evidence: EvidenceRef[] };
  holds: { eventId: string; reason: string; recordedAt: string }[];
};
export type CaseEventData =
  | { type: "evaluation-completed"; completedAt: string; qualifies: boolean; decisionId: string; evidence: EvidenceRef[] }
  | { type: "interim-required"; expectedCompletionAt: string; decisionId: string; evidence: EvidenceRef[] }
  | { type: "supplier-incapable"; determinedAt: string; recipients: string[]; decisionId: string; evidence: EvidenceRef[] }
  | { type: "officer-information-received"; receivedAt: string; officerId: string; decisionId: string; evidence: EvidenceRef[]; disposition: "required" | "unknown" | "prior-written-notification-exception"; exceptionEvidence?: EvidenceRef[] }
  | { type: "discovery-corrected"; discovery: DiscoveryProof; decisionId: string; reason: string }
  | { type: "officer-receipt-corrected"; receivedAt: string; decisionId: string; reason: string; evidence: EvidenceRef[] }
  | { type: "transmission-recorded"; transmission: Transmission }
  | { type: "reminder" | "human-hold" | "llm-hold"; reason: string }
  | { type: "close"; decisionId: string; evidence: EvidenceRef[] };
export type CreatePart21CaseInput = { caseId: string; auditId: string; actor: string; eventId: string; policy: PolicySnapshot; discovery: DiscoveryProof };
export type ApplyPart21CaseEventInput = { caseId: string; auditId: string; actor: string; eventId: string; expectedVersion: number; occurredAt: string; event: CaseEventData };
export type CommittedCaseEvent = { caseId: string; auditId: string; eventId: string; expectedVersion: number; version: number; state: CaseState };
export type EventApplication = { eventId: string; version: number; status: "applied" | "duplicate" | "rejected"; reason?: string };
export type DeadlineNotice = { caseId: string; auditId: string; branch: DeadlineBranch; dueAt: string; kind: "reminder" | "overdue"; leadMilliseconds?: number; observedAt: string; version: number; policyId: string; policyVersion: string };
export type WorkflowSeed = { state: CaseState; receipts?: EventApplication[]; notices?: string[] };
export interface DeadlineActivities {
  loadCommittedDeadlineEvent(message: CommittedCaseEvent): Promise<CommittedCaseEvent>;
  recordDeadlineApplication(message: CommittedCaseEvent, result: EventApplication): Promise<void>;
  recordDeadlineNotice(notice: DeadlineNotice): Promise<void>;
}
