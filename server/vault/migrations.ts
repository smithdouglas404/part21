export interface MigrationExecutor { query(sql: string): Promise<unknown> }

/** Parent-owned deployment must invoke explicitly after review. No runtime DDL or automatic migration. */
export const evidenceMigrationStatements = [
  `CREATE TABLE IF NOT EXISTS part21_evidence_versions (
    asset_id VARCHAR(180) NOT NULL, audit_id VARCHAR(180) NOT NULL, revision INT UNSIGNED NOT NULL,
    owner_type VARCHAR(80) NOT NULL, owner_id VARCHAR(180) NOT NULL,
    original_bytes LONGBLOB NULL, sha256 CHAR(64) NOT NULL, size_bytes BIGINT UNSIGNED NOT NULL,
    metadata JSON NOT NULL, external_status VARCHAR(40) NOT NULL, external_reference JSON NULL,
    external_error TEXT NULL, recorded_at DATETIME(3) NOT NULL,
    PRIMARY KEY(asset_id,audit_id,revision), INDEX idx_evidence_owner(audit_id,owner_type,owner_id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS part21_record_revisions (
    record_type VARCHAR(80) NOT NULL, record_id VARCHAR(180) NOT NULL, audit_id VARCHAR(180) NOT NULL,
    revision INT UNSIGNED NOT NULL, payload JSON NOT NULL, payload_sha256 CHAR(64) NOT NULL,
    actor VARCHAR(255) NOT NULL, recorded_at DATETIME(3) NOT NULL,
    PRIMARY KEY(record_type,record_id,audit_id,revision)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS part21_evidence_streams (
    audit_id VARCHAR(180) NOT NULL, entity_id VARCHAR(180) NOT NULL,
    last_revision INT UNSIGNED NOT NULL DEFAULT 0, last_hash CHAR(64) NULL,
    PRIMARY KEY(audit_id,entity_id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS part21_evidence_events (
    id VARCHAR(180) NOT NULL PRIMARY KEY, audit_id VARCHAR(180) NOT NULL, entity_id VARCHAR(180) NOT NULL,
    revision INT UNSIGNED NOT NULL, event_type VARCHAR(160) NOT NULL, actor VARCHAR(255) NOT NULL,
    occurred_at DATETIME(3) NOT NULL, payload JSON NOT NULL, previous_hash CHAR(64) NULL, event_hash CHAR(64) NOT NULL,
    UNIQUE KEY idx_custody_revision(audit_id,entity_id,revision), INDEX idx_custody_time(audit_id,occurred_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS part21_evidence_proofs (
    event_id VARCHAR(180) NOT NULL, audit_id VARCHAR(180) NOT NULL, provider VARCHAR(80) NOT NULL,
    proof JSON NOT NULL, verified_at DATETIME(3) NOT NULL,
    PRIMARY KEY(event_id,audit_id,provider)
  ) ENGINE=InnoDB`,
] as const;
export async function migrateEvidenceVault(executor: MigrationExecutor): Promise<void> {
  for (const sql of evidenceMigrationStatements) await executor.query(sql);
}
