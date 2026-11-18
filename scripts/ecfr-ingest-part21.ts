import "dotenv/config";
import { createPool } from "mysql2/promise";
import { ingestEcfrSource, migrateRegulatorySourceStore, listSourceSnapshots, getRegulatorySnapshot } from "../server/regulatory-source";
import { verifyProcessCitations, verifyProcessModelCoverage } from "../server/part21-citation-verify";
(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: "Z" });
  console.log("step: migrate"); await migrateRegulatorySourceStore(db);
  const existing = await listSourceSnapshots("ecfr-part-21");
  let snap = existing[0];
  if (!snap) { console.log("step: fetch+parse"); snap = await ingestEcfrSource({ sourceId: "ecfr-part-21", regulationSet: "10-cfr-part-21", sourceAsOf: "2026-11-09" }); }
  console.log("step: readback"); const back = await getRegulatorySnapshot(snap.id);
  console.log(`snapshot ${snap.id} asOf=${snap.sourceAsOf} amended=${snap.latestAmendedOn} upToDate=${snap.providerUpToDateAsOf} provisions=${back.provisions.length}`);
  const v = verifyProcessCitations(back);
  console.log(`citations verified=${v.verified} mismatch=${v.mismatched} missing=${v.missing} allVerified=${v.allVerified}`);
  for (const c of v.checks) console.log(`  ${c.status.padEnd(9)} ${c.section.padEnd(6)} ${c.normalizedHeading ?? "(none)"}`);
  console.log("model coverage", JSON.stringify(verifyProcessModelCoverage(back)));
  await db.end();
  console.log("DONE");
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
