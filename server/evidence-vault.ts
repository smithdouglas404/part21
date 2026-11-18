import { randomUUID } from "node:crypto";
import { getMysqlEvidenceRepository } from "./vault/mysql-store";
import { canonicalJson, required, sha256, unknownRetention, validateRetention, VaultProtectionError, type AssetWrite, type EvidenceAction, type EvidenceAsset, type EvidencePrincipal, type EvidenceRuntimeDependencies, type EvidenceTransaction, type RetentionPolicy } from "./vault/types";
export * from "./vault/types";
export { createMysqlEvidenceRepository } from "./vault/mysql-store";
export { migrateEvidenceVault, evidenceMigrationStatements } from "./vault/migrations";
export { createS3ObjectLockAdapter } from "./vault/s3-object-lock";
export { createImmudbRestAdapter, createSignedCheckpointLoader } from "./vault/immudb";

export function createEvidenceVaultService(deps: EvidenceRuntimeDependencies) {
  const authorize = async (auditId:string,action:EvidenceAction,principal?:EvidencePrincipal) => {
    required(auditId,"auditId");
    const resolved = principal ?? await deps.resolvePrincipal?.();
    if (!resolved?.id) throw new Error("Authenticated evidence principal is required");
    await deps.authorize(resolved,auditId,action);
    return resolved;
  };
  const owner = async (tx:EvidenceTransaction,type:string,id:string,auditId:string,lock = false) => {
    const record = await tx.getRecord(type,id,auditId,lock);
    if (!record || (record.auditId && record.auditId !== auditId)) throw new Error("Record not found in authorized audit");
    return record;
  };
  const retention = async (auditId:string,ownerType:string,ownerId:string,explicit?:RetentionPolicy) => validateRetention(explicit ?? await deps.loadRetention?.(auditId,ownerType,ownerId) ?? unknownRetention());
  const preserve = async (tx:EvidenceTransaction,input:Omit<AssetWrite,"assetId"|"revision"|"retention"> & { assetId?:string;revision?:number;retention?:RetentionPolicy }) => {
    await owner(tx,input.ownerType,input.ownerId,input.auditId,true);
    const policy = await retention(input.auditId,input.ownerType,input.ownerId,input.retention);
    return tx.putAsset({ ...input,assetId:input.assetId ?? `ASSET-${randomUUID()}`,revision:input.revision ?? 1,retention:policy });
  };
  const recordProtection = async (asset:EvidenceAsset,external?:EvidenceAsset["external"],error?:unknown):Promise<EvidenceAsset> => {
    const message = error ? (error instanceof Error ? error.message : String(error)) : undefined;
    const reference = external ?? (error instanceof VaultProtectionError ? error.reference : asset.external);
    const storageStatus = message ? "external_failed" : "protected_verified";
    await deps.repository.transaction(async tx => {
      await tx.recordExternal(asset.assetId,asset.auditId,asset.revision,{ external:reference,error:message });
      for (const type of ["kanban_attachment","evidence","document"]) {
        const record = await tx.getRecord(type,asset.assetId,asset.auditId,true);
        if (record?.assetId === asset.assetId) await tx.putRecord(type,asset.assetId,asset.auditId,{ ...record,storageStatus },asset.actor);
      }
      await tx.appendEvent({ type:message ? "evidence.external_protection_failed" : "evidence.external_protection_verified",auditId:asset.auditId,entityId:asset.assetId,actor:asset.actor,revision:asset.revision,payload:{ assetRevision:asset.revision,sha256:asset.sha256,external:reference ?? null,error:message ?? null,dbBytesPreserved:true } });
    });
    return { ...asset,storageStatus,external:reference,externalError:message };
  };
  const protect = async (asset:EvidenceAsset,bytes:Buffer):Promise<EvidenceAsset> => {
    let adapter;
    try { adapter = await deps.loadProtectedVault?.(); }
    catch (error) {
      try { return await recordProtection(asset,undefined,error); }
      catch { return { ...asset,storageStatus:"external_failed",externalError:error instanceof Error ? error.message : String(error) }; }
    }
    if (!adapter) return asset;
    await authorize(asset.auditId,"write",{ id:asset.actor });
    await deps.repository.transaction(async tx => {
      await owner(tx,asset.ownerType,asset.ownerId,asset.auditId,true);
      await tx.recordExternal(asset.assetId,asset.auditId,asset.revision,{});
    });
    try {
      const reference = await adapter.protect(asset,bytes);
      try { return await recordProtection(asset,reference); }
      catch (error) { return { ...asset,storageStatus:"external_failed",external:reference,externalError:`External object retained but status bookkeeping failed: ${error instanceof Error ? error.message : String(error)}` }; }
    } catch (error) {
      try { return await recordProtection(asset,undefined,error); }
      catch { return { ...asset,storageStatus:"external_failed",externalError:error instanceof Error ? error.message : String(error) }; }
    }
  };
  const read = async (assetId:string,auditId:string,principal?:EvidencePrincipal,revision?:number,action:EvidenceAction = "read") => {
    await authorize(auditId,action,principal);
    const result = await deps.repository.transaction(async tx => {
      await tx.requireAudit(auditId);
      const result = await tx.getAsset(assetId,auditId,revision);
      if (result) {
        await owner(tx,result.asset.ownerType,result.asset.ownerId,auditId);
        const policy = await tx.getRecord("evidence_retention_policy",assetId,auditId);
        if (policy) {
          if (policy.assetRevision !== result.asset.revision) throw new Error("Retention policy belongs to a different asset revision");
          result.asset.retention = validateRetention(policy.retention);
        }
        return result;
      }
      for (const type of ["kanban_attachment","evidence","document"]) {
        const legacy = await tx.getRecord(type,assetId,auditId);
        if (legacy) return { asset:{ assetId,auditId,ownerType:type,ownerId:assetId,revision:0,filename:legacy.filename ?? legacy.name ?? legacy.title ?? "unknown",mediaType:legacy.mediaType ?? legacy.mimeType ?? "application/octet-stream",sizeBytes:legacy.sizeBytes ?? legacy.size ?? 0,sha256:legacy.sha256 ?? "",representation:"original",originalStatus:"original_missing",actor:legacy.createdBy ?? "unknown",recordedAt:legacy.createdAt ?? legacy.receivedAt ?? "unknown",retention:unknownRetention(),storageStatus:"original_missing" } as EvidenceAsset,bytes:null };
      }
      throw new Error("Evidence asset not found in authorized audit");
    });
    if (result.bytes && (sha256(result.bytes) !== result.asset.sha256 || result.bytes.length !== result.asset.sizeBytes)) throw new Error("DB-preserved evidence integrity mismatch");
    return result;
  };
  const timeline = async (assetId:string,auditId:string,principal?:EvidencePrincipal) => {
    await read(assetId,auditId,principal);
    const events = await deps.repository.timeline(auditId,assetId);
    let previous:string|null = null;
    for (let index = 0;index < events.length;index++) {
      const { eventHash,...event } = events[index];
      if (event.revision !== index + 1 || event.previousHash !== previous || sha256(canonicalJson(event)) !== eventHash) throw new Error("Custody event chain verification failed");
      previous = eventHash;
    }
    return events;
  };
  return {
    deps,authorize,owner,retention,preserve,protect,
    async readEvidenceAsset(assetId:string,auditId:string,principal?:EvidencePrincipal,revision?:number) {
      const resolved = await authorize(auditId,"download",principal);
      const result = await read(assetId,auditId,resolved,revision,"download");
      if (!result.bytes) throw new Error("original_missing: historical metadata cannot reconstruct original bytes; explicit original re-upload is required");
      await deps.repository.transaction(tx => tx.appendEvent({ type:"evidence.downloaded",auditId,entityId:assetId,actor:resolved.id,revision:result.asset.revision,payload:{ assetRevision:result.asset.revision,sha256:result.asset.sha256,representation:result.asset.representation } }));
      return { asset:result.asset,bytes:result.bytes,headers:{ "Content-Type":result.asset.mediaType,"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(result.asset.filename)}`,"Cache-Control":"private, no-store","X-Evidence-SHA256":result.asset.sha256 } };
    },
    async verifyEvidenceAsset(assetId:string,auditId:string,principal?:EvidencePrincipal,revision?:number) {
      const result = await read(assetId,auditId,principal,revision);
      if (!result.bytes) return { status:"original_missing" as const,asset:result.asset,dbDigestVerified:false,externalVerified:false };
      let externalVerified = false;let externalError:string|undefined;
      try {
        const adapter = await deps.loadProtectedVault?.();
        if (adapter && result.asset.external) { await adapter.verify(result.asset);externalVerified = true; }
        else if (adapter) externalError = "Configured vault has no verified exact version for this asset";
        else if (result.asset.external) externalError = "Previously used vault provider is not configured";
      } catch (error) { externalError = error instanceof Error ? error.message : String(error); }
      return { status:result.asset.storageStatus,asset:result.asset,dbDigestVerified:true,externalVerified,externalError,notWorm:true };
    },
    async getEvidenceVaultStatus(auditId:string,principal?:EvidencePrincipal) {
      await authorize(auditId,"read",principal);
      await deps.repository.transaction(tx => tx.requireAudit(auditId));
      let configured = false;let provider:string|null = null;let configurationError:string|undefined;
      try { const adapter = await deps.loadProtectedVault?.();configured = !!adapter;provider = adapter?.provider ?? null; }
      catch (error) { configured = true;configurationError = error instanceof Error ? error.message : String(error); }
      let immudbStatus:string;
      try { immudbStatus = await deps.loadImmudb?.() ? "configured_not_health_verified" : "not_configured"; }
      catch { immudbStatus = "configuration_failed"; }
      return { source:"mysql-versioned-longblob",auditId,...await deps.repository.status(auditId),durableBaseline:"DB-preserved, not WORM",external:{ configured,provider,configurationError,status:configurationError ? "configuration_failed" : configured ? "configured_not_health_verified" : "not_configured" },immudb:{ status:immudbStatus },complianceCertified:false };
    },
    async previewEvidenceRetention(input:{ auditId:string;ownerType:string;ownerId:string;principal?:EvidencePrincipal }) {
      await authorize(input.auditId,"read",input.principal);
      required(input.ownerType,"ownerType");required(input.ownerId,"ownerId");
      const configured = await deps.loadRetention?.(input.auditId,input.ownerType,input.ownerId) ?? null;
      const policy = validateRetention(configured ?? unknownRetention());
      return { auditId:input.auditId,ownerType:input.ownerType,ownerId:input.ownerId,policy,source:configured?.status === "assigned" ? "configured_user_rule" : "unknown",fixedGlobalDefault:false,applied:false as const };
    },
    async appendEvidenceCustody(input:{ assetId:string;auditId:string;actor:string;action:"received"|"transferred"|"reviewed"|"integrity_verified";detail:Record<string,unknown> }) {
      const principal = await authorize(input.auditId,"write",{ id:required(input.actor,"actor") });
      if (!["received","transferred","reviewed","integrity_verified"].includes(input.action)) throw new Error("Unsupported custody action");
      const result = await read(input.assetId,input.auditId,principal);
      return deps.repository.transaction(tx => tx.appendEvent({ type:`evidence.custody_${input.action}`,auditId:input.auditId,entityId:input.assetId,actor:principal.id,revision:result.asset.revision,payload:{ ...input.detail,assetRevision:result.asset.revision,sha256:result.asset.sha256 } }));
    },
    async listEvidenceTimeline(assetId:string,auditId:string,principal?:EvidencePrincipal) {
      const events = await timeline(assetId,auditId,principal);
      return { source:"mysql-evidence-custody",assetId,auditId,events,chainVerified:true,independentlyNotarized:false };
    },
    async setEvidenceRetention(input:{ assetId:string;auditId:string;actor:string;retention:RetentionPolicy;decisionId:string;expectedPolicyEventId?:string }) {
      const principal = await authorize(input.auditId,"hold",{ id:required(input.actor,"actor") });
      required(input.decisionId,"decisionId");
      const policy = validateRetention(input.retention);
      const result = await read(input.assetId,input.auditId,principal);
      if (!deps.authorizeRetentionDecision) throw new Error("Qualified retention-decision authority verifier is not configured");
      await deps.repository.transaction(async tx => {
        await owner(tx,result.asset.ownerType,result.asset.ownerId,input.auditId,true);
        const decision = await owner(tx,"decision",input.decisionId,input.auditId,true);
        const target = decision.target;
        const approvedBy = decision.approvedBy ?? decision.decidedBy;
        const approvedAt = decision.approvedAt ?? decision.decidedAt;
        if (decision.status !== "approved" || !approvedBy || !approvedAt || !Number.isFinite(Date.parse(approvedAt)) || target?.assetId !== input.assetId || target?.auditId !== input.auditId || target?.assetRevision !== result.asset.revision || decision.retentionHash !== sha256(canonicalJson(policy))) throw new Error("Retention requires an approved exact-target, exact-policy persisted decision");
        if (policy.legalHold && policy.holdDecisionId !== input.decisionId) throw new Error("Hold policy must reference the exact approved decision");
        await deps.authorizeRetentionDecision!(decision,result.asset,principal,policy);
        const current = await tx.getRecord("evidence_retention_policy",input.assetId,input.auditId,true);
        if (current?.policyEventId !== input.expectedPolicyEventId) throw new Error("Retention policy revision conflict; supply exact previous policy event ID");
        const previousPolicy:RetentionPolicy = current?.retention ?? result.asset.retention;
        if (previousPolicy.retainUntil && (!policy.retainUntil || Date.parse(policy.retainUntil) < Date.parse(previousPolicy.retainUntil))) throw new Error("Retention shortening is prohibited");
        if (result.asset.external) await tx.recordExternal(input.assetId,input.auditId,result.asset.revision,{});
        const event = await tx.appendEvent({ type:"evidence.retention_policy_recorded",auditId:input.auditId,entityId:input.assetId,actor:principal.id,revision:result.asset.revision,payload:{ retention:policy,decisionId:input.decisionId,previousRetention:previousPolicy } });
        await tx.putRecord("evidence_retention_policy",input.assetId,input.auditId,{ assetId:input.assetId,assetRevision:result.asset.revision,retention:policy,policyEventId:event.id,decisionId:input.decisionId },principal.id,current?.recordRevision ?? 0);
      });
      const next = { ...result.asset,actor:principal.id,retention:policy };
      if (result.asset.external) {
        try {
          const adapter = await deps.loadProtectedVault?.();
          if (!adapter?.updatePolicy) throw new Error("Configured exact-version retention/hold adapter is unavailable");
          return recordProtection(next,await adapter.updatePolicy(next));
        } catch (error) { return recordProtection(next,undefined,error); }
      }
      return next;
    },
    async appendEvidenceEventProof(input:{ assetId:string;auditId:string;eventId:string;actor:string }) {
      const principal = await authorize(input.auditId,"write",{ id:required(input.actor,"actor") });
      const events = await timeline(input.assetId,input.auditId,principal);
      const event = events.find(e => e.id === required(input.eventId,"eventId"));
      if (!event) throw new Error("Event does not belong to the authorized asset/audit custody stream");
      const adapter = await deps.loadImmudb?.();
      if (!adapter) return { provider:"immudb",status:"not_configured",eventId:input.eventId,verified:false };
      const proof = await adapter.appendCanonicalEvent(event);
      await deps.repository.saveProof(event.id,input.auditId,"immudb",proof as unknown as Record<string,unknown>,proof.verifiedAt);
      return { ...proof,verified:proof.status === "verified_independent_checkpoint",notarization:false as const };
    },
    async verifyEvidenceEventProof(assetId:string,auditId:string,eventId:string,principal?:EvidencePrincipal) {
      const events = await timeline(assetId,auditId,principal);
      const event = events.find(e => e.id === eventId);
      if (!event) throw new Error("Event is not in this asset/audit custody stream");
      const adapter = await deps.loadImmudb?.();
      if (!adapter) return { status:"not_configured",verified:false,eventId };
      const stored = await deps.repository.getProof(eventId,auditId,"immudb");
      if (!stored?.txId) return { status:"proof_missing",verified:false,eventId };
      const verified = await adapter.verifyCanonicalEvent(event,String(stored.txId));
      await deps.repository.saveProof(eventId,auditId,"immudb",verified as unknown as Record<string,unknown>,verified.verifiedAt);
      return { ...verified,verified:verified.status === "verified_independent_checkpoint" };
    },
  };
}
export type EvidenceVaultService = ReturnType<typeof createEvidenceVaultService>;
let configured:EvidenceVaultService|undefined;
/** Install trusted parent authorization/configuration. Missing authorization always blocks access. */
export function configureEvidenceRuntime(deps:Omit<EvidenceRuntimeDependencies,"repository"> & { repository?:EvidenceRuntimeDependencies["repository"] }) {
  configured = createEvidenceVaultService({ ...deps,repository:deps.repository ?? getMysqlEvidenceRepository() });
  return configured;
}
export function getEvidenceRuntime():EvidenceVaultService {
  if (!configured) throw new Error("Evidence runtime not configured: authenticated parent authorization and reviewed runtime configuration are required");
  return configured;
}
export const readEvidenceAsset = (assetId:string,auditId:string,principal?:EvidencePrincipal,revision?:number) => getEvidenceRuntime().readEvidenceAsset(assetId,auditId,principal,revision);
export const verifyEvidenceAsset = (assetId:string,auditId:string,principal?:EvidencePrincipal,revision?:number) => getEvidenceRuntime().verifyEvidenceAsset(assetId,auditId,principal,revision);
export const getEvidenceVaultStatus = (auditId:string,principal?:EvidencePrincipal) => getEvidenceRuntime().getEvidenceVaultStatus(auditId,principal);
export const appendEvidenceCustody = (input:Parameters<EvidenceVaultService["appendEvidenceCustody"]>[0]) => getEvidenceRuntime().appendEvidenceCustody(input);
export const listEvidenceTimeline = (assetId:string,auditId:string,principal?:EvidencePrincipal) => getEvidenceRuntime().listEvidenceTimeline(assetId,auditId,principal);
export const setEvidenceRetention = (input:Parameters<EvidenceVaultService["setEvidenceRetention"]>[0]) => getEvidenceRuntime().setEvidenceRetention(input);
export const previewEvidenceRetention = (input:Parameters<EvidenceVaultService["previewEvidenceRetention"]>[0]) => getEvidenceRuntime().previewEvidenceRetention(input);
export const appendEvidenceEventProof = (input:Parameters<EvidenceVaultService["appendEvidenceEventProof"]>[0]) => getEvidenceRuntime().appendEvidenceEventProof(input);
export const verifyEvidenceEventProof = (assetId:string,auditId:string,eventId:string,principal?:EvidencePrincipal) => getEvidenceRuntime().verifyEvidenceEventProof(assetId,auditId,eventId,principal);
