export interface AssurancePersona {
  id: string;
  label: string;
  title: string;
  description: string;
  focus: string[];
  primaryQuestions: string[];
  defaultView: "overview" | "audit" | "evidence" | "controls" | "graph";
  alertRule: string;
}

export const assurancePersonas: AssurancePersona[] = [
  { id: "manager", label: "Overall manager", title: "Assurance manager", description: "Portfolio view of readiness, risk, accountable owners, and escalations across the unit.", focus: ["Readiness posture", "Open major findings", "Supplier exposure", "Decision gates"], primaryQuestions: ["What threatens readiness this week?", "Which owner needs an escalation?", "What decision is blocked by evidence?"], defaultView: "overview", alertRule: "Escalate major findings without an accountable owner or due date." },
  { id: "auditor", label: "Lead auditor", title: "Audit lead", description: "Evidence-first workbench for scope, sampling, genealogy, findings, and report drafting.", focus: ["Scope and criteria", "Evidence sufficiency", "Finding rationale", "Report readiness"], primaryQuestions: ["Can I prove this control was met?", "What evidence contradicts the signal?", "Which open edge must be resolved before closure?"], defaultView: "audit", alertRule: "Flag unsupported conclusions and evidence older than the control freshness window." },
  { id: "quality", label: "Quality approver", title: "Quality / compliance approver", description: "Decision and remediation view focused on severity, corrective action, and approval history.", focus: ["Severity consistency", "Corrective actions", "Human approvals", "Recurrence risk"], primaryQuestions: ["Is the severity defensible?", "Is the corrective action measurable?", "Has the same issue recurred?"], defaultView: "controls", alertRule: "Escalate repeated findings and overdue corrective actions." },
  { id: "supplier", label: "Supplier quality", title: "Supplier quality engineer", description: "External data and supplier-change view for heat lots, notifications, certificates, and vendor performance.", focus: ["Vendor ERP records", "Material lots", "Supplier changes", "Certificate joins"], primaryQuestions: ["Can each lot be traced to the delivered item?", "Did the supplier notify within the control window?", "Which vendor record is missing or stale?"], defaultView: "graph", alertRule: "Watch orphaned vendor records, late notifications, and certificate mismatches." },
  { id: "engineering", label: "Configuration engineer", title: "Configuration / design engineer", description: "Change-impact view for baseline, effective revisions, impacted work instructions, and approvals.", focus: ["Change packages", "Effective revisions", "Impact analysis", "Baseline acceptance"], primaryQuestions: ["What changed and when?", "Which downstream documents need revalidation?", "Who approved the current baseline?"], defaultView: "graph", alertRule: "Block baseline acceptance when an approved change has unresolved downstream impacts." },
];
