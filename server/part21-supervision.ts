import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { createTemporalClient, part21WorkflowId, temporalConfigurationFromEnv } from "./temporal/client";
import { PART21_CASE_WORKFLOW_TYPE } from "./temporal/names";
import type { CalendarSnapshot, CaseState, Deadline, PolicySnapshot, WorkflowSeed } from "./temporal/contracts";

/**
 * Binds a computed Part 21 case to a durable Temporal workflow.
 *
 * The application remains the system of record: it computes the branch ladder, and the
 * workflow supervises the resulting due dates so reminders and overdue notices fire even
 * when nobody opens the application. The baseline (calendar and durations) is recorded with
 * an explicit approval row, including who approved it and how the approval was captured.
 */

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3, waitForConnections: true });
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

const FEDERAL_HOLIDAYS_2026 = ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"];

function sha(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function approvedBaseline(actor: string, note: string) {
  await ensure();
  const [existing] = await db().query<any[]>("SELECT decision_id, approved_by, approved_at, note, payload FROM part21_baseline_approvals WHERE kind='part21-baseline' ORDER BY approved_at DESC LIMIT 1");
  if (existing[0]) {
    const payload = typeof existing[0].payload === "string" ? JSON.parse(existing[0].payload) : existing[0].payload;
    return { decisionId: existing[0].decision_id as string, approvedBy: existing[0].approved_by as string, approvedAt: new Date(existing[0].approved_at).toISOString(), calendar: payload.calendar as CalendarSnapshot, policy: payload.policy as PolicySnapshot, reused: true };
  }
  const decisionId = `DEC-P21-BASE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const approvedAt = new Date().toISOString();
  const calendar: CalendarSnapshot = {
    id: "CAL-P21-FEDERAL", version: "1.0.0", sha256: "", approvalDecisionId: decisionId, approvedBy: actor, approvedAt, sourceIds: ["10-cfr-part-21"],
    timezone: "America/New_York", workingWeekdays: [1, 2, 3, 4, 5], holidays: FEDERAL_HOLIDAYS_2026,
    validFrom: "2026-01-01", validThrough: "2026-12-31", triggerDay: "exclude", cutoff: "same-local-time", ambiguousTime: "earlier", nonexistentTime: "next-valid",
  };
  calendar.sha256 = sha(calendar);
  const rule = (amount: number, unit: "calendar-days" | "working-days") => ({ amount, unit, calendar });
  const policy: PolicySnapshot = {
    id: "POL-P21-BASELINE", version: "1.0.0", sha256: "", approvalDecisionId: decisionId, approvedBy: actor, approvedAt, sourceIds: ["10-cfr-part-21-21.21"],
    rules: { evaluation: rule(60, "calendar-days"), supplier: rule(5, "working-days"), officer: rule(2, "working-days"), "nrc-initial": rule(2, "calendar-days"), "nrc-written": rule(30, "calendar-days") },
    reminderLeadMilliseconds: [7 * 86400000, 2 * 86400000],
  };
  policy.sha256 = sha(policy);
  const payload = { calendar, policy };
  await db().query("INSERT INTO part21_baseline_approvals (decision_id, kind, approved_by, approved_at, note, sha256, payload) VALUES (?,?,?,?,?,?,?)",
    [decisionId, "part21-baseline", actor, approvedAt.replace("T", " ").slice(0, 19), note.slice(0, 400), sha(payload), JSON.stringify(payload)]);
  return { decisionId, approvedBy: actor, approvedAt, calendar, policy, reused: false };
}

export type CaseView = {
  caseId: string; auditId: string; title?: string; findingId?: string | null; closed?: boolean;
  branches: Array<{ id: string; label: string; triggerAt?: string | null; dueAt?: string | null; localDue?: string | null; explanation?: string; status?: string; citation?: string }>;
};

export function buildSeed(view: CaseView, baseline: { decisionId: string; calendar: CalendarSnapshot; policy: PolicySnapshot; approvedAt: string }): WorkflowSeed {
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
    policy: baseline.policy, discovery: { documentedAt: discoveryAt, discoveryDecisionId: baseline.decisionId, evidence: [] },
    deadlines, transmissions: [], closed: false, holds: [],
  };
  return { state };
}

export async function supervisionStatus(caseId: string) {
  await ensure();
  const [rows] = await db().query<any[]>("SELECT workflow_id, run_id, started_at, started_by FROM part21_case_supervision WHERE case_id=?", [caseId]);
  const row = rows[0];
  if (!row) return { bound: false as const, workflowId: null, startedAt: null };
  let running: boolean | null = null; let state: string | null = null;
  try {
    const config = await temporalConfigurationFromEnv();
    const { client, close } = await createTemporalClient(config);
    const handle = client.workflow.getHandle(row.workflow_id);
    const description = await handle.describe();
    running = description.status.name === "RUNNING"; state = description.status.name;
    await close();
  } catch { running = null; }
  return { bound: true as const, workflowId: row.workflow_id as string, runId: row.run_id as string, startedAt: new Date(row.started_at).toISOString(), startedBy: row.started_by as string, running, state };
}

/** Binds the case once. Returns the existing binding if already supervised. */
export async function supervisePart21Case(view: CaseView, actor: string, note: string) {
  await ensure();
  const [existing] = await db().query<any[]>("SELECT workflow_id FROM part21_case_supervision WHERE case_id=?", [view.caseId]);
  if (existing[0]) return supervisionStatus(view.caseId);
  const baseline = await approvedBaseline(actor, note);
  const seed = buildSeed(view, baseline);
  if (!seed.state.deadlines.length) return { bound: false as const, workflowId: null, startedAt: null, reason: "No dated branches to supervise yet." };
  const config = await temporalConfigurationFromEnv();
  const { client, close } = await createTemporalClient(config);
  const workflowId = part21WorkflowId(view.caseId);
  try {
    const handle = await client.workflow.start(PART21_CASE_WORKFLOW_TYPE, { workflowId, taskQueue: config.taskQueue, args: [seed] });
    await db().query("INSERT INTO part21_case_supervision (case_id, audit_id, workflow_id, run_id, started_by, policy_decision_id) VALUES (?,?,?,?,?,?)",
      [view.caseId, view.auditId, workflowId, handle.firstExecutionRunId, actor, baseline.decisionId]);
  } finally { await close(); }
  return supervisionStatus(view.caseId);
}

export async function temporalIsConfigured() {
  try { await temporalConfigurationFromEnv(); return true; } catch { return false; }
}
