import type { AuditSkill } from "./skills";
export const eccCatalog = {
  name: "Everything Claude Code (ECC)",
  version: "2.2.3",
  repository: "https://github.com/affaan-m/ECC",
  website: "https://ecc.tools/",
  model: "Open-source collection of skills, agents, hooks, and workflow tools for coding agents",
  localPack: "Northstar Part 21 Assurance Skills",
  compatibility: ["ECC-compatible SKILL.md concepts", "AgentKit routes", "ECC-style human gates", "MCP callable tools"],
  note: "The application owns the nuclear domain skill pack; ECC supplies the open-source hub pattern and cross-harness operating model. Review and pin upstream components before production use.",
};

export const applicationSkills: AuditSkill[] = [
  { id: "policy-compiler", name: "Document-to-policy compiler", phase: "scope", purpose: "Turn an authoritative Part 21 document into source-linked rule candidates, evidence tests, and human activation gates.", agent: "scope-facilitator", route: "agentkit.policy.compile_document", skillContract: "P21-SKILL-POLICY-06", humanGate: "Legal, compliance, and quality approve activation.", questions: [
    { id: "policy-document", prompt: "Which controlled source document and revision should be compiled?", helper: "Bind the compiler to a stable source URI and revision.", input: "text", required: true, evidenceHint: "Store source URI, version, and retrieval timestamp." },
    { id: "policy-overlay", prompt: "Which client interpretation overlay applies?", helper: "Regulatory text and client interpretation must remain separately versioned.", input: "text", required: true, evidenceHint: "Link the approved interpretation record." },
    { id: "policy-activation", prompt: "Who can activate generated rule candidates?", helper: "Candidate generation is not compliance approval.", input: "text", required: true, evidenceHint: "Create the activation human gate." },
  ], completionSignal: "Source, interpretation overlay, activation owner, and rule candidates are traceable." },
  { id: "human-governance", name: "Human decision governance", phase: "closure", purpose: "Route agent recommendations to accept, decline, or defer decisions with mandatory notes and timing.", agent: "readiness-facilitator", route: "agentkit.governance.human_decision", skillContract: "P21-SKILL-GOVERN-07", humanGate: "Decision owner records the disposition and rationale.", questions: [
    { id: "governance-action", prompt: "What human decision is required?", helper: "Choose accept, decline, or defer; all three create an audit event.", input: "choice", options: ["Accept", "Decline", "Defer"], required: true, evidenceHint: "Persist actor, timestamp, action, and related item." },
    { id: "governance-note", prompt: "What is the decision update?", helper: "Declines and deferrals require an explanation; acceptances also retain a decision note.", input: "text", required: true, evidenceHint: "Store the note in the immutable decision ledger." },
    { id: "governance-until", prompt: "If deferred, when must it return?", helper: "A deferral must have a future timestamp so dwell time can be measured.", input: "text", required: false, evidenceHint: "Calculate time in deferred status." },
  ], completionSignal: "Action, note, actor, and deferral timing are explicit." },
  { id: "agent-supervision", name: "Agent supervision and stop", phase: "closure", purpose: "Monitor agent health and preserve pause, resume, restart, and kill actions with operator attribution.", agent: "readiness-facilitator", route: "agentkit.runtime.supervision", skillContract: "P21-SKILL-RUNTIME-08", humanGate: "Operator confirms lifecycle action and reason.", questions: [
    { id: "runtime-agent", prompt: "Which agent or run requires supervision?", helper: "Select the exact agent identity and current execution context.", input: "text", required: true, evidenceHint: "Link the lifecycle event to the agent trace." },
    { id: "runtime-action", prompt: "What lifecycle action is required?", helper: "Pause or kill for safety; restart only after reviewing the cause.", input: "choice", options: ["Pause", "Resume", "Restart", "Kill"], required: true, evidenceHint: "Record the lifecycle action and operator." },
    { id: "runtime-reason", prompt: "Why is the action being taken?", helper: "A kill action cannot be recorded without a reason.", input: "text", required: true, evidenceHint: "Store the reason with the execution trace." },
  ], completionSignal: "Agent identity, lifecycle action, reason, and trace link are present." },
];

export const embeddedEccModule = {
  moduleId: "northstar-ecc-module",
  mode: "embedded-source-compatible-module",
  upstream: { name: eccCatalog.name, version: eccCatalog.version, repository: eccCatalog.repository, site: eccCatalog.website },
  components: [
    { id: "skills", label: "Skills", status: "embedded", description: "Local Part 21 skills with progressive questions, evidence hints, and gates." },
    { id: "agents", label: "Agents", status: "embedded", description: "AgentKit agents mapped to skills and callable MCP tools." },
    { id: "registry", label: "Agent registry", status: "embedded", description: "Local lifecycle registry with pause, resume, restart, and kill controls." },
    { id: "hooks", label: "Hooks", status: "mapped", description: "Human-gate and governance transitions are represented as auditable application events." },
    { id: "observability", label: "Observability", status: "mapped", description: "Agent activity is traced now; production adapter target is OpenTelemetry-compatible export." },
    { id: "workflows", label: "Workflows", status: "embedded", description: "Five-phase audit flow plus skill-aware governance board." },
  ],
  inheritance: { upstreamSkillsVisible: true, inheritedComponents: [], localSkillCount: 8, localSkillsOwnedByApplication: true },
  operationalSkills: applicationSkills.map(({ questions, ...skill }) => ({ ...skill, questionCount: questions.length })),
  portability: { agentRuntime: "AgentKit-compatible routes", modelBoundary: "provider-neutral", dataBoundary: "MCP and HTTP adapters", target: "Gemini Enterprise / Vertex AI or other agent runtime" },
};

export function getEccCatalog() {
  return { ...eccCatalog, skillCount: 8, agentCount: 5, sourceLinked: true, embedded: true, moduleId: embeddedEccModule.moduleId };
}

export function getEmbeddedEccModule() {
  return embeddedEccModule;
}
