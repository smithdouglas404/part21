import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";
let failures = 0;

function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}${detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 400)}`}`);
}

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

async function main() {
  const session = await sdk.signSession({ openId: process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS", appId: ENV.appId, name: "Frank" }, { expiresInMs: 15 * 60 * 1000 });
  const cookie = `${COOKIE_NAME}=${session}`;

  const me = await json("/api/session", { headers: { cookie } });
  check(me.body?.principal?.actor === "Frank", "session actor is Frank", me.body?.principal?.actor);
  check(me.body?.principal?.isAdmin === true, "Frank retains administrator authority");
  check(Array.isArray(me.body?.principal?.permissions) && me.body.principal.permissions.includes("*"), "administrator receives the full permission wildcard", me.body?.principal?.permissions);

  const snapshot = await json("/api/admin/rbac", { headers: { cookie } });
  check(snapshot.status === 200, "RBAC snapshot is readable by an administrator", snapshot.body?.error);
  check((snapshot.body?.roles ?? []).length >= 10, "role catalog is persisted", snapshot.body?.roles?.length);
  check((snapshot.body?.people ?? []).length >= 14, "named directory is persisted", snapshot.body?.people?.length);
  check((snapshot.body?.assignments ?? []).length >= 90, "audit access assignments are persisted", snapshot.body?.assignments?.length);
  check(snapshot.body?.users?.[0]?.name === "Frank", "user directory shows Frank", snapshot.body?.users);

  const lookToken = await json("/api/v1/connect/tokens", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ label: "RBAC look-only verification", actor: "Elena Vasquez", role: "auditor", auditId: "AUD-026", access: "look_only" }),
  });
  check(lookToken.status === 200 && Boolean(lookToken.body?.token), "look-only connector token created", lookToken.body?.error);
  const lookAuth = { authorization: `Bearer ${lookToken.body.token}` };
  const lookSession = await json("/api/session", { headers: lookAuth });
  check(lookSession.body?.principal?.actor === "Elena Vasquez", "connector resolves the named actor", lookSession.body?.principal?.actor);
  check(lookSession.body?.principal?.access === "look_only", "connector remains look-only");
  check((lookSession.body?.permissions ?? []).includes("audit.read"), "auditor role grants audit read", lookSession.body?.permissions);
  const lookWrite = await json("/api/kanban/items", {
    method: "POST",
    headers: { ...lookAuth, "content-type": "application/json" },
    body: JSON.stringify({ auditId: "AUD-026", title: "Permission probe" }),
  });
  check(lookWrite.status === 403, "look-only connector cannot write", lookWrite.status);
  check(/look-only|do not have permission/i.test(String(lookWrite.body?.error ?? "")), "look-only denial is polite and explicit", lookWrite.body?.error);

  const writeToken = await json("/api/v1/connect/tokens", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ label: "RBAC role-bound verification", actor: "Alex Rivera", role: "auditor", auditId: "AUD-026", access: "make_changes" }),
  });
  const writeAuth = { authorization: `Bearer ${writeToken.body.token}` };
  const roleDenied = await json("/api/reports/finalize", {
    method: "POST",
    headers: { ...writeAuth, "content-type": "application/json" },
    body: JSON.stringify({ auditId: "AUD-026", approved: true, auditorNarrative: "Permission probe" }),
  });
  check(roleDenied.status === 403, "auditor cannot approve a final report", roleDenied.status);
  check(/do not have permission/i.test(String(roleDenied.body?.error ?? "")), "role denial names the missing permission", roleDenied.body?.error);
  const adminDenied = await json("/api/admin/rbac/roles", {
    method: "POST",
    headers: { ...writeAuth, "content-type": "application/json" },
    body: JSON.stringify({ id: "auditor", name: "Auditor", permissions: ["audit.read"] }),
  });
  check(adminDenied.status === 403, "non-administrator cannot change role definitions", adminDenied.status);
  check(/do not have permission/i.test(String(adminDenied.body?.error ?? "")), "administration denial is polite", adminDenied.body?.error);

  await json(`/api/v1/connect/tokens/${lookToken.body.tokenId}/revoke`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  await json(`/api/v1/connect/tokens/${writeToken.body.tokenId}/revoke`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  console.log(`\n${failures === 0 ? "RBAC verification passed" : `${failures} RBAC check(s) failed`}`);
  process.exit(failures ? 1 : 0);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
