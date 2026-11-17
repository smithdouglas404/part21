export type RegulatoryRisk = "Low" | "Medium" | "High";

export interface RegulatorySection {
  id: string;
  title: string;
  category: "Purpose" | "Definitions" | "Records" | "Notification" | "Implementation";
  summary: string;
  obligations: string[];
  evidenceToTest: string[];
  ifUnmet: string;
  defaultRisk: RegulatoryRisk;
}

export interface RemediationPractice {
  id: string;
  title: string;
  source: string;
  steps: string[];
}

export const part21RegulatoryPack = {
  id: "10-cfr-part-21",
  title: "10 CFR Part 21 — Reporting of Defects and Noncompliance",
  authority: "U.S. Nuclear Regulatory Commission / eCFR",
  versionMode: "Live source link + client-controlled interpretation overlay",
  currentAsOf: "2026-11-13",
  sectionIndexSource: "eCFR Table of Contents: 21.1–21.62",
  sources: [
    { id: "ecfr-part-21", label: "eCFR Part 21", url: "https://www.ecfr.gov/current/title-10/chapter-I/part-21" },
    { id: "nrc-part-21-guidance", label: "NRC guidance on implementing 10 CFR Part 21", url: "https://www.nrc.gov/facilities-safety/new-reactors/how-we-regulate/regulatory-oversight/quality-assurance-for-new-reactors/guidance-on-implementation-of-10-cfr-part-21-requirements" },
    { id: "rg-1-234", label: "RG 1.234 — Evaluating Deviations and Reporting Defects and Noncompliance", url: "https://www.nrc.gov/docs/ML1733/ML17338A072.pdf" },
    { id: "nei-14-09", label: "NEI 14-09 — Guidelines for Implementation of 10 CFR Part 21", url: "https://www.nrc.gov/docs/ML1605/ML16054A825.pdf" },
  ],
  sections: [
    { id: "21.1", title: "Purpose", category: "Purpose", summary: "Establishes procedures and requirements for implementing the Energy Reorganization Act provisions addressed by Part 21.", obligations: ["Maintain a process that can identify and evaluate reportable defects and noncompliance."], evidenceToTest: ["Approved Part 21 procedure", "Roles and delegation matrix"], ifUnmet: "The organization may not have a controlled basis for deciding when a condition enters Part 21 evaluation.", defaultRisk: "Medium" },
    { id: "21.2", title: "Scope", category: "Purpose", summary: "Defines the entities, facilities, activities, and basic components within the scope of Part 21.", obligations: ["Determine whether the organization, activity, basic component, or supplier is subject to Part 21."], evidenceToTest: ["License / authorization scope", "Basic-component classification", "Supplier applicability assessment"], ifUnmet: "A condition could be evaluated under the wrong regulatory pathway or not evaluated at all.", defaultRisk: "High" },
    { id: "21.3", title: "Definitions", category: "Definitions", summary: "Provides the defined terms used by Part 21, including basic component, defect, deviation, failure to comply, and substantial safety hazard." , obligations: ["Use controlled definitions when classifying a deviation, defect, or failure to comply."], evidenceToTest: ["Classification rationale", "Definition crosswalk", "Technical evaluation record"], ifUnmet: "The system may produce an inconsistent or unsupported classification.", defaultRisk: "High" },
    { id: "21.4", title: "Interpretations", category: "Definitions", summary: "Provides the Commission interpretation pathway for Part 21 requirements and makes interpretation governance an explicit control point.", obligations: ["Record the client-approved interpretation used for a compliance conclusion."], evidenceToTest: ["Approved interpretation memo", "Legal/compliance review", "Interpretation version"], ifUnmet: "An agent may apply an unapproved interpretation to a regulatory conclusion.", defaultRisk: "High" },
    { id: "21.5", title: "Communications", category: "Records", summary: "Defines communication expectations relevant to Part 21 information and responsible contacts.", obligations: ["Maintain controlled communications and access to responsible contacts."], evidenceToTest: ["Communication procedure", "Responsible officer designation", "Escalation contact test"], ifUnmet: "Affected personnel may not know how to escalate a potentially reportable condition.", defaultRisk: "Medium" },
    { id: "21.6", title: "Posting requirements", category: "Records", summary: "Sets notice and posting expectations for Part 21 information and contacts.", obligations: ["Maintain required postings and access to the responsible contacts."], evidenceToTest: ["Current postings", "Electronic notice location", "Responsible officer designation"], ifUnmet: "Affected personnel may not know how to escalate a potentially reportable condition.", defaultRisk: "Medium" },
    { id: "21.7", title: "Exemptions", category: "Purpose", summary: "Provides the Commission's exemption authority and identifies boundaries that require careful applicability analysis.", obligations: ["Record the legal basis for any claimed exemption or exclusion."], evidenceToTest: ["Exemption record", "Applicability decision", "Client legal/compliance review"], ifUnmet: "A false exemption assumption can mask a reportability obligation.", defaultRisk: "High" },
    { id: "21.8", title: "Information collection requirements: OMB approval", category: "Records", summary: "Identifies the approved information collection requirements associated with Part 21.", obligations: ["Maintain the controlled forms and records needed for the approved information collection requirements."], evidenceToTest: ["Controlled forms", "Record completeness check", "Retention mapping"], ifUnmet: "The audit record may omit required information or use an uncontrolled collection mechanism.", defaultRisk: "Medium" },
    { id: "21.21", title: "Notification of failure to comply or existence of a defect and its evaluation", category: "Notification", summary: "Requires procedures to evaluate deviations and failures to comply for defects or failures associated with substantial safety hazards, including escalation and notification paths.", obligations: ["Evaluate deviations and failures to comply as soon as practicable and within the applicable time window.", "Escalate qualifying results to the responsible officer or designated person.", "Preserve the evaluation and notification decision basis."], evidenceToTest: ["Discovery timestamp", "60-day evaluation tracker", "Interim report decision", "Responsible officer notification", "Technical evaluation"], ifUnmet: "A potentially reportable defect may not be evaluated, escalated, or notified within the required window.", defaultRisk: "High" },
    { id: "21.31", title: "Procurement documents", category: "Implementation", summary: "Sets procurement-document expectations relevant to Part 21 responsibilities and supplied basic components.", obligations: ["Flow down applicable Part 21 responsibilities and acceptance requirements into procurement documents."], evidenceToTest: ["Purchase order clauses", "Supplier quality requirements", "Flow-down review"], ifUnmet: "Supplier responsibilities and evidence expectations may not be contractually controlled.", defaultRisk: "High" },
    { id: "21.41", title: "Inspections", category: "Records", summary: "Provides the inspection context for activities and records governed by Part 21.", obligations: ["Make relevant records and responsible personnel available for inspection."], evidenceToTest: ["Inspection request log", "Record retrieval test", "Inspection response package"], ifUnmet: "The organization may not be able to demonstrate control of the evidence during inspection.", defaultRisk: "Medium" },
    { id: "21.51", title: "Maintenance and inspection of records", category: "Records", summary: "Requires records supporting Part 21 evaluations and the ability to make them available for inspection.", obligations: ["Maintain complete, legible, retrievable, and auditable Part 21 records.", "Preserve records that support both reportable and non-reportable evaluation decisions."], evidenceToTest: ["Evaluation record", "Source evidence", "Approval history", "Retention and retrieval test"], ifUnmet: "The conclusion may be impossible to defend because the evidence chain and decision history are incomplete.", defaultRisk: "High" },
    { id: "21.61", title: "Failure to notify", category: "Notification", summary: "Addresses failure-to-notify consequences and reinforces the need for a controlled, accountable notification decision path.", obligations: ["Escalate a potentially reportable condition through the approved notification workflow.", "Preserve the basis for the notification or non-notification decision."], evidenceToTest: ["Reportability determination", "Written notification draft", "Safety significance analysis", "Affected component list"], ifUnmet: "A required notification may be late, incomplete, or unsupported.", defaultRisk: "High" },
    { id: "21.62", title: "Criminal penalties", category: "Implementation", summary: "Identifies criminal penalty implications associated with violations of Part 21.", obligations: ["Escalate suspected deliberate or material violations through approved legal and compliance channels."], evidenceToTest: ["Escalation record", "Investigation records", "Legal/compliance review"], ifUnmet: "The organization may mishandle a potentially serious violation or fail to preserve the required decision path.", defaultRisk: "High" },
  ] as RegulatorySection[],
  implementationGuidance: [
    { id: "RG-1.234", title: "Evaluate deviations and report defects using an accepted method", source: "NRC Regulatory Guide 1.234", steps: ["Identify the discovery point", "Evaluate the deviation or failure to comply", "Determine defect / substantial safety hazard significance", "Escalate and report when required", "Maintain the decision record"] },
    { id: "NEI-14-09", title: "Operational implementation guidance", source: "NEI 14-09, Revision 1", steps: ["Define procurement and supplier interfaces", "Preserve non-reportable evaluation records", "Control discovery and point-of-discovery logic", "Coordinate purchaser/supplier evaluation and notification", "Track transfer of evaluation/reporting responsibility"] },
  ] as RemediationPractice[],
};

export const regulatoryTraceForFinding = {
  findingId: "FIND-2026-04",
  rootFinding: "Receiving inspection cannot resolve heat-lot chain for NSS-4820",
  risk: "High" as RegulatoryRisk,
  path: ["FIND-2026-04", "AUD-026", "21.51", "21.21", "21.61", "RG-1.234", "NEI-14-09"],
  violationHypothesis: "The organization may not be able to demonstrate complete, retrievable records supporting the evaluation of a deviation or failure to comply.",
  requiredHumanDeterminations: ["Confirm Part 21 applicability", "Confirm whether the condition is a deviation, defect, or failure to comply", "Determine substantial safety hazard significance", "Approve reportability and notification path"],
  remediation: ["Reconcile the receiving inspection to the correct heat-lot and certificate records.", "Preserve the discovered condition, evaluator, evidence, and decision timestamp.", "Run the Part 21 evaluation workflow against the applicable client procedure.", "Route the result to the responsible officer/designated person for approval.", "Retain the complete evaluation and any notification record under the approved retention policy."],
  impactIfNotRemediated: "The organization may be unable to demonstrate traceability, may repeat the condition across affected components, and may miss a timely evaluation or notification decision.",
  bestPracticeLinks: ["RG-1.234", "NEI-14-09"],
};

export function traverseRegulatoryTree(findingId = "FIND-2026-04") {
  const trace = { ...regulatoryTraceForFinding, findingId, path: [findingId, ...regulatoryTraceForFinding.path.slice(1)] };
  return { findingId, ontology: "part21-assurance-ontology", regulatoryPack: part21RegulatoryPack.id, trace, nodes: trace.path.map((id) => part21RegulatoryPack.sections.find((section) => section.id === id) ?? part21RegulatoryPack.implementationGuidance.find((guidance) => guidance.id === id) ?? { id, title: id }), sourceLinks: part21RegulatoryPack.sources };
}

export function assessRemediationImpact(findingId = "FIND-2026-04") {
  return { findingId, risk: regulatoryTraceForFinding.risk, impactIfNotRemediated: regulatoryTraceForFinding.impactIfNotRemediated, remediation: regulatoryTraceForFinding.remediation, bestPracticeLinks: regulatoryTraceForFinding.bestPracticeLinks, humanReviewRequired: true };
}
