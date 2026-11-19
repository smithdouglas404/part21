/**
 * Stages a governed ontology revision that admits Finding --cites--> Regulation.
 *
 * This script never activates the revision. Activation is a qualified human decision recorded
 * through the configuration governance path; the projection code refuses to run until the
 * revision is active, which is the point of the control.
 */
import "dotenv/config";
import { createPool } from "mysql2/promise";
import crypto from "node:crypto";
import { validateOntologyDefinition, type ControlledOntology } from "../server/ontology-store";
import { regulatoryGraphStatus } from "../server/regulatory-graph";

const CONFIG_ID = "part21-assurance-ontology";

(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
  const [rows] = await db.query<any[]>(
    "SELECT * FROM part21_controlled_configuration WHERE kind='ontology' AND config_id=? AND status='active'",
    [CONFIG_ID],
  );
  if (!(rows as any[]).length) throw new Error(`No active ontology ${CONFIG_ID}.`);
  const row = (rows as any[])[0];
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  const active: ControlledOntology = {
    kind: "ontology", configId: row.config_id, version: row.version, sourceSha256: row.source_sha256 ?? row.sourceSha256,
    status: row.status, approvedBy: row.approved_by ?? row.approvedBy, approvedAt: String(row.approved_at ?? row.approvedAt), payload,
  };

  const before = regulatoryGraphStatus(active);
  console.log("active ontology:", `${before.ontologyConfigId}@${before.ontologyVersion}`);
  console.log("Regulation class:", before.regulationClass, "| citation relation:", before.citationRelation ?? "none");
  if (before.canProject) {
    console.log("Nothing to stage: the active ontology already admits citation edges.");
    await db.end();
    process.exit(0);
  }

  const [nextVersion] = String(before.ontologyVersion).match(/(\d+)\.(\d+)/)
    ? (() => {
        const [, major, minor] = String(before.ontologyVersion).match(/(\d+)\.(\d+)/)!;
        return [`${major}.${Number(minor) + 1}`];
      })()
    : [`${before.ontologyVersion}-1`];

  const relations = [...(payload.relations ?? [])];
  if (!relations.some((relation: any) => relation.from === "Finding" && relation.to === "Regulation")) {
    relations.push({ id: "cites", from: "Finding", to: "Regulation", temporal: true });
  }
  const staged = { ...payload, version: nextVersion, relations };
  validateOntologyDefinition(staged as any);

  const [existing] = await db.query<any[]>(
    "SELECT version FROM part21_controlled_configuration WHERE kind='ontology' AND config_id=? AND version=?",
    [CONFIG_ID, nextVersion],
  );
  if ((existing as any[]).length) {
    console.log(`Revision ${nextVersion} already staged; no duplicate written.`);
  } else {
    await db.query(
      `INSERT INTO part21_controlled_configuration
        (kind, config_id, version, status, payload, source_sha256, approved_by, approved_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [
        "ontology", CONFIG_ID, nextVersion, "draft", JSON.stringify(staged),
        crypto.createHash("sha256").update(JSON.stringify(staged)).digest("hex"),
        null, null,
      ],
    );
    console.log(`Staged draft revision ${nextVersion} with relation cites:Finding->Regulation.`);
  }
  console.log("Activation is NOT performed by this script. Approve the revision through configuration governance, then re-run provision projection.");
  await db.end();
  process.exit(0);
})().catch(error => { console.error("FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
