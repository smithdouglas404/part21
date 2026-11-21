import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

/**
 * Creates two synthetic audits through the same authenticated HTTP route the launch screen uses.
 * The session is signed locally with the application secret for the real persisted user, so this
 * exercises authentication, authorization, profile validation, identifier allocation, the domain
 * write and its assurance event rather than inserting rows behind the API.
 */
const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";
const openId = process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS";

const audits = [
  {
    title: "Supplier qualification — Helios Forge valve bodies",
    scope: "Heat-lot traceability and receiving inspection for forged valve bodies supplied to the Unit 2 safety injection family",
    profileId: "P21-SUPPLIER-QUAL",
    due: "2027-02-12",
  },
  {
    title: "Design interface control — Unit 2 seismic mounting",
    scope: "Design change packages and configuration baseline for the seismic mounting interface and its as-built drawings",
    profileId: "P21-TRACE-CONFIG",
    due: "2027-03-05",
  },
];

async function main() {
  const token = await sdk.signSession({ openId, appId: ENV.appId, name: "Pookie" }, { expiresInMs: 15 * 60 * 1000 });
  const cookie = `${COOKIE_NAME}=${token}`;
  const profilesResponse = await fetch(`${base}/api/nuclear/profiles`, { headers: { cookie } });
  const profiles = await profilesResponse.json() as any;
  if (!profilesResponse.ok) throw new Error(`Profiles unavailable: ${profiles?.error ?? profilesResponse.status}`);
  console.log(`Authenticated as ${openId}; ${profiles.profiles.length} governed profiles visible.`);

  for (const audit of audits) {
    const profile = profiles.profiles.find((item: any) => item.id === audit.profileId);
    if (!profile) throw new Error(`Profile ${audit.profileId} is not active.`);
    const response = await fetch(`${base}/api/domain/audits`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...audit, standard: profile.standard ?? "" }),
    });
    const body = await response.json() as any;
    if (!response.ok) { console.log(`FAILED ${audit.title}: HTTP ${response.status} ${body?.error ?? ""}`); continue; }
    console.log(`CREATED ${body.audit.id} · ${body.audit.title} · ${body.audit.standard} · due ${body.audit.due} · profile ${body.audit.auditProfileId}@${body.audit.auditProfileVersion} · revision ${body.audit.revision}`);
  }

  const register = await fetch(`${base}/api/domain/audits`, { headers: { cookie } });
  const body = await register.json() as any;
  console.log(`\nAudit register now holds ${body.audits.length} audits:`);
  for (const item of body.audits) console.log(`- ${item.id} · ${item.status} · ${item.title} · owner ${item.owner}`);
  process.exit(0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
