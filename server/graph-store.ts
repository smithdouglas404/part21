import crypto from "node:crypto";
import { createDomainStore, DomainScopeError, getStoreDatabase, parseStorePayload, requireStoreId, storeTimestamp, type StoreSqlDatabase, type StoreSqlExecutor } from "./domain-store";
import { createOntologyRegistry, ontologyManifest, validateOntologyEdge, validateOntologyNode, type ControlledOntology } from "./ontology-store";

export type GraphQueryOptions = { effectiveAt?: string; asOf?: string; ontologyConfigId?: string; ontologyVersion?: string };
export type GraphNode = { id: string; type: string; label: string; subtitle?: string; status?: string; sourceRecordId: string; sourceRecordType: string; payload: Record<string, unknown>; [key: string]: unknown };
export type GraphEdge = { id: string; from: string; to: string; relation: string; label?: string; sourceRecordId: string; sourceRecordType: string; payload: Record<string, unknown>; [key: string]: unknown };
export type GraphTemporalEvent = { id: string; entityId: string; validFrom: string; validTo: string | null; recordedAt: string; recordedBy: string; operation: string; payload: Record<string, unknown> };
const graphSchema = [
  { table: "part21_graph_nodes", purpose: "Current approved ontology entities", fields: "id · node_type · label · status · payload · updated_at" },
  { table: "part21_graph_edges", purpose: "Current approved relationships", fields: "id · from_id · to_id · relation · payload · updated_at" },
  { table: "part21_graph_events", purpose: "Bitemporal event history", fields: "id · entity_id · valid_from · valid_to · recorded_at · recorded_by · operation · payload" },
  { table: "part21_graph_revisions", purpose: "Append-only approved node/edge snapshots", fields: "entity_kind · entity_id · audit_id · revision · valid_from · valid_to · recorded_at · snapshot · snapshot_sha256 · approval_record_id" },
];

/** Explicit deployment migration only; existing graph schemas and events are preserved. */
export const graphStoreMigrationStatements = [
  `CREATE TABLE IF NOT EXISTS part21_graph_nodes (id VARCHAR(180) PRIMARY KEY, node_type VARCHAR(80) NOT NULL, label VARCHAR(255) NOT NULL, subtitle TEXT, status VARCHAR(50), payload JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS part21_graph_edges (id VARCHAR(220) PRIMARY KEY, from_id VARCHAR(180) NOT NULL, to_id VARCHAR(180) NOT NULL, relation VARCHAR(100) NOT NULL, label VARCHAR(255), payload JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_graph_edges_from (from_id), INDEX idx_graph_edges_to (to_id))`,
  `CREATE TABLE IF NOT EXISTS part21_graph_events (id VARCHAR(220) PRIMARY KEY, entity_id VARCHAR(180) NOT NULL, valid_from DATE NOT NULL, valid_to DATE NULL, recorded_at DATETIME NOT NULL, recorded_by VARCHAR(180) NOT NULL, operation VARCHAR(50) NOT NULL, payload JSON NOT NULL, INDEX idx_graph_events_entity (entity_id))`,
  `CREATE TABLE IF NOT EXISTS part21_graph_revisions (entity_kind VARCHAR(10) NOT NULL, entity_id VARCHAR(220) NOT NULL, audit_id VARCHAR(180) NOT NULL, revision BIGINT UNSIGNED NOT NULL, valid_from DATETIME(3) NULL, valid_to DATETIME(3) NULL, recorded_at DATETIME(3) NOT NULL, recorded_by VARCHAR(255) NULL, snapshot JSON NOT NULL, snapshot_sha256 CHAR(64) NOT NULL, source_record_type VARCHAR(80) NOT NULL, source_record_id VARCHAR(180) NOT NULL, source_sha256 CHAR(64) NULL, ontology_config_id VARCHAR(180) NULL, ontology_version VARCHAR(120) NULL, ontology_sha256 CHAR(64) NULL, approval_record_type VARCHAR(80) NULL, approval_record_id VARCHAR(180) NULL, provenance VARCHAR(40) NOT NULL, PRIMARY KEY(entity_kind,entity_id,audit_id,revision), INDEX idx_graph_revision_scope_time(audit_id,recorded_at,valid_from))`,
] as const;
export async function migrateGraphStore(sql: StoreSqlExecutor) {
  for (const statement of graphStoreMigrationStatements) await sql.query(statement);
  return { source: "mysql-database", statementsApplied: graphStoreMigrationStatements.length };
}
export function graphRecordHasAuditScope(payload: Record<string, unknown>, auditId: string, type?: string): boolean {
  const explicit = [payload.sourceAuditId, payload.auditId].filter((value) => value != null);
  if (explicit.some((value) => value !== auditId)) return false;
  if (Array.isArray(payload.auditIds) && !payload.auditIds.includes(auditId)) return false;
  if (explicit.length) return true;
  if (Array.isArray(payload.auditIds)) return payload.auditIds.includes(auditId);
  return type?.toLowerCase() === "audit" && payload.sourceRecordType === "audit" && payload.sourceRecordId === auditId;
}
// Audit scope is applied both in SQL and after hydration; shared nodes never authorize global edges.
const scopeClause = `(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.sourceAuditId'))=? OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.auditId'))=? OR JSON_CONTAINS(JSON_EXTRACT(payload,'$.auditIds'),JSON_QUOTE(?)))`;
function scopeValues(auditId: string) { return [auditId, auditId, auditId]; }
function hydrateNode(row: any): GraphNode {
  const payload = parseStorePayload(row.payload);
  requireStoreId(payload.sourceRecordId, `sourceRecordId on node ${row.id}`); requireStoreId(payload.sourceRecordType, `sourceRecordType on node ${row.id}`);
  return { ...payload, id: row.id, type: row.type ?? row.node_type, label: row.label, subtitle: row.subtitle, status: row.status, sourceRecordId: payload.sourceRecordId, sourceRecordType: payload.sourceRecordType, payload };
}
function hydrateEdge(row: any): GraphEdge {
  const payload = parseStorePayload(row.payload);
  requireStoreId(payload.sourceRecordId, `sourceRecordId on edge ${row.id}`); requireStoreId(payload.sourceRecordType, `sourceRecordType on edge ${row.id}`);
  return { ...payload, id: row.id, from: row.from ?? row.from_id, to: row.to ?? row.to_id, relation: row.relation, label: row.label, sourceRecordId: payload.sourceRecordId, sourceRecordType: payload.sourceRecordType, payload };
}
function hydrateEvent(row: any): GraphTemporalEvent {
  const payload = parseStorePayload(row.payload);
  return { id: row.id, entityId: row.entity_id ?? row.entityId, validFrom: storeTimestamp(payload.validFromExact ?? row.valid_from ?? row.validFrom), validTo: payload.validToExact != null ? storeTimestamp(payload.validToExact) : row.valid_to == null && row.validTo == null ? null : storeTimestamp(row.valid_to ?? row.validTo), recordedAt: storeTimestamp(row.recorded_at ?? row.recordedAt), recordedBy: row.recorded_by ?? row.recordedBy, operation: row.operation, payload };
}
function timeIncluded(validFrom: string, validTo: string | null, recordedAt: string, effectiveAt: string, asOf: string) {
  return validFrom <= effectiveAt && (validTo === null || validTo > effectiveAt) && recordedAt <= asOf;
}
function eventReferences(event: GraphTemporalEvent, entityId: string) {
  return event.entityId === entityId || (Array.isArray(event.payload.graphEdgesAdded) && event.payload.graphEdgesAdded.includes(entityId));
}

export function createGraphStore(dependencies: { database: () => StoreSqlDatabase; ontology?: (configId: string, version?: string) => Promise<ControlledOntology> }) {
  const domain = createDomainStore({ database: dependencies.database });
  const registry = createOntologyRegistry({ sql: dependencies.database });
  const loadOntology = dependencies.ontology ?? registry.getControlledOntology;
  async function ensureGraphStore() {
    const db = dependencies.database();
    for (const table of graphSchema.map((item) => item.table)) await db.query(`SELECT * FROM ${table} LIMIT 0`);
    return { configured: true, source: "mysql-database", tables: graphSchema.map((item) => item.table), automaticMigration: false };
  }
  async function getGraphStoreStatus() {
    const status = await ensureGraphStore(), db = dependencies.database();
    const [[nodes], [edges], [events], [revisions]] = await Promise.all([
      db.query("SELECT COUNT(*) AS count FROM part21_graph_nodes"), db.query("SELECT COUNT(*) AS count FROM part21_graph_edges"), db.query("SELECT COUNT(*) AS count FROM part21_graph_events"), db.query("SELECT COUNT(*) AS count FROM part21_graph_revisions"),
    ]);
    return { ...status, insertedNodes: 0, insertedEdges: 0, insertedEvents: 0, databaseCounts: { nodes: Number(nodes[0]?.count ?? 0), edges: Number(edges[0]?.count ?? 0), events: Number(events[0]?.count ?? 0), revisions: Number(revisions[0]?.count ?? 0) }, ingestionRequired: true };
  }
  async function loadGraphProjection(auditId: string, options: GraphQueryOptions, findingId?: string) {
    requireStoreId(auditId, "auditId");
    if (findingId !== undefined) {
      requireStoreId(findingId, "findingId");
      const finding = await domain.getDomainRecordScoped("finding", findingId, auditId);
      if (!finding) throw new DomainScopeError(`Unknown finding ${findingId} in audit ${auditId}; no fallback finding is permitted.`);
    } else await domain.requireAudit(auditId);
    const db = dependencies.database();
    const [clock] = await db.query("SELECT UTC_TIMESTAMP(3) AS now");
    const capturedAt = storeTimestamp(clock[0]?.now);
    const effectiveAt = options.effectiveAt === undefined ? capturedAt : storeTimestamp(options.effectiveAt);
    const asOf = options.asOf === undefined ? capturedAt : storeTimestamp(options.asOf);
    if (asOf > capturedAt) throw new Error("asOf cannot be later than the database clock.");
    const historicalQuery = options.asOf !== undefined || options.effectiveAt !== undefined;
    const ontology = await loadOntology(options.ontologyConfigId ?? process.env.PART21_ONTOLOGY_CONFIG_ID ?? "part21-assurance-ontology", options.ontologyVersion);
    const [edgeRows] = await db.query(`SELECT * FROM part21_graph_edges WHERE ${scopeClause} ORDER BY id`, scopeValues(auditId));
    const endpointIds = [...new Set(edgeRows.filter((row: any) => graphRecordHasAuditScope(parseStorePayload(row.payload), auditId)).flatMap((row: any) => [row.from_id, row.to_id]))];
    const nodeClause = `${scopeClause} OR (LOWER(node_type)='audit' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.sourceRecordId'))=?)${endpointIds.length ? ` OR id IN (${endpointIds.map(() => "?").join(",")})` : ""}`;
    const [nodeRows] = await db.query(`SELECT * FROM part21_graph_nodes WHERE ${nodeClause} ORDER BY id`, [...scopeValues(auditId), auditId, ...endpointIds]);
    const [eventRows] = await db.query(`SELECT id,entity_id,valid_from,valid_to,recorded_at,recorded_by,operation,payload FROM part21_graph_events WHERE ${scopeClause} AND recorded_at<=? ORDER BY valid_from,recorded_at,id`, [...scopeValues(auditId), new Date(asOf)]);
    const [revisionRows] = await db.query("SELECT * FROM part21_graph_revisions WHERE audit_id=? AND recorded_at<=? ORDER BY entity_kind,entity_id,recorded_at DESC,revision DESC", [auditId, new Date(asOf)]);
    const events: GraphTemporalEvent[] = eventRows.map(hydrateEvent).filter((event: GraphTemporalEvent) => graphRecordHasAuditScope(event.payload, auditId) && event.recordedAt <= asOf);
    const temporalUnknowns: { entityId: string; reason: string }[] = [];
    const noteUnknown = (entityId: string, reason: string) => {
      if (!temporalUnknowns.some((item) => item.entityId === entityId && item.reason === reason)) temporalUnknowns.push({ entityId, reason });
    };
    const revisionKeys = new Set<string>();
    const snapshots = new Map<string, any>();
    for (const row of revisionRows) {
      if (row.audit_id !== auditId) continue;
      const key = `${row.entity_kind}/${row.entity_id}`;
      revisionKeys.add(key);
      if (snapshots.has(key)) continue;
      if (row.valid_from == null) { temporalUnknowns.push({ entityId: row.entity_id, reason: "Legacy snapshot has no known effective-time bound." }); continue; }
      if (!timeIncluded(storeTimestamp(row.valid_from), row.valid_to == null ? null : storeTimestamp(row.valid_to), storeTimestamp(row.recorded_at), effectiveAt, asOf)) continue;
      snapshots.set(key, { ...parseStorePayload(row.snapshot), id: row.entity_id });
    }
    const sharedEndpointTypes = new Set(["supplier", "person"]);
    const isSharedEndpointRow = (row: any, kind: "node" | "edge") => kind === "node" && sharedEndpointTypes.has(String(row.node_type ?? row.type).toLowerCase()) && endpointIds.includes(row.id);
    function selectRows(rows: any[], kind: "node" | "edge") {
      const selected = new Map<string, any>();
      for (const row of rows) {
        const payload = parseStorePayload(row.payload);
        const sharedEndpoint = isSharedEndpointRow(row, kind) && !graphRecordHasAuditScope(payload, auditId, row.node_type);
        if (!graphRecordHasAuditScope(payload, auditId, row.node_type) && !sharedEndpoint) continue;
        const key = `${kind}/${row.id}`;
        const hasRevision = revisionKeys.has(key);
        if (snapshots.has(key)) { selected.set(row.id, snapshots.get(key)); continue; }
        // A known revision outside the query interval cannot fall back to the live snapshot.
        if (revisionKeys.has(key)) continue;
        const recordedAt = row.updated_at == null ? null : storeTimestamp(row.updated_at);
        if (recordedAt === null || recordedAt > asOf) { noteUnknown(row.id, recordedAt === null ? "Missing transaction timestamp." : "Current snapshot was recorded after asOf; prior snapshot unavailable."); continue; }
        if (!hasRevision) {
          // updated_at <= asOf proves this current payload had not changed after the as-of instant.
          noteUnknown(row.id, historicalQuery ? "No approved revision history; current snapshot is transaction-time bounded by asOf." : "No approved revision history; current snapshot only.");
        }
        const bounds = events.filter((event) => eventReferences(event, row.id)).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
        const start = payload.validFrom ?? payload.effectiveFrom ?? bounds[0]?.validFrom;
        const end = payload.validTo ?? payload.effectiveTo ?? null;
        if (start == null) {
          noteUnknown(row.id, "Effective-time history unavailable; current snapshot only.");
          if (historicalQuery) continue;
        } else if (!timeIncluded(storeTimestamp(start), end == null ? null : storeTimestamp(end), recordedAt, effectiveAt, asOf)) continue;
        selected.set(row.id, sharedEndpoint ? { ...row, payload: { ...payload, scopeBasis: "audit-scoped-edge-endpoint" } } : row);
      }
      for (const [key, snapshot] of snapshots) if (key.startsWith(`${kind}/`)) selected.set(key.slice(kind.length + 1), snapshot);
      return [...selected.values()].filter((row) => graphRecordHasAuditScope(parseStorePayload(row.payload), auditId, row.node_type ?? row.type) || isSharedEndpointRow(row, kind));
    }
    const nodes = selectRows(nodeRows, "node").map(hydrateNode);
    const roots = nodes.filter((node) => node.type.toLowerCase() === "finding" && node.sourceRecordType === "finding" && node.sourceRecordId === findingId);
    if (findingId !== undefined && roots.length !== 1) throw new DomainScopeError(roots.length ? `Ambiguous graph projection for finding ${findingId} in audit ${auditId}.` : `Finding ${findingId} has no effective persisted graph node in audit ${auditId}; history may be unavailable. Ingest an approved projection; no label or other-audit fallback is permitted.`);
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const edges = selectRows(edgeRows, "edge").map(hydrateEdge).filter((edge) => {
      if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) { temporalUnknowns.push({ entityId: edge.id, reason: "Edge endpoint missing, out of scope, or outside temporal bounds." }); return false; }
      return true;
    });
    const visited = new Set(findingId === undefined ? nodes.map((node) => node.id) : [roots[0].id]);
    const queue = findingId === undefined ? [] : [roots[0].id];
    const adjacency = new Map<string, GraphEdge[]>();
    for (const edge of edges) for (const id of [edge.from, edge.to]) adjacency.set(id, [...(adjacency.get(id) ?? []), edge]);
    for (let cursor = 0; cursor < queue.length; cursor++) for (const edge of adjacency.get(queue[cursor]) ?? []) for (const id of [edge.from, edge.to]) if (!visited.has(id)) { visited.add(id); queue.push(id); }
    const scopedNodes = nodes.filter((node) => visited.has(node.id));
    const scopedEdges = edges.filter((edge) => visited.has(edge.from) && visited.has(edge.to));
    for (const node of scopedNodes) validateOntologyNode(ontology, node);
    for (const edge of scopedEdges) validateOntologyEdge(ontology, edge, nodeMap);
    const edgeIds = new Set(scopedEdges.map((edge) => edge.id));
    const temporalEvents = events.filter((event) => timeIncluded(event.validFrom, event.validTo, event.recordedAt, effectiveAt, asOf) && (visited.has(event.entityId) || edgeIds.has(event.entityId) || scopedEdges.some((edge) => eventReferences(event, edge.id))));
    const sourceIds = [...new Set([...scopedNodes.map((node) => node.sourceRecordId), ...scopedEdges.map((edge) => edge.sourceRecordId), ...temporalEvents.map((event) => event.payload.sourceRecordId).filter((id): id is string => typeof id === "string")])];
    return {
      configured: true, source: "mysql-database", auditId, findingId: findingId ?? null, graphFindingId: roots[0]?.id ?? null, schema: graphSchema,
      ontologyVersion: ontology.version, ontologySourceSha256: ontology.sourceSha256, ontologyConfiguration: ontologyManifest(ontology),
      nodes: scopedNodes, edges: scopedEdges, temporalEvents, sourceIds, nodeCount: scopedNodes.length, edgeCount: scopedEdges.length, temporalEventCount: temporalEvents.length,
      capturedAt, effectiveAt, asOf, temporalUnknowns, historyComplete: temporalUnknowns.length === 0,
      traversalProof: { query: { findingId: findingId ?? null, auditId, effectiveAt, asOf, traversal: findingId === undefined ? "audit-scoped projection" : "undirected audit-scoped finding component" }, queryFindingId: findingId ?? null, queryAuditId: auditId, visitedNodeIds: scopedNodes.map((node) => node.id), traversedEdgeIds: scopedEdges.map((edge) => edge.id), temporalEventIds: temporalEvents.map((event) => event.id), sourceIds, source: "mysql-database", scope: "explicit audit ownership on every node, edge and event" },
    };
  }
  async function getGroundedGraphContext(findingId: string, auditId: string, options: GraphQueryOptions = {}) {
    requireStoreId(findingId, "findingId");
    const context = await loadGraphProjection(auditId, options, findingId);
    return { ...context, findingId, graphFindingId: context.graphFindingId as string };
  }
  async function listAuditGraphProjection(auditId: string, asOfOrOptions?: string | GraphQueryOptions) {
    return loadGraphProjection(auditId, typeof asOfOrOptions === "string" ? { asOf: asOfOrOptions } : asOfOrOptions ?? {});
  }
  /** Suppliers/persons are shared identities only when reached through an audit-scoped edge. */
  async function listAuditSupplierProjection(auditId: string, asOfOrOptions?: string | GraphQueryOptions) {
    const projection = await loadGraphProjection(auditId, typeof asOfOrOptions === "string" ? { asOf: asOfOrOptions } : asOfOrOptions ?? {});
    const reached = new Set(projection.edges.flatMap((edge: GraphEdge) => [edge.from, edge.to]));
    const suppliers = projection.nodes.filter((node: GraphNode) => node.type.toLowerCase() === "supplier" && reached.has(node.id)).map((node: GraphNode) => ({ ...node, reachedThroughEdgeIds: projection.edges.filter((edge: GraphEdge) => edge.from === node.id || edge.to === node.id).map((edge: GraphEdge) => edge.id) }));
    return { source: "mysql-database", auditId, suppliers, supplierCount: suppliers.length, unlinkedSupplierNodeIds: projection.nodes.filter((node: GraphNode) => node.type.toLowerCase() === "supplier" && !reached.has(node.id)).map((node) => node.id), ontologyVersion: projection.ontologyVersion, asOf: projection.asOf, effectiveAt: projection.effectiveAt, historyComplete: projection.historyComplete, traversalProof: projection.traversalProof };
  }
  async function validateGraphOntology(auditId?: string) {
    const ontology = await loadOntology(process.env.PART21_ONTOLOGY_CONFIG_ID ?? "part21-assurance-ontology");
    if (auditId !== undefined) await domain.requireAudit(auditId);
    const db = dependencies.database();
    const [edgeRows] = await db.query(`SELECT * FROM part21_graph_edges${auditId ? ` WHERE ${scopeClause}` : ""}`, auditId ? scopeValues(auditId) : []);
    const endpointIds = auditId ? [...new Set(edgeRows.filter((row: any) => graphRecordHasAuditScope(parseStorePayload(row.payload), auditId)).flatMap((row: any) => [row.from_id, row.to_id]))] : [];
    const nodeClause = auditId ? `${scopeClause} OR (LOWER(node_type)='audit' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.sourceRecordId'))=?)${endpointIds.length ? ` OR id IN (${endpointIds.map(() => "?").join(",")})` : ""}` : "";
    const [nodeRows] = await db.query(`SELECT * FROM part21_graph_nodes${nodeClause ? ` WHERE ${nodeClause}` : ""}`, auditId ? [...scopeValues(auditId), auditId, ...endpointIds] : []);
    const invalidNodes: { id: string; reason: string }[] = [], invalidEdges: { id: string; reason: string }[] = [];
    const nodes = new Map<string, GraphNode>();
    for (const row of nodeRows) try {
      const node = hydrateNode(row);
      validateOntologyNode(ontology, node);
      const sharedEndpoint = ["supplier", "person"].includes(node.type.toLowerCase()) && endpointIds.includes(node.id);
      if (auditId && !graphRecordHasAuditScope(node.payload, auditId, node.type) && !sharedEndpoint) throw new Error("Mismatched audit scope.");
      nodes.set(node.id, node);
    } catch (error) { invalidNodes.push({ id: row.id, reason: error instanceof Error ? error.message : "Invalid node" }); }
    for (const row of edgeRows) try { const edge = hydrateEdge(row); validateOntologyEdge(ontology, edge, nodes); if (auditId && !graphRecordHasAuditScope(edge.payload, auditId)) throw new Error("Mismatched audit scope."); } catch (error) { invalidEdges.push({ id: row.id, reason: error instanceof Error ? error.message : "Invalid edge" }); }
    return { source: "mysql-database", auditId: auditId ?? null, ontologyId: ontology.configId, ontologyVersion: ontology.version, ontologySourceSha256: ontology.sourceSha256, nodeCount: nodeRows.length, edgeCount: edgeRows.length, invalidNodes, invalidEdges, consistent: !invalidNodes.length && !invalidEdges.length };
  }
  return { ensureGraphStore, getGraphStoreStatus, getGroundedGraphContext, listAuditGraphProjection, listAuditSupplierProjection, validateGraphOntology };
}
const graphStore = createGraphStore({ database: getStoreDatabase });
export const { ensureGraphStore, getGraphStoreStatus, getGroundedGraphContext, listAuditGraphProjection, listAuditSupplierProjection, validateGraphOntology } = graphStore;

export type ApprovedGraphRevisionInput = {
  entityKind: "node" | "edge"; entityId: string; auditId: string; eventId: string;
  expectedRevision: number; validFrom: string; validTo?: string | null; actor: string;
  sourceRecordType: string; sourceRecordId: string; sourceSha256: string; sourceDigestKind: "payload" | "content";
  snapshot: { id: string; type?: string; label?: string; subtitle?: string; status?: string; from?: string; to?: string; relation?: string; payload: Record<string, unknown> };
  approvalRecordType: string; approvalRecordId: string;
};
/** Approval payload contract. The store never creates, signs, or upgrades this record. */
export type GraphHumanApproval = {
  auditId: string; status: "approved"; actorType: "human"; qualified: true;
  approvedBy: string; approvedAt: string; artifactSha256: string;
};
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Undefined values are not valid approved graph content.");
  return result;
}
export function graphRevisionDigest(input: ApprovedGraphRevisionInput, ontology: ControlledOntology) {
  const content = { entityKind: input.entityKind, entityId: input.entityId, auditId: input.auditId, expectedRevision: input.expectedRevision, validFrom: storeTimestamp(input.validFrom), validTo: input.validTo == null ? null : storeTimestamp(input.validTo), sourceRecordType: input.sourceRecordType, sourceRecordId: input.sourceRecordId, sourceSha256: input.sourceSha256, sourceDigestKind: input.sourceDigestKind, snapshot: input.snapshot, ontology: { configId: ontology.configId, version: ontology.version, sourceSha256: ontology.sourceSha256 } };
  return crypto.createHash("sha256").update(canonicalJson(content)).digest("hex");
}
export function createApprovedGraphWriter(dependencies: { database: () => StoreSqlDatabase; ontology?: (configId: string, version?: string) => Promise<ControlledOntology> }) {
  async function commitApprovedGraphRevision(input: ApprovedGraphRevisionInput) {
    for (const [name, value] of Object.entries({ entityId: input.entityId, auditId: input.auditId, eventId: input.eventId, actor: input.actor, sourceRecordType: input.sourceRecordType, sourceRecordId: input.sourceRecordId, approvalRecordType: input.approvalRecordType, approvalRecordId: input.approvalRecordId })) requireStoreId(value, name);
    if (!["node", "edge"].includes(input.entityKind)) throw new Error("Graph entityKind must be node or edge.");
    if (!["payload", "content"].includes(input.sourceDigestKind) || !/^[a-f0-9]{64}$/i.test(input.sourceSha256)) throw new Error("An exact source digest and digest kind are required.");
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("expectedRevision is required.");
    if (input.snapshot.id !== input.entityId || !graphRecordHasAuditScope(input.snapshot.payload, input.auditId, input.snapshot.type)) throw new DomainScopeError("Graph snapshot identity or audit scope does not match the requested revision.");
    if (input.snapshot.payload.sourceRecordId !== input.sourceRecordId || input.snapshot.payload.sourceRecordType !== input.sourceRecordType) throw new Error("Snapshot provenance must reference the exact source record.");
    const validFrom = storeTimestamp(input.validFrom), validTo = input.validTo == null ? null : storeTimestamp(input.validTo);
    if (validTo !== null && validTo <= validFrom) throw new Error("validTo must be after validFrom; effective intervals are half-open.");
    const connection = await dependencies.database().getConnection();
    try {
      await connection.beginTransaction();
      const [audit] = await connection.query("SELECT record_id FROM part21_domain_records WHERE record_type='audit' AND record_id=? FOR UPDATE", [input.auditId]);
      if (!audit[0]) throw new DomainScopeError(`Unknown audit ${input.auditId}.`);
      const [sources] = await connection.query("SELECT * FROM part21_domain_records WHERE record_type=? AND record_id=? FOR UPDATE", [input.sourceRecordType, input.sourceRecordId]);
      if (!sources[0] || (sources[0].audit_id ?? (input.sourceRecordType === "audit" ? input.sourceRecordId : null)) !== input.auditId) throw new DomainScopeError("Graph source record is missing or belongs to another audit.");
      const actualSourceHash = input.sourceDigestKind === "content" ? sources[0].content_sha256 : crypto.createHash("sha256").update(JSON.stringify(parseStorePayload(sources[0].payload))).digest("hex");
      if (actualSourceHash !== input.sourceSha256) throw new Error("Source digest no longer matches the persisted record; human review must use the exact source revision.");
      const [approvals] = await connection.query("SELECT audit_id,payload FROM part21_domain_records WHERE record_type=? AND record_id=? FOR UPDATE", [input.approvalRecordType, input.approvalRecordId]);
      if (!approvals[0] || approvals[0].audit_id !== input.auditId) throw new DomainScopeError("Persisted human approval is missing or out of scope.");
      const approval = parseStorePayload(approvals[0].payload);
      if (approval.auditId !== input.auditId || approval.status !== "approved" || approval.actorType !== "human" || approval.qualified !== true || typeof approval.approvedBy !== "string" || !approval.approvedBy.trim() || !approval.approvedAt) throw new Error("Authoritative projection requires a persisted qualified human approval, not a request boolean or synthetic actor.");
      const registry = createOntologyRegistry({ sql: () => connection });
      const ontology = await (dependencies.ontology ?? registry.getControlledOntology)(process.env.PART21_ONTOLOGY_CONFIG_ID ?? "part21-assurance-ontology");
      const artifactSha256 = graphRevisionDigest(input, ontology);
      if (approval.artifactSha256 !== artifactSha256) throw new Error("Human approval is not bound to this exact graph revision, source digest and ontology revision.");
      const [clock] = await connection.query("SELECT UTC_TIMESTAMP(3) AS now");
      const now = storeTimestamp(clock[0]?.now);
      if (storeTimestamp(approval.approvedAt) > now) throw new Error("Human approval timestamp is later than the database clock.");
      if (input.entityKind === "node") {
        if (!input.snapshot.type || !input.snapshot.label) throw new Error("Graph node type and label are required.");
        validateOntologyNode(ontology, { id: input.entityId, type: input.snapshot.type, payload: input.snapshot.payload }, true);
      } else {
        if (!input.snapshot.from || !input.snapshot.to || !input.snapshot.relation) throw new Error("Graph edge endpoints and relation are required.");
        const [endpoints] = await connection.query("SELECT * FROM part21_graph_nodes WHERE id IN (?,?) FOR UPDATE", [input.snapshot.from, input.snapshot.to]);
        const scoped = endpoints.filter((row: any) => graphRecordHasAuditScope(parseStorePayload(row.payload), input.auditId, row.node_type)).map(hydrateNode);
        validateOntologyEdge(ontology, { id: input.entityId, from: input.snapshot.from, to: input.snapshot.to, relation: input.snapshot.relation }, new Map(scoped.map((node: GraphNode) => [node.id, node])));
      }
      const table = input.entityKind === "node" ? "part21_graph_nodes" : "part21_graph_edges";
      const [existingRows] = await connection.query(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`, [input.entityId]);
      const existing = existingRows[0];
      if (existing) {
        const payload = parseStorePayload(existing.payload);
        if (!graphRecordHasAuditScope(payload, input.auditId, existing.node_type) || (Array.isArray(payload.auditIds) && payload.auditIds.some((id) => id !== input.auditId))) throw new DomainScopeError("A graph revision cannot overwrite another audit or a shared global entity; use an audit-specific projection identity.");
      }
      const [revisions] = await connection.query("SELECT MAX(revision) AS revision FROM part21_graph_revisions WHERE entity_kind=? AND entity_id=? AND audit_id=?", [input.entityKind, input.entityId, input.auditId]);
      const currentRevision = Number(revisions[0]?.revision ?? 0);
      if (currentRevision !== input.expectedRevision) throw new Error(`Graph revision conflict: expected ${input.expectedRevision}, found ${currentRevision}.`);
      const [priorEvent] = await connection.query("SELECT id FROM part21_graph_events WHERE id=? FOR UPDATE", [input.eventId]);
      if (priorEvent[0]) throw new Error("Graph event ID already exists; inspect its exact committed revision before retrying.");
      async function insertRevision(revision: number, snapshot: unknown, start: string | null, end: string | null, recordedAt: string, provenance: string) {
        const serialized = JSON.stringify(snapshot);
        await connection.query("INSERT INTO part21_graph_revisions (entity_kind,entity_id,audit_id,revision,valid_from,valid_to,recorded_at,recorded_by,snapshot,snapshot_sha256,source_record_type,source_record_id,source_sha256,ontology_config_id,ontology_version,ontology_sha256,approval_record_type,approval_record_id,provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [input.entityKind, input.entityId, input.auditId, revision, start == null ? null : new Date(start), end == null ? null : new Date(end), new Date(recordedAt), revision === 0 ? null : input.actor, serialized, crypto.createHash("sha256").update(serialized).digest("hex"), input.sourceRecordType, input.sourceRecordId, revision === 0 ? null : input.sourceSha256, revision === 0 ? null : ontology.configId, revision === 0 ? null : ontology.version, revision === 0 ? null : ontology.sourceSha256, revision === 0 ? null : input.approvalRecordType, revision === 0 ? null : input.approvalRecordId, provenance]);
      }
      const [baselineRows] = await connection.query("SELECT revision FROM part21_graph_revisions WHERE entity_kind=? AND entity_id=? AND audit_id=? AND revision=0", [input.entityKind, input.entityId, input.auditId]);
      if (existing && currentRevision === 0 && baselineRows.length === 0) {
        const payload = parseStorePayload(existing.payload);
        const start = payload.validFrom ?? payload.effectiveFrom;
        const end = payload.validTo ?? payload.effectiveTo;
        await insertRevision(0, existing, start == null ? null : storeTimestamp(start), end == null ? null : storeTimestamp(end), storeTimestamp(existing.updated_at), "legacy_snapshot_author_unknown");
      }
      const revision = currentRevision + 1;
      const payload = { ...input.snapshot.payload, validFrom, validTo, ontologyConfigId: ontology.configId, ontologyVersion: ontology.version, ontologySourceSha256: ontology.sourceSha256, sourceSha256: input.sourceSha256, sourceDigestKind: input.sourceDigestKind, approvalRecordType: input.approvalRecordType, approvalRecordId: input.approvalRecordId };
      const snapshot = input.entityKind === "node" ? { id: input.entityId, node_type: input.snapshot.type, label: input.snapshot.label, subtitle: input.snapshot.subtitle ?? null, status: input.snapshot.status ?? null, payload, updated_at: now } : { id: input.entityId, from_id: input.snapshot.from, to_id: input.snapshot.to, relation: input.snapshot.relation, label: input.snapshot.label ?? null, payload, updated_at: now };
      await insertRevision(revision, snapshot, validFrom, validTo, now, "qualified_human_approval");
      if (input.entityKind === "node") await connection.query("INSERT INTO part21_graph_nodes (id,node_type,label,subtitle,status,payload,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE node_type=VALUES(node_type),label=VALUES(label),subtitle=VALUES(subtitle),status=VALUES(status),payload=VALUES(payload),updated_at=VALUES(updated_at)", [input.entityId, input.snapshot.type, input.snapshot.label, input.snapshot.subtitle ?? null, input.snapshot.status ?? null, JSON.stringify(payload), new Date(now)]);
      else await connection.query("INSERT INTO part21_graph_edges (id,from_id,to_id,relation,label,payload,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE from_id=VALUES(from_id),to_id=VALUES(to_id),relation=VALUES(relation),label=VALUES(label),payload=VALUES(payload),updated_at=VALUES(updated_at)", [input.entityId, input.snapshot.from, input.snapshot.to, input.snapshot.relation, input.snapshot.label ?? null, JSON.stringify(payload), new Date(now)]);
      await connection.query("INSERT INTO part21_graph_events (id,entity_id,valid_from,valid_to,recorded_at,recorded_by,operation,payload) VALUES (?,?,?,?,?,?,?,?)", [input.eventId, input.entityId, new Date(validFrom), validTo == null ? null : new Date(validTo), new Date(now), input.actor, "approved-graph-revision", JSON.stringify({ auditId: input.auditId, sourceRecordId: input.sourceRecordId, sourceRecordType: input.sourceRecordType, revision, artifactSha256, sourceSha256: input.sourceSha256, ontology: ontologyManifest(ontology), approvalRecordType: input.approvalRecordType, approvalRecordId: input.approvalRecordId, validFromExact: validFrom, validToExact: validTo })]);
      await connection.commit();
      return { source: "mysql-database", auditId: input.auditId, entityId: input.entityId, revision, eventId: input.eventId, recordedAt: now, artifactSha256, ontologyConfiguration: ontologyManifest(ontology), approvalRecordId: input.approvalRecordId };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  return { commitApprovedGraphRevision };
}
export const commitApprovedGraphRevision = createApprovedGraphWriter({ database: getStoreDatabase }).commitApprovedGraphRevision;
