import { Pool } from "pg";
import { getControlledConfiguration } from "./config-store";

const connectionString = process.env.POSTGRES_URL;
const pool = connectionString ? new Pool({ connectionString, max: 5 }) : null;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS ontology_entities (id TEXT PRIMARY KEY, ontology_class TEXT NOT NULL, source_id TEXT NOT NULL, properties JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS ontology_relationships (id BIGSERIAL PRIMARY KEY, from_id TEXT NOT NULL, relation TEXT NOT NULL, to_id TEXT NOT NULL, valid_from DATE NOT NULL, valid_to DATE, recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), source TEXT NOT NULL, UNIQUE(from_id, relation, to_id, valid_from))`,
  `CREATE TABLE IF NOT EXISTS temporal_events (id BIGSERIAL PRIMARY KEY, entity_id TEXT NOT NULL, entity_class TEXT NOT NULL, valid_from DATE NOT NULL, valid_to DATE, recorded_at TIMESTAMPTZ NOT NULL, recorded_by TEXT NOT NULL, operation TEXT NOT NULL, payload JSONB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_decisions (id BIGSERIAL PRIMARY KEY, finding_id TEXT NOT NULL, phase_id TEXT NOT NULL, gate TEXT NOT NULL, approver TEXT NOT NULL, decision TEXT NOT NULL, rationale TEXT NOT NULL, decided_at TIMESTAMPTZ NOT NULL)`,
];

export async function ontologyStorageStatus() {
  if (!pool) {
    return { mode: "not-configured", configured: false, provider: "PostgreSQL", requiredEnv: "POSTGRES_URL", schema: "part21-assurance-ontology", reason: "PostgreSQL ontology persistence is not configured; no ontology data is available from this adapter." };
  }
  try {
    const result = await pool.query<{ now: string }>("SELECT NOW() AS now");
    return { mode: "postgresql", configured: true, provider: "PostgreSQL", schema: "part21-assurance-ontology", serverTime: result.rows[0]?.now };
  } catch (error) {
    return { mode: "postgresql-unavailable", configured: true, provider: "PostgreSQL", schema: "part21-assurance-ontology", reason: error instanceof Error ? error.message : "Connection failed" };
  }
}

export async function syncOntologySnapshot() {
  if (!pool) throw new Error("POSTGRES_URL is required; ontology synchronization cannot use fixture data.");
  for (const statement of schemaStatements) await pool.query(statement);
  const ontology = (await getControlledConfiguration<any>("ontology", "part21-assurance-ontology")).payload;
  return { ...(await ontologyStorageStatus()), ontologyVersion: ontology.version, insertedEntities: 0, insertedTemporalEvents: 0, note: "Ontology records must be ingested from configured client systems; no fixture synchronization is performed." };
}
