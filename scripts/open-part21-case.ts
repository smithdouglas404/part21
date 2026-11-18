import "dotenv/config";
import { createPool } from "mysql2/promise";
import { createPart21CaseRecord, getPart21Case } from "../server/part21-case";
(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2, timezone: "Z" });
  const [rows] = await db.query<any[]>("SELECT record_id,created_at FROM part21_domain_records WHERE record_type='finding' AND record_id='F-042'");
  const [cols] = await db.query<any[]>("SHOW COLUMNS FROM part21_domain_records");
  const timeCol = cols.map(c => c.Field).find(f => /created/i.test(f)) ?? null;
  let documentedAt = new Date().toISOString();
  if (timeCol) { const [t] = await db.query<any[]>(`SELECT \`${timeCol}\` v FROM part21_domain_records WHERE record_type='finding' AND record_id='F-042'`); if (t[0]?.v) documentedAt = new Date(t[0].v).toISOString(); }
  const principal: any = { id: "demo-owner", actor: "Demonstration owner (database administrator)", roleIds: ["quality"], isAdmin: true, qualified: false, access: "make_changes", auditIds: ["AUD-026"], auditWriteIds: ["AUD-026"], qualifiedAuditIds: [] };
  const existing = await db.query<any[]>("SELECT record_id FROM part21_domain_records WHERE record_type='part21_case' AND record_id='P21-2026-001'");
  if ((existing[0] as any[]).length) { console.log("case already exists"); }
  else {
    const created = await createPart21CaseRecord({
      auditId: "AUD-026", caseId: "P21-2026-001",
      title: "Receiving inspection heat-lot chain — record 2-481 / heat 7B-441",
      findingId: "F-042", productId: "NSS-4820", documentedAt,
      basis: "Receiving inspection report 2-481 could not resolve the heat-lot chain for heat 7B-441; opened from the existing finding and its retained evidence.",
      reviewerPersonId: "P-002",
      evidence: [{ id: "EV-803", kind: "evidence", note: "Receiving inspection report 2-481" }, { id: "EV-771", kind: "evidence", note: "Heat 7B-441 certificate" }],
    }, principal);
    console.log("created", created.caseId, "discovery", created.facts.discovery?.documentedAt);
  }
  const view = await getPart21Case("AUD-026", "P21-2026-001", principal, { timezone: "America/New_York" });
  console.log("BRANCHES");
  for (const b of view.branches) console.log(` ${String(b.status).padEnd(18)} ${String(b.citation).padEnd(20)} due ${String(b.dueAt)} (${b.daysRemaining}d) gate=${b.gateId}`);
  console.log("GATES recorded:", view.gates.filter(g => g.state === "recorded").map(g => g.id).join(",") || "none");
  await db.end();
  process.exit(0);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
