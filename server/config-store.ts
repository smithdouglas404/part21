import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";

export type ConfigurationKind = "policy" | "ontology" | "skill" | "persona" | "agent_route" | "connector" | "regulatory_source" | "skill_candidate" | "regulatory_source_candidate";
export type ControlledConfiguration = { kind: ConfigurationKind; configId: string; version: string; payload: unknown; sourceSha256: string; status: "active" | "draft" | "retired"; approvedBy?: string | null; approvedAt?: string | null; updatedAt?: string };

let pool: Pool | null = null;
let initialized = false;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; controlled configuration fallback is disabled.");
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });
  return pool;
}

export async function ensureConfigurationStore() {
  if (initialized) return;
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS part21_controlled_configuration (
    kind VARCHAR(60) NOT NULL,
    config_id VARCHAR(180) NOT NULL,
    version VARCHAR(120) NOT NULL,
    payload JSON NOT NULL,
    source_sha256 VARCHAR(64) NOT NULL,
    status ENUM('active','draft','retired') NOT NULL DEFAULT 'draft',
    approved_by VARCHAR(180) NULL,
    approved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, config_id, version),
    INDEX idx_configuration_active (kind, config_id, status)
  )`);
  initialized = true;
}

export async function upsertControlledConfiguration(input: Omit<ControlledConfiguration, "sourceSha256"> & { sourceSha256?: string }) {
  await ensureConfigurationStore();
  const db = getPool();
  const serialized = JSON.stringify(input.payload);
  const sourceSha256 = input.sourceSha256 ?? crypto.createHash("sha256").update(serialized).digest("hex");
  await db.query(`INSERT INTO part21_controlled_configuration (kind, config_id, version, payload, source_sha256, status, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE payload=VALUES(payload), source_sha256=VALUES(source_sha256), status=VALUES(status), approved_by=VALUES(approved_by), approved_at=VALUES(approved_at), updated_at=CURRENT_TIMESTAMP`, [input.kind, input.configId, input.version, serialized, sourceSha256, input.status, input.approvedBy ?? null, input.approvedAt ?? null]);
  return { ...input, sourceSha256 };
}

export async function getControlledConfiguration<T = unknown>(kind: ConfigurationKind, configId: string, version?: string): Promise<ControlledConfiguration & { payload: T }> {
  await ensureConfigurationStore();
  const db = getPool();
  const [rows] = await db.query<any[]>(version ? "SELECT * FROM part21_controlled_configuration WHERE kind=? AND config_id=? AND version=? LIMIT 1" : "SELECT * FROM part21_controlled_configuration WHERE kind=? AND config_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1", version ? [kind, configId, version] : [kind, configId]);
  const row = rows[0];
  if (!row) throw new Error(`Controlled configuration is not available: ${kind}/${configId}${version ? `/${version}` : ""}`);
  return { kind: row.kind, configId: row.config_id, version: row.version, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload, sourceSha256: row.source_sha256, status: row.status, approvedBy: row.approved_by, approvedAt: row.approved_at, updatedAt: row.updated_at };
}

export async function listControlledConfigurations(kind?: ConfigurationKind) {
  await ensureConfigurationStore();
  const db = getPool();
  const [rows] = await db.query<any[]>(kind ? "SELECT kind, config_id AS configId, version, source_sha256 AS sourceSha256, status, approved_by AS approvedBy, approved_at AS approvedAt, updated_at AS updatedAt FROM part21_controlled_configuration WHERE kind=? ORDER BY kind, config_id, version DESC" : "SELECT kind, config_id AS configId, version, source_sha256 AS sourceSha256, status, approved_by AS approvedBy, approved_at AS approvedAt, updated_at AS updatedAt FROM part21_controlled_configuration ORDER BY kind, config_id, version DESC", kind ? [kind] : []);
  return rows;
}

export async function listControlledConfigurationPayloads<T = unknown>(kind: ConfigurationKind) {
  await ensureConfigurationStore();
  const db = getPool();
  const [rows] = await db.query<any[]>("SELECT * FROM part21_controlled_configuration WHERE kind=? AND status='active' ORDER BY config_id, updated_at DESC", [kind]);
  return rows.map((row) => ({ kind: row.kind as ConfigurationKind, configId: row.config_id, version: row.version, payload: (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as T, sourceSha256: row.source_sha256, status: row.status as ControlledConfiguration["status"] }));
}

export async function getConfigurationStoreStatus() {
  await ensureConfigurationStore();
  const db = getPool();
  const [rows] = await db.query<any[]>("SELECT kind, status, COUNT(*) AS count FROM part21_controlled_configuration GROUP BY kind, status ORDER BY kind, status");
  return { source: "mysql-database", table: "part21_controlled_configuration", records: rows, runtimeFallback: false, migrationSourceOnly: ["policy", "ontology", "skill", "persona", "agent_route", "connector", "regulatory_source"] };
}
