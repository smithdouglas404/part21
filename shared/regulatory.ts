export type RegulatoryRisk = "Low" | "Medium" | "High" | "Unknown";
export type RegulationSet = "10-cfr-part-21" | "10-cfr-part-50-appendix-b";
export type SourceKind = "ecfr-regulation" | "nrc-guidance-pdf";
export type OriginalKind = "metadata" | "hierarchy" | "full-xml" | "guidance-pdf";

export interface SourceOriginal {
  id: string;
  kind: OriginalKind;
  requestedUri: string;
  finalUri: string;
  contentType: string;
  sha256: string;
  sizeBytes: number;
  retrievedAt: string;
  storage: { provider: string; objectId: string; versionId: string; integrityVerified: boolean };
}
export interface RegulatoryProvision {
  id: string;
  snapshotId: string;
  parentId: string | null;
  kind: "part" | "section" | "appendix" | "criterion" | "paragraph";
  citation: string;
  heading: string;
  text: string;
  originalId: string;
  /** Snapshot-local locator, NOT a legal citation. */
  xmlLocator: string;
  anchorStatus: "structural" | "validated-numbering" | "unresolved";
  paragraphLabel?: string;
}
export interface RegulatorySnapshot {
  id: string;
  sourceId: string;
  sourceKind: SourceKind;
  regulationSet: RegulationSet | null;
  sourceAsOf: string;
  latestAmendedOn: string | null;
  latestIssueDate: string | null;
  providerUpToDateAsOf: string | null;
  retrievedAt: string;
  importInProgress: boolean | null;
  originals: SourceOriginal[];
  provisions: RegulatoryProvision[];
  parserVersion: string;
  status: "ingested-human-review-required";
  legalStatus: "unofficial-ecfr-compilation" | "guidance-not-law";
  license: { status: "government-regulatory-text" | "review-required" | "approved"; approvalId: string | null; basis: string };
  warnings: string[];
}
export interface SourceProvisionReference {
  snapshotId: string;
  provisionId: string;
  textSha256: string;
}
export interface ReviewedObligation {
  id: string;
  version: string;
  source: SourceProvisionReference;
  interpretation: string;
  interpretationApprovalId: string;
  applicabilityBasis: string;
  evidenceTypes: string[];
}
export interface AuditProfileDefinition {
  id: string;
  version: string;
  title: string;
  caseType: string;
  regulationSets: RegulationSet[];
  requiredProvisionIds: string[];
  requiredEvidenceTypes: string[];
  reviewerRoles: string[];
  reportingPath: string;
}

/** Inventory metadata only: headings are NOT reviewed interpretations or downloaded text. */
export const part21SectionInventory = [
  ["21.1", "Purpose"], ["21.2", "Scope"], ["21.3", "Definitions"],
  ["21.4", "Interpretations"], ["21.5", "Communications"], ["21.6", "Posting requirements"],
  ["21.7", "Exemptions"], ["21.8", "Information collection requirements: OMB approval"],
  ["21.21", "Notification of failure to comply or existence of a defect and its evaluation"],
  ["21.31", "Procurement documents"], ["21.41", "Inspections"],
  ["21.51", "Maintenance and inspection of records"], ["21.61", "Failure to notify"],
  ["21.62", "Criminal penalties"],
] as const;
export const appendixBCriteriaInventory = [
  ["I", "Organization"], ["II", "Quality Assurance Program"], ["III", "Design Control"],
  ["IV", "Procurement Document Control"], ["V", "Instructions, Procedures, and Drawings"],
  ["VI", "Document Control"], ["VII", "Control of Purchased Material, Equipment, and Services"],
  ["VIII", "Identification and Control of Materials, Parts, and Components"],
  ["IX", "Control of Special Processes"], ["X", "Inspection"], ["XI", "Test Control"],
  ["XII", "Control of Measuring and Test Equipment"], ["XIII", "Handling, Storage and Shipping"],
  ["XIV", "Inspection, Test, and Operating Status"], ["XV", "Nonconforming Materials, Parts, or Components"],
  ["XVI", "Corrective Action"], ["XVII", "Quality Assurance Records"], ["XVIII", "Audits"],
] as const;
export interface RegulatorySection {
  id: string; title: string; category: string; summary: string; obligations: string[];
  evidenceToTest: string[]; ifUnmet: string; defaultRisk: RegulatoryRisk;
}
export interface RemediationPractice { id: string; title: string; source: string; steps: string[] }
export const part21RegulatoryPack = {
  id: "10-cfr-part-21", title: "10 CFR Part 21 — Reporting of Defects and Noncompliance",
  authority: "U.S. NRC / eCFR", versionMode: "source-link-only; no operational baseline",
  currentAsOf: null, sectionIndexSource: "Inventory metadata; downloaded snapshots required",
  sources: [{ id: "ecfr-part-21", label: "eCFR Part 21", url: "https://www.ecfr.gov/current/title-10/chapter-I/part-21" }],
  sections: part21SectionInventory.map(([id, title]): RegulatorySection => ({
    id, title, category: "Inventory only", summary: "Exact source text and reviewed interpretation must be loaded from a pinned database snapshot.",
    obligations: [], evidenceToTest: [], ifUnmet: "Unknown; qualified review required", defaultRisk: "Unknown",
  })), implementationGuidance: [] as RemediationPractice[],
};
/** Client compatibility export: never binds or selects an operational finding/audit. */
export const regulatoryTraceForFinding = {
  findingId: null,
  rootFinding: null,
  risk: "Unknown" as RegulatoryRisk,
  path: [] as string[],
  violationHypothesis: "No database finding is selected. Use the scoped server API with explicit auditId and findingId.",
  requiredHumanDeterminations: ["Select an audit-scoped finding from the database", "Confirm Part 21 applicability", "Qualified technical/legal review of any conclusion"],
  remediation: [] as string[],
  impactIfNotRemediated: "Unknown; no finding or qualified determination is loaded.",
  bestPracticeLinks: [] as string[],
};
/** Removed fixture-backed compatibility calls: no default finding or invented trace. */
export function traverseRegulatoryTree(_findingId?: string): never {
  throw new Error("Use server traverseControlledRegulatoryTree with explicit auditId, findingId and pinned policy baseline.");
}
export function assessRemediationImpact(_findingId?: string): never {
  throw new Error("Use server assessControlledRemediationImpact with explicit audit scope.");
}
