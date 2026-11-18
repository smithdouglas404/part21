export type ViewId = "overview" | "audit" | "graph" | "evidence" | "documents" | "controls" | "skills" | "policy" | "governance" | "regulatory" | "roles" | "agents" | "data";

export type EntityType = "requirement" | "product" | "supplier" | "evidence" | "person" | "change" | "finding";

export type RiskTone = "cyan" | "green" | "amber" | "red" | "blue";

export interface GraphNode {
  id: string;
  label: string;
  type: EntityType;
  meta: string;
  status: string;
  tone: RiskTone;
  x: number;
  y: number;
  description: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  tone: RiskTone;
}

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  detail: string;
  actor: string;
  type: "baseline" | "change" | "finding" | "approval";
  impact: string;
}

export interface ActivityItem {
  time: string;
  title: string;
  detail: string;
  tone: RiskTone;
}

export interface AuditRecord {
  id: string;
  title: string;
  standard: string;
  scope: string;
  owner: string;
  due: string;
  progress: number;
  evidence: string;
  status: "In progress" | "Ready for review" | "Planned";
  findings: number;
}

export interface FindingRecord {
  id: string;
  title: string;
  source: string;
  severity: "Critical" | "Major" | "Moderate" | "Observation";
  status: "Open" | "In remediation" | "Awaiting evidence";
  age: string;
  owner: string;
}

export interface EvidenceRecord {
  id: string;
  title: string;
  type: string;
  source: string;
  linkedTo: string;
  freshness: string;
  confidence: number;
  state: "Current" | "Review due" | "Superseded";
}

export interface ControlRecord {
  id: string;
  title: string;
  family: string;
  coverage: number;
  status: "Healthy" | "Watch" | "Gap";
  signal: string;
  next: string;
}

export interface SourceRecord {
  name: string;
  kind: string;
  records: string;
  freshness: string;
  status: "Healthy" | "Watch" | "Planned";
  lastEvent: string;
}

export interface McpToolDefinition {
  name: string;
  group: string;
  description: string;
  example: string;
}

export const graphNodes: GraphNode[] = [
  { id: "req-21-51", label: "21.51", type: "requirement", meta: "Requirement", status: "Active", tone: "cyan", x: 104, y: 84, description: "Identification and traceability of items and activities." },
  { id: "req-21-61", label: "21.61", type: "requirement", meta: "Requirement", status: "Active", tone: "blue", x: 104, y: 238, description: "Handling of nonconforming articles and corrective action." },
  { id: "prod-4820", label: "NSS-4820", type: "product", meta: "Safety valve", status: "In service", tone: "green", x: 316, y: 160, description: "Class 1 safety injection valve assembly at Unit 2." },
  { id: "sup-044", label: "Asterion", type: "supplier", meta: "Supplier", status: "Watch", tone: "amber", x: 518, y: 70, description: "Forgings and pressure-boundary machining partner." },
  { id: "ev-771", label: "EV-771", type: "evidence", meta: "Material cert", status: "Current", tone: "green", x: 532, y: 226, description: "Heat 7B-441 chemical and mechanical test certificate." },
  { id: "chg-2026-014", label: "CHG-014", type: "change", meta: "Engineering change", status: "Review", tone: "red", x: 704, y: 146, description: "Seat material substitution following supplier obsolescence notice." },
  { id: "per-lee", label: "M. Lee", type: "person", meta: "Quality lead", status: "Accountable", tone: "blue", x: 716, y: 270, description: "Quality assurance lead and delegated audit approver." },
  { id: "find-042", label: "F-042", type: "finding", meta: "Major finding", status: "Open", tone: "red", x: 352, y: 304, description: "Traceability gap between receiving inspection and heat-lot record." },
];

export const graphEdges: GraphEdge[] = [
  { from: "req-21-51", to: "prod-4820", label: "governs", tone: "cyan" },
  { from: "req-21-61", to: "find-042", label: "tested by", tone: "blue" },
  { from: "prod-4820", to: "sup-044", label: "supplied by", tone: "amber" },
  { from: "prod-4820", to: "ev-771", label: "evidenced by", tone: "green" },
  { from: "prod-4820", to: "chg-2026-014", label: "changed by", tone: "red" },
  { from: "ev-771", to: "chg-2026-014", label: "impacted", tone: "red" },
  { from: "chg-2026-014", to: "per-lee", label: "approved by", tone: "blue" },
  { from: "prod-4820", to: "find-042", label: "exposed to", tone: "red" },
];

export const timelineEvents: TimelineEvent[] = [
  { id: "t1", date: "2024-02-14", title: "Baseline released", detail: "NSS-4820 Rev 4 accepted into the Unit 2 configuration baseline.", actor: "A. Patel · Configuration", type: "baseline", impact: "No open traceability exceptions" },
  { id: "t2", date: "2025-06-09", title: "Supplier heat-lot record added", detail: "Material certificate EV-771 linked to the pressure-boundary assembly.", actor: "Asterion Portal", type: "approval", impact: "Evidence freshness: current" },
  { id: "t3", date: "2026-03-18", title: "Obsolescence notice detected", detail: "Agent flagged a proposed seat material substitution in supplier correspondence.", actor: "Signal Watcher 03", type: "change", impact: "Potential 21.51 traceability impact" },
  { id: "t4", date: "2026-04-02", title: "Engineering change opened", detail: "CHG-014 entered review with cross-linked affected product and evidence.", actor: "R. Gomez · Engineering", type: "change", impact: "2 evidence records require revalidation" },
  { id: "t5", date: "2026-04-14", title: "Major finding created", detail: "F-042 opened after receiving inspection could not resolve the heat-lot chain.", actor: "M. Lee · Audit lead", type: "finding", impact: "Escalation due in 6 days" },
];

export const activity: ActivityItem[] = [
  { time: "2m", title: "Traceability watcher", detail: "Found 1 orphaned receiving record in Unit 2 / valve family.", tone: "amber" },
  { time: "18m", title: "Audit copilot", detail: "Mapped 14 evidence items to 21.51 and 21.61 controls.", tone: "cyan" },
  { time: "41m", title: "Supplier sentinel", detail: "Asterion risk moved from low to watch after CHG-014.", tone: "red" },
  { time: "1h", title: "Change impact agent", detail: "Identified 2 downstream work instructions for review.", tone: "blue" },
];

export const audits: AuditRecord[] = [
  { id: "AUD-026", title: "Unit 2 traceability & configuration", standard: "Part 21 · 21.51 / 21.61", scope: "Safety injection valve family", owner: "M. Lee", due: "28 Apr 2026", progress: 68, evidence: "32 / 47 linked", status: "In progress", findings: 3 },
  { id: "AUD-021", title: "Supplier oversight — Asterion", standard: "Procurement / supplier controls", scope: "Pressure-boundary forgings", owner: "D. Novak", due: "02 May 2026", progress: 42, evidence: "18 / 31 linked", status: "In progress", findings: 1 },
  { id: "AUD-019", title: "Corrective action effectiveness", standard: "21.61 · CAPA", scope: "Open major findings", owner: "S. Rao", due: "12 May 2026", progress: 18, evidence: "6 / 24 linked", status: "Planned", findings: 0 },
  { id: "AUD-017", title: "Part 21 process applicability review", standard: "10 CFR Part 21 · §21.1 / §21.2", scope: "Northstar Unit 2 QA program", owner: "J. Chen", due: "18 May 2026", progress: 91, evidence: "44 / 46 linked", status: "Ready for review", findings: 2 },
  { id: "AUD-014", title: "Configuration baseline integrity", standard: "Part 21 · §21.31 / §21.41", scope: "Design-change packages", owner: "R. Gomez", due: "23 May 2026", progress: 55, evidence: "21 / 38 linked", status: "In progress", findings: 4 },
  { id: "AUD-011", title: "Document control and records retention", standard: "Quality records / §21.8", scope: "Controlled procedures and notices", owner: "A. Patel", due: "04 Jun 2026", progress: 34, evidence: "12 / 35 linked", status: "In progress", findings: 1 },
  { id: "AUD-008", title: "Field records and inspection evidence", standard: "Part 21 · §21.51", scope: "Maintenance and inspection records", owner: "T. Brooks", due: "15 Jun 2026", progress: 7, evidence: "2 / 29 linked", status: "Planned", findings: 0 },
  { id: "AUD-005", title: "Prior-year supplier notification audit", standard: "Supplier notification controls", scope: "External provider changes", owner: "M. Lee", due: "Filed · 12 Dec 2025", progress: 100, evidence: "56 / 56 linked", status: "Ready for review", findings: 5 },
];

export const findings: FindingRecord[] = [
  { id: "F-042", title: "Receiving inspection cannot resolve heat-lot chain", source: "AUD-026 · NSS-4820", severity: "Major", status: "In remediation", age: "8d", owner: "M. Lee" },
  { id: "F-039", title: "Supplier change notification arrived outside control window", source: "AUD-021 · CHG-014", severity: "Moderate", status: "Awaiting evidence", age: "14d", owner: "D. Novak" },
  { id: "F-036", title: "Obsolete work instruction referenced by traveler", source: "Signal Watcher · WI-118", severity: "Observation", status: "Open", age: "21d", owner: "R. Gomez" },
];

export const evidence: EvidenceRecord[] = [
  { id: "EV-771", title: "Heat 7B-441 chemical + mechanical cert", type: "Material certificate", source: "Asterion Portal", linkedTo: "NSS-4820 · CHG-014", freshness: "12 days ago", confidence: 0.98, state: "Current" },
  { id: "EV-803", title: "Receiving inspection report 2-481", type: "Inspection record", source: "Quality DB", linkedTo: "NSS-4820 · F-042", freshness: "8 days ago", confidence: 0.71, state: "Review due" },
  { id: "EV-824", title: "Seat material equivalency memo", type: "Engineering memo", source: "Document Control", linkedTo: "CHG-014", freshness: "4 days ago", confidence: 0.94, state: "Current" },
  { id: "EV-731", title: "NSS-4820 Rev 4 design basis", type: "Controlled document", source: "Document Control", linkedTo: "21.51 · NSS-4820", freshness: "2 months ago", confidence: 0.89, state: "Superseded" },
];

export const controls: ControlRecord[] = [
  { id: "C-21.51", title: "Product & activity traceability", family: "Identification / traceability", coverage: 82, status: "Watch", signal: "1 orphaned receiving record", next: "Resolve heat-lot link" },
  { id: "C-21.61", title: "Nonconforming article control", family: "Corrective action", coverage: 94, status: "Healthy", signal: "No stale CAPA evidence", next: "Continue effectiveness review" },
  { id: "C-SUP", title: "Supplier change oversight", family: "External providers", coverage: 61, status: "Gap", signal: "Notification latency > threshold", next: "Review Asterion escalation" },
  { id: "C-CONFIG", title: "Configuration baseline integrity", family: "Change control", coverage: 76, status: "Watch", signal: "2 work instructions impacted", next: "Approve CHG-014 impact set" },
];

export const sources: SourceRecord[] = [
  { name: "Quality system of record", kind: "SQL / API", records: "18,442", freshness: "3 min ago", status: "Healthy", lastEvent: "Inspection record 2-481" },
  { name: "Asterion supplier portal", kind: "API / webhook", records: "3,906", freshness: "18 min ago", status: "Watch", lastEvent: "CHG-014 supplier notice" },
  { name: "People & delegated roles", kind: "Directory", records: "641", freshness: "1 hr ago", status: "Healthy", lastEvent: "M. Lee delegation renewed" },
  { name: "Document control", kind: "DMS / events", records: "62,110", freshness: "9 min ago", status: "Healthy", lastEvent: "EV-824 revision accepted" },
  { name: "Field / maintenance data", kind: "Batch / files", records: "Planned", freshness: "—", status: "Planned", lastEvent: "Adapter not connected" },
];

export const mcpTools: McpToolDefinition[] = [
  { name: "search_entities", group: "Explore", description: "Search requirements, products, suppliers, people, evidence, changes, and findings with provenance-aware filters.", example: "{ query: 'NSS-4820', types: ['product', 'evidence'] }" },
  { name: "ontology_resolve", group: "Semantics", description: "Resolve a source record into the Part 21 assurance ontology class, properties, and valid relationships.", example: "{ sourceId: 'FIND-2026-04' }" },
  { name: "temporal_findings_query", group: "Temporal", description: "Query bitemporal finding history using valid time and transaction time to reconstruct what was known when.", example: "{ findingId: 'FIND-2026-04', asOf: '2026-04-15' }" },
  { name: "traverse_regulatory_tree", group: "Regulatory", description: "Traverse a finding to its Part 21 provision, client control, implementation guidance, and source links.", example: "{ findingId: 'FIND-2026-04' }" },
  { name: "assess_remediation_impact", group: "Regulatory", description: "Assess risk, remediation options, and impact if a Part 21-linked finding is not remediated.", example: "{ findingId: 'FIND-2026-04' }" },
  { name: "recommend_remediation", group: "Regulatory", description: "Generate human-reviewable remediation recommendations grounded in a Part 21 trace and implementation guidance.", example: "{ findingId: 'FIND-2026-04', risk: 'High' }" },
  { name: "policy_evaluate", group: "Policy as code", description: "Evaluate a finding against versioned Part 21 rules and return coverage, gaps, provenance, and human gates.", example: "{ findingId: 'FIND-2026-04', asOf: '2026-11-17' }" },
  { name: "policy_coverage", group: "Policy as code", description: "Show which Part 21 policy rules are covered, partial, or gaps for an audit.", example: "{ auditId: 'AUD-026' }" },
  { name: "policy_graph", group: "Policy as code", description: "Traverse the semantic policy graph from source document to rule, evaluator, evidence, and human gate.", example: "{}" },
  { name: "policy_compile", group: "Policy as code", description: "Compile a source document into versioned rule candidates with confidence, provenance, and human activation gates.", example: "{ documentId: '10-cfr-part-21' }" },
  { name: "trace_product_genealogy", group: "Trace", description: "Walk upstream and downstream relationships from a product, lot, component, or controlled activity.", example: "{ productId: 'NSS-4820', depth: 3 }" },
  { name: "compare_temporal_versions", group: "Change", description: "Compare entity state across effective dates and return potential causes, impacts, and involved people.", example: "{ entityId: 'NSS-4820', from: '2025-01-01', to: '2026-04-14' }" },
  { name: "check_audit_readiness", group: "Assure", description: "Calculate evidence coverage, stale records, open findings, and unresolved control gaps for an audit scope.", example: "{ auditId: 'AUD-026' }" },
  { name: "audit_brief_agent", group: "Assist", description: "Retrieve the audit database and read-only graph components, then invoke the grounded LLM for a fact-bounded narrative, gaps, and next questions.", example: "{ auditId: 'AUD-026', question: 'What do we know and what is missing?' }" },
  { name: "agent_intake", group: "Agent dialogue", description: "Continue a persisted Muse-to-Part-21-agent conversation, select governed skills, store every turn on a Kanban item, and require confirmation before a finding draft is saved.", example: "{ auditId: 'AUD-026', message: 'I found a new receiving finding.' }" },
  { name: "detect_control_gaps", group: "Assure", description: "Detect missing or weak control-to-evidence links and explain the signal basis.", example: "{ controlFamily: 'traceability' }" },
  { name: "evaluate_supplier_risk", group: "Monitor", description: "Combine supplier changes, notification latency, evidence freshness, and findings into a review recommendation.", example: "{ supplierId: 'SUP-044', horizonDays: 90 }" },
  { name: "create_finding", group: "Act", description: "Create a human-reviewable finding draft with source links, severity rationale, and proposed owner.", example: "{ title: '...', sourceIds: ['EV-803'] }" },
  { name: "recommend_next_moves", group: "Assist", description: "Return ranked, explainable next actions for the current audit or selected graph context.", example: "{ context: 'AUD-026', limit: 5 }" },
  { name: "excel_list_workbooks", group: "Excel adapter", description: "List synthetic workbooks available for supplier and audit-input simulation.", example: "{}" },
  { name: "excel_describe_workbook", group: "Excel adapter", description: "Describe workbook sheets, row counts, SHA-256, and import state.", example: "{ workbookId: 'last-upload' }" },
  { name: "excel_read_range", group: "Excel adapter", description: "Read normalized sample rows from the most recent workbook revision.", example: "{ sheet: 'Suppliers', limit: 25 }" },
  { name: "excel_import_workbook", group: "Excel adapter", description: "Register an uploaded workbook revision and return a human-gated graph import proposal.", example: "{ filename: 'supplier.xlsx', base64: '…' }" },
  { name: "excel_compare_revision", group: "Excel adapter", description: "Compare workbook revisions and show changed sheets or sample rows before graph import.", example: "{}" },
  { name: "excel_import_local_workbook", group: "Excel adapter", description: "Import a workbook by filename from the configured EXCEL_ROOT directory and return a hashed human-gated revision proposal.", example: "{ filename: 'supplier-notifications.xlsx', actor: 'Field auditor' }" },
  { name: "excel_approve_import", group: "Excel adapter", description: "Record human approval for the current workbook revision before any graph mutation adapter is allowed.", example: "{ workbookId: 'WB-20261118010000', actor: 'Quality approver' }" },
  { name: "run_weekly_source_sync", group: "Scheduled compliance", description: "Synchronize changed local supplier workbooks, evaluate audit readiness and policy coverage, and list enterprise connectors still awaiting configuration.", example: "{ actor: 'Weekly scheduler' }" },
  { name: "field_kanban_list", group: "Field engagement", description: "List audit-scoped field items, red attention flags, attachments, conversation timelines, applied skills, and explicit finding-to-Kanban status.", example: "{ auditId: 'selected-audit' }" },
  { name: "field_kanban_create", group: "Field engagement", description: "Create a database-backed field observation or action item from Muse speech, text, or an agent recommendation.", example: "{ auditId: 'selected-audit', title: '...', priority: 'high', createdBy: 'Field operator' }" },
  { name: "field_kanban_move", group: "Field engagement", description: "Move a field item through backlog, in progress, blocked, review, or final with a durable event record.", example: "{ itemId: 'KB-...', status: 'review', actor: 'Supervisor' }" },
  { name: "field_kanban_attach", group: "Field engagement", description: "Attach a photo, document, or voice transcript to a field item with SHA-256 provenance.", example: "{ itemId: 'KB-...', auditId: 'selected-audit', kind: 'photo', filename: 'site.jpg', base64: '…' }" },
];

export const metrics = {
  readiness: 82,
  readinessDelta: "+7.4%",
  openFindings: 12,
  criticalFindings: 1,
  supplierExposure: 3,
  changes30d: 19,
};

export const agentPulse = {
  state: "Monitoring",
  lastRun: "17 Nov 2026 · 14:38 UTC",
  coverage: "5 sources · 84,951 records",
  recommendation: "Resolve F-042 evidence chain before accepting CHG-014 into baseline.",
};

export function getGraphNode(id: string) {
  return graphNodes.find((node) => node.id === id) ?? graphNodes[2];
}

export const auditProjectionExtraNodes: GraphNode[] = [
  { id: "req-21-31", label: "21.31", type: "requirement", meta: "Requirement", status: "Active", tone: "cyan", x: 104, y: 84, description: "Procurement documents must identify applicable Part 21 requirements and quality conditions." },
  { id: "find-039", label: "F-039", type: "finding", meta: "Moderate finding", status: "Open", tone: "amber", x: 352, y: 304, description: "Supplier change notification arrived outside the control window." },
  { id: "find-036", label: "F-036", type: "finding", meta: "Observation", status: "Open", tone: "amber", x: 352, y: 304, description: "Obsolete work instruction referenced by a traveler." },
];

export const auditProjectionExtraEdges: GraphEdge[] = [
  { from: "req-21-31", to: "sup-044", label: "flows down to", tone: "cyan" },
  { from: "sup-044", to: "find-039", label: "exposed to", tone: "red" },
  { from: "req-21-51", to: "find-039", label: "tested by", tone: "blue" },
  { from: "req-21-51", to: "find-036", label: "tested by", tone: "blue" },
  { from: "ev-824", to: "find-036", label: "supports", tone: "green" },
];

export const auditProjectionMap: Record<string, { nodeIds: string[]; findingIds: string[] }> = {
  "AUD-026": { nodeIds: ["req-21-51", "req-21-61", "prod-4820", "sup-044", "ev-771", "chg-2026-014", "per-lee", "find-042"], findingIds: ["F-042", "F-036", "F-44"] },
  "AUD-021": { nodeIds: ["req-21-31", "req-21-51", "prod-4820", "sup-044", "ev-771", "chg-2026-014", "per-lee", "find-039"], findingIds: ["F-039", "F-44"] },
  "AUD-019": { nodeIds: ["req-21-61", "find-042", "per-lee"], findingIds: ["F-042"] },
  "AUD-017": { nodeIds: ["req-21-51", "req-21-61", "prod-4820", "ev-771", "per-lee"], findingIds: ["F-036"] },
  "AUD-014": { nodeIds: ["req-21-51", "prod-4820", "chg-2026-014", "ev-771", "per-lee", "find-042"], findingIds: ["F-042"] },
  "AUD-011": { nodeIds: ["req-21-51", "req-21-61", "ev-824", "per-lee", "find-036"], findingIds: ["F-036"] },
  "AUD-008": { nodeIds: ["req-21-51", "prod-4820", "ev-803", "find-042"], findingIds: ["F-042"] },
  "AUD-005": { nodeIds: ["req-21-31", "sup-044", "chg-2026-014", "per-lee", "find-039"], findingIds: ["F-039", "F-44"] },
};

export function getAuditGraphProjection(auditId: string) {
  const projection = auditProjectionMap[auditId] ?? auditProjectionMap["AUD-026"];
  const allNodes = [...graphNodes, ...auditProjectionExtraNodes];
  const allEdges = [...graphEdges, ...auditProjectionExtraEdges];
  const nodes = allNodes.filter((node) => projection.nodeIds.includes(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return { nodes, edges: allEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)), auditId };
}

const additionalAuditFindings: Record<string, FindingRecord[]> = {
  "AUD-026": [{ id: "F-036", title: "Obsolete work instruction referenced by traveler", source: "Signal Watcher · WI-118", severity: "Observation", status: "Open", age: "21d", owner: "R. Gomez" }, { id: "F-44", title: "Supplier equivalency statement missing", source: "Supplier portal", severity: "Major", status: "Awaiting evidence", age: "6d", owner: "M. Lee" }],
  "AUD-021": [{ id: "F-44", title: "Supplier equivalency statement missing", source: "Supplier portal", severity: "Major", status: "Awaiting evidence", age: "6d", owner: "M. Lee" }],
  "AUD-019": [{ id: "F-042", title: "Receiving inspection cannot resolve heat-lot chain", source: "CAPA · NSS-4820", severity: "Major", status: "In remediation", age: "8d", owner: "M. Lee" }],
  "AUD-014": [{ id: "F-042", title: "Receiving inspection cannot resolve heat-lot chain", source: "CHG-014 · NSS-4820", severity: "Major", status: "In remediation", age: "8d", owner: "R. Gomez" }],
  "AUD-011": [{ id: "F-036", title: "Obsolete work instruction referenced by traveler", source: "Document control · WI-118", severity: "Observation", status: "Open", age: "21d", owner: "A. Patel" }],
  "AUD-008": [{ id: "F-042", title: "Receiving inspection cannot resolve heat-lot chain", source: "Field records · NSS-4820", severity: "Major", status: "Awaiting evidence", age: "8d", owner: "T. Brooks" }],
  "AUD-005": [{ id: "F-44", title: "Supplier equivalency statement missing", source: "Supplier portal", severity: "Major", status: "In remediation", age: "6d", owner: "M. Lee" }],
};

export function getFindingsForAudit(auditId: string) {
  const base = findings.filter((finding) => finding.source.includes(auditId));
  return [...base, ...(additionalAuditFindings[auditId] ?? [])];
}
