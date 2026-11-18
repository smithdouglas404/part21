import { describe,it,expect,vi } from "vitest";
import { createKanbanService } from "./kanban-store";
import { createEvidenceVaultService } from "./evidence-vault";
import { evidenceTestHarness } from "./vault/test-support";
const cardInput = { auditId:"test-audit",title:"Field observation",createdBy:"test-actor" };
async function setup() { const h = evidenceTestHarness();h.seed("audit","test-audit","test-audit");h.seed("audit","other-audit","other-audit");const service = createKanbanService(h.vault);const created = await service.createKanbanItem(cardInput);return { h,service,created }; }
describe("audit-scoped transactional Kanban evidence",() => {
  it("preserves binary zeros and original bytes and records authorized download",async () => {
    const { h,service,created } = await setup();const bytes = Buffer.from([0,255,17,0,64,128]);
    const result = await service.attachKanbanAsset({ itemId:created.item.id,auditId:"test-audit",filename:"photo.bin",mediaType:"application/octet-stream",kind:"photo",base64:bytes.toString("base64"),createdBy:"test-actor" });
    const download = await h.vault.readEvidenceAsset(result.asset.assetId,"test-audit");
    expect(download.bytes.equals(bytes)).toBe(true);expect(download.asset.storageStatus).toBe("db_preserved_not_vaulted");expect(download.headers["Cache-Control"]).toBe("private, no-store");
    expect((await h.vault.listEvidenceTimeline(result.asset.assetId,"test-audit")).chainVerified).toBe(true);
  });
  it("rejects foreign/missing card before bytes or provider calls",async () => {
    const { h,created } = await setup();const protect = vi.fn();const vault = createEvidenceVaultService({ ...h.deps,loadProtectedVault:async () => ({ provider:"test-provider",protect,verify:vi.fn() }) });
    const service = createKanbanService(vault);
    await expect(service.attachKanbanAsset({ itemId:created.item.id,auditId:"other-audit",filename:"x",mediaType:"x",kind:"photo",base64:"invalid!",createdBy:"test-actor" })).rejects.toThrow("authorized audit");
    expect(h.assets().size).toBe(0);expect(protect).not.toHaveBeenCalled();
  });
  it("requires explicit audit on legacy movement and rejects direct fabricated finalization",async () => {
    const { service,created } = await setup();
    await expect(service.moveKanbanItem(created.item.id,"in_progress","test-actor")).rejects.toThrow("auditId");
    await expect(service.moveKanbanItem(created.item.id,"final","test-actor","test-audit")).rejects.toThrow("qualified");
    await expect(service.moveKanbanItem(created.item.id,"blocked","test-actor","other-audit")).rejects.toThrow("authorized audit");
  });
  it("does not invent an active skill on a status move",async () => {
    const { service,created } = await setup();const moved = await service.moveKanbanItem(created.item.id,"in_progress","test-actor","test-audit",1,"User activated clarification");
    expect(moved.item.activeSkillId).toBeUndefined();expect(moved.event.payload.clockReset).toBe(false);expect(moved.event.payload.reason).toBe("User activated clarification");
  });
  it("rolls back card, attachment and event together on ledger failure",async () => {
    const { h,service,created } = await setup();h.failEvents(true);
    await expect(service.attachKanbanAsset({ itemId:created.item.id,auditId:"test-audit",filename:"x",mediaType:"x",kind:"document",base64:Buffer.from("original").toString("base64"),createdBy:"test-actor" })).rejects.toThrow("ledger failure");
    expect(h.assets().size).toBe(0);expect((await h.repository.listRecords("kanban_attachment","test-audit"))).toHaveLength(0);expect(h.records().get(`kanban_item/${created.item.id}`)?.recordRevision).toBe(1);
  });
  it("checks card/conversation ownership before communications and persists exact input skill revisions",async () => {
    const { h,service,created } = await setup();const input = { itemId:created.item.id,auditId:"test-audit",conversationId:"test-conversation",role:"user" as const,actor:"test-actor",text:"Receiving record needs clarification",skillIds:["test-skill"],skillRevisions:[{ id:"test-skill",revision:"7" }],channel:"test-channel" };
    const result = await service.appendKanbanCommunication(input);
    expect(result.communication.itemRevision).toBe(2);expect(result.event.payload.communicationId).toBe(result.communication.id);expect(h.records().has(`kanban_communication/${result.communication.id}`)).toBe(true);expect(result.event.payload.skillRevisions).toEqual(input.skillRevisions);
    const otherCard = await service.createKanbanItem({ ...cardInput,title:"Another card" });
    await expect(service.appendKanbanCommunication({ ...input,itemId:otherCard.item.id })).rejects.toThrow("another card");
    await expect(service.appendKanbanCommunication({ ...input,auditId:"other-audit" })).rejects.toThrow("authorized audit");
  });
  it("rolls back communication and item update on event failure",async () => {
    const { h,service,created } = await setup();h.failEvents(true);
    await expect(service.appendKanbanCommunication({ itemId:created.item.id,auditId:"test-audit",conversationId:"test-conversation",role:"user",actor:"test-actor",text:"Actual note",skillIds:[] })).rejects.toThrow("ledger failure");
    expect((await h.repository.listRecords("kanban_communication","test-audit"))).toHaveLength(0);expect(h.records().get(`kanban_item/${created.item.id}`)?.recordRevision).toBe(1);
  });
  it("retains original audio and separately retrievable transcript derivative",async () => {
    const { h,service,created } = await setup();const audio = Buffer.from([82,73,70,70,0,1,2,255]);
    const result = await service.attachKanbanAsset({ itemId:created.item.id,auditId:"test-audit",filename:"voice.wav",mediaType:"audio/wav",kind:"voice",base64:audio.toString("base64"),transcript:"Observed condition",createdBy:"test-actor" });
    expect(result.asset.representation).toBe("original");expect(result.derivatives).toHaveLength(1);const derivative = result.derivatives[0].asset;
    expect(derivative.representation).toBe("derivative");expect(derivative.derivedFromAssetId).toBe(result.asset.assetId);
    expect((await h.vault.readEvidenceAsset(result.asset.assetId,"test-audit")).bytes.equals(audio)).toBe(true);expect((await h.vault.readEvidenceAsset(derivative.assetId,"test-audit")).bytes.toString()).toBe("Observed condition");
  });
  it("never labels transcript-only voice as original audio",async () => {
    const { h,service,created } = await setup();const result = await service.attachKanbanAsset({ itemId:created.item.id,auditId:"test-audit",filename:"voice",mediaType:"audio/wav",kind:"voice",transcript:"Text without audio",createdBy:"test-actor" });
    expect(result.asset.representation).toBe("derivative");expect(result.asset.originalStatus).toBe("original_missing");expect(result.asset.mediaType).toContain("text/plain");
    const events = (await h.vault.listEvidenceTimeline(result.asset.assetId,"test-audit")).events;expect(events.some(e => e.type === "evidence.derivative_preserved")).toBe(true);expect(events.some(e => e.type === "evidence.original_preserved")).toBe(false);
  });
  it("marks historical metadata-only attachments original_missing without reconstructing bytes",async () => {
    const { h,service } = await setup();h.seed("kanban_attachment","legacy-attachment","test-audit",{ filename:"legacy.jpg",mediaType:"image/jpeg",sha256:"a".repeat(64),sizeBytes:12 });
    const listed = await service.listKanbanItems("test-audit");const legacy = listed.attachments.find(a => a.id === "legacy-attachment");expect(legacy?.originalStatus).toBe("original_missing");expect(legacy?.storageStatus).toBe("original_missing");await expect(h.vault.readEvidenceAsset("legacy-attachment","test-audit")).rejects.toThrow("cannot reconstruct");
  });
  it("preserves DB bytes but reports configured external failure without downgrade",async () => {
    const { h,created } = await setup();const vault = createEvidenceVaultService({ ...h.deps,loadProtectedVault:async () => ({ provider:"configured",protect:async () => { throw new Error("External service unavailable"); },verify:vi.fn() }) });
    const result = await createKanbanService(vault).attachKanbanAsset({ itemId:created.item.id,auditId:"test-audit",filename:"x",mediaType:"x",kind:"document",base64:Buffer.from("actual bytes").toString("base64"),createdBy:"test-actor" });
    expect(result.asset.storageStatus).toBe("external_failed");expect(result.warning).toContain("not vaulted");expect((await vault.readEvidenceAsset(result.asset.assetId,"test-audit")).bytes.toString()).toBe("actual bytes");expect((await createKanbanService(vault).listKanbanItems("test-audit")).attachments[0].storageStatus).toBe("external_failed");
  });
});
