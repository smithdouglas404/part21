import "dotenv/config";
import { createPool } from "mysql2/promise";
import { migrateEvidenceVault } from "../server/vault/migrations";

/**
 * Applies the reviewed evidence-vault DDL. Migrations are explicit and idempotent, never run at
 * request time: a missing table must fail loudly in deployment, not create schema mid-audit.
 */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const db = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 });
  await migrateEvidenceVault({ query: sql => db.query(sql) });
  const [rows] = await db.query<any[]>("SELECT COUNT(*) AS tables_present FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'part21_evidence%'");
  console.log(`Evidence vault migration applied; ${rows[0]?.tables_present ?? 0} evidence tables present.`);
  await db.end();
  process.exit(0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
