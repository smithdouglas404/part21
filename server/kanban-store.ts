import crypto from "node:crypto";
import { appendAssuranceEvent } from "./event-store";
import { listDomainRecords, upsertDomainRecord } from "./domain-store";

export type KanbanStatus = "backlog" | "in_progress" | "blocked" | "review" | "final";
export type KanbanItem = { id: string; auditId: string; title: string; description: string; status: KanbanStatus; priority: "low" | "medium" | "high" | "critical"; attention: boolean; source: "field" | "agent" | "audit"; ownerPersonId?: string; createdBy: string; createdAt: string; updatedAt: string; attachmentIds: string[] };
export type KanbanAttachment = { id: string; itemId: string; auditId: string; filename: string; mediaType: string; kind: "photo" | "document" | "voice"; sizeBytes: number; sha256: string; transcript?: string; createdBy: string; createdAt: string };

export async function listKanbanItems(auditId: string) {
  const items = await listDomainRecords<KanbanItem>("kanban_item", auditId);
  const attachments = await listDomainRecords<KanbanAttachment>("kanban_attachment", auditId);
  return { source: "mysql-domain-records", auditId, items, attachments };
}

export async function createKanbanItem(input: Partial<KanbanItem> & { auditId: string; createdBy: string }) {
  if (!input.auditId || !input.title) throw new Error("auditId and title are required.");
  const now = new Date().toISOString();
  const item: KanbanItem = { id: input.id ?? `KB-${Date.now()}`, auditId: input.auditId, title: input.title, description: input.description ?? "", status: input.status ?? "backlog", priority: input.priority ?? "medium", attention: input.attention ?? true, source: input.source ?? "field", ownerPersonId: input.ownerPersonId, createdBy: input.createdBy, createdAt: now, updatedAt: now, attachmentIds: input.attachmentIds ?? [] };
  await upsertDomainRecord({ recordType: "kanban_item", recordId: item.id, auditId: item.auditId, payload: item });
  const event = await appendAssuranceEvent({ type: "kanban_item_created", actor: item.createdBy, auditId: item.auditId, entityId: item.id, payload: { status: item.status, priority: item.priority, source: item.source } });
  return { ok: true, item, event, source: "mysql-domain-records" };
}

export async function moveKanbanItem(itemId: string, status: KanbanStatus, actor: string) {
  const items = await listDomainRecords<KanbanItem>("kanban_item");
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Kanban item ${itemId} was not found.`);
  if (!actor) throw new Error("actor is required.");
  const previousStatus = item.status;
  const updated = { ...item, status, attention: status !== "final", updatedAt: new Date().toISOString() };
  await upsertDomainRecord({ recordType: "kanban_item", recordId: item.id, auditId: item.auditId, payload: updated });
  const event = await appendAssuranceEvent({ type: "kanban_item_moved", actor, auditId: item.auditId, entityId: item.id, payload: { from: previousStatus, to: status } });
  return { ok: true, item: updated, event, source: "mysql-domain-records" };
}

export async function attachKanbanAsset(input: { itemId: string; auditId: string; filename: string; mediaType: string; kind: KanbanAttachment["kind"]; base64?: string; transcript?: string; createdBy: string }) {
  const bytes = input.base64 ? Buffer.from(input.base64, "base64") : Buffer.from(input.transcript ?? "", "utf8");
  const attachment: KanbanAttachment = { id: `KBA-${Date.now()}`, itemId: input.itemId, auditId: input.auditId, filename: input.filename, mediaType: input.mediaType, kind: input.kind, sizeBytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), transcript: input.transcript, createdBy: input.createdBy, createdAt: new Date().toISOString() };
  await upsertDomainRecord({ recordType: "kanban_attachment", recordId: attachment.id, auditId: attachment.auditId, payload: attachment, content: bytes });
  const items = await listDomainRecords<KanbanItem>("kanban_item", attachment.auditId);
  const item = items.find((candidate) => candidate.id === attachment.itemId);
  if (!item) throw new Error(`Kanban item ${attachment.itemId} was not found.`);
  const updated = { ...item, attachmentIds: [...new Set([...item.attachmentIds, attachment.id])], attention: true, updatedAt: new Date().toISOString() };
  await upsertDomainRecord({ recordType: "kanban_item", recordId: item.id, auditId: item.auditId, payload: updated });
  const event = await appendAssuranceEvent({ type: "kanban_attachment_added", actor: attachment.createdBy, auditId: attachment.auditId, entityId: attachment.itemId, payload: { attachmentId: attachment.id, filename: attachment.filename, kind: attachment.kind, sha256: attachment.sha256 } });
  return { ok: true, attachment, item: updated, event, source: "mysql-domain-records" };
}
