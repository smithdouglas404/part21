import crypto from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";

/**
 * Muse connector settings.
 *
 * Three states, all off by default:
 *  1. adminSharedEnabled - the administrator's own connector serves the administrator.
 *  2. appWideEnabled     - everyone may borrow the administrator connector.
 *  3. per-user connector - a person supplies their own; it never affects anyone else.
 *
 * Resolution: own connector -> admin-shared (only when app-wide is on) -> none (built-in agent).
 * Tokens are encrypted at rest with AES-256-GCM. No token is ever returned to a browser.
 */

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3, waitForConnections: true });
  return pool;
}
let ready = false;
async function ensure() {
  if (ready) return;
  await db().query(`CREATE TABLE IF NOT EXISTS part21_app_settings (
    setting_key VARCHAR(80) PRIMARY KEY, value JSON NOT NULL,
    updated_by VARCHAR(180) NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  await db().query(`CREATE TABLE IF NOT EXISTS part21_user_connectors (
    principal_id VARCHAR(180) PRIMARY KEY, label VARCHAR(120) NOT NULL, base_url VARCHAR(500) NOT NULL,
    token_cipher TEXT NOT NULL, token_last4 VARCHAR(8) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
  ready = true;
}

let cachedKey: Buffer | null = null;
let keySource: "environment" | "database" = "environment";
/**
 * Resolves the connector encryption key. An operator-supplied PART21_SETTINGS_KEY wins;
 * otherwise a 32-byte key is generated once and stored in the application settings table
 * so personal connectors work without a manual step. The source is reported, never hidden:
 * a database-held key protects against casual disclosure but not against full database access.
 */
async function encryptionKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const raw = process.env.PART21_SETTINGS_KEY;
  if (raw) {
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length !== 32) throw new Error("PART21_SETTINGS_KEY must be 32 bytes, base64 encoded.");
    cachedKey = bytes; keySource = "environment"; return bytes;
  }
  await ensure();
  const [rows] = await db().query<any[]>("SELECT value FROM part21_app_settings WHERE setting_key='settings.encryption_key'");
  if (rows[0]) {
    const value = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
    cachedKey = Buffer.from(String(value), "base64"); keySource = "database"; return cachedKey;
  }
  const generated = crypto.randomBytes(32);
  await db().query("INSERT INTO part21_app_settings (setting_key, value, updated_by) VALUES ('settings.encryption_key', ?, 'system-generated') ON DUPLICATE KEY UPDATE value=VALUES(value)", [JSON.stringify(generated.toString("base64"))]);
  cachedKey = generated; keySource = "database"; return generated;
}
export function encryptionKeySource() { return keySource; }
function encrypt(plain: string, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}
function decrypt(payload: string, key: Buffer) {
  const [ivB64, tagB64, bodyB64] = payload.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(bodyB64, "base64")), decipher.final()]).toString("utf8");
}

export type MuseSettings = { adminSharedEnabled: boolean; appWideEnabled: boolean; updatedBy: string | null; updatedAt: string | null };
const ADMIN_KEY = "muse.admin_shared_enabled";
const APP_WIDE_KEY = "muse.app_wide_enabled";

export async function getMuseSettings(): Promise<MuseSettings> {
  await ensure();
  const [rows] = await db().query<any[]>("SELECT setting_key, value, updated_by, updated_at FROM part21_app_settings WHERE setting_key IN (?,?)", [ADMIN_KEY, APP_WIDE_KEY]);
  const map = new Map<string, any>(rows.map((row: any) => [row.setting_key, row]));
  const flag = (k: string) => {
    const row = map.get(k);
    if (!row) return false;
    const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    return value === true || value === 1 || value === "true";
  };
  const latest = rows.map((row: any) => row.updated_at).filter(Boolean).sort().pop() ?? null;
  return { adminSharedEnabled: flag(ADMIN_KEY), appWideEnabled: flag(APP_WIDE_KEY), updatedBy: rows[0]?.updated_by ?? null, updatedAt: latest ? new Date(latest).toISOString() : null };
}

export async function setMuseSettings(patch: { adminSharedEnabled?: boolean; appWideEnabled?: boolean }, actor: string): Promise<MuseSettings> {
  await ensure();
  const writes: Array<[string, boolean]> = [];
  if (typeof patch.adminSharedEnabled === "boolean") writes.push([ADMIN_KEY, patch.adminSharedEnabled]);
  if (typeof patch.appWideEnabled === "boolean") writes.push([APP_WIDE_KEY, patch.appWideEnabled]);
  for (const [k, v] of writes) {
    await db().query("INSERT INTO part21_app_settings (setting_key, value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value=VALUES(value), updated_by=VALUES(updated_by)", [k, JSON.stringify(v), actor]);
  }
  return getMuseSettings();
}

export type UserConnectorStatus = { configured: boolean; label: string | null; baseUrl: string | null; last4: string | null; updatedAt: string | null };

export async function getUserConnectorStatus(principalId: string): Promise<UserConnectorStatus> {
  await ensure();
  const [rows] = await db().query<any[]>("SELECT label, base_url, token_last4, updated_at FROM part21_user_connectors WHERE principal_id=?", [principalId]);
  const row = rows[0];
  if (!row) return { configured: false, label: null, baseUrl: null, last4: null, updatedAt: null };
  return { configured: true, label: row.label, baseUrl: row.base_url, last4: row.token_last4, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function setUserConnector(principalId: string, input: { label?: string; baseUrl: string; token: string }): Promise<UserConnectorStatus> {
  await ensure();
  const baseUrl = input.baseUrl.trim();
  const token = input.token.trim();
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("Connector base URL must be HTTPS.");
  if (token.length < 12) throw new Error("Connector token is too short to be a real credential.");
  const label = (input.label?.trim() || "Personal Muse connector").slice(0, 120);
  await db().query(
    "INSERT INTO part21_user_connectors (principal_id, label, base_url, token_cipher, token_last4) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label), base_url=VALUES(base_url), token_cipher=VALUES(token_cipher), token_last4=VALUES(token_last4)",
    [principalId, label, baseUrl, encrypt(token, await encryptionKey()), token.slice(-4)]
  );
  return getUserConnectorStatus(principalId);
}

export async function deleteUserConnector(principalId: string) {
  await ensure();
  await db().query("DELETE FROM part21_user_connectors WHERE principal_id=?", [principalId]);
  return getUserConnectorStatus(principalId);
}

export type ResolvedConnector = { source: "user" | "admin-shared" | "none"; baseUrl: string | null; token: string | null; reason: string };

/**
 * Resolves which Muse connector may act for this principal. Never returns another person's token.
 */
export async function resolveMuseConnector(principalId: string): Promise<ResolvedConnector> {
  await ensure();
  const [rows] = await db().query<any[]>("SELECT base_url, token_cipher FROM part21_user_connectors WHERE principal_id=?", [principalId]);
  const own = rows[0];
  if (own) {
    try {
      return { source: "user", baseUrl: own.base_url, token: decrypt(own.token_cipher, await encryptionKey()), reason: "Using the connector this person supplied." };
    } catch {
      return { source: "none", baseUrl: null, token: null, reason: "Stored connector could not be decrypted with the current key; reconnect required." };
    }
  }
  const settings = await getMuseSettings();
  const adminToken = process.env.MUSE_ADMIN_TOKEN;
  if (settings.appWideEnabled && adminToken) {
    return { source: "admin-shared", baseUrl: process.env.MUSE_ADMIN_BASE_URL || "https://studio.innume.com/api/v1", token: adminToken, reason: "App-wide sharing is enabled by the administrator." };
  }
  return { source: "none", baseUrl: null, token: null, reason: settings.appWideEnabled ? "App-wide sharing is enabled but no administrator connector is configured." : "No personal connector and app-wide sharing is off; the built-in grounded agent is used." };
}

export async function museReadiness(principalId: string) {
  const settings = await getMuseSettings();
  const own = await getUserConnectorStatus(principalId);
  const resolved = await resolveMuseConnector(principalId);
  return {
    settings,
    you: own,
    effective: { source: resolved.source, baseUrl: resolved.baseUrl, reason: resolved.reason },
    adminConnectorConfigured: Boolean(process.env.MUSE_ADMIN_TOKEN),
    encryptionConfigured: true,
    encryptionSource: encryptionKeySource(),
    fallback: "Built-in grounded agent (database + graph) when no connector resolves.",
  };
}
