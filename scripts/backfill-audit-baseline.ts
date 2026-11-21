import "dotenv/config";
import { assertAuditPermission, runAsPrincipal, type AssurancePrincipal } from "../server/access-control";
import { ensureAuditBaseline } from "../server/audit-baseline";
import { listAudits } from "../server/domain-store";
import { configureEvidenceRuntime } from "../server/evidence-vault";

/**
 * Backfill the governed five-phase baseline for audits that existed before automatic
 * baseline generation was added. This is idempotent: existing baseline cards are skipped
 * by sourceRecordId, and the operation is recorded as an assurance event.
 *
 * Run: pnpm exec tsx scripts/backfill-audit-baseline.ts
 */
const admin: AssurancePrincipal = {
  id: "system:audit-baseline-backfill",
  actor: "Audit baseline backfill",
  roleIds: ["admin"],
  auditIds: [],
  auditWriteIds: [],
  qualifiedAuditIds: [],
  access: "make_changes",
  isAdmin: true,
  qualified: false,
};

configureEvidenceRuntime({
  authorize: async (principal, auditId, action) => {
    assertAuditPermission(principal as AssurancePrincipal, auditId, action !== "read");
  },
  resolvePrincipal: async () => admin,
});

async function main() {
  const audits = (await listAudits()) as Array<Record<string, any>>;
  let created = 0;
  let skipped = 0;
  for (const audit of audits) {
    const auditId = String(audit.id ?? "");
    if (!auditId) continue;
    const result = await runAsPrincipal(admin, () => ensureAuditBaseline(auditId, admin));
    created += result.created.length;
    skipped += result.skipped.length;
    console.log(
      `${auditId}: ${result.created.length} created, ${result.skipped.length} skipped, profile ${result.profile?.id ?? "not bound"}`
    );
  }
  console.log(`\nBaseline backfill complete: ${created} cards created, ${skipped} existing cards skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
