import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { GovernedPolicyPack, PolicyRule, TypedEvidenceReference } from "../shared/policy";
import type { RegulatorySnapshot } from "../shared/regulatory";
import { configurationDigest } from "./config-governance";
import { evaluatorReviewArtifact, evaluateControlledPolicy, evaluatePolicyScoped, getControlledPolicyCoverage, getControlledPolicyPack, compileControlledDocumentToPolicy, validateGovernedPolicyPack, type PolicyApplicabilityRecord, type PolicyReviewRecord, type PolicyRuntimeDependencies } from "./policy-runtime";

const at = "2026-11-18T12:00:00Z";
const snapshotId = "test-snapshot";
const provisionId = "10-cfr:21.21";
const sourceText = "Synthetic test provision text only.";
const obligation = { id: "test-obligation", version: "test-obligation-v1", source: { snapshotId, provisionId, textSha256: "0".repeat(64) }, interpretation: "Synthetic test interpretation", interpretationApprovalId: "test-interpretation-review", applicabilityBasis: "Test-only applicability basis", evidenceTypes: ["test-evidence"] };
const rule: PolicyRule = { id: "test-rule", citation: "10 CFR 21.21", title: "Synthetic test rule", intent: "Test only", ruleType: "evidence", requiredEvidence: [], evaluator: "typed_evidence_presence_v1", humanGate: "Test human gate", sourceSectionId: "21.21", version: "test-rule-v1", source: { ...obligation.source }, obligationId: obligation.id, interpretationApprovalId: obligation.interpretationApprovalId, evaluatorApprovalId: "test-evaluator-review", evidenceRequirements: [{ evidenceType: "test-evidence", minimum: 1, requireAcceptedReview: true, requireOriginal: true }], parameters: {} };
const evidence: TypedEvidenceReference = { id: "test-evidence-1", auditId: "test-audit", findingIds: ["test-finding"], evidenceType: "test-evidence", validFrom: "2026-11-01T00:00:00Z", validTo: null, recordedAt: "2026-11-02T00:00:00Z", review: { decisionId: "test-evidence-review", reviewerId: "test-reviewer", reviewedAt: "2026-11-03T00:00:00Z", status: "accepted" }, original: { objectId: "test-object", versionId: "test-version", sha256: "a".repeat(64) }, facts: {} };
const applicability: PolicyApplicabilityRecord = { id: "test-applicability", auditId: "test-audit", findingId: "test-finding", ruleIds: [rule.id], outcome: "applicable", basis: "Synthetic test applicability", validFrom: "2026-11-01T00:00:00Z", validTo: null, recordedAt: "2026-11-02T00:00:00Z", approvalId: "test-applicability-review" };
function review(id: string, subjectKind: PolicyReviewRecord["subjectKind"], subjectId: string, subjectVersion: string, artifactSha256: string): PolicyReviewRecord {
  return { id, disposition: "approved", subjectKind, subjectId, subjectVersion, artifactSha256, qualifiedReviewerId: "test-qualified-reviewer", qualificationEvidenceId: "test-qualification", acceptedAt: "2026-11-10T00:00:00Z", acceptanceEvidenceIds: ["test-acceptance"] };
}
function fixtures(overrides: Partial<PolicyRuntimeDependencies> = {}) {
  const snapshot: RegulatorySnapshot = { id: snapshotId, sourceId: "test-source", sourceKind: "ecfr-regulation", regulationSet: "10-cfr-part-21", sourceAsOf: "2026-11-09", latestAmendedOn: null, latestIssueDate: null, providerUpToDateAsOf: "2026-11-09", retrievedAt: at, importInProgress: false, originals: [{ id: "test-original", kind: "full-xml", requestedUri: "https://www.ecfr.gov/test", finalUri: "https://www.ecfr.gov/test", contentType: "application/xml", sha256: "b".repeat(64), sizeBytes: 1, retrievedAt: at, storage: { provider: "test", objectId: "test-original", versionId: "test-original", integrityVerified: true } }], provisions: [{ id: provisionId, snapshotId, parentId: "10-cfr:part-21", kind: "section", citation: "10 CFR 21.21", heading: "Synthetic test heading", text: sourceText, originalId: "test-original", xmlLocator: "test", anchorStatus: "structural" }, { id: `${provisionId}(a)`, snapshotId, parentId: provisionId, kind: "paragraph", citation: "10 CFR 21.21(a)", heading: "(a)", text: "The test entity shall retain synthetic test evidence.", originalId: "test-original", xmlLocator: "test", anchorStatus: "validated-numbering" }], parserVersion: "test", status: "ingested-human-review-required", legalStatus: "unofficial-ecfr-compilation", license: { status: "government-regulatory-text", approvalId: null, basis: "test" }, warnings: [] };
  obligation.source.textSha256 = createHash("sha256").update(sourceText).digest("hex");
  rule.source = { ...obligation.source };
  const pack: GovernedPolicyPack = { id: "test-policy", policyVersion: "test-v1", sourceDocument: "10 CFR Part 21", sourceUri: "https://www.ecfr.gov/current/title-10/chapter-I/part-21", sourceAuthority: "U.S. NRC / eCFR", semanticModel: "test", snapshotIds: [snapshotId], obligations: [obligation], rules: [rule] };
  const reviews = new Map<string, PolicyReviewRecord>([
    ["test-interpretation-review", review("test-interpretation-review", "obligation", obligation.id, obligation.version, configurationDigest({ ...obligation, interpretationApprovalId: null }))],
    ["test-evaluator-review", review("test-evaluator-review", "evaluator", rule.id, rule.version, configurationDigest(evaluatorReviewArtifact(rule)))],
    ["test-applicability-review", review("test-applicability-review", "applicability", applicability.id, "1", configurationDigest({ ...applicability, approvalId: null }))],
    ["test-evidence-review", review("test-evidence-review", "evidence", evidence.id, "1", configurationDigest({ id: evidence.id, auditId: evidence.auditId, evidenceType: evidence.evidenceType, original: evidence.original, facts: evidence.facts, validFrom: evidence.validFrom, validTo: evidence.validTo, recordedAt: evidence.recordedAt }))],
  ]);
  const baseline = { pin: { configId: pack.id, version: pack.policyVersion, sourceSha256: configurationDigest(pack), approvalId: "test-activation-review" }, configuration: { payload: pack, sourceSha256: configurationDigest(pack), version: pack.policyVersion } };
  const deps: PolicyRuntimeDependencies = {
    finding: async (auditId, id) => auditId === "test-audit" && id === "test-finding" ? { id, auditId } : null,
    findings: async auditId => auditId === "test-audit" ? [{ id: "test-finding", auditId }] : [],
    audit: async id => id === "test-audit" ? { id } : null,
    evidence: async () => [structuredClone(evidence)], applicability: async () => [structuredClone(applicability)],
    baseline: async () => structuredClone(baseline), snapshot: async () => structuredClone(snapshot),
    original: async () => Buffer.from("<test/>"), review: async id => structuredClone(reviews.get(id) ?? null), now: () => at, ...overrides,
  };
  return { deps, pack, snapshot, baseline, reviews };
}
describe("scoped reviewed policy runtime (mock only)", () => {
  it("validates exact source citation, obligation digest, registered evaluator and persisted reviews", async () => {
    const { deps, pack } = fixtures(); expect((await validateGovernedPolicyPack(pack, deps)).valid).toBe(true);
    const badCitation = structuredClone(pack); badCitation.rules[0].citation = "10 CFR 21.51"; expect((await validateGovernedPolicyPack(badCitation, deps)).issues[0].reasons.join(" ")).toContain("citation");
    const badEvaluator = structuredClone(pack); badEvaluator.rules[0].evaluator = "not_registered"; expect((await validateGovernedPolicyPack(badEvaluator, deps)).issues[0].reasons.join(" ")).toContain("executable evaluator");
    const badText = structuredClone(pack); badText.rules[0].source!.textSha256 = "c".repeat(64); expect((await validateGovernedPolicyPack(badText, deps)).issues[0].reasons.join(" ")).toContain("digest");
    const unreviewed = structuredClone(pack); unreviewed.rules[0].interpretationApprovalId = "test-missing"; expect((await validateGovernedPolicyPack(unreviewed, deps)).issues[0].reasons.join(" ")).toContain("interpretation");
  });
  it("requires an explicit audit pin and exact immutable pack digest", async () => {
    const { deps, pack, baseline } = fixtures();
    await expect(getControlledPolicyPack(undefined, deps)).rejects.toThrow("auditId");
    expect((await getControlledPolicyPack("test-audit", deps)).id).toBe(pack.id);
    const broken = structuredClone(baseline); broken.configuration.sourceSha256 = "d".repeat(64);
    await expect(getControlledPolicyPack("test-audit", { ...deps, baseline: async () => broken })).rejects.toThrow("mismatch");
  });
  it("executes the actual registered evaluator only in the explicit audit/finding scope", async () => {
    const { deps } = fixtures(); const result = await evaluatePolicyScoped({ auditId: "test-audit", findingId: "test-finding", asOf: at, knowledgeAsOf: at }, deps);
    expect(result.results[0]).toMatchObject({ disposition: "pass", evidenceIds: ["test-evidence-1"], applicabilityDecisionId: "test-applicability" }); expect(result.coverage).toBeNull(); expect(result.counts.pass).toBe(1);
    await expect(evaluatePolicyScoped({ auditId: "test-audit", findingId: "test-other-finding", asOf: at, knowledgeAsOf: at }, deps)).rejects.toThrow("explicit audit scope");
    await expect(evaluateControlledPolicy("test-finding", at, undefined, deps)).rejects.toThrow("auditId");
  });
  it("does not trust payload-only accepted evidence review", async () => {
    const { deps, reviews } = fixtures(); reviews.delete("test-evidence-review");
    const result = await evaluatePolicyScoped({ auditId: "test-audit", findingId: "test-finding", asOf: at, knowledgeAsOf: at }, deps);
    expect(result.results[0].disposition).toBe("unknown"); expect(result.results[0].missingEvidenceTypes).toEqual(["test-evidence"]);
  });
  it("unknown applicability/interpretation produces unknown, never pseudo coverage", async () => {
    const { deps } = fixtures({ applicability: async () => [] }); const result = await evaluatePolicyScoped({ auditId: "test-audit", findingId: "test-finding", asOf: at, knowledgeAsOf: at }, deps);
    expect(result.results[0].disposition).toBe("unknown"); expect(result.coverage).toBeNull();
  });
  it("returns explicit empty state for an audit with no findings", async () => {
    const { deps } = fixtures({ findings: async () => [] }); const coverage = await getControlledPolicyCoverage("test-audit", at, at, deps);
    expect(coverage.emptyState).toBe(true); expect(coverage.evaluation).toBeNull(); expect(coverage.evaluations).toEqual([]);
  });
  it("extracts candidates only from actual stored original bytes and keeps evaluator unset", async () => {
    const { deps, snapshot } = fixtures(); const xml = Buffer.from("<DIV5><HEAD>Test</HEAD><DIV8 N=\"21.21\"><HEAD>Test</HEAD><P>(a) The entity shall test.</P></DIV8></DIV5>");
    snapshot.originals[0].sha256 = createHash("sha256").update(xml).digest("hex"); snapshot.originals[0].sizeBytes = xml.length;
    const result = await compileControlledDocumentToPolicy(snapshotId, { ...deps, original: async () => xml });
    expect(result.candidateRules).toHaveLength(1); expect(result.candidateRules[0]).toMatchObject({ exactText: "The test entity shall retain synthetic test evidence.", modality: "shall", evaluator: null, disposition: "unknown", status: "candidate-human-review-required" });
    expect(result.sourceProvenance.originalSha256).toBe(snapshot.originals[0].sha256);
    await expect(compileControlledDocumentToPolicy(snapshotId, { ...deps, original: async () => Buffer.from("changed") })).rejects.toThrow("digest");
  });
});
describe("scoped database read helpers (mocked mysql2, no database)", () => {
  beforeEach(() => { vi.resetModules(); process.env.DATABASE_URL = "mysql://test-only.invalid/test"; });
  it("always includes audit_id in finding/evidence queries and refuses missing audit", async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[] = []) => [[{ record_id: "test-finding", audit_id: "test-audit", payload: { id: "test-finding", auditId: "test-audit" } }], []]);
    vi.doMock("mysql2/promise", () => ({ createPool: vi.fn(() => ({ query })) }));
    const runtime = await import("./policy-runtime");
    await expect(runtime.getDomainRecordScoped("finding", "test-finding", "test-audit")).resolves.toMatchObject({ id: "test-finding", auditId: "test-audit" });
    expect(query.mock.calls[0][0]).toContain("audit_id=?");
    await expect(runtime.getDomainRecordScoped("finding", "test-finding", "")).rejects.toThrow("auditId");
    await expect(runtime.listPolicyDomainRecords("evidence", "")).rejects.toThrow("auditId");
  });
});
