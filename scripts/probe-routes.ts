import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

/**
 * Probes the routes the UI calls, through the authenticated HTTP surface, and reports the real
 * status and a bounded body excerpt. A route that only exists in source but answers 404/500 here
 * is a defect, so this script is deliberately blunt about status codes.
 */
const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";
const openId = process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS";
const auditId = process.env.PART21_PROBE_AUDIT ?? "AUD-026";

type Probe = { method: "GET" | "POST"; path: string; body?: unknown; expect?: number[] };

const probes: Probe[] = [
  { method: "GET", path: "/api/nuclear/profiles", expect: [200] },
  { method: "GET", path: "/api/domain/audits", expect: [200] },
  { method: "GET", path: `/api/evidence/vault/status?auditId=${auditId}`, expect: [200] },
  // The demo principal is an auditor, not an administrator: 403 is the correct answer here.
  { method: "GET", path: "/api/access/grants", expect: [200, 403] },
  { method: "GET", path: "/api/configuration/drafts", expect: [200] },
  { method: "GET", path: "/api/kanban", expect: [400] },
  { method: "GET", path: `/api/kanban?auditId=${auditId}`, expect: [200] },
  { method: "GET", path: `/api/evidence/assets/ASSET-DOES-NOT-EXIST/download?auditId=${auditId}`, expect: [404, 400] },
  { method: "POST", path: "/api/evidence/assets/ASSET-DOES-NOT-EXIST/verify", body: { auditId }, expect: [404, 400] },
  // Missing sourceId is a validation failure for an administrator and a 403 for an auditor.
  { method: "POST", path: "/api/regulatory/ingest", body: {}, expect: [400, 403] },
  { method: "POST", path: "/api/configuration/review", body: { kind: "skill", configId: "probe", version: "1.0.0" }, expect: [400] },
  { method: "POST", path: "/api/domain/audits", body: { title: "probe" }, expect: [400] },
  { method: "POST", path: "/api/agent/dialogue", body: { auditId, message: "Which evidence is still missing for finding F-042?" }, expect: [200] },
];

async function main() {
  const token = await sdk.signSession({ openId, appId: ENV.appId, name: "Frank" }, { expiresInMs: 15 * 60 * 1000 });
  const cookie = `${COOKIE_NAME}=${token}`;
  let failures = 0;
  for (const probe of probes) {
    const started = Date.now();
    let status = 0;
    let text = "";
    try {
      const response = await fetch(`${base}${probe.path}`, {
        method: probe.method,
        headers: { cookie, ...(probe.body === undefined ? {} : { "content-type": "application/json" }) },
        body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
    }
    const ok = probe.expect ? probe.expect.includes(status) : status >= 200 && status < 300;
    if (!ok) failures += 1;
    const excerpt = text.replace(/\s+/g, " ").slice(0, 220);
    console.log(`${ok ? "PASS" : "FAIL"} ${probe.method} ${probe.path} -> ${status} (${Date.now() - started} ms) ${excerpt}`);
  }
  console.log(`\n${probes.length - failures}/${probes.length} probes behaved as expected.`);
  process.exit(failures ? 1 : 0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
