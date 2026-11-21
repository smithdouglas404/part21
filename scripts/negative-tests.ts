import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

/**
 * 150 negative tests against the live HTTP surface.
 *
 * Every case states the status class the API must return for bad input. A 500 on malformed input,
 * a 200 on an unauthorized write, or an HTML answer where JSON is promised is a defect, not a
 * pass. The suite is non-destructive: it uses invalid payloads so validation rejects the request
 * before anything is persisted, and it never targets a real record with a valid mutation.
 */
const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";
const openId = process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS";
const auditId = process.env.PART21_NEGATIVE_AUDIT ?? "AUD-026";

type Case = {
  id: string;
  group: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  path: string;
  body?: unknown;
  raw?: string;
  contentType?: string | null;
  auth?: boolean;
  cookie?: string;
  expect: number[];
  json?: boolean;
};

const cases: Case[] = [];
function add(group: string, name: string, method: Case["method"], path: string, expect: number[], extra: Partial<Case> = {}) {
  cases.push({ id: `N${String(cases.length + 1).padStart(3, "0")}`, group, name, method, path, expect, ...extra });
}

const audit = { title: "Negative probe", scope: "Validation probe", due: "2027-02-12", profileId: "P21-SUPPLIER-QUAL" };
const json = (body: unknown) => ({ body, contentType: "application/json" });

/* ------------------------------------------------------------------ authentication */
add("auth", "session without a cookie falls back to read-only", "GET", "/api/session", [200]);
add("auth", "tampered session cookie does not authenticate", "GET", "/api/session", [200], { cookie: `${COOKIE_NAME}=tampered.value.here` });
add("auth", "garbage bearer token is rejected", "GET", "/api/session", [401, 403], { auth: false, extraHeaders: { authorization: "Bearer not-a-token" } } as any);
add("auth", "malformed JWT bearer is rejected", "GET", "/api/session", [401, 403], { auth: false, extraHeaders: { authorization: "Bearer a.b.c" } } as any);
add("auth", "anonymous audit creation is refused", "POST", "/api/domain/audits", [401, 403], { auth: false, ...json(audit) });
add("auth", "anonymous card creation is refused", "POST", "/api/kanban/items", [401, 403], { auth: false, ...json({ auditId, title: "x" }) });
add("auth", "anonymous evidence intake is refused", "POST", "/api/evidence/intake", [401, 403], { auth: false, ...json({}) });
add("auth", "anonymous dialogue is refused", "POST", "/api/agent/dialogue", [401, 403], { auth: false, ...json({ auditId, message: "x" }) });
add("auth", "anonymous grant listing is refused", "GET", "/api/access/grants", [403], { auth: false });
add("auth", "anonymous grant issuance is refused", "POST", "/api/access/grants", [403], { auth: false, ...json({}) });
add("auth", "anonymous configuration review is refused", "POST", "/api/configuration/review", [403], { auth: false, ...json({}) });
add("auth", "anonymous regulatory ingest is refused", "POST", "/api/regulatory/ingest", [403], { auth: false, ...json({}) });
add("auth", "anonymous document registration is refused", "POST", "/api/documents", [401, 403], { auth: false, ...json({}) });
add("auth", "anonymous report finalization is refused", "POST", "/api/reports/finalize", [401, 403], { auth: false, ...json({}) });
add("auth", "tampered cookie cannot list grants", "GET", "/api/access/grants", [403], { cookie: `${COOKIE_NAME}=tampered.value.here` });
add("auth", "anonymous card move is refused", "POST", `/api/kanban/items/KB-NOT-A-CARD/move`, [401, 403], { auth: false, ...json({ auditId, status: "blocked" }) });
add("auth", "anonymous governance decision is refused", "POST", "/api/governance/decide", [401, 403], { auth: false, ...json({}) });
add("auth", "anonymous connector token listing is refused", "GET", "/api/v1/connect/tokens", [401, 403], { auth: false });

/* ------------------------------------------------------------------ audit creation */
add("audit", "audit without title is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, title: undefined }));
add("audit", "audit without scope is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, scope: undefined }));
add("audit", "audit without due date is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, due: undefined }));
add("audit", "audit without profile is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, profileId: undefined }));
add("audit", "blank audit fields are rejected", "POST", "/api/domain/audits", [400], json({ title: " ", scope: " ", due: " ", profileId: " " }));
add("audit", "month 13 is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, due: "2027-13-01" }));
add("audit", "30 February is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, due: "2027-02-30" }));
add("audit", "US date format is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, due: "02/12/2027" }));
add("audit", "unpadded date is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, due: "2027-2-1" }));
add("audit", "date-time string is rejected as a due date", "POST", "/api/domain/audits", [400], json({ ...audit, due: "2027-02-12T00:00:00Z" }));
add("audit", "numeric due date is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, due: 20270212 }));
add("audit", "unknown governed profile is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, profileId: "P21-DOES-NOT-EXIST" }));
add("audit", "lowercase profile identifier is not resolved", "POST", "/api/domain/audits", [400], json({ ...audit, profileId: "p21-supplier-qual" }));
add("audit", "SQL metacharacters in profile are rejected", "POST", "/api/domain/audits", [400], json({ ...audit, profileId: "P21-SUPPLIER-QUAL' OR '1'='1" }));
add("audit", "object title is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, title: { nested: true } }));
add("audit", "array scope is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, scope: ["one", "two"] }));
add("audit", "numeric scope is rejected", "POST", "/api/domain/audits", [400], json({ ...audit, scope: 42 }));
add("audit", "null body is rejected", "POST", "/api/domain/audits", [400], json(null));
add("audit", "array body is rejected", "POST", "/api/domain/audits", [400], json([audit]));
add("audit", "string body is rejected", "POST", "/api/domain/audits", [400], json("title=probe"));
add("audit", "XSS title cannot reach creation", "POST", "/api/domain/audits", [400], json({ ...audit, title: "<script>alert(1)</script>", scope: undefined }));
add("audit", "100k title cannot reach creation", "POST", "/api/domain/audits", [400], json({ ...audit, title: "A".repeat(100_000), scope: undefined }));
add("audit", "unicode title cannot bypass missing scope", "POST", "/api/domain/audits", [400], json({ ...audit, title: "Unité 2 — contrôle", scope: undefined }));
add("audit", "unknown extra field does not substitute for due date", "POST", "/api/domain/audits", [400], json({ ...audit, due: undefined, dueDate: "2027-02-12" }));

/* ------------------------------------------------------------------ Kanban */
add("kanban", "register requires auditId", "GET", "/api/kanban", [400]);
add("kanban", "blank auditId is rejected", "GET", "/api/kanban?auditId=", [400]);
add("kanban", "unknown audit is not readable", "GET", "/api/kanban?auditId=AUD-999", [404]);
add("kanban", "SQL in auditId is not executed", "GET", `/api/kanban?auditId=${encodeURIComponent("AUD-026' OR '1'='1")}`, [404]);
add("kanban", "path traversal in auditId is not resolved", "GET", `/api/kanban?auditId=${encodeURIComponent("../../etc/passwd")}`, [404]);
add("kanban", "10k auditId is rejected without a server error", "GET", `/api/kanban?auditId=${"A".repeat(10_000)}`, [400, 404]);
add("kanban", "empty card body is rejected", "POST", "/api/kanban/items", [400], json({}));
add("kanban", "card without auditId is rejected", "POST", "/api/kanban/items", [400], json({ title: "probe" }));
add("kanban", "card without title is rejected", "POST", "/api/kanban/items", [400], json({ auditId }));
add("kanban", "whitespace title is rejected", "POST", "/api/kanban/items", [400], json({ auditId, title: "   " }));
add("kanban", "invalid card status is rejected", "POST", "/api/kanban/items", [400], json({ auditId, title: "probe", status: "done" }));
add("kanban", "new card cannot start final", "POST", "/api/kanban/items", [400], json({ auditId, title: "probe", status: "final" }));
add("kanban", "client-supplied attachment IDs are refused", "POST", "/api/kanban/items", [400], json({ auditId, title: "probe", attachmentIds: ["KBA-forged"] }));
add("kanban", "card in unknown audit is refused", "POST", "/api/kanban/items", [404], json({ auditId: "AUD-999", title: "probe" }));
add("kanban", "card linked to unknown finding is refused", "POST", "/api/kanban/items", [404], json({ auditId, title: "probe", findingId: "F-NOT-REAL" }));
add("kanban", "card linked to unknown product is refused", "POST", "/api/kanban/items", [404], json({ auditId, title: "probe", productId: "PRODUCT-NOT-REAL" }));
add("kanban", "object title is rejected", "POST", "/api/kanban/items", [400], json({ auditId, title: { x: 1 } }));
add("kanban", "move without auditId is rejected", "POST", "/api/kanban/items/KB-NOT-A-CARD/move", [400], json({ status: "blocked" }));
add("kanban", "move without status is rejected", "POST", "/api/kanban/items/KB-NOT-A-CARD/move", [400], json({ auditId }));
add("kanban", "move of unknown card is refused", "POST", "/api/kanban/items/KB-NOT-A-CARD/move", [404], json({ auditId, status: "blocked" }));
add("kanban", "invalid move status is rejected", "POST", "/api/kanban/items/KB-NOT-A-CARD/move", [400], json({ auditId, status: "done" }));
add("kanban", "direct finalization is refused", "POST", "/api/kanban/items/KB-NOT-A-CARD/move", [400, 403], json({ auditId, status: "final" }));
add("kanban", "attachment without bytes is refused", "POST", "/api/kanban/items/__CARD__/attachments", [400], json({ auditId, filename: "x.pdf", mediaType: "application/pdf", kind: "document" }));
add("kanban", "attachment with invalid kind is refused", "POST", "/api/kanban/items/__CARD__/attachments", [400], json({ auditId, filename: "x", mediaType: "text/plain", kind: "malware", base64: "eA==" }));
add("kanban", "attachment with invalid base64 is refused", "POST", "/api/kanban/items/__CARD__/attachments", [400], json({ auditId, filename: "x", mediaType: "text/plain", kind: "document", base64: "!!!!" }));
add("kanban", "attachment without auditId is refused", "POST", "/api/kanban/items/__CARD__/attachments", [400], json({ filename: "x", mediaType: "text/plain", kind: "document", base64: "eA==" }));
add("kanban", "communication with empty text is refused", "POST", "/api/kanban/items/__CARD__/communications", [400], json({ auditId, text: "" }));
add("kanban", "communication without auditId is refused", "POST", "/api/kanban/items/__CARD__/communications", [400], json({ text: "note" }));
add("kanban", "communication on unknown card is refused", "POST", "/api/kanban/items/KB-NOT-A-CARD/communications", [404], json({ auditId, text: "note" }));
add("kanban", "communication with unknown audit is refused", "POST", "/api/kanban/items/__CARD__/communications", [404], json({ auditId: "AUD-999", text: "note" }));

/* ------------------------------------------------------------------ evidence */
add("evidence", "vault status requires auditId", "GET", "/api/evidence/vault/status", [400]);
add("evidence", "vault status for unknown audit is refused", "GET", "/api/evidence/vault/status?auditId=AUD-999", [404]);
add("evidence", "SQL in vault auditId is not executed", "GET", `/api/evidence/vault/status?auditId=${encodeURIComponent("AUD-026' OR '1'='1")}`, [404]);
add("evidence", "traversal in vault auditId is not resolved", "GET", `/api/evidence/vault/status?auditId=${encodeURIComponent("../../etc/passwd")}`, [404]);
add("evidence", "download requires auditId", "GET", "/api/evidence/assets/KBA-NOT-REAL/download", [400]);
add("evidence", "download of unknown asset is refused", "GET", `/api/evidence/assets/KBA-NOT-REAL/download?auditId=${auditId}`, [404]);
add("evidence", "traversal asset ID is refused", "GET", `/api/evidence/assets/${encodeURIComponent("../../etc/passwd")}/download?auditId=${auditId}`, [404]);
add("evidence", "10k asset ID is refused without a server error", "GET", `/api/evidence/assets/${"A".repeat(10_000)}/download?auditId=${auditId}`, [400, 404]);
add("evidence", "negative revision is rejected", "GET", `/api/evidence/assets/KBA-NOT-REAL/download?auditId=${auditId}&revision=-1`, [400, 404]);
add("evidence", "verify requires auditId", "POST", "/api/evidence/assets/KBA-NOT-REAL/verify", [400], json({}));
add("evidence", "verify of unknown asset is refused", "POST", "/api/evidence/assets/KBA-NOT-REAL/verify", [404], json({ auditId }));
add("evidence", "verify with NaN revision is rejected", "POST", "/api/evidence/assets/KBA-NOT-REAL/verify", [400, 404], json({ auditId, revision: "NaN" }));
add("evidence", "verify rejects GET", "GET", "/api/evidence/assets/KBA-NOT-REAL/verify", [404]);
add("evidence", "empty intake is rejected", "POST", "/api/evidence/intake", [400], json({}));
add("evidence", "intake without auditId is rejected", "POST", "/api/evidence/intake", [400], json({ filename: "x.pdf" }));
add("evidence", "intake without filename is rejected", "POST", "/api/evidence/intake", [400], json({ auditId }));
add("evidence", "intake with invalid base64 is rejected", "POST", "/api/evidence/intake", [400], json({ auditId, filename: "x.pdf", mediaType: "application/pdf", base64: "!!!" }));
add("evidence", "intake for unknown audit is refused", "POST", "/api/evidence/intake", [404], json({ auditId: "AUD-999", linkedFinding: "F-042", name: "x.pdf", mimeType: "application/pdf", contentBase64: "eA==" }));
add("evidence", "array intake body is rejected", "POST", "/api/evidence/intake", [400], json([{ auditId }]));
add("evidence", "empty asset ID path is not routable", "GET", `/api/evidence/assets//download?auditId=${auditId}`, [404]);

/* ------------------------------------------------------------------ dialogue and agents */
add("agent", "dialogue requires auditId", "POST", "/api/agent/dialogue", [400], json({ message: "x" }));
add("agent", "dialogue requires message", "POST", "/api/agent/dialogue", [400], json({ auditId }));
add("agent", "blank dialogue message is rejected", "POST", "/api/agent/dialogue", [400], json({ auditId, message: "   " }));
add("agent", "dialogue for unknown audit is refused", "POST", "/api/agent/dialogue", [404], json({ auditId: "AUD-999", message: "x" }));
add("agent", "dialogue for unknown finding is refused", "POST", "/api/agent/dialogue", [404], json({ auditId, message: "x", findingId: "F-NOT-REAL" }));
add("agent", "finalization without an approval decision is refused", "POST", "/api/agent/dialogue", [400, 403, 409], json({ auditId, message: "finalize", finalize: true, draftTitle: "x", draftDescription: "y" }));
add("agent", "negative conversation revision is rejected", "POST", "/api/agent/dialogue", [400, 409], json({ auditId, message: "x", expectedRevision: -1 }));
add("agent", "object message is rejected", "POST", "/api/agent/dialogue", [400], json({ auditId, message: { text: "x" } }));
add("agent", "100k message cannot break the server", "POST", "/api/agent/dialogue", [400, 413], json({ auditId, message: "A".repeat(100_000) }));
add("agent", "SQL in dialogue auditId is not executed", "POST", "/api/agent/dialogue", [404], json({ auditId: "AUD-026' OR '1'='1", message: "x" }));
add("agent", "dialogue rejects GET", "GET", "/api/agent/dialogue", [404]);
add("agent", "activity requires auditId", "GET", "/api/agentkit/activity", [400]);
add("agent", "skill run requires a skill", "POST", "/api/agentkit/run", [400], json({ auditId }));
add("agent", "registry with unknown audit is refused", "GET", "/api/agents/registry?auditId=AUD-999", [400, 404]);
add("agent", "agent control without action is refused", "POST", "/api/agents/control", [400], json({ auditId }));

/* ------------------------------------------------------------------ configuration, regulation, policy, reports */
add("config", "review without evidence fields is rejected", "POST", "/api/configuration/review", [400], json({ kind: "skill", configId: "probe", version: "1.0.0" }));
add("config", "activation without approval is rejected", "POST", "/api/configuration/activate", [400], json({ kind: "skill", configId: "probe", version: "1.0.0" }));
add("config", "retirement without identity is rejected", "POST", "/api/configuration/retire", [400], json({}));
add("config", "unknown configuration operation is not routable", "POST", "/api/configuration/destroy", [404], json({ kind: "skill", configId: "probe", version: "1.0.0" }));
add("config", "draft listing with unknown kind is empty or rejected", "GET", "/api/configuration/drafts?kind=not-a-kind", [200, 400]);
add("regulatory", "ingest without source is rejected", "POST", "/api/regulatory/ingest", [400], json({}));
add("regulatory", "ingest with invalid date is rejected", "POST", "/api/regulatory/ingest", [400], json({ sourceId: "x", sourceAsOf: "2026-13-40" }));
add("regulatory", "ingest with unsupported regulation set is rejected", "POST", "/api/regulatory/ingest", [400, 502], json({ sourceId: "x", sourceAsOf: "2026-11-20", regulationSet: "eu-mdr" }));
add("regulatory", "trace for unknown finding is refused", "GET", `/api/regulatory/trace?auditId=${auditId}&findingId=F-NOT-REAL`, [404, 409]);
add("regulatory", "impact for unknown finding is refused", "GET", `/api/regulatory/impact?auditId=${auditId}&findingId=F-NOT-REAL`, [404, 409]);
add("regulatory", "verification for unknown snapshot is refused", "GET", "/api/regulatory/verification?snapshotId=not-a-snapshot", [404, 503]);
add("policy", "empty policy evaluation is rejected", "POST", "/api/policy/evaluate", [400], json({}));
add("policy", "policy graph requires auditId", "GET", "/api/policy/graph", [400]);
add("policy", "policy coverage requires auditId", "GET", "/api/policy/coverage", [400]);
add("reports", "draft requires auditId", "GET", "/api/reports/draft", [400]);
add("reports", "readiness requires auditId", "GET", "/api/reports/audit-readiness", [400]);
add("reports", "approvals require auditId", "GET", "/api/reports/approvals", [400]);
add("reports", "finalize with empty body is rejected", "POST", "/api/reports/finalize", [400, 409], json({}));
add("reports", "approval route requires auditId", "POST", "/api/reports/NOT-AN-AUDIT/approval-route", [400, 404, 409], json({}));
add("reports", "approval of unknown task is refused", "POST", "/api/reports/approvals/APR-NOT-REAL/approve", [400, 404, 409], json({ decision: "approved", actor: "Pookie" }));
add("graph", "export requires auditId", "GET", "/api/graph/export", [400]);
add("graph", "context requires auditId", "GET", "/api/graph/context", [400]);

/* ------------------------------------------------------------------ transport and routing */
add("http", "unknown API route returns JSON 404", "GET", "/api/nope", [404]);
add("http", "nested unknown API route returns JSON 404", "GET", "/api/nope/deeper", [404]);
add("http", "DELETE on the audit register is not allowed", "DELETE", "/api/domain/audits", [404, 405]);
add("http", "PUT on session is not allowed", "PUT", "/api/session", [404, 405]);
add("http", "PATCH on Kanban is not allowed", "PATCH", "/api/kanban", [404, 405]);
add("http", "malformed JSON is rejected as a client error", "POST", "/api/domain/audits", [400], { raw: "{", contentType: "application/json" });
add("http", "text/plain body is not parsed as JSON", "POST", "/api/domain/audits", [400], { raw: JSON.stringify(audit), contentType: "text/plain" });
add("http", "null transport body is rejected", "POST", "/api/domain/audits", [400], { raw: "null", contentType: "application/json" });
add("http", "array transport body is rejected", "POST", "/api/domain/audits", [400], { raw: "[]", contentType: "application/json" });
// A null byte in the request target may be refused by the CDN edge before the application
  // sees it, so this case asserts refusal status only (an HTML 400 is still a refusal).
  add("http", "null byte in path is refused", "GET", "/api/kanban%00", [400, 404], { json: false });
add("http", "encoded traversal in asset path is refused", "GET", `/api/evidence/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd/download?auditId=${auditId}`, [404]);
add("http", "double-encoded traversal is refused", "GET", `/api/evidence/assets/%252e%252e%252fetc%252fpasswd/download?auditId=${auditId}`, [404]);
add("http", "8k query string does not cause a server error", "GET", `/api/kanban?auditId=${"A".repeat(8000)}`, [400, 404]);
add("http", "openapi document is valid JSON", "GET", "/api/v1/openapi.json", [200]);
add("http", "health endpoint is available", "GET", "/api/health", [200]);
add("http", "MCP discovery is available", "GET", "/mcp", [200]);
add("http", "malformed MCP JSON-RPC returns a JSON error", "POST", "/mcp", [200, 400], { raw: "{", contentType: "application/json" });
add("http", "unknown route answers JSON, not HTML", "GET", "/api/unknown-json-contract", [404]);
add("http", "OPTIONS on the register does not fail", "OPTIONS", "/api/domain/audits", [200, 204, 404]);
add("http", "empty audit path segment is not routable", "GET", "/api/domain/audits/", [200, 404]);
add("http", "HEAD health responds without a body", "HEAD", "/api/health", [200], { json: false });

type ExtraCase = Case & { extraHeaders?: Record<string, string> };

async function main() {
  if (cases.length !== 150) throw new Error(`Expected exactly 150 negative cases, built ${cases.length}`);
  const token = await sdk.signSession({ openId, appId: ENV.appId, name: "Pookie" }, { expiresInMs: 20 * 60 * 1000 });
  const cookie = `${COOKIE_NAME}=${token}`;
  const results: { id: string; group: string; name: string; expected: number[]; status: number; pass: boolean; detail: string }[] = [];
  const fs = await import("node:fs");
  const board: any = await (await fetch(`${base}/api/kanban?auditId=${encodeURIComponent(auditId)}`, { headers: { cookie } })).json();
  const cardId = String(board.items?.[0]?.id ?? "");
  if (!cardId) throw new Error("Negative suite needs at least one real Kanban card for validation cases");
  fs.writeFileSync("/tmp/negative-progress.log", "");
  for (const test of cases as ExtraCase[]) {
    const headers: Record<string, string> = {};
    if (test.auth !== false) headers.cookie = test.cookie ?? cookie;
    if (test.extraHeaders) Object.assign(headers, test.extraHeaders);
    if (test.contentType !== null) headers["content-type"] = test.contentType ?? "application/json";
    let status = 0;
    let text = "";
    const started = Date.now();
    try {
      const response = await fetch(`${base}${test.path.replace("__CARD__", encodeURIComponent(cardId))}`, {
        method: test.method,
        headers,
        body: test.method === "GET" || test.method === "HEAD" ? undefined : test.raw ?? (test.body === undefined ? undefined : JSON.stringify(test.body)),
        signal: AbortSignal.timeout(12_000),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
    }
    const elapsed = Date.now() - started;
    const statusOk = test.expect.includes(status);
    const isApi = test.path.startsWith("/api");
    const contentType = text.trim().startsWith("{") || text.trim().startsWith("[");
    const jsonOk = test.json === false || !isApi || status === 204 || contentType;
    const serverError = status >= 500 && !test.expect.some(value => value >= 500);
    const pass = statusOk && jsonOk && !serverError;
    results.push({ id: test.id, group: test.group, name: test.name, expected: test.expect, status, pass, detail: text.replace(/\s+/g, " ").slice(0, 200) });
    fs.appendFileSync("/tmp/negative-progress.log", `${test.id} ${status} ${elapsed}ms ${test.name}\n`);
    if (!pass) console.log(`FAIL ${test.id} [${test.group}] ${test.name} -> ${status} (expected ${test.expect.join("/")}) ${text.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  const failures = results.filter(result => !result.pass);
  const groups = [...new Set(results.map(result => result.group))];
  console.log("\n=== NEGATIVE TEST SUMMARY ===");
  for (const group of groups) {
    const rows = results.filter(result => result.group === group);
    console.log(`${group.padEnd(11)} ${String(rows.filter(row => row.pass).length).padStart(2)}/${String(rows.length).padEnd(2)} pass`);
  }
  console.log(`TOTAL ${results.length - failures.length}/${results.length} pass, ${failures.length} defect(s)`);
  fs.writeFileSync("/tmp/negative-results.json", JSON.stringify({ base, generatedAt: new Date().toISOString(), total: results.length, failures: failures.length, results }, null, 2));
  process.exit(failures.length ? 1 : 0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
