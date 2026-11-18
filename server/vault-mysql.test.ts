import { describe,it,expect } from "vitest";
import { createMysqlEvidenceRepository,type EvidenceSqlPool } from "./vault/mysql-store";
import { canonicalJson,sha256,type AssetWrite } from "./vault/types";

type State = {
  records: Map<string,{auditId:string|null,payload:string}>;
  revisions: Map<string,{revision:number,payload:string}>;
  assets: Map<string,{metadata:string,bytes:Buffer|null,externalStatus:string,externalReference:string|null,externalError:string|null}>;
  streams: Map<string,{lastRevision:number,lastHash:string|null}>;
  events: Map<string,{id:string,auditId:string,entityId:string,revision:number,type:string,actor:string,occurredAt:string,payload:string,previousHash:string|null,eventHash:string}>;
  assurance: Map<string,{id:string,type:string,occurredAt:string,actor:string,auditId:string,entityId:string,payload:string}>;
  proofs: Map<string,{proof:string,verifiedAt:string}>;
};
const clone = <T>(value:T):T => {
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value instanceof Map) return new Map([...value.entries()].map(([k,v]) => [k,clone(v)])) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,clone(v)])) as T;
  return value;
};
const fresh = ():State => ({ records:new Map(),revisions:new Map(),assets:new Map(),streams:new Map(),events:new Map(),assurance:new Map(),proofs:new Map() });
function fakePool() {
  let committed = fresh();let active:State|null = null;
  const state = () => active ?? committed;
  const query = async (sql:string,values:any[] = []) => {
    const s = state();
    if (sql.startsWith("SELECT DATE_FORMAT")) return [[{ now:"2026-11-18T12:00:00.123456Z" }],[]];
    if (sql.includes("record_type='audit' AND record_id=?")) {
      const row = s.records.get(`audit/${values[0]}`);
      if (!row || (row.auditId !== values[1] && row.auditId !== null)) return [[],[]];
      return [[{ record_id:values[0] }],[]];
    }
    if (sql.startsWith("SELECT payload FROM part21_domain_records WHERE record_type=? AND record_id=? AND audit_id=?")) {
      const row = s.records.get(`${values[0]}/${values[1]}`);
      if (!row || row.auditId !== values[2]) return [[],[]];
      return [[{ payload:row.payload }],[]];
    }
    if (sql.startsWith("SELECT audit_id,payload FROM part21_domain_records")) {
      const row = s.records.get(`${values[0]}/${values[1]}`);return [row ? [{ audit_id:row.auditId,payload:row.payload }] : [],[]];
    }
    if (sql.startsWith("SELECT MAX(revision)")) {
      const rows = [...s.revisions.entries()].filter(([key]) => key.startsWith(`${values[0]}/${values[1]}/${values[2]}/`)).map(([,v]) => v.revision);return [[{ revision:rows.length ? Math.max(...rows) : null }],[]];
    }
    if (sql.startsWith("INSERT INTO part21_record_revisions")) {
      s.revisions.set(`${values[0]}/${values[1]}/${values[2]}/${values[3]}`,{ revision:values[3],payload:values[4] });return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("UPDATE part21_domain_records")) {
      const row = s.records.get(`${values[1]}/${values[2]}`);if (row) { row.payload = values[0];return [{ affectedRows:1 },[]]; }return [{ affectedRows:0 },[]];
    }
    if (sql.startsWith("INSERT INTO part21_domain_records")) {
      s.records.set(`${values[0]}/${values[1]}`,{ auditId:values[2],payload:values[3] });return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("INSERT INTO part21_evidence_versions")) {
      s.assets.set(`${values[0]}/${values[1]}/${values[2]}`,{ metadata:values[8],bytes:Buffer.from(values[5]),externalStatus:values[9],externalReference:null,externalError:null });return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("SELECT metadata,original_bytes")) {
      const prefix = `${values[0]}/${values[1]}/`;const key = values[2] === undefined ? [...s.assets.keys()].filter(k => k.startsWith(prefix)).sort().at(-1) : `${prefix}${values[2]}`;const row = key ? s.assets.get(key) : undefined;
      return [row ? [{ metadata:row.metadata,original_bytes:row.bytes,external_status:row.externalStatus,external_reference:row.externalReference,external_error:row.externalError }] : [],[]];
    }
    if (sql.startsWith("INSERT IGNORE INTO part21_evidence_streams")) {
      const key = `${values[0]}/${values[1]}`;if (!s.streams.has(key)) s.streams.set(key,{ lastRevision:0,lastHash:null });return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("SELECT last_revision,last_hash")) {
      const row = s.streams.get(`${values[0]}/${values[1]}`);return [[{ last_revision:row?.lastRevision ?? 0,last_hash:row?.lastHash ?? null }],[]];
    }
    if (sql.startsWith("INSERT INTO part21_evidence_events")) {
      s.events.set(values[0],{ id:values[0],auditId:values[1],entityId:values[2],revision:values[3],type:values[4],actor:values[5],occurredAt:values[6],payload:values[7],previousHash:values[8],eventHash:values[9] });return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("INSERT INTO part21_assurance_events")) {
      s.assurance.set(values[0],{ id:values[0],type:values[1],occurredAt:values[2],actor:values[3],auditId:values[4],entityId:values[5],payload:values[6] });return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("UPDATE part21_evidence_streams")) {
      const key = `${values[2]}/${values[3]}`;s.streams.set(key,{ lastRevision:values[0],lastHash:values[1] });return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("UPDATE part21_evidence_versions")) {
      const key = `${values[3]}/${values[4]}/${values[5]}`;const row = s.assets.get(key);if (!row) return [{ affectedRows:0 },[]];row.externalStatus = values[0];row.externalReference = values[1] ?? row.externalReference;row.externalError = values[2];return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("SELECT payload FROM part21_domain_records WHERE record_type=? AND audit_id=?")) {
      return [[...s.records.entries()].filter(([key,row]) => key.startsWith(`${values[0]}/`) && row.auditId === values[1]).map(([,row]) => ({ payload:row.payload })),[]];
    }
    if (sql.startsWith("SELECT id,event_type AS type")) {
      return [[...s.events.values()].filter(e => e.auditId === values[0] && e.entityId === values[1]).sort((a,b) => a.revision-b.revision).map(e => ({ id:e.id,type:e.type,auditId:e.auditId,entityId:e.entityId,revision:e.revision,actor:e.actor,occurredAt:e.occurredAt,payload:e.payload,previousHash:e.previousHash,eventHash:e.eventHash })),[]];
    }
    if (sql.startsWith("SELECT COUNT(*)")) {
      const rows = [...s.assets.entries()].filter(([key]) => key.split("/")[1] === values[0]).map(([,row]) => row);
      return [[{ versions:rows.length,preserved:rows.filter(r => !!r.bytes).length,protected:rows.filter(r => r.externalStatus === "protected_verified").length,failed:rows.filter(r => r.externalStatus === "external_failed").length }],[]];
    }
    if (sql.startsWith("INSERT INTO part21_evidence_proofs")) {
      s.proofs.set(`${values[0]}/${values[1]}/${values[2]}`,{ proof:values[3],verifiedAt:values[4] });return [{ affectedRows:1 },[]];
    }
    if (sql.startsWith("SELECT proof FROM part21_evidence_proofs")) {
      const row = s.proofs.get(`${values[0]}/${values[1]}/${values[2]}`);return [row ? [{ proof:row.proof }] : [],[]];
    }
    throw new Error(`Unhandled SQL in test fake: ${sql}`);
  };
  const pool:EvidenceSqlPool = {
    query:async (sql,values) => query(sql,values),
    getConnection:async () => ({
      query:async (sql,values) => query(sql,values),
      beginTransaction:async () => { active = clone(committed); },
      commit:async () => { if (active) committed = active;active = null; },
      rollback:async () => { active = null; },
      release:() => {},
    }),
  };
  return { pool,state:() => committed };
}
const asset = ():AssetWrite => ({ assetId:"asset-1",auditId:"test-audit",ownerType:"kanban_item",ownerId:"card-1",revision:1,filename:"x.bin",mediaType:"application/octet-stream",bytes:Buffer.from([0,255,1,2]),actor:"test-actor",representation:"original",originalStatus:"present",retention:{ status:"unknown",sourceIds:[],legalHold:false } });
describe("MySQL evidence repository SQL path",() => {
  it("inserts LONGBLOB bytes, reads exact bytes back, and commits revision/event atomically",async () => {
    const { pool,state } = fakePool();const repo = createMysqlEvidenceRepository(pool);
    state().records.set("audit/test-audit",{ auditId:"test-audit",payload:canonicalJson({ id:"test-audit" }) });
    state().records.set("kanban_item/card-1",{ auditId:"test-audit",payload:canonicalJson({ id:"card-1",auditId:"test-audit" }) });
    const result = await repo.transaction(async tx => {
      await tx.requireAudit("test-audit");
      const stored = await tx.putAsset(asset());
      const event = await tx.appendEvent({ type:"evidence.original_preserved",auditId:"test-audit",entityId:"asset-1",actor:"test-actor",revision:1,payload:{ sha256:stored.sha256 } });
      return { stored,event };
    });
    expect(result.stored.sha256).toBe(sha256(Buffer.from([0,255,1,2])));expect(state().assets.get("asset-1/test-audit/1")?.bytes?.equals(Buffer.from([0,255,1,2]))).toBe(true);
    expect(state().assurance.get(result.event.id)?.id).toBe(result.event.id);expect(state().events.size).toBe(1);
    const read = await repo.transaction(tx => tx.getAsset("asset-1","test-audit"));expect(read?.bytes?.equals(Buffer.from([0,255,1,2]))).toBe(true);
    expect((await repo.status("test-audit")).preserved).toBe(1);
  });
  it("rejects cross-audit record reassignment and rolls back failed transactions",async () => {
    const { pool,state } = fakePool();const repo = createMysqlEvidenceRepository(pool);
    state().records.set("kanban_item/card-1",{ auditId:"other-audit",payload:canonicalJson({ id:"card-1",auditId:"other-audit" }) });
    await expect(repo.transaction(async tx => { await tx.putRecord("kanban_item","card-1","test-audit",{ title:"hijack" },"test-actor"); })).rejects.toThrow("reassignment");
    expect(state().revisions.size).toBe(0);
  });
  it("chains event revisions and mirror IDs, and persists proofs",async () => {
    const { pool,state } = fakePool();const repo = createMysqlEvidenceRepository(pool);
    const first = await repo.transaction(tx => tx.appendEvent({ type:"evidence.received",auditId:"test-audit",entityId:"asset-1",actor:"test-actor",revision:1,payload:{ step:1 } }));
    const second = await repo.transaction(tx => tx.appendEvent({ type:"evidence.reviewed",auditId:"test-audit",entityId:"asset-1",actor:"test-actor",revision:1,payload:{ step:2 } }));
    expect(first.revision).toBe(1);expect(second.revision).toBe(2);expect(second.previousHash).toBe(first.eventHash);
    const events = await repo.timeline("test-audit","asset-1");expect(events.map(e => e.revision)).toEqual([1,2]);expect(events[0].occurredAt).toBe("2026-11-18T12:00:00.123Z");
    await repo.saveProof(first.id,"test-audit","immudb",{ txId:"9" },"2026-11-18T12:01:00.000Z");expect(await repo.getProof(first.id,"test-audit","immudb")).toEqual({ txId:"9" });
    expect(state().events.size).toBe(2);
  });
});
