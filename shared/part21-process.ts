/**
 * Canonical 10 CFR Part 21 process model.
 *
 * Reference data only: official section titles and the structure of the
 * statutory branches. It contains no operational records, no dates and no
 * approval. Qualified nuclear, quality and legal review is required before
 * reliance on any interpretation.
 */

export const PART21_SECTION_TITLES: Readonly<Record<string, string>> = Object.freeze({
  "21.1": "Purpose",
  "21.2": "Scope",
  "21.3": "Definitions",
  "21.4": "Interpretations",
  "21.5": "Communications",
  "21.6": "Posting requirements",
  "21.7": "Exemptions",
  "21.8": "Information collection requirements: OMB approval",
  "21.21": "Notification of failure to comply or existence of a defect and its evaluation",
  "21.31": "Procurement documents",
  "21.41": "Inspections",
  "21.51": "Maintenance and inspection of records",
  "21.61": "Failure to notify",
  "21.62": "Criminal penalties",
});

export function part21SectionTitle(section: string): string {
  const key = String(section ?? "").replace(/^\s*§?\s*/, "").trim();
  return PART21_SECTION_TITLES[key] ?? "Unknown section — verify against the current eCFR";
}

export type Part21BranchId =
  | "evaluation"
  | "interim-report"
  | "officer-notification"
  | "supplier-notification"
  | "nrc-initial"
  | "nrc-written";

export type Part21ClockUnit = "calendar-days" | "working-days";

export type Part21Branch = {
  id: Part21BranchId;
  label: string;
  section: string;
  citation: string;
  citationTitle: string;
  /** Fact that starts this clock. Never the audit start, a chat message, or a stage move. */
  triggerFact: string;
  triggerPath: string;
  duration: { amount: number; unit: Part21ClockUnit };
  obligation: string;
  /** What the regulation does not permit us to assume. */
  cannotAssume: string;
  gateId: string;
  /** Optional branch: only applies when its own trigger fact is recorded. */
  conditional: boolean;
};

export const PART21_BRANCHES: readonly Part21Branch[] = Object.freeze([
  {
    id: "evaluation",
    label: "Evaluate for a substantial safety hazard",
    section: "21.21",
    citation: "10 CFR 21.21(a)",
    citationTitle: part21SectionTitle("21.21"),
    triggerFact: "Documented discovery of a potential defect or failure to comply",
    triggerPath: "discovery.documentedAt",
    duration: { amount: 60, unit: "calendar-days" },
    obligation: "Evaluate as soon as practicable and complete the evaluation within 60 days of discovery.",
    cannotAssume: "The 60 days is not a grace period and is not reset by audit planning, a Kanban move, or an approval click.",
    gateId: "evaluation",
    conditional: false,
  },
  {
    id: "interim-report",
    label: "Issue an interim report if evaluation is incomplete",
    section: "21.21",
    citation: "10 CFR 21.21(a)",
    citationTitle: part21SectionTitle("21.21"),
    triggerFact: "Same documented discovery, when evaluation is not complete at day 60",
    triggerPath: "discovery.documentedAt",
    duration: { amount: 60, unit: "calendar-days" },
    obligation: "Submit a written interim report with the expected completion date within the same 60-day period.",
    cannotAssume: "An interim report does not grant a fresh 60 days; it discloses that evaluation is unfinished.",
    gateId: "interim",
    conditional: true,
  },
  {
    id: "officer-notification",
    label: "Inform the responsible officer",
    section: "21.21",
    citation: "10 CFR 21.21(a)(3)",
    citationTitle: part21SectionTitle("21.21"),
    triggerFact: "Completion of an evaluation that identifies a reportable condition",
    triggerPath: "evaluation.completedAt",
    duration: { amount: 5, unit: "working-days" },
    obligation: "Inform the director or responsible officer as soon as practicable and within five working days.",
    cannotAssume: "Five working days is not 120 hours; the reviewed calendar and timezone determine the due date.",
    gateId: "officer",
    conditional: false,
  },
  {
    id: "supplier-notification",
    label: "Supplier notifies purchaser of evaluation capability",
    section: "21.21",
    citation: "10 CFR 21.21(b)",
    citationTitle: part21SectionTitle("21.21"),
    triggerFact: "Supplier determines it is not capable of evaluating a defect",
    triggerPath: "supplier.determinedAt",
    duration: { amount: 5, unit: "working-days" },
    obligation: "Notify the purchaser and affected licensee within five working days so evaluation responsibility can transfer.",
    cannotAssume: "This is a different trigger and duty from officer escalation; one does not satisfy the other.",
    gateId: "supplier",
    conditional: true,
  },
  {
    id: "nrc-initial",
    label: "Initial notification to the NRC",
    section: "21.21",
    citation: "10 CFR 21.21(c)",
    citationTitle: part21SectionTitle("21.21"),
    triggerFact: "Responsible officer receives the qualifying information",
    triggerPath: "officerReceipt.receivedAt",
    duration: { amount: 2, unit: "calendar-days" },
    obligation: "Notify the NRC within two days of the responsible officer receiving the information.",
    cannotAssume: "A drafted notification, an approved report, or an agent recommendation is not a transmitted notification.",
    gateId: "reportability",
    conditional: false,
  },
  {
    id: "nrc-written",
    label: "Written notification to the NRC",
    section: "21.21",
    citation: "10 CFR 21.21(c)",
    citationTitle: part21SectionTitle("21.21"),
    triggerFact: "Same responsible-officer receipt fact",
    triggerPath: "officerReceipt.receivedAt",
    duration: { amount: 30, unit: "calendar-days" },
    obligation: "Submit the written notification within 30 days of the same officer receipt.",
    cannotAssume: "The 30 days runs from officer receipt, not from the date of the initial telephone notification.",
    gateId: "transmission",
    conditional: false,
  },
]);

export type Part21GateId =
  | "applicability"
  | "discovery"
  | "evaluation"
  | "interim"
  | "officer"
  | "supplier"
  | "reportability"
  | "transmission"
  | "records"
  | "closure";

export type Part21Gate = {
  id: Part21GateId;
  label: string;
  question: string;
  section: string;
  citation: string;
  decisionKind: "qualified-decision" | "recorded-fact";
  requiresQualification: boolean;
  requiredEvidence: string[];
  /** What the application is forbidden to do at this gate. */
  prohibits: string;
};

export const PART21_GATES: readonly Part21Gate[] = Object.freeze([
  {
    id: "applicability",
    label: "Scope and applicability",
    question: "Is this item, activity or basic component within Part 21 scope, and which Appendix B criteria apply?",
    section: "21.2",
    citation: "10 CFR 21.2 / 21.3",
    decisionKind: "qualified-decision",
    requiresQualification: true,
    requiredEvidence: ["scope basis", "licensing or contract reference"],
    prohibits: "Treating a generic quality finding as a Part 21 defect by default.",
  },
  {
    id: "discovery",
    label: "Discovery",
    question: "What exactly was discovered, when, by whom, and on what evidence?",
    section: "21.21",
    citation: "10 CFR 21.21(a)",
    decisionKind: "qualified-decision",
    requiresQualification: true,
    requiredEvidence: ["discovery record", "supporting evidence"],
    prohibits: "Backdating or restarting the clock when someone later acknowledges it.",
  },
  {
    id: "evaluation",
    label: "Evaluation",
    question: "Is the evaluation technically adequate, and could the condition create a substantial safety hazard?",
    section: "21.21",
    citation: "10 CFR 21.21(a)",
    decisionKind: "qualified-decision",
    requiresQualification: true,
    requiredEvidence: ["technical evaluation", "affected population search"],
    prohibits: "Issuing an automated reportability verdict from an agent recommendation.",
  },
  {
    id: "interim",
    label: "Interim report",
    question: "Evaluation is incomplete at day 60 — has the interim report issued with an expected completion date?",
    section: "21.21",
    citation: "10 CFR 21.21(a)",
    decisionKind: "qualified-decision",
    requiresQualification: true,
    requiredEvidence: ["interim report artifact", "expected completion date"],
    prohibits: "Presenting an interim report as an extension of the evaluation deadline.",
  },
  {
    id: "officer",
    label: "Responsible officer informed",
    question: "Was the responsible officer informed within five working days, with the evaluation basis?",
    section: "21.21",
    citation: "10 CFR 21.21(a)(3)",
    decisionKind: "recorded-fact",
    requiresQualification: false,
    requiredEvidence: ["notification record", "recipient identity"],
    prohibits: "Assuming an email to a distribution list notified the responsible officer.",
  },
  {
    id: "supplier",
    label: "Supplier evaluation capability",
    question: "Did the supplier determine it cannot evaluate, and was the purchaser notified within five working days?",
    section: "21.21",
    citation: "10 CFR 21.21(b)",
    decisionKind: "recorded-fact",
    requiresQualification: false,
    requiredEvidence: ["supplier determination", "purchaser notification"],
    prohibits: "Substituting officer escalation for the supplier duty, or the reverse.",
  },
  {
    id: "reportability",
    label: "Reportability decision",
    question: "Do quality, nuclear, legal and compliance concur that the condition is reportable, or that a documented exception applies?",
    section: "21.21",
    citation: "10 CFR 21.21(c)",
    decisionKind: "qualified-decision",
    requiresQualification: true,
    requiredEvidence: ["evaluation basis", "applicability determination", "concurrence record"],
    prohibits: "Letting one reviewer or an administrator satisfy a multi-discipline decision alone.",
  },
  {
    id: "transmission",
    label: "Notification transmitted",
    question: "Who transmitted the notification, by what method, to whom, and what receipt was returned?",
    section: "21.21",
    citation: "10 CFR 21.21(c)",
    decisionKind: "recorded-fact",
    requiresQualification: false,
    requiredEvidence: ["transmitted artifact", "method and timestamp", "receipt or verification"],
    prohibits: "Treating a completed task or a drafted report as a submission receipt.",
  },
  {
    id: "records",
    label: "Records and retention",
    question: "Which record class applies, what retention basis was assigned, and can the record be retrieved intact?",
    section: "21.51",
    citation: "10 CFR 21.51",
    decisionKind: "recorded-fact",
    requiresQualification: false,
    requiredEvidence: ["retention basis", "retrieval verification"],
    prohibits: "Applying one global retention period to every record class.",
  },
  {
    id: "closure",
    label: "Closure",
    question: "Is the case closed with a documented disposition, and are any holds resolved?",
    section: "21.21",
    citation: "10 CFR 21.21",
    decisionKind: "qualified-decision",
    requiresQualification: true,
    requiredEvidence: ["disposition record", "hold status"],
    prohibits: "Closing a case to clear an overdue indicator.",
  },
]);

export function part21Branch(id: string): Part21Branch | undefined {
  return PART21_BRANCHES.find(branch => branch.id === id);
}
export function part21Gate(id: string): Part21Gate | undefined {
  return PART21_GATES.find(gate => gate.id === id);
}

/** A generic quality finding is not automatically a Part 21 defect. */
export const PART21_SEPARATION_NOTE =
  "10 CFR Part 21 governs defect and noncompliance evaluation and notification. 10 CFR Part 50 Appendix B governs the nuclear quality-assurance program. A quality finding is not automatically a Part 21 defect, and a Part 21 evaluation is not an Appendix B audit.";
