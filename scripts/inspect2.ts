import "dotenv/config";
import { createPool } from "mysql2/promise";
(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2, timezone: "Z" });
  const [g] = await db.query<any[]>("SELECT record_type,audit_id,COUNT(*) c FROM part21_domain_records GROUP BY record_type,audit_id ORDER BY record_type");
  console.log(g.filter(r => ["person","finding","evidence","audit"].includes(r.record_type)).map(r => `${r.record_type}@${r.audit_id || "(global)"}=${r.c}`).join("  "));
  const [people] = await db.query<any[]>("SELECT record_id,audit_id,payload FROM part21_domain_records WHERE record_type='person' LIMIT 10");
  for (const p of people) { const v = typeof p.payload === "string" ? JSON.parse(p.payload) : p.payload; console.log("PERSON", p.record_id, "audit:", p.audit_id || "(global)", "|", v.name, "|", v.roleId ?? v.role, "| synthetic:", v.synthetic); }
  const [ev] = await db.query<any[]>("SELECT event_id,event_type,occurred_at,payload FROM part21_assurance_events WHERE entity_id IN ('F-042','AUD-026') ORDER BY occurred_at LIMIT 8");
  for (const e of ev) console.log("EVENT", e.occurred_at, e.event_type, String(e.payload).slice(0,140));
  await db.end();
})().catch(e => { console.error("FAILED", e.message); process.exit(1); });
