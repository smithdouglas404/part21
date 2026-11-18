import "dotenv/config";
import { createPool } from "mysql2/promise";
(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
  const [rows] = await db.query<any[]>("SELECT kind,status,COUNT(*) c FROM part21_controlled_configuration GROUP BY kind,status");
  console.log(rows.map(r=>`${r.kind}/${r.status}=${r.c}`).join("  "));
  await db.end(); process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
