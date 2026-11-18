import { createHash, randomUUID } from "node:crypto";
import { buildAuditReadinessReport } from "./agentkit";
import { assessRemediationImpact, regulatoryTraceForFinding } from "../shared/regulatory";

const registeredEvidence: Array<{ id: string; name: string; mimeType: string; size: number; tags: string[]; linkedFinding: string; status: string; receivedAt: string; sha256: string; storage: string; contentBase64?: string }> = [];

export function registerEvidence(input: { name?: string; mimeType?: string; size?: number; tags?: string[]; linkedFinding?: string; contentBase64?: string }) {
  const contentBase64 = input.contentBase64 ?? "";
  const record = { id: `UP-${randomUUID().slice(0, 8).toUpperCase()}`, name: input.name ?? "untitled-evidence", mimeType: input.mimeType ?? "application/octet-stream", size: Number(input.size ?? 0), tags: input.tags ?? [], linkedFinding: input.linkedFinding ?? "FIND-2026-04", status: "Pending human verification", receivedAt: new Date().toISOString(), sha256: createHash("sha256").update(Buffer.from(contentBase64, "base64")).digest("hex"), storage: "demo-runtime-memory", contentBase64 };
  registeredEvidence.unshift(record);
  const { contentBase64: _content, ...safeRecord } = record;
  return { record: safeRecord, traceability: { linkedTo: [record.linkedFinding, "AUD-026"], humanReviewRequired: true, sourceType: "demo-runtime-upload", sha256: record.sha256, storage: record.storage } };
}

export function getReportDraft(findingId = "FIND-2026-04") {
  const report = buildAuditReadinessReport("AUD-026");
  const linkedUploads = registeredEvidence.filter((item) => item.linkedFinding === findingId).map(({ contentBase64: _content, ...safe }) => safe);
  const impact = assessRemediationImpact(findingId);
  return { reportType: "audit-report-draft", findingId, generatedAt: new Date().toISOString(), sections: { executiveSummary: `Audit AUD-026 is ${report.executivePosition.toLowerCase()} for ${findingId}, with action required before baseline acceptance.`, condition: report.findings[0]?.title ?? "Condition pending auditor input", regulatoryBasis: { regulation: "10 CFR Part 21", sections: regulatoryTraceForFinding.path, violationHypothesis: regulatoryTraceForFinding.violationHypothesis, sourceLinks: ["https://www.ecfr.gov/current/title-10/chapter-I/part-21"] }, riskAndImpact: { risk: impact.risk, impactIfNotRemediated: impact.impactIfNotRemediated }, criteria: ["21.51 identification and traceability", "21.61 nonconforming articles and corrective action"], evidenceBasis: report.evidence.filter((item) => item.linkedTo.includes("NSS-4820") || item.linkedTo.includes("F-042")), auditorNarrative: "Add auditor narrative, sampling method, and interview notes here.", correctiveAction: { recommendedSteps: impact.remediation, auditorEdits: "Add owner, due date, effectiveness test, and evidence request." }, recommendation: report.agentRecommendation, linkedUploads }, humanGate: "Auditor edits, client-approved regulatory interpretation, and quality approver acceptance required before issue" };
}
