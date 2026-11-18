import { getControlledConfiguration } from "./config-store";
import { getDomainPortfolio, listAudits } from "./domain-store";

type PolicyPack = { id: string; policyVersion: string; sourceDocument: string; sourceUri: string; sourceAuthority: string; semanticModel: string; rules: any[] };

export async function getControlledPolicyPack(): Promise<PolicyPack> {
  const row = await getControlledConfiguration<PolicyPack>("policy", "part21-policy-as-code");
  return row.payload;
}

export async function evaluateControlledPolicy(findingId: string, asOf = new Date().toISOString().slice(0, 10)) {
  if (!findingId) throw new Error("findingId is required; select a database finding.");
  const audits = await listAudits();
  const auditId = (audits as any[])[0]?.id;
  if (!auditId) throw new Error("No database audit is available for policy evaluation.");
  const [pack, portfolio] = await Promise.all([getControlledPolicyPack(), getDomainPortfolio(auditId)]);
  const evidenceText = (portfolio.evidence as any[]).map((item) => JSON.stringify(item)).join(" ").toLowerCase();
  const results = pack.rules.map((rule) => {
    const hitCount = (rule.requiredEvidence ?? []).filter((needle: string) => evidenceText.includes(String(needle).split(" ")[0].toLowerCase())).length;
    const disposition = hitCount >= Math.max(1, Math.ceil((rule.requiredEvidence?.length ?? 1) * 0.7)) ? "covered" : hitCount > 0 ? "partial" : "gap";
    return { rule, disposition, evaluatedAt: asOf, provenance: { sourceDocument: pack.sourceDocument, sourceUri: pack.sourceUri, policyVersion: pack.policyVersion, evaluator: rule.evaluator } };
  });
  const covered = results.filter((item) => item.disposition === "covered").length;
  const partial = results.filter((item) => item.disposition === "partial").length;
  const gaps = results.filter((item) => item.disposition === "gap").length;
  return { findingId, policyPack: pack.id, policyVersion: pack.policyVersion, asOf, coverage: Math.round(((covered + partial * 0.5) / Math.max(1, results.length)) * 100), counts: { total: results.length, covered, partial, gaps }, results, humanReviewRequired: true, source: "mysql-database-controlled-configuration" };
}

export async function getControlledPolicyCoverage(auditId: string) {
  if (!auditId) throw new Error("auditId is required; select a database audit.");
  const [pack, portfolio] = await Promise.all([getControlledPolicyPack(), getDomainPortfolio(auditId)]);
  const findingId = (portfolio.findings as any[])[0]?.id;
  if (!findingId) return { source: "mysql-database", auditId, audit: portfolio.audit, evaluation: null, uncoveredRules: pack.rules.map((rule) => ({ id: rule.id, citation: rule.citation, title: rule.title, requiredEvidence: rule.requiredEvidence, humanGate: rule.humanGate })) };
  const evaluation = await evaluateControlledPolicy(findingId);
  return { source: "mysql-database", auditId, audit: portfolio.audit, evaluation, uncoveredRules: evaluation.results.filter((item) => item.disposition !== "covered").map((item) => ({ id: item.rule.id, citation: item.rule.citation, title: item.rule.title, requiredEvidence: item.rule.requiredEvidence, humanGate: item.rule.humanGate })) };
}

export async function buildControlledPolicyGraph() {
  const pack = await getControlledPolicyPack();
  const documentId = `DOC-${pack.id}`;
  const nodes = [{ id: documentId, type: "policy_document", label: pack.sourceDocument, version: pack.policyVersion, sourceUri: pack.sourceUri }, ...pack.rules.map((rule) => ({ id: rule.id, type: "policy_rule", label: `${rule.citation} · ${rule.title}`, citation: rule.citation, evaluator: rule.evaluator, humanGate: rule.humanGate })), { id: "AGENT-POLICY-EVALUATOR", type: "agent", label: "Part 21 Policy Evaluator", tools: ["policy_evaluate", "policy_coverage", "policy_graph"] }, { id: "GATE-PART21-APPROVAL", type: "human_gate", label: "Designated person / quality approval" }];
  const edges = [...pack.rules.map((rule) => ({ from: documentId, to: rule.id, type: "defines", label: rule.citation })), ...pack.rules.map((rule) => ({ from: "AGENT-POLICY-EVALUATOR", to: rule.id, type: "evaluates", label: rule.evaluator })), ...pack.rules.map((rule) => ({ from: rule.id, to: "GATE-PART21-APPROVAL", type: "requires", label: rule.humanGate }))];
  return { document: pack, nodes, edges, graphModel: "semantic policy graph: document → rule → evaluator → evidence → human gate", source: "mysql-database-controlled-configuration" };
}

export async function compileControlledDocumentToPolicy(documentId: string) {
  const pack = await getControlledPolicyPack();
  return { documentId, mode: "semantic-policy-compiler", provider: "controlled policy configuration", pipeline: ["segment authoritative document", "extract obligations and conditions", "map concepts to assurance ontology", "generate rule candidates", "attach evidence and human gates", "run reviewer acceptance before activation"], candidateRules: pack.rules.map((rule) => ({ id: rule.id, citation: rule.citation, intent: rule.intent, evidence: rule.requiredEvidence, evaluator: rule.evaluator, humanGate: rule.humanGate, activation: "pending human approval" })), sourceProvenance: { sourceDocument: pack.sourceDocument, sourceUri: pack.sourceUri, policyVersion: pack.policyVersion }, warning: "Generated candidates are not a compliance conclusion. Controlled activation requires qualified human review." };
}
