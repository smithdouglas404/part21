import { audits, controls, evidence, findings, metrics, sources } from "../shared/demo";
import { auditPhases, auditSkills, agentKitAgents, getSkillForPhase } from "../shared/skills";

export function getAgentKitManifest() {
  return {
    protocol: "agentkit-demo",
    version: "0.1.0",
    executionContract: "ECC = Evidence, Context, Checkpoint",
    agents: agentKitAgents,
    skills: auditSkills.map(({ questions, ...skill }) => ({ ...skill, questionCount: questions.length })),
    phases: auditPhases,
  };
}

export function runAuditSkill(skillId: string, answers: Record<string, unknown> = {}) {
  const skill = auditSkills.find((item) => item.id === skillId) ?? auditSkills[0];
  const answered = skill.questions.filter((question) => answers[question.id] !== undefined && String(answers[question.id]).trim().length > 0).length;
  const required = skill.questions.filter((question) => question.required).length;
  return {
    skillId: skill.id,
    route: skill.route,
    agent: skill.agent,
    status: answered >= required ? "ready_for_human_gate" : "needs_more_context",
    completion: Math.round((answered / skill.questions.length) * 100),
    ecc: { contract: skill.eccContract, evidence: "linked synthetic records", context: skill.purpose, checkpoint: skill.humanGate },
    nextQuestions: skill.questions.filter((question) => question.required && !answers[question.id]).map((question) => question.id),
    recommendation: answered >= required ? skill.completionSignal : `Answer the remaining ${Math.max(required - answered, 0)} required question(s) before routing to the human gate.`,
  };
}

export function buildAuditReadinessReport(auditId = "AUD-026") {
  const audit = audits.find((item) => item.id === auditId) ?? audits[0];
  return {
    reportType: "audit-readiness",
    reportVersion: "0.1-demo",
    generatedAt: new Date().toISOString(),
    dataMode: "synthetic",
    audit,
    executivePosition: "Ready with actions",
    metrics,
    controls,
    findings,
    evidence,
    sources,
    agentRecommendation: "Resolve F-042 evidence chain before accepting CHG-014 into the configuration baseline.",
    humanDecisionsRequired: ["Confirm scope", "Accept evidence sufficiency", "Approve finding severity", "Approve report disposition"],
    traceabilityNote: "This report preserves links to synthetic source records and is not a regulatory determination.",
  };
}

export function reportToCsv(report: ReturnType<typeof buildAuditReadinessReport>) {
  const rows = [
    ["Report type", report.reportType], ["Report version", report.reportVersion], ["Generated at", report.generatedAt], ["Data mode", report.dataMode], ["Audit", report.audit.id], ["Audit title", report.audit.title], ["Executive position", report.executivePosition], ["Readiness", `${report.metrics.readiness}%`], ["Open findings", String(report.metrics.openFindings)], ["Supplier exposure", String(report.metrics.supplierExposure)], ["Agent recommendation", report.agentRecommendation], ["Traceability note", report.traceabilityNote],
    [], ["Finding ID", "Title", "Severity", "Status", "Owner", "Age"], ...report.findings.map((finding) => [finding.id, finding.title, finding.severity, finding.status, finding.owner, finding.age]),
    [], ["Control ID", "Control", "Coverage", "Status", "Signal"], ...report.controls.map((control) => [control.id, control.title, `${control.coverage}%`, control.status, control.signal]),
  ];
  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

export function getSkillPhaseFromId(skillId: string) {
  const skill = auditSkills.find((item) => item.id === skillId);
  return getSkillForPhase(skill?.phase ?? "scope");
}
