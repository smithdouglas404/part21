import "dotenv/config";
import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { buildPrecedentPacket } from "./precedent";

/**
 * Audit alert engine.
 *
 * Before this module existed, the application had an acknowledge endpoint but no producer:
 * nothing ever wrote a `warning` record, so the agent could describe a problem but could not
 * raise one. These rules read the persisted audit state and produce durable, deduplicated,
 * acknowledgeable alerts. Every alert names the records that caused it. An alert is a request
 * for human attention, never a regulatory conclusion.
 */

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AuditAlert = {
  id: string;
  auditId: string;
  code: string;
  severity: AlertSeverity;
  title: string;
  narrative: string;
  status: "open" | "acknowledged";
  findingId: string | null;
  sourceIds: string[];
  raisedAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  rationale?: string;
};

let shared: Pool | null = null;
function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for alerts.");
  if (!shared) shared = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3, waitForConnections: true });
  return shared;
}

function parsed(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function alertId(auditId: string, code: string, subject: string) {
  return `WARN-${crypto.createHash("sha256").update(`${auditId}|${code}|${subject}`).digest("hex").slice(0, 16).toUpperCase()}`;
}

async function records(type: string, auditId: string) {
  const [rows] = await pool().query<any[]>(
    "SELECT record_id, payload FROM part21_domain_records WHERE record_type=? AND audit_id=?",
    [type, auditId],
  );
  return (rows as any[]).map(row => ({ id: String(row.record_id), ...parsed(row.payload) }));
}

const CLOSED = new Set(["closed", "verified", "complete", "completed", "cancelled", "void"]);

/** Pure rule evaluation, exported so tests can exercise it without a database. */
export function deriveAlerts(input: {
  auditId: string;
  findings: Array<Record<string, any>>;
  evidence: Array<Record<string, any>>;
  changes?: Array<Record<string, any>>;
  precedent?: Awaited<ReturnType<typeof buildPrecedentPacket>> | null;
  now?: string;
}): AuditAlert[] {
  const now = input.now ?? new Date().toISOString();
  const alerts: AuditAlert[] = [];

  for (const finding of input.findings) {
    const severity = String(finding.severity ?? "").toLowerCase();
    const status = String(finding.status ?? "").toLowerCase();
    if (CLOSED.has(status)) continue;
    if (severity === "major" || severity === "critical") {
      alerts.push({
        id: alertId(input.auditId, "finding-open-major", String(finding.id)),
        auditId: input.auditId, code: "finding-open-major",
        severity: severity === "critical" ? "critical" : "high",
        title: `${finding.id}: ${finding.title ?? "Major finding"} remains open`,
        narrative: `Finding ${finding.id} is recorded as ${finding.severity} severity and is currently ${finding.status}, owned by ${finding.owner ?? "an unassigned owner"}. A finding of this severity cannot be treated as closed while evidence, corrective action or an accountable decision is still outstanding, so the record needs an owner decision and a dated next action rather than remaining in its present state.`,
        status: "open", findingId: String(finding.id), sourceIds: [input.auditId, String(finding.id)], raisedAt: now,
      });
    }
  }

  for (const item of input.evidence) {
    const status = String(item.status ?? "").toLowerCase();
    if (CLOSED.has(status)) continue;
    if (status.includes("review") || item.reviewDue === true) {
      alerts.push({
        id: alertId(input.auditId, "evidence-review-due", String(item.id)),
        auditId: input.auditId, code: "evidence-review-due", severity: "medium",
        title: `${item.id} is awaiting review`,
        narrative: `Evidence ${item.id}${item.title ? ` (${item.title})` : ""} is recorded as ${item.status}${typeof item.confidence === "number" ? ` with confidence ${item.confidence}` : ""}. Until a qualified reviewer records a disposition, any finding that relies on this item is supported by unverified material, so the review decision and its rationale must be captured before the finding advances.`,
        status: "open", findingId: item.findingId ?? null, sourceIds: [input.auditId, String(item.id)], raisedAt: now,
      });
    }
  }

  for (const change of input.changes ?? []) {
    const status = String(change.status ?? "").toLowerCase();
    if (status === "review" || status === "pending") {
      alerts.push({
        id: alertId(input.auditId, "change-unapproved", String(change.id)),
        auditId: input.auditId, code: "change-unapproved", severity: "high",
        title: `${change.id} is still in review`,
        narrative: `Change ${change.id}${change.title ? ` (${change.title})` : ""} is recorded as ${change.status} and has not been approved. A configuration change that is being relied on before approval breaks the traceability chain the audit is testing, so either the approval must be completed or the finding must be worded to exclude reliance on it.`,
        status: "open", findingId: change.findingId ?? null, sourceIds: [input.auditId, String(change.id)], raisedAt: now,
      });
    }
  }

  if (input.precedent?.coverageGap) {
    alerts.push({
      id: alertId(input.auditId, "precedent-coverage-gap", "portfolio"),
      auditId: input.auditId, code: "precedent-coverage-gap", severity: "low",
      title: "No comparable finding exists in any prior audit",
      narrative: `${input.precedent.coverageStatement} This is an observation about the audit record, not a conclusion about the plant: it means the organisation cannot demonstrate, from its own findings history, whether this failure mode was previously detected and corrected.`,
      status: "open", findingId: input.precedent.scope.findingId ?? null,
      sourceIds: [input.auditId, ...input.precedent.relatedAudits.map(a => a.auditId)], raisedAt: now,
    });
  }

  return alerts;
}

/** Persist alerts without overwriting a human acknowledgement. */
export async function persistAuditAlerts(alerts: AuditAlert[]): Promise<{ inserted: number; existing: number }> {
  let inserted = 0, existing = 0;
  for (const alert of alerts) {
    const [rows] = await pool().query<any[]>("SELECT payload FROM part21_domain_records WHERE record_type='warning' AND record_id=?", [alert.id]);
    if ((rows as any[]).length) {
      const current = parsed((rows as any[])[0].payload);
      if (current.status === "acknowledged") { existing++; continue; }
      existing++;
      continue;
    }
    const payload = JSON.stringify(alert);
    await pool().query(
      "INSERT INTO part21_domain_records (record_type,record_id,audit_id,payload,content_sha256,created_at,updated_at) VALUES ('warning',?,?,?,?,NOW(3),NOW(3))",
      [alert.id, alert.auditId, payload, crypto.createHash("sha256").update(payload).digest("hex")],
    );
    inserted++;
  }
  return { inserted, existing };
}

export async function raiseAuditAlerts(auditId: string, findingId?: string | null) {
  const [findings, evidence, changes] = await Promise.all([records("finding", auditId), records("evidence", auditId), records("change", auditId)]);
  const precedent = await buildPrecedentPacket({ auditId, findingId: findingId ?? null }).catch(() => null);
  const alerts = deriveAlerts({ auditId, findings, evidence, changes, precedent });
  const result = await persistAuditAlerts(alerts);
  return { auditId, findingId: findingId ?? null, alerts, ...result };
}

export async function listAuditAlerts(auditId: string): Promise<AuditAlert[]> {
  const [rows] = await pool().query<any[]>(
    "SELECT payload FROM part21_domain_records WHERE record_type='warning' AND audit_id=? ORDER BY created_at DESC",
    [auditId],
  );
  return (rows as any[]).map(row => parsed(row.payload) as AuditAlert);
}

export async function acknowledgeAuditAlert(input: { auditId: string; alertId: string; actor: string; rationale: string }): Promise<AuditAlert> {
  if (!input.rationale?.trim()) throw new Error("An acknowledgement rationale is required.");
  const [rows] = await pool().query<any[]>("SELECT payload FROM part21_domain_records WHERE record_type='warning' AND record_id=? AND audit_id=?", [input.alertId, input.auditId]);
  if (!(rows as any[]).length) throw new Error("Alert does not exist in this audit.");
  const alert = parsed((rows as any[])[0].payload) as AuditAlert;
  if (alert.status === "acknowledged") return alert;
  const updated: AuditAlert = { ...alert, status: "acknowledged", acknowledgedBy: input.actor, acknowledgedAt: new Date().toISOString(), rationale: input.rationale.trim() };
  const payload = JSON.stringify(updated);
  await pool().query("UPDATE part21_domain_records SET payload=?, content_sha256=?, updated_at=NOW(3) WHERE record_type='warning' AND record_id=? AND audit_id=?", [payload, crypto.createHash("sha256").update(payload).digest("hex"), input.alertId, input.auditId]);
  return updated;
}
