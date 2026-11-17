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
