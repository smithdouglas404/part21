import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { getDomainRecordScoped, listDomainRecords, upsertDomainRecord, writeDomainRecord, getDomainRecordEnvelopeScoped } from "./domain-store";
import { appendAssuranceEvent } from "./event-store";
import { assertAuditPermission, requireQualifiedReviewer, AssuranceAccessError, type AssurancePrincipal } from "./access-control";
import { computeDueAt, DEFAULT_WORKING_WEEKDAYS, type DeclaredCalendar } from "./part21-calendar";
import { PART21_BRANCHES, PART21_GATES, PART21_SEPARATION_NOTE, part21Gate, type Part21GateId } from "../shared/part21-process";

export const PART21_CASE_RECORD = "part21_case";
const DECISION_GATES: Part21GateId[] = ["applicability", "discovery", "evaluation", "interim", "reportability", "closure"];
const STRONG_GATES: Part21GateId[] = ["reportability", "closure"];

export type EvidenceRef = { id: string; kind: "evidence" | "attachment" | "document"; note?: string };
export type Part21CaseFacts = {
  caseId: string; auditId: string; title: string; findingId?: string; productId?: string;
  applicability?: { outcome: "in_scope" | "out_of_scope" | "unknown"; basis: string; decidedAt: string; decisionId: string; reviewerPersonId: string; evidence: EvidenceRef[] };
  discovery?: { documentedAt: string; basis: string; decisionId: string; reviewerPersonId: string; evidence: EvidenceRef[] };
  evaluation?: { completedAt: string; outcome: "reportable" | "not_reportable" | "incomplete"; basis: string; decisionId: string; reviewerPersonId: string; evidence: EvidenceRef[] };
  interim?: { issuedAt: string; expectedCompletionAt: string; decisionId: string; evidence: EvidenceRef[] };
  supplier?: { determinedAt: string; notifiedAt?: string; recipients: string[]; evidence: EvidenceRef[] };
  officerReceipt?: { receivedAt: string; officerPersonId: string; decisionId: string; evidence: EvidenceRef[] };
  transmissions: { branch: string; transmittedAt: string; method: string; recipients: string[]; artifact: EvidenceRef; receipt?: EvidenceRef; recordedBy: string }[];
  records?: { retentionBasis: string; recordClass: string; retrievalVerified: boolean; evidence: EvidenceRef[] };
  closure?: { closedAt: string; disposition: string; decisionId: string; reviewerPersonId: string };
  holds: { reason: string; recordedAt: string; recordedBy: string }[];
  createdBy: string; createdAt: string; updatedAt: string;
};
export type ScheduleRow = {
  id: string; label: string; citation: string; citationTitle: string; triggerFact: string;
  triggerAt: string | null; dueAt: string | null; localDue: string | null;
  status: "waiting_on_trigger" | "satisfied" | "open" | "due_soon" | "overdue" | "not_required" | "unknown";
  explanation: string | null; gateId: string; daysRemaining: number | null;
};

function isoInstant(value: unknown, label: string): string {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a timezone-qualified ISO timestamp.`);
  return new Date(value).toISOString();
}
function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}
async function requireEvidence(auditId: string, refs: unknown): Promise<EvidenceRef[]> {
  if (!Array.isArray(refs) || !refs.length) throw new Error("At least one exact evidence reference is required. A gate cannot be closed on narrative alone.");
  const rows: EvidenceRef[] = [];
  for (const raw of refs) {
    const ref = raw as EvidenceRef;
    const id = required(ref?.id, "evidence.id");
    const kind = ref.kind ?? "evidence";
    if (!["evidence", "attachment", "document"].includes(kind)) throw new Error(`Unsupported evidence kind ${String(kind)}.`);
    const recordType = kind === "attachment" ? "kanban_attachment" : kind;
    const record = await getDomainRecordScoped<Record<string, unknown>>(recordType, id, auditId);
    if (!record) throw new Error(`Evidence ${id} does not exist in audit ${auditId}.`);
    rows.push({ id, kind, ...(ref.note ? { note: ref.note } : {}) });
  }
  return rows;
}
let directoryPool: Pool | null = null;
function directoryDb() { if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to read the person directory."); return directoryPool ??= createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 }); }
async function findPerson(personId: string): Promise<Record<string, unknown> | null> {
  const [rows] = await directoryDb().query<any[]>("SELECT payload FROM part21_domain_records WHERE record_type='person' AND record_id=? ORDER BY (audit_id IS NULL OR audit_id='') DESC LIMIT 1", [personId]);
  if (!rows.length) return null;
  const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
  return { ...payload, id: payload.id ?? personId };
}
async function requireReviewerPerson(auditId: string, personId: string, allowSynthetic = true) {
  // The person directory is organization-wide, so it is read outside audit scoping.
  const person = await findPerson(personId);
  if (!person) throw new Error("The named reviewer is not in the database directory.");
  if (person.active === false) throw new Error("The named reviewer is not active.");
  if (person.synthetic === true && !allowSynthetic) throw new Error("A synthetic demonstration persona cannot close a reportability or closure gate; a named, qualified reviewer is required.");
  return person;
}

export function defaultCalendar(overrides: Partial<DeclaredCalendar> = {}): DeclaredCalendar {
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined && value !== null));
  return {
    timezone: "UTC",
    workingWeekdays: [...DEFAULT_WORKING_WEEKDAYS],
    holidays: [],
    triggerDay: "exclude",
    cutoff: "same-local-time",
    ambiguousTime: "earlier",
    nonexistentTime: "reject",
    approvalStatus: "not-approved-for-reliance",
    ...defined,
  };
}

/** Pure projection: no writes, no implied approval. */
export function computePart21Schedule(facts: Part21CaseFacts, calendar: DeclaredCalendar, asOf: string = new Date().toISOString()): ScheduleRow[] {
  const now = Date.parse(asOf);
  const rows: ScheduleRow[] = [];
  for (const branch of PART21_BRANCHES) {
    const triggerAt =
      branch.id === "evaluation" || branch.id === "interim-report" ? facts.discovery?.documentedAt ?? null
      : branch.id === "officer-notification" ? (facts.evaluation?.outcome === "reportable" ? facts.evaluation?.completedAt ?? null : null)
      : branch.id === "supplier-notification" ? facts.supplier?.determinedAt ?? null
      : facts.officerReceipt?.receivedAt ?? null;
    const base = { id: branch.id, label: branch.label, citation: branch.citation, citationTitle: branch.citationTitle, triggerFact: branch.triggerFact, gateId: branch.gateId };
    if (!triggerAt) {
      const conditional = branch.conditional || branch.id === "officer-notification";
      rows.push({ ...base, triggerAt: null, dueAt: null, localDue: null, status: conditional ? "not_required" : "waiting_on_trigger", explanation: conditional ? "No recorded fact makes this branch applicable yet." : `Waiting for: ${branch.triggerFact}.`, daysRemaining: null });
      continue;
    }
    let due: { dueAt: string; localDue: string; explanation: string };
    try { due = computeDueAt(triggerAt, branch.duration, calendar); }
    catch (error) {
      rows.push({ ...base, triggerAt, dueAt: null, localDue: null, status: "unknown", explanation: error instanceof Error ? error.message : "Calendar interpretation unavailable.", daysRemaining: null });
      continue;
    }
    const satisfiedAt =
      branch.id === "evaluation" ? facts.evaluation?.completedAt ?? null
      : branch.id === "interim-report" ? facts.interim?.issuedAt ?? null
      : branch.id === "officer-notification" ? facts.officerReceipt?.receivedAt ?? null
      : branch.id === "supplier-notification" ? facts.supplier?.notifiedAt ?? null
      : facts.transmissions?.find(row => row.branch === branch.id)?.transmittedAt ?? null;
    const dueMs = Date.parse(due.dueAt);
    const daysRemaining = Math.floor((dueMs - now) / 86400000);
    const status: ScheduleRow["status"] = satisfiedAt
      ? "satisfied"
      : now > dueMs ? "overdue" : daysRemaining <= 5 ? "due_soon" : "open";
    rows.push({ ...base, triggerAt, dueAt: due.dueAt, localDue: due.localDue, status, explanation: due.explanation, daysRemaining });
  }
  return rows;
}

export type Part21GateRow = { id: string; label: string; citation: string; question: string; state: "recorded" | "pending"; decidedBy?: string; decidedAt?: string; evidenceIds: string[]; prohibits: string };
export function computeGateStates(facts: Part21CaseFacts): Part21GateRow[] {
  return PART21_GATES.map(gate => {
    const evidence: EvidenceRef[] =
      gate.id === "applicability" ? facts.applicability?.evidence ?? []
      : gate.id === "discovery" ? facts.discovery?.evidence ?? []
      : gate.id === "evaluation" ? facts.evaluation?.evidence ?? []
      : gate.id === "interim" ? facts.interim?.evidence ?? []
      : gate.id === "supplier" ? facts.supplier?.evidence ?? []
      : gate.id === "officer" ? facts.officerReceipt?.evidence ?? []
      : gate.id === "records" ? facts.records?.evidence ?? []
      : gate.id === "transmission" ? facts.transmissions?.flatMap(row => [row.artifact, ...(row.receipt ? [row.receipt] : [])]) ?? []
      : [];
    const decidedAt =
      gate.id === "applicability" ? facts.applicability?.decidedAt
      : gate.id === "discovery" ? facts.discovery?.documentedAt
      : gate.id === "evaluation" ? facts.evaluation?.completedAt
      : gate.id === "interim" ? facts.interim?.issuedAt
      : gate.id === "supplier" ? facts.supplier?.notifiedAt
      : gate.id === "officer" ? facts.officerReceipt?.receivedAt
      : gate.id === "transmission" ? facts.transmissions?.[0]?.transmittedAt
      : gate.id === "records" ? (facts.records?.retrievalVerified ? facts.updatedAt : undefined)
      : gate.id === "closure" ? facts.closure?.closedAt
      : undefined;
    const decidedBy =
      gate.id === "applicability" ? facts.applicability?.reviewerPersonId
      : gate.id === "discovery" ? facts.discovery?.reviewerPersonId
      : gate.id === "evaluation" ? facts.evaluation?.reviewerPersonId
      : gate.id === "officer" ? facts.officerReceipt?.officerPersonId
      : gate.id === "transmission" ? facts.transmissions?.[0]?.recordedBy
      : gate.id === "closure" ? facts.closure?.reviewerPersonId
      : undefined;
    const recorded = gate.id === "records" ? Boolean(facts.records?.retrievalVerified) : Boolean(decidedAt);
    return { id: gate.id, label: gate.label, citation: gate.citation, question: gate.question, state: recorded ? "recorded" : "pending", decidedBy, decidedAt, evidenceIds: evidence.map(ref => ref.id), prohibits: gate.prohibits };
  });
}

export async function listPart21Cases(auditId: string, principal: AssurancePrincipal) {
  assertAuditPermission(principal, auditId, false);
  const rows = await listDomainRecords<Part21CaseFacts>(PART21_CASE_RECORD, auditId);
  const calendar = defaultCalendar();
  const asOf = new Date().toISOString();
  return rows.map(row => {
    const schedule = computePart21Schedule(row, calendar, asOf);
    const gates = computeGateStates(row);
    const active = schedule.filter(branch => branch.triggerAt);
    const overdue = active.filter(branch => branch.status === "overdue" || branch.status === "unknown");
    const dueSoon = active.filter(branch => branch.status === "due_soon");
    const pendingGates = gates.filter(gate => gate.state === "pending");
    const nextDue = active
      .filter(branch => branch.dueAt && branch.status !== "satisfied")
      .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))[0] ?? null;
    const clockStatus = row.closure
      ? "green"
      : overdue.length
        ? "red"
        : active.length === 0
          ? "gray"
          : "amber";
    return {
      caseId: row.caseId,
      auditId: row.auditId,
      title: row.title,
      findingId: row.findingId ?? null,
      closed: Boolean(row.closure),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      clockStatus,
      activeClocks: active.length,
      overdueClocks: overdue.length,
      dueSoonClocks: dueSoon.length,
      pendingGates: pendingGates.length,
      nextDueAt: nextDue?.dueAt ?? null,
      nextDueLabel: nextDue?.label ?? null,
      daysRemaining: nextDue?.daysRemaining ?? null,
      clocks: active.map(branch => ({
        id: branch.id,
        label: branch.label,
        status: branch.status,
        dueAt: branch.dueAt,
        daysRemaining: branch.daysRemaining,
      })),
    };
  });
}

export async function getPart21Case(auditId: string, caseId: string, principal: AssurancePrincipal, calendar?: Partial<DeclaredCalendar>) {
  assertAuditPermission(principal, auditId, false);
  const facts = await getDomainRecordScoped<Part21CaseFacts>(PART21_CASE_RECORD, required(caseId, "caseId"), auditId);
  if (!facts) throw new Error("Part 21 case not found in this audit.");
  const resolved = defaultCalendar(calendar);
  const asOf = new Date().toISOString();
  return {
    source: "mysql-database",
    auditId,
    caseId: facts.caseId,
    title: facts.title,
    findingId: facts.findingId ?? null,
    productId: facts.productId ?? null,
    closed: Boolean(facts.closure),
    facts,
    calendar: resolved,
    asOf,
    branches: computePart21Schedule(facts, resolved, asOf),
    gates: computeGateStates(facts),
    separationNote: PART21_SEPARATION_NOTE,
    humanReviewRequired: true,
    disclaimer: "Dates are computed from the recorded trigger facts under the declared calendar. A calendar marked not-approved-for-reliance is illustrative; it is not a legal determination and does not start or satisfy any regulatory obligation.",
  };
}

export async function createPart21CaseRecord(input: { auditId: string; caseId?: string; title: string; findingId?: string; productId?: string; documentedAt: string; basis: string; reviewerPersonId: string; evidence: EvidenceRef[] }, principal: AssurancePrincipal) {
  const auditId = required(input.auditId, "auditId");
  assertAuditPermission(principal, auditId, true);
  const reviewer = await requireReviewerPerson(auditId, required(input.reviewerPersonId, "reviewerPersonId"));
  const evidence = await requireEvidence(auditId, input.evidence);
  if (input.findingId) {
    const finding = await getDomainRecordScoped<Record<string, unknown>>("finding", input.findingId, auditId);
    if (!finding) throw new Error("The linked finding does not exist in this audit.");
  }
  const caseId = (input.caseId?.trim() || `P21-${crypto.randomUUID()}`).toUpperCase();
  const existing = await getDomainRecordEnvelopeScoped(PART21_CASE_RECORD, caseId, auditId);
  if (existing) throw new Error("A Part 21 case with this identifier already exists. Creating a second case would restart the statutory clock.");
  const now = new Date().toISOString();
  const facts: Part21CaseFacts = {
    caseId, auditId, title: required(input.title, "title"), findingId: input.findingId, productId: input.productId,
    discovery: { documentedAt: isoInstant(input.documentedAt, "documentedAt"), basis: required(input.basis, "basis"), decisionId: `P21D-${crypto.randomUUID()}`, reviewerPersonId: String(reviewer.id ?? input.reviewerPersonId), evidence },
    transmissions: [], holds: [], createdBy: principal.actor, createdAt: now, updatedAt: now,
  };
  await upsertDomainRecord({ recordType: PART21_CASE_RECORD, recordId: caseId, auditId, payload: facts as unknown as Record<string, unknown> });
  await appendAssuranceEvent({ type: "part21_case_opened", actor: principal.actor, auditId, entityId: caseId, payload: { documentedAt: facts.discovery!.documentedAt, reviewerPersonId: facts.discovery!.reviewerPersonId, evidenceIds: evidence.map(ref => ref.id), clockBasis: "discovery fact recorded; audit start does not start the clock" } });
  return { ok: true, caseId, facts };
}

export async function recordPart21Fact(input: { auditId: string; caseId: string; gate: Part21GateId; data: Record<string, unknown>; expectedRevision?: number }, principal: AssurancePrincipal) {
  const auditId = required(input.auditId, "auditId");
  const caseId = required(input.caseId, "caseId");
  assertAuditPermission(principal, auditId, true);
  const gate = part21Gate(input.gate);
  if (!gate) throw new Error(`Unknown Part 21 gate: ${String(input.gate)}`);
  const envelope = await getDomainRecordEnvelopeScoped<Part21CaseFacts>(PART21_CASE_RECORD, caseId, auditId);
  if (!envelope) throw new Error("Part 21 case not found in this audit.");
  if (envelope.payload.closure) throw new Error("The case is closed; reopening requires a separate controlled decision.");
  if (DECISION_GATES.includes(gate.id) && input.data.reviewerPersonId) await requireReviewerPerson(auditId, String(input.data.reviewerPersonId), !STRONG_GATES.includes(gate.id));
  if (STRONG_GATES.includes(gate.id)) requireQualifiedReviewer(principal, auditId);
  const facts: Part21CaseFacts = { ...envelope.payload, updatedAt: new Date().toISOString() };
  const data = input.data ?? {};
  switch (gate.id) {
    case "applicability":
      facts.applicability = { outcome: ["in_scope", "out_of_scope", "unknown"].includes(String(data.outcome)) ? data.outcome as any : (() => { throw new Error("outcome must be in_scope, out_of_scope or unknown."); })(), basis: required(data.basis, "basis"), decidedAt: isoInstant(data.decidedAt ?? new Date().toISOString(), "decidedAt"), decisionId: `P21D-${crypto.randomUUID()}`, reviewerPersonId: required(data.reviewerPersonId, "reviewerPersonId"), evidence: await requireEvidence(auditId, data.evidence) };
      break;
    case "evaluation":
      facts.evaluation = { completedAt: isoInstant(data.completedAt, "completedAt"), outcome: ["reportable", "not_reportable", "incomplete"].includes(String(data.outcome)) ? data.outcome as any : (() => { throw new Error("outcome must be reportable, not_reportable or incomplete."); })(), basis: required(data.basis, "basis"), decisionId: `P21D-${crypto.randomUUID()}`, reviewerPersonId: required(data.reviewerPersonId, "reviewerPersonId"), evidence: await requireEvidence(auditId, data.evidence) };
      break;
    case "interim":
      facts.interim = { issuedAt: isoInstant(data.issuedAt, "issuedAt"), expectedCompletionAt: isoInstant(data.expectedCompletionAt, "expectedCompletionAt"), decisionId: `P21D-${crypto.randomUUID()}`, evidence: await requireEvidence(auditId, data.evidence) };
      break;
    case "supplier":
      facts.supplier = { determinedAt: isoInstant(data.determinedAt, "determinedAt"), notifiedAt: data.notifiedAt ? isoInstant(data.notifiedAt, "notifiedAt") : undefined, recipients: Array.isArray(data.recipients) ? data.recipients.map(String) : (() => { throw new Error("recipients are required."); })(), evidence: await requireEvidence(auditId, data.evidence) };
      break;
    case "officer":
      facts.officerReceipt = { receivedAt: isoInstant(data.receivedAt, "receivedAt"), officerPersonId: required(data.officerPersonId, "officerPersonId"), decisionId: `P21D-${crypto.randomUUID()}`, evidence: await requireEvidence(auditId, data.evidence) };
      await requireReviewerPerson(auditId, facts.officerReceipt.officerPersonId, false);
      break;
    case "reportability":
      if (!facts.evaluation) throw new Error("A reportability decision requires a recorded evaluation first.");
      facts.evaluation = { ...facts.evaluation, outcome: data.outcome === "not_reportable" ? "not_reportable" : "reportable", basis: required(data.basis, "basis"), reviewerPersonId: required(data.reviewerPersonId, "reviewerPersonId"), decisionId: `P21D-${crypto.randomUUID()}`, evidence: await requireEvidence(auditId, data.evidence) };
      break;
    case "transmission": {
      const artifact = (await requireEvidence(auditId, [data.artifact]))[0];
      const receipt = data.receipt ? (await requireEvidence(auditId, [data.receipt]))[0] : undefined;
      facts.transmissions = [...(facts.transmissions ?? []), { branch: required(data.branch, "branch"), transmittedAt: isoInstant(data.transmittedAt, "transmittedAt"), method: required(data.method, "method"), recipients: Array.isArray(data.recipients) ? data.recipients.map(String) : [], artifact, receipt, recordedBy: principal.actor }];
      break;
    }
    case "records":
      facts.records = { retentionBasis: required(data.retentionBasis, "retentionBasis"), recordClass: required(data.recordClass, "recordClass"), retrievalVerified: data.retrievalVerified === true, evidence: await requireEvidence(auditId, data.evidence) };
      break;
    case "closure":
      facts.closure = { closedAt: isoInstant(data.closedAt ?? new Date().toISOString(), "closedAt"), disposition: required(data.disposition, "disposition"), decisionId: `P21D-${crypto.randomUUID()}`, reviewerPersonId: required(data.reviewerPersonId, "reviewerPersonId") };
      break;
    case "discovery":
      throw new Error("Discovery is recorded when the case is opened; it cannot be rewritten to restart the clock.");
    default:
      throw new Error(`Gate ${gate.id} is not implemented for fact recording.`);
  }
  const result = await writeDomainRecord({ recordType: PART21_CASE_RECORD, recordId: caseId, auditId, payload: facts as unknown as Record<string, unknown> }, { expectedRevision: input.expectedRevision ?? envelope.revision, actor: principal.actor });
  await appendAssuranceEvent({ type: `part21_gate_${gate.id}_recorded`, actor: principal.actor, auditId, entityId: caseId, payload: { gate: gate.id, citation: gate.citation, decisionId: (facts as any)[gate.id]?.decisionId ?? null, evidenceIds: computeGateStates(facts).find(row => row.id === gate.id)?.evidenceIds ?? [], clockReset: false, graphWrite: "not_performed" } });
  return { ok: true, caseId, gate: gate.id, revision: result.revision, facts, schedule: computePart21Schedule(facts, defaultCalendar()) };
}

export async function part21ProcessReference(calendar?: Partial<DeclaredCalendar>) {
  const resolved = defaultCalendar(calendar);
  return {
    source: "10-cfr-part-21",
    branches: PART21_BRANCHES,
    gates: PART21_GATES,
    calendar: resolved,
    separationNote: PART21_SEPARATION_NOTE,
    rules: [
      "Audit start, a Kanban move, a chat message and an approval click never start or restart a statutory clock.",
      "The 60-day evaluation limit is not a grace period, and an interim report does not grant a fresh 60 days.",
      "Five working days requires a reviewed calendar; it is not 120 hours.",
      "The 30-day written notification runs from the same responsible-officer receipt as the 2-day initial notice.",
      "NRC transmission is a human action with recorded method, artifact and receipt.",
    ],
  };
}

/** Skill contracts that govern each statutory branch. The agent uses these to ask the right question at the right clock. */
export const PART21_BRANCH_SKILLS: Record<string, string[]> = {
  evaluation: ["part21-deviation-screening", "part21-discovery-clock"],
  "interim-report": ["part21-discovery-clock", "part21-notification"],
  "officer-notification": ["part21-substantial-safety-hazard", "part21-notification"],
  "supplier-notification": ["supplier-evaluation-transfer", "part21-notification"],
  "nrc-initial": ["part21-notification"],
  "nrc-written": ["part21-notification"],
};
const AGENT_READ_PRINCIPAL: AssurancePrincipal = { id: "grounded-agent-read", actor: "Grounded agent (read-only)", roleIds: [], isAdmin: false, qualified: false, access: "look_only", auditIds: [], auditWriteIds: [], qualifiedAuditIds: [] };
/**
 * Computes the live Part 21 clock state for an audit so the agent reasons over real branches
 * instead of inventing deadlines. Read-only: it starts no clock and writes nothing.
 */
export async function part21ClockBrief(auditId: string, calendar: Partial<DeclaredCalendar> = {}) {
  if (!auditId.trim()) throw new Error("An explicit auditId is required to compute Part 21 clocks.");
  const principal = { ...AGENT_READ_PRINCIPAL, auditIds: [auditId] };
  const records = await listPart21Cases(auditId, principal);
  const cases = [];
  for (const record of records) {
    const view = await getPart21Case(auditId, String(record.caseId), principal, calendar);
    const pending = view.gates.filter(gate => gate.state !== "recorded");
    cases.push({
      caseId: view.caseId, title: view.title, findingId: view.findingId ?? null, closed: Boolean(view.closed),
      branches: view.branches.map(branch => ({ id: branch.id, label: branch.label, citation: branch.citation, status: branch.status, triggerAt: branch.triggerAt, dueAt: branch.dueAt, daysRemaining: branch.daysRemaining, gateId: branch.gateId, skillIds: PART21_BRANCH_SKILLS[branch.id] ?? [] })),
      nextGate: pending[0] ? { id: pending[0].id, label: pending[0].label, citation: pending[0].citation, question: pending[0].question, prohibits: pending[0].prohibits } : null,
      pendingGateIds: pending.map(gate => gate.id),
      overdueBranches: view.branches.filter(branch => branch.status === "overdue").map(branch => branch.id),
      dueSoonBranches: view.branches.filter(branch => branch.status === "due_soon").map(branch => branch.id),
    });
  }
  return {
    auditId, source: "mysql-database", generatedAt: new Date().toISOString(), calendarApproval: "not-approved-for-reliance",
    cases,
    instruction: cases.length
      ? "State the next open gate, its citation, due date and days remaining from these computed values only. Ask the specific question that closes that gate. Never compute, extend or restart a statutory clock yourself."
      : "No Part 21 case is open in this audit. No clock is running. Do not imply that one is; offer to open a case from a recorded discovery fact.",
  };
}
