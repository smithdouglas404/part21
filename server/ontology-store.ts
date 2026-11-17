import { Pool } from "pg";
import { ontologyMappings, part21Ontology, temporalRecords } from "../shared/ontology";

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
    return { mode: "synthetic-fallback", configured: false, provider: "PostgreSQL", requiredEnv: "POSTGRES_URL", schema: "part21-assurance-ontology", reason: "No PostgreSQL connection configured; reads use deterministic shared demo data." };
  }
  try {
    const result = await pool.query<{ now: string }>("SELECT NOW() AS now");
    return { mode: "postgresql", configured: true, provider: "PostgreSQL", schema: "part21-assurance-ontology", serverTime: result.rows[0]?.now };
  } catch (error) {
    return { mode: "postgresql-unavailable", configured: true, provider: "PostgreSQL", schema: "part21-assurance-ontology", reason: error instanceof Error ? error.message : "Connection failed" };
  }
}

export async function syncOntologySnapshot() {
  if (!pool) return { ...(await ontologyStorageStatus()), insertedEntities: 0, insertedTemporalEvents: 0 };
  for (const statement of schemaStatements) await pool.query(statement);
  for (const mapping of ontologyMappings) {
    await pool.query(`INSERT INTO ontology_entities (id, ontology_class, source_id, properties) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (id) DO UPDATE SET ontology_class = EXCLUDED.ontology_class, source_id = EXCLUDED.source_id, properties = EXCLUDED.properties, updated_at = NOW()`, [mapping.id, mapping.class, mapping.source, JSON.stringify(mapping.properties)]);
  }
  for (const record of temporalRecords) {
    await pool.query(`INSERT INTO temporal_events (entity_id, entity_class, valid_from, valid_to, recorded_at, recorded_by, operation, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [record.entityId, record.entityClass, record.validFrom, record.validTo ?? null, record.recordedAt, record.recordedBy, record.operation, JSON.stringify(record.payload)]);
  }
  return { ...(await ontologyStorageStatus()), ontologyVersion: part21Ontology.version, insertedEntities: ontologyMappings.length, insertedTemporalEvents: temporalRecords.length };
}
