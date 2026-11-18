import "dotenv/config";
import { createPool } from "mysql2/promise";
import { ingestEcfrSource, migrateRegulatorySourceStore, listSourceSnapshots, getRegulatorySnapshot } from "../server/regulatory-source";
import { verifyProcessCitations, verifyProcessModelCoverage } from "../server/part21-citation-verify";

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 4, timezone: "Z" });
  await migrateRegulatorySourceStore(db);
  console.log("schema: ready");
  for (const [sourceId, regulationSet] of [["ecfr-part-21", "10-cfr-part-21"], ["ecfr-part-50-appendix-b", "10-cfr-part-50-appendix-b"]] as const) {
    const existing = await listSourceSnapshots(sourceId);
    if (existing.length) { console.log(`${sourceId}: existing snapshot ${existing[0].id} as-of ${existing[0].sourceAsOf} (${existing[0].provisions.length} provisions)`); continue; }
    const snap = await ingestEcfrSource({ sourceId, regulationSet, sourceAsOf: "2026-11-09" });
    const readback = await getRegulatorySnapshot(snap.id);
    console.log(`${sourceId}: ingested ${snap.id} provisions=${snap.provisions.length} readback=${readback.provisions.length === snap.provisions.length ? "ok" : "MISMATCH"}`);
  }
  const part21 = (await listSourceSnapshots("ecfr-part-21"))[0];
  const verification = verifyProcessCitations(part21);
  console.log("\nCITATION VERIFICATION", JSON.stringify({ snapshot: verification.snapshotId, asOf: verification.sourceAsOf, amended: verification.latestAmendedOn, upToDate: verification.providerUpToDateAsOf, verified: verification.verified, mismatched: verification.mismatched, missing: verification.missing, allVerified: verification.allVerified }, null, 1));
  for (const c of verification.checks) console.log(` ${c.status.padEnd(9)} ${c.section.padEnd(6)} ${c.normalizedHeading ?? "(none)"}`);
  console.log("\nPROCESS MODEL COVERAGE", JSON.stringify(verifyProcessModelCoverage(part21)));
  const appendixB = (await listSourceSnapshots("ecfr-part-50-appendix-b"))[0];
  console.log("Appendix B criteria parsed:", appendixB.provisions.filter(p => p.kind === "criterion").length);
  await db.end();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
