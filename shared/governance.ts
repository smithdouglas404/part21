export type WorkState = "backlog" | "ready" | "in_review" | "deferred" | "complete";
export type DecisionAction = "accept" | "decline" | "defer";

/**
 * Shared governance shape only.
 *
 * The operational board is persisted per audit in part21_domain_records and is
 * served by server/governance-store.ts. This module intentionally contains no
 * demonstration rows: a governance item must exist in the database for the
 * selected audit before it can be listed, moved, or decided.
 */
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
  history: {
    at: string;
    actor: string;
    action: string;
    note: string;
    state: WorkState;
  }[];
}
