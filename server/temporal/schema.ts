export const DEADLINE_SCHEMA_VERSION = 1;
/** Explicit operator migration only. Never run from worker/endpoints/startup. */
export const DEADLINE_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS part21_cases (
    audit_id VARCHAR(180) NOT NULL, case_id VARCHAR(180) NOT NULL, version BIGINT UNSIGNED NOT NULL,
    state JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (audit_id,case_id), UNIQUE KEY idx_canonical_case (case_id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS part21_case_events (
    audit_id VARCHAR(180) NOT NULL, case_id VARCHAR(180) NOT NULL, event_id VARCHAR(180) NOT NULL,
    expected_version BIGINT UNSIGNED NOT NULL, version BIGINT UNSIGNED NOT NULL, actor VARCHAR(180) NOT NULL,
    occurred_at VARCHAR(40) NOT NULL, committed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    request_sha256 CHAR(64) NOT NULL, payload JSON NOT NULL, state JSON NOT NULL,
    PRIMARY KEY (audit_id,event_id), UNIQUE KEY idx_case_revision (audit_id,case_id,version)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS part21_deadlines (
    audit_id VARCHAR(180) NOT NULL, case_id VARCHAR(180) NOT NULL, branch VARCHAR(80) NOT NULL,
    version BIGINT UNSIGNED NOT NULL, due_at VARCHAR(40) NOT NULL, deadline JSON NOT NULL,
    PRIMARY KEY (audit_id,case_id,branch,version)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS part21_deadline_outbox (
    audit_id VARCHAR(180) NOT NULL, case_id VARCHAR(180) NOT NULL, event_id VARCHAR(180) NOT NULL,
    version BIGINT UNSIGNED NOT NULL, payload JSON NOT NULL,
    status ENUM('committed','delivered','applied','rejected') NOT NULL DEFAULT 'committed',
    attempts INT UNSIGNED NOT NULL DEFAULT 0, lease_token VARCHAR(180) NULL, lease_until DATETIME(3) NULL,
    delivered_at DATETIME(3) NULL, applied_at DATETIME(3) NULL, last_error TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (audit_id,event_id), INDEX idx_outbox_pending (status,lease_until), INDEX idx_outbox_case (audit_id,case_id,version)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS part21_deadline_notices (
    notice_key CHAR(64) PRIMARY KEY, audit_id VARCHAR(180) NOT NULL, case_id VARCHAR(180) NOT NULL,
    branch VARCHAR(80) NOT NULL, due_at VARCHAR(40) NOT NULL, observed_at VARCHAR(40) NOT NULL,
    payload JSON NOT NULL, recorded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_notices_scope (audit_id,case_id)) ENGINE=InnoDB`,
] as const;
