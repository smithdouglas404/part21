import { randomUUID } from "node:crypto";
import { getEvidenceRuntime, type EvidenceVaultService, type EvidencePrincipal } from "./evidence-vault";
import { decodeEvidenceBase64, required, type EvidenceTransaction } from "./vault/types";

export type KanbanStatus = "backlog" | "in_progress" | "blocked" | "review" | "final";
export type KanbanItem = { id: string; auditId: string; title: string; description: string; status: KanbanStatus; priority: "low" | "medium" | "high" | "critical"; attention: boolean; source: "field" | "agent" | "audit"; ownerPersonId?: string; findingId?: string; productId?: string; sourceRecordId?: string; conversationId?: string; skillIds?: string[]; activeSkillId?: string; observedAt?: string; createdBy: string; createdAt: string; updatedAt: string; attachmentIds: string[]; recordRevision?: number };
export type KanbanAttachment = { id: string; itemId: string; auditId: string; filename: string; mediaType: string; kind: "photo" | "document" | "voice"; sizeBytes: number; sha256: string; transcript?: string; createdBy: string; createdAt: string; assetId?: string; assetRevision?: number; representation?: "original" | "derivative"; originalStatus?: "present" | "original_missing"; storageStatus?: string; recordRevision?:number };
export type KanbanCommunication = { id: string; itemId: string; auditId: string; conversationId: string; role: "user" | "agent" | "system"; actor: string; text: string; skillIds: string[]; skillRevisions?: { id:string;revision:string }[]; sourceIds?:string[]; traceId?:string; channel?:string; createdAt: string; itemRevision?:number; recordRevision?:number; skillRevisionStatus?:"provided"|"unknown" };
export type KanbanCreateInput = Partial<KanbanItem> & { auditId: string; createdBy: string };
export type KanbanCommunicationInput = Omit<KanbanCommunication,"id"|"createdAt"|"recordRevision"> & { expectedItemRevision?:number };
export type KanbanAssetInput = { itemId:string;auditId:string;filename:string;mediaType:string;kind:KanbanAttachment["kind"];base64?:string;transcript?:string;createdBy:string;derivedFromAssetId?:string;expectedItemRevision?:number };
const statuses:KanbanStatus[] = ["backlog","in_progress","blocked","review","final"];

export function createKanbanService(vault: EvidenceVaultService) {
  const card = async (tx:EvidenceTransaction,itemId:string,auditId:string,lock = false) => await vault.owner(tx,"kanban_item",required(itemId,"itemId"),required(auditId,"auditId"),lock) as KanbanItem;
  const conversation = async (tx:EvidenceTransaction,item:KanbanItem,id:string,actor:string) => {
    required(id,"conversationId");
    if (item.conversationId && item.conversationId !== id) throw new Error("Conversation does not belong to this card");
    const link = await tx.getRecord("kanban_conversation_link",id,item.auditId,true);
    if (link && link.itemId !== item.id) throw new Error("Conversation belongs to another card");
    // putRecord checks the exact globally keyed link for foreign-audit collision, even if scoped read was empty.
    if (!link) await tx.putRecord("kanban_conversation_link",id,item.auditId,{ id,auditId:item.auditId,itemId:item.id },actor,0);
    const existing = await tx.getRecord("agent_conversation",id,item.auditId,true);
    if (existing && existing.kanbanItemId && existing.kanbanItemId !== item.id) throw new Error("Agent conversation belongs to another card");
  };
  return {
    async listKanbanItems(auditId:string,principal?:EvidencePrincipal) {
      await vault.authorize(auditId,"read",principal);
      await vault.deps.repository.transaction(tx => tx.requireAudit(auditId));
      const [items,attachments,communications] = await Promise.all([vault.deps.repository.listRecords("kanban_item",auditId),vault.deps.repository.listRecords("kanban_attachment",auditId),vault.deps.repository.listRecords("kanban_communication",auditId)]);
      return { source:"mysql-domain-records",auditId,items:items as KanbanItem[],attachments:attachments.map(a => ({ ...a,originalStatus:a.assetId ? a.originalStatus : "original_missing",storageStatus:a.assetId ? a.storageStatus : "original_missing" })) as KanbanAttachment[],communications:communications as KanbanCommunication[] };
    },
    async createKanbanItem(input:KanbanCreateInput) {
      await vault.authorize(input.auditId,"write",{ id:required(input.createdBy,"createdBy") });
      required(input.title,"title");
      if (input.status && !statuses.includes(input.status)) throw new Error("Invalid Kanban status");
      if (input.status === "final") throw new Error("New items cannot manufacture final approval");
      if (input.attachmentIds?.length) throw new Error("Attach originals through the authorized asset operation");
      return vault.deps.repository.transaction(async tx => {
        await tx.requireAudit(input.auditId);
        const id = input.id ?? `KB-${randomUUID()}`;
        if (await tx.getRecord("kanban_item",id,input.auditId,true)) throw new Error("Card already exists; use revision-checked mutation");
        if (input.findingId) await vault.owner(tx,"finding",input.findingId,input.auditId);
        if (input.productId) await vault.owner(tx,"product",input.productId,input.auditId);
        const now = await tx.now();
        let item:KanbanItem = { ...input,id,auditId:input.auditId,title:input.title!,description:input.description ?? "",status:input.status ?? "backlog",priority:input.priority ?? "medium",attention:input.attention ?? true,source:input.source ?? "field",createdBy:input.createdBy,createdAt:now,updatedAt:now,attachmentIds:[] };
        if (input.conversationId) await conversation(tx,item,input.conversationId,input.createdBy);
        item = await tx.putRecord("kanban_item",id,input.auditId,item,input.createdBy,0) as KanbanItem;
        const event = await tx.appendEvent({ type:"kanban_item_created",actor:input.createdBy,auditId:input.auditId,entityId:id,revision:item.recordRevision!,payload:{ recordRevision:item.recordRevision,status:item.status,priority:item.priority,source:item.source,conversationId:item.conversationId ?? null,skillIds:item.skillIds ?? [] } });
        return { ok:true,item,event,source:"mysql-domain-records" };
      });
    },
    async moveKanbanItem(itemId:string,status:KanbanStatus,actor:string,auditId?:string,expectedRevision?:number,reason?:string) {
      required(auditId,"auditId"); required(actor,"actor");
      await vault.authorize(auditId!,"write",{ id:actor });
      if (!statuses.includes(status)) throw new Error("Invalid Kanban status");
      if (status === "final") throw new Error("Finalization requires the parent's persisted qualified report-approval path; direct card finalization is disabled");
      return vault.deps.repository.transaction(async tx => {
        const item = await card(tx,itemId,auditId!,true);
        const updated = await tx.putRecord("kanban_item",itemId,auditId!,{ ...item,status,attention:true },actor,expectedRevision) as KanbanItem;
        const event = await tx.appendEvent({ type:"kanban_item_moved",actor,auditId:auditId!,entityId:itemId,revision:updated.recordRevision!,payload:{ from:item.status,to:status,reason:reason ?? null,recordRevision:updated.recordRevision,clockReset:false,skillExecuted:false } });
        return { ok:true,item:updated,event,source:"mysql-domain-records" };
      });
    },
    async appendKanbanCommunication(input:KanbanCommunicationInput) {
      const principal = await vault.authorize(input.auditId,"write",{ id:required(input.actor,"actor") });
      required(input.text,"text");
      if (!["user","agent","system"].includes(input.role)) throw new Error("Invalid communication role");
      if (input.skillRevisions?.some(s => !input.skillIds.includes(s.id) || !s.revision)) throw new Error("Skill revision must identify an applied input skill");
      return vault.deps.repository.transaction(async tx => {
        const item = await card(tx,input.itemId,input.auditId,true);
        await conversation(tx,item,input.conversationId,principal.id);
        if (input.expectedItemRevision !== undefined && input.expectedItemRevision !== (item.recordRevision ?? 0)) throw new Error("Card revision conflict");
        const updated = await tx.putRecord("kanban_item",item.id,item.auditId,{ ...item,conversationId:input.conversationId,attention:true },principal.id,input.expectedItemRevision) as KanbanItem;
        const { expectedItemRevision:_expected,...fields } = input;
        const communicationId = `KBC-${randomUUID()}`;
        const communication = await tx.putRecord("kanban_communication",communicationId,input.auditId,{ ...fields,id:communicationId,actor:principal.id,createdAt:await tx.now(),itemRevision:updated.recordRevision,skillRevisionStatus:input.skillRevisions?.length === input.skillIds.length ? "provided" : "unknown" },principal.id,0) as KanbanCommunication;
        // Preserve the canonical record ID, not an unrelated payload ID.
        const event = await tx.appendEvent({ type:"kanban_communication_recorded",actor:principal.id,auditId:input.auditId,entityId:item.id,revision:updated.recordRevision!,payload:{ communicationId:communication.id,conversationId:input.conversationId,role:input.role,skillIds:input.skillIds,skillRevisions:input.skillRevisions ?? [],skillRevisionStatus:communication.skillRevisionStatus,sourceIds:input.sourceIds ?? [],traceId:input.traceId ?? null,channel:input.channel ?? "unknown",recordRevision:updated.recordRevision } });
        return { ok:true,communication,item:updated,event,source:"mysql-domain-records" };
      });
    },
    async attachKanbanAsset(input:KanbanAssetInput) {
      await vault.authorize(input.auditId,"write",{ id:required(input.createdBy,"createdBy") });
      required(input.filename,"filename"); required(input.mediaType,"mediaType");
      if (!["photo","document","voice"].includes(input.kind)) throw new Error("Invalid attachment kind");
      const result = await vault.deps.repository.transaction(async tx => {
        // Audit/card ownership is checked before decoding, derivative creation or any provider upload.
        const item = await card(tx,input.itemId,input.auditId,true);
        if (input.expectedItemRevision !== undefined && input.expectedItemRevision !== (item.recordRevision ?? 0)) throw new Error("Card revision conflict");
        const transcriptOnly = !input.base64 && input.kind === "voice" && !!input.transcript;
        if (!input.base64 && !transcriptOnly) throw new Error("Original bytes are required; transcript text is not original photo/document/audio evidence");
        const bytes = input.base64 ? decodeEvidenceBase64(input.base64) : Buffer.from(input.transcript!,"utf8");
        if (input.derivedFromAssetId) {
          const source = await tx.getAsset(input.derivedFromAssetId,input.auditId);
          if (!source || source.asset.ownerId !== item.id || source.asset.ownerType !== "kanban_item") throw new Error("Derivative source asset does not belong to this card/audit");
        }
        const id = `KBA-${randomUUID()}`;
        const asset = await vault.preserve(tx,{ assetId:id,auditId:input.auditId,ownerType:"kanban_item",ownerId:item.id,filename:transcriptOnly ? `${input.filename}.transcript.txt` : input.filename,mediaType:transcriptOnly ? "text/plain; charset=utf-8" : input.mediaType,bytes,actor:input.createdBy,representation:transcriptOnly ? "derivative" : "original",originalStatus:transcriptOnly ? "original_missing" : "present",derivedFromAssetId:input.derivedFromAssetId });
        const attachment = await tx.putRecord("kanban_attachment",id,input.auditId,{ id,itemId:item.id,auditId:input.auditId,filename:asset.filename,mediaType:asset.mediaType,kind:input.kind,sizeBytes:asset.sizeBytes,sha256:asset.sha256,transcript:input.transcript,createdBy:input.createdBy,createdAt:asset.recordedAt,assetId:asset.assetId,assetRevision:asset.revision,representation:asset.representation,originalStatus:asset.originalStatus,storageStatus:asset.storageStatus },input.createdBy,0) as KanbanAttachment;
        const derivatives: { asset:typeof asset;bytes:Buffer;attachment:KanbanAttachment }[] = [];
        if (input.base64 && input.kind === "voice" && input.transcript) {
          const transcriptId = `KBA-${randomUUID()}`;
          const transcriptBytes = Buffer.from(input.transcript,"utf8");
          const transcriptAsset = await vault.preserve(tx,{ assetId:transcriptId,auditId:input.auditId,ownerType:"kanban_item",ownerId:item.id,filename:`${input.filename}.transcript.txt`,mediaType:"text/plain; charset=utf-8",bytes:transcriptBytes,actor:input.createdBy,representation:"derivative",originalStatus:"present",derivedFromAssetId:asset.assetId });
          const transcriptAttachment = await tx.putRecord("kanban_attachment",transcriptId,input.auditId,{ id:transcriptId,itemId:item.id,auditId:input.auditId,filename:transcriptAsset.filename,mediaType:transcriptAsset.mediaType,kind:"voice",sizeBytes:transcriptBytes.length,sha256:transcriptAsset.sha256,createdBy:input.createdBy,createdAt:transcriptAsset.recordedAt,assetId:transcriptId,assetRevision:transcriptAsset.revision,representation:"derivative",originalStatus:"present",storageStatus:transcriptAsset.storageStatus,derivedFromAssetId:asset.assetId },input.createdBy,0) as KanbanAttachment;
          derivatives.push({ asset:transcriptAsset,bytes:transcriptBytes,attachment:transcriptAttachment });
          await tx.appendEvent({ type:"evidence.transcript_derivative_preserved",actor:input.createdBy,auditId:input.auditId,entityId:transcriptId,revision:transcriptAsset.revision,payload:{ originalAssetId:asset.assetId,originalAssetRevision:asset.revision,sha256:transcriptAsset.sha256,representation:"derivative",transcriptionProvider:"unknown",humanReviewRequired:true } });
        }
        const updated = await tx.putRecord("kanban_item",item.id,item.auditId,{ ...item,attachmentIds:[...item.attachmentIds,id,...derivatives.map(d => d.asset.assetId)],attention:true },input.createdBy,input.expectedItemRevision) as KanbanItem;
        const payload = { attachmentId:id,assetId:asset.assetId,assetRevision:asset.revision,recordRevision:updated.recordRevision,sha256:asset.sha256,representation:asset.representation,originalStatus:asset.originalStatus,derivativeAssetIds:derivatives.map(d => d.asset.assetId) };
        const event = await tx.appendEvent({ type:"kanban_attachment_added",actor:input.createdBy,auditId:input.auditId,entityId:item.id,revision:updated.recordRevision!,payload });
        await tx.appendEvent({ type:asset.representation === "original" ? "evidence.original_preserved" : "evidence.derivative_preserved",actor:input.createdBy,auditId:input.auditId,entityId:asset.assetId,revision:asset.revision,payload:{ ...payload,retention:asset.retention,dbReadbackVerified:true,notWorm:true } });
        return { attachment,item:updated,event,asset,bytes,derivatives };
      });
      const protectedAsset = await vault.protect(result.asset,result.bytes);
      const derivatives = await Promise.all(result.derivatives.map(async d => { const asset = await vault.protect(d.asset,d.bytes);return { attachment:{ ...d.attachment,storageStatus:asset.storageStatus },asset }; }));
      return { ok:true,attachment:{ ...result.attachment,storageStatus:protectedAsset.storageStatus },item:result.item,event:result.event,asset:protectedAsset,derivatives,source:"mysql-versioned-longblob",warning:protectedAsset.storageStatus === "external_failed" || derivatives.some(d => d.asset.storageStatus === "external_failed") ? "Original bytes are DB-preserved, not vaulted; configured external protection failed" : undefined };
    },
  };
}
export const listKanbanItems = (auditId:string,principal?:EvidencePrincipal) => createKanbanService(getEvidenceRuntime()).listKanbanItems(auditId,principal);
export const createKanbanItem = (input:KanbanCreateInput) => createKanbanService(getEvidenceRuntime()).createKanbanItem(input);
/** Legacy 3-argument calls remain import-compatible but throw: explicit audit scope is mandatory. */
export const moveKanbanItem = (itemId:string,status:KanbanStatus,actor:string,auditId?:string,expectedRevision?:number,reason?:string) => createKanbanService(getEvidenceRuntime()).moveKanbanItem(itemId,status,actor,auditId,expectedRevision,reason);
export const appendKanbanCommunication = (input:KanbanCommunicationInput) => createKanbanService(getEvidenceRuntime()).appendKanbanCommunication(input);
export const attachKanbanAsset = (input:KanbanAssetInput) => createKanbanService(getEvidenceRuntime()).attachKanbanAsset(input);
