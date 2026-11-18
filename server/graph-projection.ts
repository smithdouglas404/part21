import { createPool, type Pool } from "mysql2/promise";
import { appendAssuranceEvent } from "./event-store";
import { getControlledConfiguration } from "./config-store";

type DomainProjectionRecord = { recordType: string; recordId: string; auditId?: string | null; payload: any };
let pool: Pool | null = null;
let initialized = false;

function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; graph projection fallback is disabled.");
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5 });
  return pool;
}
async function ensureTables() {
  if (initialized) return;
  const connection = db();
  await connection.query(`CREATE TABLE IF NOT EXISTS part21_graph_nodes (id VARCHAR(180) PRIMARY KEY, node_type VARCHAR(80) NOT NULL, label VARCHAR(255) NOT NULL, subtitle TEXT, status VARCHAR(50), payload JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  await connection.query(`CREATE TABLE IF NOT EXISTS part21_graph_edges (id VARCHAR(220) PRIMARY KEY, from_id VARCHAR(180) NOT NULL, to_id VARCHAR(180) NOT NULL, relation VARCHAR(100) NOT NULL, label VARCHAR(255), payload JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_graph_edges_from (from_id), INDEX idx_graph_edges_to (to_id))`);
  await connection.query(`CREATE TABLE IF NOT EXISTS part21_graph_events (id VARCHAR(220) PRIMARY KEY, entity_id VARCHAR(180) NOT NULL, valid_from DATE NOT NULL, valid_to DATE NULL, recorded_at DATETIME NOT NULL, recorded_by VARCHAR(180) NOT NULL, operation VARCHAR(50) NOT NULL, payload JSON NOT NULL, INDEX idx_graph_events_entity (entity_id))`);
  initialized = true;
}
function nodeId(record: DomainProjectionRecord) {
  if (record.recordType === "finding") return record.recordId.replace(/^F-/i, "find-").toLowerCase();
  if (record.recordType === "audit") return `audit-${record.recordId.toLowerCase()}`;
  return String(record.payload?.id ?? record.recordId).toLowerCase();
}
function graphType(recordType: string) {
  const map: Record<string, string> = { audit: "audit", finding: "finding", evidence: "evidence", product: "product", supplier: "supplier", change: "change", control: "control", source: "evidence" };
  return map[recordType];
}
function asJson(value: unknown) { return JSON.stringify(value ?? {}); }
function tokens(value: unknown) { return String(value ?? "").split(/[·,;]/).map((item) => item.trim()).filter(Boolean); }

async function activeRelations() {
  const ontology = (await getControlledConfiguration<any>("ontology", "part21-assurance-ontology")).payload;
  return new Map<string, any>(ontology.relations.map((relation: any) => [relation.id, relation]));
}
async function insertEdge(fromId: string, toId: string, relationId: string, label: string, source: DomainProjectionRecord, relations: Map<string, any>, added: string[]) {
  const relation = relations.get(relationId);
  if (!relation) throw new Error(`Graph projection relation ${relationId} is not active in the controlled ontology.`);
  const id = `${fromId}-${toId}-${relationId}`;
  await db().query(`INSERT INTO part21_graph_edges (id,from_id,to_id,relation,label,payload) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE relation=VALUES(relation), label=VALUES(label), payload=VALUES(payload)`, [id, fromId, toId, relationId, label, asJson({ from: fromId, to: toId, relation: relationId, label, sourceRecordType: source.recordType, sourceRecordId: source.recordId, sourceAuditId: source.auditId ?? null })]);
  added.push(id);
}
async function ensureAuditNode(auditId: string, relations: Map<string, any>) {
  const auditNode = `audit-${auditId.toLowerCase()}`;
  const [rows] = await db().query<any[]>("SELECT payload FROM part21_domain_records WHERE record_type='audit' AND record_id=? LIMIT 1", [auditId]);
  if (!rows[0]) return null;
  const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
  await db().query(`INSERT INTO part21_graph_nodes (id,node_type,label,subtitle,status,payload) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label), subtitle=VALUES(subtitle), status=VALUES(status), payload=VALUES(payload)`, [auditNode, "audit", auditId, "Audit / review", payload.status ?? "Active", asJson({ ...payload, id: auditNode, sourceRecordType: "audit", sourceRecordId: auditId, source: "part21_domain_records" })]);
  return auditNode;
}

export async function projectDomainRecordToGraph(record: DomainProjectionRecord, actor = "approved-report-graph-promotion") {
  await ensureTables();
  const type = graphType(record.recordType);
  if (!type) return { projected: false, reason: `record type ${record.recordType} is not graph-mapped` };
  const relations = await activeRelations();
  const id = nodeId(record);
  const payload = { ...(record.payload ?? {}), id, sourceRecordType: record.recordType, sourceRecordId: record.recordId, sourceAuditId: record.auditId ?? null, source: "part21_domain_records" };
  await db().query(`INSERT INTO part21_graph_nodes (id,node_type,label,subtitle,status,payload) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label), subtitle=VALUES(subtitle), status=VALUES(status), payload=VALUES(payload)`, [id, type, record.payload?.label ?? record.recordId, record.payload?.meta ?? record.payload?.title ?? type, record.payload?.status ?? "Active", asJson(payload)]);
  const addedEdges: string[] = [];
  if (record.auditId) {
    const auditNode = await ensureAuditNode(record.auditId, relations);
    if (auditNode && record.recordType === "finding") await insertEdge(auditNode, id, "identifiedBy", "identified", record, relations, addedEdges);
  }
  if (record.recordType === "evidence") {
    for (const token of tokens(record.payload?.linkedTo)) {
      const [rows] = await db().query<any[]>("SELECT id,node_type,label,payload FROM part21_graph_nodes WHERE id=? OR label=? LIMIT 1", [token.toLowerCase(), token]);
      const target = rows[0];
      if (!target) continue;
      const targetType = String(target.node_type).toLowerCase();
      if (targetType === "product") await insertEdge(target.id, id, "evidencedBy", "evidenced by", record, relations, addedEdges);
      if (targetType === "finding") await insertEdge(target.id, id, "supportedBy", "supported by", record, relations, addedEdges);
      if (targetType === "change") await insertEdge(target.id, id, "impacts", "impacted", record, relations, addedEdges);
    }
  }
  const now = new Date();
  const eventId = `${id}-${now.getTime()}-domain-upserted`;
  await db().query(`INSERT IGNORE INTO part21_graph_events (id,entity_id,valid_from,valid_to,recorded_at,recorded_by,operation,payload) VALUES (?,?,?,?,?,?,?,?)`, [eventId, id, now.toISOString().slice(0, 10), null, now, actor, "approved-report-graph-promotion", asJson({ sourceTable: "part21_domain_records", sourceRecordType: record.recordType, sourceRecordId: record.recordId, auditId: record.auditId ?? null, graphNodeId: id, graphEdgesAdded: addedEdges, approvalRequired: true })]);
  await appendAssuranceEvent({ type: "graph_projection_completed", actor, auditId: record.auditId ?? undefined, entityId: id, payload: { sourceRecordType: record.recordType, sourceRecordId: record.recordId, graphNodeId: id, graphEdgesAdded: addedEdges, graphEventId: eventId, source: "mysql-database", promotion: "approved-report-only" } });
  return { projected: true, sourceRecordId: record.recordId, graphNodeId: id, graphEdgesAdded: addedEdges, graphEventId: eventId, source: "mysql-database" };
}

export async function promoteApprovedAuditToGraph(auditId: string, actor: string) {
  await ensureTables();
  const [rows] = await db().query<any[]>("SELECT record_type AS recordType, record_id AS recordId, audit_id AS auditId, payload FROM part21_domain_records WHERE audit_id=? AND record_type IN ('finding','evidence','product','supplier','change','control','source') ORDER BY record_type, record_id", [auditId]);
  const [audits] = await db().query<any[]>("SELECT record_id AS recordId, payload FROM part21_domain_records WHERE record_type='audit' AND record_id=? LIMIT 1", [auditId]);
  if (!audits[0]) throw new Error(`Audit ${auditId} was not found in the database.`);
  const auditPayload = typeof audits[0].payload === "string" ? JSON.parse(audits[0].payload) : audits[0].payload;
  const records = [{ recordType: "audit", recordId: auditId, auditId, payload: auditPayload }, ...rows.map((row) => ({ ...row, payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload }))];
  const results = [];
  for (const record of records) results.push(await projectDomainRecordToGraph(record, actor));
  return { auditId, actor, status: "promoted_after_qualified_report_approval", recordsProjected: results.length, results };
}

export async function recordFinalizedGraphSnapshot(input: { auditId: string; reportId: string; snapshotHash: string; actor: string }) {
  await ensureTables();
  const auditNodeId = `audit-${input.auditId.toLowerCase()}`;
  const eventId = `${auditNodeId}-${Date.now()}-report-finalized`;
  await db().query(`INSERT INTO part21_graph_events (id,entity_id,valid_from,valid_to,recorded_at,recorded_by,operation,payload) VALUES (?,?,?,?,?,?,?,?)`, [eventId, auditNodeId, new Date().toISOString().slice(0, 10), null, new Date(), input.actor, "report-finalized", asJson({ auditId: input.auditId, reportId: input.reportId, snapshotHash: input.snapshotHash, source: "mysql-database", immutableSnapshot: true })]);
  return { eventId, auditId: input.auditId, reportId: input.reportId, snapshotHash: input.snapshotHash, operation: "report-finalized" };
}
