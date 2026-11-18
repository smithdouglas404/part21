# Controlled documents, qualified records, and Hedera demonstration

## What the application now demonstrates

The Document Control workspace is a working application surface, not only a placeholder:

- Upload a document from the browser.
- Store its bytes in the local controlled-document store.
- Calculate and display SHA-256 content integrity.
- Assign document number, revision, effective date, audit links, tags, and source.
- Apply a retention policy and retain-until date.
- Record legal-hold state and disposition policy.
- Perform a cybersecurity review with reviewer, timestamp, and controls.
- Record document lifecycle events in the append-only event ledger.
- Produce a simulated Hedera notarization payload and show its hash data.

The API endpoints are:

```text
GET  /api/document-control/status
GET  /api/documents?auditId=AUD-026
POST /api/documents
POST /api/documents/:documentId/cybersecurity-review
POST /api/documents/:documentId/notarize
```

## Hedera example

The demo creates a canonical payload containing:

```json
{
  "documentId": "DOC-PROC-SUP-021",
  "documentNumber": "PROC-SUP-021",
  "revision": "C",
  "sha256": "document-content-hash",
  "effectiveDate": "2026-11-10",
  "auditIds": ["AUD-026"]
}
```

It then creates:

- A payload hash.
- A message hash derived from the document hash.
- A Hedera-style topic ID.
- A Hedera-style transaction ID.
- A timestamp.
- A simulated status.

The UI makes the proof clickable and exposes the canonical payload. The demo explicitly states that no external Hedera transaction was submitted.

## Why this is useful

A distributed ledger can provide an independent timestamp and tamper-evidence anchor for a completed audit package. It does not replace:

- The controlled record system.
- Retention and disposition rules.
- Access control.
- Qualified electronic signatures.
- Immutable internal event logging.
- Source evidence.
- NRC or client notification decisions.

A real implementation should generally store the audit package in the qualified records system, calculate a canonical package hash, and place only the minimum necessary proof metadata on a ledger. Do not place sensitive nuclear, personal, export-controlled, or security-sensitive document contents on a public network.

## Production hardening still required

Before relying on this operationally, the client would need a qualified repository or records-management platform, RBAC/segregation of duties, legal hold workflows, retention schedules, WORM or equivalent immutability controls, malware scanning, DLP, backup/restore evidence, security review, key custody, Hedera account governance if selected, and a validation package.
