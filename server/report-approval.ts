import { appendAssuranceEvent } from "./event-store";
import { getControlledConfiguration, listControlledConfigurationPayloads } from "./config-store";
import { getDomainRecord, listDomainRecords, upsertDomainRecord } from "./domain-store";
import { finalizeAuditReport } from "./agentkit";
import { requireApprovalRule } from "./approval-rules";

type ApprovalTask = {
  approvalId: string;
  recordType: "report_approval_task";
  auditId: string;
  status: "pending" | "approved" | "declined";
  routedAt: string;
  routedBy: string;
  target: { personId: string; personName: string; personEmail: string; personaId: string; role: string; title: string; humanGate: string; focus: string[] };
  report: { reportType: "audit-readiness"; requested: boolean };
  decision?: { actor: string; note: string; decidedAt: string; reportId: string; snapshotHash: string; graphSnapshot: unknown };
};

async function resolvePersona(personaId: string) {
  const personas = await listControlledConfigurationPayloads<any>("persona");
  const match = personas.map((item) => item.payload).find((persona) => persona.id === personaId);
  if (!match) throw new Error(`Persona ${personaId} is not present in controlled configuration.`);
  return match;
}

export async function routeFinalReportApproval(auditId: string, personaId: string, routedBy: string, note = "Final report requires qualified human disposition.", person?: { id: string; name: string; email: string }) {
  if (!auditId) throw new Error("auditId is required.");
  const persona = await resolvePersona(personaId);
  const rule = await requireApprovalRule("audit_report_finalization");
  if (!rule.allowedRoleIds.includes(personaId)) throw new Error(`${persona.title} is not authorized to approve a final Part 21 report. Authorized roles: ${rule.allowedRoleIds.join(", ")}.`);
  const approvalId = `approval-${auditId.toLowerCase()}-${personaId}`;
  const existing = await getDomainRecord<ApprovalTask>("report_approval_task", approvalId);
  if (existing?.status === "approved") return { ok: true, reused: true, task: existing };
  if (!person?.id || !person.name) throw new Error("A named approver from the database people directory is required.");
  const task: ApprovalTask = {
    approvalId,
    recordType: "report_approval_task",
    auditId,
    status: "pending",
    routedAt: new Date().toISOString(),
    routedBy,
    target: {
      personId: person.id,
      personName: person.name,
      personEmail: person.email,
      personaId: persona.id,
      role: persona.title,
      title: persona.label,
      humanGate: persona.alertRule,
      focus: persona.focus,
    },
    report: { reportType: "audit-readiness", requested: true },
  };
  await upsertDomainRecord({ recordType: "report_approval_task", recordId: approvalId, auditId, payload: { ...task, note, authorization: { ruleId: rule.id, allowedRoleIds: rule.allowedRoleIds, separationOfDutiesRequired: rule.separationOfDutiesRequired } } });
  const event = await appendAssuranceEvent({ type: "audit_report_routed_for_approval", actor: routedBy, auditId, entityId: approvalId, payload: { approvalId, personaId, role: persona.title, personId: person.id, personName: person.name, note, humanGate: persona.alertRule, authorizationRuleId: rule.id } });
  return { ok: true, task, event };
}

export async function listReportApprovalTasks(auditId?: string) {
  return { tasks: await listDomainRecords<ApprovalTask>("report_approval_task", auditId), source: "mysql-domain-records" };
}

export async function approveRoutedFinalReport(approvalId: string, actor: string, note: string) {
  if (!actor.trim()) throw new Error("An approving actor is required.");
  if (!note.trim()) throw new Error("An approval note is required.");
  const task = await getDomainRecord<ApprovalTask>("report_approval_task", approvalId);
  if (!task) throw new Error(`Approval task ${approvalId} was not found in the database.`);
  if (task.status !== "pending") throw new Error(`Approval task ${approvalId} is already ${task.status}.`);
  if (actor.trim().toLowerCase() === task.routedBy.trim().toLowerCase() || actor.trim().toLowerCase() === task.target.personName.trim().toLowerCase()) throw new Error("Separation-of-duties violation: the auditor who routed the report cannot approve their own work.");
  const qualified = await getControlledConfiguration<any>("persona", task.target.personaId);
  if (!qualified.payload) throw new Error("The routed persona is no longer available in controlled configuration.");
  const finalization = await finalizeAuditReport(task.auditId, actor, note, true);
  const decidedAt = new Date().toISOString();
  const completed: ApprovalTask = { ...task, status: "approved", decision: { actor, note, decidedAt, reportId: finalization.reportId, snapshotHash: finalization.snapshotHash, graphSnapshot: finalization.graphSnapshot } };
  await upsertDomainRecord({ recordType: "report_approval_task", recordId: approvalId, auditId: task.auditId, payload: completed });
  const event = await appendAssuranceEvent({ type: "audit_report_approval_completed", actor, auditId: task.auditId, entityId: approvalId, payload: { approvalId, reportId: finalization.reportId, snapshotHash: finalization.snapshotHash, graphSnapshot: finalization.graphSnapshot, humanGate: task.target.role, note, databaseRecord: true } });
  return {
    ok: true,
    approval: completed,
    finalization,
    event,
    lifecycle: {
      reportStatus: "approved",
      hashStatus: "sha256_recorded",
      repositoryStatus: "stored_in_mysql_domain_repository",
      graphStatus: "approved_snapshot_promoted",
      completionStatus: "completed",
      separationOfDuties: { routedBy: task.routedBy, approvedBy: actor, assignedPerson: task.target.personName, enforced: true },
    },
  };
}
