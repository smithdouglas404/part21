import { createHash, verify as verifySignature } from "node:crypto";
import { canonicalJson, decodeEvidenceBase64, required, sha256, type EvidenceEvent } from "./types";

export type ImmudbCheckpoint = { serverId:string;database:string;txId:string;txHash:string;observedAt:string;source:string;keyId:string;signature:string };
export type ImmudbConfiguration = { endpoint:string;token:string;serverId:string;database:string;maxLinearTransactions:number;timeoutMs:number };
export type CheckpointSignatureAlgorithm = "ed25519" | "ecdsa-p256-sha256";
export type ImmudbProofResult = { provider:"immudb";status:"verified_independent_checkpoint"|"checkpoint_pending";eventId:string;auditId:string;canonicalSha256:string;keyBase64:string;txId:string;checkpoint:ImmudbCheckpoint;entryProof:unknown;linearHeaders:unknown[];verifiedAt:string };
export interface ImmudbAdapter {
  appendCanonicalEvent(event:EvidenceEvent):Promise<ImmudbProofResult>;
  verifyCanonicalEvent(event:EvidenceEvent,txId:string):Promise<ImmudbProofResult>;
}
export type ImmudbHttp = typeof fetch;
class ImmudbHttpError extends Error {
  constructor(public status:number,path:string) { super(`immudb request failed (${status}): ${path}`); }
}
const hash = (bytes:Buffer) => createHash("sha256").update(bytes).digest();
const unsigned = (value:any,name:string) => {
  if ((typeof value === "number" && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) throw new Error(`Invalid exact integer ${name}`);
  const n = BigInt(value); if (n < 0n || n > 0xffffffffffffffffn) throw new Error(`Out-of-range ${name}`); return n;
};
const u64 = (value:any) => { const out = Buffer.alloc(8); out.writeBigUInt64BE(unsigned(value,"uint64")); return out; };
const u16 = (value:number) => { if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error("uint16 out of range"); const out = Buffer.alloc(2);out.writeUInt16BE(value);return out; };
const u32 = (value:number) => { if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("uint32 out of range"); const out = Buffer.alloc(4);out.writeUInt32BE(value);return out; };
const digestBytes = (value:any) => { const bytes = decodeEvidenceBase64(required(value,"proof digest")); if (bytes.length !== 32) throw new Error("Proof digest must be 32 bytes"); return bytes; };
export type ImmudbTxHeader = { id:string|number;prevAlh:string;ts:string|number;nentries:number;eH:string;blTxId?:string|number;blRoot:string;version?:number;metadata?:{ truncatedTxID?:string|number;extra?:string } };
/** Implements the published protocol encoding independently; unknown header versions/metadata fail closed. */
export function immudbHeaderAlh(header:ImmudbTxHeader):Buffer {
  const id = unsigned(header.id,"transaction ID");
  const linked = unsigned(header.blTxId ?? "0","binary tree transaction ID");
  if (id < 1n || linked >= id || !Number.isInteger(header.nentries) || header.nentries < 1) throw new Error("Invalid immudb header");
  const version = header.version ?? 0;
  const metadata:Buffer[] = [];
  if (header.metadata) {
    if (Object.keys(header.metadata).some(k => !["truncatedTxID","extra"].includes(k))) throw new Error("Unsupported immudb transaction metadata");
    if (unsigned(header.metadata.truncatedTxID ?? "0","truncation ID") > 0n) metadata.push(Buffer.from([0]),u64(header.metadata.truncatedTxID));
    if (header.metadata.extra) { const extra = decodeEvidenceBase64(header.metadata.extra); if (extra.length > 256) throw new Error("Unsupported transaction metadata length");metadata.push(Buffer.from([1]),u16(extra.length),extra); }
  }
  const md = Buffer.concat(metadata);
  let counts:Buffer;
  if (version === 0) { if (md.length) throw new Error("Version zero metadata unsupported"); counts = u16(header.nentries); }
  else if (version === 1) counts = Buffer.concat([u16(md.length),md,u32(header.nentries)]);
  else throw new Error("Unsupported immudb transaction header version");
  const inner = hash(Buffer.concat([u64(header.ts),u16(version),counts,digestBytes(header.eH),u64(linked),digestBytes(header.blRoot)]));
  return hash(Buffer.concat([u64(id),digestBytes(header.prevAlh),inner]));
}
export function verifyImmudbEntryInclusion(proof:any,header:ImmudbTxHeader,key:Buffer,value:Buffer):boolean {
  if (!proof || !Number.isInteger(proof.leaf) || !Number.isInteger(proof.width) || proof.width !== header.nentries || proof.leaf < 0 || proof.leaf >= proof.width || !Array.isArray(proof.terms)) return false;
  const encodedKey = Buffer.concat([Buffer.from([0]),key]);
  const encodedValue = Buffer.concat([Buffer.from([0]),value]);
  const version = header.version ?? 0;
  const digest = version === 0 ? hash(Buffer.concat([encodedKey,hash(encodedValue)])) : version === 1 ? hash(Buffer.concat([u16(0),u16(encodedKey.length),encodedKey,hash(encodedValue)])) : null;
  if (!digest) return false;
  let calculated = hash(Buffer.concat([Buffer.from([0]),digest]));
  let index = proof.leaf; let right = proof.width - 1;
  for (const term of proof.terms) {
    const sibling = digestBytes(term);
    calculated = hash(Buffer.concat(index % 2 === 0 && index !== right ? [Buffer.from([1]),calculated,sibling] : [Buffer.from([1]),sibling,calculated]));
    index = Math.floor(index / 2); right = Math.floor(right / 2);
  }
  return index === right && calculated.equals(digestBytes(header.eH));
}

/** Independent checkpoint endpoint uses pinned key/config, never a state returned by the immudb endpoint itself. */
export function createSignedCheckpointLoader(config:{ endpoint:string;bearerToken?:string;publicKeyPem:string;keyId:string;serverId:string;database:string;timeoutMs:number;signatureAlgorithm:CheckpointSignatureAlgorithm },http:ImmudbHttp = fetch) {
  const url = new URL(config.endpoint); if (url.protocol !== "https:") throw new Error("Independent checkpoint endpoint must use HTTPS");
  required(config.publicKeyPem,"trusted checkpoint public key");required(config.keyId,"checkpoint keyId");
  if (!["ed25519","ecdsa-p256-sha256"].includes(config.signatureAlgorithm)) throw new Error("Explicit checkpoint signature algorithm required");
  return async (minimumTxId:string):Promise<ImmudbCheckpoint> => {
    const request = new URL(url);request.searchParams.set("minimumTxId",minimumTxId);request.searchParams.set("database",config.database);request.searchParams.set("serverId",config.serverId);
    const response = await http(request,{ headers:config.bearerToken ? { Authorization:`Bearer ${config.bearerToken}` } : {},signal:AbortSignal.timeout(config.timeoutMs),redirect:"error" });
    if (!response.ok) throw new Error(`Independent checkpoint endpoint failed (${response.status})`);
    const checkpoint = await response.json() as ImmudbCheckpoint;
    const { signature,...payload } = checkpoint;
    if (checkpoint.serverId !== config.serverId || checkpoint.database !== config.database || checkpoint.keyId !== config.keyId || !/^[a-f0-9]{64}$/.test(checkpoint.txHash) || unsigned(checkpoint.txId,"checkpoint ID") < 1n || !Number.isFinite(Date.parse(checkpoint.observedAt))) throw new Error("Trusted checkpoint identity/state mismatch");
    const algorithm = config.signatureAlgorithm === "ed25519" ? null : "sha256";
    if (!verifySignature(algorithm as any,Buffer.from(canonicalJson(payload)),config.publicKeyPem,decodeEvidenceBase64(signature))) throw new Error("Independent checkpoint signature invalid");
    if (checkpoint.source !== config.endpoint) throw new Error("Signed checkpoint source must equal the independently configured endpoint");
    return checkpoint;
  };
}

export function createImmudbRestAdapter(config:ImmudbConfiguration,loadIndependentCheckpoint:(minimumTxId:string)=>Promise<ImmudbCheckpoint>,http:ImmudbHttp = fetch):ImmudbAdapter {
  const endpoint = new URL(required(config.endpoint,"immudb endpoint"));
  if (endpoint.protocol !== "https:") throw new Error("immudb gateway must use HTTPS");
  required(config.token,"immudb selected-database bearer token");required(config.serverId,"immudb serverId");required(config.database,"immudb database");
  if (!Number.isSafeInteger(config.maxLinearTransactions) || config.maxLinearTransactions < 1 || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1) throw new Error("Explicit bounded proof span and request timeout required");
  const request = async (path:string,body?:unknown) => {
    const url = new URL(`${endpoint.toString().replace(/\/$/,"")}${path}`);
    const response = await http(url,{ method:body === undefined ? "GET" : "POST",headers:{ Authorization:`Bearer ${config.token}`,"Content-Type":"application/json" },body:body === undefined ? undefined : canonicalJson(body),signal:AbortSignal.timeout(config.timeoutMs),redirect:"error" });
    if (!response.ok) throw new ImmudbHttpError(response.status,path);
    return response.json();
  };
  const canonical = (event:EvidenceEvent) => {
    const { eventHash,...payload } = event;
    if (sha256(canonicalJson(payload)) !== eventHash) throw new Error("Custody event hash mismatch before immudb submission");
    return Buffer.from(canonicalJson({ schema:"part21-evidence-event-v1",event }));
  };
  const keyFor = (event:EvidenceEvent) => Buffer.from(`part21/events/${encodeURIComponent(event.auditId)}/${encodeURIComponent(event.id)}`);
  const verify = async (event:EvidenceEvent,txId:string):Promise<ImmudbProofResult> => {
    const value = canonical(event); const key = keyFor(event); const exactTx = unsigned(txId,"event transaction ID");
    const checkpoint = await loadIndependentCheckpoint(txId);
    if (checkpoint.serverId !== config.serverId || checkpoint.database !== config.database || !/^[a-f0-9]{64}$/.test(checkpoint.txHash) || !checkpoint.source || !checkpoint.keyId || !checkpoint.signature) throw new Error("Independent trusted checkpoint identity is required");
    if (new URL(checkpoint.source).origin === endpoint.origin) throw new Error("Checkpoint trust must be independent of immudb endpoint");
    const proof = await request("/db/verifiable/get",{ keyRequest:{ key:key.toString("base64"),atTx:txId },proveSinceTx:checkpoint.txId });
    if (!proof.entry || proof.entry.referencedBy || proof.entry.expired || Object.entries(proof.entry.metadata ?? {}).some(([k,v]) => k === "deleted" ? !!v : k === "nonIndexable" ? !!v : k === "expiration" ? v != null : true)) throw new Error("Canonical event references, deletions, expiry or unsupported metadata are prohibited");
    if (unsigned(proof.entry.tx,"entry transaction ID") !== exactTx || !decodeEvidenceBase64(proof.entry.key).equals(key) || !decodeEvidenceBase64(proof.entry.value).equals(value)) throw new Error("immudb exact canonical event/key/transaction mismatch");
    const header:ImmudbTxHeader = proof.verifiableTx?.tx?.header;
    if (!header || unsigned(header.id,"proof header ID") !== exactTx || !verifyImmudbEntryInclusion(proof.inclusionProof,header,key,value)) throw new Error("immudb entry Merkle inclusion proof failed");
    const checkpointTx = unsigned(checkpoint.txId,"checkpoint transaction ID");
    const low = checkpointTx < exactTx ? checkpointTx : exactTx;
    const high = checkpointTx > exactTx ? checkpointTx : exactTx;
    if (high - low > BigInt(config.maxLinearTransactions)) throw new Error("Proof span exceeds configured finite bound; obtain a nearer independent checkpoint");
    let previous:Buffer | undefined; const headers:ImmudbTxHeader[] = [];
    for (let id = low;id <= high;id++) {
      const tx = id === exactTx ? { header } : await request(`/db/tx/${id}`);
      const current = tx.header as ImmudbTxHeader;
      if (!current || unsigned(current.id,"linear header ID") !== id) throw new Error("Missing exact immudb linear transaction header");
      if (previous && !digestBytes(current.prevAlh).equals(previous)) throw new Error("immudb checkpoint linear consistency failed");
      previous = immudbHeaderAlh(current);headers.push(current);
      if (id === checkpointTx && previous.toString("hex") !== checkpoint.txHash) throw new Error("Independent checkpoint ALH mismatch");
    }
    return { provider:"immudb",status:checkpointTx >= exactTx ? "verified_independent_checkpoint" : "checkpoint_pending",eventId:event.id,auditId:event.auditId,canonicalSha256:sha256(value),keyBase64:key.toString("base64"),txId,checkpoint,entryProof:proof,linearHeaders:headers,verifiedAt:checkpoint.observedAt };
  };
  return {
    async appendCanonicalEvent(event) {
      const value = canonical(event); const key = keyFor(event);
      const checkpoint = await loadIndependentCheckpoint("0");
      const existing = async () => request("/db/verifiable/get",{ keyRequest:{ key:key.toString("base64") },proveSinceTx:checkpoint.txId });
      try {
        const prior = await existing();
        return verify(event,String(prior.entry?.tx ?? ""));
      } catch (error) {
        if (!(error instanceof ImmudbHttpError) || error.status !== 404) throw error;
      }
      try {
        const set = await request("/db/verifiable/set",{ setRequest:{ KVs:[{ key:key.toString("base64"),value:value.toString("base64") }],preconditions:[{ keyMustNotExist:{ key:key.toString("base64") } }] },proveSinceTx:checkpoint.txId });
        const txId = String(set.tx?.header?.id ?? "");required(txId,"immudb write transaction ID");
        return verify(event,txId);
      } catch (error) {
        if (!(error instanceof ImmudbHttpError) || error.status !== 409) throw error;
        const prior = await existing();
        return verify(event,String(prior.entry?.tx ?? ""));
      }
    },
    verifyCanonicalEvent:verify,
  };
}
