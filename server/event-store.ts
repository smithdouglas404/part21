import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";

export type AssuranceEvent = {
  id: string;
  type: string;
  occurredAt: string;
  actor: string;
  auditId?: string;
  entityId?: string;
  payload: Record<string, unknown>;
};

let pool: Pool | null = null;
let initialized = false;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; filesystem event fallback is disabled.");
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });
  return pool;
}

async function ensureStore() {
  const db = getPool();
  if (!initialized) {
    await db.query(`CREATE TABLE IF NOT EXISTS part21_assurance_events (id VARCHAR(180) PRIMARY KEY, event_type VARCHAR(160) NOT NULL, occurred_at DATETIME(3) NOT NULL, actor VARCHAR(255) NOT NULL, audit_id VARCHAR(180) NULL, entity_id VARCHAR(180) NULL, payload JSON NOT NULL, INDEX idx_events_type (event_type), INDEX idx_events_audit (audit_id), INDEX idx_events_entity (entity_id), INDEX idx_events_time (occurred_at))`);
    initialized = true;
  }
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return (value ?? {}) as Record<string, unknown>;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

export async function appendAssuranceEvent(event: Omit<AssuranceEvent, "id" | "occurredAt"> & Partial<Pick<AssuranceEvent, "id" | "occurredAt">>) {
  await ensureStore();
  const persisted: AssuranceEvent = { id: event.id || `EVT-${crypto.randomUUID()}`, occurredAt: event.occurredAt || new Date().toISOString(), ...event };
  await getPool().query(`INSERT INTO part21_assurance_events (id, event_type, occurred_at, actor, audit_id, entity_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`, [persisted.id, persisted.type, persisted.occurredAt, persisted.actor, persisted.auditId ?? null, persisted.entityId ?? null, JSON.stringify(persisted.payload)]);
  return persisted;
}

export async function listAssuranceEvents(filters: { type?: string; entityId?: string; auditId?: string } = {}) {
  await ensureStore();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.type) { clauses.push("event_type=?"); params.push(filters.type); }
  if (filters.entityId) { clauses.push("entity_id=?"); params.push(filters.entityId); }
  if (filters.auditId) { clauses.push("audit_id=?"); params.push(filters.auditId); }
  const [rows] = await getPool().query<any[]>(`SELECT id, event_type AS type, occurred_at AS occurredAt, actor, audit_id AS auditId, entity_id AS entityId, payload FROM part21_assurance_events ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY occurred_at ASC`, params);
  return rows.map((row) => ({ ...row, payload: parsePayload(row.payload) }) as AssuranceEvent);
}

export async function getEventStoreStatus() {
  await ensureStore();
  const [rows] = await getPool().query<any[]>("SELECT COUNT(*) AS count FROM part21_assurance_events");
  return { provider: "mysql append-only event table", durable: true, table: "part21_assurance_events", eventCount: Number(rows[0]?.count ?? 0), productionTarget: "Client-qualified immutable event store with retention controls" };
}
