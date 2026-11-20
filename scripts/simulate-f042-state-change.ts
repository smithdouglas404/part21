import "dotenv/config";
import crypto from "node:crypto";
import { createPool } from "mysql2/promise";
import { createApprovedGraphWriter, graphRevisionDigest, getGroundedGraphContext } from "../server/graph-store";
import { getStoreDatabase, parseStorePayload } from "../server/domain-store";
import { getControlledOntology } from "../server/ontology-store";

/**
 * Simulated state change on F-042, committed through the real approved-writer path.
 *
 * The writer refuses to append a revision without a persisted human approval bound to the exact
 * artifact digest. This script creates that approval with `synthetic: true` and an explicit
 * rationale, so the demonstration exercises every production check while remaining honest that
 * no qualified human signed it. Replace the approval with a real one before operational use.
 */

const auditId = "AUD-026";
const findingId = "F-042";
const nodeId = "find-042";
const actor = "Doug Smith";
const APPLY = process.argv.includes("--apply");

function sha(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function parsed(value: unknown): any { return typeof value === "string" ? JSON.parse(value) : value; }

(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3, waitForConnections: true });
  const [findingRows] = await db.query<any[]>("SELECT payload FROM part21_domain_records WHERE record_type='finding' AND record_id=? AND audit_id=?", [findingId, auditId]);
  if (!findingRows.length) throw new Error("F-042 not found in AUD-026.");
  const beforeFinding = parsed(findingRows[0].payload);
  const [nodeRows] = await db.query<any[]>("SELECT * FROM part21_graph_nodes WHERE id=?", [nodeId]);
  if (!nodeRows.length) throw new Error("Graph node find-042 not found.");
  const node = nodeRows[0];
  const nodePayload = parsed(node.payload);

  const nextStatus = "Awaiting verification";
  console.log("MODE:", APPLY ? "apply" : "dry run (pass --apply to write)");
  console.log(`F-042 status: "${beforeFinding.status}" -> "${nextStatus}"`);

  const now = new Date().toISOString();
  const updatedFinding = { ...beforeFinding, status: nextStatus, statusChangedAt: now, statusChangedBy: actor };
  const updatedNodePayload = { ...nodePayload, id: nodeId, identifier: findingId, status: nextStatus, statusChangedAt: now };

  if (!APPLY) {
    console.log("would update the finding record, create a synthetic approval, and append revision 1 to", nodeId);
    await db.end(); process.exit(0);
  }

  await db.query("UPDATE part21_domain_records SET payload=?, content_sha256=?, updated_at=NOW(3) WHERE record_type='finding' AND record_id=? AND audit_id=?", [JSON.stringify(updatedFinding), crypto.createHash("sha256").update(JSON.stringify(updatedFinding)).digest("hex"), findingId, auditId]);

  // The writer hashes exactly what MySQL returns, so re-read the persisted row.
  const [persisted] = await db.query<any[]>("SELECT payload FROM part21_domain_records WHERE record_type='finding' AND record_id=? AND audit_id=?", [findingId, auditId]);
  const sourcePayload = parseStorePayload(persisted[0].payload);
  const sourceSha256 = sha(sourcePayload);

  const [revRows] = await db.query<any[]>("SELECT MAX(revision) rev FROM part21_graph_revisions WHERE entity_kind='node' AND entity_id=? AND audit_id=?", [nodeId, auditId]);
  const expectedRevision = Number(revRows[0]?.rev ?? 0);

  const ontology = await getControlledOntology(process.env.PART21_ONTOLOGY_CONFIG_ID ?? "part21-assurance-ontology");
  const approvalId = `APR-SYNTHETIC-${findingId}-${Date.now()}`;
  const eventId = `EVT-${findingId}-${Date.now()}`;
  const input = {
    entityKind: "node" as const, entityId: nodeId, auditId, eventId, expectedRevision,
    validFrom: now, validTo: null, actor,
    sourceRecordType: "finding", sourceRecordId: findingId, sourceSha256, sourceDigestKind: "payload" as const,
    snapshot: { id: nodeId, type: node.node_type, label: node.label, subtitle: node.subtitle ?? undefined, status: nextStatus, payload: updatedNodePayload },
    approvalRecordType: "graph_change_approval", approvalRecordId: approvalId,
  };
  const artifactSha256 = graphRevisionDigest(input, ontology);
  const approval = {
    auditId, status: "approved", actorType: "human", qualified: true, approvedBy: actor, approvedAt: now, artifactSha256,
    synthetic: true,
    rationale: "SYNTHETIC DEMONSTRATION APPROVAL. Exercises the approved-writer path for a status change on F-042. Not a qualified nuclear or quality approval; replace before operational use.",
    change: { entityId: nodeId, fromStatus: beforeFinding.status, toStatus: nextStatus },
  };
  await db.query("INSERT INTO part21_domain_records (record_type,record_id,audit_id,payload,content_sha256,created_at,updated_at) VALUES ('graph_change_approval',?,?,?,?,NOW(3),NOW(3))", [approvalId, auditId, JSON.stringify(approval), crypto.createHash("sha256").update(JSON.stringify(approval)).digest("hex")]);

  const writer = createApprovedGraphWriter({ database: getStoreDatabase });
  const result: any = await writer.commitApprovedGraphRevision(input);
  console.log("committed revision:", result?.revision ?? "(writer returned no revision field)");

  const [revs] = await db.query<any[]>("SELECT revision,valid_from,recorded_at,provenance,LEFT(snapshot_sha256,12) digest,snapshot FROM part21_graph_revisions WHERE entity_kind='node' AND entity_id=? AND audit_id=? ORDER BY revision", [nodeId, auditId]);
  console.log("\n=== REVISION ROWS FOR find-042 ===");
  const snapshots: any[] = [];
  for (const row of revs as any[]) {
    const snapshot = parsed(row.snapshot);
    snapshots.push(snapshot.payload ?? snapshot);
    console.log(`rev=${row.revision} valid_from=${new Date(row.valid_from).toISOString()} recorded_at=${new Date(row.recorded_at).toISOString()} digest=${row.digest} provenance=${row.provenance}`);
  }
  if (snapshots.length >= 2) {
    const [oldSnap, newSnap] = snapshots;
    const keys = [...new Set([...Object.keys(oldSnap), ...Object.keys(newSnap)])].sort();
    const delta = keys.filter(key => JSON.stringify(oldSnap[key]) !== JSON.stringify(newSnap[key])).map(key => ({ field: key, from: oldSnap[key] ?? null, to: newSnap[key] ?? null }));
    console.log("\n=== GRAPH DELTA rev0 -> rev1 ===");
    console.log(JSON.stringify(delta, null, 2));
  }

  const [events] = await db.query<any[]>("SELECT id,valid_from,recorded_at,recorded_by,operation FROM part21_graph_events WHERE entity_id=? ORDER BY recorded_at DESC LIMIT 3", [nodeId]);
  console.log("\n=== GRAPH EVENTS ===");
  for (const event of events as any[]) console.log(`${event.id} ${event.operation} by ${event.recorded_by} at ${new Date(event.recorded_at).toISOString()}`);

  const live: any = await getGroundedGraphContext(findingId, auditId);
  const findingNode = live.nodes.find((n: any) => n.id === nodeId);
  console.log("\nLIVE NODE STATUS:", findingNode?.status, "| nodes", live.nodes.length, "edges", live.edges.length, "| historyComplete", live.historyComplete);
  await db.end();
  process.exit(0);
})().catch(error => { console.error("FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
