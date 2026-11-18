// TEST ONLY: never imported by production modules; no production memory/database fallback exists.
import { vi } from "vitest";
import { canonicalJson, sha256, type AssetWrite, type DomainPayload, type EvidenceAsset, type EvidenceEvent, type EvidenceRepository, type EvidenceTransaction } from "./types";
import { createEvidenceVaultService } from "../evidence-vault";
const clone = <T>(value:T):T => JSON.parse(JSON.stringify(value));
export function evidenceTestHarness() {
  let records = new Map<string,DomainPayload>();
  let assets = new Map<string,{ asset:EvidenceAsset;bytes:Buffer|null }>();
  let events:EvidenceEvent[] = [];
  let proofs = new Map<string,Record<string,unknown>>();
  let sequence = 0;
  let failEvent = false;
  let serial = Promise.resolve();
  const recordKey = (type:string,id:string) => `${type}/${id}`;
  const assetKey = (id:string,auditId:string,revision:number) => `${auditId}/${id}/${revision}`;
  const clock = "2026-11-18T12:00:00.000Z";
  const tx:EvidenceTransaction = {
    now:vi.fn(async () => clock),
    async requireAudit(auditId) { if (!records.has(recordKey("audit",auditId))) throw new Error("Audit missing"); },
    async getRecord(type,id,auditId) { const record = records.get(recordKey(type,id));return record?.auditId === auditId ? clone(record) : null; },
    async putRecord(type,id,auditId,payload,actor,expectedRevision) {
      const prior = records.get(recordKey(type,id));
      if (prior && prior.auditId !== auditId) throw new Error("Record belongs to a different audit");
      const previous = prior?.recordRevision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== previous) throw new Error("Record revision conflict");
      const updated = { ...clone(payload),auditId,recordRevision:previous + 1,updatedAt:clock };
      records.set(recordKey(type,id),updated);return clone(updated);
    },
    async putAsset(input:AssetWrite) {
      const { bytes,external:_untrustedExternal,externalError:_untrustedExternalError,...fields } = input;
      const asset:EvidenceAsset = { ...clone(fields),sizeBytes:bytes.length,sha256:sha256(bytes),recordedAt:clock,storageStatus:"db_preserved_not_vaulted" };
      const key = assetKey(asset.assetId,asset.auditId,asset.revision);
      if (assets.has(key)) throw new Error("Immutable asset revision already exists");
      assets.set(key,{ asset,bytes:Buffer.from(bytes) });return clone(asset);
    },
    async getAsset(id,auditId,revision) {
      const candidates = [...assets.values()].filter(a => a.asset.assetId === id && a.asset.auditId === auditId && (revision === undefined || a.asset.revision === revision)).sort((a,b) => b.asset.revision-a.asset.revision);
      return candidates[0] ? { asset:clone(candidates[0].asset),bytes:candidates[0].bytes ? Buffer.from(candidates[0].bytes) : null } : null;
    },
    async appendEvent(input) {
      if (failEvent) throw new Error("Injected communication ledger failure");
      const stream = events.filter(e => e.auditId === input.auditId && e.entityId === input.entityId);
      const event = { ...clone(input),id:`test-event-${++sequence}`,occurredAt:clock,revision:stream.length + 1,previousHash:stream.at(-1)?.eventHash ?? null };
      const full = { ...event,eventHash:sha256(canonicalJson(event)) };events.push(full);return clone(full);
    },
    async recordExternal(id,auditId,revision,result) {
      const stored = assets.get(assetKey(id,auditId,revision));if (!stored) throw new Error("Asset missing");
      stored.asset = { ...stored.asset,external:result.external ?? stored.asset.external,externalError:result.error,storageStatus:result.error ? "external_failed" : result.external ? "protected_verified" : "external_pending" };
    },
  };
  const repository:EvidenceRepository = {
    transaction:vi.fn(async fn => {
      const previousJob = serial;let finish!:()=>void;serial = new Promise(resolve => { finish = resolve; });await previousJob;
      const oldRecords = new Map([...records].map(([key,value]) => [key,clone(value)]));
      const oldAssets = new Map([...assets].map(([key,value]) => [key,{ asset:clone(value.asset),bytes:value.bytes ? Buffer.from(value.bytes) : null }]));
      const oldEvents = clone(events);
      try { return await fn(tx); } catch (error) { records = oldRecords;assets = oldAssets;events = oldEvents;throw error; } finally { finish(); }
    }),
    async listRecords(type,auditId) { return [...records].filter(([key,value]) => key.startsWith(`${type}/`) && value.auditId === auditId).map(([,value]) => clone(value)); },
    async timeline(auditId,entityId) { return events.filter(e => e.auditId === auditId && e.entityId === entityId).map(clone); },
    async status(auditId) { const versions = [...assets.values()].filter(a => a.asset.auditId === auditId);return { versions:versions.length,preserved:versions.filter(a => !!a.bytes).length,protected:versions.filter(a => a.asset.storageStatus === "protected_verified").length,failed:versions.filter(a => a.asset.storageStatus === "external_failed").length }; },
    async saveProof(eventId,auditId,provider,proof) { proofs.set(`${auditId}/${eventId}/${provider}`,clone(proof)); },
    async getProof(eventId,auditId,provider) { return proofs.get(`${auditId}/${eventId}/${provider}`) ?? null; },
  };
  const authorize = vi.fn(async (principal:{id:string},auditId:string,_action:string) => { if (principal.id !== "test-actor" || !records.has(recordKey("audit",auditId))) throw new Error("Unauthorized"); });
  const deps = { repository,authorize,resolvePrincipal:async () => ({ id:"test-actor" }) };
  const vault = createEvidenceVaultService(deps);
  return { repository,tx,authorize,vault,deps,seed(type:string,id:string,auditId:string,payload:DomainPayload = {}) { records.set(recordKey(type,id),{ ...payload,id,auditId }); },records:() => records,assets:() => assets,events:() => events,failEvents(value:boolean) { failEvent = value; },tamper(id:string,auditId:string) { const asset = [...assets.values()].find(a => a.asset.assetId === id && a.asset.auditId === auditId);if (asset) asset.bytes = Buffer.from("tampered"); } };
}
