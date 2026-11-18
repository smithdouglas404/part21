import { createPool, type Pool } from "mysql2/promise";
import type { EvaluatorResult, GovernedPolicyPack, ObligationCandidate, PolicyEvaluationContext, PolicyRule, RuleEvaluation, TypedEvidenceReference } from "../shared/policy";
import type { RegulatorySnapshot } from "../shared/regulatory";
import { configurationDigest, getAuditPolicyBaseline } from "./config-governance";
import { dispatchPolicyEvaluator, policyEvaluatorRegistry } from "./policy-evaluators";
import { assertInstant, getRegulatorySnapshot, retrieveRegulatoryOriginal, sha256, validateProvisionReference } from "./regulatory-source";

export interface PolicyReviewRecord {
  id: string; disposition: "approved" | "rejected";
  subjectKind: "obligation" | "evaluator" | "applicability" | "evidence";
  subjectId: string; subjectVersion: string; artifactSha256: string;
  qualifiedReviewerId: string; qualificationEvidenceId: string;
  acceptedAt: string; acceptanceEvidenceIds: string[];
}
export interface PolicyApplicabilityRecord {
  id: string; auditId: string; findingId: string; ruleIds: string[];
  outcome: "applicable" | "not_applicable" | "unknown"; basis: string;
  validFrom: string; validTo: string | null; recordedAt: string; approvalId: string;
}
export interface PolicyRuntimeDependencies {
  finding(auditId: string, findingId: string): Promise<Record<string, unknown> | null>;
  findings(auditId: string): Promise<Record<string, unknown>[]>;
  audit(auditId: string): Promise<Record<string, unknown> | null>;
  evidence(auditId: string, findingId: string): Promise<TypedEvidenceReference[]>;
  applicability(auditId: string, findingId: string): Promise<PolicyApplicabilityRecord[]>;
  baseline(auditId: string): Promise<{ pin: { configId: string; version: string; sourceSha256: string; approvalId: string }; configuration: { payload: unknown; sourceSha256: string; version: string } }>;
  snapshot(id: string): Promise<RegulatorySnapshot>;
  original(snapshotId: string, originalId: string): Promise<Buffer>;
  review(id: string): Promise<PolicyReviewRecord | null>;
  now(): string;
}
export interface ScopedPolicyInput { auditId: string; findingId: string; asOf?: string; knowledgeAsOf?: string }
function required(value: string | undefined, name: string): asserts value is string { if (!value?.trim()) throw new Error(`${name} required; no arbitrary audit/finding selection permitted`); }
function validReview(review: PolicyReviewRecord | null, subjectKind: PolicyReviewRecord["subjectKind"], subjectId: string, subjectVersion: string, digest: string, knownAt: string) {
  return !!review && review.disposition === "approved" && review.subjectKind === subjectKind && review.subjectId === subjectId && review.subjectVersion === subjectVersion && review.artifactSha256 === digest && !!review.qualifiedReviewerId && !!review.qualificationEvidenceId && !!review.acceptanceEvidenceIds?.length && Number.isFinite(Date.parse(review.acceptedAt)) && Date.parse(review.acceptedAt) <= Date.parse(knownAt);
}
export function evaluatorReviewArtifact(rule: PolicyRule) { return { ruleId: rule.id, version: rule.version, evaluator: rule.evaluator, parameters: rule.parameters ?? null, evidenceRequirements: rule.evidenceRequirements ?? null, source: rule.source ?? null, obligationId: rule.obligationId ?? null }; }
export async function validateGovernedPolicyPack(pack: GovernedPolicyPack, deps: Pick<PolicyRuntimeDependencies, "snapshot" | "review" | "now"> = runtimeDependencies(), knowledgeAsOf?: string) {
  const known = assertInstant(knowledgeAsOf ?? deps.now(), "policy review clock");
  if (!pack?.id || !pack.policyVersion || !Array.isArray(pack.snapshotIds) || !pack.snapshotIds.length || !Array.isArray(pack.obligations) || !Array.isArray(pack.rules)) throw new Error("Governed policy pack schema/pinned source snapshots missing");
  if (new Set(pack.rules.map(r => r.id)).size !== pack.rules.length || new Set(pack.obligations.map(o => o.id)).size !== pack.obligations.length) throw new Error("Duplicate rule or obligation IDs");
  const snapshots = await Promise.all(pack.snapshotIds.map(id => deps.snapshot(id)));
  const issues: { ruleId: string; reasons: string[] }[] = [];
  for (const rule of pack.rules) {
    const reasons: string[] = [];
    const snapshot = snapshots.find(s => s.id === rule.source?.snapshotId);
    const obligation = pack.obligations.find(o => o.id === rule.obligationId);
    if (!snapshot || snapshot.sourceKind !== "ecfr-regulation" || !rule.source) reasons.push("Exact regulation snapshot/provision mapping absent; guidance is not automatically law");
    else {
      try { const provision = validateProvisionReference(snapshot, rule.source.provisionId, rule.source.textSha256); if (rule.citation !== provision.citation) reasons.push("Rule citation differs from exact ingested provision citation"); } catch (error) { reasons.push(String(error)); }
    }
    if (!obligation || !rule.source || configurationDigest(obligation.source) !== configurationDigest(rule.source) || !obligation.interpretation?.trim() || !obligation.applicabilityBasis?.trim() || obligation.interpretationApprovalId !== rule.interpretationApprovalId) reasons.push("Reviewed obligation/interpretation/source crosswalk missing or inconsistent");
    else {
      const interpretation = await deps.review(rule.interpretationApprovalId!);
      if (!validReview(interpretation, "obligation", obligation.id, obligation.version, configurationDigest({ ...obligation, interpretationApprovalId: null }), known)) reasons.push("Persisted qualified interpretation review does not bind exact obligation revision/digest");
    }
    if (!policyEvaluatorRegistry.has(rule.evaluator)) reasons.push(`No executable evaluator registered: ${rule.evaluator}`);
    if (!rule.evidenceRequirements?.length || rule.evidenceRequirements.some(e => !e.evidenceType || !Number.isInteger(e.minimum) || e.minimum < 1)) reasons.push("Typed mandatory evidence contract missing/invalid");
    if (!rule.evaluatorApprovalId || !validReview(await deps.review(rule.evaluatorApprovalId), "evaluator", rule.id, rule.version, configurationDigest(evaluatorReviewArtifact(rule)), known)) reasons.push("Persisted qualified evaluator/test review does not bind exact rule revision/digest");
    if (reasons.length) issues.push({ ruleId: rule.id, reasons });
  }
  return { valid: issues.length === 0 && pack.rules.length > 0, issues, snapshots };
}
export async function requireReviewedPolicyPack(pack: GovernedPolicyPack, deps?: Pick<PolicyRuntimeDependencies, "snapshot" | "review" | "now">, knownAt?: string) {
  const validation = await validateGovernedPolicyPack(pack, deps, knownAt);
  if (!validation.valid) throw new Error(`Policy activation blocked: ${validation.issues.map(i => `${i.ruleId}: ${i.reasons.join("; ")}`).join(" | ") || "No reviewed executable rules"}`);
  return validation;
}
export async function getControlledPolicyPack(auditId?: string, deps: PolicyRuntimeDependencies = runtimeDependencies()): Promise<GovernedPolicyPack> {
  required(auditId, "auditId");
  const baseline = await deps.baseline(auditId);
  if (configurationDigest(baseline.configuration.payload) !== baseline.pin.sourceSha256 || baseline.configuration.sourceSha256 !== baseline.pin.sourceSha256 || baseline.configuration.version !== baseline.pin.version) throw new Error("Pinned immutable policy version/digest mismatch");
  const pack = baseline.configuration.payload as GovernedPolicyPack;
  if (pack.id !== baseline.pin.configId || pack.policyVersion !== baseline.pin.version) throw new Error("Policy payload identity differs from audit baseline pin");
  return pack;
}
function unknown(context: PolicyEvaluationContext, reasons: string[]): EvaluatorResult { return { disposition: "unknown", evidenceIds: [], missingEvidenceTypes: [], reasons, basis: "Qualified source-linked policy review required", applicabilityDecisionId: context.applicability.decisionId }; }
async function applicabilityFor(rule: PolicyRule, records: PolicyApplicabilityRecord[], input: { auditId: string; findingId: string; asOf: string; knowledgeAsOf: string }, deps: PolicyRuntimeDependencies): Promise<PolicyEvaluationContext["applicability"]> {
  const relevant = records.filter(r => r.auditId === input.auditId && r.findingId === input.findingId && r.ruleIds?.includes(rule.id) && Number.isFinite(Date.parse(r.validFrom)) && Date.parse(r.validFrom) <= Date.parse(input.asOf) && Number.isFinite(Date.parse(r.recordedAt)) && Date.parse(r.recordedAt) <= Date.parse(input.knowledgeAsOf) && (r.validTo === null || Date.parse(input.asOf) < Date.parse(r.validTo)));
  if (relevant.length !== 1) return { outcome: "unknown", basis: relevant.length ? "Competing applicability records; no arbitrary decision selected" : "No effective/known rule-specific applicability decision", decisionId: null, ruleIds: [rule.id] };
  const record = relevant[0];
  const review = record.approvalId ? await deps.review(record.approvalId) : null;
  if (!validReview(review, "applicability", record.id, "1", configurationDigest({ ...record, approvalId: null }), input.knowledgeAsOf)) return { outcome: "unknown", basis: "Applicability record has no matching qualified approval", decisionId: null, ruleIds: [rule.id] };
  return { outcome: record.outcome, basis: record.basis, decisionId: record.id, ruleIds: record.ruleIds };
}
export async function evaluatePolicyScoped(input: ScopedPolicyInput, deps: PolicyRuntimeDependencies = runtimeDependencies()) {
  required(input.auditId, "auditId"); required(input.findingId, "findingId");
  const now = deps.now(), asOf = assertInstant(input.asOf ?? now, "asOf"), knowledgeAsOf = assertInstant(input.knowledgeAsOf ?? now, "knowledgeAsOf");
  const [finding, audit, pack, evidence, applicability] = await Promise.all([deps.finding(input.auditId, input.findingId), deps.audit(input.auditId), getControlledPolicyPack(input.auditId, deps), deps.evidence(input.auditId, input.findingId), deps.applicability(input.auditId, input.findingId)]);
  if (!audit || !finding || finding.id !== input.findingId || finding.auditId !== input.auditId) throw new Error("Requested finding does not exist in the explicit audit scope");
  if (!pack.rules.length) throw new Error("Pinned policy has no reviewed executable rules; evaluation is unavailable");
  const validation = await validateGovernedPolicyPack(pack, deps, knowledgeAsOf);
  // Typed accepted evidence must have a persisted matching review, not a payload-only boolean.
  const trustedEvidence = await Promise.all(evidence.map(async e => {
    if (!e.review || e.review.status !== "accepted") return e;
    const approved = await deps.review(e.review.decisionId);
    const digest = configurationDigest({ id: e.id, auditId: e.auditId, evidenceType: e.evidenceType, original: e.original, facts: e.facts, validFrom: e.validFrom, validTo: e.validTo, recordedAt: e.recordedAt });
    return validReview(approved, "evidence", e.id, "1", digest, knowledgeAsOf) ? e : { ...e, review: null };
  }));
  const results: RuleEvaluation[] = [];
  for (const rule of pack.rules) {
    const context: PolicyEvaluationContext = { auditId: input.auditId, findingId: input.findingId, asOf, knowledgeAsOf, evidence: trustedEvidence, applicability: await applicabilityFor(rule, applicability, { ...input, asOf, knowledgeAsOf }, deps) };
    const issues = validation.issues.find(i => i.ruleId === rule.id);
    const evaluation = issues ? unknown(context, issues.reasons) : dispatchPolicyEvaluator(rule, context);
    results.push({ ...evaluation, rule, evaluatedAt: asOf, provenance: { snapshotId: rule.source?.snapshotId ?? null, provisionId: rule.source?.provisionId ?? null, policyVersion: pack.policyVersion, evaluator: rule.evaluator, interpretationApprovalId: rule.interpretationApprovalId ?? null, evaluatorApprovalId: rule.evaluatorApprovalId ?? null, sourceUri: pack.sourceUri } });
  }
  const counts = { total: results.length, pass: 0, fail: 0, unknown: 0, not_applicable: 0 };
  for (const r of results) counts[r.disposition]++;
  return { auditId: input.auditId, findingId: input.findingId, policyPack: pack.id, policyVersion: pack.policyVersion, asOf, knowledgeAsOf, coverage: null, counts, results, humanReviewRequired: true, source: "mysql-database-pinned-reviewed-policy", sourceIds: [...new Set(results.flatMap(r => [r.provenance.snapshotId, r.provenance.provisionId, ...r.evidenceIds].filter((id): id is string => !!id)))] };
}
/** Legacy string signature accepted only when explicit auditId is supplied. No silent audit lookup. */
export async function evaluateControlledPolicy(input: ScopedPolicyInput | string, asOf?: string, auditId?: string, deps?: PolicyRuntimeDependencies) {
  return evaluatePolicyScoped(typeof input === "string" ? { auditId: auditId ?? "", findingId: input, asOf } : input, deps);
}
export async function getControlledPolicyCoverage(auditId: string, asOf?: string, knowledgeAsOf?: string, deps: PolicyRuntimeDependencies = runtimeDependencies()) {
  required(auditId, "auditId");
  const [audit, findings, pack] = await Promise.all([deps.audit(auditId), deps.findings(auditId), getControlledPolicyPack(auditId, deps)]);
  if (!audit) throw new Error("Audit not available");
  const evaluations = await Promise.all(findings.map(f => { required(typeof f.id === "string" ? f.id : undefined, "Persisted finding ID"); return evaluatePolicyScoped({ auditId, findingId: f.id as string, asOf, knowledgeAsOf }, deps); }));
  return { auditId, audit, evaluation: evaluations.length === 1 ? evaluations[0] : null, evaluations, source: "mysql-database-pinned-reviewed-policy", complianceCoverage: null, uncoveredRules: pack.rules.filter(r => !evaluations.length || evaluations.some(e => e.results.some(result => result.rule.id === r.id && result.disposition !== "pass" && result.disposition !== "not_applicable"))).map(r => ({ id: r.id, citation: r.citation, title: r.title, requiredEvidence: r.requiredEvidence, humanGate: r.humanGate })), emptyState: findings.length === 0, humanReviewRequired: true };
}
/** Adapter for configuration governance validatePayload; definition tests are mandatory. */
export function createPolicyConfigurationValidator(deps: PolicyRuntimeDependencies = runtimeDependencies()) {
  return async (version: { kind: string; payload: unknown }, acceptanceEvidenceIds: string[]) => {
    if (version.kind !== "policy") throw new Error(`No policy payload validator applies to configuration kind ${version.kind}`);
    if (!Array.isArray(acceptanceEvidenceIds) || acceptanceEvidenceIds.length === 0) throw new Error("Policy activation requires retained definition/test acceptance evidence");
    await requireReviewedPolicyPack(version.payload as GovernedPolicyPack, deps, deps.now());
  };
}
export async function buildControlledPolicyGraph(auditId?: string, deps: PolicyRuntimeDependencies = runtimeDependencies()) {
  const pack = await getControlledPolicyPack(auditId, deps);
  const nodes = pack.rules.flatMap(rule => [{ id: rule.id, type: "policy_rule", label: rule.title, evaluator: rule.evaluator, version: rule.version }, ...(rule.source ? [{ id: rule.source.provisionId, type: "source_provision", label: rule.citation, evaluator: "", version: rule.source.snapshotId }] : [])]);
  const edges = pack.rules.filter(r => r.source).map(r => ({ from: r.source!.provisionId, to: r.id, type: "reviewed_mapping", interpretationApprovalId: r.interpretationApprovalId ?? null, evaluatorApprovalId: r.evaluatorApprovalId ?? null }));
  return { auditId, document: pack, nodes, edges, source: "mysql-database-controlled-configuration", graphModel: "Configuration mapping projection; not a finding knowledge-graph traversal or executed agent" };
}
export async function compileControlledDocumentToPolicy(documentId: string, deps: PolicyRuntimeDependencies = runtimeDependencies()) {
  required(documentId, "Persisted source snapshot documentId");
  const snapshot = await deps.snapshot(documentId);
  const xml = snapshot.originals.find(o => o.kind === "full-xml");
  if (!xml) throw new Error("Actual source XML original unavailable; PDF guidance requires a reviewed extraction adapter");
  const original = await deps.original(snapshot.id, xml.id);
  if (sha256(original) !== xml.sha256) throw new Error("Original document digest mismatch");
  const candidateRules: ObligationCandidate[] = snapshot.provisions.filter(p => p.anchorStatus !== "unresolved" && ["paragraph", "criterion", "section"].includes(p.kind) && !!p.text.trim()).flatMap(p => {
    // Section/criterion containers with paragraph children are skipped to avoid duplicate candidates.
    if (p.kind !== "paragraph" && snapshot.provisions.some(child => child.parentId === p.id && child.kind === "paragraph")) return [];
    const modality = p.text.match(/\b(shall|must|may)\b/i)?.[1]?.toLowerCase() as ObligationCandidate["modality"] | undefined;
    if (!modality) return [];
    return [{ id: `${snapshot.id}:${p.id}:candidate:${sha256(p.text).slice(0, 16)}`, source: { snapshotId: snapshot.id, provisionId: p.id, textSha256: sha256(p.text) }, originalId: xml.id, citation: p.citation, exactText: p.text, modality, status: "candidate-human-review-required" as const, evaluator: null, disposition: "unknown" as const, interpretationApprovalId: null }];
  });
  return { documentId: snapshot.id, mode: "original-document-modality-extraction", provider: "deterministic actual-source parser; LLM not invoked", candidateRules, sourceProvenance: { sourceId: snapshot.sourceId, snapshotId: snapshot.id, sourceAsOf: snapshot.sourceAsOf, retrievedAt: snapshot.retrievedAt, originalId: xml.id, originalSha256: xml.sha256 }, warning: "Candidates are verbatim source segments, not executable rules or a compliance conclusion. Unresolved paragraph anchors require validation; qualified interpretation and evaluator test review are mandatory before human-only activation." };
}

let pool: Pool | null = null;
function db() { if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; policy operational fallback disabled"); return pool ??= createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 }); }
/** Strict scoped database reads; no ensure/create/seed/migration call. */
export async function listPolicyDomainRecords<T extends Record<string, unknown>>(type: string, auditId: string): Promise<T[]> {
  required(auditId, "auditId"); const [rows] = await db().query<any[]>("SELECT record_id,audit_id,payload FROM part21_domain_records WHERE record_type=? AND audit_id=? ORDER BY record_id", [type, auditId]);
  return rows.map(r => ({ ...(typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload), id: r.record_id, auditId: r.audit_id }) as T);
}
export async function getDomainRecordScoped<T extends Record<string, unknown>>(type: string, id: string, auditId: string): Promise<T | null> {
  required(auditId, "auditId"); required(id, "recordId");
  const [rows] = await db().query<any[]>("SELECT record_id,audit_id,payload FROM part21_domain_records WHERE record_type=? AND record_id=? AND audit_id=?", [type, id, auditId]);
  return rows.length === 1 ? { ...(typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload), id: rows[0].record_id, auditId: rows[0].audit_id } as T : null;
}
async function getExactAuditRecord<T extends Record<string, unknown>>(auditId: string): Promise<T | null> {
  required(auditId, "auditId");
  const [rows] = await db().query<any[]>("SELECT record_id,audit_id,payload FROM part21_domain_records WHERE record_type='audit' AND record_id=? AND (audit_id=? OR audit_id IS NULL)", [auditId, auditId]);
  if (rows.length !== 1) return null;
  const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
  if (payload.auditId && payload.auditId !== auditId) return null;
  return { ...payload, id: rows[0].record_id, auditId } as T;
}
export function runtimeDependencies(): PolicyRuntimeDependencies {
  return {
    finding: async (auditId, id) => { const row = await getDomainRecordScoped<Record<string, unknown>>("finding", id, auditId); return row && (!row.auditId || row.auditId === auditId) ? row : null; }, findings: auditId => listPolicyDomainRecords("finding", auditId),
    audit: getExactAuditRecord,
    evidence: async (auditId, findingId) => {
      const rows = await listPolicyDomainRecords<Record<string, unknown>>("evidence", auditId);
      // Legacy prose/upload metadata is not silently converted to typed evidence.
      return rows.filter(r => typeof r.id === "string" && typeof r.evidenceType === "string" && Array.isArray(r.findingIds) && r.findingIds.includes(findingId) && typeof r.validFrom === "string" && (r.validTo === null || typeof r.validTo === "string") && typeof r.recordedAt === "string" && typeof r.facts === "object" && r.facts !== null) as unknown as TypedEvidenceReference[];
    },
    applicability: async (auditId, findingId) => (await listPolicyDomainRecords<Record<string, unknown>>("policy_applicability", auditId)).filter(r => r.findingId === findingId) as unknown as PolicyApplicabilityRecord[],
    baseline: getAuditPolicyBaseline, snapshot: getRegulatorySnapshot,
    original: async (snapshotId, originalId) => (await retrieveRegulatoryOriginal(snapshotId, originalId)).bytes,
    review: async (id) => { const [rows] = await db().query<any[]>("SELECT record_id,payload FROM part21_domain_records WHERE record_type='policy_review' AND record_id=?", [id]); return rows.length === 1 ? { ...(typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload), id: rows[0].record_id } as PolicyReviewRecord : null; },
    now: () => new Date().toISOString(),
  };
}
