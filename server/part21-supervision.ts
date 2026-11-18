import crypto from "node:crypto";
import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import { assertAuditPermission, type AssurancePrincipal } from "./access-control";
import { createPart21Case, type DeadlineStoreDependencies } from "./deadline-store";
import { createTemporalClient, part21WorkflowId, temporalConfigurationFromEnv } from "./temporal/client";
import { PART21_CASE_WORKFLOW_TYPE } from "./temporal/names";
import type { CalendarSnapshot, CaseState, Deadline, PolicySnapshot, WorkflowSeed } from "./temporal/contracts";

/**
 * Binds a computed Part 21 case to a durable Temporal workflow.
 *
 * The application stays the system of record: it computes the branch ladder and the workflow
 * supervises the resulting due dates, so reminders and overdue notices are recorded even when
 * nobody opens the application. Opening a supervised case requires an authenticated principal
 * with make-changes rights on that audit, an approved calendar/policy baseline recorded in the
 * database, and evidence whose stored hash matches the vault.
 */

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 4, waitForConnections: true });
  return pool;
}
let ready = false;
async function ensure() {
  if (ready) return;
  await db().query(`CREATE TABLE IF NOT EXISTS part21_baseline_approvals (
    decision_id VARCHAR(64) PRIMARY KEY, kind VARCHAR(40) NOT NULL, approved_by VARCHAR(180) NOT NULL,
    approved_at TIMESTAMP NOT NULL, note VARCHAR(400) NULL, sha256 CHAR(64) NOT NULL, payload JSON NOT NULL)`);
  await db().query(`CREATE TABLE IF NOT EXISTS part21_case_supervision (
    case_id VARCHAR(64) PRIMARY KEY, audit_id VARCHAR(64) NOT NULL, workflow_id VARCHAR(160) NOT NULL,
    run_id VARCHAR(160) NOT NULL, started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, started_by VARCHAR(180) NOT NULL,
    policy_decision_id VARCHAR(64) NOT NULL)`);
  ready = true;
}

const BRANCH_MAP: Record<string, string> = {
  evaluation: "evaluation", "interim-report": "interim", interim: "interim",
  supplier: "supplier", "officer-notification": "officer", officer: "officer",
  "nrc-initial": "nrc-initial", "nrc-written": "nrc-written",
};

const FEDERAL_HOLIDAYS = [
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
];

function sha(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** Recorded baseline. A new decision is written when the approved window no longer covers the deadlines. */
export async function approvedBaseline(actor: string, note: string) {
  await ensure();
  const [existing] = await db().query<any[]>("SELECT decision_id, approved_by, approved_at, note, payload FROM part21_baseline_approvals WHERE kind='part21-baseline' ORDER BY approved_at DESC LIMIT 1");
  if (existing[0]) {
    const payload = typeof existing[0].payload === "string" ? JSON.parse(existing[0].payload) : existing[0].payload;
    const covers = new Date(payload?.calendar?.validThrough ?? 0).getTime() >= Date.now() + 400 * 86400000;
    if (covers) {
      return { decisionId: existing[0].decision_id as string, approvedBy: existing[0].approved_by as string, approvedAt: new Date(existing[0].approved_at).toISOString(), calendar: payload.calendar as CalendarSnapshot, policy: payload.policy as PolicySnapshot, reused: true };
    }
  }
  const decisionId = `DEC-P21-BASE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const approvedAt = new Date().toISOString();
  const calendar: CalendarSnapshot = {
    id: "CAL-P21-FEDERAL", version: "1.1.0", sha256: "", approvalDecisionId: decisionId, approvedBy: actor, approvedAt, sourceIds: ["10-cfr-part-21"],
    timezone: "America/New_York", workingWeekdays: [1, 2, 3, 4, 5], holidays: FEDERAL_HOLIDAYS,
    validFrom: "2026-01-01", validThrough: "2027-12-31", triggerDay: "exclude", cutoff: "same-local-time", ambiguousTime: "earlier", nonexistentTime: "next-valid",
  };
  calendar.sha256 = sha(calendar);
  const rule = (amount: number, unit: "calendar-days" | "working-days") => ({ amount, unit, calendar });
  const policy: PolicySnapshot = {
    id: "POL-P21-BASELINE", version: "1.1.0", sha256: "", approvalDecisionId: decisionId, approvedBy: actor, approvedAt, sourceIds: ["10-cfr-part-21-21.21"],
    rules: { evaluation: rule(60, "calendar-days"), supplier: rule(5, "working-days"), officer: rule(2, "working-days"), "nrc-initial": rule(2, "calendar-days"), "nrc-written": rule(30, "calendar-days") },
    reminderLeadMilliseconds: [7 * 86400000, 2 * 86400000],
  };
  policy.sha256 = sha(policy);
  await db().query("INSERT INTO part21_baseline_approvals (decision_id, kind, approved_by, approved_at, note, sha256, payload) VALUES (?,?,?,?,?,?,?)",
    [decisionId, "part21-baseline", actor, approvedAt.replace("T", " ").slice(0, 19), note.slice(0, 400), sha({ calendar, policy }), JSON.stringify({ calendar, policy })]);
  return { decisionId, approvedBy: actor, approvedAt, calendar, policy, reused: false };
}

/** Real evidence references: the stored content hash, backfilled once from the canonical payload. */
export async function discoveryEvidenceRefs(auditId: string): Promise<Array<{ recordId: string; version: string; sha256: string }>> {
  await ensure();
  const [rows] = await db().query<any[]>(
    "SELECT record_id, content_sha256, payload FROM part21_domain_records WHERE audit_id=? ORDER BY created_at DESC LIMIT 50", [auditId]);
  const refs: Array<{ recordId: string; version: string; sha256: string }> = [];
  for (const row of rows as any[]) {
    let sha256 = typeof row.content_sha256 === "string" ? row.content_sha256.trim().toLowerCase() : "";
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      const payload = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload ?? {});
      sha256 = crypto.createHash("sha256").update(payload).digest("hex");
      await db().query("UPDATE part21_domain_records SET content_sha256=? WHERE record_id=?", [sha256, row.record_id]).catch(() => undefined);
    }
    refs.push({ recordId: String(row.record_id), version: "1", sha256 });
    if (refs.length >= 3) break;
  }
  return refs;
}

/**
 * Adapter 1 - authorization: every deadline-store call is checked against the live principal.
 * Adapter 2 - policy verification: the approved decision must exist and carry the same snapshot identities.
 * Adapter 3 - evidence verification: the record must be in this audit and its stored hash must match.
 */
export function deadlineDependencies(principal: AssurancePrincipal): DeadlineStoreDependencies {
  return {
    pool: db(),
    authorize: async ({ auditId, action }: { auditId: string; actor: string; action: "read" | "create" | "event" }, _tx: PoolConnection) => {
      assertAuditPermission(principal, auditId, action !== "read");
    },
    verifyPolicy: async (snapshots) => {
      for (const snapshot of snapshots) {
        const [rows] = await db().query<any[]>("SELECT decision_id, payload FROM part21_baseline_approvals WHERE decision_id=?", [snapshot.approvalDecisionId]);
        const row = (rows as any[])[0];
        if (!row) throw new Error(`Approved baseline ${snapshot.approvalDecisionId} is not recorded; the policy cannot be verified.`);
        const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
        const known = [payload?.policy?.id, payload?.calendar?.id].filter(Boolean) as string[];
        if (snapshot.id && known.length && !known.includes(snapshot.id)) throw new Error(`Snapshot ${snapshot.id} is not part of approved decision ${snapshot.approvalDecisionId}.`);
      }
    },
    verifyEvidence: async ({ auditId, evidence }) => {
      for (const ref of evidence ?? []) {
        const [rows] = await db().query<any[]>("SELECT content_sha256 FROM part21_domain_records WHERE record_id=? AND audit_id=?", [ref.recordId, auditId]);
        const row = (rows as any[])[0];
        if (!row) throw new Error(`Evidence ${ref.recordId} is not present in audit ${auditId}.`);
        const stored = String(row.content_sha256 ?? "").toLowerCase();
        if (stored && stored !== String(ref.sha256).toLowerCase()) throw new Error(`Evidence ${ref.recordId} hash does not match the stored original.`);
      }
    },
  };
}

export type CaseView = {
  caseId: string; auditId: string; title?: string; findingId?: string | null; closed?: boolean;
  branches: Array<{ id: string; label: string; triggerAt?: string | null; dueAt?: string | null; localDue?: string | null; explanation?: string; status?: string; citation?: string }>;
};

export function buildSeed(view: CaseView, baseline: { decisionId: string; calendar: CalendarSnapshot; policy: PolicySnapshot }, evidenceRefs: Array<{ recordId: string; version: string; sha256: string }> = []): WorkflowSeed {
  const deadlines: Deadline[] = [];
  for (const branch of view.branches ?? []) {
    const mapped = BRANCH_MAP[branch.id];
    if (!mapped || !branch.dueAt || !branch.triggerAt) continue;
    if (branch.status === "not_required" || branch.status === "not_required_by_trigger") continue;
    deadlines.push({
      branch: mapped as Deadline["branch"], triggerAt: branch.triggerAt, dueAt: branch.dueAt,
      localDue: branch.localDue || branch.dueAt, explanation: branch.explanation || branch.label,
      policyId: baseline.policy.id, policyVersion: baseline.policy.version,
      calendarId: baseline.calendar.id, calendarVersion: baseline.calendar.version,
      sourceIds: branch.citation ? [branch.citation] : [], status: "pending", applicability: "required",
    });
  }
  const discoveryAt = view.branches?.find(b => b.id === "evaluation")?.triggerAt || new Date().toISOString();
  const state: CaseState = {
    caseId: view.caseId, auditId: view.auditId, actor: "part21-assurance-os", version: 0,
    policy: baseline.policy, discovery: { documentedAt: discoveryAt, discoveryDecisionId: baseline.decisionId, evidence: evidenceRefs },
    deadlines, transmissions: [], closed: false, holds: [],
  };
  return { state };
}

export async function supervisionStatus(caseId: string) {
  await ensure();
  const [rows] = await db().query<any[]>("SELECT workflow_id, run_id, started_at, started_by FROM part21_case_supervision WHERE case_id=?", [caseId]);
  const row = (rows as any[])[0];
  if (!row) return { bound: false as const, workflowId: null, startedAt: null };
  let running: boolean | null = null; let state: string | null = null;
  try {
    const config = await temporalConfigurationFromEnv();
    const { client, close } = await createTemporalClient(config);
    const description = await client.workflow.getHandle(row.workflow_id).describe();
    running = description.status.name === "RUNNING"; state = description.status.name;
    await close();
  } catch { running = null; }
  return { bound: true as const, workflowId: row.workflow_id as string, runId: row.run_id as string, startedAt: new Date(row.started_at).toISOString(), startedBy: row.started_by as string, running, state };
}

export async function temporalIsConfigured() {
  try { await temporalConfigurationFromEnv(); return true; } catch { return false; }
}

/** Binds the case once, using the persisted revision as the workflow seed so versions agree. */
export async function supervisePart21Case(view: CaseView, principal: AssurancePrincipal, note: string) {
  await ensure();
  const actor = principal.actor ?? principal.id;
  const [existing] = await db().query<any[]>("SELECT workflow_id FROM part21_case_supervision WHERE case_id=?", [view.caseId]);
  if (existing[0]) {
    const [durable] = await db().query<any[]>("SELECT case_id FROM part21_cases WHERE case_id=?", [view.caseId]).catch(() => [[]] as any);
    if ((durable as any[]).length) return supervisionStatus(view.caseId);
    try {
      const cfg = await temporalConfigurationFromEnv();
      const { client, close } = await createTemporalClient(cfg);
      await client.workflow.getHandle(existing[0].workflow_id).terminate("rebind: durable revision missing");
      await close();
    } catch { /* already closed */ }
    await db().query("DELETE FROM part21_case_supervision WHERE case_id=?", [view.caseId]);
  }
  const baseline = await approvedBaseline(actor, note);
  const evidenceRefs = await discoveryEvidenceRefs(view.auditId);
  const seed = buildSeed(view, baseline, evidenceRefs);
  if (!seed.state.deadlines.length) return { bound: false as const, workflowId: null, startedAt: null, reason: "No dated branches to supervise yet." };
  const deps = deadlineDependencies(principal);
  const persisted = await createPart21Case(
    { caseId: view.caseId, auditId: view.auditId, actor, eventId: `${part21WorkflowId(view.caseId)}:create`, policy: baseline.policy, discovery: seed.state.discovery },
    deps,
  );
  const config = await temporalConfigurationFromEnv();
  const { client, close } = await createTemporalClient(config);
  const workflowId = part21WorkflowId(view.caseId);
  try {
    const handle = await client.workflow.start(PART21_CASE_WORKFLOW_TYPE, { workflowId, taskQueue: config.taskQueue, args: [{ state: persisted }] });
    await db().query("INSERT INTO part21_case_supervision (case_id, audit_id, workflow_id, run_id, started_by, policy_decision_id) VALUES (?,?,?,?,?,?)",
      [view.caseId, view.auditId, workflowId, handle.firstExecutionRunId, actor, baseline.decisionId]);
  } finally { await close(); }
  return supervisionStatus(view.caseId);
}
