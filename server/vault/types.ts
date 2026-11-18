import { createHash } from "node:crypto";
import type { ImmudbAdapter } from "./immudb";

export type EvidencePrincipal = { id: string };
export type EvidenceAction = "read" | "write" | "download" | "hold" | "review";
export type RetentionPolicy = {
  status: "assigned" | "unknown";
  policyId?: string;
  policyRevision?: string;
  sourceIds: string[];
  triggerEventId?: string;
  triggerAt?: string;
  retainUntil?: string;
  legalHold: boolean;
  holdDecisionId?: string;
};
export type ExternalReference = {
  provider: string; bucket: string; key: string; versionId: string;
  mode: "GOVERNANCE" | "COMPLIANCE"; retainUntil: string; legalHold: boolean;
};
export type EvidenceAsset = {
  assetId: string; auditId: string; ownerType: string; ownerId: string; revision: number;
  filename: string; mediaType: string; sizeBytes: number; sha256: string;
  representation: "original" | "derivative";
  derivedFromAssetId?: string; originalStatus: "present" | "original_missing";
  actor: string; recordedAt: string; retention: RetentionPolicy;
  storageStatus: "db_preserved_not_vaulted" | "external_pending" | "external_failed" | "protected_verified" | "original_missing";
  external?: ExternalReference; externalError?: string;
};
export type EvidenceEvent = {
  id: string; type: string; auditId: string; entityId: string; actor: string;
  occurredAt: string; revision: number; payload: Record<string, unknown>;
  previousHash: string | null; eventHash: string;
};
export type AssetWrite = Omit<EvidenceAsset, "sizeBytes" | "sha256" | "recordedAt" | "storageStatus"> & { bytes: Buffer };
export type DomainPayload = Record<string, any>;
export interface EvidenceTransaction {
  now(): Promise<string>;
  getRecord(type: string, id: string, auditId: string, lock?: boolean): Promise<DomainPayload | null>;
  requireAudit(auditId: string): Promise<void>;
  putRecord(type: string, id: string, auditId: string, payload: DomainPayload, actor: string, expectedRevision?: number): Promise<DomainPayload>;
  putAsset(input: AssetWrite): Promise<EvidenceAsset>;
  getAsset(id: string, auditId: string, revision?: number): Promise<{ asset: EvidenceAsset; bytes: Buffer | null } | null>;
  appendEvent(input: Omit<EvidenceEvent, "id" | "occurredAt" | "previousHash" | "eventHash">): Promise<EvidenceEvent>;
  recordExternal(id: string, auditId: string, revision: number, result: { external?: ExternalReference; error?: string }): Promise<void>;
}
export interface EvidenceRepository {
  transaction<T>(fn: (tx: EvidenceTransaction) => Promise<T>): Promise<T>;
  listRecords(type: string, auditId: string): Promise<DomainPayload[]>;
  timeline(auditId: string, entityId: string): Promise<EvidenceEvent[]>;
  status(auditId: string): Promise<{ versions: number; preserved: number; protected: number; failed: number }>;
  saveProof(eventId: string, auditId: string, provider: string, proof: Record<string, unknown>, verifiedAt: string): Promise<void>;
  getProof(eventId: string, auditId: string, provider: string): Promise<Record<string, unknown> | null>;
}
export interface ProtectedVault {
  provider: string;
  protect(asset: EvidenceAsset, bytes: Buffer): Promise<ExternalReference>;
  verify(asset: EvidenceAsset): Promise<{ sha256: string; reference: ExternalReference }>;
  updateHold?(asset: EvidenceAsset, legalHold: boolean): Promise<ExternalReference>;
  updatePolicy?(asset: EvidenceAsset): Promise<ExternalReference>;
}
export type EvidenceRuntimeDependencies = {
  repository: EvidenceRepository;
  authorize: (principal: EvidencePrincipal, auditId: string, action: EvidenceAction) => Promise<void>;
  resolvePrincipal?: () => Promise<EvidencePrincipal>;
  loadProtectedVault?: () => Promise<ProtectedVault | null>;
  loadImmudb?: () => Promise<ImmudbAdapter | null>;
  loadRetention?: (auditId: string, ownerType: string, ownerId: string) => Promise<RetentionPolicy | null>;
  authorizeRetentionDecision?: (decision: DomainPayload, asset: EvidenceAsset, principal: EvidencePrincipal, policy: RetentionPolicy) => Promise<void>;
};
export class VaultProtectionError extends Error {
  constructor(message: string, public readonly reference: ExternalReference) { super(message); this.name = "VaultProtectionError"; }
}
export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required; no default operational identity is permitted.`);
  return value;
}
/** Sorted JSON object keys, array order preserved; a versioned application encoding, not a signature. */
export function canonicalJson(value: unknown): string {
  const normalize = (v: any): any => {
    if (v === null || typeof v !== "object") {
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Non-finite canonical value");
      return v;
    }
    if (Array.isArray(v)) return v.map(normalize);
    return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, normalize(v[k])]));
  };
  const encoded = JSON.stringify(normalize(value));
  if (encoded === undefined) throw new Error("Canonical payload is required");
  return encoded;
}
export function decodeEvidenceBase64(input: string): Buffer {
  const raw = input.replace(/^data:[^,]*;base64,/, "");
  if (!raw || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) throw new Error("Valid non-empty canonical base64 bytes are required.");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.toString("base64") !== raw) throw new Error("Non-canonical base64 payload");
  return bytes;
}
export function validateRetention(policy: RetentionPolicy): RetentionPolicy {
  if (typeof policy.legalHold !== "boolean" || !Array.isArray(policy.sourceIds)) throw new Error("Explicit retention and hold policy required");
  if (policy.status === "assigned") {
    required(policy.policyId, "retention policyId"); required(policy.policyRevision, "retention policyRevision");
    required(policy.triggerEventId, "retention triggerEventId");
    if (!policy.sourceIds.length || !policy.triggerAt || !policy.retainUntil || !Number.isFinite(Date.parse(policy.triggerAt)) || !Number.isFinite(Date.parse(policy.retainUntil)) || Date.parse(policy.retainUntil) < Date.parse(policy.triggerAt)) throw new Error("Assigned retention requires actual source IDs, trigger and retain-until times.");
  } else if (policy.status !== "unknown") throw new Error("Unknown retention status");
  if (policy.legalHold) required(policy.holdDecisionId, "holdDecisionId");
  return policy;
}
export const unknownRetention = (): RetentionPolicy => ({ status: "unknown", sourceIds: [], legalHold: false });
