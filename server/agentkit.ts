import crypto from "node:crypto";
import type { AuditSkill, AuditSkillPhase } from "../shared/skills";
import { createAgentServices, requireAgentScope, validateAgentGraph, type AgentServices, type AgentScope, type AgentGraph, type GovernedSkill, type AgentRunRecord, type AgentToolCall, type AgentRecord } from "./agent-runtime";

export interface AuditSkillInput extends AgentScope {
  skillId: string;
  answers: Record<string, unknown>;
  mode?: "runtime" | "preview";
  skillVersion?: string;
  evidenceBindings?: Record<string, string[]>;
}
export function hasSkillAnswer(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(hasSkillAnswer);
  return typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
}
export function validateSkillAnswers(skill: AuditSkill, answers: Record<string, unknown>) {
  const requirements = skill.questions.filter(question => question.required).map(question => {
    const value = answers[question.id];
    const valid = hasSkillAnswer(value) && (question.input !== "choice" || !question.options?.length || question.options.includes(String(value))) && (question.input !== "checklist" || Array.isArray(value) && (!question.options?.length || value.every(item => question.options!.includes(String(item)))));
    return { id: question.id, answered: valid, prompt: question.prompt, evidenceHint: question.evidenceHint };
  });
  return { requirements, missing: requirements.filter(row => !row.answered), completion: requirements.length ? Math.round(100 * requirements.filter(row => row.answered).length / requirements.length) : 100 };
}
export function selectGovernedSkill(rows: GovernedSkill[], input: Pick<AuditSkillInput, "skillId" | "skillVersion" | "mode">) {
  if (!input.skillId) throw new Error("The selected skillId is required; no first-skill fallback is allowed.");
  const candidates = rows.filter(row => row.configId === input.skillId && (!input.skillVersion || row.version === input.skillVersion) && (input.mode === "preview" ? row.status !== "retired" : row.kind === "skill" && row.status === "active"));
  if (candidates.length !== 1) throw new Error(candidates.length ? "Skill revision is ambiguous; select an exact governed version." : `Selected skill ${input.skillId} is not available in database configuration.`);
  const row = candidates[0];
  if (row.payload.id !== row.configId || !row.version || !/^[a-f0-9]{64}$/i.test(row.sourceSha256)) throw new Error("Skill revision/hash/identity is invalid.");
  if (input.mode !== "preview" && (!row.approvedBy || !row.approvedAt || !row.approvalDecisionId || !row.governanceVerified)) throw new Error("Active skill has no qualified governance approval/activation proof; runtime execution blocked.");
  return row;
}

/**
 * A missing reviewed policy baseline is a qualified-human governance condition,
 * not an incomplete auditor answer. Keep it visible as an advisory while still
 * allowing the governed skill contract itself to complete.
 */
function isPolicyGovernanceAdvisory(message: string): boolean {
  return /^policy\./i.test(message) || /policy baseline/i.test(message);
}

function evidenceMatchesFinding(row: Record<string, any>, findingId: string): boolean {
  if (row.findingId === findingId || row.linkedFinding === findingId) return true;
  if (Array.isArray(row.findingIds) && row.findingIds.includes(findingId)) return true;
  if (Array.isArray(row.linkedTo) && row.linkedTo.includes(findingId)) return true;
  if (typeof row.linkedTo === "string") {
    return row.linkedTo.split(/[^A-Za-z0-9-]+/).filter(Boolean).includes(findingId);
  }
  return false;
}

/** Explicit executable handlers. Route strings alone are never execution evidence. */
const graphHandler = async (input: AuditSkillInput, tools: SkillTools) => { await tools.portfolio(); await tools.graph(); await tools.evidence(); };
const policyHandler = async (input: AuditSkillInput, tools: SkillTools) => { await graphHandler(input, tools); await tools.policy(); };
const routeHandlers: Readonly<Record<string, typeof graphHandler>> = Object.freeze({
  "agentkit.audit.scope_framing": graphHandler,
  "agentkit.audit.evidence_intake": graphHandler,
  "agentkit.audit.trace_chain": graphHandler,
  "agentkit.audit.finding_challenge": policyHandler,
  "agentkit.audit.readiness_close": policyHandler,
  "agentkit.nuclear.part21_applicability": policyHandler,
  "agentkit.nuclear.part21_discovery_clock": policyHandler,
  "agentkit.nuclear.deviation_screening": policyHandler,
  "agentkit.nuclear.substantial_safety_hazard": policyHandler,
  "agentkit.nuclear.notification_package": policyHandler,
  "agentkit.nuclear.supplier_evaluation_transfer": policyHandler,
  "agentkit.nuclear.commercial_grade_dedication": policyHandler,
  "agentkit.nuclear.appendix_b_design_control": policyHandler,
  "agentkit.nuclear.nonconformance_cap_bridge": policyHandler,
  "agentkit.nuclear.records_and_audits": policyHandler,
  "agentkit.nuclear.postings_and_communications": policyHandler,
});
export function getExecutableSkillRoutes(): readonly string[] { return Object.keys(routeHandlers); }
interface SkillTools { portfolio(): Promise<void>; graph(): Promise<void>; evidence(): Promise<void>; policy(): Promise<void> }

function skillNarrative(input: AuditSkillInput, skill: AuditSkill, row: { version: string }, context: {
  portfolio: Awaited<ReturnType<AgentServices["portfolio"]>> | null;
  graph: AgentGraph | null;
  policy: Record<string, any> | null;
  evidence: Record<string, any>[];
  checked: ReturnType<typeof validateSkillAnswers>;
  requiredEvidence: { requirement: string; evidenceIds: string[]; status: string }[];
  followUpQuestions: string[];
  unknowns: string[];
}) {
  const audit = context.portfolio?.audit as Record<string, any> | undefined;
  const subject = input.findingId
    ? `finding ${input.findingId}`
    : `audit ${input.auditId}`;
  const auditLabel = audit?.title ? ` (${String(audit.title)})` : "";
  const paragraphs: string[] = [];
  paragraphs.push(
    `${skill.name} reviewed ${subject}${auditLabel} against the governed ${skill.id} contract at revision ${row.version}.`
  );
  if (context.graph) {
    const nodes = context.graph.nodes.length;
    const edges = context.graph.edges.length;
    const events = context.graph.temporalEvents.length;
    paragraphs.push(
      `The agent traversed the audit-scoped knowledge graph and returned ${nodes} nodes, ${edges} relationships, and ${events} temporal events. That means the observations are tied to persisted finding, product, supplier, evidence, and event records rather than to free text or a static fixture.`
    );
  } else {
    paragraphs.push(
      `The agent did not receive a finding-linked graph projection, so it has not asserted a genealogy conclusion. The run is deliberately limited to the audit portfolio until a persisted finding is selected.`
    );
  }
  if (context.policy) {
    const counts = context.policy.counts ?? {};
    paragraphs.push(
      `Deterministic policy evaluation returned ${Number(counts.total ?? 0)} rules: ${Number(counts.pass ?? 0)} passed, ${Number(counts.fail ?? 0)} failed, ${Number(counts.unknown ?? 0)} remained unknown, and ${Number(counts.not_applicable ?? 0)} were not applicable. These are rule results for review, not a regulatory verdict.`
    );
  } else if (context.unknowns.some(item => /policy baseline/i.test(item))) {
    paragraphs.push(
      `Policy evaluation could not complete because ${input.auditId} has no pinned reviewed policy baseline. A qualified quality manager must pin the approved Part 21 policy revision before the policy result can be used as audit evidence. This is a recorded human decision, not an agent conclusion.`
    );
  } else {
    paragraphs.push(
      `Policy evaluation was not available for this run, so no policy pass or failure is claimed. The policy tool result is recorded as unknown in the trace.`
    );
  }
  if (context.evidence.length) {
    const satisfied = context.requiredEvidence.filter(item => item.status === "present").length;
    paragraphs.push(
      `The run resolved ${context.evidence.length} existing evidence ${context.evidence.length === 1 ? "record" : "records"}. ${
        satisfied
          ? `${satisfied} of ${context.requiredEvidence.length} evidence requirements are satisfied by records linked to ${subject}.`
          : `None of the selected records is linked to ${subject}, so no evidence requirement is satisfied yet.`
      }`
    );
  } else {
    paragraphs.push(
      `No existing evidence record was bound to the skill, so the evidence requirements remain open and must not be described as satisfied.`
    );
  }
  const missingEvidence = context.requiredEvidence.filter(item => item.status !== "present").map(item => item.requirement);
  if (missingEvidence.length) {
    paragraphs.push(
      `The evidence contract is still open for ${missingEvidence.join(", ")}. The accountable auditor should attach or link the existing records before this card advances.`
    );
  }
  if (context.checked.missing.length) {
    paragraphs.push(
      `The auditor still needs to answer ${context.checked.missing.length} required ${context.checked.missing.length === 1 ? "question" : "questions"}: ${context.checked.missing.map(item => item.prompt).join(" ")}`
    );
  }
  if (context.followUpQuestions.length) {
    paragraphs.push(
      `The next questions to resolve are: ${context.followUpQuestions.join(" ")}`
    );
  }
  paragraphs.push(
    `Recommended next action: the accountable audit lead should review the graph-linked evidence, resolve the open questions, and record a disposition with the named owner. The human gate remains pending: ${skill.humanGate}. No Part 21 reportability, compliance, or closure decision has been issued by the agent.`
  );
  return paragraphs.join(" ");
}

async function executeSkill(input: AuditSkillInput, services: AgentServices, persist: boolean) {
  requireAgentScope(input, persist ? "agent:write" : "agent:read");
  const row = selectGovernedSkill(await services.skills(input.mode === "preview"), input);
  const skill = row.payload;
  const checked = validateSkillAnswers(skill, input.answers);
  const traceId = services.id();
  const toolCalls: AgentToolCall[] = [];
  const unknowns: string[] = [];
  const advisories: string[] = [];
  let graph: AgentGraph | null = null;
  let policy: Record<string, any> | null = null;
  let evidence: Record<string, any>[] = [];
  let portfolio: Awaited<ReturnType<AgentServices["portfolio"]>> | null = null;
  let sourceIds: string[] = [];
  const run: AgentRunRecord = { traceId, auditId: input.auditId, findingId: input.findingId, actor: input.actor, skillId: skill.id, status: "running", startedAt: services.now(), toolCalls, skillRevision: row.version, skillHash: row.sourceSha256, configurationStatus: row.status, answers: input.answers, approvalDecisionId: row.approvalDecisionId ?? null, humanGate: { status: "pending", gate: skill.humanGate, approvalDecisionId: null }, durable: persist };
  if (persist) await services.beginRun(run);
  async function call(tool: string, args: Record<string, any>, operation: () => Promise<unknown>) {
    const item: AgentToolCall = { id: services.id(), sequence: toolCalls.length + 1, tool, arguments: args, status: "completed", result: null, sourceIds: [], startedAt: services.now(), completedAt: "" };
    try { item.result = await operation(); item.sourceIds = sourceIds.slice(); }
    catch (error) { item.status = "unknown"; const reason = error instanceof Error ? error.message : String(error); item.result = { unknown: reason }; unknowns.push(`${tool}: ${reason}`); }
    item.completedAt = services.now(); toolCalls.push(item);
    if (persist) await services.recordTool(traceId, item);
  }
  const tools: SkillTools = {
    async portfolio() {
      await call("database.audit_portfolio", { auditId: input.auditId, findingId: input.findingId }, async () => {
        portfolio = await services.portfolio(input.auditId);
        if (portfolio.audit?.id !== input.auditId) throw new Error("Portfolio audit mismatch.");
        if (input.findingId && !portfolio.findings.some(finding => finding.id === input.findingId)) throw new Error("Finding is not linked to the selected audit.");
        sourceIds = [input.auditId, ...(input.findingId ? [input.findingId] : []), ...portfolio.sources.map(row => String(row.id))];
        return portfolio;
      });
      // Ownership errors are terminal, not a graph degradation state.
      if (!portfolio || portfolio.audit?.id !== input.auditId || input.findingId && !portfolio.findings.some(row => row.id === input.findingId)) throw new Error("No authorized audit/finding portfolio is available.");
    },
    async graph() {
      if (!input.findingId) { unknowns.push("Graph traversal not performed: no existing findingId was selected."); return; }
      await call("graph.audit_finding_traversal", { auditId: input.auditId, findingId: input.findingId }, async () => {
        graph = validateAgentGraph(await services.graph(input.auditId, input.findingId!), input.auditId, input.findingId!);
        sourceIds = [...new Set([...sourceIds, ...graph.sourceIds])];
        return graph;
      });
    },
    async evidence() {
      const ids = [...new Set(Object.values(input.evidenceBindings ?? {}).flat())];
      await call("evidence.resolve_existing_ids", { auditId: input.auditId, findingId: input.findingId, evidenceIds: ids }, async () => {
        const resolved = await services.evidence(input, ids);
        if (resolved.some(row => row.auditId !== input.auditId || !ids.includes(row.id))) throw new Error("Evidence audit/ID mismatch.");
        evidence = resolved;
        sourceIds = [...new Set([...sourceIds, ...evidence.map(row => String(row.id))])];
        return evidence;
      });
    },
    async policy() {
      if (!graph) { unknowns.push("Policy evaluation not performed without audit-scoped graph evidence."); return; }
      await call("policy.audit_finding_evaluate", { auditId: input.auditId, findingId: input.findingId, sourceIds }, async () => {
        const evaluated = await services.policy(input, sourceIds);
        if (evaluated.auditId !== input.auditId || evaluated.findingId !== input.findingId) throw new Error("Policy audit/finding mismatch.");
        policy = evaluated;
        return policy;
      });
    },
  };
  const handler = routeHandlers[skill.route];
  let dispatched = false;
  try {
    if (!handler) { unknowns.push(`No executable handler exists for route ${skill.route}; agent not dispatched.`); }
    else { dispatched = true; await handler(input, tools); }
    const requiredEvidence = (skill.requiredEvidence ?? []).map(requirement => {
      const ids = input.evidenceBindings?.[requirement] ?? [];
      const linked = evidence.filter(row => ids.includes(row.id) && (!input.findingId || evidenceMatchesFinding(row, input.findingId)));
      return { requirement, evidenceIds: linked.map(row => row.id), status: linked.length === ids.length && linked.length > 0 ? "present" : "unknown" };
    });
    for (const missing of requiredEvidence.filter(row => row.status === "unknown")) unknowns.push(`Missing verified evidence: ${missing.requirement}`);
    for (const missing of checked.missing) unknowns.push(`Required answer missing/invalid: ${missing.id}`);
    // A missing policy baseline is a governance condition reserved for a
    // qualified human reviewer. It must be disclosed, but it does not make the
    // auditor's skill answers or evidence incomplete.
    for (const item of unknowns.filter(isPolicyGovernanceAdvisory)) advisories.push(item);
    const blockers = unknowns.filter(item => !isPolicyGovernanceAdvisory(item));
    const preview = input.mode === "preview";
    const status = preview ? "draft_preview" : blockers.length ? "needs_more_context" : "ready_for_human_gate";
    const followUpQuestions = [...checked.missing.map(row => row.prompt), ...requiredEvidence.filter(row => row.status === "unknown").map(row => `Which existing evidence record supports ${row.requirement}?`)];
    const recommendation = skillNarrative(input, skill, row, { portfolio, graph, policy, evidence, checked, requiredEvidence, followUpQuestions, unknowns: [...blockers, ...advisories] });
    const result = {
      ...run, status, completedAt: services.now(), appliedSkill: { id: skill.id, name: skill.name, version: row.version, sourceSha256: row.sourceSha256, configurationStatus: row.status, kind: row.kind, contract: skill, regulatoryApproval: preview ? "not_approved_for_runtime" : "governed_configuration_only_not_a_verdict" },
      route: skill.route, agent: skill.agent, agentDispatched: dispatched, routeExecuted: dispatched && toolCalls.some(row => row.status === "completed"), skillContract: skill, completion: checked.completion, requirements: checked.requirements, requiredEvidence, unknowns: blockers, nextQuestions: checked.missing.map(row => row.id), followUpQuestions,
      advisories,
      recommendation,
      verdict: "unknown" as const, sources: sourceIds, sourceIds, graph: graph as AgentGraph | null, policy: policy as Record<string, any> | null, grounding: { source: "mysql-database", auditId: input.auditId, findingId: input.findingId ?? null, graphTraversed: graph !== null, ontologyVersion: (graph as AgentGraph | null)?.ontologyVersion ?? null, nodeCount: (graph as AgentGraph | null)?.nodes.length ?? 0, edgeCount: (graph as AgentGraph | null)?.edges.length ?? 0, temporalEventCount: (graph as AgentGraph | null)?.temporalEvents.length ?? 0, sourceIds }, traversalProof: (graph as AgentGraph | null)?.traversalProof ?? null,
      humanReviewRequired: true, humanGate: { gate: skill.humanGate, status: "pending", approvalDecisionId: null, finalVerdict: "not_issued" },
    };
    if (persist) await services.finishRun(result);
    return result;
  } catch (error) {
    if (persist) await services.finishRun({ ...run, status: "failed", completedAt: services.now(), error: error instanceof Error ? error.message : String(error), unknowns });
    throw error;
  }
}
export async function runAuditSkill(input: AuditSkillInput | string, answers: Record<string, unknown> = {}, context?: Omit<AuditSkillInput, "skillId" | "answers">, services = createAgentServices()) {
  const request = typeof input === "string" ? context ? { ...context, skillId: input, answers } : null : input;
  if (!request) throw new Error("auditId, findingId context and trusted principal are required; legacy context-free execution is disabled.");
  return executeSkill({ ...request, mode: request.mode ?? "runtime" }, services, true);
}
export function previewAuditSkill(input: AuditSkillInput, services = createAgentServices()) { return executeSkill({ ...input, mode: "preview" }, services, false); }
export async function getAgentKitManifest(services = createAgentServices()) {
  const skills = await services.skills(true);
  return { protocol: "agentkit-audit-scoped", version: "1.0", source: "mysql-controlled-configuration", skills: skills.map(row => ({ ...row.payload, configurationVersion: row.version, sourceSha256: row.sourceSha256, configurationStatus: row.status, governanceVerified: row.governanceVerified === true, approvalDecisionId: row.approvalDecisionId ?? null, runtimeApproved: row.kind === "skill" && row.status === "active" && !!row.approvedBy && !!row.approvedAt && row.governanceVerified === true, executableHandler: !!routeHandlers[row.payload.route] })), executionContract: { durableRuns: "part21_agent_runs", toolCalls: "part21_agent_tool_calls", simulation: "disabled", qualifiedHumanReviewRequired: true } };
}
export async function simulateFullAuditExecution(_findingId?: string): Promise<any> { throw new Error("Static/simulated audit execution is disabled; invoke an explicit audit-scoped governed skill instead. No records created."); }
export interface CustomFindingInput { findingId: string; title: string; productId: string; supplierId: string; controlFamily: string; alternateConnector: "vendor-erp-asterion" | "document-repository-live" }
export async function simulateCustomAuditExecution(_input: CustomFindingInput): Promise<any> { throw new Error("Synthetic custom execution is disabled; supplied titles cannot overwrite operational facts. No records created."); }
export async function getSkillPhaseFromId(skillId: string, services = createAgentServices()): Promise<AuditSkillPhase | undefined> { const rows = (await services.skills(false)).filter(row => row.configId === skillId); if (rows.length > 1) throw new Error("Ambiguous skill revision."); return rows[0]?.payload.phase; }
export async function buildAuditReadinessReport(auditId?: string, services = createAgentServices()) {
  if (!auditId) throw new Error("auditId is required.");
  const portfolio = await services.portfolio(auditId);
  if (portfolio.audit?.id !== auditId) throw new Error("Audit scope mismatch.");
  return { reportType: "audit-readiness", reportVersion: "1.0-draft", generatedAt: services.now(), dataMode: "mysql-database", audit: portfolio.audit, executivePosition: "Qualified review required", metrics: portfolio.metrics, controls: portfolio.controls, findings: portfolio.findings, evidence: portfolio.evidence, sources: portfolio.sources, agentRecommendation: "Review the persisted evidence, policy results, and unresolved questions; this draft has no approved readiness or regulatory disposition.", humanDecisionsRequired: ["Confirm scope", "Accept evidence sufficiency", "Approve finding severity", "Approve report disposition"], traceabilityNote: "Draft database projection; not a compliance certification or regulatory determination." };
}
export function reportToCsv(report: Awaited<ReturnType<typeof buildAuditReadinessReport>>) {
  const rows: unknown[][] = [["Report type", report.reportType], ["Report version", report.reportVersion], ["Generated at", report.generatedAt], ["Audit", report.audit.id], ["Executive position", report.executivePosition], ["Readiness", report.metrics?.readiness ?? "Unknown"], ["Traceability note", report.traceabilityNote], [], ["Finding ID", "Title", "Severity", "Status", "Owner"], ...report.findings.map(row => [row.id, row.title, row.severity, row.status, row.owner])];
  return rows.map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}
export async function exportBitemporalGraph(findingId?: string, auditId?: string, services = createAgentServices()) {
  if (!findingId || !auditId) throw new Error("auditId and findingId are required; no graph fallback is allowed.");
  const graph = validateAgentGraph(await services.graph(auditId, findingId), auditId, findingId);
  return { exportType: "bitemporal-event-sourced-property-graph", exportVersion: "1.0", generatedAt: services.now(), ...graph, relationships: graph.edges, provenance: { sourceMode: "mysql-database", humanReviewRequired: true } };
}
export async function getAgentActivity(agentId?: string, auditId?: string, services = createAgentServices()) { if (!auditId) throw new Error("auditId is required."); const runs = await services.records("agent_run", auditId); return runs.filter(run => !agentId || run.agent === agentId || run.agentId === agentId || run.skillId === agentId); }
function canonicalArtifact(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalArtifact).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalArtifact((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export async function prepareAuditReportSnapshot(auditId: string, services = createAgentServices()) {
  const { generatedAt: _generatedAt, ...artifact } = await buildAuditReadinessReport(auditId, services);
  const canonical = canonicalArtifact(artifact);
  return { auditId, artifact: JSON.parse(canonical) as typeof artifact, artifactSha256: crypto.createHash("sha256").update(canonical).digest("hex") };
}
export function prepareFindingDraftSnapshot(draft: AgentRecord) {
  const artifact = { title: draft.title, description: draft.description, severity: draft.severity ?? null, auditId: draft.auditId, findingId: draft.findingId ?? null, conversationId: draft.conversationId, kanbanItemId: draft.kanbanItemId, sourceTraceIds: draft.sourceTraceIds ?? [] };
  // Trace IDs are execution evidence, not approval content; excluding them keeps the decision digest stable.
  const canonical = canonicalArtifact({ title: artifact.title, description: artifact.description, severity: artifact.severity, auditId: artifact.auditId, findingId: artifact.findingId, conversationId: artifact.conversationId, kanbanItemId: artifact.kanbanItemId });
  return { artifact, artifactSha256: crypto.createHash("sha256").update(canonical).digest("hex") };
}
/** Backwards signature retained, but a client approval boolean is never authority. Parent report gate owns finalization. */
export async function finalizeAuditReport(auditId: string, actor: string, auditorNarrative = "", decision: string | boolean | { approvalDecisionId: string; principal: AgentScope["principal"] } = false, principal?: AgentScope["principal"], services = createAgentServices()): Promise<any> {
  const approvalDecisionId = typeof decision === "object" ? decision.approvalDecisionId : decision;
  const trustedPrincipal = typeof decision === "object" ? decision.principal : principal;
  if (typeof approvalDecisionId !== "string" || !approvalDecisionId.trim()) throw new Error("A persisted authorized approvalDecisionId is required; boolean approvals are rejected.");
  const scope = { auditId, actor, principal: trustedPrincipal! };
  requireAgentScope(scope, "agent:write");
  const prepared = await prepareAuditReportSnapshot(auditId, services);
  const decisions = await services.records("report_approval_decision", auditId);
  const approved = decisions.find(row => row.id === approvalDecisionId);
  if (!approved || approved.auditId !== auditId || approved.status !== "approved" || approved.principalId !== trustedPrincipal!.id || approved.artifactSha256 !== prepared.artifactSha256) throw new Error("Persisted approval decision does not authorize this exact audit artifact/principal.");
  if (!services.finalizeReport) throw new Error("Governed report-approval adapter is unavailable; no report or graph was finalized.");
  return services.finalizeReport({ ...scope, approvalDecisionId, auditorNarrative, ...prepared });
}
