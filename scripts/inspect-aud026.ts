import "dotenv/config";
import { createPool } from "mysql2/promise";
(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2, timezone: "Z" });
  const [findings] = await db.query<any[]>("SELECT record_id,payload FROM part21_domain_records WHERE record_type='finding' AND audit_id='AUD-026'");
  for (const f of findings) { const p = typeof f.payload === "string" ? JSON.parse(f.payload) : f.payload; console.log("FINDING", f.record_id, "|", p.title, "|", p.severity, "|", p.raisedAt ?? p.openedAt ?? p.createdAt ?? "no-date", "|", p.status); }
  const [ev] = await db.query<any[]>("SELECT record_id,payload FROM part21_domain_records WHERE record_type='evidence' AND audit_id='AUD-026' LIMIT 12");
  for (const e of ev) { const p = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload; console.log("EVIDENCE", e.record_id, "|", p.title ?? p.name, "| findings:", JSON.stringify(p.findingIds ?? p.linkedFindingIds ?? null)); }
  const [people] = await db.query<any[]>("SELECT record_id,payload FROM part21_domain_records WHERE record_type='person' AND audit_id='AUD-026' LIMIT 8");
  for (const p of people) { const v = typeof p.payload === "string" ? JSON.parse(p.payload) : p.payload; console.log("PERSON", p.record_id, "|", v.name, "|", v.roleId ?? v.role, "| synthetic:", v.synthetic); }
  await db.end();
})().catch(e => { console.error("FAILED", e.message); process.exit(1); });
