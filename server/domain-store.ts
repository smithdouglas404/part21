import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";

/** Minimal injectable SQL contracts. No test adapter is selected at runtime. */
export interface StoreSqlExecutor {
  query(sql: string, values?: unknown[]): Promise<[any, any]>;
}
export interface StoreSqlConnection extends StoreSqlExecutor {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}
export interface StoreSqlDatabase extends StoreSqlExecutor {
  getConnection(): Promise<StoreSqlConnection>;
}
export type DomainRecord = { recordType: string; recordId: string; auditId?: string | null; payload: unknown };
export type DomainRecordEnvelope<T = Record<string, unknown>> = {
  recordType: string; recordId: string; auditId: string | null; payload: T;
  contentSha256: string | null; revision: number; createdAt: string; updatedAt: string;
};
export type DomainWriteOptions = { expectedRevision: number; actor: string | null; transaction?: DomainTransaction; createOnly?: boolean };
export interface DomainTransaction { readonly sql: StoreSqlExecutor; readonly active: boolean }
export class DomainScopeError extends Error { readonly code = "DOMAIN_SCOPE_REQUIRED"; }
export class DomainRevisionConflict extends Error {
  readonly code = "DOMAIN_REVISION_CONFLICT";
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Domain revision conflict: expected ${expectedRevision}, found ${actualRevision}. Reload the scoped record before writing.`);
  }
}

export const globalAdministrativeRecordTypes = ["connect_token", "person", "approval_rule", "access_grant", "rbac_role"] as const;
const globalAdministrativeTypes = new Set<string>(globalAdministrativeRecordTypes);
/** Audits are top-level administrative records, not evidence owned by another audit. */
const globalReadableTypes = new Set<string>([...globalAdministrativeRecordTypes, "audit"]);
let pool: Pool | null = null;
export function getStoreDatabase(): StoreSqlDatabase {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; database fallback is disabled.");
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5, timezone: "Z", dateStrings: true });
  return pool as unknown as StoreSqlDatabase;
}

/** Deployment-owner-only DDL. Neither reads nor writes invoke this migration. */
export const domainStoreMigrationStatements = [
  `CREATE TABLE IF NOT EXISTS part21_domain_records (record_type VARCHAR(80) NOT NULL, record_id VARCHAR(180) NOT NULL, audit_id VARCHAR(180) NULL, payload JSON NOT NULL, content_sha256 VARCHAR(64) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (record_type, record_id), INDEX idx_domain_audit (audit_id), INDEX idx_domain_type (record_type))`,
  `CREATE TABLE IF NOT EXISTS part21_domain_record_revisions (record_type VARCHAR(80) NOT NULL, record_id VARCHAR(180) NOT NULL, revision BIGINT UNSIGNED NOT NULL, audit_id VARCHAR(180) NULL, payload JSON NOT NULL, payload_sha256 CHAR(64) NOT NULL, content_sha256 CHAR(64) NULL, recorded_at DATETIME(3) NOT NULL, recorded_by VARCHAR(255) NULL, provenance VARCHAR(40) NOT NULL, PRIMARY KEY (record_type,record_id,revision), INDEX idx_domain_revision_audit (audit_id), INDEX idx_domain_revision_time (recorded_at))`,
] as const;
export async function migrateDomainStore(sql: StoreSqlExecutor) {
  for (const statement of domainStoreMigrationStatements) await sql.query(statement);
  return { source: "mysql-database", statementsApplied: domainStoreMigrationStatements.length };
}

export function requireStoreId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new DomainScopeError(`${name} is required and must be an exact database identifier.`);
}
export function parseStorePayload(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Persisted payload must be a JSON object; corrupt records cannot be replaced with empty data.");
  return parsed as Record<string, unknown>;
}
export function storeTimestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing database timestamp.");
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value) ? `${value.replace(" ", "T")}Z` : /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid database timestamp: ${value}`);
  return date.toISOString();
}
function serialize(payload: unknown) {
  parseStorePayload(payload);
  const json = JSON.stringify(payload);
  return { json, hash: crypto.createHash("sha256").update(json).digest("hex") };
}
function envelope<T>(row: any): DomainRecordEnvelope<T> {
  return { recordType: row.record_type, recordId: row.record_id, auditId: row.audit_id ?? null, payload: parseStorePayload(row.payload) as T, contentSha256: row.content_sha256 ?? null, revision: Number(row.revision ?? 0), createdAt: storeTimestamp(row.created_at), updatedAt: storeTimestamp(row.updated_at) };
}
function assertPayloadScope(payload: Record<string, unknown>, auditId: string | null) {
  for (const key of ["auditId", "sourceAuditId"]) {
    if (payload[key] != null && payload[key] !== auditId) throw new DomainScopeError(`Payload ${key} does not match the immutable domain audit ownership.`);
  }
  if (auditId && Array.isArray(payload.auditIds) && !payload.auditIds.includes(auditId)) throw new DomainScopeError("Payload auditIds excludes the owning audit.");
}

export function createDomainStore(dependencies: { database: () => StoreSqlDatabase }) {
  const transactions = new WeakSet<DomainTransaction>();
  function executor(transaction?: DomainTransaction): StoreSqlExecutor {
    if (!transaction) return dependencies.database();
    if (!transactions.has(transaction) || !transaction.active) throw new Error("The domain transaction is closed or belongs to another store.");
    return transaction.sql;
  }
  async function ensureDomainStore() {
    // SELECT-only compatibility wrapper: absence of schema is an explicit error.
    await dependencies.database().query("SELECT record_type, record_id, audit_id, payload FROM part21_domain_records LIMIT 0");
  }
  async function withDomainTransaction<T>(work: (transaction: DomainTransaction) => Promise<T>): Promise<T> {
    const connection = await dependencies.database().getConnection();
    const transaction = { sql: connection, active: true };
    transactions.add(transaction);
    try {
      await connection.beginTransaction();
      const result = await work(transaction);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { transaction.active = false; connection.release(); }
  }
  async function requireAudit(auditId: string, transaction?: DomainTransaction) {
    requireStoreId(auditId, "auditId");
    const [rows] = await executor(transaction).query("SELECT record_id, audit_id, payload FROM part21_domain_records WHERE record_type='audit' AND record_id=? LIMIT 1", [auditId]);
    if (!rows[0]) throw new DomainScopeError(`Unknown audit ${auditId}; no other audit will be selected.`);
    if (rows[0].audit_id != null && rows[0].audit_id !== auditId) throw new DomainScopeError("Audit ownership metadata is inconsistent.");
    const payload = parseStorePayload(rows[0].payload);
    assertPayloadScope(payload, auditId);
    return payload;
  }
  async function readEnvelope<T extends Record<string, unknown>>(recordType: string, recordId: string, auditId?: string, transaction?: DomainTransaction): Promise<DomainRecordEnvelope<T> | null> {
    requireStoreId(recordType, "recordType"); requireStoreId(recordId, "recordId");
    if (auditId !== undefined) await requireAudit(auditId, transaction);
    else if (!globalReadableTypes.has(recordType)) throw new DomainScopeError(`auditId is required for ${recordType}; use getDomainRecordScoped.`);
    const [rows] = await executor(transaction).query(`SELECT d.*, COALESCE((SELECT MAX(r.revision) FROM part21_domain_record_revisions r WHERE r.record_type=d.record_type AND r.record_id=d.record_id),0) AS revision FROM part21_domain_records d WHERE d.record_type=? AND d.record_id=? LIMIT 1`, [recordType, recordId]);
    if (!rows[0]) return null;
    const result = envelope<T>(rows[0]);
    const owner = recordType === "audit" && result.auditId === null ? recordId : result.auditId;
    if (auditId !== undefined && owner !== auditId) throw new DomainScopeError(`Record ${recordType}/${recordId} is outside the requested audit scope.`);
    if (!globalAdministrativeTypes.has(recordType)) assertPayloadScope(result.payload, owner);
    return result;
  }
  async function getDomainRecordScoped<T extends Record<string, unknown>>(recordType: string, recordId: string, auditId: string, transaction?: DomainTransaction): Promise<T | null> {
    requireStoreId(auditId, "auditId");
    return (await readEnvelope<T>(recordType, recordId, auditId, transaction))?.payload ?? null;
  }
  async function getDomainRecord<T extends Record<string, unknown>>(recordType: string, recordId: string, auditId?: string): Promise<T | null> {
    return (await readEnvelope<T>(recordType, recordId, auditId))?.payload ?? null;
  }
  async function listDomainRecords<T extends Record<string, unknown>>(recordType: string, auditId?: string): Promise<T[]> {
    requireStoreId(recordType, "recordType");
    if (auditId !== undefined) await requireAudit(auditId);
    else if (!globalReadableTypes.has(recordType)) throw new DomainScopeError(`auditId is required when listing ${recordType}.`);
    const auditClause = auditId === undefined ? "" : recordType === "audit" ? " AND (audit_id=? OR record_id=?)" : " AND audit_id=?";
    const [rows] = await dependencies.database().query(`SELECT record_id, audit_id, payload FROM part21_domain_records WHERE record_type=?${auditClause} ORDER BY updated_at DESC`, auditId === undefined ? [recordType] : recordType === "audit" ? [recordType, auditId, auditId] : [recordType, auditId]);
    return rows.map((row: any) => { const payload = parseStorePayload(row.payload); if (!globalAdministrativeTypes.has(recordType)) assertPayloadScope(payload, auditId ?? (recordType === "audit" ? row.record_id : null)); return payload as T; });
  }
  async function writeDomainRecord(record: DomainRecord & { content?: Buffer; contentSha256?: string | null }, options: DomainWriteOptions) {
    requireStoreId(record.recordType, "recordType"); requireStoreId(record.recordId, "recordId");
    if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) throw new Error("A nonnegative integer expectedRevision is required.");
    if (options.actor !== null) requireStoreId(options.actor, "actor");
    const auditId = record.auditId ?? null;
    if (!globalAdministrativeTypes.has(record.recordType)) requireStoreId(auditId, "auditId");
    if (globalAdministrativeTypes.has(record.recordType) && record.recordType !== "access_grant" && auditId !== null) throw new DomainScopeError("Global identity/rule/token records must use null domain ownership; payload token scope is separate.");
    if (record.recordType === "audit" && record.recordId !== auditId) throw new DomainScopeError("An audit owns itself; recordId must equal auditId.");
    const payload = parseStorePayload(record.payload); if (!globalAdministrativeTypes.has(record.recordType)) assertPayloadScope(payload, auditId);
    const serialized = serialize(payload);
    const bytesHash = record.content ? crypto.createHash("sha256").update(record.content).digest("hex") : undefined;
    if (record.contentSha256 != null && !/^[a-f0-9]{64}$/i.test(record.contentSha256)) throw new Error("contentSha256 must be a SHA-256 digest.");
    if (bytesHash && record.contentSha256 && bytesHash !== record.contentSha256) throw new Error("Supplied content digest does not match the uploaded bytes.");
    const run = async (transaction: DomainTransaction) => {
      const sql = executor(transaction);
      if (auditId && record.recordType !== "audit") await requireAudit(auditId, transaction);
      const [rows] = await sql.query("SELECT * FROM part21_domain_records WHERE record_type=? AND record_id=? FOR UPDATE", [record.recordType, record.recordId]);
      const existing = rows[0];
      if (existing && (existing.audit_id ?? (record.recordType === "audit" ? record.recordId : null)) !== auditId) throw new DomainScopeError("Domain audit ownership is immutable; cross-audit reassignment was rejected.");
      if (existing && options.createOnly) throw new Error("An existing record requires an explicit expectedRevision; implicit legacy updates are disabled.");
      const [revisions] = await sql.query("SELECT MAX(revision) AS revision FROM part21_domain_record_revisions WHERE record_type=? AND record_id=?", [record.recordType, record.recordId]);
      const actualRevision = Number(revisions[0]?.revision ?? 0);
      if (actualRevision !== options.expectedRevision || (!existing && actualRevision !== 0)) throw new DomainRevisionConflict(options.expectedRevision, actualRevision);
      const contentSha256 = bytesHash ?? record.contentSha256 ?? existing?.content_sha256 ?? null;
      const [clock] = await sql.query("SELECT UTC_TIMESTAMP(3) AS now");
      const now = storeTimestamp(clock[0]?.now);
      if (existing && actualRevision === 0) {
        // Preserve the exact legacy payload before the first update. Do not invent its author.
        const prior = serialize(parseStorePayload(existing.payload));
        await sql.query("INSERT IGNORE INTO part21_domain_record_revisions (record_type,record_id,revision,audit_id,payload,payload_sha256,content_sha256,recorded_at,recorded_by,provenance) VALUES (?,?,?,?,?,?,?,?,?,?)", [record.recordType, record.recordId, 0, existing.audit_id ?? null, prior.json, prior.hash, existing.content_sha256 ?? null, new Date(storeTimestamp(existing.updated_at)), null, "legacy_snapshot_author_unknown"]);
      }
      const revision = actualRevision + 1;
      if (existing) await sql.query("UPDATE part21_domain_records SET payload=?, content_sha256=?, updated_at=? WHERE record_type=? AND record_id=?", [serialized.json, contentSha256, new Date(now), record.recordType, record.recordId]);
      else await sql.query("INSERT INTO part21_domain_records (record_type,record_id,audit_id,payload,content_sha256,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", [record.recordType, record.recordId, auditId, serialized.json, contentSha256, new Date(now), new Date(now)]);
      await sql.query("INSERT INTO part21_domain_record_revisions (record_type,record_id,revision,audit_id,payload,payload_sha256,content_sha256,recorded_at,recorded_by,provenance) VALUES (?,?,?,?,?,?,?,?,?,?)", [record.recordType, record.recordId, revision, auditId, serialized.json, serialized.hash, contentSha256, new Date(now), options.actor, options.actor === null ? "actor_not_supplied" : "application_write"]);
      // Bytes belong in the evidence vault; never return them or imply this hash preserves them.
      return { recordType: record.recordType, recordId: record.recordId, auditId, payload, contentSha256, payloadSha256: serialized.hash, revision, recordedAt: now, bytesPersisted: false, graphProjection: { projected: false, status: "pending_report_approval", reason: "Working records never mutate the authoritative graph; persisted qualified human approval is required." } };
    };
    return options.transaction ? run(options.transaction) : withDomainTransaction(run);
  }
  /** Backward-compatible create-only wrapper. Existing records require an explicit revision. */
  async function upsertDomainRecord(record: DomainRecord & { content?: Buffer; contentSha256?: string | null }, options?: DomainWriteOptions) {
    return writeDomainRecord(record, options ?? { expectedRevision: 0, actor: null, createOnly: true });
  }
  async function listDomainRecordRevisions<T extends Record<string, unknown>>(recordType: string, recordId: string, auditId: string) {
    const current = await readEnvelope<T>(recordType, recordId, auditId);
    if (!current) return [];
    const [rows] = await dependencies.database().query("SELECT revision, audit_id, payload, payload_sha256, content_sha256, recorded_at, recorded_by, provenance FROM part21_domain_record_revisions WHERE record_type=? AND record_id=? ORDER BY revision", [recordType, recordId]);
    return rows.map((row: any) => ({ revision: Number(row.revision), auditId: row.audit_id ?? null, payload: parseStorePayload(row.payload) as T, payloadSha256: row.payload_sha256, contentSha256: row.content_sha256 ?? null, recordedAt: storeTimestamp(row.recorded_at), recordedBy: row.recorded_by ?? null, provenance: row.provenance }));
  }
  async function getDomainPortfolio(auditId?: string) {
    requireStoreId(auditId, "auditId");
    const audit = await requireAudit(auditId);
    const [findings, evidence, controls, sources, metrics, suppliers, changes] = await Promise.all([
      listDomainRecords("finding", auditId), listDomainRecords("evidence", auditId), listDomainRecords("control", auditId), listDomainRecords("source", auditId), getDomainRecordScoped("metric", auditId, auditId), listDomainRecords("supplier", auditId), listDomainRecords("change", auditId),
    ]);
    const auditWithCounts = {
      ...audit,
      findings: findings.length,
      evidence: `${evidence.length} linked database records`,
    };
    return { source: "mysql-database", audit: auditWithCounts, findings, evidence, controls, sources, metrics, suppliers, changes, supplierProjection: { source: "part21_domain_records audit-scoped supplier records", count: suppliers.length, sharedGraphSuppliersMerged: false, explicitGraphHelper: "listAuditSupplierProjection" } };
  }
  async function listAudits() {
    const db = dependencies.database();
    const [auditRows] = await db.query("SELECT record_id AS recordId, audit_id AS auditId, payload FROM part21_domain_records WHERE record_type='audit' ORDER BY updated_at DESC");
    const [countRows] = await db.query("SELECT audit_id AS auditId, record_type AS recordType, COUNT(*) AS count FROM part21_domain_records WHERE audit_id IS NOT NULL GROUP BY audit_id, record_type");
    const counts = new Map<string, Record<string, number>>();
    for (const row of countRows) counts.set(row.auditId, { ...(counts.get(row.auditId) ?? {}), [row.recordType]: Number(row.count) });
    return auditRows.map((row: any) => {
      if (row.auditId != null && row.auditId !== row.recordId) throw new DomainScopeError(`Audit ${row.recordId} has inconsistent audit ownership ${row.auditId}.`);
      const payload = parseStorePayload(row.payload); assertPayloadScope(payload, row.recordId); const linked = counts.get(row.recordId) ?? {};
      return { ...payload, id: row.recordId, recordId: row.recordId, auditId: row.recordId, findings: linked.finding ?? 0, evidence: `${linked.evidence ?? 0} linked database records` };
    });
  }
  async function getDomainStoreStatus() {
    await ensureDomainStore();
    const [rows] = await dependencies.database().query("SELECT record_type AS recordType, COUNT(*) AS count FROM part21_domain_records GROUP BY record_type ORDER BY record_type");
    return { source: "mysql-database", table: "part21_domain_records", counts: rows, automaticMigration: false };
  }
  async function getDomainRecordEnvelopeScoped<T extends Record<string, unknown>>(recordType: string, recordId: string, auditId: string, transaction?: DomainTransaction) {
    requireStoreId(auditId, "auditId");
    return readEnvelope<T>(recordType, recordId, auditId, transaction);
  }
  async function appendDomainEventInTransaction(transaction: DomainTransaction, event: DomainTransactionalEvent) {
    const sql = executor(transaction);
    requireStoreId(event.id, "event.id"); requireStoreId(event.type, "event.type"); requireStoreId(event.actor, "event.actor");
    if (event.auditId != null) await requireAudit(event.auditId, transaction);
    if (event.entityId != null) requireStoreId(event.entityId, "event.entityId");
    const [clock] = await sql.query("SELECT UTC_TIMESTAMP(3) AS now");
    const occurredAt = event.occurredAt === undefined ? storeTimestamp(clock[0]?.now) : storeTimestamp(event.occurredAt);
    await sql.query("INSERT INTO part21_assurance_events (id,event_type,occurred_at,actor,audit_id,entity_id,payload) VALUES (?,?,?,?,?,?,?)", [event.id, event.type, new Date(occurredAt), event.actor, event.auditId ?? null, event.entityId ?? null, JSON.stringify(parseStorePayload(event.payload))]);
    return { ...event, occurredAt, source: "mysql-database" };
  }
  async function writeDomainRecordWithEvent(record: DomainRecord & { content?: Buffer; contentSha256?: string | null }, options: DomainWriteOptions, event: DomainTransactionalEvent) {
    if ((record.auditId ?? null) !== (event.auditId ?? null) || record.recordId !== event.entityId) throw new DomainScopeError("Atomic record/event audit and entity identities must match exactly.");
    const run = async (transaction: DomainTransaction) => ({ record: await writeDomainRecord(record, { ...options, transaction }), event: await appendDomainEventInTransaction(transaction, event) });
    return options.transaction ? run(options.transaction) : withDomainTransaction(run);
  }
  return { ensureDomainStore, withDomainTransaction, appendDomainEventInTransaction, writeDomainRecordWithEvent, requireAudit, getDomainRecordScoped, getDomainRecord, getDomainRecordEnvelopeScoped, listDomainRecords, writeDomainRecord, upsertDomainRecord, listDomainRecordRevisions, getDomainPortfolio, listAudits, getDomainStoreStatus };
}
export type DomainTransactionalEvent = { id: string; type: string; actor: string; auditId?: string | null; entityId?: string | null; occurredAt?: string; payload: Record<string, unknown> };
const domainStore = createDomainStore({ database: getStoreDatabase });
export const { ensureDomainStore, withDomainTransaction, appendDomainEventInTransaction, writeDomainRecordWithEvent, requireAudit, getDomainRecordScoped, getDomainRecord, getDomainRecordEnvelopeScoped, listDomainRecords, writeDomainRecord, upsertDomainRecord, listDomainRecordRevisions, getDomainPortfolio, listAudits, getDomainStoreStatus } = domainStore;
export type AdministrativeRecordType = (typeof globalAdministrativeRecordTypes)[number];
/** Only server-authenticated administrative callers may use these helpers. */
export async function getAdministrativeRecord<T extends Record<string, unknown>>(recordType: AdministrativeRecordType, recordId: string): Promise<T | null> {
  return getDomainRecord<T>(recordType, recordId);
}
export async function listAdministrativeRecords<T extends Record<string, unknown>>(recordType: AdministrativeRecordType, auditId?: string): Promise<T[]> {
  if (recordType !== "access_grant" && auditId !== undefined) throw new DomainScopeError(`${recordType} is a global administrative record; audit ownership is not applicable.`);
  return listDomainRecords<T>(recordType, auditId);
}
export async function writeAdministrativeRecord(record: DomainRecord & { content?: Buffer; contentSha256?: string | null }, options: DomainWriteOptions) {
  if (!globalAdministrativeTypes.has(record.recordType)) throw new DomainScopeError(`${record.recordType} is not an administrative record type.`);
  return writeDomainRecord(record, options);
}
export function listPersonRecords<T extends Record<string, unknown>>() { return listAdministrativeRecords<T>("person"); }
export function getPersonRecord<T extends Record<string, unknown>>(id: string) { return getAdministrativeRecord<T>("person", id); }
export function listApprovalRuleRecords<T extends Record<string, unknown>>() { return listAdministrativeRecords<T>("approval_rule"); }
export function getApprovalRuleRecord<T extends Record<string, unknown>>(id: string) { return getAdministrativeRecord<T>("approval_rule", id); }
export function listAccessGrantRecords<T extends Record<string, unknown>>(auditId?: string) { return listAdministrativeRecords<T>("access_grant", auditId); }
export function getAccessGrantRecord<T extends Record<string, unknown>>(id: string) { return getAdministrativeRecord<T>("access_grant", id); }
export function getConnectTokenRecord<T extends Record<string, unknown>>(id: string) { return getAdministrativeRecord<T>("connect_token", id); }
