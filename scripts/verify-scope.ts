import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

/**
 * Reports the authenticated principal's scope and proves read/write permission per audit against
 * the live HTTP surface. Write permission is tested with an intentionally invalid card (empty
 * title): a write-authorized principal reaches validation and gets 400, a read-only or
 * out-of-scope principal is refused with 403/404 before anything is persisted.
 */
const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";

async function main() {
  const token = await sdk.signSession({ openId: process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS", appId: ENV.appId, name: "Frank" }, { expiresInMs: 15 * 60 * 1000 });
  const cookie = `${COOKIE_NAME}=${token}`;
  const session: any = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
  const p = session.principal;
  console.log(`actor=${p.actor} role=${(p.roleIds ?? []).join(",")} admin=${p.isAdmin} access=${p.access} qualified=${p.qualified}`);
  console.log(`auditIds(${p.auditIds?.length ?? 0})=${(p.auditIds ?? []).join(",")}`);
  console.log(`auditWriteIds(${p.auditWriteIds?.length ?? 0})=${(p.auditWriteIds ?? []).join(",")}`);
  console.log(`qualifiedAuditIds(${p.qualifiedAuditIds?.length ?? 0})=${(p.qualifiedAuditIds ?? []).join(",")}`);
  const register: any = await (await fetch(`${base}/api/domain/audits`, { headers: { cookie } })).json();
  console.log(`register=${register.audits.length} of ${register.total ?? "?"} audits\n`);
  console.log("audit   read  write  qualified  title");
  for (const audit of register.audits) {
    const auditId = String(audit.id);
    const read = await fetch(`${base}/api/kanban?auditId=${encodeURIComponent(auditId)}`, { headers: { cookie } });
    const write = await fetch(`${base}/api/kanban/items`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ auditId, title: "" }),
    });
    const readOk = read.status === 200;
    const writeOk = write.status === 400;
    const qualified = (p.qualifiedAuditIds ?? []).includes(auditId);
    console.log(`${auditId}  ${readOk ? "yes " : `no(${read.status})`}  ${writeOk ? "yes " : `no(${write.status})`}  ${qualified ? "yes" : "no "}       ${audit.title}`);
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
