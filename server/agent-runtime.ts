import crypto from "node:crypto";
import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import type { AuditSkill } from "../shared/skills";
import type { InvokeParams, InvokeResult } from "./_core/llm";
import { configurationDigest } from "./config-governance";

/** Only server authentication middleware may supply this value; never copy request.body.principal. */
export interface AgentPrincipal { id: string; actor?: string; auditIds: readonly string[]; auditWriteIds?: readonly string[]; qualifiedAuditIds?: readonly string[]; permissions?: readonly string[]; access?: "look_only" | "make_changes"; isAdmin?: boolean; roleIds?: string[]; qualified?: boolean; personId?: string; qualificationEvidenceId?: string }
export interface AgentScope { auditId: string; findingId?: string; actor: string; principal: AgentPrincipal }
export type AgentRecord = Record<string, any>;
export interface AgentPortfolio { source: string; audit: AgentRecord | null; findings: AgentRecord[]; evidence: AgentRecord[]; controls: AgentRecord[]; sources: AgentRecord[]; suppliers: AgentRecord[]; changes: AgentRecord[]; metrics: AgentRecord | null }
export interface GovernedSkill { kind: "skill" | "skill_candidate"; configId: string; version: string; sourceSha256: string; status: "active" | "draft" | "retired"; approvedBy?: string | null; approvedAt?: string | null; approvalDecisionId?: string | null; governanceVerified?: boolean; payload: AuditSkill }
export interface AgentGraph { source: string; schema: unknown; auditId: string; findingId: string; ontologyVersion: string; nodes: AgentRecord[]; edges: AgentRecord[]; temporalEvents: AgentRecord[]; sourceIds: string[]; traversalProof: { query?: unknown; queryFindingId?: string; auditId?: string; visitedNodeIds: string[]; traversedEdgeIds: string[]; temporalEventIds: string[]; source: string } }
export interface AgentToolCall { id: string; sequence: number; tool: string; arguments: AgentRecord; status: "completed" | "unknown" | "failed"; result: unknown; sourceIds: string[]; startedAt: string; completedAt: string }
export interface AgentRunRecord extends AgentRecord { traceId: string; auditId: string; findingId?: string; actor: string; skillId: string; status: string; toolCalls: AgentToolCall[]; skillRevision?: string; skillHash?: string; configurationStatus?: string; answers?: Record<string, unknown>; durable?: boolean }
export interface AgentConversation extends AgentRecord { id: string; auditId: string; ownerPrincipalId: string; kanbanItemId: string; revision: number; turns: AgentRecord[] }
export interface DialogueCommit { scope: AgentScope; conversation: AgentConversation; expectedRevision: number; card: AgentRecord; createCard: boolean; communications: AgentRecord[]; draft?: AgentRecord }
export interface AgentServices {
  now(): string;
  id(): string;
  portfolio(auditId: string): Promise<AgentPortfolio>;
  skills(includeCandidates: boolean): Promise<GovernedSkill[]>;
  graph(auditId: string, findingId: string): Promise<AgentGraph>;
  policy(scope: AgentScope, sourceIds: string[]): Promise<AgentRecord>;
  evidence(scope: AgentScope, evidenceIds: string[]): Promise<AgentRecord[]>;
  records(type: string, auditId: string): Promise<AgentRecord[]>;
  conversation(id: string, auditId: string): Promise<AgentConversation | null>;
  beginRun(run: AgentRunRecord): Promise<void>;
  recordTool(traceId: string, call: AgentToolCall): Promise<void>;
  finishRun(run: AgentRunRecord): Promise<void>;
  commitDialogue(commit: DialogueCommit): Promise<void>;
  invoke(params: InvokeParams): Promise<InvokeResult>;
  recordWarningDecision?(input: AgentScope & { warning: AgentRecord; decision: "acknowledged" | "rejected"; rationale: string }): Promise<AgentRecord>;
  finalizeReport?(input: AgentScope & { approvalDecisionId: string; auditorNarrative: string; artifact: AgentRecord; artifactSha256: string }): Promise<any>;
  finalizeFinding?(input: AgentScope & { approvalDecisionId: string; draft: AgentRecord }): Promise<any>;
}

export function requireAgentScope(scope: AgentScope, permission: "agent:read" | "agent:write" | "agent:control") {
  if (!scope.auditId?.trim()) throw new Error("auditId is required; no audit fallback is allowed.");
  if (!scope.principal?.id || !scope.principal.isAdmin && !scope.principal.auditIds.includes(scope.auditId)) throw new Error("Trusted principal is not authorized for this audit.");
  if (scope.actor !== (scope.principal.actor ?? scope.principal.id)) throw new Error("actor must match the trusted principal.");
  const allowed = scope.principal.permissions?.includes(permission) ?? (permission === "agent:read" ? !!scope.principal.access : scope.principal.access === "make_changes" && (permission !== "agent:control" || scope.principal.isAdmin === true));
  if (!allowed) throw new Error(`Missing permission: ${permission}`);
  if (permission !== "agent:read" && scope.principal.access && !scope.principal.isAdmin && !scope.principal.auditWriteIds?.includes(scope.auditId)) throw new Error("No make-changes grant for this audit.");
}

let pool: Pool | undefined;
function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; agent persistence fallback is disabled.");
  return pool ??= createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });
}
const parsed = (value: any) => typeof value === "string" ? JSON.parse(value) : value;
const json = (value: unknown) => JSON.stringify(value);
function payloadHashes(payload: unknown) {
  return new Set([configurationDigest(payload), crypto.createHash("sha256").update(json(payload)).digest("hex")]);
}

/** Additive schema only. Returned SQL is never run automatically; managed DB is shared with production. */
export function getAgentRuntimeMigrations(): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS part21_agent_runs (trace_id VARCHAR(180) PRIMARY KEY, audit_id VARCHAR(180) NOT NULL, finding_id VARCHAR(180) NULL, actor VARCHAR(255) NOT NULL, skill_id VARCHAR(180) NOT NULL, status VARCHAR(80) NOT NULL, payload JSON NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, INDEX idx_agent_runs_audit (audit_id, finding_id))`,
    `CREATE TABLE IF NOT EXISTS part21_agent_tool_calls (id VARCHAR(180) PRIMARY KEY, trace_id VARCHAR(180) NOT NULL, sequence_no INT NOT NULL, payload JSON NOT NULL, UNIQUE KEY idx_agent_tool_sequence (trace_id, sequence_no))`,
    `CREATE TABLE IF NOT EXISTS part21_agent_conversations (id VARCHAR(180) PRIMARY KEY, audit_id VARCHAR(180) NOT NULL, owner_principal_id VARCHAR(255) NOT NULL, kanban_item_id VARCHAR(180) NOT NULL, revision BIGINT NOT NULL, payload JSON NOT NULL, INDEX idx_agent_conversation_audit (audit_id, kanban_item_id))`,
  ];
}
async function transaction<T>(operation: (db: PoolConnection) => Promise<T>): Promise<T> {
  const db = await database().getConnection();
  try { await db.beginTransaction(); const result = await operation(db); await db.commit(); return result; }
  catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
async function record(db: PoolConnection, type: string, id: string, auditId: string, payload: unknown) {
  await db.query("INSERT INTO part21_domain_records (record_type,record_id,audit_id,payload) VALUES (?,?,?,?)", [type, id, auditId, json(payload)]);
}
async function event(db: PoolConnection, type: string, scope: AgentScope | { auditId: string; actor: string }, entityId: string, payload: unknown) {
  await db.query("INSERT INTO part21_assurance_events (id,event_type,occurred_at,actor,audit_id,entity_id,payload) VALUES (?,?,CURRENT_TIMESTAMP(3),?,?,?,?)", [crypto.randomUUID(), type, scope.actor, scope.auditId, entityId, json(payload)]);
}
async function records(type: string, auditId: string): Promise<AgentRecord[]> {
  if (!auditId) throw new Error("auditId is required.");
  if (type === "agent_run") {
    const [runs] = await database().query<any[]>("SELECT payload FROM part21_agent_runs WHERE audit_id=? ORDER BY created_at", [auditId]);
    return runs.map(row => parsed(row.payload));
  }
  const [rows] = await database().query<any[]>("SELECT record_id,audit_id,payload FROM part21_domain_records WHERE record_type=? AND audit_id=? ORDER BY record_id", [type, auditId]);
  return rows.map(row => ({ ...parsed(row.payload), id: row.record_id, auditId: row.audit_id }));
}
async function portfolio(auditId: string): Promise<AgentPortfolio> {
  if (!auditId) throw new Error("auditId is required.");
  const [rows] = await database().query<any[]>("SELECT record_type,record_id,audit_id,payload FROM part21_domain_records WHERE audit_id=? OR (record_type IN ('audit','metric') AND record_id=?) ORDER BY record_type,record_id", [auditId, auditId]);
  const values = (type: string) => rows.filter(row => row.record_type === type && (row.audit_id === auditId || (type === "audit" || type === "metric") && row.record_id === auditId)).map(row => ({ ...parsed(row.payload), id: row.record_id, auditId }));
  const audit = values("audit").find(row => row.id === auditId) ?? null;
  if (!audit) throw new Error(`Audit ${auditId} was not found in the database.`);
  return { source: "mysql-database", audit, findings: values("finding"), evidence: values("evidence"), controls: values("control"), sources: values("source"), suppliers: values("supplier"), changes: values("change"), metrics: values("metric").find(row => row.id === auditId) ?? null };
}
async function skills(includeCandidates: boolean): Promise<GovernedSkill[]> {
  const [rows] = await database().query<any[]>(`SELECT * FROM part21_controlled_configuration WHERE (kind='skill' AND status ${includeCandidates ? "IN ('active','draft')" : "='active'"})${includeCandidates ? " OR (kind='skill_candidate' AND status='draft')" : ""} ORDER BY config_id,version`);
  const result: GovernedSkill[] = [];
  for (const row of rows.filter(row => row.config_id !== "audit-phases")) {
    const value: GovernedSkill = { kind: row.kind, configId: row.config_id, version: row.version, sourceSha256: row.source_sha256, status: row.status, approvedBy: row.approved_by, approvedAt: row.approved_at, approvalDecisionId: null, governanceVerified: false, payload: parsed(row.payload) };
    const hashes = payloadHashes(value.payload);
    if (!hashes.has(value.sourceSha256)) throw new Error(`Governed skill payload hash mismatch: ${value.configId}@${value.version}`);
    if (value.status === "active" && value.approvedBy && value.approvedAt) {
      const [reviews] = await database().query<any[]>("SELECT payload,source_sha256 FROM part21_configuration_reviews WHERE kind='skill' AND config_id=? AND version=?", [value.configId, value.version]);
      const [activations] = await database().query<any[]>("SELECT payload FROM part21_configuration_events WHERE action='configuration.activated'");
      for (const stored of reviews) {
        const review = parsed(stored.payload);
        if (!payloadHashes(review).has(stored.source_sha256)) throw new Error("Governed skill/review digest mismatch.");
        const activated = activations.map(event => parsed(event.payload)).some(event => event.kind === "skill" && event.configId === value.configId && event.version === value.version && hashes.has(event.sourceSha256) && event.approvalId === review.id);
        if (activated && review.action === "activate" && review.disposition === "approved" && hashes.has(review.sourceSha256) && review.reviewerId === value.approvedBy && review.qualificationEvidenceId) { value.approvalDecisionId = review.id; value.governanceVerified = true; }
      }
    }
    result.push(value);
  }
  return result;
}

/** Validate provider proof before any evidence is passed to the model. No entity IDs masquerade as event IDs. */
export function validateAgentGraph(graph: AgentGraph, auditId: string, findingId: string): AgentGraph {
  if (graph.auditId !== auditId || graph.findingId !== findingId) throw new Error("Graph audit/finding scope mismatch.");
  if (!graph.source?.includes("mysql") || !graph.ontologyVersion || !graph.schema) throw new Error("Graph database provenance, schema, or ontology version is missing.");
  const proof = graph.traversalProof;
  if (!proof || !proof.source?.includes("mysql") || (!proof.query && !proof.queryFindingId)) throw new Error("Graph traversal query/provenance is missing.");
  for (const [items, ids] of [[graph.nodes, proof.visitedNodeIds], [graph.edges, proof.traversedEdgeIds], [graph.temporalEvents, proof.temporalEventIds]] as const) {
    if (!Array.isArray(ids) || items.some(item => !item.id) || ids.length !== items.length || new Set(ids).size !== ids.length || items.some(item => !ids.includes(String(item.id)))) throw new Error("Graph traversal proof must carry exact node, edge, and event primary keys.");
  }
  if (proof.auditId && proof.auditId !== auditId) throw new Error("Graph traversal audit mismatch.");
  if (!Array.isArray(graph.sourceIds)) throw new Error("Graph source IDs are missing.");
  return graph;
}

let adapters: Partial<AgentServices> = {};
/** Application bootstrap may bind parent-owned governed adapters. It must never receive this object from an API body. */
export function configureAgentRuntimeAdapters(value: Partial<AgentServices>) { adapters = { ...adapters, ...value }; }
export function createAgentServices(overrides: Partial<AgentServices> = {}): AgentServices {
  return {
    now: () => new Date().toISOString(), id: () => crypto.randomUUID(), portfolio, skills, records,
    async graph(auditId, findingId) {
      const graphModule = await import("./graph-store");
      // Existing unscoped API is intentionally not invoked; parent graph workstream supplies scoped export.
      const fn = graphModule.getGroundedGraphContext as unknown as (...args: any[]) => Promise<AgentGraph>;
      if (fn.length < 2) throw new Error("Audit-scoped graph provider is unavailable; legacy global traversal is disabled.");
      return validateAgentGraph(await fn(findingId, auditId), auditId, findingId);
    },
    async policy(scope, sourceIds) {
      const module = await import("./policy-runtime");
      const fn = (module as unknown as Record<string, any>).evaluateAuditFindingPolicy;
      if (typeof fn !== "function") throw new Error("Scoped deterministic policy provider is unavailable; legacy first-audit evaluator is disabled.");
      const result = await fn({ auditId: scope.auditId, findingId: scope.findingId, sourceIds });
      if (result.auditId !== scope.auditId || result.findingId !== scope.findingId) throw new Error("Policy scope mismatch.");
      return result;
    },
    async evidence(scope, evidenceIds) {
      const existing = await records("evidence", scope.auditId);
      const resolved = evidenceIds.map(id => existing.find(row => row.id === id));
      if (resolved.some(row => !row)) throw new Error("Supplied evidence ID is missing or belongs to another audit.");
      return resolved as AgentRecord[];
    },
    async conversation(id, auditId) {
      const [rows] = await database().query<any[]>("SELECT * FROM part21_agent_conversations WHERE id=?", [id]);
      if (!rows[0]) return null;
      const row = rows[0];
      if (row.audit_id !== auditId) throw new Error("Conversation belongs to another audit.");
      return { ...parsed(row.payload), id: row.id, auditId: row.audit_id, ownerPrincipalId: row.owner_principal_id, kanbanItemId: row.kanban_item_id, revision: Number(row.revision) };
    },
    async beginRun(run) {
      await database().query("INSERT INTO part21_agent_runs (trace_id,audit_id,finding_id,actor,skill_id,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3),CURRENT_TIMESTAMP(3))", [run.traceId, run.auditId, run.findingId ?? null, run.actor, run.skillId, run.status, json(run)]);
    },
    async recordTool(traceId, call) {
      await database().query("INSERT INTO part21_agent_tool_calls (id,trace_id,sequence_no,payload) VALUES (?,?,?,?)", [call.id, traceId, call.sequence, json(call)]);
    },
    async finishRun(run) {
      await transaction(async db => {
        const [result] = await db.query<any>("UPDATE part21_agent_runs SET status=?,payload=?,updated_at=CURRENT_TIMESTAMP(3) WHERE trace_id=? AND audit_id=? AND actor=?", [run.status, json(run), run.traceId, run.auditId, run.actor]);
        if (result.affectedRows !== 1) throw new Error("Agent run persistence scope mismatch.");
        await event(db, "agent_skill_run_recorded", run, run.traceId, run);
      });
    },
    async commitDialogue(commit) {
      const { scope, conversation, expectedRevision, card, createCard, communications, draft } = commit;
      requireAgentScope(scope, "agent:write");
      if (card.auditId !== scope.auditId) throw new Error("Card audit scope mismatch.");
      if (conversation.auditId !== scope.auditId || conversation.ownerPrincipalId !== scope.principal.id || conversation.kanbanItemId !== card.id) throw new Error("Conversation ownership/audit/card mismatch.");
      if (conversation.revision !== expectedRevision + 1) throw new Error("Conversation revision must advance exactly once.");
      for (const communication of communications) {
        if (communication.auditId !== scope.auditId || communication.itemId !== card.id || communication.conversationId !== conversation.id) throw new Error("Communication audit/card/conversation scope mismatch.");
      }
      await transaction(async db => {
        const [rows] = await db.query<any[]>("SELECT * FROM part21_agent_conversations WHERE id=? FOR UPDATE", [conversation.id]);
        const current = rows[0];
        if (current && (current.audit_id !== scope.auditId || current.owner_principal_id !== scope.principal.id || current.kanban_item_id !== card.id)) throw new Error("Conversation ownership/audit/card mismatch.");
        if ((current ? Number(current.revision) : 0) !== expectedRevision) throw new Error("Conversation revision conflict; reload before appending.");
        const [cards] = await db.query<any[]>("SELECT audit_id,payload FROM part21_domain_records WHERE record_type='kanban_item' AND record_id=? FOR UPDATE", [card.id]);
        if (createCard) {
          if (cards.length) throw new Error("Card already exists; reload before appending.");
          await record(db, "kanban_item", card.id, scope.auditId, card);
        } else {
          if (!cards[0] || cards[0].audit_id !== scope.auditId) throw new Error("Existing card does not belong to this audit.");
          const stored = parsed(cards[0].payload);
          if (stored.conversationId && stored.conversationId !== conversation.id) throw new Error("Card is already owned by another conversation.");
          const updated = { ...stored, conversationId: conversation.id, skillIds: card.skillIds, activeSkillId: card.activeSkillId, skillsApplied: card.skillsApplied, attention: true, updatedAt: new Date().toISOString() };
          await db.query("UPDATE part21_domain_records SET payload=? WHERE record_type='kanban_item' AND record_id=? AND audit_id=?", [json(updated), card.id, scope.auditId]);
        }
        for (const attachmentId of conversation.attachmentIds ?? []) {
          const [assets] = await db.query<any[]>("SELECT audit_id,payload FROM part21_domain_records WHERE record_type='kanban_attachment' AND record_id=?", [attachmentId]);
          if (!assets[0] || assets[0].audit_id !== scope.auditId || parsed(assets[0].payload).itemId !== card.id) throw new Error("Attachment does not belong to this audit/card.");
        }
        if (current) await db.query("UPDATE part21_agent_conversations SET revision=?,payload=? WHERE id=? AND revision=?", [conversation.revision, json(conversation), conversation.id, expectedRevision]);
        else await db.query("INSERT INTO part21_agent_conversations (id,audit_id,owner_principal_id,kanban_item_id,revision,payload) VALUES (?,?,?,?,?,?)", [conversation.id, scope.auditId, scope.principal.id, card.id, conversation.revision, json(conversation)]);
        for (const communication of communications) await record(db, "kanban_communication", communication.id, scope.auditId, communication);
        if (draft) await record(db, "finding_draft", draft.id, scope.auditId, draft);
        await event(db, "agent_dialogue_turn_recorded", scope, conversation.id, { revision: conversation.revision, kanbanItemId: card.id, communicationIds: communications.map(row => row.id), skillsApplied: conversation.skillsApplied, traceIds: conversation.traceIds, graphWrite: "not_performed", draftId: draft?.id });
      });
    },
    async invoke(params) { const { invokeLLM } = await import("./_core/llm"); return invokeLLM(params); },
    ...adapters, ...overrides,
  };
}

/** Registry is configuration + persisted executions, not invented running processes/heartbeats. */
export async function getAgentRegistry(auditId?: string, services = createAgentServices()) {
  if (!auditId) throw new Error("auditId is required for agent activity.");
  const runs = await services.records("agent_run", auditId);
  const configured = await services.skills(false);
  return { mode: "database-execution-registry", source: "mysql-database", auditId, agents: configured.map(row => ({ agentId: row.payload.agent, name: row.payload.name, state: "not_dispatched", route: row.payload.route, configurationVersion: row.version })), runs, controls: ["pause", "resume", "kill", "restart"], observability: { traceStore: "part21_agent_runs / part21_agent_tool_calls", heartbeat: "not_available_without_worker_provider" } };
}
export async function controlAgent(agentId: string, action: "pause" | "resume" | "kill" | "restart", reason = "", scope?: AgentScope) {
  if (!scope) throw new Error("Trusted audit-scoped principal is required for runtime control.");
  requireAgentScope(scope, "agent:control");
  if (!agentId || !reason.trim()) throw new Error("agentId and reason are required.");
  // These request/response routes are not resident workers. Never claim a route name was paused/killed.
  return { ok: false, agentId, action, reason, status: "blocked", error: "No worker lifecycle control provider is configured; no process was controlled." };
}
