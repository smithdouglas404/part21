import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appendAssuranceEvent, listAssuranceEvents } from "./event-store";

type DocumentRecord = {
  id: string;
  title: string;
  documentNumber: string;
  revision: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  source: string;
  auditIds: string[];
  tags: string[];
  receivedAt: string;
  effectiveDate: string;
  status: "controlled" | "pending_review" | "superseded";
  retention: { policy: string; retainUntil: string; legalHold: boolean; disposition: "review_at_end_of_period" | "permanent" };
  cybersecurity: { status: "not_reviewed" | "reviewed" | "needs_action"; classification: "public" | "internal" | "controlled" | "restricted"; controls: string[]; reviewer?: string; reviewedAt?: string };
  storagePath: string;
  notarization?: { provider: "Hedera"; network: "testnet-demo"; topicId: string; transactionId: string; messageHash: string; payloadHash: string; timestamp: string; status: "simulated" };
};

const dataDir = process.env.PART21_DATA_DIR || path.resolve(process.cwd(), "data");
const storageDir = path.join(dataDir, "controlled-documents");
const docs = new Map<string, DocumentRecord>();

function ensureSeeded() {
  fs.mkdirSync(storageDir, { recursive: true });
  if (docs.size) return;
  const seeded = [
    { title: "Supplier notification procedure", documentNumber: "PROC-SUP-021", revision: "C", tags: ["supplier", "Part 21", "controlled-procedure"], auditIds: ["AUD-026"], classification: "controlled" as const },
    { title: "NSS-4820 baseline acceptance record", documentNumber: "REC-NSS-4820", revision: "B", tags: ["genealogy", "baseline", "evidence"], auditIds: ["AUD-026", "AUD-021"], classification: "restricted" as const },
  ];
  for (const seed of seeded) {
    const content = Buffer.from(`${seed.documentNumber}|${seed.revision}|${seed.title}`);
    const id = `DOC-${seed.documentNumber}`;
    const record: DocumentRecord = { id, title: seed.title, documentNumber: seed.documentNumber, revision: seed.revision, mimeType: "application/pdf", sizeBytes: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex"), source: "Synthetic document-control repository", auditIds: seed.auditIds, tags: seed.tags, receivedAt: "2026-11-10T14:00:00.000Z", effectiveDate: "2026-11-10", status: "controlled", retention: { policy: "Nuclear QA controlled record · 10 years", retainUntil: "2036-11-10", legalHold: false, disposition: "review_at_end_of_period" }, cybersecurity: { status: "reviewed", classification: seed.classification, controls: ["access logging", "least privilege", "malware scan", "integrity hash"], reviewer: "Security & Quality", reviewedAt: "2026-11-11T09:00:00.000Z" }, storagePath: path.join(storageDir, `${id}.bin`) };
    fs.writeFileSync(record.storagePath, content);
    docs.set(id, record);
  }
  for (const event of listAssuranceEvents({ type: "document.created" })) if (event.payload.document) docs.set(event.entityId || String((event.payload.document as DocumentRecord).id), event.payload.document as DocumentRecord);
}

export function listControlledDocuments(filters: { auditId?: string } = {}) {
  ensureSeeded();
  return Array.from(docs.values()).filter((doc) => !filters.auditId || doc.auditIds.includes(filters.auditId));
}

export function getDocumentControlStatus() {
  ensureSeeded();
  return { integration: "controlled-document-repository", status: "operational_demo", storage: "local durable file store + event ledger", documents: docs.size, retentionControls: true, cybersecurityReview: true, hederaNotarization: "simulated testnet example", productionTarget: "qualified document management system with immutable retention, records hold, malware scanning, RBAC, and real Hedera credentials if selected" };
}

export function registerControlledDocument(input: { title?: string; documentNumber?: string; revision?: string; mimeType?: string; base64?: string; source?: string; auditIds?: string[]; tags?: string[]; effectiveDate?: string; classification?: DocumentRecord["cybersecurity"]["classification"]; actor?: string }) {
  ensureSeeded();
  const content = Buffer.from((input.base64 || "").replace(/^data:.*?;base64,/, ""), "base64");
  if (!content.length) return { ok: false, error: "A document payload is required." };
  const id = `DOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const storagePath = path.join(storageDir, `${id}.bin`);
  fs.writeFileSync(storagePath, content);
  const receivedAt = new Date().toISOString();
  const record: DocumentRecord = { id, title: input.title || "Controlled document", documentNumber: input.documentNumber || id, revision: input.revision || "A", mimeType: input.mimeType || "application/octet-stream", sizeBytes: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex"), source: input.source || "Application upload", auditIds: input.auditIds || ["AUD-026"], tags: input.tags || [], receivedAt, effectiveDate: input.effectiveDate || receivedAt.slice(0, 10), status: "pending_review", retention: { policy: "Nuclear QA controlled record · 10 years", retainUntil: `${Number((input.effectiveDate || receivedAt.slice(0, 10)).slice(0, 4)) + 10}${(input.effectiveDate || receivedAt.slice(0, 10)).slice(4)}`, legalHold: false, disposition: "review_at_end_of_period" }, cybersecurity: { status: "not_reviewed", classification: input.classification || "controlled", controls: [] }, storagePath };
  docs.set(id, record);
  const event = appendAssuranceEvent({ type: "document.created", actor: input.actor || "Document controller", entityId: id, auditId: record.auditIds[0], payload: { document: record, humanGate: "Document control and cybersecurity review required before controlled status." } });
  return { ok: true, document: record, event };
}

export function reviewDocumentCybersecurity(documentId: string, input: { reviewer?: string; status?: "reviewed" | "needs_action"; controls?: string[]; note?: string }) {
  ensureSeeded();
  const document = docs.get(documentId);
  if (!document) return { ok: false, error: "Document not found." };
  document.cybersecurity = { ...document.cybersecurity, status: input.status || "reviewed", controls: input.controls || ["access logging", "least privilege", "malware scan", "integrity hash"], reviewer: input.reviewer || "Security reviewer", reviewedAt: new Date().toISOString() };
  if (document.cybersecurity.status === "reviewed") document.status = "controlled";
  const event = appendAssuranceEvent({ type: "document.cybersecurity_reviewed", actor: input.reviewer || "Security reviewer", entityId: documentId, auditId: document.auditIds[0], payload: { documentId, cybersecurity: document.cybersecurity, note: input.note || "Cybersecurity review completed" } });
  return { ok: true, document, event };
}

export function notarizeDocumentWithHederaDemo(documentId: string, actor = "Quality approver") {
  ensureSeeded();
  const document = docs.get(documentId);
  if (!document) return { ok: false, error: "Document not found." };
  const payload = { documentId: document.id, documentNumber: document.documentNumber, revision: document.revision, sha256: document.sha256, effectiveDate: document.effectiveDate, auditIds: document.auditIds };
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const notarization = { provider: "Hedera" as const, network: "testnet-demo" as const, topicId: "0.0.1234567", transactionId: `0.0.9876546@${Math.floor(Date.now() / 1000)}.${Math.floor(Math.random() * 1000000000)}`, messageHash: crypto.createHash("sha256").update(document.sha256).digest("hex"), payloadHash, timestamp: new Date().toISOString(), status: "simulated" as const };
  document.notarization = notarization;
  const event = appendAssuranceEvent({ type: "document.notarized", actor, entityId: documentId, auditId: document.auditIds[0], payload: { notarization, canonicalPayload: payload, warning: "Simulated Hedera testnet example; no external Hedera transaction was submitted." } });
  return { ok: true, documentId, notarization, canonicalPayload: payload, event, warning: "This is a demonstration hash and transaction shape. It is not a real Hedera transaction." };
}

export function generateSyntheticPart21Decision(documentId: string, actor = "Part 21 review agent") {
  ensureSeeded();
  const document = docs.get(documentId);
  if (!document) return { ok: false, error: "Document not found." };
  const decision = {
    decisionId: `P21-DEC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    documentId: document.id,
    auditId: document.auditIds[0],
    generatedAt: new Date().toISOString(),
    status: "synthetic_demo_only" as const,
    applicability: { outcome: "potentially_applicable", confidence: 0.82, basis: ["10 CFR 21.3 definition and scope context", "10 CFR 21.21 evaluation and notification decision path", "10 CFR 21.51 records and reporting support"] },
    reportability: { outcome: "qualified_human_determination_required", rationale: "The synthetic record indicates a possible defect or noncompliance signal, but does not establish a substantial safety hazard or final reporting obligation.", recommendedNextStep: "Complete the Part 21 evaluation, document the technical basis, obtain quality/legal/regulatory review, and record the final disposition." },
    evidenceBasis: [{ source: document.title, revision: document.revision, sha256: document.sha256 }, { source: "AUD-026 synthetic finding register", reference: "FIND-2026-04" }],
    humanGates: ["Qualified nuclear/quality review", "Legal/compliance interpretation", "Authorized notification decision", "Immutable decision record"],
    warning: "Synthetic generation for demonstration only. This is not a legal conclusion, NRC notification, or client-approved Part 21 determination."
  };
  const event = appendAssuranceEvent({ type: "part21.synthetic_decision_generated", actor, entityId: decision.decisionId, auditId: document.auditIds[0], payload: decision });
  return { ok: true, decision, event };
}
