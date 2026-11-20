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
      const age = typeof finding.age === "number" ? ` It has been open for ${finding.age} days.` : "";
      const narrative = [
        `Finding ${finding.id}, "${finding.title ?? "Major finding"}", is recorded in this audit as ${finding.severity} severity and currently stands at "${finding.status}", with ${finding.owner ?? "an unassigned owner"} as the accountable owner.${age}`,
        `A finding at this severity is a recorded admission that a required control did not perform as specified, and the corrective-action expectation in 10 CFR Part 50 Appendix B is not satisfied while the record sits in an intermediate state with no verified action behind it. The uncertainty does not stay with the finding: any product, supplier or evidence record that depends on the failed control inherits the same unverified condition until the finding is closed on evidence.`,
        `The record needs one of two decisions from its owner, captured against ${finding.id} itself. Either a dated corrective action with objective evidence attached and a named verifier, or a documented justification for reclassifying the finding with the technical basis stated. Whichever path is chosen, the decision, the evidence and the resulting graph revision must reference the same record so that the audit report can be defended line by line.`,
      ].join("\n\n");
      alerts.push({
        id: alertId(input.auditId, "finding-open-major", String(finding.id)),
        auditId: input.auditId, code: "finding-open-major",
        severity: severity === "critical" ? "critical" : "high",
        title: `${finding.id}: ${finding.title ?? "Major finding"} remains open`,
        narrative,
        status: "open", findingId: String(finding.id), sourceIds: [input.auditId, String(finding.id)], raisedAt: now,
      });
    }
  }

  for (const item of input.evidence) {
    const status = String(item.status ?? item.state ?? "").toLowerCase();
    if (CLOSED.has(status)) continue;
    if (status.includes("review") || item.reviewDue === true) {
      const narrative = [
        `Evidence ${item.id}${item.title ? ` (${item.title})` : ""} is recorded as "${item.status ?? item.state}"${typeof item.confidence === "number" ? ` with a recorded confidence of ${item.confidence}` : ""}${item.linkedTo ? ` and is linked to ${item.linkedTo}` : ""}.`,
        `Until a qualified reviewer records a disposition, every finding that relies on this item is supported by material that nobody has accepted, and the audit trail cannot distinguish a document that proves a point from one that merely mentions it. The review decision is what converts an uploaded file into evidence that can carry a finding.`,
        `The reviewer should record one of three dispositions against ${item.id} with a short rationale and the review date: accepted as evidence, accepted with a stated limitation, or rejected with the reason. That disposition then becomes the link the finding and the report cite, rather than the raw upload.`,
      ].join("\n\n");
      alerts.push({
        id: alertId(input.auditId, "evidence-review-due", String(item.id)),
        auditId: input.auditId, code: "evidence-review-due", severity: "medium",
        title: `${item.id} is awaiting review`,
        narrative,
        status: "open", findingId: item.findingId ?? null, sourceIds: [input.auditId, String(item.id)], raisedAt: now,
      });
    }
  }

  for (const change of input.changes ?? []) {
    const status = String(change.status ?? "").toLowerCase();
    if (status === "review" || status === "pending") {
      const narrative = [
        `Change ${change.id}${change.title ? ` (${change.title})` : change.description ? ` (${change.description})` : ""} is recorded as "${change.status}" and has not been approved.`,
        `A configuration change that is being relied on before approval breaks the traceability chain this audit exists to test, because the as-built baseline no longer matches the approved design. It also removes the basis for any Part 21 evaluation of the change, since that evaluation has to start from an approved configuration rather than one still in motion.`,
        `The change owner should either complete the approval and record the approver and date, or word the related finding so that it does not rely on the unapproved state. The choice and its rationale belong in the change record so that the graph, the finding and the report all describe the same configuration.`,
      ].join("\n\n");
      alerts.push({
        id: alertId(input.auditId, "change-unapproved", String(change.id)),
        auditId: input.auditId, code: "change-unapproved", severity: "high",
        title: `${change.id} is still in review`,
        narrative,
        status: "open", findingId: change.findingId ?? null, sourceIds: [input.auditId, String(change.id)], raisedAt: now,
      });
    }
  }

  if (input.precedent?.coverageGap) {
    const narrative = [
      input.precedent.coverageStatement,
      `This is an observation about the audit record rather than a conclusion about the plant. It means the organisation cannot demonstrate from its own findings history whether this failure mode was previously detected, corrected and verified, so the same weakness may be present elsewhere without a precedent to point at.`,
      `The auditor should record the failure mode explicitly on the finding so that future audits can match it, and should note in the report that the gap is a coverage limitation of the audit programme rather than a clean history.`,
    ].join("\n\n");
    alerts.push({
      id: alertId(input.auditId, "precedent-coverage-gap", "portfolio"),
      auditId: input.auditId, code: "precedent-coverage-gap", severity: "low",
      title: "No comparable finding exists in any prior audit",
      narrative,
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
      // Keep the alert text in step with the records it describes, but never resurrect a
      // human acknowledgement and never rewrite the original raise time.
      const refreshed = { ...alert, raisedAt: current.raisedAt ?? alert.raisedAt };
      const payload = JSON.stringify(refreshed);
      if (payload !== JSON.stringify(current)) {
        await pool().query("UPDATE part21_domain_records SET payload=?, content_sha256=?, updated_at=NOW(3) WHERE record_type='warning' AND record_id=? AND audit_id=?", [payload, crypto.createHash("sha256").update(payload).digest("hex"), alert.id, alert.auditId]);
      }
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
  // Imported lazily so the pure rules stay testable without a network or database layer.
  const { dispatchAuditAlerts } = await import("./alert-webhook");
  const deliveries = await dispatchAuditAlerts(alerts);
  // Report persisted state so an acknowledged alert is never shown as open again.
  return { auditId, findingId: findingId ?? null, alerts: await listAuditAlerts(auditId), derived: alerts.length, ...result, deliveries };
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
