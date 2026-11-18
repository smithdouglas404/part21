import { getPolicyCoverage } from "../shared/policy";
import { syncLocalWorkbooks } from "./xlsx-adapter";
import { buildAuditReadinessReport } from "./agentkit";
import { getReportDraft } from "./evidence";
import { appendAssuranceEvent } from "./event-store";

const connectorRegistry = [
  { id: "excel-local-directory", label: "Excel / local directory", status: "connected" },
  { id: "sap-erp", label: "SAP ERP", status: "configure_later" },
  { id: "salesforce-supplier", label: "Salesforce supplier relationship", status: "configure_later" },
  { id: "document-control", label: "Document control repository", status: "configure_later" },
  { id: "configuration-management", label: "Configuration management", status: "configure_later" },
];

export async function runWeeklySourceSync(actor = "Weekly Part 21 scheduler") {
  const workbookSync = syncLocalWorkbooks(actor);
  const readiness = await buildAuditReadinessReport("AUD-026");
  const policyCoverage = getPolicyCoverage("AUD-026");
  const report = {
    runId: `SYNC-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    startedAt: new Date().toISOString(),
    workbookSync,
    connectedSources: connectorRegistry.filter((connector) => connector.status === "connected"),
    pendingConnectorSetup: connectorRegistry.filter((connector) => connector.status !== "connected"),
    complianceChecks: { auditReadiness: readiness, policyCoverage, supplierRisk: { status: "review_required", recommendation: "Run supplier risk once the ERP/Salesforce connector is configured; do not infer supplier state from an unconnected source." } },
    generatedReportDraft: await getReportDraft("FIND-2026-04"),
    humanGates: ["Review changed workbook revisions", "Approve any graph-overlay promotion", "Validate Part 21 applicability and interpretation with qualified SMEs", "Do not file or notify automatically"],
  };
  const event = appendAssuranceEvent({ type: "weekly.compliance_sync_completed", actor, auditId: "AUD-026", payload: report });
  return { ...report, event };
}
