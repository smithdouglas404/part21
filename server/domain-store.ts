import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";

type DomainRecord = { recordType: string; recordId: string; auditId?: string | null; payload: unknown };
let pool: Pool | null = null;
let initialized = false;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; demo fallback is disabled.");
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });
  return pool;
}

export async function ensureDomainStore() {
  if (initialized) return;
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS part21_domain_records (record_type VARCHAR(80) NOT NULL, record_id VARCHAR(180) NOT NULL, audit_id VARCHAR(180) NULL, payload JSON NOT NULL, content_sha256 VARCHAR(64) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (record_type, record_id), INDEX idx_domain_audit (audit_id), INDEX idx_domain_type (record_type))`);
  initialized = true;
}

export async function upsertDomainRecord(record: DomainRecord & { content?: Buffer }) {
  const db = getPool();
  const contentSha256 = record.content ? crypto.createHash("sha256").update(record.content).digest("hex") : null;
  await db.query(`INSERT INTO part21_domain_records (record_type, record_id, audit_id, payload, content_sha256) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE audit_id=VALUES(audit_id), payload=VALUES(payload), content_sha256=VALUES(content_sha256), updated_at=CURRENT_TIMESTAMP`, [record.recordType, record.recordId, record.auditId ?? null, JSON.stringify(record.payload), contentSha256]);
  return { ...record, contentSha256, graphProjection: { projected: false, status: "pending_report_approval", reason: "Working database records do not mutate the authoritative graph until a qualified report is finalized." } };
}

export async function getDomainRecord<T extends Record<string, unknown>>(recordType: string, recordId: string): Promise<T | null> {
  await ensureDomainStore();
  const db = getPool();
  const [rows] = await db.query<any[]>("SELECT payload FROM part21_domain_records WHERE record_type=? AND record_id=? LIMIT 1", [recordType, recordId]);
  return rows[0]?.payload ? (typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload) as T : null;
}

export async function listDomainRecords<T extends Record<string, unknown>>(recordType: string, auditId?: string): Promise<T[]> {
  await ensureDomainStore();
  const db = getPool();
  const [rows] = await db.query<any[]>(auditId ? "SELECT payload FROM part21_domain_records WHERE record_type=? AND audit_id=? ORDER BY updated_at DESC" : "SELECT payload FROM part21_domain_records WHERE record_type=? ORDER BY updated_at DESC", auditId ? [recordType, auditId] : [recordType]);
  return rows.map((row) => (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as T);
}

export async function getDomainPortfolio(auditId?: string) {
  if (!auditId) throw new Error("auditId is required; select an audit from the database.");
  await ensureDomainStore();
  const [audit, auditFindings, auditEvidence, auditControls, auditSources, auditMetrics, suppliers, changes] = await Promise.all([
    getDomainRecord("audit", auditId), listDomainRecords("finding", auditId), listDomainRecords("evidence", auditId), listDomainRecords("control", auditId), listDomainRecords("source", auditId), getDomainRecord("metric", auditId), listDomainRecords("supplier", auditId), listDomainRecords("change", auditId),
  ]);
  return { source: "mysql-database", audit, findings: auditFindings, evidence: auditEvidence, controls: auditControls, sources: auditSources, metrics: auditMetrics, suppliers, changes };
}

export async function listAudits() {
  await ensureDomainStore();
  const db = getPool();
  const [auditRows] = await db.query<any[]>("SELECT record_id AS recordId, audit_id AS auditId, payload FROM part21_domain_records WHERE record_type='audit' ORDER BY updated_at DESC");
  const [countRows] = await db.query<any[]>("SELECT audit_id AS auditId, record_type AS recordType, COUNT(*) AS count FROM part21_domain_records WHERE audit_id IS NOT NULL GROUP BY audit_id, record_type");
  const counts = new Map<string, Record<string, number>>();
  for (const row of countRows) counts.set(row.auditId, { ...(counts.get(row.auditId) ?? {}), [row.recordType]: Number(row.count) });
  return auditRows.map((row) => {
    const audit = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const linked = counts.get(row.recordId) ?? {};
    return { ...audit, findings: linked.finding ?? 0, evidence: `${linked.evidence ?? 0} linked database records` };
  });
}

export async function getDomainStoreStatus() {
  await ensureDomainStore();
  const db = getPool();
  const [rows] = await db.query<any[]>("SELECT record_type AS recordType, COUNT(*) AS count FROM part21_domain_records GROUP BY record_type ORDER BY record_type");
  return { source: "mysql-database", table: "part21_domain_records", counts: rows };
}
