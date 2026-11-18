import type { AuditProfileDefinition } from "../shared/regulatory";
import { getGovernanceRepository, type GovernanceRepository } from "./config-governance";
import { evaluatePolicyScoped, getControlledPolicyPack, runtimeDependencies, validateGovernedPolicyPack, type PolicyRuntimeDependencies, type ScopedPolicyInput } from "./policy-runtime";
import { getProvisionCoverage, getRegulatorySnapshotStore, listSourceSnapshots, type RegulatorySnapshotStore } from "./regulatory-source";

export { registerRegulatorySnapshot, ingestEcfrSource, ingestNrcGuidancePdf, listSourceSnapshots, getProvisionCoverage } from "./regulatory-source";

export async function getControlledRegulatoryPack(auditId?: string, deps: PolicyRuntimeDependencies = runtimeDependencies()) {
  const pack = await getControlledPolicyPack(auditId, deps);
  const snapshots = await Promise.all(pack.snapshotIds.map(id => deps.snapshot(id)));
  return { id: pack.id, title: pack.sourceDocument, currentAsOf: null, versionMode: "audit-pinned-source-snapshots", policyVersion: pack.policyVersion,
    snapshots: snapshots.map(s => ({ id: s.id, sourceId: s.sourceId, sourceAsOf: s.sourceAsOf, retrievedAt: s.retrievedAt, latestAmendedOn: s.latestAmendedOn, latestIssueDate: s.latestIssueDate, legalStatus: s.legalStatus })),
    sections: snapshots.flatMap(s => s.provisions.filter(p => p.kind === "section" || p.kind === "criterion").map(p => ({ id: p.id, title: p.heading, citation: p.citation, text: p.text, snapshotId: s.id, originalId: p.originalId, obligations: pack.obligations.filter(o => o.source.snapshotId === s.id && o.source.provisionId === p.id) }))),
    sources: snapshots.flatMap(s => s.originals.map(o => ({ id: o.id, label: `${s.sourceId}: ${o.kind}`, url: o.finalUri, sha256: o.sha256 }))), implementationGuidance: [],
    source: "mysql-database-pinned-regulatory-snapshots", humanReviewRequired: true };
}
function scoped(input: ScopedPolicyInput | string | undefined, auditId?: string): ScopedPolicyInput {
  if (typeof input === "object") return input;
  if (!input || !auditId) throw new Error("Explicit auditId and findingId required; regulatory traversal cannot choose another audit/finding");
  return { findingId: input, auditId };
}
export async function traverseControlledRegulatoryTree(input?: ScopedPolicyInput | string, auditId?: string, deps: PolicyRuntimeDependencies = runtimeDependencies()) {
  const request = scoped(input, auditId);
  const evaluation = await evaluatePolicyScoped(request, deps);
  const rulePaths = evaluation.results.map(r => ({ auditId: evaluation.auditId, findingId: evaluation.findingId, snapshotId: r.provenance.snapshotId, provisionId: r.provenance.provisionId, citation: r.rule.citation, obligationId: r.rule.obligationId ?? null, ruleId: r.rule.id, evidenceIds: r.evidenceIds, applicabilityDecisionId: r.applicabilityDecisionId, interpretationApprovalId: r.provenance.interpretationApprovalId, evaluatorApprovalId: r.provenance.evaluatorApprovalId, disposition: r.disposition, reasons: r.reasons, basis: r.basis }));
  const sourceIds = [...new Set(rulePaths.flatMap(r => [r.snapshotId, r.provisionId, ...r.evidenceIds].filter((id): id is string => !!id)))];
  const path = [evaluation.auditId, evaluation.findingId, ...sourceIds];
  return { auditId: evaluation.auditId, findingId: evaluation.findingId, path, rulePaths,
    violationHypothesis: evaluation.counts.fail ? `${evaluation.counts.fail} reviewed deterministic evidence tests failed. Qualified technical/legal assessment is required; a failed test is not automatically a Part21-reportable defect.` : "No violation conclusion is inferred. Unknown/missing evidence and applicability remain explicit.",
    risk: "Unknown", impactIfNotRemediated: "Risk and safety significance require an audit-scoped qualified technical determination.",
    remediation: evaluation.results.filter(r => r.disposition === "fail" || r.disposition === "unknown").map(r => ({ ruleId: r.rule.id, title: r.rule.title, citation: r.rule.citation, reasons: r.reasons, missingEvidenceTypes: r.missingEvidenceTypes, humanGate: r.rule.humanGate })),
    sources: sourceIds, source: "mysql-database-scoped-reviewed-policy-traversal", regulatoryPackVersion: evaluation.policyVersion, asOf: evaluation.asOf, knowledgeAsOf: evaluation.knowledgeAsOf,
    traversalProof: { query: { auditId: evaluation.auditId, findingId: evaluation.findingId, policyVersion: evaluation.policyVersion, asOf: evaluation.asOf, knowledgeAsOf: evaluation.knowledgeAsOf }, sourceIds, ruleIds: rulePaths.map(r => r.ruleId), evidenceIds: [...new Set(rulePaths.flatMap(r => r.evidenceIds))], type: "source-obligation-rule-evidence projection; no operational knowledge-graph query claimed" }, humanReviewRequired: true };
}
export async function assessControlledRemediationImpact(input?: ScopedPolicyInput | string, auditId?: string, deps: PolicyRuntimeDependencies = runtimeDependencies()) {
  const trace = await traverseControlledRegulatoryTree(input, auditId, deps);
  return { auditId: trace.auditId, findingId: trace.findingId, risk: trace.risk, impactIfNotRemediated: trace.impactIfNotRemediated, remediation: trace.remediation.map(item => `${item.citation}: ${item.reasons.join("; ")}`), source: trace.source, sources: trace.sources, humanReviewRequired: true };
}
export async function getAuditProfiles(repository: GovernanceRepository = getGovernanceRepository()) {
  const versions = await repository.listVersions("audit_profile");
  const activeByConfig = new Map<string, number>();
  for (const version of versions.filter(v => v.status === "active")) activeByConfig.set(version.configId, (activeByConfig.get(version.configId) ?? 0) + 1);
  const ambiguous = [...activeByConfig].filter(([, count]) => count > 1).map(([id]) => id);
  if (ambiguous.length) throw new Error(`Competing active audit profile definitions: ${ambiguous.join(", ")}`);
  return { source: "mysql-database-controlled-configuration", profiles: versions.filter(v => v.status !== "retired").map(v => {
    const profile = v.payload as AuditProfileDefinition;
    if (!profile || profile.id !== v.configId || profile.version !== v.version || !Array.isArray(profile.requiredProvisionIds) || !Array.isArray(profile.requiredEvidenceTypes) || !Array.isArray(profile.reviewerRoles)) throw new Error(`Invalid database audit profile definition: ${v.configId}/${v.version}`);
    return { ...profile, status: v.status, sourceSha256: v.sourceSha256, selectionAllowed: v.status === "active", humanReviewRequired: v.status !== "active" };
  }), emptyState: versions.length === 0 };
}
export async function getAuditRegulatoryCoverage(auditId: string, deps: PolicyRuntimeDependencies = runtimeDependencies(), store: RegulatorySnapshotStore = getRegulatorySnapshotStore()) {
  const pack = await getControlledPolicyPack(auditId, deps);
  const validation = await validateGovernedPolicyPack(pack, deps);
  const snapshots = await Promise.all(pack.snapshotIds.map(id => getProvisionCoverage(id, pack.rules.filter(r => r.source?.snapshotId === id).map(r => ({ provisionId: r.source!.provisionId, interpretationApprovalId: r.interpretationApprovalId, evaluatorApprovalId: r.evaluatorApprovalId })), store)));
  return { auditId, policyId: pack.id, policyVersion: pack.policyVersion, snapshots,
    ruleReviewStatus: pack.rules.map(r => ({ ruleId: r.id, disposition: validation.issues.some(i => i.ruleId === r.id) ? "unknown" : "reviewed-evaluator-available", issues: validation.issues.find(i => i.ruleId === r.id)?.reasons ?? [] })), complianceCoverage: null, humanReviewRequired: true, source: "mysql-database-audit-pinned-regulatory-coverage" };
}
export async function getRegulatorySourceCatalog(store: RegulatorySnapshotStore = getRegulatorySnapshotStore()) { return { snapshots: await listSourceSnapshots(undefined, store), source: "mysql-database-original-source-snapshots", humanReviewRequired: true }; }
