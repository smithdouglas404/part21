export type AuditSkillPhase = "scope" | "evidence" | "traceability" | "findings" | "closure";

export interface AuditQuestion {
  id: string;
  prompt: string;
  helper: string;
  input: "text" | "choice" | "checklist";
  options?: string[];
  required: boolean;
  evidenceHint: string;
}

export interface AuditSkill {
  id: string;
  name: string;
  phase: AuditSkillPhase;
  purpose: string;
  agent: string;
  route: string;
  skillContract: string;
  humanGate: string;
  questions: AuditQuestion[];
  completionSignal: string;
  regulatoryRefs?: string[];
  /** References cited by the skill that are deliberately outside the ingested regulatory set. */
  externalRefs?: { reference: string; basis: string }[];
  domain?: "part21" | "appendix-b" | "nuclear-overlay";
  requiredEvidence?: string[];
  definitionStatus?: "draft_candidate";
  clockPolicy?: { id: string; trigger: string; duration: string; deadlineBasis: "calendar_days" | "working_days" | "human_gate" }[];
}

export interface AgentKitAgent {
  id: string;
  name: string;
  role: string;
  trigger: string;
  tools: string[];
  humanGate: string;
}

export const auditPhases: { id: AuditSkillPhase; label: string; short: string; description: string }[] = [
  { id: "scope", label: "1. Frame the audit", short: "Scope", description: "Set the boundary, accountable roles, standard, and risk lens." },
  { id: "evidence", label: "2. Pull evidence", short: "Evidence", description: "Gather source records, test freshness, and identify missing joins." },
  { id: "traceability", label: "3. Trace the chain", short: "Traceability", description: "Walk product, requirement, supplier, change, and person relationships." },
  { id: "findings", label: "4. Evaluate findings", short: "Findings", description: "Challenge signals, draft findings, and preserve rationale." },
  { id: "closure", label: "5. Review & close", short: "Closure", description: "Prepare the readiness report and route decisions for approval." },
];

export const auditSkills: AuditSkill[] = [
  {
    id: "frame-scope",
    name: "Scope framing interview",
    phase: "scope",
    purpose: "Turn an audit request into a bounded, reviewable scope with explicit accountability.",
    agent: "scope-facilitator",
    route: "agentkit.audit.scope_framing",
    skillContract: "P21-SKILL-SCOPE-01",
    humanGate: "Audit lead confirms scope and accountable owner.",
    questions: [
      { id: "scope-object", prompt: "What product, facility, process, or change is in scope?", helper: "Name the object employees would put on the audit cover sheet.", input: "text", required: true, evidenceHint: "Create or link the scope anchor in the graph." },
      { id: "scope-standard", prompt: "Which requirement families must this audit test?", helper: "Separate Part 21 applicability/evaluation from the applicable Appendix B QA criteria; qualified interpretation is required.", input: "choice", options: ["10 CFR 21.21 evaluation and notification", "10 CFR 21.51 maintenance and inspection of records", "Appendix B VII/VIII supplier control and item identification", "Appendix B XV/XVI nonconformance and corrective action", "Client-approved configuration control"], required: true, evidenceHint: "Bind the scope to exact governed requirement IDs; no generic first-section mapping." },
      { id: "scope-risk", prompt: "What would make this scope higher risk than normal?", helper: "Consider safety classification, recent change, supplier exposure, or weak evidence.", input: "text", required: true, evidenceHint: "Store risk rationale as an audit context note." },
    ],
    completionSignal: "Scope anchor, control families, risk rationale, and accountable owner are present.",
  },
  {
    id: "evidence-intake",
    name: "Evidence intake coach",
    phase: "evidence",
    purpose: "Guide an employee through evidence retrieval without hiding freshness, provenance, or gaps.",
    agent: "evidence-curator",
    route: "agentkit.audit.evidence_intake",
    skillContract: "P21-SKILL-EVIDENCE-02",
    humanGate: "Evidence owner confirms that the source set is complete enough to review.",
    questions: [
      { id: "evidence-sources", prompt: "Which source systems or controlled records should be queried?", helper: "Include quality, document control, supplier, role, and field sources where relevant.", input: "checklist", options: ["Quality system of record", "Document control", "Supplier portal", "People & delegated roles", "Field / maintenance data"], required: true, evidenceHint: "Create source coverage links and freshness checks." },
      { id: "evidence-window", prompt: "What effective-date window should the evidence cover?", helper: "Use the change or audit period, not only the latest revision.", input: "text", required: true, evidenceHint: "Set the temporal query boundary." },
      { id: "evidence-gap", prompt: "What record is missing, stale, or difficult to reconcile?", helper: "The agent will turn this into a traceability probe, not an automatic finding.", input: "text", required: false, evidenceHint: "Create a review task with source provenance." },
    ],
    completionSignal: "Source set, effective-date window, freshness, and evidence gaps are recorded.",
  },
  {
    id: "trace-chain",
    name: "Genealogy trace guide",
    phase: "traceability",
    purpose: "Walk the employee through upstream and downstream links until each conclusion has a defensible path.",
    agent: "genealogy-navigator",
    route: "agentkit.audit.trace_chain",
    skillContract: "P21-SKILL-TRACE-03",
    humanGate: "Quality reviewer accepts the trace boundary and unresolved edges.",
    questions: [
      { id: "trace-anchor", prompt: "Which product, lot, component, or change should be traced first?", helper: "Start with the object that carries the highest consequence or uncertainty.", input: "text", required: true, evidenceHint: "Open the selected entity in the knowledge graph." },
      { id: "trace-direction", prompt: "Which direction should the first pass follow?", helper: "You can run both directions after the first pass.", input: "choice", options: ["Upstream: requirement → product → supplier", "Downstream: change → evidence → affected work", "Both directions"], required: true, evidenceHint: "Persist the graph traversal intent." },
      { id: "trace-unresolved", prompt: "Which relationship is not yet explained?", helper: "An unresolved edge is a review signal, not proof of noncompliance.", input: "text", required: false, evidenceHint: "Create an evidence reconciliation task." },
    ],
    completionSignal: "Anchor, traversal direction, direct relationships, and unresolved edges are visible.",
  },
  {
    id: "finding-challenge",
    name: "Finding challenge dialogue",
    phase: "findings",
    purpose: "Help an employee challenge a signal before drafting a finding and preserve the reasoning trail.",
    agent: "finding-challenger",
    route: "agentkit.audit.finding_challenge",
    skillContract: "P21-SKILL-FINDING-04",
    humanGate: "Accountable audit lead approves severity, wording, and owner before issue.",
    questions: [
      { id: "finding-signal", prompt: "What signal or condition needs to be evaluated?", helper: "Bring forward an agent alert, evidence gap, interview note, or observed condition.", input: "text", required: true, evidenceHint: "Link the signal to one or more source records." },
      { id: "finding-test", prompt: "What would disprove or downgrade this signal?", helper: "A good challenge makes the final finding more defensible.", input: "text", required: true, evidenceHint: "Store counter-evidence search criteria." },
      { id: "finding-severity", prompt: "What is the provisional significance?", helper: "This remains provisional until a human reviewer approves it.", input: "choice", options: ["Critical", "Major", "Moderate", "Observation"], required: true, evidenceHint: "Record rationale and proposed owner." },
    ],
    completionSignal: "Signal, counter-evidence test, provisional severity, rationale, and owner are captured.",
  },
  {
    id: "readiness-close",
    name: "Readiness review facilitator",
    phase: "closure",
    purpose: "Prepare a reportable readiness position while clearly separating facts, recommendations, and human decisions.",
    agent: "readiness-facilitator",
    route: "agentkit.audit.readiness_close",
    skillContract: "P21-SKILL-CLOSE-05",
    humanGate: "Audit lead and quality approver accept the report disposition.",
    questions: [
      { id: "close-position", prompt: "What is the readiness position you are prepared to defend?", helper: "Use ready, ready with actions, or not ready; explain the boundary.", input: "choice", options: ["Ready", "Ready with actions", "Not ready"], required: true, evidenceHint: "Bind the position to coverage and open finding facts." },
      { id: "close-actions", prompt: "Which actions must happen before the next gate?", helper: "Rank actions by consequence, evidence weakness, and due date.", input: "text", required: true, evidenceHint: "Create accountable next moves and due dates." },
      { id: "close-approver", prompt: "Who must approve or acknowledge this report?", helper: "Name the accountable role, not only the person who prepared it.", input: "text", required: true, evidenceHint: "Create the approval route and immutable decision record." },
    ],
    completionSignal: "Readiness position, action list, approver, and report disposition are explicit.",
  },
];

export const agentKitAgents: AgentKitAgent[] = [
  { id: "scope-facilitator", name: "Scope Facilitator", role: "Turns ambiguity into an auditable scope", trigger: "audit.started", tools: ["search_entities", "detect_control_gaps", "recommend_next_moves"], humanGate: "Scope confirmation" },
  { id: "evidence-curator", name: "Evidence Curator", role: "Finds, ranks, and reconciles source records", trigger: "audit.scope_confirmed", tools: ["search_entities", "get_evidence", "check_audit_readiness"], humanGate: "Evidence sufficiency" },
  { id: "genealogy-navigator", name: "Genealogy Navigator", role: "Traces product and change relationships", trigger: "evidence.set_ready", tools: ["trace_product_genealogy", "compare_temporal_versions"], humanGate: "Trace acceptance" },
  { id: "finding-challenger", name: "Finding Challenger", role: "Tests signals and drafts reviewable findings", trigger: "trace.unresolved_edge", tools: ["detect_control_gaps", "create_finding"], humanGate: "Finding approval" },
  { id: "readiness-facilitator", name: "Readiness Facilitator", role: "Assembles facts into a report disposition", trigger: "finding.reviewed", tools: ["check_audit_readiness", "recommend_next_moves"], humanGate: "Report disposition" },
];

export function getSkillForPhase(phase: AuditSkillPhase) {
  const skill = auditSkills.find((candidate) => candidate.phase === phase);
  if (!skill) throw new Error(`No skill definition exists for phase ${phase}.`);
  return skill;
}
