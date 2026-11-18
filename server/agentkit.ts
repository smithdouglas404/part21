import crypto from "node:crypto";
import type { AuditSkill, AuditSkillPhase } from "../shared/skills";
import type { SimulationStep } from "../shared/execution";
import { getEccCatalog } from "../shared/ecc";
import { getDomainPortfolio, listAudits, upsertDomainRecord } from "./domain-store";
import { getGroundedGraphContext } from "./graph-store";
import { getControlledConfiguration, listControlledConfigurationPayloads } from "./config-store";
import { promoteApprovedAuditToGraph, recordFinalizedGraphSnapshot } from "./graph-projection";
import { appendAssuranceEvent } from "./event-store";

export async function getAgentKitManifest() {
  const [agents, skills, phases, connectors, ontology, regulatory, policy] = await Promise.all([
    listControlledConfigurationPayloads<any>("agent_route"),
    listControlledConfigurationPayloads<AuditSkill>("skill"),
    getControlledConfiguration<any>("skill", "audit-phases"),
    listControlledConfigurationPayloads<any>("connector"),
    getControlledConfiguration<any>("ontology", "part21-assurance-ontology"),
    getControlledConfiguration<any>("regulatory_source", "10-cfr-part-21"),
    getControlledConfiguration<any>("policy", "part21-policy-as-code"),
  ]);
  return {
    protocol: "agentkit-demo",
    version: "0.1.0",
    executionContract: { standard: "ECC-compatible open-source skill module", source: getEccCatalog().repository, localSkillPack: getEccCatalog().localPack },
    agents: agents.map((item) => item.payload),
    skills: skills.filter((item) => item.configId !== "audit-phases").map((item) => ({ ...(item.payload as any), questionCount: (item.payload as any).questions?.length ?? 0, configurationVersion: item.version, sourceSha256: item.sourceSha256 })),
    phases: phases.payload,
    connectors: connectors.map((item) => item.payload),
    ontology: { id: ontology.payload.id, version: ontology.payload.version, temporalModel: ontology.payload.temporalModel, classCount: ontology.payload.classes.length, relationCount: ontology.payload.relations.length },
    storage: { provider: "PostgreSQL", connectionEnv: "POSTGRES_URL", tables: ["ontology_entities", "ontology_relationships", "temporal_events", "audit_decisions"], syncEndpoint: "/api/ontology/sync" },
    regulatoryPack: { id: regulatory.payload.id, title: regulatory.payload.title, sectionCount: regulatory.payload.sections.length, sources: regulatory.payload.sources, clientInterpretationRequired: true, configurationVersion: regulatory.version },
    policyAsCode: { id: policy.payload.id, version: policy.payload.policyVersion, ruleCount: policy.payload.rules.length, sourceUri: policy.payload.sourceUri, configurationVersion: policy.version },
  };
}

export async function simulateFullAuditExecution(findingId?: string): Promise<{ finding: Record<string, unknown>; status: "completed"; steps: SimulationStep[] }> {
  const audits = await listAudits();
  let portfolio: any = null;
  let selectedFinding: any = null;
  for (const candidate of audits as any[]) {
    const candidatePortfolio = await getDomainPortfolio(candidate.id);
    for (const candidateFinding of candidatePortfolio.findings as any[]) {
      if (findingId && candidateFinding.id !== findingId) continue;
      try { await getGroundedGraphContext(candidateFinding.id); selectedFinding = candidateFinding; portfolio = candidatePortfolio; break; } catch { /* continue to the next persisted database finding */ }
    }
    if (selectedFinding) break;
  }
  const finding = selectedFinding;
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

export async function runAuditSkill(skillId: string, answers: Record<string, unknown> = {}) {
  const skills = (await listControlledConfigurationPayloads<AuditSkill>("skill")).map((item) => item.payload).filter((item) => item.id !== "audit-phases");
  const skill = skills.find((item) => item.id === skillId) ?? skills[0];
  if (!skill) throw new Error("No active audit skill exists in the controlled configuration repository.");
  const answered = skill.questions.filter((question) => answers[question.id] !== undefined && String(answers[question.id]).trim().length > 0).length;
  const required = skill.questions.filter((question) => question.required).length;
  return {
    skillId: skill.id,
    route: skill.route,
    agent: skill.agent,
    status: answered >= required ? "ready_for_human_gate" : "needs_more_context",
    completion: Math.round((answered / skill.questions.length) * 100),
    skillContract: { id: (skill as any).skillContract, evidence: "linked database records", context: skill.purpose, humanGate: skill.humanGate },
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
  const firstFinding = (portfolio.findings as any[])[0];
  const firstChange = (portfolio.changes as any[])[0];
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
    agentRecommendation: firstFinding ? `Resolve ${firstFinding.id} evidence chain before accepting ${firstChange?.id ?? "the next database change"} into the configuration baseline.` : "Resolve the highest-priority database finding before accepting the next configuration change.",
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

export async function getSkillPhaseFromId(skillId: string): Promise<AuditSkillPhase | undefined> {
  const skills = (await listControlledConfigurationPayloads<AuditSkill>("skill")).map((item) => item.payload);
  return skills.find((item) => item.id === skillId)?.phase;
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


export async function finalizeAuditReport(auditId: string, actor: string, auditorNarrative = "", approved = false) {
  if (!approved) throw new Error("Qualified approval is required before promoting the report into the authoritative graph.");
  const report = await buildAuditReadinessReport(auditId);
  const graphPromotion = await promoteApprovedAuditToGraph(auditId, actor);
  const snapshot = { ...report, auditorNarrative, finalizedAt: new Date().toISOString(), finalizedBy: actor, status: "finalized" as const, graphPromotion };
  const snapshotHash = crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const reportId = `report-${auditId.toLowerCase()}-${Date.now()}`;
  await upsertDomainRecord({ recordType: "report", recordId: reportId, auditId, payload: { ...snapshot, reportId, snapshotHash, storage: "mysql-domain-record" } });
  const graphSnapshot = await recordFinalizedGraphSnapshot({ auditId, reportId, snapshotHash, actor });
  const event = await appendAssuranceEvent({ type: "audit_report_finalized", actor, auditId, entityId: reportId, payload: { reportId, auditId, snapshotHash, graphSnapshot, humanGate: "Qualified report approver", immutableSnapshot: true } });
  return { ok: true, reportId, auditId, snapshotHash, graphSnapshot, event, report: snapshot };
}
