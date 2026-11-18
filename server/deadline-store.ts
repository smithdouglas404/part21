import { createHash, randomUUID } from "node:crypto";
import { createPool, type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { DEADLINE_SCHEMA_SQL } from "./temporal/schema";
import { approvedSnapshots, deadlineStatuses, evidenceForEvent, initialCaseState, reduceCaseEvent } from "./temporal/domain";
import { requireText } from "./temporal/calendar";
import type { ApplyPart21CaseEventInput, ApprovedSnapshot, CaseState, CommittedCaseEvent, CreatePart21CaseInput, DeadlineNotice, EventApplication, EvidenceRef } from "./temporal/contracts";
export type { CreatePart21CaseInput, ApplyPart21CaseEventInput, CaseState } from "./temporal/contracts";
export type DeadlineStoreDependencies = {
  pool: Pool;
  /** Mandatory on business fact APIs; validate authenticated principal and audit access using tx. */
  authorize?: (input: { auditId: string; actor: string; action: "read" | "create" | "event" }, tx: PoolConnection) => Promise<void>;
  /** Must verify exact active/approved DB revisions, hash, sources and persisted qualified decisions. */
  verifyPolicy?: (snapshots: ApprovedSnapshot[], tx: PoolConnection) => Promise<void>;
  /** Must verify exact audit-scoped vault records/versions and qualified decisions/method/recipient authority. */
  verifyEvidence?: (input: { auditId: string; actor: string; evidence: EvidenceRef[]; request: CreatePart21CaseInput | ApplyPart21CaseEventInput }, tx: PoolConnection) => Promise<void>;
};
export function createDeadlineDatabasePool(env: NodeJS.ProcessEnv = process.env): Pool {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required; no operational fallback");
  return createPool({ uri: env.DATABASE_URL, connectionLimit: 5, timezone: "Z" });
}
function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function json<T>(value: unknown): T { return typeof value === "string" ? JSON.parse(value) as T : value as T; }
async function transaction<T>(deps: DeadlineStoreDependencies, fn: (tx: PoolConnection) => Promise<T>): Promise<T> {
  const tx = await deps.pool.getConnection();
  try { await tx.beginTransaction(); const result = await fn(tx); await tx.commit(); return result; }
  catch (err) { try { await tx.rollback(); } catch { /* preserve the original failure */ } throw err; } finally { tx.release(); }
}
async function authorize(deps: DeadlineStoreDependencies, tx: PoolConnection, auditId: string, actor: string, action: "read" | "create" | "event") {
  requireText(auditId, "auditId"); requireText(actor, "authenticated actor");
  if (!deps.authorize) throw new Error("Deadline authorization adapter is not configured");
  await deps.authorize({ auditId, actor, action }, tx);
}
/** Additive migration is opt-in and is never called by operational APIs. Default only asserts presence. */
export async function ensureDeadlineStore(deps: DeadlineStoreDependencies, options: { applyAdditiveMigration?: boolean } = {}): Promise<void> {
  if (options.applyAdditiveMigration === true) { for (const sql of DEADLINE_SCHEMA_SQL) await deps.pool.query(sql); return; }
  const [rows] = await deps.pool.query<RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('part21_cases','part21_case_events','part21_deadlines','part21_deadline_outbox','part21_deadline_notices')");
  if (rows.length !== DEADLINE_SCHEMA_SQL.length) throw new Error("Deadline schema unavailable; explicit reviewed additive migration required (never automatically applied)");
}
/** Parent migration entry point. Call only from an operator-reviewed migration, never worker startup/request. */
export async function applyDeadlineSchemaMigration(deps: DeadlineStoreDependencies): Promise<void> {
  for (const sql of DEADLINE_SCHEMA_SQL) await deps.pool.query(sql);
}
async function priorRequest(tx: PoolConnection, auditId: string, eventId: string, request: unknown): Promise<CaseState | null> {
  const [rows] = await tx.query<RowDataPacket[]>("SELECT request_sha256,state FROM part21_case_events WHERE audit_id=? AND event_id=?", [auditId, eventId]);
  if (!rows.length) return null;
  if (rows[0].request_sha256 !== digest(request)) throw new Error("Event ID conflict: immutable idempotency key used for different input");
  return json<CaseState>(rows[0].state);
}
async function writeFact(tx: PoolConnection, request: CreatePart21CaseInput | ApplyPart21CaseEventInput, state: CaseState, expectedVersion: number, occurredAt: string): Promise<void> {
  const event: CommittedCaseEvent = { auditId: state.auditId, caseId: state.caseId, eventId: request.eventId, expectedVersion, version: state.version, state };
  await tx.query("INSERT INTO part21_case_events (audit_id,case_id,event_id,expected_version,version,actor,occurred_at,request_sha256,payload,state) VALUES (?,?,?,?,?,?,?,?,?,?)", [state.auditId, state.caseId, request.eventId, expectedVersion, state.version, request.actor, occurredAt, digest(request), JSON.stringify(request), JSON.stringify(state)]);
  for (const deadline of state.deadlines) await tx.query("INSERT INTO part21_deadlines (audit_id,case_id,branch,version,due_at,deadline) VALUES (?,?,?,?,?,?)", [state.auditId, state.caseId, deadline.branch, state.version, deadline.dueAt, JSON.stringify(deadline)]);
  await tx.query("INSERT INTO part21_deadline_outbox (audit_id,case_id,event_id,version,payload) VALUES (?,?,?,?,?)", [state.auditId, state.caseId, request.eventId, state.version, JSON.stringify(event)]);
}
export async function createPart21Case(input: CreatePart21CaseInput, deps: DeadlineStoreDependencies): Promise<CaseState> {
  const state = initialCaseState(input);
  return transaction(deps, async tx => {
    await authorize(deps, tx, input.auditId, input.actor, "create");
    // Serialize create retries and globally prevent a new audit from restarting the same case ID.
    await tx.query("SELECT case_id FROM part21_cases WHERE case_id=? FOR UPDATE", [input.caseId]);
    const prior = await priorRequest(tx, input.auditId, input.eventId, input); if (prior) return prior;
    if (!deps.verifyPolicy || !deps.verifyEvidence) throw new Error("Database policy/evidence verification adapters are required");
    await deps.verifyPolicy(approvedSnapshots(input.policy), tx);
    await deps.verifyEvidence({ auditId: input.auditId, actor: input.actor, evidence: input.discovery.evidence, request: input }, tx);
    await tx.query("INSERT INTO part21_cases (audit_id,case_id,version,state) VALUES (?,?,?,?)", [input.auditId, input.caseId, state.version, JSON.stringify(state)]);
    await writeFact(tx, input, state, 0, input.discovery.documentedAt); return state;
  });
}
export async function applyPart21CaseEvent(input: ApplyPart21CaseEventInput, deps: DeadlineStoreDependencies): Promise<CaseState> {
  return transaction(deps, async tx => {
    await authorize(deps, tx, input.auditId, input.actor, "event");
    const [rows] = await tx.query<RowDataPacket[]>("SELECT state FROM part21_cases WHERE audit_id=? AND case_id=? FOR UPDATE", [input.auditId, input.caseId]);
    if (!rows.length) throw new Error("Part 21 case not found in requested audit");
    const current = json<CaseState>(rows[0].state);
    const prior = await priorRequest(tx, input.auditId, input.eventId, input); if (prior) return current;
    const state = reduceCaseEvent(current, input);
    if (!deps.verifyEvidence) throw new Error("Database evidence/decision verification adapter is required");
    const evidence = evidenceForEvent(input.event);
    if (evidence.length) await deps.verifyEvidence({ auditId: input.auditId, actor: input.actor, evidence, request: input }, tx);
    await tx.query("UPDATE part21_cases SET state=?,version=?,updated_at=CURRENT_TIMESTAMP(3) WHERE audit_id=? AND case_id=? AND version=?", [JSON.stringify(state), state.version, input.auditId, input.caseId, input.expectedVersion]);
    await writeFact(tx, input, state, input.expectedVersion, input.occurredAt); return state;
  });
}
export async function listPart21Cases(auditId: string, deps: DeadlineStoreDependencies, actor: string): Promise<CaseState[]> {
  return transaction(deps, async tx => {
    await authorize(deps, tx, auditId, actor, "read");
    const [rows] = await tx.query<RowDataPacket[]>("SELECT state FROM part21_cases WHERE audit_id=? ORDER BY created_at,case_id", [auditId]);
    return rows.map(row => json<CaseState>(row.state));
  });
}
export async function getDeadlineStatus(input: { auditId: string; caseId: string; actor: string }, deps: DeadlineStoreDependencies) {
  return transaction(deps, async tx => {
    await authorize(deps, tx, input.auditId, input.actor, "read"); requireText(input.caseId, "caseId");
    const [rows] = await tx.query<RowDataPacket[]>("SELECT state,UTC_TIMESTAMP(3) AS as_of FROM part21_cases WHERE audit_id=? AND case_id=?", [input.auditId, input.caseId]);
    if (!rows.length) throw new Error("Part 21 case not found in requested audit");
    const state = json<CaseState>(rows[0].state);
    const asOf = rows[0].as_of instanceof Date ? rows[0].as_of.toISOString() : String(rows[0].as_of);
    const [outbox] = await tx.query<RowDataPacket[]>("SELECT event_id,version,status,attempts,last_error FROM part21_deadline_outbox WHERE audit_id=? AND case_id=? ORDER BY version", [input.auditId, input.caseId]);
    return { source: "mysql-database" as const, auditId: state.auditId, caseId: state.caseId, version: state.version, asOf, deadlines: deadlineStatuses(state, asOf), holds: state.holds, outbox, nrcTransmissionMode: "human-recorded-evidence-only" as const };
  });
}
export async function loadCommittedDeadlineEvent(message: CommittedCaseEvent, deps: DeadlineStoreDependencies): Promise<CommittedCaseEvent> {
  const [rows] = await deps.pool.query<RowDataPacket[]>("SELECT payload FROM part21_deadline_outbox WHERE audit_id=? AND case_id=? AND event_id=?", [message.auditId, message.caseId, message.eventId]);
  if (!rows.length) throw new Error("Committed event does not exist in requested audit/case");
  const saved = json<CommittedCaseEvent>(rows[0].payload);
  if (digest(saved) !== digest(message)) throw new Error("Message differs from immutable committed event");
  return saved;
}
export async function recordDeadlineApplication(message: CommittedCaseEvent, result: EventApplication, deps: DeadlineStoreDependencies): Promise<void> {
  await loadCommittedDeadlineEvent(message, deps);
  if (result.eventId !== message.eventId || result.version !== message.version) throw new Error("Application receipt does not match committed event");
  if (!["applied", "duplicate", "rejected"].includes(result.status)) throw new Error("Invalid application receipt status");
  await deps.pool.query("UPDATE part21_deadline_outbox SET status=?,applied_at=CURRENT_TIMESTAMP(3),last_error=?,lease_token=NULL,lease_until=NULL WHERE audit_id=? AND case_id=? AND event_id=? AND status NOT IN ('applied','rejected')", [result.status === "rejected" ? "rejected" : "applied", result.reason ?? null, message.auditId, message.caseId, message.eventId]);
}
export async function recordDeadlineNotice(notice: DeadlineNotice, deps: DeadlineStoreDependencies): Promise<void> {
  // Notice validity is checked against immutable deadline revisions, not caller prose.
  const [rows] = await deps.pool.query<RowDataPacket[]>("SELECT deadline FROM part21_deadlines WHERE audit_id=? AND case_id=? AND branch=? AND version=?", [notice.auditId, notice.caseId, notice.branch, notice.version]);
  if (!rows.length || json<{ dueAt: string }>(rows[0].deadline).dueAt !== notice.dueAt) throw new Error("Notice has no matching database deadline revision");
  const key = digest([notice.auditId, notice.caseId, notice.branch, notice.dueAt, notice.kind, notice.leadMilliseconds ?? null]);
  await deps.pool.query("INSERT IGNORE INTO part21_deadline_notices (notice_key,audit_id,case_id,branch,due_at,observed_at,payload) VALUES (?,?,?,?,?,?,?)", [key, notice.auditId, notice.caseId, notice.branch, notice.dueAt, notice.observedAt, JSON.stringify(notice)]);
}
export type DeadlineOutboxTransport = { deliver: (event: CommittedCaseEvent, seed: CaseState) => Promise<EventApplication> };
/** Finite batch. Each claim is an atomic conditional lease update, portable to MySQL/TiDB without SKIP LOCKED. */
export async function dispatchDeadlineOutbox(deps: DeadlineStoreDependencies, transport: DeadlineOutboxTransport, options: { limit?: number; leaseSeconds?: number; auditId?: string } = {}) {
  const limit = options.limit ?? 50; const leaseSeconds = options.leaseSeconds ?? 120;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) throw new Error("Invalid outbox batch/lease configuration");
  if (options.auditId !== undefined) requireText(options.auditId, "auditId");
  const token = randomUUID();
  // Read-only candidate selection is intentionally not a locking read. Each subsequent UPDATE is the
  // authority: only one dispatcher can change an unleased row to its token, so no SKIP LOCKED is needed.
  const [candidates] = await deps.pool.query<RowDataPacket[]>(`SELECT o.audit_id,o.event_id FROM part21_deadline_outbox o WHERE o.status IN ('committed','delivered') AND (o.lease_until IS NULL OR o.lease_until<UTC_TIMESTAMP(3)) ${options.auditId ? "AND o.audit_id=?" : ""} AND NOT EXISTS (SELECT 1 FROM part21_deadline_outbox p WHERE p.audit_id=o.audit_id AND p.case_id=o.case_id AND p.version<o.version AND p.status<>'applied') ORDER BY o.created_at,o.version LIMIT ${limit}`, options.auditId ? [options.auditId] : []);
  const events: CommittedCaseEvent[] = [];
  for (const candidate of candidates) {
    const [claim] = await deps.pool.query<ResultSetHeader>(`UPDATE part21_deadline_outbox SET lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ${leaseSeconds} SECOND),attempts=attempts+1 WHERE audit_id=? AND event_id=? AND status IN ('committed','delivered') AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(3))`, [token, candidate.audit_id, candidate.event_id]);
    if (claim.affectedRows !== 1) continue; // Another dispatcher claimed it first.
    const [rows] = await deps.pool.query<RowDataPacket[]>("SELECT payload FROM part21_deadline_outbox WHERE audit_id=? AND event_id=? AND lease_token=?", [candidate.audit_id, candidate.event_id, token]);
    if (rows.length) events.push(json<CommittedCaseEvent>(rows[0].payload));
  }
  const results: { eventId: string; status: string; error?: string }[] = [];
  for (const event of events) {
    try {
      const [rows] = await deps.pool.query<RowDataPacket[]>("SELECT state FROM part21_case_events WHERE audit_id=? AND case_id=? AND version=1", [event.auditId, event.caseId]);
      if (!rows.length) throw new Error("Case genesis missing; recovery cannot invent an initial state");
      const seed = json<CaseState>(rows[0].state); seed.version = 0; seed.deadlines = []; seed.transmissions = []; seed.holds = []; seed.closed = false;
      const applied = await transport.deliver(event, seed);
      // The Activity must have recorded application. Do not label a service Signal acknowledgment applied.
      const [receipt] = await deps.pool.query<RowDataPacket[]>("SELECT status FROM part21_deadline_outbox WHERE audit_id=? AND event_id=?", [event.auditId, event.eventId]);
      if (!receipt.length || !["applied", "rejected"].includes(String(receipt[0].status))) throw new Error("Temporal accepted delivery but database application receipt is missing");
      if (applied.eventId !== event.eventId || applied.version !== event.version) throw new Error("Application result event/version mismatch");
      results.push({ eventId: event.eventId, status: String(receipt[0].status) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.pool.query("UPDATE part21_deadline_outbox SET last_error=?,lease_token=NULL,lease_until=NULL WHERE audit_id=? AND event_id=? AND lease_token=? AND status NOT IN ('applied','rejected')", [message, event.auditId, event.eventId, token]);
      results.push({ eventId: event.eventId, status: "retry-pending", error: message });
    }
  }
  return { attempted: events.length, results };
}
export async function markDeadlineEventDelivered(event: CommittedCaseEvent, deps: DeadlineStoreDependencies): Promise<void> {
  await deps.pool.query("UPDATE part21_deadline_outbox SET status='delivered',delivered_at=CURRENT_TIMESTAMP(3) WHERE audit_id=? AND case_id=? AND event_id=? AND status='committed'", [event.auditId, event.caseId, event.eventId]);
}
/** Stable facade for Express/MCP endpoints. The caller must derive auditId/actor from authenticated scope. */
export function createPart21DeadlineService(deps: DeadlineStoreDependencies) {
  return {
    createCase: (input: CreatePart21CaseInput) => createPart21Case(input, deps),
    applyEvent: (input: ApplyPart21CaseEventInput) => applyPart21CaseEvent(input, deps),
    listCases: (auditId: string, actor: string) => listPart21Cases(auditId, deps, actor),
    getStatus: (input: { auditId: string; caseId: string; actor: string }) => getDeadlineStatus(input, deps),
    dispatchOutbox: (transport: DeadlineOutboxTransport, options?: { limit?: number; leaseSeconds?: number; auditId?: string }) => dispatchDeadlineOutbox(deps, transport, options),
  };
}
