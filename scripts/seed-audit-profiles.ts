import "dotenv/config";
import crypto from "node:crypto";
import { createPool } from "mysql2/promise";
import { configurationDigest } from "../server/config-governance";
import { getAuditProfiles } from "../server/regulatory-runtime";
import type { AuditProfileDefinition, RegulationSet } from "../shared/regulatory";

/**
 * Creates the two governed audit profiles the launch screen selects from.
 *
 * These are controlled configuration records, not operational data and not TypeScript fixtures:
 * every required provision ID is resolved against the ingested eCFR snapshots in MySQL and the
 * script aborts if a citation is not actually present. Profiles are inserted once; an existing
 * profile with different content is reported and left untouched so a change must go through the
 * configuration review path rather than a silent overwrite.
 */

type ProfileSeed = {
  id: string;
  version: string;
  title: string;
  standard: string;
  caseType: string;
  regulationSets: RegulationSet[];
  provisionIds: string[];
  requiredEvidenceTypes: string[];
  reviewerRoles: string[];
  reportingPath: string;
};

const seeds: ProfileSeed[] = [
  {
    id: "P21-SUPPLIER-QUAL",
    version: "1.0.0",
    title: "Supplier qualification and procurement control",
    standard: "10 CFR Part 21 §21.21/§21.31 · Part 50 Appendix B IV/VII/XV",
    caseType: "supplier-qualification",
    regulationSets: ["10-cfr-part-21", "10-cfr-part-50-appendix-b"],
    provisionIds: ["10-cfr:21.21(a)(1)", "10-cfr:21.21(a)(2)", "10-cfr:21.21(b)", "10-cfr:21.31", "10-cfr:21.41", "10-cfr:part-50:appendix-b:IV", "10-cfr:part-50:appendix-b:VII", "10-cfr:part-50:appendix-b:XV"],
    requiredEvidenceTypes: ["purchase-order", "supplier-quality-plan", "certificate-of-conformance", "receiving-inspection-record", "nonconformance-report"],
    reviewerRoles: ["supplier-quality-engineer", "qa-manager"],
    reportingPath: "Supplier quality → QA manager → Part 21 evaluation (10 CFR 21.21) before any NRC notification",
  },
  {
    id: "P21-TRACE-CONFIG",
    version: "1.0.0",
    title: "Design traceability and configuration baseline",
    standard: "10 CFR Part 21 §21.3/§21.51/§21.61 · Part 50 Appendix B III/VI/XVII",
    caseType: "traceability-configuration",
    regulationSets: ["10-cfr-part-21", "10-cfr-part-50-appendix-b"],
    provisionIds: ["10-cfr:21.3", "10-cfr:21.21(a)(3)", "10-cfr:21.51", "10-cfr:21.61", "10-cfr:part-50:appendix-b:III", "10-cfr:part-50:appendix-b:VI", "10-cfr:part-50:appendix-b:XVII"],
    requiredEvidenceTypes: ["design-change-package", "configuration-index", "as-built-drawing", "heat-lot-certificate", "inspection-and-test-plan"],
    reviewerRoles: ["design-engineer", "configuration-manager", "qa-manager"],
    reportingPath: "Design engineering → configuration control board → QA manager → Part 21 evaluation",
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const db = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 });
  const [snapshotRows] = await db.query<any[]>("SELECT snapshot_id, source_id, payload FROM part21_regulatory_snapshots");
  const provisionIds = new Set<string>();
  for (const row of snapshotRows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    for (const provision of payload.provisions ?? []) if (provision?.id) provisionIds.add(String(provision.id));
  }
  console.log(`Loaded ${provisionIds.size} provision IDs from ${snapshotRows.length} ingested snapshots.`);

  const approvedAt = new Date().toISOString();
  const approvedBy = "Doug Smith";
  for (const seed of seeds) {
    const missing = seed.provisionIds.filter(provisionId => !provisionIds.has(provisionId));
    if (missing.length) throw new Error(`Profile ${seed.id} cites provisions that are not ingested: ${missing.join(", ")}`);
    const payload: AuditProfileDefinition & { standard: string } = {
      id: seed.id,
      version: seed.version,
      title: seed.title,
      caseType: seed.caseType,
      regulationSets: seed.regulationSets,
      requiredProvisionIds: seed.provisionIds,
      requiredEvidenceTypes: seed.requiredEvidenceTypes,
      reviewerRoles: seed.reviewerRoles,
      reportingPath: seed.reportingPath,
      standard: seed.standard,
    };
    const digest = configurationDigest(payload);
    const [existing] = await db.query<any[]>("SELECT source_sha256, status FROM part21_controlled_configuration WHERE kind='audit_profile' AND config_id=? AND version=?", [seed.id, seed.version]);
    if (existing.length) {
      const same = existing[0].source_sha256 === digest;
      console.log(`${seed.id}@${seed.version} already exists (${existing[0].status}); ${same ? "identical content" : "content differs — left untouched, use the configuration review path"}.`);
      continue;
    }
    await db.query(
      "INSERT INTO part21_controlled_configuration (kind,config_id,version,payload,source_sha256,status,approved_by,approved_at) VALUES ('audit_profile',?,?,?,?, 'active', ?, ?)",
      [seed.id, seed.version, JSON.stringify(payload), digest, approvedBy, approvedAt],
    );
    await db.query(
      "INSERT INTO part21_configuration_authorship (kind,config_id,version,created_by,created_at) VALUES ('audit_profile',?,?,?,?) ON DUPLICATE KEY UPDATE created_by=VALUES(created_by)",
      [seed.id, seed.version, approvedBy, approvedAt],
    );
    await db.query(
      "INSERT INTO part21_configuration_events (event_id,principal_id,event_at,action,payload) VALUES (?,?,?,?,?)",
      [`EVT-${crypto.randomUUID()}`, approvedBy, approvedAt, "configuration.audit_profile_seeded", JSON.stringify({ configId: seed.id, version: seed.version, sourceSha256: digest, provisionIds: seed.provisionIds, synthetic: true })],
    );
    console.log(`Inserted ${seed.id}@${seed.version} with ${seed.provisionIds.length} verified provisions.`);
  }

  const result = await getAuditProfiles();
  console.log(`\nGoverned profiles now visible to the launch screen: ${result.profiles.length}`);
  for (const profile of result.profiles) console.log(`- ${profile.id}@${profile.version} · ${profile.title} · ${profile.status} · provisions ${profile.requiredProvisionIds.length}`);
  await db.end();
  // The governance repository keeps its own pool open; exit explicitly once seeding is complete.
  process.exit(0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
