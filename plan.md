# Part 21 Assurance OS — implementation plan

## Product promise
A traceable operational assurance cockpit for nuclear quality teams: connect requirements, products, suppliers, people, evidence, changes, and findings into one explainable system of record, then make agentic monitoring and recommendations visible without pretending to replace accountable human approval.

## Scope for this application
- Executive command center with readiness, finding, supplier, and change metrics.
- Audit workbench with a concrete active audit, evidence coverage, findings, due dates, and recommended next moves.
- Knowledge graph with clickable entities, relationship labels, and selected-node trace detail.
- Temporal graph lens showing before/after versions, effective dates, causal hints, and involved people.
- Evidence register showing confidence, provenance, current state, and evidence freshness.
- Controls view mapping Part 21-style control areas to coverage, gaps, and agent status.
- Data plane showing configured source state, ingestion health, and a standard MCP tool catalog.
- Express endpoints at `/api/mcp` and `/mcp` backed by database and graph services, plus the REST/OpenAPI connector for Meta Muse.
- Excel revision intake, evidence/document control, report approval, field Kanban, AgentKit, ECC skill routing, and bitemporal graph projections.
- Studio gateway mode that combines the existing Studio OpenAPI with Part 21 routes under `/api/v1/part21` without operation-id collisions.

## Architecture
- React + TypeScript + Vite frontend with database-backed query state and audit-scoped projections.
- MySQL/Drizzle domain records and append-only assurance events are the operational persistence boundary; TypeScript defines schemas, ontology, and skill contracts rather than operational rows.
- Express JSON endpoints in `server/_core/index.ts` backed by `server/mcp.ts`, graph services, document control, workbook adapters, AgentKit, and the connector gateway.
- Existing authentication and tRPC foundation remain intact for later production integration.
- No compliance verdict is automated; agent outputs are framed as recommendations, signal detection, and evidence-navigation support.

## Design movement
Three candidate directions:
- Mission control / deep navy operations console (0.06)
- Paper-and-ink regulatory casebook (0.08)
- Clinical graphite and signal orange audit lab (0.07)

Chosen: **Mission control / deep navy operations console**.

### Core principles
1. Traceability before decoration: every insight points to an entity, source, or relationship.
2. Calm under pressure: restrained dark palette with sparse amber/red signals for risk.
3. Progressive disclosure: overview first, graph/evidence detail on demand.
4. Human accountability: agent recommendations are explicit, explainable, and actionable—not opaque “AI magic.”

### Color philosophy
Use a near-black navy canvas and blue-gray panels so high-value signals remain legible in long control-room sessions. Electric cyan marks live data paths and system health; amber marks review pressure; red is reserved for overdue or high-risk findings. Cream-white type provides a slightly warm, document-like feel against the technical background.

### Layout paradigm
A persistent left control rail and a dense, asymmetric working surface: an agent pulse rail, large graph/evidence canvas, and compact metric strip. Avoid dashboard-card sameness by giving the graph and active audit the visual weight of the page.

### Signature elements
- “Signal line” cyan rules and micro-labels that make data lineage feel physical.
- Circular graph nodes with halo states for entity types and risk.
- Small uppercase telemetry labels paired with large human-readable section titles.

### Interaction philosophy
Clicking an audit, graph node, evidence row, or recommendation changes the context rather than opening a disconnected page. Every context shift preserves a trace label (“why this is here”) and offers a next action. Run buttons update an activity feed so the agentic loop is observable.

### Animation
Use 150–220ms fades and small translate transitions for panels, status pulses, and graph selection. The agent pulse uses a subtle breathing dot, never a flashy spinner. Respect reduced-motion preferences.

### Typography
Use `Inter`/system sans for operational labels and `IBM Plex Mono`/monospace for IDs, dates, and provenance. Strong hierarchy: 11px uppercase metadata, 14–16px body, 30–38px page title, with no oversized marketing hero.

### Brand essence
**Part 21 Assurance OS** — the traceability layer for nuclear quality operations. Personality: exacting, calm, accountable.

### Brand voice
Headlines are direct and operational (“Know what changed. Know why.”). CTAs are verbs with context (“Trace genealogy”, “Open finding”, “Run readiness check”).

### Wordmark & logo
A compact square mark made from three connected brackets around a center dot, suggesting a controlled graph path; wordmark uses the product name with “OS” in cyan.

### Signature brand color
Electric cyan `#52d6e6`, used sparingly for live pathways and agent activity.

## Project structure
- `client/src/pages/Home.tsx`: product shell, persona/audit selection, and operational workspace views.
- `client/src/index.css`: the control-room visual system and responsive layout.
- `shared/ontology.ts`, `shared/skills.ts`, and `shared/ecc.ts`: governed ontology and executable skill metadata.
- `server/domain-store.ts`, `server/graph-store.ts`, and `server/event-store.ts`: database-backed records, graph projections, and temporal events.
- `server/connect-api.ts` and `server/studio-gateway.ts`: bearer-authenticated Part 21 connector and Studio merge/proxy surface.
- `server/_core/index.ts`: health, platform config, MCP, REST/OpenAPI, gateway, approval, evidence, and audit routes.
- `public/manus-routes.json`: declared route manifest for the single-page app.

## Delivery boundary
The application-side Part 21 workflows are implemented against the configured database and graph stores. External client ERP, supplier, document-control, identity, and field providers remain explicit connector configuration boundaries. The Studio gateway merge is implemented in code and tested against the live Studio OpenAPI; it becomes domain-live only when the gateway is deployed at the Studio origin or mounted by its reverse proxy with the required protected upstream and bearer-token configuration.
