import { evidence, findings, audits } from "./demo";
import { part21RegulatoryPack } from "./regulatory";

export type PolicyDisposition = "covered" | "partial" | "gap" | "not_applicable";

export interface PolicyRule {
  id: string;
  citation: string;
  title: string;
  intent: string;
  ruleType: "scope" | "evidence" | "timeliness" | "approval" | "notification" | "records" | "procurement";
  requiredEvidence: string[];
  evaluator: string;
  humanGate: string;
  sourceSectionId: string;
  version: string;
}

export const part21PolicyPack = {
  id: "part21-policy-as-code",
  name: "Part 21 Assurance Policy Pack",
  policyVersion: "2026.11.13-client-overlay-0.1",
  sourceDocument: "10 CFR Part 21",
  sourceUri: "https://www.ecfr.gov/current/title-10/chapter-I/part-21",
  sourceAuthority: "U.S. NRC / eCFR",
  generatedAt: "2026-11-17T00:00:00Z",
  semanticModel: "part21-assurance-ontology",
  interpretationOverlay: "Client procedure and approved legal/compliance interpretations must be versioned separately from the regulation.",
  rules: [
    { id: "P21-PURPOSE-001", citation: "§21.1", title: "Part 21 process exists", intent: "The organization maintains a controlled process for identifying, evaluating, escalating, and recording defects and noncompliance.", ruleType: "scope", requiredEvidence: ["approved Part 21 procedure", "roles and delegation matrix"], evaluator: "part21_process_presence", humanGate: "Audit lead confirms the controlled process.", sourceSectionId: "21.1", version: "1.0" },
    { id: "P21-POSTING-001", citation: "§21.6", title: "Required contacts are posted", intent: "Required Part 21 information and responsible contacts are accessible to affected personnel.", ruleType: "approval", requiredEvidence: ["current postings", "electronic notice location", "responsible officer designation"], evaluator: "posting_accessibility", humanGate: "Audit lead verifies the contact notice.", sourceSectionId: "21.6", version: "1.0" },
    { id: "P21-EXEMPTION-001", citation: "§21.7", title: "Exemptions are controlled", intent: "Any claimed exemption or exclusion has an applicability decision and approved legal basis.", ruleType: "approval", requiredEvidence: ["exemption record", "applicability decision", "client legal or compliance review"], evaluator: "exemption_applicability", humanGate: "Compliance approver confirms the exemption basis.", sourceSectionId: "21.7", version: "1.0" },
    { id: "P21-COLLECTION-001", citation: "§21.8", title: "Information collection is controlled", intent: "Controlled forms and records support the approved Part 21 information collection requirements.", ruleType: "records", requiredEvidence: ["controlled forms", "record completeness check", "retention mapping"], evaluator: "information_collection_control", humanGate: "Records owner accepts the collection controls.", sourceSectionId: "21.8", version: "1.0" },
    { id: "P21-SCOPE-001", citation: "§21.2", title: "Applicability is established", intent: "The audited entity, activity, basic component, supplier, and authorization boundary are explicitly classified.", ruleType: "scope", requiredEvidence: ["license or authorization scope", "basic-component classification", "supplier applicability assessment"], evaluator: "scope_framing", humanGate: "Audit lead confirms applicability.", sourceSectionId: "21.2", version: "1.0" },
    { id: "P21-DEFINITIONS-001", citation: "§21.3", title: "Defined terms are used consistently", intent: "Defect, deviation, failure to comply, and substantial safety hazard classifications have a documented rationale.", ruleType: "scope", requiredEvidence: ["classification rationale", "definition crosswalk", "technical evaluation record"], evaluator: "classification_consistency", humanGate: "Quality or compliance reviewer confirms classification.", sourceSectionId: "21.3", version: "1.0" },
    { id: "P21-INTERPRETATION-001", citation: "§21.4", title: "Interpretation is controlled", intent: "The approved client or legal interpretation used by the agent is linked to the conclusion.", ruleType: "approval", requiredEvidence: ["approved interpretation memo", "interpretation version", "legal or compliance review"], evaluator: "interpretation_provenance", humanGate: "Designated compliance approver accepts the interpretation.", sourceSectionId: "21.4", version: "1.0" },
    { id: "P21-PROCUREMENT-001", citation: "§21.31", title: "Procurement responsibilities flow down", intent: "Supplier quality, acceptance, traceability, and Part 21 responsibilities are present in controlled procurement records.", ruleType: "procurement", requiredEvidence: ["purchase order clauses", "supplier quality requirements", "flow-down review"], evaluator: "supplier_flowdown", humanGate: "Supplier quality owner accepts the flow-down.", sourceSectionId: "21.31", version: "1.0" },
    { id: "P21-EVALUATION-001", citation: "§21.21", title: "Evaluation is initiated and time-bounded", intent: "A discovered deviation or failure to comply has a discovery time, evaluator, due date, and evaluation decision path.", ruleType: "timeliness", requiredEvidence: ["discovery timestamp", "evaluation tracker", "technical evaluation", "responsible officer notification"], evaluator: "evaluation_timeliness", humanGate: "Responsible officer approves the evaluation disposition.", sourceSectionId: "21.21", version: "1.0" },
    { id: "P21-RECORDS-001", citation: "§21.51", title: "Records are complete and retrievable", intent: "Source evidence, evaluation rationale, approvals, revisions, and reportability decisions can be reconstructed.", ruleType: "records", requiredEvidence: ["evaluation record", "source evidence", "approval history", "retention and retrieval test"], evaluator: "record_completeness", humanGate: "Records owner confirms retrieval and integrity.", sourceSectionId: "21.51", version: "1.0" },
    { id: "P21-NOTIFICATION-001", citation: "§21.61", title: "Notification decision is accountable", intent: "The reportability or non-reportability decision has a safety-significance analysis, owner, rationale, and notification record where required.", ruleType: "notification", requiredEvidence: ["reportability determination", "safety significance analysis", "affected component list", "notification draft or disposition"], evaluator: "notification_accountability", humanGate: "Designated person approves reportability disposition.", sourceSectionId: "21.61", version: "1.0" },
    { id: "P21-COMMUNICATIONS-001", citation: "§21.5", title: "Communication and responsible contacts are current", intent: "Employees can reach the accountable Part 21 contact and escalation path.", ruleType: "approval", requiredEvidence: ["responsible officer designation", "escalation contact test", "current electronic notice location"], evaluator: "contact_availability", humanGate: "Audit lead verifies the contact path.", sourceSectionId: "21.5", version: "1.0" },
    { id: "P21-INSPECTION-001", citation: "§21.41", title: "Inspection retrieval works", intent: "The organization can retrieve the records and people needed to support an inspection.", ruleType: "records", requiredEvidence: ["inspection request log", "record retrieval test", "inspection response package"], evaluator: "inspection_retrieval", humanGate: "Quality reviewer accepts the response package.", sourceSectionId: "21.41", version: "1.0" },
    { id: "P21-ESCALATION-001", citation: "§21.62", title: "Serious violations escalate", intent: "Suspected deliberate or material violations route to approved legal and compliance channels.", ruleType: "approval", requiredEvidence: ["escalation record", "investigation record", "legal or compliance review"], evaluator: "serious_violation_escalation", humanGate: "Legal/compliance owner confirms escalation.", sourceSectionId: "21.62", version: "1.0" },
  ] as PolicyRule[],
};

const evidenceText = evidence.map((item) => `${item.id} ${item.title} ${item.type} ${item.state} ${item.source}`).join(" ").toLowerCase();

function ruleDisposition(rule: PolicyRule, findingId: string): PolicyDisposition {
  const hitCount = rule.requiredEvidence.filter((needle) => evidenceText.includes(needle.split(" ")[0])).length;
  if (rule.id === "P21-RECORDS-001" && findingId === "FIND-2026-04") return "partial";
  if (hitCount >= Math.max(1, Math.ceil(rule.requiredEvidence.length * 0.7))) return "covered";
  if (hitCount > 0) return "partial";
  return "gap";
}

export function evaluatePart21Policy(findingId = "FIND-2026-04", asOf = "2026-11-17") {
  const results = part21PolicyPack.rules.map((rule) => ({ rule, disposition: ruleDisposition(rule, findingId), evaluatedAt: asOf, provenance: { sourceDocument: part21PolicyPack.sourceDocument, sourceUri: part21PolicyPack.sourceUri, policyVersion: part21PolicyPack.policyVersion, evaluator: rule.evaluator } }));
  const covered = results.filter((result) => result.disposition === "covered").length;
  const partial = results.filter((result) => result.disposition === "partial").length;
  const gaps = results.filter((result) => result.disposition === "gap").length;
  return { findingId, policyPack: part21PolicyPack.id, policyVersion: part21PolicyPack.policyVersion, asOf, coverage: Math.round(((covered + partial * 0.5) / results.length) * 100), counts: { total: results.length, covered, partial, gaps }, results, humanReviewRequired: true };
}

export function buildPolicyGraph() {
  const documentId = "DOC-10CFR-PART21";
  const nodes = [
    { id: documentId, type: "policy_document", label: "10 CFR Part 21", version: part21PolicyPack.policyVersion, sourceUri: part21PolicyPack.sourceUri },
    ...part21PolicyPack.rules.map((rule) => ({ id: rule.id, type: "policy_rule", label: `${rule.citation} · ${rule.title}`, citation: rule.citation, evaluator: rule.evaluator, humanGate: rule.humanGate })),
    { id: "AGENT-POLICY-EVALUATOR", type: "agent", label: "Part 21 Policy Evaluator", tools: ["policy_evaluate", "policy_coverage", "policy_graph"] },
    { id: "GATE-PART21-APPROVAL", type: "human_gate", label: "Designated person / quality approval" },
  ];
  const edges = [
    ...part21PolicyPack.rules.map((rule) => ({ from: documentId, to: rule.id, type: "defines", label: rule.citation })),
    ...part21PolicyPack.rules.map((rule) => ({ from: "AGENT-POLICY-EVALUATOR", to: rule.id, type: "evaluates", label: rule.evaluator })),
    ...part21PolicyPack.rules.map((rule) => ({ from: rule.id, to: "GATE-PART21-APPROVAL", type: "requires", label: rule.humanGate })),
  ];
  return { document: part21PolicyPack, nodes, edges, graphModel: "semantic policy graph: document → rule → evaluator → evidence → human gate" };
}

export function getPolicyCoverage(auditId = "AUD-026") {
  const evaluation = evaluatePart21Policy("FIND-2026-04");
  const audit = audits.find((item) => item.id === auditId) ?? audits[0];
  return { auditId, audit, evaluation, uncoveredRules: evaluation.results.filter((item) => item.disposition !== "covered").map((item) => ({ id: item.rule.id, citation: item.rule.citation, title: item.rule.title, requiredEvidence: item.rule.requiredEvidence, humanGate: item.rule.humanGate })) };
}
