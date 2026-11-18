import { randomUUID } from "node:crypto";
import { getEvidenceRuntime, type EvidenceVaultService, type EvidencePrincipal, type RetentionPolicy } from "./evidence-vault";
import { decodeEvidenceBase64, required } from "./vault/types";
export type DocumentRecord = { id:string;title:string;documentNumber:string;revision:string;mimeType:string;sizeBytes:number;sha256:string;source:string;auditId:string;auditIds:string[];tags:string[];receivedAt:string;effectiveDate?:string;status:"controlled"|"pending_review"|"superseded";retention:RetentionPolicy;cybersecurity:{ status:"not_reviewed"|"reviewed"|"needs_action";classification:"public"|"internal"|"controlled"|"restricted";controls:string[];reviewer?:string;reviewedAt?:string };assetId:string;assetRevision:number;storageStatus:string;recordRevision?:number };
export type RegisterDocumentInput = { title?:string;documentNumber?:string;revision?:string;mimeType?:string;base64?:string;source?:string;auditId?:string;auditIds?:string[];tags?:string[];effectiveDate?:string;classification?:DocumentRecord["cybersecurity"]["classification"];actor?:string };
export type CybersecurityReviewInput = { auditId?:string;reviewer?:string;status?:"reviewed"|"needs_action";controls?:string[];note?:string;expectedRevision?:number };

export function createDocumentControlService(vault:EvidenceVaultService) {
  return {
    async listControlledDocuments(filters:{ auditId?:string;principal?:EvidencePrincipal } = {}) {
      const auditId = required(filters.auditId,"auditId");
      await vault.authorize(auditId,"read",filters.principal);
      const rows = await vault.deps.repository.listRecords("document",auditId);
      return rows.map(({ contentBase64:_content,notarization:_legacyDemo,...safe }) => ({ ...safe,originalStatus:safe.assetId ? "present" : "original_missing",storageStatus:safe.assetId ? safe.storageStatus : "original_missing" }));
    },
    async getDocumentControlStatus(auditId?:string,principal?:EvidencePrincipal) {
      if (!auditId) return { integration:"controlled-document-repository",status:"audit_required" as const,error:"A selected auditId is required; no global document status is exposed.",complianceCertified:false };
      const status = await vault.getEvidenceVaultStatus(auditId,principal);
      return { integration:"controlled-document-repository",status:"database_original_preservation",storage:"mysql versioned LONGBLOB; not WORM",documents:(await vault.deps.repository.listRecords("document",auditId)).length,retentionControls:"record-specific policy; unknown if not assigned",cybersecurityReview:"human-recorded review; no automatic malware-scan assertion",hederaNotarization:"disabled_not_configured",vault:status,complianceCertified:false };
    },
    async registerControlledDocument(input:RegisterDocumentInput) {
      const auditId = required(input.auditId ?? (input.auditIds?.length === 1 ? input.auditIds[0] : undefined),"one explicit auditId");
      if (input.auditIds && (input.auditIds.length !== 1 || input.auditIds[0] !== auditId)) throw new Error("Shared multi-audit originals require separate authorized copies; cannot select the first audit silently");
      const actor = required(input.actor,"actor");
      await vault.authorize(auditId,"write",{ id:actor });
      if (!input.base64) return { ok:false,error:"A document payload is required." };
      const bytes = decodeEvidenceBase64(input.base64);
      const title = required(input.title,"title"); const number = required(input.documentNumber,"documentNumber"); const revision = required(input.revision,"revision"); const source = required(input.source,"source"); const mimeType = required(input.mimeType,"mimeType");
      if (input.effectiveDate && !Number.isFinite(Date.parse(input.effectiveDate))) throw new Error("Invalid effectiveDate");
      const result = await vault.deps.repository.transaction(async tx => {
        await tx.requireAudit(auditId);
        const id = `DOC-${randomUUID()}`; const now = await tx.now();
        const policy = await vault.retention(auditId,"document",id);
        const initial = { id,title,documentNumber:number,revision,mimeType,sizeBytes:bytes.length,source,auditId,auditIds:[auditId],tags:input.tags ?? [],receivedAt:now,effectiveDate:input.effectiveDate,status:"pending_review",retention:policy,cybersecurity:{ status:"not_reviewed",classification:input.classification ?? "controlled",controls:[] } };
        await tx.putRecord("document",id,auditId,initial,actor,0);
        const asset = await vault.preserve(tx,{ assetId:id,auditId,ownerType:"document",ownerId:id,filename:title,mediaType:mimeType,bytes,actor,representation:"original",originalStatus:"present",retention:policy });
        const document = await tx.putRecord("document",id,auditId,{ ...initial,sha256:asset.sha256,assetId:id,assetRevision:asset.revision,storageStatus:asset.storageStatus },actor,1) as DocumentRecord;
        const event = await tx.appendEvent({ type:"document.created",actor,auditId,entityId:id,revision:document.recordRevision!,payload:{ documentId:id,documentRevision:revision,assetRevision:asset.revision,recordRevision:document.recordRevision,sha256:asset.sha256,retention:policy,dbReadbackVerified:true,humanGate:"Document control and cybersecurity review required; upload is not approval" } });
        return { document,asset,event };
      });
      const asset = await vault.protect(result.asset,bytes);
      return { ok:true,document:{ ...result.document,storageStatus:asset.storageStatus },asset,event:result.event,warning:asset.storageStatus === "external_failed" ? "Original bytes DB-preserved, not vaulted" : undefined };
    },
    async reviewDocumentCybersecurity(documentId:string,input:CybersecurityReviewInput) {
      const auditId = required(input.auditId,"auditId"); const reviewer = required(input.reviewer,"authenticated reviewer");
      await vault.authorize(auditId,"review",{ id:reviewer });
      if (!input.status || !["reviewed","needs_action"].includes(input.status)) throw new Error("Explicit cybersecurity disposition required");
      if (!input.controls || !input.note?.trim()) throw new Error("Actual performed controls and review note are required; no invented scan controls");
      return vault.deps.repository.transaction(async tx => {
        const document = await vault.owner(tx,"document",documentId,auditId,true) as DocumentRecord;
        const cybersecurity = { ...document.cybersecurity,status:input.status!,controls:input.controls!,reviewer,reviewedAt:await tx.now() };
        const updated = await tx.putRecord("document",documentId,auditId,{ ...document,cybersecurity },reviewer,input.expectedRevision) as DocumentRecord;
        const event = await tx.appendEvent({ type:"document.cybersecurity_reviewed",actor:reviewer,auditId,entityId:documentId,revision:updated.recordRevision!,payload:{ cybersecurity,note:input.note,recordRevision:updated.recordRevision,qualityApproval:"not_performed" } });
        return { ok:true,document:updated,event };
      });
    },
  };
}
export const listControlledDocuments = (filters:{ auditId?:string;principal?:EvidencePrincipal } = {}) => createDocumentControlService(getEvidenceRuntime()).listControlledDocuments(filters);
export const getDocumentControlStatus = (auditId?:string,principal?:EvidencePrincipal) => createDocumentControlService(getEvidenceRuntime()).getDocumentControlStatus(auditId,principal);
export const registerControlledDocument = (input:RegisterDocumentInput) => createDocumentControlService(getEvidenceRuntime()).registerControlledDocument(input);
export const reviewDocumentCybersecurity = (documentId:string,input:CybersecurityReviewInput) => createDocumentControlService(getEvidenceRuntime()).reviewDocumentCybersecurity(documentId,input);
/** Import-compatible disabled wrapper; never generates or persists fake transactions. */
export async function notarizeDocumentWithHederaDemo(_documentId:string,_actor?:string) {
  return { ok:false,status:"disabled" as const,error:"Synthetic Hedera notarization is disabled. Configure a real independently verified event proof adapter; no provider was invoked." };
}
/** Import-compatible disabled wrapper; never emits a synthetic Part 21 decision on an active route. */
export async function generateSyntheticPart21Decision(_documentId:string,_actor?:string) {
  return { ok:false,status:"disabled" as const,error:"Synthetic Part 21 decision generation is disabled. Use a source-linked technical evaluation and persisted qualified human decision; no provider was invoked and no decision was saved." };
}
