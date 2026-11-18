import type { EvaluatorResult, PolicyEvaluationContext, PolicyRule, TypedEvidenceReference } from "../shared/policy";
import { assertInstant } from "./regulatory-source";

export type DeterministicEvaluator = (rule: PolicyRule, context: PolicyEvaluationContext, evidence: TypedEvidenceReference[]) => EvaluatorResult;
function result(context: PolicyEvaluationContext, disposition: EvaluatorResult["disposition"], evidence: TypedEvidenceReference[], reasons: string[], basis: string): EvaluatorResult {
  return { disposition, evidenceIds: evidence.map(e => e.id), missingEvidenceTypes: [], reasons, basis, applicabilityDecisionId: context.applicability.decisionId };
}
function strings(value: unknown): string[] | null { return Array.isArray(value) && value.length > 0 && value.every(v => typeof v === "string" && !!v.trim()) ? value : null; }
function date(value: unknown): number | null {
  if (typeof value !== "string") return null;
  try { return Date.parse(assertInstant(value, "evidence event clock")); } catch { return null; }
}
function factEvidence(evidence: TypedEvidenceReference[], type: string) { return evidence.filter(e => e.evidenceType === type); }
const presence: DeterministicEvaluator = (_rule, context, evidence) => result(context, "pass", evidence, ["All mandatory typed evidence references satisfied; this is a completeness test, not a legal determination."], "Reviewed evidence contract");
const identity: DeterministicEvaluator = (rule, context, evidence) => {
  const identityTypes = strings(rule.parameters?.identityEvidenceTypes);
  const fields = strings(rule.parameters?.identityFields);
  if (!identityTypes || !fields) return result(context, "unknown", evidence, ["Reviewed identityEvidenceTypes and identityFields are required"], "No inferred heat/lot or item identity");
  const identities = evidence.filter(e => identityTypes.includes(e.evidenceType));
  if (identityTypes.some(type => !identities.some(e => e.evidenceType === type))) return result(context, "unknown", identities, ["Required identity record type missing"], "Exact typed item identity comparison");
  const missing = identities.some(e => fields.some(field => typeof e.facts[field] !== "string" || !(e.facts[field] as string).trim()));
  if (missing) return result(context, "unknown", identities, ["An exact identity field is missing; no text/title resemblance inference was used"], "Exact typed item identity comparison");
  const mismatches = fields.filter(field => new Set(identities.map(e => e.facts[field])).size > 1);
  return result(context, mismatches.length ? "fail" : "pass", identities, mismatches.length ? [`Identity mismatch in fields: ${mismatches.join(", ")}`] : ["All required exact item identity fields match"], "Appendix B Criterion VIII identity check; separate Part21 applicability required");
};
const flowdown: DeterministicEvaluator = (rule, context, evidence) => {
  const requirements = strings(rule.parameters?.requiredFlowdownIds);
  const procurementType = rule.parameters?.procurementEvidenceType;
  const populationType = rule.parameters?.populationEvidenceType;
  if (!requirements || typeof procurementType !== "string" || typeof populationType !== "string") return result(context, "unknown", evidence, ["Reviewed flowdown requirement IDs, procurement type and population type missing"], "Procurement contract rule configuration missing");
  const population = factEvidence(evidence, populationType);
  const procurement = factEvidence(evidence, procurementType);
  const purchaserItems = population.flatMap(e => strings(e.facts.itemIds) ?? []);
  if (!purchaserItems.length || population.some(e => !strings(e.facts.itemIds))) return result(context, "unknown", population, ["Affected item population not established"], "No inferred procurement population");
  if (!procurement.length || procurement.some(e => typeof e.facts.itemId !== "string" || !Array.isArray(e.facts.flowdownIds))) return result(context, "unknown", procurement, ["Structured procurement item and clause references missing"], "Exact controlled procurement reference check");
  const missingItems = purchaserItems.filter(id => !procurement.some(e => e.facts.itemId === id));
  if (missingItems.length) return result(context, "unknown", [...population, ...procurement], [`Procurement records missing for item IDs: ${missingItems.join(", ")}`], "All affected items must be represented");
  const failures = procurement.filter(e => purchaserItems.includes(String(e.facts.itemId))).flatMap(e => requirements.filter(id => !(e.facts.flowdownIds as unknown[]).includes(id)).map(id => `${e.id}:${id}`));
  return result(context, failures.length ? "fail" : "pass", [...population, ...procurement], failures.length ? [`Required reviewed flowdown clauses absent: ${failures.join(", ")}`] : ["All affected item procurement records reference every required reviewed clause ID"], "Part21 §21.31 and Appendix B IV are distinct controlled obligations, not interchangeable");
};
const records: DeterministicEvaluator = (rule, context, evidence) => {
  const type = rule.parameters?.recordEvidenceType;
  const requiredFields = strings(rule.parameters?.requiredRecordFields);
  if (typeof type !== "string" || !requiredFields) return result(context, "unknown", evidence, ["Reviewed records class and completeness fields required"], "Record-specific retention requirements must be configured");
  const rows = factEvidence(evidence, type);
  if (!rows.length) return result(context, "unknown", rows, ["Required retained record metadata missing"], "Records completeness/retrieval check");
  const incomplete = rows.some(e => requiredFields.some(field => e.facts[field] === undefined || e.facts[field] === null || e.facts[field] === ""));
  if (incomplete || rows.some(e => date(e.facts.requiredRetainUntil) === null || date(e.facts.actualRetainUntil) === null || typeof e.facts.retrievalSucceeded !== "boolean" || !e.facts.retrievalEvidenceId || !e.facts.retentionPolicyVersion || !e.facts.retentionApprovalId)) return result(context, "unknown", rows, ["Record-specific reviewed retention clock, retrieval evidence or required metadata missing"], "No universal invented 10-year retention rule");
  const failed = rows.filter(e => e.facts.retrievalSucceeded !== true || date(e.facts.actualRetainUntil)! < date(e.facts.requiredRetainUntil)! || e.facts.digestVerified !== true || e.facts.identityVerified !== true);
  return result(context, failed.length ? "fail" : "pass", rows, failed.length ? [`Records failed retrieval/retention/integrity/identity checks: ${failed.map(e => e.id).join(", ")}`] : ["Required records meet their reviewed record-specific retention and documented retrieval checks"], "Part21 §21.51 records and Appendix B XVII QA records must retain separate source/trigger mappings; storage is not certification");
};
const timeliness: DeterministicEvaluator = (rule, context, evidence) => {
  const type = rule.parameters?.clockEvidenceType, trigger = rule.parameters?.triggerFact, completed = rule.parameters?.completionFact;
  if (typeof type !== "string" || typeof trigger !== "string" || typeof completed !== "string") return result(context, "unknown", evidence, ["Reviewed clock evidence type and exact trigger/completion fields required"], "No audit-start or serial deadline assumption");
  const rows = factEvidence(evidence, type);
  if (rows.length !== 1) return result(context, "unknown", rows, ["A unique rule-specific clock record is required; no first clock record selected"], "Independent event-triggered clock");
  const record = rows[0], facts = record.facts;
  const triggerAt = date(facts[trigger]), dueAt = date(facts.dueAt), completedAt = facts[completed] === null || facts[completed] === undefined ? null : date(facts[completed]);
  if (triggerAt === null || dueAt === null || !facts.clockPolicyId || !facts.clockPolicyVersion || !facts.clockApprovalId || !facts.calendarVersion || !facts.dueDateBasis || dueAt < triggerAt) return result(context, "unknown", rows, ["Validated event trigger and qualified calendar/time interpretation missing"], "Five working days cannot be substituted with 120 hours; due date must come from reviewed clock calculation");
  if (triggerAt > Date.parse(context.asOf) || completedAt !== null && completedAt < triggerAt || facts[completed] && completedAt === null) return result(context, "unknown", rows, ["Clock dates are inconsistent or trigger is after the requested asOf"], String(facts.dueDateBasis));
  if (completedAt !== null && completedAt <= Date.parse(context.asOf)) return result(context, completedAt <= dueAt ? "pass" : "fail", rows, [completedAt <= dueAt ? "Actual completion was within the reviewed outer limit; as soon as practicable remains a separate review" : "Actual completion was after the reviewed due date"], String(facts.dueDateBasis));
  return result(context, Date.parse(context.asOf) > dueAt ? "fail" : "unknown", rows, [Date.parse(context.asOf) > dueAt ? "Due date exceeded without completion evidence as of this evaluation" : "Completion is not established; the outer limit has not yet expired"], String(facts.dueDateBasis));
};
export const policyEvaluatorRegistry: ReadonlyMap<string, DeterministicEvaluator> = new Map([
  ["typed_evidence_presence_v1", presence], ["item_identity_match_v1", identity],
  ["procurement_flowdown_v1", flowdown], ["records_retention_retrieval_v1", records],
  ["reviewed_event_timeliness_v1", timeliness],
]);
export function visibleEvidence(context: PolicyEvaluationContext) {
  const at = Date.parse(assertInstant(context.asOf, "asOf")), known = Date.parse(assertInstant(context.knowledgeAsOf, "knowledgeAsOf"));
  return context.evidence.filter(e => {
    if (e.auditId !== context.auditId || !e.findingIds?.includes(context.findingId)) return false;
    const valid = date(e.validFrom), recorded = date(e.recordedAt), end = e.validTo === null ? null : date(e.validTo);
    return valid !== null && recorded !== null && valid <= at && recorded <= known && (e.validTo === null || end !== null && at < end);
  });
}
export function dispatchPolicyEvaluator(rule: PolicyRule, context: PolicyEvaluationContext): EvaluatorResult {
  assertInstant(context.asOf, "asOf"); assertInstant(context.knowledgeAsOf, "knowledgeAsOf");
  if (!rule.interpretationApprovalId || !rule.evaluatorApprovalId || !rule.source || !rule.obligationId) return result(context, "unknown", [], ["Reviewed interpretation, evaluator approval and exact source mapping are required"], "Unreviewed rule candidate");
  if (!context.applicability.ruleIds.includes(rule.id) || !context.applicability.decisionId || !context.applicability.basis?.trim() || context.applicability.outcome === "unknown") return result(context, "unknown", [], ["Rule-specific qualified applicability decision missing"], context.applicability.basis || "Applicability unknown");
  if (context.applicability.outcome === "not_applicable") return result(context, "not_applicable", [], ["Rule excluded by recorded qualified applicability decision"], context.applicability.basis);
  const evaluator = policyEvaluatorRegistry.get(rule.evaluator);
  if (!evaluator) return result(context, "unknown", [], [`Evaluator not registered: ${rule.evaluator}`], "No default evaluator or keyword fallback");
  if (!rule.evidenceRequirements?.length || rule.evidenceRequirements.some(r => !r.evidenceType?.trim() || !Number.isInteger(r.minimum) || r.minimum < 1)) return result(context, "unknown", [], ["Required typed evidence contract is missing/invalid"], "Legacy prose evidence hints are not executable requirements");
  const visible = visibleEvidence(context);
  const requirements = rule.evidenceRequirements;
  const referenced = new Set(requirements.map(r => r.evidenceType));
  const accepted = visible.filter(e => referenced.has(e.evidenceType) && requirements.some(requirement => requirement.evidenceType === e.evidenceType && (!requirement.requireAcceptedReview || e.review?.status === "accepted" && !!e.review.decisionId && !!e.review.reviewerId && date(e.review.reviewedAt) !== null && date(e.review.reviewedAt)! <= Date.parse(context.knowledgeAsOf)) && (!requirement.requireOriginal || !!e.original?.objectId && !!e.original.versionId && /^[a-f0-9]{64}$/.test(e.original.sha256))));
  const missing = requirements.filter(requirement => accepted.filter(e => e.evidenceType === requirement.evidenceType).length < requirement.minimum).map(r => r.evidenceType);
  if (missing.length) return { ...result(context, "unknown", accepted, ["Mandatory typed evidence is absent, outside asOf/knowledgeAsOf scope, unreviewed or lacks original reference"], "Every mandatory reference checked independently"), missingEvidenceTypes: [...new Set(missing)] };
  return evaluator(rule, context, accepted);
}
