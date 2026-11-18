import { createPool, type Pool } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { canonicalJson, required, sha256, type AssetWrite, type DomainPayload, type EvidenceAsset, type EvidenceEvent, type EvidenceRepository, type EvidenceTransaction, type ExternalReference } from "./types";

type Queryable = { query(sql: string, values?: any[]): Promise<any> };
export interface EvidenceSqlPool extends Queryable {
  getConnection(): Promise<Queryable & { beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>; release(): void }>;
}
const parse = (value: any) => typeof value === "string" ? JSON.parse(value) : value;
const sqlTime = (value: string) => value.replace("T", " ").replace("Z", "");
const isoTime = (value: any): string => value instanceof Date ? value.toISOString() : new Date(`${String(value).replace(" ", "T").replace(/Z$/, "")}Z`).toISOString();

class MysqlTransaction implements EvidenceTransaction {
  constructor(private db: Queryable) {}
  async now() {
    const [rows] = await this.db.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ') AS now");
    if (!rows[0]?.now) throw new Error("Database clock unavailable");
    return String(rows[0].now).replace(/(\.\d{3})\d{3}Z$/, "$1Z");
  }
  async requireAudit(auditId: string) {
    required(auditId, "auditId");
    const [rows] = await this.db.query("SELECT record_id FROM part21_domain_records WHERE record_type='audit' AND record_id=? AND (audit_id=? OR audit_id IS NULL) LIMIT 1", [auditId, auditId]);
    if (!rows.length) throw new Error("Audit not found in configured database");
  }
  async getRecord(type: string, id: string, auditId: string, lock = false) {
    required(auditId, "auditId"); required(id, "recordId");
    const [rows] = await this.db.query(`SELECT payload FROM part21_domain_records WHERE record_type=? AND record_id=? AND audit_id=? LIMIT 1${lock ? " FOR UPDATE" : ""}`, [type, id, auditId]);
    return rows.length ? parse(rows[0].payload) as DomainPayload : null;
  }
  async putRecord(type: string, id: string, auditId: string, payload: DomainPayload, actor: string, expectedRevision?: number) {
    required(actor, "actor"); required(auditId, "auditId");
    // Existing globally keyed domain-store records may never be reassigned to another audit.
    const [rows] = await this.db.query("SELECT audit_id,payload FROM part21_domain_records WHERE record_type=? AND record_id=? FOR UPDATE", [type, id]);
    if (rows.length && rows[0].audit_id !== auditId) throw new Error("Record belongs to a different audit; reassignment forbidden");
    const old = rows.length ? parse(rows[0].payload) : null;
    const [revisions] = await this.db.query("SELECT MAX(revision) AS revision FROM part21_record_revisions WHERE record_type=? AND record_id=? AND audit_id=?", [type, id, auditId]);
    const previous = Number(revisions[0]?.revision ?? old?.recordRevision ?? 0);
    if (expectedRevision !== undefined && expectedRevision !== previous) throw new Error("Record revision conflict");
    const now = await this.now();
    const updated = { ...payload, auditId, recordRevision: previous + 1, updatedAt: now };
    const encoded = canonicalJson(updated);
    await this.db.query("INSERT INTO part21_record_revisions(record_type,record_id,audit_id,revision,payload,payload_sha256,actor,recorded_at) VALUES(?,?,?,?,?,?,?,?)", [type,id,auditId,previous + 1,encoded,sha256(encoded),actor,sqlTime(now)]);
    if (rows.length) await this.db.query("UPDATE part21_domain_records SET payload=?,updated_at=UTC_TIMESTAMP(3) WHERE record_type=? AND record_id=? AND audit_id=?", [encoded,type,id,auditId]);
    else await this.db.query("INSERT INTO part21_domain_records(record_type,record_id,audit_id,payload,content_sha256) VALUES(?,?,?,?,NULL)", [type,id,auditId,encoded]);
    return updated;
  }
  async putAsset(input: AssetWrite): Promise<EvidenceAsset> {
    const { bytes, external:_untrustedExternal, externalError:_untrustedExternalError, ...metadata } = input;
    const recordedAt = await this.now();
    const asset: EvidenceAsset = { ...metadata, recordedAt, sha256: sha256(bytes), sizeBytes: bytes.length, storageStatus: "db_preserved_not_vaulted" };
    await this.db.query("INSERT INTO part21_evidence_versions(asset_id,audit_id,revision,owner_type,owner_id,original_bytes,sha256,size_bytes,metadata,external_status,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [asset.assetId,asset.auditId,asset.revision,asset.ownerType,asset.ownerId,bytes,asset.sha256,asset.sizeBytes,canonicalJson(asset),asset.storageStatus,sqlTime(recordedAt)]);
    const readback = await this.getAsset(asset.assetId, asset.auditId, asset.revision);
    if (!readback?.bytes || !readback.bytes.equals(bytes) || sha256(readback.bytes) !== asset.sha256) throw new Error("Original-byte database readback failed; transaction rolled back");
    return asset;
  }
  async getAsset(id: string, auditId: string, revision?: number) {
    required(auditId, "auditId"); required(id, "assetId");
    const [rows] = await this.db.query(`SELECT metadata,original_bytes,external_status,external_reference,external_error FROM part21_evidence_versions WHERE asset_id=? AND audit_id=?${revision === undefined ? "" : " AND revision=?"} ORDER BY revision DESC LIMIT 1`, revision === undefined ? [id,auditId] : [id,auditId,revision]);
    if (!rows.length) return null;
    const row = rows[0];
    const asset: EvidenceAsset = { ...parse(row.metadata), storageStatus: row.external_status, ...(row.external_reference ? { external: parse(row.external_reference) } : {}), ...(row.external_error ? { externalError: row.external_error } : {}) };
    return { asset, bytes: row.original_bytes == null ? null : Buffer.from(row.original_bytes) };
  }
  async appendEvent(input: Omit<EvidenceEvent,"id"|"occurredAt"|"previousHash"|"eventHash">) {
    required(input.actor, "actor");required(input.auditId,"auditId");required(input.entityId,"entityId");required(input.type,"event type");
    await this.db.query("INSERT IGNORE INTO part21_evidence_streams(audit_id,entity_id) VALUES(?,?)", [input.auditId,input.entityId]);
    const [streams] = await this.db.query("SELECT last_revision,last_hash FROM part21_evidence_streams WHERE audit_id=? AND entity_id=? FOR UPDATE", [input.auditId,input.entityId]);
    if (!streams[0]) throw new Error("Evidence custody stream unavailable");
    const event = { ...input, id: `EVT-${randomUUID()}`, occurredAt: await this.now(), revision: Number(streams[0].last_revision) + 1, previousHash: streams[0].last_hash ?? null };
    const eventHash = sha256(canonicalJson(event));
    const persisted: EvidenceEvent = { ...event, eventHash };
    await this.db.query("INSERT INTO part21_evidence_events(id,audit_id,entity_id,revision,event_type,actor,occurred_at,payload,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?,?,?,?)", [event.id,event.auditId,event.entityId,event.revision,event.type,event.actor,sqlTime(event.occurredAt),canonicalJson(event.payload),event.previousHash,eventHash]);
    // Same connection/transaction: existing event consumers see the real primary event ID.
    await this.db.query("INSERT INTO part21_assurance_events(id,event_type,occurred_at,actor,audit_id,entity_id,payload) VALUES(?,?,?,?,?,?,?)", [event.id,event.type,sqlTime(event.occurredAt),event.actor,event.auditId,event.entityId,canonicalJson({ ...event.payload, custodyRevision: event.revision, eventHash, previousHash: event.previousHash })]);
    await this.db.query("UPDATE part21_evidence_streams SET last_revision=?,last_hash=? WHERE audit_id=? AND entity_id=?", [event.revision,eventHash,event.auditId,event.entityId]);
    return persisted;
  }
  async recordExternal(id: string, auditId: string, revision: number, result: { external?: ExternalReference; error?: string }) {
    required(id,"assetId");required(auditId,"auditId");if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Exact positive asset revision required");
    await this.db.query("UPDATE part21_evidence_versions SET external_status=?,external_reference=COALESCE(?,external_reference),external_error=? WHERE asset_id=? AND audit_id=? AND revision=?", [result.error ? "external_failed" : result.external ? "protected_verified" : "external_pending",result.external ? canonicalJson(result.external) : null,result.error ?? null,id,auditId,revision]);
  }
}

export function createMysqlEvidenceRepository(db: EvidenceSqlPool): EvidenceRepository {
  return {
    async transaction(fn) {
      const conn = await db.getConnection();
      try { await conn.beginTransaction(); const value = await fn(new MysqlTransaction(conn)); await conn.commit(); return value; }
      catch (error) { await conn.rollback(); throw error; }
      finally { conn.release(); }
    },
    async listRecords(type, auditId) {
      required(auditId,"auditId");
      const [rows] = await db.query("SELECT payload FROM part21_domain_records WHERE record_type=? AND audit_id=? ORDER BY updated_at DESC", [type,auditId]);
      return rows.map((row: any) => parse(row.payload));
    },
    async timeline(auditId, entityId) {
      required(auditId,"auditId"); required(entityId,"entityId");
      const [rows] = await db.query("SELECT id,event_type AS type,audit_id AS auditId,entity_id AS entityId,revision,actor,occurred_at AS occurredAt,payload,previous_hash AS previousHash,event_hash AS eventHash FROM part21_evidence_events WHERE audit_id=? AND entity_id=? ORDER BY revision", [auditId,entityId]);
      return rows.map((row: any) => ({ ...row, occurredAt: isoTime(row.occurredAt), payload: parse(row.payload) }));
    },
    async status(auditId) {
      required(auditId,"auditId");
      const [rows] = await db.query("SELECT COUNT(*) AS versions,COALESCE(SUM(original_bytes IS NOT NULL),0) AS preserved,COALESCE(SUM(external_status='protected_verified'),0) AS protected,COALESCE(SUM(external_status='external_failed'),0) AS failed FROM part21_evidence_versions WHERE audit_id=?", [auditId]);
      return Object.fromEntries(Object.entries(rows[0]).map(([k,v]) => [k,Number(v)])) as { versions:number; preserved:number; protected:number; failed:number };
    },
    async saveProof(eventId,auditId,provider,proof,verifiedAt) {
      required(eventId,"eventId");required(auditId,"auditId");required(provider,"proof provider");
      await db.query("INSERT INTO part21_evidence_proofs(event_id,audit_id,provider,proof,verified_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE proof=VALUES(proof),verified_at=VALUES(verified_at)", [eventId,auditId,provider,canonicalJson(proof),sqlTime(verifiedAt)]);
    },
    async getProof(eventId,auditId,provider) {
      required(eventId,"eventId");required(auditId,"auditId");required(provider,"proof provider");
      const [rows] = await db.query("SELECT proof FROM part21_evidence_proofs WHERE event_id=? AND audit_id=? AND provider=? LIMIT 1", [eventId,auditId,provider]);
      return rows.length ? parse(rows[0].proof) : null;
    },
  };
}
let pool: Pool | undefined;
export function getMysqlEvidenceRepository(): EvidenceRepository {
  required(process.env.DATABASE_URL,"DATABASE_URL");
  pool ??= createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5, timezone: "Z", dateStrings: true });
  return createMysqlEvidenceRepository(pool as unknown as EvidenceSqlPool);
}
