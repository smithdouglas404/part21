import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";

export type ConfigurationKind = "policy" | "ontology" | "skill" | "persona" | "agent_route" | "connector" | "regulatory_source" | "skill_candidate" | "regulatory_source_candidate" | "clock_policy" | "audit_profile" | "regulatory_baseline" | "authorization_policy";
export type ControlledConfiguration = { kind: ConfigurationKind; configId: string; version: string; payload: unknown; sourceSha256: string; status: "active" | "draft" | "retired"; approvedBy?: string | null; approvedAt?: string | null; updatedAt?: string };
let pool: Pool | null = null;
let initialized = false;
function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; controlled configuration fallback is disabled.");
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });
  return pool;
}
export function canonicalConfiguration(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalConfiguration).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalConfiguration((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function decode<T = unknown>(row: any): ControlledConfiguration & { payload: T } {
  return { kind: row.kind, configId: row.config_id, version: row.version, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload, sourceSha256: row.source_sha256, status: row.status, approvedBy: row.approved_by, approvedAt: row.approved_at, updatedAt: row.updated_at };
}
export async function ensureConfigurationStore() {
  if (initialized) return;
  await getPool().query(`CREATE TABLE IF NOT EXISTS part21_controlled_configuration (
    kind VARCHAR(60) NOT NULL, config_id VARCHAR(180) NOT NULL, version VARCHAR(120) NOT NULL,
    payload JSON NOT NULL, source_sha256 VARCHAR(64) NOT NULL,
    status ENUM('active','draft','retired') NOT NULL DEFAULT 'draft', approved_by VARCHAR(180) NULL,
    approved_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, config_id, version), INDEX idx_configuration_active (kind, config_id, status)
  )`);
  initialized = true;
}
/** Immutable insertion only. Activation/retirement is an authenticated, reviewed governance transaction. */
export async function upsertControlledConfiguration(input: Omit<ControlledConfiguration, "sourceSha256"> & { sourceSha256?: string }) {
  if (!input.kind || !input.configId || !input.version) throw new Error("Configuration kind, ID and explicit revision are required.");
  await ensureConfigurationStore();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<any[]>("SELECT * FROM part21_controlled_configuration WHERE kind=? AND config_id=? AND version=? FOR UPDATE", [input.kind, input.configId, input.version]);
    if (rows.length) {
      const existing = decode(rows[0]);
      if (canonicalConfiguration(existing.payload) !== canonicalConfiguration(input.payload)) throw new Error("Configuration revision is immutable. Create a new version and submit a reviewed diff.");
      if (input.status !== existing.status || (input.approvedBy && input.approvedBy !== existing.approvedBy)) throw new Error("Configuration status or approval cannot be changed by an upsert. Use reviewed governance.");
      await connection.commit();
      return existing;
    }
    if (input.status !== "draft" || input.approvedBy || input.approvedAt) throw new Error("New configuration must be an unapproved draft. Qualified review and activation are separate actions.");
    const serialized = canonicalConfiguration(input.payload);
    const sourceSha256 = input.sourceSha256 ?? crypto.createHash("sha256").update(serialized).digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(sourceSha256)) throw new Error("A valid source SHA-256 is required.");
    await connection.query("INSERT INTO part21_controlled_configuration (kind,config_id,version,payload,source_sha256,status,approved_by,approved_at) VALUES (?,?,?,?,?,'draft',NULL,NULL)", [input.kind, input.configId, input.version, serialized, sourceSha256]);
    await connection.commit();
    return { ...input, sourceSha256, status: "draft" as const, approvedBy: null, approvedAt: null };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
export async function getControlledConfiguration<T = unknown>(kind: ConfigurationKind, configId: string, version?: string): Promise<ControlledConfiguration & { payload: T }> {
  await ensureConfigurationStore();
  const [rows] = await getPool().query<any[]>(version ? "SELECT * FROM part21_controlled_configuration WHERE kind=? AND config_id=? AND version=?" : "SELECT * FROM part21_controlled_configuration WHERE kind=? AND config_id=? AND status='active'", version ? [kind, configId, version] : [kind, configId]);
  if (!rows.length) throw new Error(`Controlled configuration is not available: ${kind}/${configId}${version ? `/${version}` : ""}`);
  if (rows.length !== 1) throw new Error(`Ambiguous active configuration revisions: ${kind}/${configId}. A reviewed single active revision is required.`);
  return decode<T>(rows[0]);
}
export async function listControlledConfigurations(kind?: ConfigurationKind) {
  await ensureConfigurationStore();
  const [rows] = await getPool().query<any[]>(kind ? "SELECT kind,config_id AS configId,version,source_sha256 AS sourceSha256,status,approved_by AS approvedBy,approved_at AS approvedAt,updated_at AS updatedAt FROM part21_controlled_configuration WHERE kind=? ORDER BY config_id,version" : "SELECT kind,config_id AS configId,version,source_sha256 AS sourceSha256,status,approved_by AS approvedBy,approved_at AS approvedAt,updated_at AS updatedAt FROM part21_controlled_configuration ORDER BY kind,config_id,version", kind ? [kind] : []);
  return rows;
}
export async function listControlledConfigurationPayloads<T = unknown>(kind: ConfigurationKind) {
  await ensureConfigurationStore();
  const [rows] = await getPool().query<any[]>("SELECT * FROM part21_controlled_configuration WHERE kind=? AND status='active' ORDER BY config_id,version", [kind]);
  const ids = new Set<string>();
  return rows.map(row => {
    if (ids.has(row.config_id)) throw new Error(`Ambiguous active configuration revisions: ${kind}/${row.config_id}`);
    ids.add(row.config_id);
    return decode<T>(row);
  });
}
export async function getConfigurationStoreStatus() {
  await ensureConfigurationStore();
  const [rows] = await getPool().query<any[]>("SELECT kind,status,COUNT(*) AS count FROM part21_controlled_configuration GROUP BY kind,status ORDER BY kind,status");
  return { source: "mysql-database", table: "part21_controlled_configuration", records: rows, runtimeFallback: false, newRevisions: "immutable-drafts-only", activation: "authenticated-reviewed-governance", existingVersionsPreserved: true };
}
