import {
  audits,
  controls,
  evidence,
  findings,
  getGraphNode,
  graphEdges,
  graphNodes,
  mcpTools,
  sources,
  timelineEvents,
} from "../shared/demo";
import { getFindingOntologyContext, getTemporalHistory, part21Ontology, resolveOntology } from "../shared/ontology";
import { assessRemediationImpact, part21RegulatoryPack, traverseRegulatoryTree } from "../shared/regulatory";
import { compileDocumentToPolicy, evaluatePart21Policy, getPolicyCoverage, buildPolicyGraph } from "../shared/policy";
import { approveWorkbookImport, importLocalWorkbook, importWorkbookPayload, listLocalWorkbooks, listSampleWorkbooks, readWorkbookSample, compareSnapshots } from "./xlsx-adapter";
import { runWeeklySourceSync } from "./weekly-sync";

export function getMcpManifest() {
  return {
    name: "part21-assurance-demo",
    version: "1.0.0-mcp",
    dataMode: "synthetic",
    description: "Part 21 Assurance OS MCP server. Local Excel directory access is active; client-owned enterprise connectors are configuration-ready.",
    connectors: [
      { id: "excel-local-directory", label: "Excel / local directory", status: "connected", transport: "streamable-http + stdio", configuration: "EXCEL_ROOT" },
      { id: "sap-erp", label: "SAP ERP", status: "configure_later", transport: "MCP or OData", configuration: "SAP_MCP_URL / secret manager" },
      { id: "salesforce-supplier", label: "Salesforce supplier relationship", status: "configure_later", transport: "MCP or REST", configuration: "SALESFORCE_MCP_URL / OAuth" },
      { id: "document-control", label: "Document control repository", status: "configure_later", transport: "MCP or REST", configuration: "DOCUMENT_REPOSITORY_MCP_URL / OAuth" },
      { id: "configuration-management", label: "Configuration management", status: "configure_later", transport: "MCP or API", configuration: "CONFIGURATION_MCP_URL / OAuth" },
    ],
    tools: mcpTools,
  };
}

export function callMcpTool(name: string, args: Record<string, unknown> = {}) {
  switch (name) {
    case "search_entities": {
      const query = String(args.query ?? "").toLowerCase();
      const types = Array.isArray(args.types) ? args.types.map(String) : undefined;
      const nodes = graphNodes.filter((node) => {
        const matchesQuery = !query || [node.id, node.label, node.meta, node.description].join(" ").toLowerCase().includes(query);
        const matchesType = !types || types.includes(node.type);
        return matchesQuery && matchesType;
      });
      return { query, count: nodes.length, entities: nodes };
    }
    case "ontology_resolve":
      return { sourceId: args.sourceId ?? "FIND-2026-04", mapping: resolveOntology(String(args.sourceId ?? "FIND-2026-04")), context: getFindingOntologyContext(String(args.sourceId ?? "FIND-2026-04")), ontologyVersion: part21Ontology.version };
    case "temporal_findings_query":
      return { findingId: args.findingId ?? "FIND-2026-04", temporalModel: part21Ontology.temporalModel, history: getTemporalHistory("finding-2026-04"), asOf: args.asOf ?? new Date().toISOString() };
    case "traverse_regulatory_tree":
      return traverseRegulatoryTree(String(args.findingId ?? "FIND-2026-04"));
    case "assess_remediation_impact":
      return assessRemediationImpact(String(args.findingId ?? "FIND-2026-04"));
    case "policy_evaluate":
      return evaluatePart21Policy(String(args.findingId ?? "FIND-2026-04"), String(args.asOf ?? new Date().toISOString().slice(0, 10)));
    case "policy_coverage":
      return getPolicyCoverage(String(args.auditId ?? "AUD-026"));
    case "policy_graph":
      return buildPolicyGraph();
    case "policy_compile":
      return compileDocumentToPolicy(String(args.documentId ?? "10-cfr-part-21"));
    case "recommend_remediation": {
      const impact = assessRemediationImpact(String(args.findingId ?? "FIND-2026-04"));
      return { ...impact, recommendationBasis: "Part 21 source pack + client-approved interpretation overlay required", sourceLinks: part21RegulatoryPack.sources, recommendations: impact.remediation.map((step, index) => ({ priority: index + 1, action: step, evidenceToClose: "Attach source record and accountable approval", humanGate: "Compliance / quality approval required" })) };
    }
    case "trace_product_genealogy": {
      const node = getGraphNode(String(args.productId ?? "prod-4820"));
      const relatedIds = graphEdges.flatMap((edge) => edge.from === node.id ? [edge.to] : edge.to === node.id ? [edge.from] : []);
      return {
        root: node,
        relationships: graphEdges.filter((edge) => edge.from === node.id || edge.to === node.id),
        related: relatedIds.map((id) => getGraphNode(id)),
        provenance: "Synthetic graph assembled from quality-system, supplier, document-control, and role-directory adapters.",
      };
    }
    case "compare_temporal_versions": {
      return {
        entity: getGraphNode(String(args.entityId ?? "prod-4820")),
        from: args.from ?? "2025-01-01",
        to: args.to ?? "2026-04-14",
        events: timelineEvents,
        potentialCauses: ["Supplier obsolescence notice", "Seat material substitution", "Receiving record reconciliation gap"],
        involvedPeople: ["R. Gomez", "M. Lee", "A. Patel"],
      };
    }
    case "check_audit_readiness": {
      const audit = audits.find((item) => item.id === args.auditId) ?? audits[0];
      return { audit, readiness: 82, staleEvidence: 4, unresolvedFindings: audit.findings, recommendedNextMove: "Resolve the orphaned heat-lot record and re-run evidence coverage." };
    }
    case "detect_control_gaps":
      return { controls, gapCount: controls.filter((control) => control.status === "Gap").length, watchCount: controls.filter((control) => control.status === "Watch").length };
    case "evaluate_supplier_risk":
      return { supplierId: args.supplierId ?? "SUP-044", risk: "Watch", score: 64, drivers: ["Notification latency", "Open linked finding", "Two impacted work instructions"], recommendation: "Request supplier equivalency evidence before baseline approval." };
    case "create_finding":
      return { draftId: "F-DRAFT-NEW", status: "human_review_required", proposedSeverity: "Moderate", sourceIds: args.sourceIds ?? [], title: args.title ?? "Untitled finding", note: "Synthetic draft only; accountable reviewer must approve before persistence." };
    case "recommend_next_moves":
      return { context: args.context ?? "AUD-026", recommendations: ["Resolve F-042 evidence chain", "Request supplier equivalency statement", "Revalidate 2 impacted work instructions", "Re-run 21.51 coverage check"], explainability: "Each move is grounded in synthetic graph edges, evidence freshness, and current findings." };
    case "get_evidence":
      return { evidence };
    case "get_sources":
      return { sources };
    case "get_findings":
      return { findings };
    case "excel_list_workbooks":
      return { ...listLocalWorkbooks(), samples: listSampleWorkbooks().samples };
    case "excel_describe_workbook":
      return readWorkbookSample();
    case "excel_read_range": {
      const sample = readWorkbookSample();
      const snapshot = (sample as any).snapshot;
      const sheet = snapshot?.sheets?.find((item: any) => item.name === String(args.sheet ?? "")) ?? snapshot?.sheets?.[0];
      return sheet ? { workbookId: snapshot.id, sheet: sheet.name, rows: sheet.sample.slice(0, Number(args.limit ?? 25)), provenance: snapshot.sha256 } : sample;
    }
    case "excel_import_workbook":
      return importWorkbookPayload({ filename: String(args.filename ?? "uploaded-workbook.xlsx"), base64: String(args.base64 ?? ""), actor: String(args.actor ?? "MCP caller"), source: "MCP workbook adapter" });
    case "excel_import_local_workbook":
      return importLocalWorkbook(String(args.filename ?? ""), String(args.actor ?? "MCP local caller"));
    case "excel_compare_revision":
      return { comparison: compareSnapshots(null), humanGate: "Approve graph import before any entity or relationship mutation." };
    case "excel_approve_import":
      return approveWorkbookImport(String(args.workbookId ?? ""), String(args.actor ?? "MCP caller"), String(args.note ?? "Approved after human review"));
    case "run_weekly_source_sync":
      return runWeeklySourceSync(String(args.actor ?? "MCP scheduler"));
    default:
      return { error: `Unknown tool: ${name}`, availableTools: mcpTools.map((tool) => tool.name) };
  }
}
