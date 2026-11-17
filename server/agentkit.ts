import { audits, controls, evidence, findings, metrics, sources } from "../shared/demo";
import { auditPhases, auditSkills, agentKitAgents, getSkillForPhase } from "../shared/skills";
import { mcpConnectors, simulatedFinding, type SimulationStep } from "../shared/execution";
import { getFindingOntologyContext, ontologyMappings, part21Ontology, temporalRecords } from "../shared/ontology";

export function getAgentKitManifest() {
  return {
    protocol: "agentkit-demo",
    version: "0.1.0",
    executionContract: "ECC = Evidence, Context, Checkpoint",
    agents: agentKitAgents,
    skills: auditSkills.map(({ questions, ...skill }) => ({ ...skill, questionCount: questions.length })),
    phases: auditPhases,
    connectors: mcpConnectors,
    ontology: { id: part21Ontology.id, version: part21Ontology.version, temporalModel: part21Ontology.temporalModel, classCount: part21Ontology.classes.length, relationCount: part21Ontology.relations.length },
    storage: { provider: "PostgreSQL", connectionEnv: "POSTGRES_URL", tables: ["ontology_entities", "ontology_relationships", "temporal_events", "audit_decisions"], syncEndpoint: "/api/ontology/sync" },
  };
}

export function simulateFullAuditExecution(findingId = simulatedFinding.id): { finding: typeof simulatedFinding; status: "completed"; steps: SimulationStep[] } {
  const finding = { ...simulatedFinding, id: findingId };
  const steps: SimulationStep[] = [
    {
      phase: 1, phaseId: "scope", phaseLabel: "Frame the audit", agent: "scope-facilitator", route: "agentkit.audit.scope_framing", status: "Completed",
      toolCalls: [
        { sequence: 1, tool: "ontology_resolve", connector: "part21-assurance-ontology", arguments: { sourceId: finding.id }, result: "Finding → Audit → Product → Requirement / Supplier / Evidence / Change classes resolved", provenance: "Part 21 assurance ontology v0.1-demo" },
        { sequence: 2, tool: "search_entities", connector: "core-graph", arguments: { query: finding.id, types: ["finding", "product", "audit"] }, result: "Resolved FIND-2026-04 → AUD-026 → NSS-4820", provenance: "Ontology-mapped assurance graph" },
        { sequence: 3, tool: "detect_control_gaps", connector: "core-graph", arguments: { controlFamily: "traceability", productId: finding.productId }, result: "21.51 coverage watch; orphaned receiving edge detected", provenance: "Control coverage index" },
      ],
      humanGate: { gate: "Scope confirmation", approver: "M. Lee · Audit lead", decision: "Approved", rationale: "Scope is limited to NSS-4820 receiving traceability, supplier records, and affected baseline documents.", timestamp: "2026-04-15T09:05:00Z" },
    },
    {
      phase: 2, phaseId: "evidence", phaseLabel: "Pull evidence", agent: "evidence-curator", route: "agentkit.audit.evidence_intake", status: "Completed",
      toolCalls: [
        { sequence: 4, tool: "erp_search_material_lots", connector: "vendor-erp-asterion", arguments: { supplierId: finding.supplierId, productId: finding.productId, lookbackDays: 180 }, result: "Heat 7B-441 found; 1 receiving inspection not linked to lot", provenance: "Asterion Vendor ERP · synthetic adapter" },
        { sequence: 5, tool: "erp_get_receiving_inspection", connector: "vendor-erp-asterion", arguments: { inspectionId: "2-481", productId: finding.productId }, result: "Inspection passed; material-lot foreign key unresolved", provenance: "Asterion Vendor ERP · synthetic adapter" },
        { sequence: 6, tool: "dms_search_revisions", connector: "document-repository-live", arguments: { query: "NSS-4820 CHG-014", effectiveFrom: "2026-03-01", effectiveTo: "2026-04-15" }, result: "EV-824 and CHG-014 package found; 2 work instructions impacted", provenance: "Controlled Document Repository · synthetic adapter" },
      ],
      humanGate: { gate: "Evidence sufficiency", approver: "S. Rao · Evidence owner", decision: "Approved with action", rationale: "Evidence is sufficient to trace the signal; the orphaned join remains an explicit open edge.", timestamp: "2026-04-15T09:18:00Z" },
    },
    {
      phase: 3, phaseId: "traceability", phaseLabel: "Trace the chain", agent: "genealogy-navigator", route: "agentkit.audit.trace_chain", status: "Completed",
      toolCalls: [
        { sequence: 7, tool: "trace_product_genealogy", connector: "core-graph", arguments: { productId: finding.productId, depth: 3 }, result: "8 ontology-mapped entities / 8 relationships; FIND-2026-04 edge unresolved at receiving → heat lot", provenance: "Part 21 ontology graph" },
        { sequence: 8, tool: "temporal_findings_query", connector: "bitemporal-event-store", arguments: { findingId: finding.id, asOf: "2026-04-15" }, result: "Finding became valid 2026-04-14; system recorded it 2026-04-14T09:10Z", provenance: "Valid-time + transaction-time event history" },
        { sequence: 9, tool: "compare_temporal_versions", connector: "core-graph", arguments: { entityId: finding.productId, from: "2025-06-09", to: "2026-04-15" }, result: "CHG-014 followed supplier obsolescence notice; 2 downstream documents changed", provenance: "Temporal graph" },
        { sequence: 10, tool: "dms_get_change_package", connector: "document-repository-live", arguments: { changeId: "CHG-014", includeApprovals: true }, result: "Change package approved by R. Gomez; baseline acceptance pending quality review", provenance: "Controlled Document Repository · synthetic adapter" },
      ],
      humanGate: { gate: "Trace acceptance", approver: "A. Patel · Configuration", decision: "Approved", rationale: "Upstream requirement and supplier change paths are explained; one evidence join remains a finding condition.", timestamp: "2026-04-15T09:34:00Z" },
    },
    {
      phase: 4, phaseId: "findings", phaseLabel: "Evaluate findings", agent: "finding-challenger", route: "agentkit.audit.finding_challenge", status: "Completed",
      toolCalls: [
        { sequence: 11, tool: "detect_control_gaps", connector: "core-graph", arguments: { controlFamily: "traceability", findingId: finding.id }, result: "Major candidate supported by 21.51 gap; no critical safety impact inferred", provenance: "Control coverage index" },
        { sequence: 12, tool: "create_finding", connector: "core-graph", arguments: { title: finding.title, sourceIds: ["EV-803", "2-481", "EV-771"], severity: "Major", ontologyClass: "Finding" }, result: "Draft FIND-2026-04 prepared; human approval required before issue", provenance: "Finding service · ontology-constrained synthetic draft" },
      ],
      humanGate: { gate: "Finding approval", approver: "M. Lee · Audit lead", decision: "Approved with action", rationale: "Major severity is accepted because traceability cannot be demonstrated end-to-end; owner and corrective action due date must be assigned.", timestamp: "2026-04-15T09:52:00Z" },
    },
    {
      phase: 5, phaseId: "closure", phaseLabel: "Review & close", agent: "readiness-facilitator", route: "agentkit.audit.readiness_close", status: "Completed",
      toolCalls: [
        { sequence: 13, tool: "check_audit_readiness", connector: "core-graph", arguments: { auditId: finding.auditId, ontology: "part21-assurance-ontology" }, result: "82% readiness; 3 findings in scope; 4 stale or review-due evidence records", provenance: "Ontology-backed audit readiness engine" },
        { sequence: 14, tool: "recommend_next_moves", connector: "core-graph", arguments: { context: finding.id, limit: 4, requireEvidenceLinks: true }, result: "Resolve heat-lot join; request equivalency statement; revalidate 2 work instructions; rerun 21.51 check", provenance: "Ontology-backed agent recommendation engine" },
      ],
      humanGate: { gate: "Report disposition", approver: "D. Novak · Quality approver", decision: "Approved with action", rationale: "Report may proceed as Ready with actions; baseline acceptance remains blocked until FIND-2026-04 is closed.", timestamp: "2026-04-15T10:10:00Z" },
    },
  ];
  return { finding, status: "completed", steps };
}

export function runAuditSkill(skillId: string, answers: Record<string, unknown> = {}) {
  const skill = auditSkills.find((item) => item.id === skillId) ?? auditSkills[0];
  const answered = skill.questions.filter((question) => answers[question.id] !== undefined && String(answers[question.id]).trim().length > 0).length;
  const required = skill.questions.filter((question) => question.required).length;
  return {
    skillId: skill.id,
    route: skill.route,
    agent: skill.agent,
    status: answered >= required ? "ready_for_human_gate" : "needs_more_context",
    completion: Math.round((answered / skill.questions.length) * 100),
    ecc: { contract: skill.eccContract, evidence: "linked synthetic records", context: skill.purpose, checkpoint: skill.humanGate },
    nextQuestions: skill.questions.filter((question) => question.required && !answers[question.id]).map((question) => question.id),
    recommendation: answered >= required ? skill.completionSignal : `Answer the remaining ${Math.max(required - answered, 0)} required question(s) before routing to the human gate.`,
  };
}

export function buildAuditReadinessReport(auditId = "AUD-026") {
  const audit = audits.find((item) => item.id === auditId) ?? audits[0];
  return {
    reportType: "audit-readiness",
    reportVersion: "0.1-demo",
    generatedAt: new Date().toISOString(),
    dataMode: "synthetic",
    audit,
    executivePosition: "Ready with actions",
    metrics,
    controls,
    findings,
    evidence,
    sources,
    agentRecommendation: "Resolve F-042 evidence chain before accepting CHG-014 into the configuration baseline.",
    humanDecisionsRequired: ["Confirm scope", "Accept evidence sufficiency", "Approve finding severity", "Approve report disposition"],
    traceabilityNote: "This report preserves links to synthetic source records and is not a regulatory determination.",
  };
}

export function reportToCsv(report: ReturnType<typeof buildAuditReadinessReport>) {
  const rows = [
    ["Report type", report.reportType], ["Report version", report.reportVersion], ["Generated at", report.generatedAt], ["Data mode", report.dataMode], ["Audit", report.audit.id], ["Audit title", report.audit.title], ["Executive position", report.executivePosition], ["Readiness", `${report.metrics.readiness}%`], ["Open findings", String(report.metrics.openFindings)], ["Supplier exposure", String(report.metrics.supplierExposure)], ["Agent recommendation", report.agentRecommendation], ["Traceability note", report.traceabilityNote],
    [], ["Finding ID", "Title", "Severity", "Status", "Owner", "Age"], ...report.findings.map((finding) => [finding.id, finding.title, finding.severity, finding.status, finding.owner, finding.age]),
    [], ["Control ID", "Control", "Coverage", "Status", "Signal"], ...report.controls.map((control) => [control.id, control.title, `${control.coverage}%`, control.status, control.signal]),
  ];
  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

export function getSkillPhaseFromId(skillId: string) {
  const skill = auditSkills.find((item) => item.id === skillId);
  return getSkillForPhase(skill?.phase ?? "scope");
}

export interface CustomFindingInput {
  findingId: string;
  title: string;
  productId: string;
  supplierId: string;
  controlFamily: string;
  alternateConnector: "vendor-erp-asterion" | "document-repository-live";
}

export function simulateCustomAuditExecution(input: CustomFindingInput) {
  const baseline = simulateFullAuditExecution(input.findingId);
  const connector = input.alternateConnector;
  const alternateCalls = [
    [["ontology_resolve", "part21-assurance-ontology", { sourceId: input.findingId, requestedClass: "Finding" }, "Custom finding mapped to Finding → Product → Requirement → Control path"], ["graph_find_open_scope", "core-graph", { productId: input.productId, controlFamily: input.controlFamily }, "Scope anchor and accountable owner resolved from ontology graph"]],
    [[connector === "vendor-erp-asterion" ? "erp_query_supplier_change_window" : "dms_search_evidence_by_control", connector, { supplierId: input.supplierId, controlFamily: input.controlFamily, productId: input.productId }, "Alternative evidence route returned 4 source records and 1 stale join"], [connector === "vendor-erp-asterion" ? "erp_reconcile_lot_certificate" : "dms_get_effective_snapshot", connector, { productId: input.productId, asOf: "2026-11-17" }, "Source reconciliation completed with one evidence gap preserved"]],
    [["graph_walk_requirement_path", "core-graph", { findingId: input.findingId, relationTypes: ["about", "appliesTo", "hasControl"] }, "Requirement and control path traversed with temporal edges"], ["temporal_diff_entity_state", "bitemporal-event-store", { entityId: input.productId, window: "last-90-days" }, "One effective-state change is causal candidate; transaction history retained"]],
    [["challenge_finding_against_counterevidence", "core-graph", { findingId: input.findingId, sourceCount: 4 }, "No counterevidence closes the control gap; severity remains Major candidate"], ["draft_corrective_action", "core-graph", { findingId: input.findingId, ownerRole: "Quality lead", dueInDays: 30 }, "Draft action includes owner, due date, effectiveness test, and evidence request"]],
    [["assemble_report_sections", "report-composer", { findingId: input.findingId, includeTrace: true, includeRegulation: true }, "Executive summary, finding narrative, evidence matrix, and action section prefilled"], ["recommend_next_moves", "core-graph", { findingId: input.findingId, requireHumanApproval: true }, "Recommendation links to control family, Part 21 requirement, and remediation practice"]],
  ] as const;
  let sequence = 1;
  const steps = baseline.steps.map((step, index) => ({
    ...step,
    toolCalls: alternateCalls[index].map(([tool, callConnector, args, result]) => ({ sequence: sequence++, tool, connector: callConnector, arguments: args, result, provenance: `Alternative simulation path · ${input.controlFamily}` })),
    humanGate: { ...step.humanGate, rationale: `${step.humanGate.rationale} Custom finding context: ${input.title}.` },
  }));
  return { finding: { ...simulatedFinding, id: input.findingId, title: input.title, productId: input.productId, supplierId: input.supplierId, status: "Open · custom simulation" }, status: "completed" as const, steps, customContext: input };
}

export function exportBitemporalGraph(findingId = simulatedFinding.id) {
  const context = getFindingOntologyContext(findingId);
  return { exportType: "bitemporal-event-sourced-property-graph", exportVersion: "0.1-demo", generatedAt: new Date().toISOString(), findingId, ontology: part21Ontology, context, nodes: ontologyMappings, relationships: part21Ontology.relations, temporalEvents: temporalRecords, derivedTimeline: temporalRecords.filter((event) => event.entityId === "finding-2026-04" || event.entityId === "chg-2026-014" || event.entityId === "prod-4820"), provenance: { sourceMode: "synthetic", sourceSystems: ["core-graph", "Asterion Vendor ERP", "Controlled Document Repository"], humanReviewRequired: true } };
}

export function getAgentActivity(agentId?: string) {
  const simulation = simulateFullAuditExecution();
  return simulation.steps.filter((step) => !agentId || step.agent === agentId).map((step) => ({ phase: step.phase, phaseLabel: step.phaseLabel, agent: step.agent, route: step.route, humanGate: step.humanGate, toolCalls: step.toolCalls }));
}
