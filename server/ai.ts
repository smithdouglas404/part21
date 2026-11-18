import { regulatoryTraceForFinding } from "../shared/regulatory";
import { getFindingOntologyContext, getTemporalHistory } from "../shared/ontology";
import { graphNodes } from "../shared/demo";
import { applicationSkills } from "../shared/ecc";
import { auditSkills } from "../shared/skills";
import { invokeLLM } from "./_core/llm";
import { getGroundedGraphContext } from "./graph-store";

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

export function answerGroundedQuestion(question: string) {
  const normalized = question.toLowerCase();
  const context = getFindingOntologyContext("FIND-2026-04");
  const history = getTemporalHistory("finding-2026-04");
  let appliedSkill = "finding-challenge";
  let followUpQuestions = ["What evidence would disprove or downgrade that signal?", "Who must approve the provisional severity?", "Should I open the finding challenge skill?"];
  let answer = "The grounded assurance agent found no direct match in the synthetic graph. Try asking about a finding, Part 21 provision, supplier, change, evidence chain, risk, or remediation.";
  if (normalized.includes("disprove") || normalized.includes("weakest")) answer = "The weakest evidence is EV-803: receiving inspection to heat-lot reconciliation is unresolved at 71% confidence. Counterevidence that would disprove the current finding would be a verified heat-lot certificate joined to the receiving record, plus an approved baseline impact review.";
  else if (normalized.includes("changed") || normalized.includes("baseline")) { appliedSkill = "trace-chain"; followUpQuestions = ["Should I trace upstream to the supplier and material lot?", "Which revision should be treated as the accepted baseline?", "Do you want to open the temporal trace skill?"]; answer = `The temporal chain shows ${history.length} recorded events. The highest-impact transition is CHG-014, a supplier material substitution that preceded the F-042 finding and left two evidence records requiring revalidation.`; }
  else if (normalized.includes("requirement") || normalized.includes("part 21") || normalized.includes("regulation")) { appliedSkill = "frame-scope"; followUpQuestions = ["Which requirement family should I apply first: 21.21, 21.51, or 21.61?", "What client-approved procedure controls the interpretation?", "Should I load the scope framing skill?"]; answer = `The current finding traverses ${regulatoryTraceForFinding.path.slice(2).join(" → ")}. The system treats §21.21 evaluation, §21.51 records, and §21.61 failure-to-notify as candidate regulatory bases; a client-approved interpretation and human reportability decision are still required.`; }
  else if (normalized.includes("risk") || normalized.includes("impact")) { appliedSkill = "evidence-intake"; followUpQuestions = ["Which source systems should be queried next?", "What effective-date window should the evidence cover?", "Should I open the evidence intake skill?"]; answer = `Current modeled risk is ${regulatoryTraceForFinding.risk}. If the evidence chain remains unresolved, the organization may be unable to demonstrate traceability and may miss a timely evaluation or notification decision.`; }
  else if (normalized.includes("who") || normalized.includes("involved")) { appliedSkill = "frame-scope"; followUpQuestions = ["Which accountable role should own the next action?", "Which delegated roles must acknowledge the audit?", "Should I open the scope framing skill?"]; answer = `The graph context includes ${graphNodes.filter((node) => node.type === "person").map((person) => person.label).join(", ")}. Each relationship is synthetic until confirmed against the people directory and audit decision ledger.`; }
  const skill = [...auditSkills, ...applicationSkills].find((candidate) => candidate.id === appliedSkill) ?? [...auditSkills, ...applicationSkills].find((candidate) => candidate.id === "finding-challenge") ?? auditSkills[0];
  return { question, answer, appliedSkill, skillInvocation: { skillId: skill.id, name: skill.name, route: skill.route, contract: skill.skillContract, humanGate: skill.humanGate, invokedAt: new Date().toISOString(), invocationMode: "deterministic local router · provider not invoked" }, followUpQuestions, grounding: { findingId: "FIND-2026-04", graphEntities: graphNodes.length, temporalEvents: history.length, regulatoryPath: regulatoryTraceForFinding.path, sourceIds: ["FIND-2026-04", "AUD-026", "EV-803", "CHG-014"] }, provider: configuredProvider ? `${configuredProvider} configured · deterministic fallback · LLM not invoked` : "demo-grounded · no LLM invoked", humanReviewRequired: true };
}

export async function answerLiveGroundedQuestion(question: string) {
  const grounded = answerGroundedQuestion(question);
  const graphContext = await getGroundedGraphContext("FIND-2026-04");
  const contextPacket = {
    activeAudit: "AUD-026",
    pertNode: "guided audit phase selected by the employee",
    appliedSkill: grounded.skillInvocation,
    graphSource: graphContext.source,
    graphEntities: graphContext.nodes.length,
    graphEdges: graphContext.edges.length,
    temporalEvents: graphContext.temporalEvents.length,
    regulatoryPath: grounded.grounding.regulatoryPath,
    sourceIds: graphContext.sourceIds,
    graphSnapshot: { nodes: graphContext.nodes, edges: graphContext.edges, temporalEvents: graphContext.temporalEvents },
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
  return { ...grounded, answer: content, followUpQuestions: followUps.length ? followUps : grounded.followUpQuestions.slice(0, 2), provider: "managed live demo LLM", model: response.model || "claude-haiku-4-5", llmInvoked: true, groundedContextPacket: contextPacket, usage: response.usage, invocationMode: "live grounded model invocation", humanReviewRequired: true };
}
