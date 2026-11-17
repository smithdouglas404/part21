# Part 21 Assurance OS — implementation plan

## Product promise
A traceable operational assurance cockpit for nuclear quality teams: connect requirements, products, suppliers, people, evidence, changes, and findings into one explainable system of record, then make agentic monitoring and recommendations visible without pretending to replace accountable human approval.

## Scope for this prototype
- Executive command center with readiness, finding, supplier, and change metrics.
- Audit workbench with a concrete active audit, evidence coverage, findings, due dates, and recommended next moves.
- Knowledge graph with clickable entities, relationship labels, and selected-node trace detail.
- Temporal graph lens showing before/after versions, effective dates, causal hints, and involved people.
- Evidence register showing confidence, provenance, current state, and evidence freshness.
- Controls view mapping Part 21-style control areas to coverage, gaps, and agent status.
- Data plane showing synthetic sources, ingestion health, and an MCP-style tool catalog.
- Express endpoints at `/api/mcp/tools` and `/api/mcp/call` that expose demo search, genealogy, temporal comparison, audit readiness, control-gap, supplier-risk, finding creation, and recommendation tools.
- Clear synthetic-data / future-integration boundary.

## Architecture
- React + TypeScript + Vite frontend with local state for an immediate, reliable demo.
- Shared typed synthetic model in `shared/demo.ts` used by UI and server.
- Express JSON endpoints in `server/_core/index.ts` backed by `server/mcp.ts`; client checks the tool manifest on load.
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
- `client/src/pages/Home.tsx`: product shell, route-like view switching, demo interaction state.
- `client/src/index.css`: the control-room visual system and responsive layout.
- `shared/demo.ts`: typed synthetic entities, relationships, timelines, audits, evidence, findings, controls, sources, and MCP tool definitions.
- `server/mcp.ts`: deterministic demo tool handlers exposed through MCP-style HTTP routes.
- `server/_core/index.ts`: health, platform config, and MCP endpoints.
- `public/manus-routes.json`: declared route manifest for the single-page app.

## Delivery boundary
This is a polished concept demonstrator with deterministic synthetic data. The MCP-style surface and shared model show where client systems can plug in; no real client database, vendor portal, regulatory determination, scheduled monitoring job, or 24/7 production agent is claimed live in this checkpoint.
