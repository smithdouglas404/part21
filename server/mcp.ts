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

export function getMcpManifest() {
  return {
    name: "part21-assurance-demo",
    version: "0.1.0-demo",
    dataMode: "synthetic",
    description: "MCP-style adapter surface for a Part 21 assurance prototype.",
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
    default:
      return { error: `Unknown tool: ${name}`, availableTools: mcpTools.map((tool) => tool.name) };
  }
}
