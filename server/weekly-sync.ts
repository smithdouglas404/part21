import { getControlledPolicyCoverage } from "./policy-runtime";
import { syncLocalWorkbooks } from "./xlsx-adapter";
import { buildAuditReadinessReport } from "./agentkit";
import { getReportDraft } from "./evidence";
import { appendAssuranceEvent } from "./event-store";
import { listAudits } from "./domain-store";

const connectorRegistry = [
  { id: "excel-local-directory", label: "Excel / local directory", status: "connected" },
  { id: "sap-erp", label: "SAP ERP", status: "configure_later" },
  { id: "salesforce-supplier", label: "Salesforce supplier relationship", status: "configure_later" },
  { id: "document-control", label: "Document control repository", status: "configure_later" },
  { id: "configuration-management", label: "Configuration management", status: "configure_later" },
];

export async function runWeeklySourceSync(actor = "Weekly Part 21 scheduler") {
  const workbookSync = await syncLocalWorkbooks(actor);
  const audits = await listAudits();
  const auditId = String((audits as any[])[0]?.id ?? "");
  if (!auditId) throw new Error("No database audit is available for weekly synchronization.");
  const readiness = await buildAuditReadinessReport(auditId);
  const policyCoverage = await getControlledPolicyCoverage(auditId);
  const report = {
    runId: `SYNC-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    startedAt: new Date().toISOString(),
    workbookSync,
    connectedSources: connectorRegistry.filter((connector) => connector.status === "connected"),
    pendingConnectorSetup: connectorRegistry.filter((connector) => connector.status !== "connected"),
    complianceChecks: { auditReadiness: readiness, policyCoverage, supplierRisk: { status: "review_required", recommendation: "Run supplier risk once the ERP/Salesforce connector is configured; do not infer supplier state from an unconnected source." } },
    generatedReportDraft: await getReportDraft(String((readiness.findings as any[])[0]?.id ?? ""), auditId),
    humanGates: ["Review changed workbook revisions", "Approve any graph-overlay promotion", "Validate Part 21 applicability and interpretation with qualified SMEs", "Do not file or notify automatically"],
  };
  const event = await appendAssuranceEvent({ type: "weekly.compliance_sync_completed", actor, auditId, payload: report });
  return { ...report, event };
}
