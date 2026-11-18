# Database migration status

## Enforced boundary

Operational Part 21 records now require `DATABASE_URL`. If it is absent, the application fails with an explicit configuration error; it does not silently substitute TypeScript arrays or in-memory state.

## Database-backed domain records

The MySQL table `part21_domain_records` is the durable operational projection for:

- audits;
- findings;
- evidence records;
- controls;
- source connectors;
- readiness metrics;
- suppliers;
- engineering/configuration changes;
- controlled documents;
- report inputs and uploaded evidence metadata.

The graph store remains in the same MySQL boundary using `part21_graph_nodes`, `part21_graph_edges`, and `part21_graph_events`.

The live grounded AI path now reads graph nodes, edges, and temporal events from MySQL. It no longer calls a TypeScript graph fallback. If the graph is unavailable, the API returns an explicit database-grounding error.

Evidence intake, controlled-document registration, cybersecurity review, Hedera-style notarization metadata, Part 21 decision generation, readiness reports, report drafts, and weekly synchronization all use the database-backed domain store.

## Seed behavior

The initial environment is bootstrapped once from the existing synthetic catalog when `part21_domain_records` is empty. After bootstrap, reads and writes go to MySQL. The seed is initialization data, not a runtime fallback. Client-owned records must replace these initial records before qualification.

## Static by design

The following remain TypeScript configuration and must be versioned and change-controlled rather than treated as operational records:

- ontology class and relationship definitions;
- regulatory source index and policy rule candidates;
- skill contracts, questions, and human gates;
- persona definitions;
- AgentKit route definitions;
- connector contracts and configure-later adapter metadata.

These are policy/configuration artifacts, not audit evidence or transactional records.

## Verified endpoints

The following returned `mysql-database` during validation:

- `/api/domain/status`
- `/api/domain/audits`
- `/api/domain/portfolio?auditId=AUD-026`
- `/api/graph/context?findingId=FIND-2026-04`

TypeScript checks, tests, and production build passed after the migration.
