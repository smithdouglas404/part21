import { mcpTools } from "../shared/demo";
import { getControlledConfiguration, listControlledConfigurationPayloads } from "./config-store";
import { assessControlledRemediationImpact, getControlledRegulatoryPack, traverseControlledRegulatoryTree } from "./regulatory-runtime";
import { buildControlledPolicyGraph, compileControlledDocumentToPolicy, evaluateControlledPolicy, getControlledPolicyCoverage } from "./policy-runtime";
import { approveWorkbookImport, importLocalWorkbook, importWorkbookPayload, listLocalWorkbooks, listSampleWorkbooks, readWorkbookSample, compareSnapshots } from "./xlsx-adapter";
import { runWeeklySourceSync } from "./weekly-sync";
import { getGroundedGraphContext } from "./graph-store";
import { getDomainPortfolio, upsertDomainRecord } from "./domain-store";
import { attachKanbanAsset, createKanbanItem, listKanbanItems, moveKanbanItem } from "./kanban-store";
import { buildLiveAuditBriefAgent, runFindingIntakeDialogue } from "./ai";

export async function getMcpManifest() {
  const configuredConnectors = await listControlledConfigurationPayloads<any>("connector");
  return {
    name: "part21-assurance-demo",
    version: "1.0.0-mcp",
    dataMode: "client-owned-database-required",
    description: "Part 21 Assurance OS MCP server. Operational tools read client-owned database and graph records; unconnected sources return explicit TBD states.",
    connectors: configuredConnectors.map((item) => item.payload),
    tools: mcpTools,
  };
}

export async function callMcpTool(name: string, args: Record<string, unknown> = {}) {
  switch (name) {
    case "search_entities": {
      const query = String(args.query ?? "").toLowerCase();
      const types = Array.isArray(args.types) ? args.types.map(String) : undefined;
      const context = await getGroundedGraphContext(String(args.findingId ?? ""));
      const nodes = context.nodes.filter((node: any) => {
        const matchesQuery = !query || [node.id, node.label, node.meta, node.description].join(" ").toLowerCase().includes(query);
        const matchesType = !types || types.includes(node.type);
        return matchesQuery && matchesType;
      });
      return { query, count: nodes.length, entities: nodes, source: context.source };
    }
    case "ontology_resolve": {
      const sourceId = String(args.sourceId ?? "");
      const graph = await getGroundedGraphContext(String(args.findingId ?? ""));
      const ontology = (await getControlledConfiguration<any>("ontology", "part21-assurance-ontology")).payload;
      const entity = graph.nodes.find((node: any) => node.id === sourceId || node.identifier === sourceId || node.sourceId === sourceId) ?? null;
      return { sourceId, mapping: entity, context: entity ? { entity, ontologyVersion: ontology.version } : null, ontologyVersion: ontology.version, source: graph.source };
    }
    case "temporal_findings_query":
      return { findingId: args.findingId ?? "", temporalModel: (await getControlledConfiguration<any>("ontology", "part21-assurance-ontology")).payload.temporalModel, history: (await getGroundedGraphContext(String(args.findingId ?? ""))).temporalEvents, asOf: args.asOf ?? new Date().toISOString(), source: "mysql-database" };
    case "traverse_regulatory_tree":
      return traverseControlledRegulatoryTree(String(args.findingId ?? ""));
    case "assess_remediation_impact":
      return assessControlledRemediationImpact(String(args.findingId ?? ""));
    case "policy_evaluate":
      return evaluateControlledPolicy(String(args.findingId ?? ""), String(args.asOf ?? new Date().toISOString().slice(0, 10)));
    case "policy_coverage":
      return getControlledPolicyCoverage(String(args.auditId ?? ""));
    case "policy_graph":
      return buildControlledPolicyGraph();
    case "policy_compile":
      return compileControlledDocumentToPolicy(String(args.documentId ?? "10-cfr-part-21"));
    case "recommend_remediation": {
      const impact = await assessControlledRemediationImpact(String(args.findingId ?? ""));
      const pack = await getControlledRegulatoryPack();
      return { ...impact, recommendationBasis: "Part 21 source pack + client-approved interpretation overlay required", sourceLinks: pack.sources, recommendations: impact.remediation.map((step: string, index: number) => ({ priority: index + 1, action: step, evidenceToClose: "Attach source record and accountable approval", humanGate: "Compliance / quality approval required" })) };
    }
    case "trace_product_genealogy": {
      const context = await getGroundedGraphContext(String(args.findingId ?? ""));
      const node = context.nodes.find((item: any) => item.id === String(args.productId ?? "prod-4820"));
      const relationships = context.edges.filter((edge: any) => edge.from === node?.id || edge.to === node?.id);
      return { root: node ?? null, relationships, related: relationships.map((edge: any) => context.nodes.find((item: any) => item.id === (edge.from === node?.id ? edge.to : edge.from))).filter(Boolean), provenance: "mysql-database graph projection", source: context.source };
    }
    case "compare_temporal_versions": {
      return {
        entity: (await getGroundedGraphContext(String(args.findingId ?? ""))).nodes.find((item: any) => item.id === String(args.entityId ?? "prod-4820")) ?? null,
        from: args.from ?? "2025-01-01",
        to: args.to ?? "2026-04-14",
        events: (await getGroundedGraphContext(String(args.findingId ?? ""))).temporalEvents,
        potentialCauses: [],
        involvedPeople: [],
      };
    }
    case "check_audit_readiness": {
      const portfolio = await getDomainPortfolio(String(args.auditId ?? ""));
      return { audit: portfolio.audit, readiness: (portfolio.metrics as any)?.readiness ?? null, staleEvidence: (portfolio.evidence as any[]).filter((item: any) => item.state === "Review due").length, unresolvedFindings: portfolio.findings, source: portfolio.source, recommendedNextMove: "Review database findings and evidence gaps before taking action." };
    }
    case "detect_control_gaps": { const portfolio = await getDomainPortfolio(String(args.auditId ?? "")); const controlRows = portfolio.controls as any[]; return { controls: controlRows, gapCount: controlRows.filter((control) => control.status === "Gap").length, watchCount: controlRows.filter((control) => control.status === "Watch").length, source: portfolio.source }; }
    case "evaluate_supplier_risk": {
      const portfolio = await getDomainPortfolio(String(args.auditId ?? ""));
      const supplier = (portfolio.suppliers as any[]).find((item) => !args.supplierId || item.id === String(args.supplierId));
      if (!supplier) return { supplierId: args.supplierId ?? null, status: "not_found", source: portfolio.source };
      const related = (portfolio.findings as any[]).filter((item) => item.supplierId === supplier.id);
      return { supplier, supplierId: supplier.id, risk: related.length ? "Watch" : "Low", score: related.length ? 64 : 18, drivers: related.map((item) => item.title), recommendation: related.length ? "Request supplier evidence and qualified review before baseline approval." : "Continue database-backed monitoring.", source: portfolio.source };
    }
    case "create_finding": {
      const auditId = String(args.auditId ?? "");
      const findingId = `F-${Date.now()}`;
      const record = { id: findingId, title: String(args.title ?? "Untitled finding"), status: "Open", severity: String(args.severity ?? "Moderate"), sourceIds: Array.isArray(args.sourceIds) ? args.sourceIds : [], auditId, createdAt: new Date().toISOString() };
      await upsertDomainRecord({ recordType: "finding", recordId: findingId, auditId, payload: record });
      return { finding: record, status: "human_review_required", source: "mysql-domain-record" };
    }
    case "recommend_next_moves": {
      const portfolio = await getDomainPortfolio(String(args.auditId ?? ""));
      return { context: args.context ?? "", recommendations: (portfolio.findings as any[]).filter((item) => item.status !== "Closed").map((item) => `Review ${item.id}: ${item.title}`), explainability: "Recommendations are derived from open database findings and linked evidence.", source: portfolio.source };
    }
    case "get_evidence":
      return { evidence: (await getDomainPortfolio(String(args.auditId ?? ""))).evidence, source: "mysql-database" };
    case "get_sources":
      return { sources: (await getDomainPortfolio(String(args.auditId ?? ""))).sources, source: "mysql-database" };
    case "get_findings":
      return { findings: (await getDomainPortfolio(String(args.auditId ?? ""))).findings, source: "mysql-database" };
    case "excel_list_workbooks":
      return { ...(await listLocalWorkbooks()), samples: (await listSampleWorkbooks()).samples };
    case "excel_describe_workbook":
      return await readWorkbookSample();
    case "excel_read_range": {
      const sample = await readWorkbookSample();
      const snapshot = (sample as any).snapshot;
      const sheet = snapshot?.sheets?.find((item: any) => item.name === String(args.sheet ?? "")) ?? snapshot?.sheets?.[0];
      return sheet ? { workbookId: snapshot.id, sheet: sheet.name, rows: sheet.sample.slice(0, Number(args.limit ?? 25)), provenance: snapshot.sha256 } : sample;
    }
    case "excel_import_workbook":
      return await importWorkbookPayload({ filename: String(args.filename ?? "uploaded-workbook.xlsx"), base64: String(args.base64 ?? ""), actor: String(args.actor ?? "MCP caller"), source: "MCP workbook adapter" });
    case "excel_import_local_workbook":
      return await importLocalWorkbook(String(args.filename ?? ""), String(args.actor ?? "MCP local caller"));
    case "excel_compare_revision":
      return { comparison: compareSnapshots(null, (await readWorkbookSample() as any).snapshot ?? null), humanGate: "Approve graph import before any entity or relationship mutation." };
    case "excel_approve_import":
      return await approveWorkbookImport(String(args.workbookId ?? ""), String(args.actor ?? "MCP caller"), String(args.note ?? "Approved after human review"));
    case "run_weekly_source_sync":
      return runWeeklySourceSync(String(args.actor ?? "MCP scheduler"));
    case "field_kanban_list": {
      const auditId = String(args.auditId ?? "");
      const kanban = await listKanbanItems(auditId);
      const portfolio = await getDomainPortfolio(auditId);
      const findings = portfolio.findings as any[];
      const findingsById = new Map(findings.map((finding) => [String(finding.id), finding]));
      const attachmentsById = new Map((kanban.attachments as any[]).map((attachment) => [String(attachment.id), attachment]));
      const communicationsByItemId = new Map<string, any[]>();
      for (const communication of kanban.communications as any[]) communicationsByItemId.set(String(communication.itemId), [...(communicationsByItemId.get(String(communication.itemId)) ?? []), communication]);
      const items = (kanban.items as any[]).map((item) => {
        const linkedFinding = item.findingId ? findingsById.get(String(item.findingId)) ?? null : null;
        const attachments = (item.attachmentIds ?? []).map((id: string) => attachmentsById.get(String(id))).filter(Boolean);
        const communications = communicationsByItemId.get(String(item.id)) ?? [];
        const hasSpecificDescription = typeof item.description === "string" && item.description.trim().length >= 20;
        const traceabilityStatus = linkedFinding ? "confirmed_finding_link" : (item.productId || item.sourceRecordId ? "explicit_source_reference" : "unlinked_observation");
        return {
          ...item,
          linkedFinding,
          attachments,
          communications,
          communicationCount: communications.length,
          appliedSkillIds: [...new Set([...((item.skillIds ?? []) as string[]), ...communications.flatMap((communication: any) => communication.skillIds ?? [])])],
          traceability: { status: traceabilityStatus, confirmed: Boolean(linkedFinding || item.productId || item.sourceRecordId), findingId: item.findingId ?? null, productId: item.productId ?? null, sourceRecordId: item.sourceRecordId ?? null },
          evidenceQuality: { descriptionSpecific: hasSpecificDescription, attachmentCount: attachments.length, status: hasSpecificDescription || attachments.length ? "reviewable" : "insufficient_detail" },
          factBoundary: linkedFinding ? "This finding link is stored on the Kanban record." : "No confirmed finding or source-record link is stored; do not infer one from title similarity."
        };
      });
      return {
        ...kanban,
        items,
        traceabilitySummary: {
          confirmedLinks: items.filter((item: any) => item.traceability.confirmed).length,
          unlinkedObservations: items.filter((item: any) => item.traceability.status === "unlinked_observation").length,
          insufficientDetail: items.filter((item: any) => item.evidenceQuality.status === "insufficient_detail").length,
          availableFindingIds: findings.map((finding) => finding.id),
          factBoundary: "Only explicit findingId, productId, sourceRecordId, descriptions, and attachment records are facts. Similar titles are hypotheses and are not returned as confirmed relationships."
        },
        findingKanbanStatus: findings.map((finding) => ({ findingId: finding.id, title: finding.title, status: finding.status, severity: finding.severity, kanbanItems: items.filter((item: any) => item.findingId === finding.id).map((item: any) => ({ id: item.id, status: item.status, priority: item.priority, attention: item.attention })) })),
        source: "mysql-domain-records-plus-audit-portfolio"
      };
    }
    case "audit_brief_agent":
      return buildLiveAuditBriefAgent(String(args.auditId ?? ""), String(args.question ?? "Give me a complete fact-based audit brief."));
    case "agent_intake":
      return runFindingIntakeDialogue({ auditId: String(args.auditId ?? ""), message: String(args.message ?? ""), conversationId: args.conversationId ? String(args.conversationId) : undefined, finalize: args.finalize === true, draftTitle: args.draftTitle ? String(args.draftTitle) : undefined, draftDescription: args.draftDescription ? String(args.draftDescription) : undefined, severity: args.severity ? String(args.severity) : undefined, actor: args.actor ? String(args.actor) : undefined });
    case "field_kanban_create":
      return createKanbanItem({ auditId: String(args.auditId ?? ""), title: String(args.title ?? ""), description: String(args.description ?? ""), status: (args.status as any) ?? "backlog", priority: (args.priority as any) ?? "medium", attention: true, source: "field", ownerPersonId: args.ownerPersonId ? String(args.ownerPersonId) : undefined, findingId: args.findingId ? String(args.findingId) : undefined, productId: args.productId ? String(args.productId) : undefined, sourceRecordId: args.sourceRecordId ? String(args.sourceRecordId) : undefined, observedAt: args.observedAt ? String(args.observedAt) : undefined, createdBy: String(args.createdBy ?? "Muse field operator") });
    case "field_kanban_move":
      return moveKanbanItem(String(args.itemId ?? ""), (String(args.status ?? "backlog").toLowerCase() === "active" ? "in_progress" : String(args.status ?? "backlog").toLowerCase()) as any, String(args.actor ?? "Muse field operator"));
    case "field_kanban_attach":
      return attachKanbanAsset({ itemId: String(args.itemId ?? ""), auditId: String(args.auditId ?? ""), filename: String(args.filename ?? "field-attachment"), mediaType: String(args.mediaType ?? "application/octet-stream"), kind: (args.kind as any) ?? "document", base64: args.base64 ? String(args.base64) : undefined, transcript: args.transcript ? String(args.transcript) : undefined, createdBy: String(args.createdBy ?? "Muse field operator") });
    default:
      return { error: `Unknown tool: ${name}`, availableTools: mcpTools.map((tool) => tool.name) };
  }
}
