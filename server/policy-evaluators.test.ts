import { describe, expect, it } from "vitest";
import type { PolicyEvaluationContext, PolicyRule, TypedEvidenceReference } from "../shared/policy";
import { dispatchPolicyEvaluator, visibleEvidence } from "./policy-evaluators";
const at = "2026-11-18T12:00:00Z";
function evidence(id: string, type: string, facts: Record<string, unknown> = {}): TypedEvidenceReference {
  return { id, auditId: "test-audit-A", findingIds: ["test-finding-A"], evidenceType: type, validFrom: "2026-11-01T00:00:00Z", validTo: null, recordedAt: "2026-11-02T00:00:00Z", review: { decisionId: `test-review-${id}`, reviewerId: "test-qualified-person", status: "accepted", reviewedAt: "2026-11-03T00:00:00Z" }, original: { objectId: `test-object-${id}`, versionId: "test-version", sha256: "a".repeat(64) }, facts };
}
function context(rows: TypedEvidenceReference[]): PolicyEvaluationContext {
  return { auditId: "test-audit-A", findingId: "test-finding-A", asOf: at, knowledgeAsOf: at, evidence: rows, applicability: { outcome: "applicable", basis: "Test-only reviewed scope", decisionId: "test-applicability-decision", ruleIds: ["test-rule"] } };
}
function rule(evaluator: string, types: string[], parameters: Record<string, unknown> = {}): PolicyRule {
  return { id: "test-rule", citation: "Test citation", title: "Test", intent: "Test deterministic behavior only", ruleType: "evidence", requiredEvidence: [], evaluator, humanGate: "Test qualified review", sourceSectionId: "test", version: "1", source: { snapshotId: "test-snapshot", provisionId: "test-provision", textSha256: "a".repeat(64) }, obligationId: "test-obligation", interpretationApprovalId: "test-interpretation", evaluatorApprovalId: "test-evaluator-review", evidenceRequirements: types.map(evidenceType => ({ evidenceType, minimum: 1, requireAcceptedReview: true, requireOriginal: true })), parameters };
}
describe("deterministic policy registry dispatch", () => {
  it("executes exact identity comparison and reports actual mismatch evidence IDs", () => {
    const r = rule("item_identity_match_v1", ["receipt", "certificate"], { identityEvidenceTypes: ["receipt", "certificate"], identityFields: ["itemId", "heatId"] });
    const c = context([evidence("test-r", "receipt", { itemId: "test-item", heatId: "test-heat-1" }), evidence("test-c", "certificate", { itemId: "test-item", heatId: "test-heat-2" })]);
    expect(dispatchPolicyEvaluator(r, c)).toMatchObject({ disposition: "fail", evidenceIds: ["test-r", "test-c"] });
    c.evidence[1].facts.heatId = "test-heat-1"; expect(dispatchPolicyEvaluator(r, c).disposition).toBe("pass");
  });
  it("requires every typed evidence reference; prose/keywords do not count", () => {
    const r = rule("typed_evidence_presence_v1", ["receipt", "certificate"]);
    const c = context([evidence("test-r", "receipt", { prose: "certificate heat lot approved" })]);
    expect(dispatchPolicyEvaluator(r, c)).toMatchObject({ disposition: "unknown", missingEvidenceTypes: ["certificate"] });
  });
  it("missing identity fields are unknown, not fabricated match or fail", () => {
    const r = rule("item_identity_match_v1", ["receipt"], { identityEvidenceTypes: ["receipt"], identityFields: ["heatId"] });
    expect(dispatchPolicyEvaluator(r, context([evidence("test-r", "receipt")])).disposition).toBe("unknown");
  });
  it("filters evidence by both audit/finding, valid interval, transaction time and original/review metadata", () => {
    const rows = [evidence("test-visible", "receipt"), evidence("test-other-audit", "receipt"), evidence("test-future", "receipt"), evidence("test-recorded-later", "receipt"), evidence("test-expired", "receipt"), evidence("test-other-finding", "receipt")];
    rows[1].auditId = "test-audit-B"; rows[2].validFrom = "2026-11-19T00:00:00Z"; rows[3].recordedAt = "2026-11-19T00:00:00Z"; rows[4].validTo = at; rows[5].findingIds = ["test-other-finding"];
    expect(visibleEvidence(context(rows)).map(e => e.id)).toEqual(["test-visible"]);
    rows[0].review = null; expect(dispatchPolicyEvaluator(rule("typed_evidence_presence_v1", ["receipt"]), context(rows)).disposition).toBe("unknown");
  });
  it("unknown evaluator/review/applicability never falls back to stock rule or pseudo-coverage", () => {
    const r = rule("not_registered", ["receipt"]), c = context([evidence("test-r", "receipt")]);
    expect(dispatchPolicyEvaluator(r, c).disposition).toBe("unknown");
    r.evaluator = "typed_evidence_presence_v1"; r.interpretationApprovalId = undefined; expect(dispatchPolicyEvaluator(r, c).disposition).toBe("unknown");
    r.interpretationApprovalId = "test-approval"; c.applicability.decisionId = null; expect(dispatchPolicyEvaluator(r, c).disposition).toBe("unknown");
    c.applicability.decisionId = "test-decision"; c.applicability.outcome = "not_applicable"; expect(dispatchPolicyEvaluator(r, c).disposition).toBe("not_applicable");
  });
  it("checks all affected item procurement flowdowns rather than selecting the first item", () => {
    const r = rule("procurement_flowdown_v1", ["population", "procurement"], { populationEvidenceType: "population", procurementEvidenceType: "procurement", requiredFlowdownIds: ["test-clause-p21", "test-clause-qa"] });
    const rows = [evidence("test-pop", "population", { itemIds: ["test-item-1", "test-item-2"] }), evidence("test-po1", "procurement", { itemId: "test-item-1", flowdownIds: ["test-clause-p21", "test-clause-qa"] })];
    expect(dispatchPolicyEvaluator(r, context(rows)).disposition).toBe("unknown");
    rows.push(evidence("test-po2", "procurement", { itemId: "test-item-2", flowdownIds: ["test-clause-p21"] })); expect(dispatchPolicyEvaluator(r, context(rows)).disposition).toBe("fail");
    rows[2].facts.flowdownIds = ["test-clause-p21", "test-clause-qa"]; expect(dispatchPolicyEvaluator(r, context(rows)).disposition).toBe("pass");
  });
  it("records tests use reviewed record-specific retention and actual retrieval metadata", () => {
    const r = rule("records_retention_retrieval_v1", ["record"], { recordEvidenceType: "record", requiredRecordFields: ["recordClass", "ownerId"] });
    const row = evidence("test-record", "record", { recordClass: "test-evaluation", ownerId: "test-owner", requiredRetainUntil: "2031-11-18T12:00:00Z", actualRetainUntil: "2031-11-18T12:00:00Z", retrievalSucceeded: true, retrievalEvidenceId: "test-retrieval", retentionPolicyVersion: "test-record-policy-v1", retentionApprovalId: "test-retention-approval", digestVerified: true, identityVerified: true });
    expect(dispatchPolicyEvaluator(r, context([row])).disposition).toBe("pass");
    row.facts.actualRetainUntil = "2030-11-18T12:00:00Z"; expect(dispatchPolicyEvaluator(r, context([row])).disposition).toBe("fail");
    delete row.facts.requiredRetainUntil; expect(dispatchPolicyEvaluator(r, context([row])).disposition).toBe("unknown");
  });
  it("timeliness uses a unique real trigger, reviewed due date and same event origin; no new clock at acknowledgement", () => {
    const r = rule("reviewed_event_timeliness_v1", ["clock"], { clockEvidenceType: "clock", triggerFact: "discoveryAt", completionFact: "completedAt" });
    const row = evidence("test-clock", "clock", { discoveryAt: "2026-09-01T12:00:00Z", dueAt: "2026-10-31T12:00:00Z", completedAt: "2026-10-30T12:00:00Z", clockPolicyId: "test-clock-policy", clockPolicyVersion: "1", clockApprovalId: "test-clock-approval", calendarVersion: "test-calendar-v1", dueDateBasis: "Test reviewed independent trigger/due-date calculation" });
    expect(dispatchPolicyEvaluator(r, context([row])).disposition).toBe("pass");
    row.facts.completedAt = "2026-11-01T12:00:00Z"; expect(dispatchPolicyEvaluator(r, context([row])).disposition).toBe("fail");
    row.facts.completedAt = null; expect(dispatchPolicyEvaluator(r, context([row])).disposition).toBe("fail");
    row.facts.dueAt = "2026-11-20T12:00:00Z"; expect(dispatchPolicyEvaluator(r, context([row])).disposition).toBe("unknown");
    expect(dispatchPolicyEvaluator(r, context([row, { ...row, id: "test-competing-clock" }])).disposition).toBe("unknown");
    delete row.facts.calendarVersion; expect(dispatchPolicyEvaluator(r, context([row])).disposition).toBe("unknown");
  });
});
