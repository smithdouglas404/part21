import "dotenv/config";
import { createPool } from "mysql2/promise";
import { migrateDomainStore } from "../server/domain-store";
(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2, timezone: "Z" });
  await migrateDomainStore(db);
  const [cols] = await db.query<any[]>("SHOW COLUMNS FROM part21_domain_records");
  console.log("domain columns:", cols.map(c => c.Field).join(","));
  await db.end();
  console.log("migrated");
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
