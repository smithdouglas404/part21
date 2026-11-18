
import type { AuditSkill } from "../shared/skills";
import { invokeLLM } from "./_core/llm";
import { getGroundedGraphContext } from "./graph-store";
import { getDomainPortfolio } from "./domain-store";
import { appendAssuranceEvent } from "./event-store";
import { getControlledConfiguration, listControlledConfigurationPayloads } from "./config-store";

const sandboxEnvironmentProvider: "openai" | "anthropic" | null = process.env.OPENAI_API_KEY ? "openai" : process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
let configuredProvider: "openai" | "anthropic" | null = null;
let configuredAt: string | null = null;

export function getAiStatus() {
  return { mode: configuredProvider ? "provider-configured" : "demo-grounded", provider: configuredProvider, keyStored: Boolean(configuredProvider), liveDemoAvailable: true, liveDemoModel: "managed runtime · requested claude-haiku-4-5 · actual response model shown in trace", sandboxEnvironmentProvider, keyStorage: "runtime environment / secret manager contract", usedFor: ["graph questions", "finding insights", "remediation recommendations", "report drafting"], note: configuredProvider ? "Provider status was explicitly configured in the admin panel. Live demo mode uses the managed LLM runtime only when explicitly requested." : "Grounded demo mode is deterministic by default. Live demo mode can invoke the managed LLM runtime with a Part 21 context packet; no client production provider is implied.", configuredAt };
}

export function configureAiProvider(provider: "openai" | "anthropic", key: string) {
  if (!key || key.length < 8) return { ok: false, error: "Provide a provider key or secret reference with at least 8 characters." };
  configuredProvider = provider;
  configuredAt = new Date().toISOString();
  return { ok: true, status: getAiStatus(), message: "Provider status updated in the demo runtime. Production deployment should use a secret manager, not browser storage." };
}

export async function answerGroundedQuestion(question: string, auditId?: string, findingId?: string) {
  const normalized = question.toLowerCase();
  const portfolio = await getDomainPortfolio(auditId);
  const activeAudit = portfolio.audit as any;
  const configuredSkills = (await listControlledConfigurationPayloads<AuditSkill>("skill")).map((row) => row.payload).filter((skill) => skill && typeof skill === "object" && "id" in skill && "route" in skill) as AuditSkill[];
  if (!configuredSkills.length) throw new Error("No active skills are available in the controlled configuration repository.");
  const context = await getGroundedGraphContext(findingId ?? "");
  const graphFinding = context.nodes.find((node: any) => node.type === "finding" || node.nodeType === "finding");
  const finding = (portfolio.findings as any[]).find((item) => !findingId || item.id === findingId) ?? (portfolio.findings as any[])[0] ?? (graphFinding ? { id: graphFinding.id, title: graphFinding.label, severity: graphFinding.status, owner: "Database graph accountability record" } : null);
  if (!finding) throw new Error("No database finding is available in the relational or graph projection.");
  const regulatoryPack = (await getControlledConfiguration<any>("regulatory_source", "10-cfr-part-21")).payload;
  const firstSection = regulatoryPack.sections?.[0];
  const regulatoryTraceForFinding = { path: [finding.id, activeAudit?.id ?? "database-audit-context", ...(regulatoryPack.sections ?? []).slice(0, 3).map((section: any) => `§${section.id}`)], violationHypothesis: firstSection?.summary ?? "Controlled regulatory source loaded from MySQL.", risk: firstSection?.defaultRisk ?? "Review required", impactIfNotRemediated: firstSection?.ifUnmet ?? "Qualified review required.", remediation: regulatoryPack.implementationGuidance ?? [] };
  const regulatoryTrace = { ...regulatoryTraceForFinding, findingId: finding.id, path: [finding.id, activeAudit?.id ?? "database-audit-context", ...regulatoryTraceForFinding.path.filter((segment) => !/^AUD-/.test(segment)).slice(2)] };
  const groundedContext = context.findingId === finding.id ? context : await getGroundedGraphContext(finding.id);
  const history = groundedContext.temporalEvents;
  const evidence = portfolio.evidence as any[];
  let appliedSkill = "finding-challenge";
  let followUpQuestions = ["What evidence would disprove or downgrade that signal?", "Who must approve the provisional severity?", "Should I open the finding challenge skill?"];
  let answer = "The grounded assurance agent found no direct match in the synthetic graph. Try asking about a finding, Part 21 provision, supplier, change, evidence chain, risk, or remediation.";
  if (normalized.includes("disprove") || normalized.includes("weakest")) answer = `The weakest evidence is ${evidence[0]?.id ?? "the linked evidence record"}. Counterevidence that would disprove the current finding would be a verified source record joined to the affected record, plus an approved baseline impact review.`;
  else if (normalized.includes("changed") || normalized.includes("baseline")) { appliedSkill = "trace-chain"; followUpQuestions = ["Should I trace upstream to the supplier and material lot?", "Which revision should be treated as the accepted baseline?", "Do you want to open the temporal trace skill?"]; answer = `The temporal chain shows ${history.length} recorded events. The highest-impact transition is ${context.nodes.find((node: any) => node.type === "change")?.label ?? "the recorded change"}, a supplier material substitution that preceded the ${finding.id} finding and left two evidence records requiring revalidation.`; }
  else if (normalized.includes("requirement") || normalized.includes("part 21") || normalized.includes("regulation")) { appliedSkill = "frame-scope"; followUpQuestions = ["Which requirement family should I apply first: 21.21, 21.51, or 21.61?", "What client-approved procedure controls the interpretation?", "Should I load the scope framing skill?"]; answer = `The current finding traverses ${regulatoryTrace.path.slice(2).join(" → ")}. The system treats §21.21 evaluation, §21.51 records, and §21.61 failure-to-notify as candidate regulatory bases; a client-approved interpretation and human reportability decision are still required.`; }
  else if (normalized.includes("risk") || normalized.includes("impact")) { appliedSkill = "evidence-intake"; followUpQuestions = ["Which source systems should be queried next?", "What effective-date window should the evidence cover?", "Should I open the evidence intake skill?"]; answer = `Current modeled risk is ${regulatoryTrace.risk}. If the evidence chain remains unresolved, the organization may be unable to demonstrate traceability and may miss a timely evaluation or notification decision.`; }
  else if (normalized.includes("who") || normalized.includes("involved")) { appliedSkill = "frame-scope"; followUpQuestions = ["Which accountable role should own the next action?", "Which delegated roles must acknowledge the audit?", "Should I open the scope framing skill?"]; answer = `The database graph context for ${activeAudit?.id ?? "the active audit"} includes ${context.nodes.filter((node: any) => node.type === "person").map((person: any) => person.label).join(", ") || "no person nodes"}. People and role links must remain tied to the audit decision ledger.`; }
  const skill = configuredSkills.find((candidate) => candidate.id === appliedSkill) ?? configuredSkills[0];
  return { question, answer, appliedSkill, activeAuditId: activeAudit?.id, findingId: finding.id, skillInvocation: { skillId: skill.id, name: skill.name, route: skill.route, contract: (skill as any).skillContract, humanGate: (skill as any).humanGate, invokedAt: new Date().toISOString(), invocationMode: "database-grounded router · provider not invoked" }, followUpQuestions, grounding: { findingId: finding.id, graphEntities: groundedContext.nodes.length, temporalEvents: history.length, regulatoryPath: regulatoryTrace.path, sourceIds: groundedContext.sourceIds }, traversalProof: groundedContext.traversalProof, provider: configuredProvider ? `${configuredProvider} configured · database-grounded router · LLM not invoked` : "database-grounded router · no LLM invoked", humanReviewRequired: true };
}

export async function answerLiveGroundedQuestion(question: string, auditId?: string, findingId?: string) {
  const grounded = await answerGroundedQuestion(question, auditId, findingId);
  const graphContext = await getGroundedGraphContext(grounded.grounding.findingId);
  const contextPacket = {
    activeAudit: graphContext.findingId,
    pertNode: "guided audit phase selected by the employee",
    appliedSkill: grounded.skillInvocation,
    graphSource: graphContext.source,
    graphEntities: graphContext.nodes.length,
    graphEdges: graphContext.edges.length,
    temporalEvents: graphContext.temporalEvents.length,
    regulatoryPath: grounded.grounding.regulatoryPath,
    sourceIds: graphContext.sourceIds,
    graphSnapshot: { nodes: graphContext.nodes, edges: graphContext.edges, temporalEvents: graphContext.temporalEvents },
    traversalProof: { queryFindingId: graphContext.findingId, visitedNodeIds: graphContext.nodes.map((node: any) => node.id), traversedEdgeIds: graphContext.edges.map((edge: any) => edge.id), temporalEventIds: graphContext.temporalEvents.map((event: any) => event.entityId), source: graphContext.source, ontologyVersion: "database graph ontology" },
    deterministicGroundingHint: grounded.answer,
    humanReviewRequired: true
  };
  const response = await invokeLLM({
    model: "claude-haiku-4-5",
    maxTokens: 900,
    messages: [
      { role: "system", content: "You are the interactive compliance agent inside a nuclear Part 21 audit application. Use only the supplied grounded context. Give a concise recommendation, name one overlooked consideration, and ask exactly two useful follow-up questions. Never make a final legal, reportability, NRC notification, or compliance verdict. State when qualified human review is required. Return plain text with headings: Recommendation, Overlooked consideration, Follow-up questions." },
      { role: "user", content: `Employee question or answer:\n${question}\n\nGrounded Part 21 context packet:\n${JSON.stringify(contextPacket, null, 2)}` }
    ]
  });
  const content = typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content : grounded.answer;
  const followUps = content.split("\n").map((line) => line.replace(/^[-*\d.)\s]+/, "").trim()).filter((line) => line.length > 20 && (line.includes("?") || line.toLowerCase().startsWith("follow-up"))).slice(0, 2);
  const traceId = `TRACE-${Date.now()}`;
  const warning = { id: `WARN-${Date.now()}`, traceId, code: "PART21-REPORTABILITY-REVIEW", severity: "high", title: "Potential Part 21 reportability concern", detail: "The grounded graph contains an unresolved traceability condition. Do not issue a final reportability or notification conclusion without qualified human review.", basis: ["21.21", "21.51", "21.61", grounded.grounding.findingId, ...graphContext.sourceIds.slice(0, 3)], acknowledgmentRequired: true };
  await appendAssuranceEvent({ type: "compliance_warning_issued", actor: "Compliance Agent", auditId: grounded.activeAuditId, entityId: warning.id, payload: { warning, question, model: response.model || "managed-runtime", graphSource: graphContext.source, graphCounts: { nodes: graphContext.nodes.length, edges: graphContext.edges.length, temporalEvents: graphContext.temporalEvents.length }, evidence: contextPacket.sourceIds } });
  return { ...grounded, answer: content, followUpQuestions: followUps.length ? followUps : grounded.followUpQuestions.slice(0, 2), provider: "managed live demo LLM", model: response.model || "claude-haiku-4-5", llmInvoked: true, groundedContextPacket: contextPacket, usage: response.usage, invocationMode: "live grounded model invocation", humanReviewRequired: true, traceId, warning };
}

export async function acknowledgeComplianceWarning(input: { warningId: string; traceId?: string; actor: string; rationale: string; auditId?: string }) {
  if (!input.warningId || !input.actor || !input.rationale) return { ok: false, error: "warningId, actor, and rationale are required" };
  const event = await appendAssuranceEvent({ type: "compliance_warning_acknowledged", actor: input.actor, auditId: input.auditId, entityId: input.warningId, payload: { warningId: input.warningId, traceId: input.traceId, rationale: input.rationale, decision: "Acknowledged for qualified human review; not a reportability determination" } });
  return { ok: true, event, message: "Warning acknowledgment persisted to the append-only assurance event ledger." };
}
