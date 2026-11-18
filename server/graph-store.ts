import { createPool, Pool } from "mysql2/promise";

let pool: Pool | null = null;
let initialized = false;
const graphSchema = [
  { table: "part21_graph_nodes", purpose: "Ontology entities", fields: "id · node_type · label · status · payload · updated_at" },
  { table: "part21_graph_edges", purpose: "Typed relationships", fields: "id · from_id · to_id · relation · label · payload · updated_at" },
  { table: "part21_graph_events", purpose: "Bitemporal event history", fields: "id · entity_id · valid_from · valid_to · recorded_at · recorded_by · operation · payload" },
];

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; graph fallback is disabled.");
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });
  return pool;
}

export async function ensureGraphStore() {
  const db = getPool();
  if (!initialized) {
    await db.query(`CREATE TABLE IF NOT EXISTS part21_graph_nodes (id VARCHAR(180) PRIMARY KEY, node_type VARCHAR(80) NOT NULL, label VARCHAR(255) NOT NULL, subtitle TEXT, status VARCHAR(50), payload JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
    await db.query(`CREATE TABLE IF NOT EXISTS part21_graph_edges (id VARCHAR(220) PRIMARY KEY, from_id VARCHAR(180) NOT NULL, to_id VARCHAR(180) NOT NULL, relation VARCHAR(100) NOT NULL, label VARCHAR(255), payload JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_graph_edges_from (from_id), INDEX idx_graph_edges_to (to_id))`);
    await db.query(`CREATE TABLE IF NOT EXISTS part21_graph_events (id VARCHAR(220) PRIMARY KEY, entity_id VARCHAR(180) NOT NULL, valid_from DATE NOT NULL, valid_to DATE NULL, recorded_at DATETIME NOT NULL, recorded_by VARCHAR(180) NOT NULL, operation VARCHAR(50) NOT NULL, payload JSON NOT NULL, INDEX idx_graph_events_entity (entity_id))`);
    initialized = true;
  }
  return { configured: true, source: "mysql-database", tables: ["part21_graph_nodes", "part21_graph_edges", "part21_graph_events"] };
}

export async function getGraphStoreStatus() {
  const status = await ensureGraphStore();
  const db = getPool();
  const [[nodes], [edges], [events]] = await Promise.all([
    db.query<any[]>("SELECT COUNT(*) AS count FROM part21_graph_nodes"),
    db.query<any[]>("SELECT COUNT(*) AS count FROM part21_graph_edges"),
    db.query<any[]>("SELECT COUNT(*) AS count FROM part21_graph_events"),
  ]);
  return { ...status, insertedNodes: 0, insertedEdges: 0, insertedEvents: 0, databaseCounts: { nodes: Number(nodes[0]?.count ?? 0), edges: Number(edges[0]?.count ?? 0), events: Number(events[0]?.count ?? 0) }, ingestionRequired: true };
}

export async function getGroundedGraphContext(findingId = "FIND-2026-04") {
  const status = await ensureGraphStore();
  const db = getPool();
  await ensureGraphStore();
  const [nodes] = await db.query<any[]>(`SELECT id, node_type AS type, label, subtitle, status, payload FROM part21_graph_nodes ORDER BY id`);
  const [edges] = await db.query<any[]>(`SELECT id, from_id AS \`from\`, to_id AS \`to\`, relation, label, payload FROM part21_graph_edges ORDER BY id`);
  const [events] = await db.query<any[]>(`SELECT entity_id AS entityId, valid_from AS validFrom, valid_to AS validTo, recorded_at AS recordedAt, recorded_by AS recordedBy, operation, payload FROM part21_graph_events ORDER BY valid_from, recorded_at`);
  return { ...status, findingId, schema: graphSchema, nodes: nodes.map((node) => ({ ...node, ...parseJson(node.payload) })), edges: edges.map((edge) => ({ ...edge, ...parseJson(edge.payload) })), temporalEvents: events.map((event) => ({ ...event, payload: parseJson(event.payload) })), sourceIds: nodes.map((node) => node.id) };
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value); } catch { return {}; }
}
