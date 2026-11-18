import { createHash, randomUUID } from "node:crypto";
import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import { assertInstant } from "./regulatory-source";

/** Accept ONLY an instance produced by the server authentication boundary, never req.body. */
export interface GovernancePrincipal {
  id: string; actor: string; roleIds: string[]; auditIds: string[];
  auditWriteIds?: string[]; qualifiedAuditIds?: string[];
  access: "look_only" | "make_changes"; isAdmin: boolean; personId?: string;
  qualified: boolean; qualificationEvidenceId?: string;
}
export type GovernedConfigurationKind = "policy" | "regulatory_source" | "regulatory_baseline" | "audit_profile" | "clock_policy" | "authorization_policy" | "skill" | "ontology" | "agent_route" | "connector" | "persona";
export interface ConfigurationVersion {
  kind: GovernedConfigurationKind; configId: string; version: string; payload: unknown;
  sourceSha256: string; status: "draft" | "active" | "retired";
  createdBy: string; createdAt: string;
}
export interface ConfigurationReview {
  id: string; kind: GovernedConfigurationKind; configId: string; version: string; sourceSha256: string;
  action: "activate" | "retire"; disposition: "approved" | "rejected";
  reviewerId: string; qualificationEvidenceId: string; reviewedAt: string;
  rationale: string; acceptanceEvidenceIds: string[];
}
export interface AuditPolicyBaseline {
  auditId: string; configId: string; version: string; sourceSha256: string;
  pinnedBy: string; pinnedAt: string; approvalId: string;
}
export interface GovernanceTransaction {
  getVersion(kind: GovernedConfigurationKind, id: string, version: string): Promise<ConfigurationVersion | null>;
  listVersions(kind?: GovernedConfigurationKind): Promise<ConfigurationVersion[]>;
  insertVersion(row: ConfigurationVersion): Promise<void>;
  getReview(id: string): Promise<ConfigurationReview | null>;
  insertReview(row: ConfigurationReview): Promise<void>;
  getActive(kind: GovernedConfigurationKind, id: string): Promise<ConfigurationVersion | null>;
  setStatus(kind: GovernedConfigurationKind, id: string, version: string, status: ConfigurationVersion["status"], approval?: ConfigurationReview): Promise<void>;
  appendEvent(event: { id: string; principalId: string; at: string; action: string; payload: unknown }): Promise<void>;
  getBaseline(auditId: string): Promise<AuditPolicyBaseline | null>;
  insertBaseline(baseline: AuditPolicyBaseline): Promise<void>;
}
export interface GovernanceRepository extends GovernanceTransaction { transaction<T>(action: (tx: GovernanceTransaction) => Promise<T>): Promise<T> }
export interface GovernanceDependencies {
  repository: GovernanceRepository;
  /** Must revalidate authenticated identity/roles using server-controlled records. */
  authorize(principal: GovernancePrincipal, action: "read" | "draft" | "review" | "activate" | "retire" | "pin", auditId?: string): Promise<void>;
  /** Verify retained qualification evidence, reviewer identity and current qualification. */
  verifyQualification(principal: GovernancePrincipal, evidenceId: string, at: string): Promise<void>;
  /** Revalidate a persisted review's reviewer identity/qualification at use time. */
  verifyApprovalRecord(review: ConfigurationReview, at: string): Promise<void>;
  /** Audit existence/scope must be resolved from database. */
  requireAudit(auditId: string, principal: GovernancePrincipal): Promise<void>;
  /** Validate referenced snapshots, obligations, reviewed evaluators, and clock semantics before approving. */
  validatePayload(version: ConfigurationVersion, acceptanceEvidenceIds: string[]): Promise<void>;
  now(): string;
  newId(): string;
  reviewRoles?: string[];
  activationRoles?: string[];
  pinRoles?: string[];
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value); if (serialized === undefined) throw new Error("Configuration payload must be JSON"); return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
export function configurationDigest(payload: unknown) { return createHash("sha256").update(canonical(payload)).digest("hex"); }
function required(value: string, label: string) { if (!value?.trim()) throw new Error(`${label} required`); }
function guard(principal: GovernancePrincipal, mutate: boolean, qualified = false) {
  if (!principal?.id || !Array.isArray(principal.roleIds)) throw new Error("Trusted authenticated principal required");
  if (mutate && principal.access !== "make_changes") throw new Error("Write access required");
  if (qualified && (!principal.qualified || !principal.qualificationEvidenceId)) throw new Error("Current qualified reviewer and retained qualification evidence required");
}
function role(principal: GovernancePrincipal, roles: string[]) {
  if (!roles.some(r => principal.roleIds.includes(r))) throw new Error(`Required qualified role missing: ${roles.join(", ")}`);
}
export function diffConfigurationPayloads(before: unknown, after: unknown) {
  const changes: { path: string; before: unknown; after: unknown }[] = [];
  const absent = Symbol("absent");
  function walk(a: unknown, b: unknown, path: string) {
    if (a === absent && b === absent) return;
    if (a !== absent && b !== absent && canonical(a ?? null) === canonical(b ?? null)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let index = 0; index < Math.max(a.length, b.length); index++) walk(index < a.length ? a[index] : absent, index < b.length ? b[index] : absent, `${path}/${index}`);
      return;
    }
    if (a !== absent && b !== absent && a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
    } else changes.push({ path: path || "/", before: a === absent ? null : a ?? null, after: b === absent ? null : b ?? null });
  }
  walk(before, after, ""); return changes;
}
export function createConfigurationGovernance(deps: GovernanceDependencies) {
  const timestamp = () => assertInstant(deps.now(), "governance clock");
  const reviewRoles = deps.reviewRoles ?? ["nuclear_reviewer", "quality_approver", "compliance_approver", "configuration_reviewer"];
  const activationRoles = deps.activationRoles ?? ["configuration_approver", "quality_approver", "compliance_approver"];
  const pinRoles = deps.pinRoles ?? ["audit_lead", "quality_approver", "configuration_approver", "compliance_approver"];
  const event = (tx: GovernanceTransaction, principal: GovernancePrincipal, action: string, payload: unknown, at: string) => tx.appendEvent({ id: deps.newId(), principalId: principal.id, at, action, payload });
  async function load(tx: GovernanceTransaction, kind: GovernedConfigurationKind, id: string, version: string) {
    required(id, "configId"); required(version, "version");
    const row = await tx.getVersion(kind, id, version);
    if (!row) throw new Error(`Configuration version unavailable: ${kind}/${id}/${version}`);
    if (configurationDigest(row.payload) !== row.sourceSha256) throw new Error("Immutable configuration digest mismatch");
    return row;
  }
  return {
    async listConfigurationDrafts(principal: GovernancePrincipal, kind?: GovernedConfigurationKind) {
      guard(principal, false); await deps.authorize(principal, "read");
      return (await deps.repository.listVersions(kind)).filter(v => v.status === "draft");
    },
    async proposeConfigurationVersion(principal: GovernancePrincipal, input: { kind: GovernedConfigurationKind; configId: string; version: string; payload: unknown }) {
      guard(principal, true); await deps.authorize(principal, "draft"); required(input.configId, "configId"); required(input.version, "version");
      const at = timestamp();
      const row: ConfigurationVersion = { ...input, payload: JSON.parse(canonical(input.payload)), sourceSha256: configurationDigest(input.payload), status: "draft", createdBy: principal.id, createdAt: at };
      return deps.repository.transaction(async tx => {
        if (await tx.getVersion(input.kind, input.configId, input.version)) throw new Error("Version already exists; immutable versions cannot be overwritten");
        await tx.insertVersion(row); await event(tx, principal, "configuration.draft_created", { kind: row.kind, configId: row.configId, version: row.version, sourceSha256: row.sourceSha256 }, at); return row;
      });
    },
    async getConfigurationDiff(principal: GovernancePrincipal, input: { kind: GovernedConfigurationKind; configId: string; beforeVersion: string; afterVersion: string }) {
      guard(principal, false); await deps.authorize(principal, "read");
      const [before, after] = await Promise.all([load(deps.repository, input.kind, input.configId, input.beforeVersion), load(deps.repository, input.kind, input.configId, input.afterVersion)]);
      return { before: { version: before.version, sourceSha256: before.sourceSha256 }, after: { version: after.version, sourceSha256: after.sourceSha256 }, changes: diffConfigurationPayloads(before.payload, after.payload) };
    },
    async reviewConfigurationVersion(principal: GovernancePrincipal, input: { kind: GovernedConfigurationKind; configId: string; version: string; expectedSha256: string; action: "activate" | "retire"; disposition: "approved" | "rejected"; rationale: string; acceptanceEvidenceIds: string[] }) {
      guard(principal, true, true); role(principal, reviewRoles); await deps.authorize(principal, "review");
      const at = timestamp(); required(input.rationale, "Review rationale");
      if (!Array.isArray(input.acceptanceEvidenceIds) || !input.acceptanceEvidenceIds.length || input.acceptanceEvidenceIds.some(id => !id?.trim())) throw new Error("Retained reviewer acceptance/test evidence IDs required");
      if (!["activate", "retire"].includes(input.action) || !["approved", "rejected"].includes(input.disposition)) throw new Error("Invalid review action/disposition");
      await deps.verifyQualification(principal, principal.qualificationEvidenceId!, at);
      return deps.repository.transaction(async tx => {
        const row = await load(tx, input.kind, input.configId, input.version);
        if (row.sourceSha256 !== input.expectedSha256) throw new Error("Review target digest changed");
        if (!row.createdBy || !row.createdAt) throw new Error("Draft authorship provenance missing; controlled remediation required before review");
        if (row.createdBy === principal.id) throw new Error("Separation of duties: draft author cannot approve their own version");
        if (input.action === "activate" && row.status !== "draft" || input.action === "retire" && row.status !== "active") throw new Error("Review action is invalid for current status");
        if (input.disposition === "approved") await deps.validatePayload(row, input.acceptanceEvidenceIds);
        const review: ConfigurationReview = { id: deps.newId(), kind: input.kind, configId: input.configId, version: input.version, sourceSha256: row.sourceSha256, action: input.action, disposition: input.disposition, reviewerId: principal.id, qualificationEvidenceId: principal.qualificationEvidenceId!, reviewedAt: at, rationale: input.rationale, acceptanceEvidenceIds: [...input.acceptanceEvidenceIds] };
        await tx.insertReview(review); await event(tx, principal, "configuration.review_recorded", review, at); return review;
      });
    },
    async activateConfigurationVersion(principal: GovernancePrincipal, input: { kind: GovernedConfigurationKind; configId: string; version: string; approvalId: string; expectedSha256: string; expectedActiveVersion: string | null }) {
      guard(principal, true, true); role(principal, activationRoles); await deps.authorize(principal, "activate");
      const at = timestamp(); await deps.verifyQualification(principal, principal.qualificationEvidenceId!, at);
      return deps.repository.transaction(async tx => {
        const row = await load(tx, input.kind, input.configId, input.version);
        if (row.status !== "draft" || row.sourceSha256 !== input.expectedSha256) throw new Error("Only the exact reviewed draft can be activated");
        const approval = await tx.getReview(input.approvalId);
        if (!approval || approval.disposition !== "approved" || approval.action !== "activate" || approval.kind !== row.kind || approval.configId !== row.configId || approval.version !== row.version || approval.sourceSha256 !== row.sourceSha256 || !approval.qualificationEvidenceId || Date.parse(approval.reviewedAt) > Date.parse(at)) throw new Error("Persisted qualified approval does not match exact activation target");
        await deps.verifyApprovalRecord(approval, at);
        if (row.createdBy === principal.id) throw new Error("Draft author cannot activate their own configuration");
        const active = await tx.getActive(row.kind, row.configId);
        if ((active?.version ?? null) !== input.expectedActiveVersion) throw new Error("Active configuration changed; re-review the impact diff");
        await deps.validatePayload(row, approval.acceptanceEvidenceIds);
        if (active) await tx.setStatus(active.kind, active.configId, active.version, "retired");
        await tx.setStatus(row.kind, row.configId, row.version, "active", approval);
        await event(tx, principal, "configuration.activated", { kind: row.kind, configId: row.configId, version: row.version, sourceSha256: row.sourceSha256, approvalId: approval.id, replacedVersion: active?.version ?? null }, at);
        return { ...row, status: "active" as const, approvalId: approval.id };
      });
    },
    async retireConfigurationVersion(principal: GovernancePrincipal, input: { kind: GovernedConfigurationKind; configId: string; version: string; approvalId: string; expectedSha256: string }) {
      guard(principal, true, true); role(principal, activationRoles); await deps.authorize(principal, "retire");
      const at = timestamp(); await deps.verifyQualification(principal, principal.qualificationEvidenceId!, at);
      return deps.repository.transaction(async tx => {
        const row = await load(tx, input.kind, input.configId, input.version), approval = await tx.getReview(input.approvalId);
        if (row.status !== "active" || row.sourceSha256 !== input.expectedSha256 || !approval || approval.action !== "retire" || approval.disposition !== "approved" || approval.kind !== row.kind || approval.configId !== row.configId || approval.version !== row.version || approval.sourceSha256 !== row.sourceSha256 || !approval.qualificationEvidenceId) throw new Error("Exact active version and persisted retirement approval required");
        await deps.verifyApprovalRecord(approval, at);
        await tx.setStatus(row.kind, row.configId, row.version, "retired");
        await event(tx, principal, "configuration.retired", { kind: row.kind, configId: row.configId, version: row.version, sourceSha256: row.sourceSha256, approvalId: approval.id }, at);
        return { ...row, status: "retired" as const, approvalId: approval.id };
      });
    },
    async pinAuditPolicyBaseline(principal: GovernancePrincipal, input: { auditId: string; configId: string; version: string; expectedSha256: string; approvalId: string }) {
      guard(principal, true, true); role(principal, pinRoles); await deps.authorize(principal, "pin", input.auditId); await deps.requireAudit(input.auditId, principal);
      const at = timestamp(); await deps.verifyQualification(principal, principal.qualificationEvidenceId!, at);
      return deps.repository.transaction(async tx => {
        if (await tx.getBaseline(input.auditId)) throw new Error("Audit policy baseline is already pinned and immutable; controlled audit re-baselining is a separate decision");
        const row = await load(tx, "policy", input.configId, input.version), approval = await tx.getReview(input.approvalId);
        if (row.status !== "active" || row.sourceSha256 !== input.expectedSha256 || !approval || approval.action !== "activate" || approval.disposition !== "approved" || approval.kind !== "policy" || approval.configId !== row.configId || approval.version !== row.version || approval.sourceSha256 !== row.sourceSha256 || !approval.qualificationEvidenceId) throw new Error("Active reviewed policy and exact approval required before audit pin");
        await deps.verifyApprovalRecord(approval, at);
        await deps.validatePayload(row, approval.acceptanceEvidenceIds);
        const baseline: AuditPolicyBaseline = { ...input, sourceSha256: row.sourceSha256, pinnedBy: principal.id, pinnedAt: at };
        await tx.insertBaseline(baseline); await event(tx, principal, "configuration.audit_baseline_pinned", baseline, at); return baseline;
      });
    },
  };
}
export async function getAuditPolicyBaseline(auditId: string, repository: GovernanceRepository = getGovernanceRepository()) {
  required(auditId, "auditId"); const pin = await repository.getBaseline(auditId);
  if (!pin) throw new Error(`No reviewed policy baseline pinned for audit ${auditId}`);
  const row = await repository.getVersion("policy", pin.configId, pin.version);
  if (!row || row.sourceSha256 !== pin.sourceSha256 || configurationDigest(row.payload) !== pin.sourceSha256) throw new Error("Pinned policy baseline unavailable or integrity mismatch");
  return { pin, configuration: row };
}

export const CONFIGURATION_GOVERNANCE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS part21_configuration_reviews (review_id VARCHAR(180) PRIMARY KEY, kind VARCHAR(60) NOT NULL, config_id VARCHAR(180) NOT NULL, version VARCHAR(120) NOT NULL, payload JSON NOT NULL, source_sha256 CHAR(64) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS part21_configuration_events (event_id VARCHAR(180) PRIMARY KEY, principal_id VARCHAR(180) NOT NULL, event_at VARCHAR(40) NOT NULL, action VARCHAR(100) NOT NULL, payload JSON NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS part21_configuration_locks (kind VARCHAR(60) NOT NULL, config_id VARCHAR(180) NOT NULL, PRIMARY KEY (kind,config_id))`,
  `CREATE TABLE IF NOT EXISTS part21_configuration_authorship (kind VARCHAR(60) NOT NULL, config_id VARCHAR(180) NOT NULL, version VARCHAR(120) NOT NULL, created_by VARCHAR(180) NOT NULL, created_at VARCHAR(40) NOT NULL, PRIMARY KEY (kind,config_id,version))`,
  `CREATE TABLE IF NOT EXISTS part21_audit_policy_baselines (audit_id VARCHAR(180) PRIMARY KEY, config_id VARCHAR(180) NOT NULL, version VARCHAR(120) NOT NULL, source_sha256 CHAR(64) NOT NULL, payload JSON NOT NULL)`,
] as const;
/** Additive deployment migration; no auto-migration or production testing. Requires parent's existing config table. */
export async function migrateConfigurationGovernance(db: Pick<Pool, "query">) { for (const sql of CONFIGURATION_GOVERNANCE_MIGRATIONS) await db.query(sql); }
function parse<T>(payload: unknown): T { return (typeof payload === "string" ? JSON.parse(payload) : payload) as T; }
export function createMysqlGovernanceRepository(db: Pool): GovernanceRepository {
  function transactionView(connection: Pool | PoolConnection, locked: boolean): GovernanceTransaction {
    const lock = async (kind: string, id: string) => {
      if (!locked) return;
      await connection.query("INSERT IGNORE INTO part21_configuration_locks (kind,config_id) VALUES (?,?)", [kind, id]);
      await connection.query("SELECT kind FROM part21_configuration_locks WHERE kind=? AND config_id=? FOR UPDATE", [kind, id]);
    };
    const hydrate = (r: any): ConfigurationVersion => ({ kind: r.kind, configId: r.config_id, version: r.version, payload: parse(r.payload), sourceSha256: r.source_sha256, status: r.status, createdBy: r.authorship_created_by ?? "", createdAt: r.authored_at ?? "" });
    const select = "SELECT c.*, a.created_by AS authorship_created_by, a.created_at AS authored_at FROM part21_controlled_configuration c LEFT JOIN part21_configuration_authorship a ON c.kind=a.kind AND c.config_id=a.config_id AND c.version=a.version";
    return {
      async getVersion(kind, id, version) { await lock(kind, id); const [rows] = await connection.query<any[]>(`${select} WHERE c.kind=? AND c.config_id=? AND c.version=?${locked ? " FOR UPDATE" : ""}`, [kind, id, version]); return rows.length === 1 ? hydrate(rows[0]) : null; },
      async listVersions(kind) { const [rows] = await connection.query<any[]>(`${select}${kind ? " WHERE c.kind=?" : ""} ORDER BY c.kind,c.config_id,c.version`, kind ? [kind] : []); return rows.map(hydrate); },
      async insertVersion(row) { await lock(row.kind, row.configId); await connection.query("INSERT INTO part21_controlled_configuration (kind,config_id,version,payload,source_sha256,status,approved_by,approved_at) VALUES (?,?,?,?,?,'draft',NULL,NULL)", [row.kind, row.configId, row.version, canonical(row.payload), row.sourceSha256]); await connection.query("INSERT INTO part21_configuration_authorship (kind,config_id,version,created_by,created_at) VALUES (?,?,?,?,?)", [row.kind, row.configId, row.version, row.createdBy, row.createdAt]); },
      async getReview(id) { const [rows] = await connection.query<any[]>("SELECT payload,source_sha256 FROM part21_configuration_reviews WHERE review_id=?", [id]); if (rows.length !== 1) return null; const row = parse<ConfigurationReview>(rows[0].payload); if (configurationDigest(row) !== rows[0].source_sha256) throw new Error("Review integrity mismatch"); return row; },
      async insertReview(row) { await connection.query("INSERT INTO part21_configuration_reviews (review_id,kind,config_id,version,payload,source_sha256) VALUES (?,?,?,?,?,?)", [row.id, row.kind, row.configId, row.version, JSON.stringify(row), configurationDigest(row)]); },
      async getActive(kind, id) { await lock(kind, id); const [rows] = await connection.query<any[]>(`${select} WHERE c.kind=? AND c.config_id=? AND c.status='active'${locked ? " FOR UPDATE" : ""}`, [kind, id]); if (rows.length > 1) throw new Error("Competing active configuration versions"); return rows.length ? hydrate(rows[0]) : null; },
      async setStatus(kind, id, version, status, approval) {
        await lock(kind, id);
        // Approved identity/time are read from the matching durable review, never invented.
        if (status === "active") {
          if (!approval || approval.kind !== kind || approval.configId !== id || approval.version !== version || approval.action !== "activate" || approval.disposition !== "approved") throw new Error("Exact qualified activation review required");
          await connection.query("UPDATE part21_controlled_configuration SET status=?,approved_by=?,approved_at=? WHERE kind=? AND config_id=? AND version=?", [status, approval.reviewerId, new Date(approval.reviewedAt), kind, id, version]);
        } else await connection.query("UPDATE part21_controlled_configuration SET status=? WHERE kind=? AND config_id=? AND version=?", [status, kind, id, version]);
      },
      async appendEvent(event) { await connection.query("INSERT INTO part21_configuration_events (event_id,principal_id,event_at,action,payload) VALUES (?,?,?,?,?)", [event.id, event.principalId, event.at, event.action, JSON.stringify(event.payload)]); },
      async getBaseline(auditId) { const [rows] = await connection.query<any[]>(`SELECT payload FROM part21_audit_policy_baselines WHERE audit_id=?${locked ? " FOR UPDATE" : ""}`, [auditId]); return rows.length === 1 ? parse<AuditPolicyBaseline>(rows[0].payload) : null; },
      async insertBaseline(pin) { await connection.query("INSERT INTO part21_audit_policy_baselines (audit_id,config_id,version,source_sha256,payload) VALUES (?,?,?,?,?)", [pin.auditId, pin.configId, pin.version, pin.sourceSha256, JSON.stringify(pin)]); },
    };
  }
  return { ...transactionView(db, false), async transaction(action) { const connection = await db.getConnection(); try { await connection.beginTransaction(); const value = await action(transactionView(connection, true)); await connection.commit(); return value; } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } } };
}
let pool: Pool | null = null;
export function getGovernanceRepository() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; governance fallback disabled");
  pool ??= createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 }); return createMysqlGovernanceRepository(pool);
}
let configured: ReturnType<typeof createConfigurationGovernance> | null = null;
export function configureConfigurationGovernance(deps: Omit<GovernanceDependencies, "now" | "newId"> & Partial<Pick<GovernanceDependencies, "now" | "newId">>) {
  configured = createConfigurationGovernance({ ...deps, now: deps.now ?? (() => new Date().toISOString()), newId: deps.newId ?? randomUUID }); return configured;
}
function service() { if (!configured) throw new Error("Configuration governance trusted authorization/qualification validators are not configured"); return configured; }
export const listConfigurationDrafts = (...args: Parameters<ReturnType<typeof createConfigurationGovernance>["listConfigurationDrafts"]>) => service().listConfigurationDrafts(...args);
export const proposeConfigurationVersion = (...args: Parameters<ReturnType<typeof createConfigurationGovernance>["proposeConfigurationVersion"]>) => service().proposeConfigurationVersion(...args);
export const getConfigurationDiff = (...args: Parameters<ReturnType<typeof createConfigurationGovernance>["getConfigurationDiff"]>) => service().getConfigurationDiff(...args);
export const reviewConfigurationVersion = (...args: Parameters<ReturnType<typeof createConfigurationGovernance>["reviewConfigurationVersion"]>) => service().reviewConfigurationVersion(...args);
export const activateConfigurationVersion = (...args: Parameters<ReturnType<typeof createConfigurationGovernance>["activateConfigurationVersion"]>) => service().activateConfigurationVersion(...args);
export const retireConfigurationVersion = (...args: Parameters<ReturnType<typeof createConfigurationGovernance>["retireConfigurationVersion"]>) => service().retireConfigurationVersion(...args);
export const pinAuditPolicyBaseline = (...args: Parameters<ReturnType<typeof createConfigurationGovernance>["pinAuditPolicyBaseline"]>) => service().pinAuditPolicyBaseline(...args);
