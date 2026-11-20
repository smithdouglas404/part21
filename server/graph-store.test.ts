import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApprovedGraphWriter, createGraphStore, graphRevisionDigest, type ApprovedGraphRevisionInput } from "./graph-store";
import { createOntologyRegistry, validateOntologyEdge, validateOntologyNode, type ControlledOntology } from "./ontology-store";
import type { StoreSqlDatabase } from "./domain-store";

const A = "test-audit-A", B = "test-audit-B", FA = "test-finding-A", FB = "test-finding-B";
const NOW = "2026-11-18T12:00:00.000Z";
const ontology: ControlledOntology = {
  kind: "ontology", configId: "test-ontology", version: "exact-config-revision", sourceSha256: "1".repeat(64), status: "active", approvedBy: "test-reviewer", approvedAt: "2026-11-01T00:00:00.000Z",
  payload: { version: "wrong-display-label", classes: ["Finding", "Product", "Supplier", "Evidence", "Person", "Audit"].map((id) => ({ id })), relations: [{ id: "about", from: "Finding", to: "Product" }, { id: "suppliedBy", from: "Product", to: "Supplier" }, { id: "supportedBy", from: "Finding", to: "Evidence" }, { id: "raisedBy", from: "Finding", to: "Person" }] },
};
function node(id: string, type: string, sourceRecordId: string, auditId: string | null, extra: Record<string, unknown> = {}) {
  return { id, node_type: type, label: sourceRecordId, updated_at: "2026-11-02T00:00:00.000Z", payload: { sourceRecordType: type.toLowerCase(), sourceRecordId, sourceAuditId: auditId, validFrom: "2026-11-01T00:00:00.000Z", ...extra } };
}
function edge(id: string, from_id: string, to_id: string, relation: string, auditId: string) {
  return { id, from_id, to_id, relation, label: relation, updated_at: "2026-11-02T00:00:00.000Z", payload: { sourceAuditId: auditId, sourceRecordType: "finding", sourceRecordId: auditId === A ? FA : FB, validFrom: "2026-11-01T00:00:00.000Z" } };
}
function event(id: string, entity_id: string, auditId: string, extra: Record<string, unknown> = {}) {
  return { id, entity_id, valid_from: "2026-11-01", valid_to: null, recorded_at: "2026-11-02T00:00:00.000Z", recorded_by: "test-principal", operation: "test-recorded", payload: { auditId, sourceRecordId: auditId === A ? FA : FB, ...extra } };
}
function testGraph(overrides: { nodes?: any[]; edges?: any[]; events?: any[]; revisions?: any[]; domain?: any[] } = {}) {
  const nodes = overrides.nodes ?? [node("graph-fa", "finding", FA, A, { id: "payload-cannot-overwrite-primary-id" }), node("graph-fb", "finding", FB, B), node("product-a", "product", "test-product-A", A), node("product-b", "product", "test-product-B", B), node("shared-supplier", "supplier", "test-supplier", null, { auditIds: [A, B] }), node("shared-person", "person", "test-person", null, { auditIds: [A, B] })];
  const edges = overrides.edges ?? [edge("edge-a-product", "graph-fa", "product-a", "about", A), edge("edge-b-product", "graph-fb", "product-b", "about", B), edge("edge-a-supplier", "product-a", "shared-supplier", "suppliedBy", A), edge("edge-b-supplier", "product-b", "shared-supplier", "suppliedBy", B), edge("edge-a-person", "graph-fa", "shared-person", "raisedBy", A), edge("edge-b-person", "graph-fb", "shared-person", "raisedBy", B), edge("malformed-cross-scope-edge", "product-b", "shared-supplier", "suppliedBy", A)];
  const events = overrides.events ?? [event("event-primary-A", "graph-fa", A, { id: "payload-not-event-primary", entityId: "payload-not-entity" }), event("event-primary-B", "graph-fb", B), event("shared-event-A", "shared-supplier", A), event("shared-event-B", "shared-supplier", B), event("edge-event-A", "edge-a-supplier", A)];
  const records = overrides.domain ?? [
    { record_type: "audit", record_id: A, audit_id: A, payload: { id: A } }, { record_type: "audit", record_id: B, audit_id: B, payload: { id: B } },
    { record_type: "finding", record_id: FA, audit_id: A, payload: { id: FA, auditId: A }, created_at: "2026-11-01", updated_at: "2026-11-02", revision: 0 }, { record_type: "finding", record_id: FB, audit_id: B, payload: { id: FB, auditId: B }, created_at: "2026-11-01", updated_at: "2026-11-02", revision: 0 },
  ];
  const calls: { sql: string; values?: unknown[] }[] = [];
  const db: StoreSqlDatabase = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("LIMIT 0")) return [[], []];
      if (sql.includes("UTC_TIMESTAMP")) return [[{ now: NOW }], []];
      if (sql.includes("WHERE record_type='audit'")) return [records.filter((r) => r.record_type === "audit" && r.record_id === values?.[0]), []];
      if (sql.startsWith("SELECT d.*")) return [records.filter((r) => r.record_type === values?.[0] && r.record_id === values?.[1]), []];
      // Return deliberately unfiltered rows to test the second isolation boundary.
      if (sql.includes("FROM part21_graph_nodes")) return [nodes, []];
      if (sql.includes("FROM part21_graph_edges")) return [edges, []];
      if (sql.includes("FROM part21_graph_events")) return [events, []];
      if (sql.includes("FROM part21_graph_revisions")) return [overrides.revisions ?? [], []];
      throw new Error(`Unexpected test SQL: ${sql}`);
    },
    async getConnection() { throw new Error("Graph reads must not open write transactions"); },
  };
  return { store: createGraphStore({ database: () => db, ontology: async () => ontology }), calls };
}

describe("database-only graph grounding", () => {
  it("requires exact audit/finding and rejects unknown and mismatched scope without fallback", async () => {
    const fake = testGraph();
    await expect((fake.store.getGroundedGraphContext as any)(FA)).rejects.toThrow("auditId");
    await expect(fake.store.getGroundedGraphContext("missing-test-finding", A)).rejects.toThrow("Unknown finding");
    await expect(fake.store.getGroundedGraphContext(FA, B)).rejects.toThrow("outside");
    await expect(fake.store.getGroundedGraphContext(FA, "missing-test-audit")).rejects.toThrow("Unknown audit");
  });
  it("cannot walk through shared supplier/person into another audit; retains exact proof and counts", async () => {
    const fake = testGraph(); const graph = await fake.store.getGroundedGraphContext(FA, A);
    expect(graph.nodes.map((n) => n.id)).toEqual(["graph-fa", "product-a", "shared-supplier", "shared-person"]);
    expect(graph.edges.map((e) => e.id)).toEqual(["edge-a-product", "edge-a-supplier", "edge-a-person"]);
    expect(graph.temporalEvents.map((e) => e.id)).toEqual(["event-primary-A", "shared-event-A", "edge-event-A"]);
    expect(graph.traversalProof.temporalEventIds).toEqual(graph.temporalEvents.map((e) => e.id));
    expect(graph.graphFindingId).toBe("graph-fa"); expect(graph.sourceIds).toContain(FA); expect(graph.sourceIds).not.toContain("graph-fa");
    expect(graph.nodeCount).toBe(4); expect(graph.edgeCount).toBe(3); expect(graph.temporalEventCount).toBe(3);
    expect(graph.ontologyVersion).toBe(ontology.version); expect(graph.ontologySourceSha256).toBe(ontology.sourceSha256);
    expect(graph.traversalProof.query.auditId).toBe(A); expect(graph.traversalProof.source).toBe("mysql-database");
    expect(graph.temporalEvents[0].entityId).toBe("graph-fa");
    expect(fake.calls.every((call) => call.sql.startsWith("SELECT"))).toBe(true);
    expect(fake.calls.filter((call) => call.sql.includes("FROM part21_graph_")).every((call) => call.values?.includes(A))).toBe(true);
  });
  it("never matches another node by a finding label", async () => {
    const fake = testGraph({ nodes: [node("wrong-finding", "finding", "other-test-source", A, { label: FA })], edges: [], events: [] });
    await expect(fake.store.getGroundedGraphContext(FA, A)).rejects.toThrow("no effective persisted graph node");
  });
  it("admits a shared supplier only as an audit-scoped edge endpoint, never a supplier reached only by another audit", async () => {
    const shared = node("shared-supplier-b-scoped", "supplier", "test-supplier-shared", B);
    const other = node("supplier-b-only", "supplier", "test-supplier-b-only", B);
    const fake = testGraph({ nodes: [node("graph-fa", "finding", FA, A), node("product-a", "product", "test-product-A", A), shared, other], edges: [edge("edge-a-product", "graph-fa", "product-a", "about", A), edge("edge-a-supplier", "product-a", "shared-supplier-b-scoped", "suppliedBy", A), edge("edge-b-only", "product-b", "supplier-b-only", "suppliedBy", B)], events: [] });
    const graph = await fake.store.getGroundedGraphContext(FA, A);
    expect(graph.nodes.map((item) => item.id)).toEqual(["graph-fa", "product-a", "shared-supplier-b-scoped"]);
    expect(graph.nodes.find((item) => item.id === "shared-supplier-b-scoped")?.scopeBasis).toBe("audit-scoped-edge-endpoint");
    expect(graph.nodes.some((item) => item.id === "supplier-b-only")).toBe(false);
    const suppliers = await fake.store.listAuditSupplierProjection(A);
    expect(suppliers.suppliers.map((item) => item.id)).toEqual(["shared-supplier-b-scoped"]);
    expect(suppliers.suppliers[0].reachedThroughEdgeIds).toEqual(["edge-a-supplier"]);
    expect(suppliers.unlinkedSupplierNodeIds).toEqual([]);
  });
  it("returns an explicitly empty audit projection when there is no finding", async () => {
    const fake = testGraph({ nodes: [], edges: [], events: [] });
    const projection = await fake.store.listAuditGraphProjection(A);
    expect(projection.nodes).toEqual([]); expect(projection.graphFindingId).toBeNull(); expect(projection.findingId).toBeNull();
    expect(projection.nodeCount).toBe(0); expect(projection.traversalProof.visitedNodeIds).toEqual([]);
    await expect(fake.store.getGroundedGraphContext(FA, A)).rejects.toThrow("no effective persisted graph node");
  });
  it("marks legacy current rows as incomplete history instead of asserting approved revision provenance", async () => {
    const fake = testGraph();
    const graph = await fake.store.getGroundedGraphContext(FA, A);
    expect(graph.historyComplete).toBe(false);
    expect(graph.temporalUnknowns.some((item) => item.reason.includes("No approved revision history"))).toBe(true);
  });
  it("actually applies effective-time and transaction-time filters to nodes, edges and events", async () => {
    const nodes = [node("graph-fa", "finding", FA, A), node("future-evidence", "evidence", "test-future-evidence", A, { validFrom: "2026-12-01T00:00:00.000Z" }), node("closed-evidence", "evidence", "test-closed-evidence", A, { validTo: "2026-11-10T00:00:00.000Z" }), node("transaction-future", "evidence", "test-new-evidence", A)];
    nodes[3].updated_at = "2026-11-17T00:00:00.000Z";
    const fake = testGraph({ nodes, edges: [edge("future-edge", "graph-fa", "future-evidence", "supportedBy", A), edge("closed-edge", "graph-fa", "closed-evidence", "supportedBy", A), edge("transaction-edge", "graph-fa", "transaction-future", "supportedBy", A)], events: [event("included-event", "graph-fa", A), { ...event("future-valid-event", "graph-fa", A), valid_from: "2026-12-01" }, { ...event("closed-event", "graph-fa", A), valid_to: "2026-11-10" }, { ...event("transaction-future-event", "graph-fa", A), recorded_at: "2026-11-17T00:00:00.000Z" }] });
    const graph = await fake.store.getGroundedGraphContext(FA, A, { effectiveAt: "2026-11-10T00:00:00.000Z", asOf: "2026-11-11T00:00:00.000Z" });
    expect(graph.nodes.map((n) => n.id)).toEqual(["graph-fa"]); expect(graph.edges).toEqual([]);
    expect(graph.temporalEvents.map((e) => e.id)).toEqual(["included-event"]);
    expect(graph.traversalProof.query.asOf).toBe("2026-11-11T00:00:00.000Z");
  });
  it("uses prior exact snapshots rather than relabeling current graph data as historical", async () => {
    const live = node("graph-fa", "finding", FA, A); live.label = "new label"; live.updated_at = "2026-11-17T00:00:00.000Z";
    const prior = { ...live, label: "old label", id: "payload-revision-cannot-replace-primary", updated_at: "2026-11-02T00:00:00.000Z" };
    const fake = testGraph({ nodes: [live], edges: [], events: [], revisions: [{ entity_kind: "node", entity_id: "graph-fa", audit_id: A, revision: 1, valid_from: "2026-11-01", valid_to: null, recorded_at: "2026-11-02", snapshot: prior }, { entity_kind: "node", entity_id: "graph-fa", audit_id: A, revision: 2, valid_from: "2026-11-01", valid_to: null, recorded_at: "2026-11-17", snapshot: live }] });
    const graph = await fake.store.getGroundedGraphContext(FA, A, { effectiveAt: "2026-11-10", asOf: "2026-11-11" });
    expect(graph.nodes[0].id).toBe("graph-fa"); expect(graph.nodes[0].label).toBe("old label");
  });
  it("fails historical reads when effective history is unknown rather than using a silent timeless fallback", async () => {
    const root = node("graph-fa", "finding", FA, A); delete (root.payload as any).validFrom;
    const fake = testGraph({ nodes: [root], edges: [], events: [] });
    expect((await fake.store.getGroundedGraphContext(FA, A)).historyComplete).toBe(false);
    await expect(fake.store.getGroundedGraphContext(FA, A, { asOf: "2026-11-10" })).rejects.toThrow("history may be unavailable");
  });
  it("does not replace a revision outside effective bounds with the live row", async () => {
    const root = node("graph-fa", "finding", FA, A);
    const fake = testGraph({ nodes: [root], edges: [], events: [], revisions: [{ entity_kind: "node", entity_id: "graph-fa", audit_id: A, revision: 1, valid_from: "2026-11-01", valid_to: "2026-11-10", recorded_at: "2026-11-02", snapshot: root }] });
    await expect(fake.store.getGroundedGraphContext(FA, A, { effectiveAt: "2026-11-10", asOf: "2026-11-11" })).rejects.toThrow("no effective persisted graph node");
  });
  it("rejects unknown ontology classes, relations and endpoint classes", () => {
    expect(() => validateOntologyNode(ontology, { id: "test-invalid", type: "Unknown", payload: {} })).toThrow("Unknown ontology class");
    const nodes = new Map([["from", { id: "from", type: "Finding", payload: {} }], ["to", { id: "to", type: "Supplier", payload: {} }]]);
    expect(() => validateOntologyEdge(ontology, { id: "test-edge", from: "from", to: "to", relation: "unknown" }, nodes)).toThrow("Unknown ontology relation");
    expect(() => validateOntologyEdge(ontology, { id: "test-edge", from: "from", to: "to", relation: "about" }, nodes)).toThrow("endpoint classes");
  });
  it("rejects ambiguity/draft approvals and returns exact governed configuration envelopes", async () => {
    const config = { config_id: "test-ontology", version: "exact-version", status: "active", source_sha256: "a".repeat(64), approved_by: "test-human", approved_at: "2026-11-01", updated_at: "2026-11-02", payload: ontology.payload };
    let rows = [config];
    const registry = createOntologyRegistry({ sql: () => ({ query: async () => [rows, []] }) });
    expect((await registry.getControlledOntology("test-ontology")).version).toBe("exact-version");
    rows = [config, config]; await expect(registry.getControlledOntology("test-ontology")).rejects.toThrow("Ambiguous");
    rows = [{ ...config, approved_by: null as any }]; await expect(registry.getControlledOntology("test-ontology")).rejects.toThrow("human-approved");
    rows = [{ ...config, status: "draft" }]; await expect(registry.getControlledOntology("test-ontology", "exact-version")).rejects.toThrow("human-approved");
  });
});

function approvedWriterFake(mode: "accepted" | "unapproved" | "wrong-digest" | "event-failure" | "revision-conflict" | "baseline-exists" = "accepted") {
  const sourcePayload = { id: FA, auditId: A };
  const input: ApprovedGraphRevisionInput = { entityKind: "node", entityId: "graph-fa", auditId: A, eventId: "test-new-primary-event", expectedRevision: 0, validFrom: "2026-11-03T15:30:00.000Z", actor: "test-worker-principal", sourceRecordType: "finding", sourceRecordId: FA, sourceSha256: crypto.createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex"), sourceDigestKind: "payload", snapshot: { id: "graph-fa", type: "finding", label: "test-approved-label", payload: { auditId: A, sourceRecordType: "finding", sourceRecordId: FA } }, approvalRecordType: "human_approval", approvalRecordId: "test-approval" };
  const approval = { auditId: A, status: mode === "unapproved" ? "pending" : "approved", actorType: "human", qualified: true, approvedBy: "test-qualified-reviewer", approvedAt: "2026-11-18T11:00:00.000Z", artifactSha256: mode === "wrong-digest" ? "0".repeat(64) : graphRevisionDigest(input, ontology) };
  const calls: { sql: string; values?: unknown[] }[] = [];
  const query = async (sql: string, values?: unknown[]): Promise<[any, any]> => {
    calls.push({ sql, values });
    if (sql.includes("WHERE record_type='audit'")) return [[{ record_id: A }], []];
    if (sql.startsWith("SELECT * FROM part21_domain_records")) return [[{ record_id: FA, audit_id: A, payload: sourcePayload }], []];
    if (sql.startsWith("SELECT audit_id,payload")) return [[{ audit_id: A, payload: approval }], []];
    if (sql.includes("UTC_TIMESTAMP")) return [[{ now: NOW }], []];
    if (sql.startsWith("SELECT * FROM part21_graph_nodes")) return [[], []];
    if (sql.startsWith("SELECT revision FROM part21_graph_revisions")) return [mode === "baseline-exists" ? [{ revision: 0 }] : [], []];
    if (sql.startsWith("SELECT MAX(revision)")) return [[{ revision: mode === "revision-conflict" ? 3 : null }], []];
    if (sql.startsWith("SELECT id FROM part21_graph_events")) return [[], []];
    if (sql.startsWith("INSERT")) { if (mode === "event-failure" && sql.includes("part21_graph_events")) throw new Error("Injected event write failure"); return [{ affectedRows: 1 }, []]; }
    throw new Error(`Unexpected writer SQL: ${sql}`);
  };
  const db: StoreSqlDatabase = { query, async getConnection() { return { query, async beginTransaction() { calls.push({ sql: "BEGIN" }); }, async commit() { calls.push({ sql: "COMMIT" }); }, async rollback() { calls.push({ sql: "ROLLBACK" }); }, release() { calls.push({ sql: "RELEASE" }); } }; } };
  return { input, calls, writer: createApprovedGraphWriter({ database: () => db, ontology: async () => ontology }) };
}
describe("approved graph revision transaction", () => {
  it("commits the snapshot, current projection and exact event together only with a persisted human approval", async () => {
    const fake = approvedWriterFake(); const result = await fake.writer.commitApprovedGraphRevision(fake.input);
    expect(result.eventId).toBe(fake.input.eventId); expect(result.revision).toBe(1); expect(result.recordedAt).toBe(NOW);
    expect(fake.calls.map((c) => c.sql).filter((sql) => sql.startsWith("INSERT"))).toHaveLength(3);
    expect(fake.calls.some((c) => c.sql === "COMMIT")).toBe(true);
    expect(fake.calls.filter((c) => c.sql.startsWith("INSERT")).some((c) => c.sql.includes("part21_domain_records"))).toBe(false);
  });
  it.each(["unapproved", "wrong-digest", "revision-conflict"] as const)("refuses %s before any graph mutation", async (mode) => {
    const fake = approvedWriterFake(mode); await expect(fake.writer.commitApprovedGraphRevision(fake.input)).rejects.toThrow();
    expect(fake.calls.some((c) => c.sql.startsWith("INSERT"))).toBe(false); expect(fake.calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
  });
  it("does not re-bootstrap revision 0 when an approved baseline already occupies it", async () => {
    const fake = approvedWriterFake("baseline-exists");
    const result = await fake.writer.commitApprovedGraphRevision(fake.input);
    expect(result.revision).toBe(1);
    const revisionInserts = fake.calls.filter((call) => call.sql.includes("INSERT INTO part21_graph_revisions"));
    expect(revisionInserts).toHaveLength(1);
    expect(revisionInserts[0].values?.[3]).toBe(1);
  });
  it("rolls back the entire projection if event append fails", async () => {
    const fake = approvedWriterFake("event-failure"); await expect(fake.writer.commitApprovedGraphRevision(fake.input)).rejects.toThrow("event write failure");
    expect(fake.calls.some((c) => c.sql === "ROLLBACK")).toBe(true); expect(fake.calls.some((c) => c.sql === "COMMIT")).toBe(false);
  });
});
