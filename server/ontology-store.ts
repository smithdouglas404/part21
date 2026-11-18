import type { ControlledConfiguration } from "./config-store";
import { getStoreDatabase, parseStorePayload, requireStoreId, storeTimestamp, type StoreSqlExecutor } from "./domain-store";

export type OntologyDefinition = {
  id?: string; version?: string; temporalModel?: string;
  classes: { id: string; properties?: { name: string; type: string; required?: boolean }[] }[];
  relations: { id: string; from: string; to: string; temporal?: boolean }[];
};
export type ControlledOntology = ControlledConfiguration & { payload: OntologyDefinition };
export type OntologyNodeInput = { id: string; type: string; payload: Record<string, unknown> };
export type OntologyEdgeInput = { id: string; from: string; to: string; relation: string };
export class OntologyValidationError extends Error { readonly code = "ONTOLOGY_VALIDATION_FAILED"; }

export function validateOntologyDefinition(definition: OntologyDefinition) {
  if (!Array.isArray(definition.classes) || !Array.isArray(definition.relations) || !definition.classes.length) throw new OntologyValidationError("Ontology classes/relations are missing.");
  const classes = new Set<string>();
  for (const item of definition.classes) {
    requireStoreId(item.id, "ontology class ID");
    const key = item.id.toLowerCase();
    if (classes.has(key)) throw new OntologyValidationError(`Duplicate ontology class ${item.id}.`);
    classes.add(key);
  }
  const relations = new Set<string>();
  for (const item of definition.relations) {
    requireStoreId(item.id, "ontology relation ID");
    if (relations.has(item.id)) throw new OntologyValidationError(`Duplicate ontology relation ${item.id}.`);
    if (!classes.has(String(item.from).toLowerCase()) || !classes.has(String(item.to).toLowerCase())) throw new OntologyValidationError(`Unknown endpoint class in relation ${item.id}.`);
    relations.add(item.id);
  }
}
export function validateOntologyNode(ontology: ControlledOntology, node: OntologyNodeInput, checkRequiredProperties = false) {
  const definition = ontology.payload.classes.find((item) => item.id.toLowerCase() === node.type.toLowerCase());
  if (!definition) throw new OntologyValidationError(`Unknown ontology class ${node.type} for node ${node.id}.`);
  if (checkRequiredProperties) for (const property of definition.properties ?? []) {
    const value = node.payload[property.name];
    if (property.required && (value === undefined || value === null || value === "")) throw new OntologyValidationError(`Node ${node.id} requires ${property.name}.`);
    if (value != null && ["number", "boolean", "string"].includes(property.type) && typeof value !== property.type) throw new OntologyValidationError(`Node ${node.id} has invalid ${property.name} type.`);
  }
}
export function validateOntologyEdge(ontology: ControlledOntology, edge: OntologyEdgeInput, nodes: ReadonlyMap<string, OntologyNodeInput>) {
  const relation = ontology.payload.relations.find((item) => item.id === edge.relation);
  if (!relation) throw new OntologyValidationError(`Unknown ontology relation ${edge.relation} for edge ${edge.id}.`);
  const from = nodes.get(edge.from), to = nodes.get(edge.to);
  if (!from || !to) throw new OntologyValidationError(`Edge ${edge.id} has missing or out-of-scope endpoints.`);
  if (from.type.toLowerCase() !== relation.from.toLowerCase() || to.type.toLowerCase() !== relation.to.toLowerCase()) throw new OntologyValidationError(`Edge ${edge.id} violates relation ${edge.relation} endpoint classes.`);
}
export function ontologyManifest(ontology: ControlledOntology) {
  return { kind: ontology.kind, configId: ontology.configId, version: ontology.version, sourceSha256: ontology.sourceSha256, status: ontology.status, approvedBy: ontology.approvedBy ?? null, approvedAt: ontology.approvedAt ?? null, updatedAt: ontology.updatedAt ?? null };
}

export function createOntologyRegistry(dependencies: { sql: () => StoreSqlExecutor }) {
  async function getControlledOntology(configId = "part21-assurance-ontology", version?: string): Promise<ControlledOntology> {
    requireStoreId(configId, "ontology configId");
    if (version !== undefined) requireStoreId(version, "ontology version");
    // Read the complete exact envelope. No schema creation or latest-version fallback.
    const [rows] = await dependencies.sql().query(version
      ? "SELECT * FROM part21_controlled_configuration WHERE kind='ontology' AND config_id=? AND version=?"
      : "SELECT * FROM part21_controlled_configuration WHERE kind='ontology' AND config_id=? AND status='active'", version ? [configId, version] : [configId]);
    if (rows.length !== 1) throw new OntologyValidationError(rows.length ? `Ambiguous active ontology ${configId}; pin a governed revision.` : `Ontology ${configId}${version ? `/${version}` : ""} is unavailable.`);
    const row = rows[0];
    if (row.status !== "active" || !row.approved_by || !row.approved_at) throw new OntologyValidationError("Runtime ontology requires an active, persisted human-approved configuration revision.");
    if (!row.version || !/^[a-f0-9]{64}$/i.test(row.source_sha256)) throw new OntologyValidationError("Ontology configuration version or source digest is missing.");
    const payload = parseStorePayload(row.payload) as OntologyDefinition;
    validateOntologyDefinition(payload);
    return { kind: "ontology", configId: row.config_id, version: row.version, payload, sourceSha256: row.source_sha256, status: row.status, approvedBy: row.approved_by, approvedAt: storeTimestamp(row.approved_at), updatedAt: row.updated_at == null ? undefined : storeTimestamp(row.updated_at) };
  }
  return { getControlledOntology };
}
const registry = createOntologyRegistry({ sql: getStoreDatabase });
export const getControlledOntology = registry.getControlledOntology;

/** Compatibility status endpoint: MySQL is authoritative; PostgreSQL is not a second graph. */
export async function ontologyStorageStatus() {
  if (!process.env.DATABASE_URL) return { mode: "not-configured", configured: false, provider: "MySQL", requiredEnv: "DATABASE_URL", schema: "part21-assurance-ontology", reason: "Authoritative ontology and graph persistence is not configured; no fallback adapter is selected." };
  try {
    const ontology = await getControlledOntology(process.env.PART21_ONTOLOGY_CONFIG_ID ?? "part21-assurance-ontology");
    const [clock] = await getStoreDatabase().query("SELECT UTC_TIMESTAMP(3) AS now");
    return { mode: "mysql-database", configured: true, provider: "MySQL", schema: ontology.configId, serverTime: storeTimestamp(clock[0]?.now), ontologyVersion: ontology.version, ontologySourceSha256: ontology.sourceSha256, authoritativeTables: ["part21_controlled_configuration", "part21_graph_nodes", "part21_graph_edges", "part21_graph_events"], legacyPostgresConfigured: Boolean(process.env.POSTGRES_URL) };
  } catch (error) { return { mode: "mysql-unavailable", configured: true, provider: "MySQL", schema: "part21-assurance-ontology", reason: error instanceof Error ? error.message : "Ontology unavailable" }; }
}
/** Legacy sync wrapper now verifies the registry only; it never creates or seeds tables. */
export async function syncOntologySnapshot() {
  const ontology = await getControlledOntology(process.env.PART21_ONTOLOGY_CONFIG_ID ?? "part21-assurance-ontology");
  return { ...(await ontologyStorageStatus()), ontologyVersion: ontology.version, ontologyConfiguration: ontologyManifest(ontology), insertedEntities: 0, insertedTemporalEvents: 0, synchronized: false, note: "Registry verified only. Ingestion requires source records and qualified human approval; no operational snapshot or fixture synchronization occurred." };
}
