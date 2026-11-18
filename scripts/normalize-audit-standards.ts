import "dotenv/config";
import { createPool } from "mysql2/promise";
const MAP: Record<string, string> = {
  "AUD-005": "10 CFR Part 21 §21.21(b) · App B IV/VII",
  "AUD-008": "10 CFR Part 21 §21.51 · App B XVII",
  "AUD-011": "10 CFR Part 21 §21.51 · App B XVII",
  "AUD-014": "10 CFR Part 21 §21.51/§21.61 · App B XVII",
  "AUD-017": "10 CFR Part 21 §21.1/§21.2 · App B I/II",
  "AUD-019": "10 CFR Part 21 §21.21(a) · App B XV/XVI",
  "AUD-021": "10 CFR Part 21 §21.21(b) · App B IV/VII",
  "AUD-026": "10 CFR Part 21 §21.3/§21.21 · App B III/VII/XVII",
};
(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
  let n = 0;
  for (const [id, standard] of Object.entries(MAP)) {
    const [r] = await db.query<any[]>("UPDATE part21_domain_records SET payload=JSON_SET(payload,'$.standard',?) WHERE record_type='audit' AND record_id=?", [standard, id]);
    n += r.affectedRows;
  }
  const [rows] = await db.query<any[]>("SELECT record_id, JSON_UNQUOTE(JSON_EXTRACT(payload,'$.standard')) s FROM part21_domain_records WHERE record_type='audit' ORDER BY record_id");
  console.log("updated:", n);
  for (const r of rows) console.log(" ", r.record_id, "|", r.s);
  await db.end(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
