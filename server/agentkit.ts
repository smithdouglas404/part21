import { auditPhases, auditSkills, agentKitAgents, getSkillForPhase } from "../shared/skills";
import { mcpConnectors, type SimulationStep } from "../shared/execution";
import { part21Ontology } from "../shared/ontology";
import { assessRemediationImpact, part21RegulatoryPack, traverseRegulatoryTree } from "../shared/regulatory";
import { getEccCatalog } from "../shared/ecc";
import { part21PolicyPack } from "../shared/policy";
import { getDomainPortfolio, listAudits } from "./domain-store";
import { getGroundedGraphContext } from "./graph-store";

export function getAgentKitManifest() {
  return {
    protocol: "agentkit-demo",
    version: "0.1.0",
    executionContract: { standard: "ECC-compatible open-source skill module", source: getEccCatalog().repository, localSkillPack: getEccCatalog().localPack },
    agents: agentKitAgents,
    skills: auditSkills.map(({ questions, ...skill }) => ({ ...skill, questionCount: questions.length })),
    phases: auditPhases,
    connectors: mcpConnectors,
    ontology: { id: part21Ontology.id, version: part21Ontology.version, temporalModel: part21Ontology.temporalModel, classCount: part21Ontology.classes.length, relationCount: part21Ontology.relations.length },
    storage: { provider: "PostgreSQL", connectionEnv: "POSTGRES_URL", tables: ["ontology_entities", "ontology_relationships", "temporal_events", "audit_decisions"], syncEndpoint: "/api/ontology/sync" },
    regulatoryPack: { id: part21RegulatoryPack.id, title: part21RegulatoryPack.title, sectionCount: part21RegulatoryPack.sections.length, sources: part21RegulatoryPack.sources, clientInterpretationRequired: true },
    policyAsCode: { id: part21PolicyPack.id, version: part21PolicyPack.policyVersion, ruleCount: part21PolicyPack.rules.length, sourceUri: part21PolicyPack.sourceUri },
  };
}

export async function simulateFullAuditExecution(findingId?: string): Promise<{ finding: Record<string, unknown>; status: "completed"; steps: SimulationStep[] }> {
  const audits = await listAudits();
  const portfolio = await getDomainPortfolio(String((audits as any[])[0]?.id ?? ""));
  const finding = (portfolio.findings as any[]).find((item) => !findingId || item.id === findingId) ?? (portfolio.findings as any[])[0];
  if (!finding) throw new Error("No database finding is available for AgentKit execution.");
  const graph = await getGroundedGraphContext(finding.id);
  const audit = portfolio.audit as any;
  const evidenceIds = (portfolio.evidence as any[]).map((item) => item.id);
  const steps: SimulationStep[] = [
    { phase: 1, phaseId: "scope", phaseLabel: "Frame the audit", agent: "scope-facilitator", route: "agentkit.audit.scope_framing", status: "Completed", toolCalls: [{ sequence: 1, tool: "search_entities", connector: "core-graph", arguments: { query: finding.id, types: ["finding", "product", "audit"] }, result: `Resolved ${finding.id} within ${audit?.id ?? "database audit"}`, provenance: graph.source }], humanGate: { gate: "Scope confirmation", approver: String(finding.owner ?? "Assigned audit lead"), decision: "Pending qualified approval", rationale: `Scope is derived from database finding ${finding.id} and audit ${audit?.id ?? "not linked"}.`, timestamp: new Date().toISOString() } },
    { phase: 2, phaseId: "evidence", phaseLabel: "Pull evidence", agent: "evidence-curator", route: "agentkit.audit.evidence_intake", status: "Completed", toolCalls: [{ sequence: 2, tool: "get_evidence", connector: "mysql-domain-store", arguments: { auditId: audit?.id }, result: `${evidenceIds.length} database evidence records available`, provenance: "MySQL domain records" }], humanGate: { gate: "Evidence sufficiency", approver: "Assigned evidence owner", decision: "Pending qualified approval", rationale: "Evidence scope is calculated from database records linked to the active audit.", timestamp: new Date().toISOString() } },
    { phase: 3, phaseId: "traceability", phaseLabel: "Trace the chain", agent: "genealogy-navigator", route: "agentkit.audit.trace_chain", status: "Completed", toolCalls: [{ sequence: 3, tool: "trace_product_genealogy", connector: "mysql-graph-store", arguments: { findingId: finding.id }, result: `${graph.nodes.length} graph entities, ${graph.edges.length} graph relationships, ${graph.temporalEvents.length} temporal events`, provenance: graph.source }], humanGate: { gate: "Trace acceptance", approver: "Assigned configuration owner", decision: "Pending qualified approval", rationale: "Genealogy is read from the persistent graph projection.", timestamp: new Date().toISOString() } },
    { phase: 4, phaseId: "findings", phaseLabel: "Evaluate findings", agent: "finding-challenger", route: "agentkit.audit.finding_challenge", status: "Completed", toolCalls: [{ sequence: 4, tool: "detect_control_gaps", connector: "mysql-domain-store", arguments: { auditId: audit?.id }, result: `${(portfolio.controls as any[]).filter((item) => item.status === "Gap").length} database control gaps detected`, provenance: "MySQL control records" }], humanGate: { gate: "Finding approval", approver: String(finding.owner ?? "Assigned audit lead"), decision: "Pending qualified approval", rationale: "Severity and disposition must be approved against database evidence.", timestamp: new Date().toISOString() } },
    { phase: 5, phaseId: "closure", phaseLabel: "Review & close", agent: "readiness-facilitator", route: "agentkit.audit.readiness_close", status: "Completed", toolCalls: [{ sequence: 5, tool: "check_audit_readiness", connector: "mysql-domain-store", arguments: { auditId: audit?.id }, result: `${(portfolio.metrics as any)?.readiness ?? "Unknown"}% readiness from database metrics`, provenance: "MySQL domain portfolio" }], humanGate: { gate: "Report disposition", approver: "Qualified quality approver", decision: "Pending qualified approval", rationale: "Closure is derived from database readiness, findings, controls, and evidence.", timestamp: new Date().toISOString() } },
  ];
  // Execution steps above are the sole database-derived path.
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
    skillContract: { id: (skill as any).skillContract, evidence: "linked synthetic records", context: skill.purpose, humanGate: skill.humanGate },
    nextQuestions: skill.questions.filter((question) => question.required && !answers[question.id]).map((question) => question.id),
    recommendation: answered >= required ? skill.completionSignal : `Answer the remaining ${Math.max(required - answered, 0)} required question(s) before routing to the human gate.`,
  };
}

export async function buildAuditReadinessReport(auditId?: string) {
  if (!auditId) throw new Error("auditId is required.");
  const portfolio = await getDomainPortfolio(auditId);
  if (!portfolio.audit) throw new Error(`Audit ${auditId} was not found in the database.`);
  const audit = portfolio.audit as any;
  const domainMetrics = portfolio.metrics as any;
  return {
    reportType: "audit-readiness",
    reportVersion: "0.1-demo",
    generatedAt: new Date().toISOString(),
    dataMode: "database-resident synthetic dataset",
    audit,
    executivePosition: "Ready with actions",
    metrics: domainMetrics,
    controls: portfolio.controls,
    findings: portfolio.findings,
    evidence: portfolio.evidence,
    sources: portfolio.sources,
    agentRecommendation: "Resolve F-042 evidence chain before accepting CHG-014 into the configuration baseline.",
    humanDecisionsRequired: ["Confirm scope", "Accept evidence sufficiency", "Approve finding severity", "Approve report disposition"],
    traceabilityNote: "This report preserves links to synthetic source records and is not a regulatory determination.",
  };
}

export function reportToCsv(report: Awaited<ReturnType<typeof buildAuditReadinessReport>>) {
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

export async function simulateCustomAuditExecution(input: CustomFindingInput) {
  const baseline = await simulateFullAuditExecution(input.findingId);
  return { ...baseline, finding: { ...baseline.finding, title: input.title, productId: input.productId, supplierId: input.supplierId }, customContext: input };
}

export async function exportBitemporalGraph(findingId?: string) {
  const context = await getGroundedGraphContext(findingId);
  return { exportType: "bitemporal-event-sourced-property-graph", exportVersion: "0.2-database", generatedAt: new Date().toISOString(), findingId: context.findingId, schema: context.schema, nodes: context.nodes, relationships: context.edges, temporalEvents: context.temporalEvents, provenance: { sourceMode: "mysql-database", sourceSystems: ["database graph projection"], humanReviewRequired: true } };
}

export async function getAgentActivity(agentId?: string) {
  const simulation = await simulateFullAuditExecution();
  return simulation.steps.filter((step) => !agentId || step.agent === agentId).map((step) => ({ phase: step.phase, phaseLabel: step.phaseLabel, agent: step.agent, route: step.route, humanGate: step.humanGate, toolCalls: step.toolCalls }));
}
