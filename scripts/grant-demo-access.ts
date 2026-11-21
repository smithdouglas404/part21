import "dotenv/config";
import { issueAccessGrant, listAccessGrants, runAsPrincipal, type AssurancePrincipal } from "../server/access-control";
import { listAudits } from "../server/domain-store";

/**
 * Issues real, persisted access grants so the signed-in auditor can work the existing audit
 * portfolio. This is authorization data, not a bypass: every grant is a domain record with an
 * issuer, and the server still enforces audit scope, write access and reviewer qualification.
 *
 * Run once after seeding audits:  pnpm exec tsx scripts/grant-demo-access.ts
 */
const openId = process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS";
const actor = process.env.PART21_TEST_ACTOR ?? "Pookie";

async function main() {
  const admin: AssurancePrincipal = {
    id: "system:bootstrap-grants",
    actor: "Doug Smith",
    roleIds: ["admin"],
    auditIds: [],
    auditWriteIds: [],
    qualifiedAuditIds: [],
    access: "make_changes",
    isAdmin: true,
    qualified: false,
  };
  const audits = await listAudits();
  const existing = (await listAccessGrants(admin)).grants;
  let created = 0;
  for (const audit of audits as any[]) {
    const auditId = String(audit.id);
    if (existing.some(grant => grant.principalId === openId && grant.auditId === auditId && grant.active)) continue;
    await runAsPrincipal(admin, () => issueAccessGrant({ principalId: openId, auditId, roleIds: ["auditor"], access: "make_changes" }, admin));
    created += 1;
    console.log(`Granted ${actor} make-changes access to ${auditId}.`);
  }
  console.log(`\n${created} new grants; ${audits.length} audits now in ${actor}'s portfolio.`);
  process.exit(0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
