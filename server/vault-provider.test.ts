import { createHash,generateKeyPairSync,sign } from "node:crypto";
import { describe,it,expect,vi } from "vitest";
import { createSignedCheckpointLoader,createImmudbRestAdapter,immudbHeaderAlh,verifyImmudbEntryInclusion,type ImmudbTxHeader } from "./vault/immudb";
import { createS3ObjectLockAdapter } from "./vault/s3-object-lock";
import { canonicalJson,sha256,type EvidenceAsset,type EvidenceEvent } from "./vault/types";

const b64 = (value:Buffer) => value.toString("base64");
const hash = (value:Buffer) => createHash("sha256").update(value).digest();
const u16 = (value:number) => { const b = Buffer.alloc(2);b.writeUInt16BE(value);return b; };
function entryDigest(key:Buffer,value:Buffer,version = 1) {
  const encodedKey = Buffer.concat([Buffer.from([0]),key]);const encodedValue = Buffer.concat([Buffer.from([0]),value]);
  return version === 1 ? hash(Buffer.concat([u16(0),u16(encodedKey.length),encodedKey,hash(encodedValue)])) : hash(Buffer.concat([encodedKey,hash(encodedValue)]));
}
function syntheticHeader(id:number,key:Buffer,value:Buffer,version = 1):ImmudbTxHeader {
  const digest = entryDigest(key,value,version);const eH = hash(Buffer.concat([Buffer.from([0]),digest]));
  const zero = Buffer.alloc(32);
  return { id,prevAlh:b64(zero),ts:1700000000,nentries:1,eH:b64(eH),blTxId:0,blRoot:b64(zero),version };
}
const event:EvidenceEvent = { id:"test-event-1",type:"evidence.original_preserved",auditId:"test-audit",entityId:"test-asset",actor:"test-actor",occurredAt:"2026-11-18T12:00:00.000Z",revision:1,payload:{ sha256:"a".repeat(64) },previousHash:null,eventHash:"" };
event.eventHash = sha256(canonicalJson((({ eventHash:_hash,...rest }) => rest)(event)));
const canonicalValue = Buffer.from(canonicalJson({ schema:"part21-evidence-event-v1",event }));
const key = Buffer.from(`part21/events/${encodeURIComponent(event.auditId)}/${encodeURIComponent(event.id)}`);

function checkpointFixture(txId:number,txHash:string) {
  const { publicKey,privateKey } = generateKeyPairSync("ed25519");
  const payload = { serverId:"test-server",database:"test-db",txId:String(txId),txHash,observedAt:"2026-11-18T12:01:00.000Z",keyId:"test-key",source:"https://checkpoint.example.test/state" };
  const signature = sign(null,Buffer.from(canonicalJson(payload)),privateKey).toString("base64");
  return { publicKey:publicKey.export({ type:"spki",format:"pem" }).toString(),checkpoint:{ ...payload,signature } };
}
describe("independently verified immudb protocol integration",() => {
  it("rejects a tampered checkpoint signature",async () => {
    const { publicKey,checkpoint } = checkpointFixture(2,"b".repeat(64));
    const http = vi.fn(async () => new Response(JSON.stringify({ ...checkpoint,txHash:"c".repeat(64) }),{ status:200 }));
    const loader = createSignedCheckpointLoader({ endpoint:"https://checkpoint.example.test/state",publicKeyPem:publicKey,keyId:"test-key",serverId:"test-server",database:"test-db",timeoutMs:1000,signatureAlgorithm:"ed25519" },http as any);
    await expect(loader("2")).rejects.toThrow("signature invalid");
  });
  it("verifies exact canonical entry, independent signed checkpoint and finite linear chain",async () => {
    const header = syntheticHeader(2,key,canonicalValue);const { publicKey,checkpoint } = checkpointFixture(2,immudbHeaderAlh(header).toString("hex"));
    const http = vi.fn(async (url:URL,init?:RequestInit) => {
      expect(init?.redirect).toBe("error");
      if (url.hostname === "checkpoint.example.test") return new Response(JSON.stringify(checkpoint),{ status:200 });
      if (url.pathname === "/db/verifiable/get") return new Response(JSON.stringify({ entry:{ key:b64(key),value:b64(canonicalValue),tx:"2",revision:"1" },verifiableTx:{ tx:{ header } },inclusionProof:{ leaf:0,width:1,terms:[] } }),{ status:200 });
      throw new Error(`Unexpected endpoint ${url}`);
    });
    const loader = createSignedCheckpointLoader({ endpoint:"https://checkpoint.example.test/state",publicKeyPem:publicKey,keyId:"test-key",serverId:"test-server",database:"test-db",timeoutMs:1000,signatureAlgorithm:"ed25519" },http as any);
    const adapter = createImmudbRestAdapter({ endpoint:"https://immudb.example.test",token:"selected-db-token",serverId:"test-server",database:"test-db",maxLinearTransactions:10,timeoutMs:1000 },loader,http as any);
    const proof = await adapter.verifyCanonicalEvent(event,"2");expect(proof.status).toBe("verified_independent_checkpoint");expect(proof.canonicalSha256).toBe(sha256(canonicalValue));
  });
  it("fails when a proof replaces canonical payload or exceeds finite span",async () => {
    const header = syntheticHeader(5,key,canonicalValue);const { publicKey,checkpoint } = checkpointFixture(9,immudbHeaderAlh(header).toString("hex"));
    const http = vi.fn(async (url:URL) => url.hostname === "checkpoint.example.test" ? new Response(JSON.stringify(checkpoint),{ status:200 }) : new Response(JSON.stringify({ entry:{ key:b64(key),value:b64(Buffer.from("different")),tx:"5" },verifiableTx:{ tx:{ header } },inclusionProof:{ leaf:0,width:1,terms:[] } }),{ status:200 }));
    const loader = createSignedCheckpointLoader({ endpoint:"https://checkpoint.example.test/state",publicKeyPem:publicKey,keyId:"test-key",serverId:"test-server",database:"test-db",timeoutMs:1000,signatureAlgorithm:"ed25519" },http as any);
    const adapter = createImmudbRestAdapter({ endpoint:"https://immudb.example.test",token:"selected-db-token",serverId:"test-server",database:"test-db",maxLinearTransactions:2,timeoutMs:1000 },loader,http as any);
    await expect(adapter.verifyCanonicalEvent(event,"5")).rejects.toThrow("canonical event");
  });
  it("rejects malformed/forged inclusion proof instead of calling a hash notarization",() => {
    const header = syntheticHeader(1,key,canonicalValue);expect(verifyImmudbEntryInclusion({ leaf:0,width:1,terms:[] },header,key,canonicalValue)).toBe(true);expect(verifyImmudbEntryInclusion({ leaf:0,width:1,terms:[] },header,key,Buffer.from("tampered"))).toBe(false);
  });
});
function asset():EvidenceAsset { return { assetId:"asset-1",auditId:"audit-1",ownerType:"kanban_item",ownerId:"card-1",revision:1,filename:"x",mediaType:"x",sizeBytes:5,sha256:sha256(Buffer.from("bytes")),representation:"original",originalStatus:"present",actor:"test-actor",recordedAt:"2026-11-18T12:00:00.000Z",retention:{ status:"assigned",policyId:"p",policyRevision:"1",sourceIds:["s"],triggerEventId:"e",triggerAt:"2026-11-18T12:00:00.000Z",retainUntil:"2031-11-18T12:00:00.000Z",legalHold:false },storageStatus:"db_preserved_not_vaulted" }; }
describe("S3 exact-version Object Lock adapter",() => {
  it("verifies versioning, exact VersionId, digest, retention and hold before protected status",async () => {
    const bytes = Buffer.from("bytes");const resultAsset = asset();let uploaded:any;
    const sender = { send:vi.fn(async (command:any) => {
      const name = command.constructor.name;
      if (name === "GetBucketVersioningCommand") return { Status:"Enabled" };
      if (name === "GetObjectLockConfigurationCommand") return { ObjectLockConfiguration:{ ObjectLockEnabled:"Enabled" } };
      if (name === "PutObjectCommand") { uploaded = command.input;return { VersionId:"exact-version-7" }; }
      if (name === "GetObjectCommand") return { VersionId:command.input.VersionId,Body:{ transformToByteArray:async () => bytes } };
      if (name === "GetObjectRetentionCommand") return { Retention:{ Mode:"COMPLIANCE",RetainUntilDate:new Date("2031-11-18T12:00:00.000Z") } };
      if (name === "GetObjectLegalHoldCommand") return { LegalHold:{ Status:"OFF" } };
      throw new Error(name);
    }) };
    const adapter = createS3ObjectLockAdapter({ provider:"maintained-test-provider",region:"test-region",bucket:"test-bucket",credentials:{ accessKeyId:"test-access",secretAccessKey:"test-secret" },mode:"COMPLIANCE" },sender);
    const ref = await adapter.protect(resultAsset,bytes);
    expect(ref.versionId).toBe("exact-version-7");expect(uploaded.ChecksumSHA256).toBeTruthy();expect(uploaded.ObjectLockMode).toBe("COMPLIANCE");expect((await adapter.verify({ ...resultAsset,external:ref })).sha256).toBe(resultAsset.sha256);
  });
  it("refuses a missing bucket versioning control before claiming protection",async () => {
    const sender = { send:vi.fn(async (command:any) => command.constructor.name === "GetBucketVersioningCommand" ? { Status:"Suspended" } : { ObjectLockConfiguration:{ ObjectLockEnabled:"Enabled" } }) };
    const adapter = createS3ObjectLockAdapter({ provider:"maintained-test-provider",region:"test-region",bucket:"test-bucket",credentials:{ accessKeyId:"test-access",secretAccessKey:"test-secret" },mode:"COMPLIANCE" },sender);
    await expect(adapter.protect(asset(),Buffer.from("bytes"))).rejects.toThrow("versioning");
  });
  it("requires HTTPS configured endpoints and never silently selects a retention mode",() => {
    expect(() => createS3ObjectLockAdapter({ provider:"p",region:"r",bucket:"b",endpoint:"http://insecure.example",credentials:{ accessKeyId:"a",secretAccessKey:"s" },mode:"COMPLIANCE" })).toThrow("HTTPS");
    expect(() => createS3ObjectLockAdapter({ provider:"p",region:"r",bucket:"b",credentials:{ accessKeyId:"a",secretAccessKey:"s" },mode:"WORM" as any })).toThrow("retention mode");
  });
});
