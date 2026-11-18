import { describe, expect, it, vi } from "vitest";
import { createDomainStore, DomainRevisionConflict, getStoreDatabase, type StoreSqlConnection, type StoreSqlDatabase } from "./domain-store";

type Row = { record_type: string; record_id: string; audit_id: string | null; payload: any; content_sha256: string | null; created_at: string; updated_at: string };
// Explicitly test-only records and an in-process SQL simulation, never a runtime fallback.
const clock = "2026-11-18T12:00:00.000Z";
function makeFake(initial: Row[] = []) {
  let rows = new Map(initial.map((row) => [`${row.record_type}/${row.record_id}`, structuredClone(row)]));
  let revisions: any[] = [];
  let events: any[] = [];
  let tail = Promise.resolve();
  const calls: string[] = [];
  let failRevision = false;
  let failEvent = false;
  const execute = async (sql: string, values: unknown[] = [], state = { rows, revisions, events }): Promise<[any, any]> => {
    calls.push(sql);
    if (sql.includes("LIMIT 0")) return [[], []];
    if (sql.includes("UTC_TIMESTAMP")) return [[{ now: clock }], []];
    if (sql.includes("WHERE record_type='audit' AND record_id=?")) return [[state.rows.get(`audit/${values[0]}`)].filter(Boolean), []];
    if (sql.startsWith("SELECT d.*")) {
      const row = state.rows.get(`${values[0]}/${values[1]}`);
      const matching = state.revisions.filter((r) => r.record_type === values[0] && r.record_id === values[1]);
      return [row ? [{ ...row, revision: matching.length ? Math.max(...matching.map((r) => r.revision)) : 0 }] : [], []];
    }
    if (sql.startsWith("SELECT * FROM part21_domain_records")) return [[state.rows.get(`${values[0]}/${values[1]}`)].filter(Boolean), []];
    if (sql.startsWith("SELECT MAX(revision)")) {
      const matching = state.revisions.filter((r) => r.record_type === values[0] && r.record_id === values[1]);
      return [[{ revision: matching.length ? Math.max(...matching.map((r) => r.revision)) : null }], []];
    }
    if (sql.startsWith("SELECT record_id, audit_id, payload")) return [[...state.rows.values()].filter((r) => r.record_type === values[0] && (values.length === 1 || r.audit_id === values[1])), []];
    if (sql.startsWith("SELECT record_id AS recordId, audit_id AS auditId, payload")) return [[...state.rows.values()].filter((r) => r.record_type === "audit").map((r) => ({ recordId: r.record_id, auditId: r.audit_id, payload: r.payload })), []];
    if (sql.startsWith("SELECT audit_id AS auditId, record_type AS recordType, COUNT(*)")) {
      const counts = new Map<string, { auditId: string; recordType: string; count: number }>();
      for (const record of state.rows.values()) if (record.audit_id) {
        const key = `${record.audit_id}/${record.record_type}`;
        const item = counts.get(key) ?? { auditId: record.audit_id, recordType: record.record_type, count: 0 };
        item.count += 1; counts.set(key, item);
      }
      return [[...counts.values()], []];
    }
    if (sql.includes("INTO part21_domain_record_revisions")) {
      if (failRevision) throw new Error("Injected revision failure");
      const [record_type, record_id, revision, audit_id, payload, payload_sha256, content_sha256, recorded_at, recorded_by, provenance] = values;
      state.revisions.push({ record_type, record_id, revision, audit_id, payload: JSON.parse(payload as string), payload_sha256, content_sha256, recorded_at, recorded_by, provenance });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("UPDATE part21_domain_records")) {
      const row = state.rows.get(`${values[3]}/${values[4]}`)!;
      Object.assign(row, { payload: JSON.parse(values[0] as string), content_sha256: values[1], updated_at: (values[2] as Date).toISOString() });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("INSERT INTO part21_domain_records")) {
      const [type, id, audit, payload, hash, created, updated] = values;
      const key = `${type}/${id}`;
      if (state.rows.has(key)) throw new Error("duplicate key");
      state.rows.set(key, { record_type: type as string, record_id: id as string, audit_id: audit as string | null, payload: JSON.parse(payload as string), content_sha256: hash as string | null, created_at: (created as Date).toISOString(), updated_at: (updated as Date).toISOString() });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("SELECT revision, audit_id")) return [state.revisions.filter((r) => r.record_type === values[0] && r.record_id === values[1]), []];
    if (sql.startsWith("INSERT INTO part21_assurance_events")) {
      if (failEvent) throw new Error("Injected event failure");
      const [id, event_type, occurred_at, actor, audit_id, entity_id, payload] = values;
      state.events.push({ id, event_type, occurred_at, actor, audit_id, entity_id, payload: JSON.parse(payload as string) });
      return [{ affectedRows: 1 }, []];
    }
    if (sql === "FAIL") throw new Error("Injected business/outbox failure");
    throw new Error(`Unexpected test SQL: ${sql}`);
  };
  const db: StoreSqlDatabase = {
    query: (sql, values) => execute(sql, values),
    async getConnection() {
      let state: { rows: Map<string, Row>; revisions: any[]; events: any[] };
      let unlock: () => void;
      const connection: StoreSqlConnection = {
        async beginTransaction() { const previous = tail; tail = new Promise<void>((resolve) => { unlock = resolve; }); await previous; state = { rows: structuredClone(rows), revisions: structuredClone(revisions), events: structuredClone(events) }; calls.push("BEGIN"); },
        query: (sql, values) => execute(sql, values, state),
        async commit() { rows = state.rows; revisions = state.revisions; events = state.events; calls.push("COMMIT"); unlock(); },
        async rollback() { calls.push("ROLLBACK"); unlock?.(); },
        release() { calls.push("RELEASE"); },
      };
      return connection;
    },
  };
  return { store: createDomainStore({ database: () => db }), rows: () => rows, revisions: () => revisions, events: () => events, calls, failRevision: () => { failRevision = true; }, failEvent: () => { failEvent = true; } };
}
function row(type: string, id: string, audit: string | null, payload: any): Row {
  return { record_type: type, record_id: id, audit_id: audit, payload, content_sha256: null, created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-02T00:00:00.000Z" };
}
const auditA = row("audit", "test-audit-A", "test-audit-A", { id: "test-audit-A" });
const auditB = row("audit", "test-audit-B", "test-audit-B", { id: "test-audit-B" });
const task = row("agent_conversation", "test-task", "test-audit-A", { auditId: "test-audit-A", turns: ["old"] });

describe("scoped domain store", () => {
  it("never runs DDL on ensure or reads", async () => {
    const fake = makeFake([auditA, task]);
    await fake.store.ensureDomainStore();
    expect(await fake.store.getDomainRecordScoped("agent_conversation", "test-task", "test-audit-A")).toEqual(task.payload);
    expect(fake.calls.every((sql) => sql.startsWith("SELECT"))).toBe(true);
  });
  it("requires audit ownership on task reads and lists; global token reads remain explicit", async () => {
    const fake = makeFake([auditA, auditB, task, row("connect_token", "test-token", null, { id: "test-token" })]);
    await expect(fake.store.getDomainRecord("agent_conversation", "test-task")).rejects.toThrow("auditId is required");
    await expect(fake.store.listDomainRecords("report_approval_task")).rejects.toThrow("auditId is required");
    await expect(fake.store.getDomainRecordScoped("agent_conversation", "test-task", "test-audit-B")).rejects.toThrow("outside");
    expect(await fake.store.getDomainRecord("connect_token", "test-token")).toEqual({ id: "test-token" });
  });
  it("refuses unknown audit and preserves known empty states", async () => {
    const fake = makeFake([auditA]);
    await expect(fake.store.getDomainPortfolio("missing-test-audit")).rejects.toThrow("Unknown audit");
    const portfolio = await fake.store.getDomainPortfolio("test-audit-A");
    expect(portfolio.findings).toEqual([]); expect(portfolio.metrics).toBeNull();
    expect(portfolio.supplierProjection).toMatchObject({ count: 0, sharedGraphSuppliersMerged: false });
    expect(await fake.store.getDomainRecordScoped("finding", "missing-test-finding", "test-audit-A")).toBeNull();
  });
  it("preserves legacy history and commits payload plus immutable revision atomically", async () => {
    const fake = makeFake([auditA, task]);
    const result = await fake.store.writeDomainRecord({ recordType: task.record_type, recordId: task.record_id, auditId: task.audit_id, payload: { auditId: task.audit_id, turns: ["old", "new"] } }, { expectedRevision: 0, actor: "test-principal" });
    expect(result.revision).toBe(1); expect(result.recordedAt).toBe(clock);
    expect(fake.revisions()).toHaveLength(2);
    expect(fake.revisions()[0].payload).toEqual(task.payload);
    expect(fake.revisions()[0].recorded_by).toBeNull();
    expect(fake.revisions()[0].recorded_at.toISOString()).toBe(task.updated_at);
    expect(fake.revisions()[1].recorded_by).toBe("test-principal");
    expect(result.graphProjection.projected).toBe(false);
  });
  it("requires explicit expected revision for legacy wrapper updates", async () => {
    const fake = makeFake([auditA, task]);
    await expect(fake.store.upsertDomainRecord({ recordType: task.record_type, recordId: task.record_id, auditId: task.audit_id, payload: task.payload })).rejects.toThrow("explicit expectedRevision");
    expect(fake.revisions()).toEqual([]);
  });
  it("does not silently move records between audits or accept mismatched payload scope", async () => {
    const fake = makeFake([auditA, auditB, task]);
    await expect(fake.store.writeDomainRecord({ recordType: task.record_type, recordId: task.record_id, auditId: "test-audit-B", payload: { auditId: "test-audit-B" } }, { expectedRevision: 0, actor: "test-principal" })).rejects.toThrow("immutable");
    await expect(fake.store.writeDomainRecord({ recordType: "finding", recordId: "test-new", auditId: "test-audit-A", payload: { auditId: "test-audit-B" } }, { expectedRevision: 0, actor: "test-principal" })).rejects.toThrow("does not match");
    expect(fake.rows().get("agent_conversation/test-task")?.audit_id).toBe("test-audit-A");
  });
  it("rolls back a failed revision append without losing the legacy payload", async () => {
    const fake = makeFake([auditA, task]); fake.failRevision();
    await expect(fake.store.writeDomainRecord({ recordType: task.record_type, recordId: task.record_id, auditId: task.audit_id, payload: { auditId: task.audit_id, turns: ["changed"] } }, { expectedRevision: 0, actor: "test-principal" })).rejects.toThrow("Injected revision failure");
    expect(fake.rows().get("agent_conversation/test-task")?.payload).toEqual(task.payload);
    expect(fake.revisions()).toEqual([]); expect(fake.calls).toContain("ROLLBACK");
  });
  it("allows business/outbox SQL in the same transaction and rolls the entire unit back", async () => {
    const fake = makeFake([auditA]); let closed: any;
    await expect(fake.store.withDomainTransaction(async (transaction) => {
      closed = transaction;
      await fake.store.writeDomainRecord({ recordType: "finding", recordId: "test-new", auditId: "test-audit-A", payload: { auditId: "test-audit-A" } }, { expectedRevision: 0, actor: "test-principal", transaction });
      await transaction.sql.query("FAIL");
    })).rejects.toThrow("business/outbox");
    expect(fake.rows().has("finding/test-new")).toBe(false); expect(closed.active).toBe(false);
    await expect(fake.store.getDomainRecordScoped("finding", "test-new", "test-audit-A", closed)).rejects.toThrow("closed");
  });
  it("serializes concurrent writes and rejects a stale expected revision", async () => {
    const fake = makeFake([auditA, task]);
    const record = { recordType: task.record_type, recordId: task.record_id, auditId: task.audit_id, payload: { auditId: task.audit_id, turns: ["changed"] } };
    const outcomes = await Promise.allSettled([fake.store.writeDomainRecord(record, { expectedRevision: 0, actor: "test-user-one" }), fake.store.writeDomainRecord(record, { expectedRevision: 0, actor: "test-user-two" })]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((item) => item.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DomainRevisionConflict);
    expect(fake.revisions().map((item) => item.revision)).toEqual([0, 1]);
  });
  it("hashes content without pretending bytes are persisted and preserves digest on metadata updates", async () => {
    const fake = makeFake([auditA]);
    const input = { recordType: "evidence", recordId: "test-bytes", auditId: "test-audit-A", payload: { auditId: "test-audit-A" } };
    const created = await fake.store.upsertDomainRecord({ ...input, content: Buffer.from("test original bytes") });
    expect(created.contentSha256).toHaveLength(64); expect(created.bytesPersisted).toBe(false); expect(created).not.toHaveProperty("content");
    const updated = await fake.store.writeDomainRecord(input, { expectedRevision: 1, actor: "test-principal" });
    expect(updated.contentSha256).toBe(created.contentSha256);
  });
  it("supports explicit global identities, approval rules and tokens without audit ownership", async () => {
    const fake = makeFake([auditA, row("person", "test-person", null, { id: "test-person", name: "Test Person", roleId: "test-role", active: true }), row("approval_rule", "test-rule", null, { id: "test-rule", active: true }), row("connect_token", "test-token", null, { id: "test-token", auditId: "test-audit-A" })]);
    expect(await fake.store.listDomainRecords("person")).toEqual([{ id: "test-person", name: "Test Person", roleId: "test-role", active: true }]);
    expect(await fake.store.getDomainRecord("approval_rule", "test-rule")).toEqual({ id: "test-rule", active: true });
    // Token payload auditId is authorization scope, not domain ownership.
    expect(await fake.store.getDomainRecord("connect_token", "test-token")).toEqual({ id: "test-token", auditId: "test-audit-A" });
    const created = await fake.store.upsertDomainRecord({ recordType: "person", recordId: "test-new-person", payload: { id: "test-new-person", name: "New Person" } });
    expect(created.auditId).toBeNull(); expect(created.revision).toBe(1);
    await expect(fake.store.writeDomainRecord({ recordType: "person", recordId: "test-new-person", payload: { id: "test-new-person" }, auditId: "test-audit-A" }, { expectedRevision: 1, actor: "test-admin" })).rejects.toThrow("Global identity");
  });
  it("keeps access grants available for authorization assembly while supporting scoped grants", async () => {
    const fake = makeFake([auditA, row("access_grant", "test-global-grant", null, { id: "test-global-grant", principalId: "test-person", active: true }), row("access_grant", "test-scoped-grant", "test-audit-A", { id: "test-scoped-grant", principalId: "test-person", active: true })]);
    expect((await fake.store.listDomainRecords("access_grant")).map((grant: any) => grant.id)).toEqual(["test-global-grant", "test-scoped-grant"]);
    expect((await fake.store.listDomainRecords("access_grant", "test-audit-A")).map((grant: any) => grant.id)).toEqual(["test-scoped-grant"]);
    expect(await fake.store.getDomainRecordScoped("access_grant", "test-scoped-grant", "test-audit-A")).toEqual({ id: "test-scoped-grant", principalId: "test-person", active: true });
  });
  it("commits the exact domain revision and durable event in one database-clock transaction", async () => {
    const fake = makeFake([auditA]);
    const result = await fake.store.writeDomainRecordWithEvent({ recordType: "finding", recordId: "test-new-finding", auditId: "test-audit-A", payload: { id: "test-new-finding", auditId: "test-audit-A" } }, { expectedRevision: 0, actor: "test-principal" }, { id: "test-primary-event", type: "finding.created", actor: "test-principal", auditId: "test-audit-A", entityId: "test-new-finding", payload: { source: "test" } });
    expect(result.record.revision).toBe(1); expect(result.event.id).toBe("test-primary-event"); expect(result.event.occurredAt).toBe(clock);
    expect(fake.events()).toHaveLength(1); expect(fake.events()[0].id).toBe("test-primary-event"); expect(fake.events()[0].occurred_at.toISOString()).toBe(clock);
    expect(fake.calls.filter((sql) => sql === "COMMIT")).toHaveLength(1);
  });
  it("rolls back the domain row when the same-transaction event fails", async () => {
    const fake = makeFake([auditA]); fake.failEvent();
    await expect(fake.store.writeDomainRecordWithEvent({ recordType: "finding", recordId: "test-new-finding", auditId: "test-audit-A", payload: { id: "test-new-finding", auditId: "test-audit-A" } }, { expectedRevision: 0, actor: "test-principal" }, { id: "test-primary-event", type: "finding.created", actor: "test-principal", auditId: "test-audit-A", entityId: "test-new-finding", payload: {} })).rejects.toThrow("event failure");
    expect(fake.rows().has("finding/test-new-finding")).toBe(false); expect(fake.events()).toEqual([]); expect(fake.calls).toContain("ROLLBACK");
  });
  it("returns actual audit IDs in listAudits without relabeling a first audit", async () => {
    const fake = makeFake([auditA, auditB, row("finding", "test-finding-A", "test-audit-A", { id: "test-finding-A", auditId: "test-audit-A" })]);
    const audits = await fake.store.listAudits();
    expect(audits.map((audit: any) => audit.id)).toEqual(["test-audit-A", "test-audit-B"]);
    expect(audits[0]).toMatchObject({ recordId: "test-audit-A", auditId: "test-audit-A", findings: 1 });
  });
  it("allows admin audit reads by exact ID but not unscoped operational records", async () => {
    const fake = makeFake([auditA, auditB, task]);
    expect((await fake.store.listDomainRecords("audit")).map((audit: any) => audit.id)).toEqual(["test-audit-A", "test-audit-B"]);
    expect(await fake.store.getDomainRecord("audit", "test-audit-A")).toEqual({ id: "test-audit-A" });
    await expect(fake.store.listDomainRecords("finding")).rejects.toThrow("auditId is required");
  });
  it("fails visibly with no configured database", () => {
    const original = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
    try { expect(() => getStoreDatabase()).toThrow("DATABASE_URL is required"); } finally { if (original !== undefined) process.env.DATABASE_URL = original; }
  });
});
