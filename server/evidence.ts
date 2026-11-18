import { createHash, randomUUID } from "node:crypto";
import { upsertDomainRecord, listDomainRecords, getDomainPortfolio } from "./domain-store";
import { assessRemediationImpact, regulatoryTraceForFinding } from "../shared/regulatory";

type EvidenceRecord = { id: string; name: string; mimeType: string; size: number; tags: string[]; linkedFinding: string; status: string; receivedAt: string; sha256: string; storage: string; auditId: string; contentBase64?: string };

export async function registerEvidence(input: { name?: string; mimeType?: string; size?: number; tags?: string[]; linkedFinding?: string; auditId?: string; contentBase64?: string; actor?: string }) {
  const contentBase64 = input.contentBase64 ?? "";
  if (!contentBase64) return { ok: false, error: "A document payload is required." };
  const id = `UP-${randomUUID().slice(0, 8).toUpperCase()}`;
  const record: EvidenceRecord = { id, name: input.name ?? "untitled-evidence", mimeType: input.mimeType ?? "application/octet-stream", size: Number(input.size ?? Buffer.from(contentBase64, "base64").length), tags: input.tags ?? [], linkedFinding: input.linkedFinding ?? "FIND-2026-04", status: "Pending human verification", receivedAt: new Date().toISOString(), sha256: createHash("sha256").update(Buffer.from(contentBase64.replace(/^data:.*?;base64,/, ""), "base64")).digest("hex"), storage: "mysql-domain-record", auditId: input.auditId ?? "AUD-026", contentBase64 };
  await upsertDomainRecord({ recordType: "evidence", recordId: id, auditId: record.auditId, payload: record });
  const { contentBase64: _content, ...safeRecord } = record;
  return { ok: true, record: safeRecord, traceability: { linkedTo: [record.linkedFinding, record.auditId], humanReviewRequired: true, sourceType: "database-evidence-record", sha256: record.sha256, storage: record.storage } };
}

export async function getReportDraft(findingId = "FIND-2026-04", auditId = "AUD-026") {
  const portfolio = await getDomainPortfolio(auditId);
  const finding = portfolio.findings.find((item: any) => item.id === findingId) ?? portfolio.findings[0];
  const linkedUploads = portfolio.evidence.filter((item: any) => item.linkedFinding === findingId).map(({ contentBase64: _content, ...safe }: any) => safe);
  const impact = assessRemediationImpact(findingId);
  return { reportType: "audit-report-draft", findingId, generatedAt: new Date().toISOString(), dataSource: "mysql-database", sections: { executiveSummary: `Audit ${auditId} has a database-backed finding requiring action before baseline acceptance.`, condition: finding?.title ?? "Condition pending auditor input", regulatoryBasis: { regulation: "10 CFR Part 21", sections: regulatoryTraceForFinding.path, violationHypothesis: regulatoryTraceForFinding.violationHypothesis, sourceLinks: ["https://www.ecfr.gov/current/title-10/chapter-I/part-21"] }, riskAndImpact: { risk: impact.risk, impactIfNotRemediated: impact.impactIfNotRemediated }, criteria: ["21.51 identification and traceability", "21.61 nonconforming articles and corrective action"], evidenceBasis: linkedUploads, auditorNarrative: "Add auditor narrative, sampling method, and interview notes here.", correctiveAction: { recommendedSteps: impact.remediation, auditorEdits: "Add owner, due date, effectiveness test, and evidence request." }, recommendation: "Resolve the database-backed evidence chain before accepting the configuration baseline.", linkedUploads }, humanGate: "Auditor edits, client-approved regulatory interpretation, and quality approver acceptance required before issue" };
}

export async function listEvidence(auditId = "AUD-026") { return listDomainRecords<EvidenceRecord>("evidence", auditId); }
