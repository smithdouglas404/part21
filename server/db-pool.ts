/**
 * Shared lazy MySQL pool for administrative reads.
 *
 * The application already reaches the database through the domain, graph and evidence stores.
 * This module exists for narrow read-only queries (governance state, coverage reporting) that
 * must not construct a store or take a write path. It never creates schema.
 */
import { createPool, type Pool } from "mysql2/promise";

let pool: Pool | null = null;

function database(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required; no in-memory fallback exists.");
    pool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 4, waitForConnections: true });
  }
  return pool;
}

export async function query<T = any>(sql: string, values?: any[]): Promise<[T[], any]> {
  return database().query(sql, values) as Promise<[T[], any]>;
}

export async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}
