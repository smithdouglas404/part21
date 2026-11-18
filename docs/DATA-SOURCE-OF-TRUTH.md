# Data source of truth

## Current demo architecture

The Part 21 Assurance OS now has a database-backed graph projection for the data used by the live compliance-agent path.

- `part21_graph_nodes` stores ontology-mapped graph entities.
- `part21_graph_edges` stores typed relationships between graph entities.
- `part21_graph_events` stores temporal valid-time and transaction-time events.
- The database connection is provided by `DATABASE_URL` in the managed project.
- The graph API is available at `GET /api/graph/context`.
- The live grounded LLM path calls the graph context reader before invoking the model.

The graph seed is insert-only. It is used to bootstrap the synthetic demonstration into the database and does not overwrite existing rows on subsequent synchronization. Workbook imports, event-store overlays, approvals, and client changes can therefore be preserved as runtime data.

## Live grounding path

```text
Guided answer
  -> active audit and skill context
  -> database graph context
  -> Part 21 regulatory trace
  -> temporal event history
  -> grounded context packet
  -> live LLM
  -> recommendation + follow-up questions
  -> human gate
```

A live response includes `graphSource`, graph node/edge counts, temporal-event count, source IDs, and the grounded packet used for the model call. The UI displays whether the live model was invoked or whether a deterministic fallback was used.

## What is still synthetic

The initial seed records are synthetic because this is a demonstration environment. The following are not client-connected yet:

- Client ERP / SAP.
- Salesforce or supplier relationship system.
- Document control platform.
- Configuration-management system.
- Production identity and RBAC.
- Production retention and records-management policy.

The application does not claim that those external systems are connected. They are represented as explicit adapter boundaries in Administration and the Data Plane.

## What remains for production

Before operational use, the client still needs:

1. A qualified database deployment with migrations, backups, retention, and access control.
2. Authoritative source adapters that write normalized graph nodes, edges, and events.
3. Data-quality and reconciliation jobs for duplicate identities, missing joins, and conflicting revisions.
4. Immutable audit/event storage and formal records-management controls.
5. RBAC, cybersecurity review, validation, and qualification evidence.
6. A client-approved LLM provider, model registry, evaluation set, and prompt/change-control process.
7. Qualified nuclear, quality, legal, and compliance review for applicability, reportability, and notification decisions.
