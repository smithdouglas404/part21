import "dotenv/config";
import { applyDeadlineSchemaMigration, createDeadlineDatabasePool } from "../server/deadline-store";
(async () => {
  const pool = createDeadlineDatabasePool(process.env);
  await applyDeadlineSchemaMigration({ pool });
  console.log("deadline schema applied");
  await pool.end(); process.exit(0);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
