# Part 21 Assurance OS — outcome TODO

- [x] **Give the demo a traceable command center**
  - Show readiness, open findings, supplier exposure, and change velocity in one operational view.
  - Use synthetic data and label it clearly as demo data.
  - Make the product feel like an assurance cockpit rather than a generic dashboard.

- [x] **Make agentic operations visible and accountable**
  - Show agent activity, confidence, evidence basis, and recommended next moves.
  - Include run actions for a readiness check, genealogy trace, and supplier risk scan.
  - Frame outputs as recommendations and signal detection, not autonomous compliance verdicts.

- [x] **Support internal audit workflows**
  - Include an active audit with standard, owner, progress, evidence coverage, findings, and due dates.
  - Surface high-priority findings and a suggested next action.
  - Keep evidence, audit, finding, and control context connected.

- [x] **Visualize genealogy and temporal change**
  - Render a clickable knowledge graph of requirements, products, suppliers, evidence, people, and changes.
  - Show selected-node context and trace relationships.
  - Include before/after temporal comparison, effective dates, causality hints, and involved people.

- [x] **Show the synthetic data plane and MCP-style boundary**
  - Show source health for systems of record, supplier portal, people/roles, document control, and field data.
  - Expose an MCP-style tool catalog with callable-tool descriptions.
  - Provide HTTP endpoints that can later be replaced by real adapters.

- [ ] **Replace synthetic adapters with client integrations**
  - Connect to the client’s document control, quality, supplier, asset/configuration, HR/role, and field data systems.
  - Define data ownership, identity resolution, source freshness, and permission boundaries.

- [ ] **Harden for production assurance use**
  - Add persistent audit/finding/evidence tables, RBAC, immutable event logging, scheduled ingestion, review/approval queues, and exportable audit packages.
  - Validate terminology, regulatory interpretation, and control mappings with qualified client SMEs.

## 2026-11-17 iteration

- [x] **Start with a real launch workspace** — persona required up front; eight synthetic audits selectable; resume and new-audit flows available.
- [x] **Switch audits inside the workspace** — active audit changes the command-center context, scoped finding queue, graph projection, and full graph header.
- [x] **Group navigation by activity** — command center, audit execution, traceability, evidence & reports, and agent operations; admin controls are behind the user/admin surface.
- [x] **Demonstrate persona-specific guidance** — manager, auditor, quality, supplier, and engineering lenses alter default workspace and visible persona focus guidance.
- [x] **Add a real local Excel adapter boundary** — download `.xlsx` samples, upload and parse workbooks, hash revisions, summarize sheets, compare samples, and return human-gated import proposals.
- [x] **Expose workbook MCP-style tools** — list, describe, read, import, and compare operations are callable through `/api/mcp/call`.
- [x] **Show dynamic skill invocation in chat** — chat returns the skill route, contract, invocation mode, human gate, grounding, and adaptive follow-up questions.
- [x] **Create reusable skill** — packaged at `/home/ubuntu/skills/part21-assurance-application-builder`.
- [x] **Document honest gaps and benchmark** — see `docs/INDUSTRY-BENCHMARK.md`.
- [x] **Expose a standard MCP server** — `/mcp` supports JSON-RPC `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read`; `mcp:stdio` supports local Claude-style clients.
- [x] **Connect Excel to a local directory** — `EXCEL_ROOT` discovery and `excel_import_local_workbook` are live through both transports.
- [x] **Persist approved workbook overlays** — append-only bitemporal events are stored under `PART21_DATA_DIR` after human approval.
- [x] **Show future enterprise adapters** — SAP ERP, Salesforce supplier relationships, document control, and configuration-management connector slots are visible as configure-later boundaries.
- [x] **Implement weekly sync logic** — `run_weekly_source_sync` and `/api/sync/weekly` are idempotent for unchanged workbooks and report readiness, policy coverage, supplier risk, and pending connectors.
- [x] **Add controlled document repository** — upload/store documents with SHA-256 integrity, revision identity, audit linkage, retention metadata, cybersecurity review, and append-only lifecycle events.
- [x] **Demonstrate ledger notarization** — selected documents can produce a clickable, simulated Hedera topic/transaction/hash proof with the canonical payload shown in the UI; no real external transaction is claimed.
- [ ] **Enable the remote weekly schedule** — platform ScheduleTask creation is blocked until the WebDev project is deployed; after deployment, create the Monday schedule against the weekly sync operation.

- [x] **Implement the Studio-compatible Part 21 gateway** — merge the live Studio OpenAPI with collision-free `/api/v1/part21/*` Kanban, audit, workbook, and generic tool paths; preserve bearer headers; proxy unmatched Studio API calls; and keep write operations human-gated with HTTP 202 previews.
- [x] **Deploy the gateway as a non-destructive sidecar** — publish a combined gateway at `https://part21ops-l6crvfht.manus.space` that proxies Socra at `studio.innume.com`, validates the incoming bearer token through Socra's `my_access` operation, and adds the Part 21 routes without changing Socra.
- [ ] **Refresh the existing Meta Muse connector schema** — keep one connector, change its OpenAPI address to the published sidecar, enter the newly created Socra `Part 21 Gateway` token, and verify that Socra and Part 21 tools are both visible.
- [x] **Add Muse-to-agent dialogue** — persist user and agent turns in MySQL, route intake through controlled Finding Challenge and Evidence Intake skills, read the graph without mutating it, invoke the grounded LLM, and require confirmation before persisting a finding draft for qualified review.

- [ ] **Promote workbook overlays into authoritative client graph entities** — add qualified ontology mapping, row-level identity resolution, relationship rules, and client approval before promotion.
- [ ] **Move from demo-grounded chat to an approved provider runtime** — add provider adapter, model/prompt registry, evaluation set, guardrails, and production secret management.
- [ ] **Complete production assurance hardening** — durable database, RBAC, immutable event log, validation/qualification evidence, cybersecurity review, retention, backup, and SME-approved applicability/interpretation overlays.
