import { part21RegulatoryPack } from "./regulatory";
import type { ReviewedObligation, SourceProvisionReference } from "./regulatory";

export type PolicyDisposition = "pass" | "fail" | "unknown" | "not_applicable";
export interface TypedEvidenceReference {
  id: string;
  auditId: string;
  findingIds: string[];
  evidenceType: string;
  validFrom: string;
  validTo: string | null;
  recordedAt: string;
  review: { decisionId: string; reviewerId: string; reviewedAt: string; status: "accepted" | "rejected" | "pending" } | null;
  original: { objectId: string; versionId: string; sha256: string } | null;
  facts: Record<string, unknown>;
}
export interface EvidenceRequirement { evidenceType: string; minimum: number; requireAcceptedReview: boolean; requireOriginal: boolean }
export interface PolicyRule {
  id: string; citation: string; title: string; intent: string;
  ruleType: "scope" | "evidence" | "timeliness" | "approval" | "notification" | "records" | "procurement";
  requiredEvidence: string[]; evaluator: string; humanGate: string; sourceSectionId: string; version: string;
  source?: SourceProvisionReference;
  obligationId?: string;
  interpretationApprovalId?: string;
  evaluatorApprovalId?: string;
  evidenceRequirements?: EvidenceRequirement[];
  parameters?: Record<string, unknown>;
}
export interface GovernedPolicyPack {
  id: string; policyVersion: string; sourceDocument: string; sourceUri: string; sourceAuthority: string;
  semanticModel: string; snapshotIds: string[]; obligations: ReviewedObligation[]; rules: PolicyRule[];
}
export interface PolicyEvaluationContext {
  auditId: string; findingId: string; asOf: string; knowledgeAsOf: string;
  applicability: { outcome: "applicable" | "not_applicable" | "unknown"; basis: string; decisionId: string | null; ruleIds: string[] };
  evidence: TypedEvidenceReference[];
}
export interface EvaluatorResult {
  disposition: PolicyDisposition; evidenceIds: string[]; missingEvidenceTypes: string[]; reasons: string[];
  basis: string; applicabilityDecisionId: string | null;
}
export interface RuleEvaluation extends EvaluatorResult {
  rule: PolicyRule; evaluatedAt: string;
  provenance: { snapshotId: string | null; provisionId: string | null; policyVersion: string; evaluator: string; interpretationApprovalId: string | null; evaluatorApprovalId: string | null; sourceUri: string };
}
export interface ObligationCandidate {
  id: string; source: SourceProvisionReference; originalId: string; citation: string;
  exactText: string; modality: "shall" | "must" | "may"; status: "candidate-human-review-required";
  evaluator: null; disposition: "unknown"; interpretationApprovalId: null;
}

/** Backward-compatible configuration preview only; runtime loads immutable DB baselines. */
export const part21PolicyPack = {
  id: "part21-policy-as-code", name: "Part 21 inventory candidates — not active policy",
  policyVersion: "source-link-inventory-v2", sourceDocument: "10 CFR Part 21",
  sourceUri: part21RegulatoryPack.sources[0].url, sourceAuthority: "U.S. NRC / eCFR",
  semanticModel: "review-required", interpretationOverlay: "No reviewed interpretation or evaluator is included.",
  rules: part21RegulatoryPack.sections.map((section): PolicyRule => ({
    id: `inventory:${section.id}`, citation: `10 CFR ${section.id}`, title: section.title,
    intent: "Inventory only; use downloaded provision text and a qualified reviewed interpretation.",
    ruleType: "evidence", requiredEvidence: [], evaluator: "unreviewed", humanGate: "Qualified human review required",
    sourceSectionId: section.id, version: "inventory-v2",
  })),
};
export function evaluatePart21Policy(findingId?: string, asOf?: string) {
  if (!findingId || !asOf) throw new Error("findingId and asOf required. This shared function is a non-operational unknown-only inventory preview.");
  const results = part21PolicyPack.rules.map(rule => ({ rule, disposition: "unknown" as const, evaluatedAt: asOf,
    provenance: { sourceDocument: part21PolicyPack.sourceDocument, sourceUri: part21PolicyPack.sourceUri, policyVersion: part21PolicyPack.policyVersion, evaluator: "not executed" },
    reasons: ["No database evidence, reviewed evaluator or pinned audit baseline was supplied."], evidenceIds: [] as string[] }));
  return { findingId, policyPack: part21PolicyPack.id, policyVersion: part21PolicyPack.policyVersion, asOf,
    coverage: null, counts: { total: results.length, pass: 0, fail: 0, unknown: results.length, not_applicable: 0 }, results,
    humanReviewRequired: true, source: "configuration-inventory-preview-only" };
}
export function buildPolicyGraph() {
  const documentId = part21PolicyPack.id;
  const nodes = [{ id: documentId, type: "policy_document", label: part21PolicyPack.sourceDocument },
    ...part21PolicyPack.rules.map(rule => ({ id: rule.id, type: "policy_rule", label: rule.title })),
    { id: `${documentId}:review`, type: "human_gate", label: "Unreviewed inventory; no approval recorded" },
    { id: `${documentId}:dispatch`, type: "evaluator_registry", label: "Not executed" }];
  const edges = part21PolicyPack.rules.flatMap(rule => [
    { from: documentId, to: rule.id, type: "defines", label: "candidate metadata" },
    { from: `${documentId}:dispatch`, to: rule.id, type: "evaluates", label: "not executed" },
    { from: rule.id, to: `${documentId}:review`, type: "requires", label: "human review" },
  ]);
  return { document: part21PolicyPack, nodes, edges, graphModel: "configuration-only inventory; not an operational knowledge graph" };
}
export function getPolicyCoverage(_auditId?: string): never { throw new Error("Use server getControlledPolicyCoverage with explicit audit scope."); }
export function compileDocumentToPolicy(_documentId?: string): never { throw new Error("Use server compileControlledDocumentToPolicy to read an actual stored original source."); }
