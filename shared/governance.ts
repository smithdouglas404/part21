export type WorkState = "backlog" | "ready" | "in_review" | "deferred" | "complete";
export type DecisionAction = "accept" | "decline" | "defer";

export interface GovernanceItem {
  id: string;
  title: string;
  summary: string;
  state: WorkState;
  priority: "critical" | "high" | "medium";
  findingId?: string;
  skillId: string;
  agentId: string;
  requiredFields: string[];
  completedFields: string[];
  decision?: DecisionAction;
  decisionNote?: string;
  deferUntil?: string;
  deferredAt?: string;
  deferredDurationHours?: number;
  owner: string;
  lastUpdated: string;
  history: { at: string; actor: string; action: string; note: string; state: WorkState }[];
}

const now = "2026-11-17T18:44:00Z";

export const governanceItems: GovernanceItem[] = [
  { id: "GOV-001", title: "Resolve heat-lot evidence chain", summary: "Reconcile EV-803 receiving inspection to the correct heat-lot and preserve the evaluation basis.", state: "in_review", priority: "critical", findingId: "FIND-2026-04", skillId: "evidence-intake", agentId: "evidence-curator", requiredFields: ["source record", "effective date", "owner", "evidence note"], completedFields: ["source record", "owner"], owner: "S. Rao", lastUpdated: now, history: [{ at: now, actor: "evidence-curator", action: "routed", note: "Evidence gap requires owner review.", state: "in_review" }] },
  { id: "GOV-002", title: "Approve CHG-014 baseline impact", summary: "Review the two downstream work instructions affected by the supplier material substitution.", state: "ready", priority: "high", findingId: "FIND-2026-04", skillId: "trace-chain", agentId: "genealogy-navigator", requiredFields: ["impact set", "approver", "decision note"], completedFields: ["impact set"], owner: "A. Patel", lastUpdated: now, history: [] },
  { id: "GOV-003", title: "Confirm Part 21 applicability", summary: "Confirm the client-approved interpretation and scope boundary before the policy evaluator is treated as authoritative.", state: "backlog", priority: "high", skillId: "frame-scope", agentId: "scope-facilitator", requiredFields: ["scope anchor", "applicability basis", "approver"], completedFields: ["scope anchor"], owner: "M. Lee", lastUpdated: now, history: [] },
  { id: "GOV-004", title: "Draft report disposition", summary: "Prepare a Ready with actions disposition and route it to the designated quality approver.", state: "deferred", priority: "medium", findingId: "FIND-2026-04", skillId: "readiness-close", agentId: "readiness-facilitator", requiredFields: ["readiness position", "action list", "approver"], completedFields: ["readiness position", "action list", "approver"], deferUntil: "2026-11-19T17:00:00Z", deferredAt: "2026-11-17T14:00:00Z", deferredDurationHours: 27, owner: "D. Novak", lastUpdated: now, history: [{ at: now, actor: "D. Novak", action: "defer", note: "Awaiting the policy coverage rerun after EV-803 reconciliation.", state: "deferred" }] },
  { id: "GOV-005", title: "Verify responsible officer contact", summary: "Confirm the current escalation contact and electronic Part 21 notice location.", state: "complete", priority: "medium", skillId: "frame-scope", agentId: "scope-facilitator", requiredFields: ["contact test", "approval note"], completedFields: ["contact test", "approval note"], decision: "accept", decisionNote: "Contact path verified against the synthetic directory.", owner: "M. Lee", lastUpdated: "2026-11-16T12:30:00Z", history: [{ at: "2026-11-16T12:30:00Z", actor: "M. Lee", action: "accept", note: "Contact path verified against the synthetic directory.", state: "complete" }] },
];

function missingFields(item: GovernanceItem) {
  return item.requiredFields.filter((field) => !item.completedFields.includes(field));
}

export function getGovernanceBoard() {
  return { items: governanceItems, columns: ["backlog", "ready", "in_review", "deferred", "complete"] as WorkState[], generatedAt: new Date().toISOString() };
}

export function moveGovernanceItem(id: string, target: WorkState, actor = "Assurance user") {
  const item = governanceItems.find((candidate) => candidate.id === id);
  if (!item) return { ok: false, error: "Work item not found" };
  const missing = missingFields(item);
  if ((target === "ready" || target === "in_review" || target === "complete") && missing.length > 0) return { ok: false, error: "Required fields are missing", missingFields: missing, item };
  const previous = item.state;
  item.state = target;
  item.lastUpdated = new Date().toISOString();
  item.history.push({ at: item.lastUpdated, actor, action: `move:${previous}->${target}`, note: missing.length ? `Moved with ${missing.length} missing fields.` : "Required fields present.", state: target });
  return { ok: true, item, warning: missing.length ? `Missing fields: ${missing.join(", ")}` : undefined };
}

export function decideGovernanceItem(id: string, action: DecisionAction, note: string, deferUntil?: string, actor = "Assurance user") {
  const item = governanceItems.find((candidate) => candidate.id === id);
  if (!item) return { ok: false, error: "Work item not found" };
  if (!note.trim()) return { ok: false, error: "A decision update is required for every human action." };
  if (action === "defer" && (!deferUntil || Number.isNaN(Date.parse(deferUntil)) || Date.parse(deferUntil) <= Date.now())) return { ok: false, error: "Deferral requires a future defer-until timestamp." };
  item.decision = action;
  item.decisionNote = note;
  item.lastUpdated = new Date().toISOString();
  if (action === "defer") {
    item.state = "deferred";
    item.deferUntil = deferUntil;
    item.deferredAt = item.deferredAt ?? item.lastUpdated;
    item.deferredDurationHours = Math.max(0, (Date.parse(deferUntil!) - Date.parse(item.deferredAt)) / 3600000);
  }
  if (action === "accept") item.state = "complete";
  if (action === "decline") item.state = "in_review";
  item.history.push({ at: item.lastUpdated, actor, action, note, state: item.state });
  return { ok: true, item, auditEvent: { actor, action, note, at: item.lastUpdated, deferUntil: item.deferUntil ?? null } };
}
