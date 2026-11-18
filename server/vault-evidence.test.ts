import { describe,it,expect,vi } from "vitest";
import { createEvidenceService,evidenceReportCitationTemplates } from "./evidence";
import { createEvidenceVaultService } from "./evidence-vault";
import { createDocumentControlService,generateSyntheticPart21Decision,notarizeDocumentWithHederaDemo } from "./document-control";
import { canonicalJson,sha256 } from "./vault/types";
import { evidenceTestHarness } from "./vault/test-support";
async function uploaded() { const h = evidenceTestHarness();h.seed("audit","test-audit","test-audit");h.seed("finding","test-finding","test-audit",{ title:"Actual finding" });const service = createEvidenceService(h.vault);const result = await service.registerEvidence({ auditId:"test-audit",linkedFinding:"test-finding",name:"document.pdf",mimeType:"application/pdf",contentBase64:Buffer.from("Exact PDF bytes").toString("base64"),actor:"test-actor" });return { h,service,result }; }
describe("evidence integrity and truthful controls",() => {
  it("derives size from exact original bytes and rejects forged sizes",async () => {
    const { h,result } = await uploaded();expect(result.ok).toBe(true);if (!result.ok || !result.asset) throw new Error("Upload required");
    expect(result.record?.size).toBe(Buffer.byteLength("Exact PDF bytes"));expect(result.asset.retention.status).toBe("unknown");expect(result.asset.retention.retainUntil).toBeUndefined();
    await expect(createEvidenceService(h.vault).registerEvidence({ auditId:"test-audit",linkedFinding:"test-finding",name:"x",mimeType:"x",contentBase64:"YQ==",actor:"test-actor",size:9 })).rejects.toThrow("size");
  });
  it("fails visibly on original-byte corruption",async () => {
    const { h,result } = await uploaded();h.tamper(result.asset!.assetId,"test-audit");await expect(h.vault.verifyEvidenceAsset(result.asset!.assetId,"test-audit")).rejects.toThrow("integrity mismatch");
  });
  it("marks historic metadata original_missing and refuses invented reconstruction",async () => {
    const h = evidenceTestHarness();h.seed("audit","test-audit","test-audit");h.seed("kanban_attachment","legacy-photo","test-audit",{ filename:"old.jpg",mediaType:"image/jpeg",sha256:"irrecoverable hash",sizeBytes:50 });
    const result = await h.vault.verifyEvidenceAsset("legacy-photo","test-audit");expect(result.status).toBe("original_missing");expect(result.dbDigestVerified).toBe(false);await expect(h.vault.readEvidenceAsset("legacy-photo","test-audit")).rejects.toThrow("cannot reconstruct");
  });
  it("does not choose another finding for an empty audit finding lookup",async () => {
    const { service } = await uploaded();await expect(service.getReportDraft("missing","test-audit")).rejects.toThrow("authorized audit");
  });
  it("corrects record/failure-to-notify and separate Appendix B citation templates",() => {
    expect(evidenceReportCitationTemplates.find(c => c.citation === "10 CFR 21.51")?.title).toBe("Maintenance and inspection of records");expect(evidenceReportCitationTemplates.find(c => c.citation === "10 CFR 21.61")?.title).toBe("Failure to notify");expect(evidenceReportCitationTemplates.filter(c => c.framework === "Appendix B").map(c => c.citation.split("Criterion ")[1])).toEqual(["VIII","XV","XVI"]);
  });
  it("disables synthetic Part21 and Hedera without writing or calling a provider",async () => {
    expect((await generateSyntheticPart21Decision("whatever","untrusted")).status).toBe("disabled");expect((await notarizeDocumentWithHederaDemo("whatever","untrusted")).ok).toBe(false);
  });
  it("requires actual document revision and avoids automatic controlled approval",async () => {
    const h = evidenceTestHarness();h.seed("audit","test-audit","test-audit");const service = createDocumentControlService(h.vault);
    await expect(service.registerControlledDocument({ auditIds:["test-audit"],actor:"test-actor",title:"Document",documentNumber:"test-doc",source:"actual upload",mimeType:"application/pdf",base64:"YQ==" })).rejects.toThrow("revision");
    const created = await service.registerControlledDocument({ auditIds:["test-audit"],actor:"test-actor",title:"Document",documentNumber:"test-doc",revision:"issued-7",source:"actual upload",mimeType:"application/pdf",base64:"YQ==" });
    const reviewed = await service.reviewDocumentCybersecurity(created.document!.id,{ auditId:"test-audit",reviewer:"test-actor",status:"reviewed",controls:["Performed access-policy review"],note:"Actual review evidence recorded" });expect(reviewed.document.status).toBe("pending_review");expect(reviewed.document.retention.status).toBe("unknown");
  });
  it("requires approved exact policy/target plus qualified authority, not arbitrary decision existence",async () => {
    const { h,result } = await uploaded();const asset = result.asset!;
    const authority = vi.fn(async () => {});const vault = createEvidenceVaultService({ ...h.deps,authorizeRetentionDecision:authority });
    const retention = { status:"assigned" as const,policyId:"test-policy",policyRevision:"reviewed-2",sourceIds:["test-source"],triggerEventId:"test-discovery",triggerAt:"2026-11-18T12:00:00.000Z",retainUntil:"2031-11-18T12:00:00.000Z",legalHold:false };
    h.seed("decision","test-decision","test-audit",{ status:"pending" });
    await expect(vault.setEvidenceRetention({ assetId:asset.assetId,auditId:"test-audit",actor:"test-actor",retention,decisionId:"test-decision" })).rejects.toThrow("approved exact-target");expect(authority).not.toHaveBeenCalled();
    h.seed("decision","test-decision","test-audit",{ status:"approved",approvedBy:"qualified-reviewer",approvedAt:"2026-11-18T12:00:00.000Z",target:{ assetId:asset.assetId,auditId:"test-audit",assetRevision:asset.revision },retentionHash:sha256(canonicalJson(retention)) });
    await vault.setEvidenceRetention({ assetId:asset.assetId,auditId:"test-audit",actor:"test-actor",retention,decisionId:"test-decision" });expect(authority).toHaveBeenCalledOnce();expect((await vault.verifyEvidenceAsset(asset.assetId,"test-audit")).asset.retention).toEqual(retention);
  });
  it("reports immudb not_configured rather than fake local notarization",async () => {
    const { h,result } = await uploaded();const timeline = await h.vault.listEvidenceTimeline(result.asset!.assetId,"test-audit");const proof = await h.vault.appendEvidenceEventProof({ assetId:result.asset!.assetId,auditId:"test-audit",eventId:timeline.events[0].id,actor:"test-actor" });expect(proof.status).toBe("not_configured");expect(proof.verified).toBe(false);
  });
  it("previews user retention rules read-only and returns unknown without inventing ten years",async () => {
    const { h } = await uploaded();
    const unknown = await h.vault.previewEvidenceRetention({ auditId:"test-audit",ownerType:"evidence",ownerId:"test-evidence" });
    expect(unknown.policy.status).toBe("unknown");expect(unknown.source).toBe("unknown");expect(unknown.fixedGlobalDefault).toBe(false);
    const configured = createEvidenceVaultService({ ...h.deps,loadRetention:async () => ({ status:"assigned",policyId:"user-rule",policyRevision:"3",sourceIds:["test-source"],triggerEventId:"test-trigger",triggerAt:"2026-11-18T12:00:00.000Z",retainUntil:"2031-11-18T12:00:00.000Z",legalHold:false }) });
    const preview = await configured.previewEvidenceRetention({ auditId:"test-audit",ownerType:"evidence",ownerId:"test-evidence" });
    expect(preview.source).toBe("configured_user_rule");expect(preview.policy.retainUntil).toBe("2031-11-18T12:00:00.000Z");expect(preview.applied).toBe(false);
  });
  it("reports plain DB baseline and unverified provider states",async () => {
    const { h } = await uploaded();const status = await h.vault.getEvidenceVaultStatus("test-audit");
    expect(status.source).toBe("mysql-versioned-longblob");expect(status.durableBaseline).toContain("not WORM");expect(status.external.status).toBe("not_configured");expect(status.immudb.status).toBe("not_configured");expect(status.complianceCertified).toBe(false);
  });
});
