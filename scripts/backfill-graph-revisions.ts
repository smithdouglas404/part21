import "dotenv/config";
import crypto from "node:crypto";
import { createPool } from "mysql2/promise";
import { configurationDigest } from "../server/config-governance";

/**
 * Baseline backfill for the bitemporal graph.
 *
 * The graph held nodes and edges but zero revision rows, so the store could answer "what is true
 * now" and could not answer "what was true then" or "who changed it". This writes revision 0
 * (the baseline snapshot) for every node and edge that carries audit scope, marked with
 * provenance "backfill-baseline" so nobody mistakes it for an observed change. Future mutations
 * through the approved graph writer append revisions 1..n.
 */

const APPLY = process.argv.includes("--apply");

function parsed(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function auditOf(payload: Record<string, any>): string | null {
  return payload.sourceAuditId ?? payload.auditId ?? payload.audit_id ?? payload.scope?.auditId ?? null;
}

(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3, waitForConnections: true });
  const [nodes] = await db.query<any[]>("SELECT id,node_type,payload,updated_at FROM part21_graph_nodes");
  const [edges] = await db.query<any[]>("SELECT id,relation,payload,updated_at FROM part21_graph_edges");
  const nodeAudit = new Map<string, string | null>();
  for (const node of nodes as any[]) nodeAudit.set(String(node.id), auditOf(parsed(node.payload)));

  const rows: Array<{ kind: "node" | "edge"; id: string; auditId: string; type: string; payload: any; effective?: Date | string }> = [];
  let unscoped = 0;
  for (const node of nodes as any[]) {
    const payload = parsed(node.payload);
    const auditId = auditOf(payload);
    if (!auditId) { unscoped++; continue; }
    rows.push({ kind: "node", id: String(node.id), auditId, type: String(node.node_type), payload, effective: payload.validFrom ?? node.updated_at });
  }
  for (const edge of edges as any[]) {
    const payload = parsed(edge.payload);
    const auditId = auditOf(payload) ?? nodeAudit.get(String(payload.fromId ?? payload.from_id)) ?? null;
    if (!auditId) { unscoped++; continue; }
    rows.push({ kind: "edge", id: String(edge.id), auditId, type: String(edge.relation), payload, effective: payload.validFrom ?? edge.updated_at });
  }

  console.log(APPLY ? "MODE: apply" : "MODE: dry run (pass --apply to write)");
  console.log(`nodes=${(nodes as any[]).length} edges=${(edges as any[]).length} scoped=${rows.length} unscoped_skipped=${unscoped}`);

  let written = 0;
  for (const row of rows) {
    const [existing] = await db.query<any[]>(
      "SELECT revision FROM part21_graph_revisions WHERE entity_kind=? AND entity_id=? AND audit_id=? LIMIT 1",
      [row.kind, row.id, row.auditId],
    );
    if ((existing as any[]).length) continue;
    written++;
    if (!APPLY) continue;
    const snapshot = JSON.stringify({ id: row.id, type: row.type, payload: row.payload });
    await db.query(
      `INSERT INTO part21_graph_revisions (entity_kind,entity_id,audit_id,revision,valid_from,valid_to,recorded_at,recorded_by,snapshot,snapshot_sha256,source_record_type,source_record_id,source_sha256,ontology_config_id,ontology_version,ontology_sha256,approval_record_type,approval_record_id,provenance)
       VALUES (?,?,?,0,?,?,?,NULL,?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,'backfill-baseline')`,
      [row.kind, row.id, row.auditId, row.effective ? new Date(row.effective) : new Date(), null, new Date(), snapshot, crypto.createHash("sha256").update(snapshot).digest("hex"), row.type, row.id],
    );
  }
  console.log(`baseline revisions ${APPLY ? "written" : "to write"}: ${written}`);
  if (APPLY) {
    const [repaired] = await db.query<any[]>("UPDATE part21_graph_revisions SET valid_from=recorded_at WHERE valid_from IS NULL");
    console.log("rows repaired with a concrete valid_from:", (repaired as any).affectedRows ?? 0);
    // The loader expects { id, type, payload } where type is the node type or edge relation.
    const [all] = await db.query<any[]>("SELECT entity_kind,entity_id,audit_id,snapshot FROM part21_graph_revisions");
    let rewrapped = 0;
    for (const row of all as any[]) {
      const stored = parsed(row.snapshot);
      const payload = stored.payload ?? stored;
      const [meta] = row.entity_kind === "node"
        ? await db.query<any[]>("SELECT node_type t,label,subtitle,status FROM part21_graph_nodes WHERE id=?", [row.entity_id])
        : await db.query<any[]>("SELECT relation t,from_id,to_id,label FROM part21_graph_edges WHERE id=?", [row.entity_id]);
      const m: any = (meta as any[])[0] ?? {};
      const wrapped = JSON.stringify({
        id: row.entity_id, type: m.t ?? row.entity_kind, label: m.label ?? null, subtitle: m.subtitle ?? null,
        status: m.status ?? null, from: m.from_id ?? null, to: m.to_id ?? null, relation: row.entity_kind === "edge" ? (m.t ?? null) : null, payload,
      });
      await db.query("UPDATE part21_graph_revisions SET snapshot=?, snapshot_sha256=? WHERE entity_kind=? AND entity_id=? AND audit_id=? AND revision=0", [wrapped, crypto.createHash("sha256").update(wrapped).digest("hex"), row.entity_kind, row.entity_id, row.audit_id]);
      rewrapped++;
    }
    console.log("snapshots re-wrapped with true type:", rewrapped);
    const [check] = await db.query<any[]>("SELECT COUNT(*) n FROM part21_graph_revisions");
    console.log("revisions in table:", (check as any[])[0].n);
  }
  await db.end();
  process.exit(0);
})().catch(error => { console.error("FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
