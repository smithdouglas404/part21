import { randomUUID } from "node:crypto";
import { getEvidenceRuntime, type EvidencePrincipal, type EvidenceVaultService } from "./evidence-vault";
import { decodeEvidenceBase64, required } from "./vault/types";
export type EvidenceRecord = { id:string;name:string;mimeType:string;size:number;tags:string[];linkedFinding:string;status:string;receivedAt:string;sha256:string;storage:string;auditId:string;assetId?:string;assetRevision?:number;originalStatus?:string;storageStatus?:string;recordRevision?:number };
export type RegisterEvidenceInput = { name?:string;mimeType?:string;size?:number;tags?:string[];linkedFinding?:string;auditId?:string;contentBase64?:string;actor?:string };
/** Citation metadata is a template crosswalk, not an applicability decision or ingested source snapshot. */
export const evidenceReportCitationTemplates = [
  { citation:"10 CFR 21.51",title:"Maintenance and inspection of records",framework:"Part 21",applicability:"human_review_required" },
  { citation:"10 CFR 21.61",title:"Failure to notify",framework:"Part 21",applicability:"human_review_required" },
  { citation:"10 CFR Part 50 Appendix B, Criterion VIII",title:"Identification and Control of Materials, Parts, and Components",framework:"Appendix B",applicability:"human_review_required" },
  { citation:"10 CFR Part 50 Appendix B, Criterion XV",title:"Nonconforming Materials, Parts, or Components",framework:"Appendix B",applicability:"human_review_required" },
  { citation:"10 CFR Part 50 Appendix B, Criterion XVI",title:"Corrective Action",framework:"Appendix B",applicability:"human_review_required" },
] as const;

export function createEvidenceService(vault:EvidenceVaultService) {
  return {
    async registerEvidence(input:RegisterEvidenceInput) {
      const auditId = required(input.auditId,"auditId"); const actor = required(input.actor,"actor"); const findingId = required(input.linkedFinding,"linkedFinding");
      await vault.authorize(auditId,"write",{ id:actor });
      if (!input.contentBase64) return { ok:false,error:"A document payload is required." };
      const bytes = decodeEvidenceBase64(input.contentBase64);
      if (input.size !== undefined && input.size !== bytes.length) throw new Error("Declared size does not match original bytes");
      const result = await vault.deps.repository.transaction(async tx => {
        await tx.requireAudit(auditId); await vault.owner(tx,"finding",findingId,auditId,true);
        const id = `UP-${randomUUID()}`;
        const now = await tx.now();
        const name = required(input.name,"name"); const mimeType = required(input.mimeType,"mimeType");
        await tx.putRecord("evidence",id,auditId,{ id,name,mimeType,size:bytes.length,tags:input.tags ?? [],linkedFinding:findingId,status:"Pending human verification",receivedAt:now,auditId,createdBy:actor },actor,0);
        const asset = await vault.preserve(tx,{ assetId:id,auditId,ownerType:"evidence",ownerId:id,filename:name,mediaType:mimeType,bytes,actor,representation:"original",originalStatus:"present" });
        const record = await tx.putRecord("evidence",id,auditId,{ id,name,mimeType,size:bytes.length,tags:input.tags ?? [],linkedFinding:findingId,status:"Pending human verification",receivedAt:now,auditId,createdBy:actor,sha256:asset.sha256,assetId:id,assetRevision:asset.revision,originalStatus:"present",storage:"mysql-versioned-longblob",storageStatus:asset.storageStatus },actor,1) as EvidenceRecord;
        const event = await tx.appendEvent({ type:"evidence.original_preserved",actor,auditId,entityId:id,revision:asset.revision,payload:{ linkedFinding:findingId,assetId:id,assetRevision:asset.revision,recordRevision:record.recordRevision,sha256:asset.sha256,retention:asset.retention,dbReadbackVerified:true,notWorm:true } });
        return { record,asset,event };
      });
      const asset = await vault.protect(result.asset,bytes);
      return { ok:true,record:{ ...result.record,storageStatus:asset.storageStatus },asset,event:result.event,traceability:{ linkedTo:[findingId,auditId],humanReviewRequired:true,sourceType:"database-evidence-record",sha256:asset.sha256,storage:asset.storageStatus },warning:asset.storageStatus === "external_failed" ? "Original bytes are DB-preserved, not vaulted; configured external protection failed" : undefined };
    },
    async listEvidence(auditId:string,principal?:EvidencePrincipal) {
      await vault.authorize(auditId,"read",principal);
      const rows = await vault.deps.repository.listRecords("evidence",auditId);
      return rows.map(({ contentBase64:_discard,...record }) => ({ ...record,originalStatus:record.assetId ? record.originalStatus : "original_missing",storageStatus:record.assetId ? record.storageStatus : "original_missing" })) as EvidenceRecord[];
    },
    async getReportDraft(findingId?:string,auditId?:string,principal?:EvidencePrincipal) {
      required(findingId,"findingId"); required(auditId,"auditId");
      await vault.authorize(auditId!,"read",principal);
      const finding = await vault.deps.repository.transaction(async tx => { await tx.requireAudit(auditId!); return vault.owner(tx,"finding",findingId!,auditId!); });
      const evidence = await vault.deps.repository.listRecords("evidence",auditId!);
      const linkedUploads = evidence.filter(record => record.linkedFinding === findingId).map(({ contentBase64:_content,...record }) => record);
      return { reportType:"audit-report-draft",findingId,auditId,generatedAt:await vault.deps.repository.transaction(tx => tx.now()),dataSource:"mysql-database",sections:{ executiveSummary:`Audit ${auditId}: finding ${findingId}. Human review required.`,condition:finding.title,regulatoryBasis:{ regulation:"10 CFR Part 21 and separately applicable 10 CFR Part 50 Appendix B",sections:[],violationHypothesis:null,applicability:"unknown",sourceIds:Array.isArray(finding.sourceIds) ? finding.sourceIds : [],sourceLinks:["https://www.ecfr.gov/current/title-10/chapter-I/part-21","https://www.ecfr.gov/current/title-10/chapter-I/part-50/appendix-Appendix%20B%20to%20Part%2050"],citationTemplates:evidenceReportCitationTemplates,templateStatus:"citation_metadata_only_not_a_regulatory_traversal" },riskAndImpact:{ risk:finding.risk ?? null,impactIfNotRemediated:finding.impactIfNotRemediated ?? null,status:"qualified_review_required" },criteria:evidenceReportCitationTemplates.map(t => `${t.citation} — ${t.title}`),evidenceBasis:linkedUploads,auditorNarrative:finding.auditorNarrative ?? null,correctiveAction:{ recommendedSteps:[],auditorEdits:null },recommendation:null,linkedUploads },humanGate:"Qualified auditor narrative, approved applicability/source interpretation and persisted quality approval required before issue",complianceCertified:false };
    },
  };
}
export const registerEvidence = (input:RegisterEvidenceInput) => createEvidenceService(getEvidenceRuntime()).registerEvidence(input);
export const listEvidence = (auditId:string,principal?:EvidencePrincipal) => createEvidenceService(getEvidenceRuntime()).listEvidence(auditId,principal);
export const getReportDraft = (findingId?:string,auditId?:string,principal?:EvidencePrincipal) => createEvidenceService(getEvidenceRuntime()).getReportDraft(findingId,auditId,principal);
