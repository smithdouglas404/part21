import "dotenv/config";
import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import type { AuditAlert, AlertSeverity } from "./alerts";

/**
 * Outbound alert notification.
 *
 * An alert that only exists inside the browser tab is not a notification. This dispatcher
 * posts high and critical alerts to a configured HTTPS endpoint, signs the exact request
 * body with HMAC-SHA256 so the receiver can prove the payload came from this installation,
 * and records every attempt in `part21_alert_deliveries` so a delivery can be audited after
 * the fact. Delivery failure never blocks alert persistence: the alert stays open and the
 * failure is recorded with its HTTP status and error text.
 */
export type AlertDelivery = {
  deliveryId: string;
  alertId: string;
  auditId: string;
  severity: AlertSeverity;
  url: string;
  attempt: number;
  ok: boolean;
  statusCode: number | null;
  signature: string;
  requestSha256: string;
  responseExcerpt: string | null;
  error: string | null;
  durationMs: number;
  attemptedAt: string;
};

const NOTIFY_SEVERITIES = new Set<AlertSeverity>(["critical", "high"]);
let shared: Pool | null = null;
function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for alert delivery.");
  if (!shared) shared = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3, waitForConnections: true });
  return shared;
}

export const alertDeliveryMigration = `CREATE TABLE IF NOT EXISTS part21_alert_deliveries (
  delivery_id VARCHAR(80) PRIMARY KEY,
  alert_id VARCHAR(120) NOT NULL,
  audit_id VARCHAR(180) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  url VARCHAR(500) NOT NULL,
  attempt INT NOT NULL,
  ok TINYINT NOT NULL,
  status_code INT NULL,
  signature CHAR(71) NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  response_excerpt TEXT NULL,
  error TEXT NULL,
  duration_ms INT NOT NULL,
  attempted_at DATETIME(3) NOT NULL,
  INDEX idx_alert_delivery_alert (alert_id, ok),
  INDEX idx_alert_delivery_audit (audit_id, attempted_at)
)`;

export async function migrateAlertDeliveries() {
  await pool().query(alertDeliveryMigration);
  return { table: "part21_alert_deliveries" };
}

/** Signature covers the timestamp and the raw body, so a captured body cannot be replayed under a new time. */
export function signAlertPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifyAlertSignature(input: { secret: string; timestamp: string; body: string; signature: string }): boolean {
  const expected = signAlertPayload(input.secret, input.timestamp, input.body);
  const a = Buffer.from(expected), b = Buffer.from(input.signature ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function notificationCandidate(alert: AuditAlert): boolean {
  return alert.status === "open" && NOTIFY_SEVERITIES.has(alert.severity);
}

export function webhookConfiguration() {
  const url = process.env.PART21_ALERT_WEBHOOK_URL?.trim() || null;
  const secret = process.env.PART21_ALERT_WEBHOOK_SECRET?.trim() || null;
  let host: string | null = null;
  try { host = url ? new URL(url).host : null; } catch { host = null; }
  return {
    configured: Boolean(url && secret),
    urlConfigured: Boolean(url),
    secretConfigured: Boolean(secret),
    host,
    notifies: [...NOTIFY_SEVERITIES],
    signatureAlgorithm: "HMAC-SHA256 over `${timestamp}.${rawBody}`",
    header: "X-Part21-Signature",
  };
}

function deliveryId(alertId: string, attempt: number) {
  return `DLV-${crypto.createHash("sha256").update(`${alertId}|${attempt}|${Date.now()}`).digest("hex").slice(0, 20).toUpperCase()}`;
}

async function nextAttempt(alertId: string): Promise<number> {
  const [rows] = await pool().query<any[]>("SELECT COUNT(*) AS count FROM part21_alert_deliveries WHERE alert_id=?", [alertId]);
  return Number((rows as any[])[0]?.count ?? 0) + 1;
}

async function alreadyDelivered(alertId: string): Promise<boolean> {
  const [rows] = await pool().query<any[]>("SELECT delivery_id FROM part21_alert_deliveries WHERE alert_id=? AND ok=1 LIMIT 1", [alertId]);
  return (rows as any[]).length > 0;
}

async function record(delivery: AlertDelivery) {
  await pool().query(
    `INSERT INTO part21_alert_deliveries (delivery_id,alert_id,audit_id,severity,url,attempt,ok,status_code,signature,request_sha256,response_excerpt,error,duration_ms,attempted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [delivery.deliveryId, delivery.alertId, delivery.auditId, delivery.severity, delivery.url, delivery.attempt, delivery.ok ? 1 : 0,
     delivery.statusCode, delivery.signature, delivery.requestSha256, delivery.responseExcerpt, delivery.error, delivery.durationMs, new Date(delivery.attemptedAt)],
  );
}

export async function deliverAlertWebhook(input: { alert: AuditAlert; force?: boolean }): Promise<AlertDelivery> {
  await migrateAlertDeliveries();
  const alert = input.alert;
  const url = process.env.PART21_ALERT_WEBHOOK_URL?.trim();
  const secret = process.env.PART21_ALERT_WEBHOOK_SECRET?.trim();
  const attempt = await nextAttempt(alert.id);
  const attemptedAt = new Date().toISOString();
  const id = deliveryId(alert.id, attempt);
  if (!url || !secret) {
    const skipped: AlertDelivery = { deliveryId: id, alertId: alert.id, auditId: alert.auditId, severity: alert.severity, url: url ?? "", attempt, ok: false, statusCode: null, signature: "", requestSha256: "", responseExcerpt: null, error: "PART21_ALERT_WEBHOOK_URL and PART21_ALERT_WEBHOOK_SECRET must both be set before delivery is possible.", durationMs: 0, attemptedAt };
    await record(skipped);
    return skipped;
  }
  if (!input.force && await alreadyDelivered(alert.id)) {
    // Suppression is not an attempt: recording it would inflate the delivery history every time
    // an agent re-evaluates the same open alert.
    return { deliveryId: id, alertId: alert.id, auditId: alert.auditId, severity: alert.severity, url, attempt, ok: true, statusCode: null, signature: "", requestSha256: "", responseExcerpt: null, error: "Already delivered successfully; suppressed as a duplicate.", durationMs: 0, attemptedAt };
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    event: "part21.alert.raised",
    deliveryId: id,
    sentAt: attemptedAt,
    alert: { id: alert.id, auditId: alert.auditId, code: alert.code, severity: alert.severity, title: alert.title, narrative: alert.narrative, status: alert.status, findingId: alert.findingId, sourceIds: alert.sourceIds, raisedAt: alert.raisedAt },
  });
  const signature = signAlertPayload(secret, timestamp, body);
  const requestSha256 = crypto.createHash("sha256").update(body).digest("hex");
  const started = Date.now();
  let statusCode: number | null = null, ok = false, responseExcerpt: string | null = null, error: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "part21-assurance-os/alert-dispatcher", "x-part21-signature": signature, "x-part21-timestamp": timestamp, "x-part21-delivery": id, "x-part21-alert-id": alert.id, "x-part21-severity": alert.severity },
      body,
      signal: controller.signal,
    });
    statusCode = response.status;
    ok = response.ok;
    const text = await response.text().catch(() => "");
    responseExcerpt = text.slice(0, 600) || null;
    if (!ok) error = `Receiver returned HTTP ${response.status}.`;
  } catch (cause: any) {
    error = cause?.name === "AbortError" ? "Receiver did not respond within 8000 ms." : String(cause?.message ?? cause);
  } finally { clearTimeout(timer); }
  const delivery: AlertDelivery = { deliveryId: id, alertId: alert.id, auditId: alert.auditId, severity: alert.severity, url, attempt, ok, statusCode, signature, requestSha256, responseExcerpt, error, durationMs: Date.now() - started, attemptedAt };
  await record(delivery);
  return delivery;
}

/** Called after alerts are persisted. Never throws: a failed notification must not lose the alert. */
export async function dispatchAuditAlerts(alerts: AuditAlert[]): Promise<AlertDelivery[]> {
  // An unconfigured installation should not fill the delivery table with identical failures on
  // every agent run; a manual notify still records the precise reason.
  if (!webhookConfiguration().configured) return [];
  const candidates = alerts.filter(notificationCandidate);
  const results: AlertDelivery[] = [];
  for (const alert of candidates) {
    try { results.push(await deliverAlertWebhook({ alert })); }
    catch (cause: any) { results.push({ deliveryId: `DLV-FAILED-${alert.id}`, alertId: alert.id, auditId: alert.auditId, severity: alert.severity, url: process.env.PART21_ALERT_WEBHOOK_URL ?? "", attempt: 0, ok: false, statusCode: null, signature: "", requestSha256: "", responseExcerpt: null, error: String(cause?.message ?? cause), durationMs: 0, attemptedAt: new Date().toISOString() }); }
  }
  return results;
}

export async function listAlertDeliveries(auditId: string): Promise<AlertDelivery[]> {
  await migrateAlertDeliveries();
  const [rows] = await pool().query<any[]>("SELECT * FROM part21_alert_deliveries WHERE audit_id=? ORDER BY attempted_at DESC LIMIT 100", [auditId]);
  return (rows as any[]).map((row) => ({
    deliveryId: row.delivery_id, alertId: row.alert_id, auditId: row.audit_id, severity: row.severity, url: row.url,
    attempt: Number(row.attempt), ok: Boolean(row.ok), statusCode: row.status_code == null ? null : Number(row.status_code),
    signature: row.signature, requestSha256: row.request_sha256, responseExcerpt: row.response_excerpt, error: row.error,
    durationMs: Number(row.duration_ms), attemptedAt: new Date(row.attempted_at).toISOString(),
  }));
}
