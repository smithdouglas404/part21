import { listDomainRecords } from "./domain-store";

export type ApprovalRule = {
  id: string;
  decisionType: "audit_report_finalization" | "finding_severity" | "evidence_sufficiency";
  label: string;
  allowedRoleIds: string[];
  prohibitedRoleIds: string[];
  separationOfDutiesRequired: boolean;
  active: boolean;
};

export async function listApprovalRules(decisionType?: ApprovalRule["decisionType"]) {
  const rules = await listDomainRecords<ApprovalRule>("approval_rule");
  return decisionType ? rules.filter((rule) => rule.decisionType === decisionType && rule.active) : rules.filter((rule) => rule.active);
}

export async function requireApprovalRule(decisionType: ApprovalRule["decisionType"]) {
  const rule = (await listApprovalRules(decisionType))[0];
  if (!rule) throw new Error(`No active database approval rule exists for ${decisionType}.`);
  return rule;
}
