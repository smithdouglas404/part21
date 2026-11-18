# Hard-coding and demo-data audit

Date: 2026-11-17

## Executive assessment

The application is **partially database-backed**, not fully database-backed.

The live compliance-agent grounding path and visible genealogy graph now read from the configured MySQL database graph projection:

- `part21_graph_nodes`
- `part21_graph_edges`
- `part21_graph_events`

The current runtime verified `source = mysql-database`, with 8 graph nodes, 8 edges, and 5 temporal events.

However, several surrounding product surfaces still use TypeScript demo fixtures or file-backed demo storage. Those areas must be migrated before claiming that the whole application is driven by the database.

## Green: already database-backed for the live graph path

### Live grounded LLM

`server/ai.ts` calls `getGroundedGraphContext()` from `server/graph-store.ts` before invoking the live model. The packet includes database graph nodes, edges, temporal events, source IDs, and graph source metadata.

### Genealogy graph UI

`client/src/pages/Home.tsx` `GraphView` requests `/api/graph/context` and renders the database projection when available. It only uses `getAuditGraphProjection()` as a fallback when the database response is unavailable or empty.

### Graph persistence

`server/graph-store.ts` creates and reads the three MySQL graph tables. Seed synchronization is insert-only, so it does not overwrite existing graph rows on subsequent calls.

## Amber: database exists, but the implementation still has demo or fallback behavior

### Graph seed source

`server/graph-store.ts` seeds the database from `shared/demo.ts` `graphNodes` and `graphEdges`, plus `shared/ontology.ts` `temporalRecords`. This is acceptable for a synthetic demo bootstrap, but a production ingestion pipeline must replace the seed source with normalized ERP, supplier, document, configuration, and workbook adapters.

### AI deterministic fallback

`server/ai.ts` `answerGroundedQuestion()` still reads `graphNodes`, `getTemporalHistory()`, and fixed regulatory context. This is intentionally the deterministic fallback, but it should eventually call the same database graph reader as the live path.

### PostgreSQL ontology adapter

`server/ontology-store.ts` uses `POSTGRES_URL` and is separate from the working MySQL graph store that uses `DATABASE_URL`. It is an optional synchronization adapter, not the active source of truth for the current live graph path. The product should converge on one database contract.

### Event store

`server/event-store.ts` persists events in append-only JSONL files under `PART21_DATA_DIR`. This currently stores warning acknowledgments, workbook events, document events, and weekly sync events, but is not yet a qualified database event store.

## Red: TypeScript demo data still used as runtime application data

### Dashboard and portfolio data

`shared/demo.ts` defines runtime fixtures for:

- `audits`
- `findings`
- `evidence`
- `controls`
- `sources`
- `activity`
- `metrics`
- `timelineEvents`
- `mcpTools`
- audit-specific projection maps

`client/src/pages/Home.tsx` imports and renders many of these directly. The dashboard, audit portfolio, evidence register, controls, and source health cards are therefore still fixture-driven.

### Additional dashboard rows created in the client

`client/src/pages/Home.tsx` contains additional hard-coded collections:

- `dashboardFindings`
- `supplierExposureRows`
- `changeRows`
- `priorReports`
- `documentRevisions`

These should become database queries or graph projections. They are not currently authoritative records.

### MCP dispatch

`server/mcp.ts` imports `audits`, `controls`, `evidence`, `findings`, `graphNodes`, `graphEdges`, and `timelineEvents` from `shared/demo.ts`. Several callable MCP tools therefore return TypeScript fixtures instead of querying the database graph or audit tables.

### AgentKit reports and simulations

`server/agentkit.ts` imports `audits`, `controls`, `evidence`, `findings`, `metrics`, and `sources` from `shared/demo.ts`. Report drafts, simulations, and manifest examples therefore contain hard-coded demo values even when they are presented as traceable outputs.

### Document control

`server/document-control.ts` seeds controlled documents with synthetic metadata and stores uploaded content on the local filesystem. This is useful for demonstration, but it is not yet a database-backed controlled-document repository with durable revision records.

### Evidence intake

`server/evidence.ts` stores uploaded evidence in demo runtime memory and uses hard-coded report linkage and regulatory context. Evidence metadata, hashes, audit links, and verification decisions should be durable database records.

### Weekly synchronization

`server/weekly-sync.ts` uses shared policy and report helpers. It can inspect workbook changes, but the compliance report still contains fixture-derived audit data until audit, finding, evidence, and control entities are migrated.

## Not considered a problem: configuration and product logic

These are not inherently bad hard-coding because they describe application behavior or controlled configuration rather than transaction data:

- `shared/skills.ts` — skill definitions, questions, routes, and human gates.
- `shared/ecc.ts` — embedded skill/module catalog metadata.
- `shared/personas.ts` — persona lenses and default guidance.
- `shared/execution.ts` — connector contracts and simulation route definitions.
- `shared/governance.ts` — demo governance workflow configuration.
- `shared/regulatory.ts` — source-linked regulatory pack configuration, though it still needs controlled versioning and update workflow.
- `shared/policy.ts` — executable policy rule definitions, provided they are versioned and approved.
- `shared/ontology.ts` — ontology schema definitions; the instance data in this file should move to the graph database.

## Recommended migration order

### 1. Create durable audit-domain tables

Add tables for:

- audits
- audit_members / roles
- findings
- evidence_records
- controls
- suppliers
- products
- changes
- controlled_documents
- report_drafts
- prior_reports
- audit_decisions

### 2. Make the graph the normalized projection

All authoritative domain writes should produce:

- graph node upsert
- graph edge upsert
- bitemporal event append
- source provenance
- actor identity
- audit scope
- approval state

### 3. Replace MCP fixture reads

Each MCP tool should query the database or graph projection. A tool response should include `source`, `recordIds`, `asOf`, `graphVersion`, and `humanReviewRequired`.

### 4. Replace client fixture reads

The client should load portfolio, finding, evidence, supplier, change, control, and report data from API endpoints. TypeScript constants should remain only as empty-state examples or seed scripts.

### 5. Unify persistence

Choose the production database contract. The current code has both:

- MySQL through `DATABASE_URL` for the active graph store.
- PostgreSQL through `POSTGRES_URL` for the optional ontology adapter.

This should be consolidated rather than left as two competing persistence paths.

### 6. Replace file-backed event storage

Move `server/event-store.ts` to the qualified database event store with append-only semantics, retention, access control, backup, and optional hash-chain or Hedera notarization for finalized packages.

## Current honest claim

The correct statement today is:

> The live compliance-agent demonstration is grounded in a MySQL-backed Part 21 graph projection and temporal event history. The application shell still contains synthetic TypeScript fixtures for several dashboard, MCP, report, document, and audit-management surfaces. Those fixtures are safe demo seed data, not the final system of record.
