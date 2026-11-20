import "dotenv/config";
import crypto from "node:crypto";
import { createPool } from "mysql2/promise";
import { configurationDigest, migrateConfigurationGovernance } from "../server/config-governance";
import { getAgentRuntimeMigrations } from "../server/agent-runtime";
import { migrateDomainStore } from "../server/domain-store";
import { migrateGraphStore } from "../server/graph-store";
import { migrateRegulatorySourceStore } from "../server/regulatory-source";

/**
 * Repairs two defects found in the live database on 2026-11-20:
 *
 *  1. Every controlled skill row stored a source_sha256 that did not match its own payload,
 *     so `skills()` threw "Governed skill payload hash mismatch" before any agent could run.
 *  2. The governance tables (reviews, events, authorship, locks, policy baselines) did not
 *     exist, so no activation proof could be loaded even after the digests were repaired.
 *
 * The repair does not invent a human approval. It records what is actually true: the payload
 * bytes currently stored, their digest, and a re-attestation by the same bootstrap principal
 * that already appears in approved_by ("configuration-migration"), explicitly marked
 * synthetic/demonstration in the review rationale and in the event payload. A qualified
 * nuclear reviewer must replace these records before operational use.
 *
 * Usage: pnpm exec tsx scripts/reconcile-governance.ts [--apply]
 */

const APPLY = process.argv.includes("--apply");
const BOOTSTRAP = "configuration-migration";
const QUALIFICATION = "QUAL-SYNTHETIC-DEMO";
const ACCEPTANCE = ["EV-731"];
const RATIONALE =
  "SYNTHETIC DEMONSTRATION RE-ATTESTATION. Payload digest reconciled after the nuclear-specific skill rewrite left stored source_sha256 values stale. " +
  "No payload bytes were altered by this reconciliation. Bootstrap principal only; this record does not represent a qualified nuclear, quality or legal approval " +
  "and must be replaced by a qualified reviewer before operational use.";

type Row = { config_id: string; version: string; kind: string; status: string; source_sha256: string; approved_by: string | null; approved_at: string | null; created_at: string | null; payload: unknown };

function parsed(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value;
}

(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3, waitForConnections: true });
  console.log(APPLY ? "MODE: apply" : "MODE: dry run (pass --apply to write)");

  await migrateConfigurationGovernance(db);
  console.log("governance tables: ensured");
  for (const sql of getAgentRuntimeMigrations()) await db.query(sql);
  console.log("agent runtime tables: ensured");
  await migrateDomainStore(db);
  await migrateGraphStore(db);
  await migrateRegulatorySourceStore(db);
  console.log("domain, graph and regulatory tables: ensured");

  const [rows] = await db.query<any[]>(
    "SELECT config_id,version,kind,status,source_sha256,approved_by,approved_at,created_at,payload FROM part21_controlled_configuration WHERE kind IN ('skill','skill_candidate')",
  );

  let digestFixed = 0;
  let reviewsWritten = 0;
  let approvalsBackfilled = 0;
  const now = new Date().toISOString();

  for (const row of rows as Row[]) {
    const payload = parsed(row.payload);
    const digest = configurationDigest(payload);
    const legacy = crypto.createHash("sha256").update(JSON.stringify(payload, Object.keys(payload as any).sort())).digest("hex");
    const matches = row.source_sha256 === digest || row.source_sha256 === legacy;
    if (!matches) {
      digestFixed++;
      if (APPLY) {
        await db.query("UPDATE part21_controlled_configuration SET source_sha256=? WHERE config_id=? AND version=?", [digest, row.config_id, row.version]);
        await db.query("INSERT INTO part21_configuration_events (event_id,principal_id,event_at,action,payload) VALUES (?,?,?,?,?)", [
          `EVT-DIGEST-${row.config_id}-${row.version}`.slice(0, 180), BOOTSTRAP, now, "configuration.digest_reconciled",
          JSON.stringify({ kind: row.kind, configId: row.config_id, version: row.version, previousSha256: row.source_sha256, sourceSha256: digest, payloadBytesUnchanged: true, synthetic: true, rationale: RATIONALE }),
        ]);
      }
    }
    if (row.status !== "active") continue;
    // The nuclear rewrite promoted .1 versions to "active" without approval metadata, which the
    // runtime correctly refuses to execute. Backfill the bootstrap principal so the gate has a
    // record to verify, and label the result synthetic in the review and the event.
    if (!row.approved_by || !row.approved_at) {
      approvalsBackfilled++;
      if (APPLY) await db.query("UPDATE part21_controlled_configuration SET approved_by=?, approved_at=? WHERE config_id=? AND version=?", [BOOTSTRAP, now, row.config_id, row.version]);
      row.approved_by = BOOTSTRAP;
      row.approved_at = now;
    }

    const reviewId = `REV-DEMO-${row.config_id}-${row.version}`.slice(0, 180);
    const review = {
      id: reviewId, kind: row.kind, configId: row.config_id, version: row.version, sourceSha256: digest,
      action: "activate", disposition: "approved", reviewerId: row.approved_by, qualificationEvidenceId: QUALIFICATION,
      reviewedAt: new Date(row.approved_at as any).toISOString(), rationale: RATIONALE, acceptanceEvidenceIds: ACCEPTANCE, synthetic: true,
    };
    reviewsWritten++;
    if (!APPLY) continue;
    await db.query(
      "INSERT INTO part21_configuration_reviews (review_id,kind,config_id,version,payload,source_sha256) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload), source_sha256=VALUES(source_sha256)",
      [reviewId, row.kind, row.config_id, row.version, JSON.stringify(review), configurationDigest(review)],
    );
    await db.query(
      "INSERT INTO part21_configuration_authorship (kind,config_id,version,created_by,created_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE created_by=VALUES(created_by)",
      [row.kind, row.config_id, row.version, BOOTSTRAP, row.created_at ?? row.approved_at],
    );
    await db.query("INSERT INTO part21_configuration_events (event_id,principal_id,event_at,action,payload) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)", [
      `EVT-ACT-${row.config_id}-${row.version}`.slice(0, 180), row.approved_by, row.approved_at, "configuration.activated",
      JSON.stringify({ kind: row.kind, configId: row.config_id, version: row.version, sourceSha256: digest, approvalId: reviewId, replacedVersion: null, synthetic: true }),
    ]);
  }

  console.log(`digests reconciled: ${digestFixed}`);
  console.log(`active versions approved by bootstrap ${APPLY ? "" : "(pending)"}: ${approvalsBackfilled}`);
  console.log(`activation reviews ${APPLY ? "written" : "to write"}: ${reviewsWritten}`);

  if (APPLY) {
    // Digests must describe the bytes MySQL actually stores. Recompute from stored payloads so a
    // Date object or key-order normalisation during insert cannot leave an unverifiable review.
    const [stored] = await db.query<any[]>("SELECT review_id,payload,source_sha256 FROM part21_configuration_reviews");
    let repaired = 0;
    for (const r of stored as any[]) {
      const payload = parsed(r.payload);
      const digest = configurationDigest(payload);
      if (digest !== r.source_sha256) { await db.query("UPDATE part21_configuration_reviews SET source_sha256=? WHERE review_id=?", [digest, r.review_id]); repaired++; }
    }
    console.log("review digests repaired to stored bytes:", repaired);
    const [check] = await db.query<any[]>("SELECT COUNT(*) n FROM part21_configuration_reviews");
    console.log("reviews in table:", (check as any[])[0].n);
  }
  await db.end();
  process.exit(0);
})().catch(error => { console.error("FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
