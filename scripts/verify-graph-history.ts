import "dotenv/config";
import { createPool } from "mysql2/promise";
import { getGroundedGraphContext } from "../server/graph-store";

(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
  const [kinds] = await db.query<any[]>("SELECT entity_kind, provenance, COUNT(*) n, MIN(valid_from) first_valid, MAX(recorded_at) last_recorded FROM part21_graph_revisions GROUP BY entity_kind, provenance");
  console.log("=== REVISION TABLE ===");
  for (const r of kinds as any[]) console.log(`${r.entity_kind.padEnd(5)} provenance=${r.provenance} rows=${r.n} first_valid=${new Date(r.first_valid).toISOString()} last_recorded=${new Date(r.last_recorded).toISOString()}`);
  const [tot] = await db.query<any[]>("SELECT COUNT(*) n, COUNT(DISTINCT entity_id) entities, COUNT(DISTINCT audit_id) audits FROM part21_graph_revisions");
  console.log("totals:", JSON.stringify((tot as any[])[0]));

  const graph: any = await getGroundedGraphContext("F-042", "AUD-026");
  console.log("\n=== LIVE TRAVERSAL F-042 / AUD-026 ===");
  console.log(`nodes=${graph.nodes.length} edges=${graph.edges.length} ontology=${graph.ontologyVersion} source=${graph.source}`);
  const nodeIds = graph.nodes.map((n: any) => n.id);
  console.log("nodes:", graph.nodes.map((n: any) => `${n.id}[${n.type}]`).join(", "));
  console.log("edges:", graph.edges.map((e: any) => `${e.from} -${e.relation}-> ${e.to}`).join("\n       "));

  console.log("\n=== REVISIONS BACKING THOSE ENTITIES ===");
  const [revs] = await db.query<any[]>(
    "SELECT entity_kind,entity_id,revision,valid_from,recorded_at,provenance,LEFT(snapshot_sha256,12) digest FROM part21_graph_revisions WHERE entity_id IN (?) ORDER BY entity_kind,entity_id",
    [nodeIds],
  );
  for (const r of revs as any[]) console.log(`${r.entity_kind.padEnd(4)} ${String(r.entity_id).padEnd(34)} rev=${r.revision} valid_from=${new Date(r.valid_from).toISOString()} digest=${r.digest} provenance=${r.provenance}`);

  console.log("\n=== POINT-IN-TIME PROOF ===");
  try { const past: any = await getGroundedGraphContext("F-042", "AUD-026", { asOf: "2026-11-19T00:00:00.000Z" } as any); console.log(`asOf 2026-11-19 nodes=${past.nodes.length} edges=${past.edges.length}`); }
  catch (error) { console.log("asOf 2026-11-19 ->", error instanceof Error ? error.message : String(error)); }
  const now: any = await getGroundedGraphContext("F-042", "AUD-026", { asOf: new Date().toISOString() } as any);
  console.log(`asOf now nodes=${now.nodes.length} edges=${now.edges.length}`);
  await db.end(); process.exit(0);
})().catch(error => { console.error("FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
