# Part 21 Assurance OS — staged UI implementation

**Status: staged source change only. The currently deployed demo and its live URL are unchanged.** No publish, database migration, operational write, purchase, hosting change, or Socra change was performed. This is not nuclear qualification or a compliance certification.

## Current UI versus staged UI

The currently deployed Home page is the earlier fixture/demo surface. It includes synthetic prior reports, fixed KPI values, fixed graph nodes and edges, default finding/audit IDs, toast-only “save/run” actions, and an audit switch that could leave the old portfolio on screen.

The staged `client/src/pages/Home.tsx` is a real-session workspace. It does not import `@shared/demo`, `@shared/personas`, `@shared/execution`, or the old controlled-configuration singleton. Operational records come from API responses; missing services, empty databases, missing grants, and missing qualifications render as empty, blocked, or error states.

The staged UI is intentionally not deployed by this change. Integration and acceptance must happen before the user requests an upgrade.

## What was replaced or retained

| Surface                   | Staged behavior                                                                                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                     | `GET /api/session` is required up front. A 401 shows the existing `startLogin()` flow; there is no anonymous demo or static audit fallback. Preview `sessionStorage` bearer support is reused.                                                                                          |
| Persona                   | Active persona revisions are loaded from controlled configuration. A lens changes emphasis/default view only; it never changes role, audit scope, or qualification.                                                                                                                     |
| Audit                     | Audits are created through `POST /api/domain/audits` with a governed profile, title, scope, standard, and due date. Selection is persisted per principal. Switching remounts the audit-scoped workspace.                                                                                |
| Overview                  | Readiness is displayed only when returned by the source. It is `Unknown` otherwise. Counts are computed only from returned findings/evidence/suppliers, with an inspectable basis.                                                                                                      |
| Graph                     | Selectable nodes, edges, and temporal events come from `GET /api/graph/context` for the selected audit/finding/time window. No client fixture projection is substituted.                                                                                                                |
| Cards                     | The reference-style Kanban uses the server’s actual stages (`backlog`, `in_progress`, `blocked`, `review`, `final`). A card dossier shows persisted communications, skill IDs/revisions/trace, attachments, original-byte download, digest verification, and stage moves with a reason. |
| Voice/photo/files         | `MediaRecorder` captures original audio bytes. File/photo/audio originals are base64-uploaded as attachments. A transcript is sent only when actually supplied; no speech-to-text claim is made otherwise.                                                                              |
| Skills                    | `GET /api/nuclear/skills` supplies exact envelopes. The selected skill ID and version are sent to `POST /api/agentkit/run` with answers. Required answers are checked individually; optional answers cannot substitute. Draft/retired contracts cannot run.                             |
| Evidence                  | Persisted evidence is shown from the audit portfolio. Intake registers original bytes against a real finding. Original download and digest verification use the evidence-asset routes.                                                                                                  |
| Documents                 | The actual register is scoped to the audit. Original files are uploaded with document number, revision, and source. There are no synthetic Hedera or Part 21 decision buttons.                                                                                                          |
| Reports                   | Readiness JSON/CSV and approval tasks are audit-scoped. Routing requires a rule-authorized role and an actual directory person. Approval is offered only to the assigned, currently qualified authenticated principal; no actor name is sent or typed.                                  |
| Clocks                    | Cases, deadlines, holds, and committed/delivered/applied receipts are displayed from the deadline service. Case creation and event append are explicit JSON operations requiring real policy snapshots and discovery/event evidence.                                                    |
| Sources/policy/governance | Regulatory snapshots/coverage, deterministic policy coverage/evaluation, and governance records are inspectable. Broad actions use explicit JSON forms rather than pretend controls.                                                                                                    |
| Administration            | Actual people registration, audit access grants, immutable configuration drafts/review/activate/retire, adapter status, workbook intake/comparison/approval, MCP tools, ECC inventory, and manual weekly sync are exposed to administrators.                                            |
| Existing LLM              | Retained. The UI reads `/api/ai/status` and calls the existing live `/api/ai/ask` and `/api/agent/dialogue`. No Ollama provider, dispatch, or configuration was added.                                                                                                                  |
| Removed fake surfaces     | Synthetic prior reports, fixed KPI counts, fixed graph records, default finding IDs, fake toast-only saves/runs, synthetic Hedera notarization, synthetic Part 21 decisions, and simulated agent completion are not present in the staged workspace.                                    |

## Files

- `client/src/pages/Home.tsx` — session gate, audit/lens lifecycle, authenticated workspace entry, logout.
- `client/src/components/assurance/api.ts` — authenticated fetch, checked JSON/download errors, scoped URLs, active-configuration selection, resource/action hooks, file/base64 helpers.
- `client/src/components/assurance/Common.tsx` — empty/error states, JSON inspection, drawers, forms, endpoint panels.
- `client/src/components/assurance/Launch.tsx` — real login-gated audit creation and persona lens selection.
- `client/src/components/assurance/Workspace.tsx` — audit-scoped shell, navigation, context bar, live overview/drilldowns.
- `client/src/components/assurance/Board.tsx` — Kanban, card dossier, comments, live card dialogue, original attachments/voice, stage moves.
- `client/src/components/assurance/Graph.tsx` — actual graph nodes/edges/events and temporal query.
- `client/src/components/assurance/Skills.tsx` — skill library, phase flow, exact skill execution, live grounded chat.
- `client/src/components/assurance/Records.tsx` — evidence, documents, reports/approvals.
- `client/src/components/assurance/Clocks.tsx` — cases, deadlines, status and event entry.
- `client/src/components/assurance/Controlled.tsx` — configuration, regulatory sources/coverage, policy, governance.
- `client/src/components/assurance/Admin.tsx` — identity, access grants, people, adapters, workbooks, weekly sync, configuration.
- `client/src/components/assurance/assurance.css` — styling using the existing dark assurance visual language; no new decorative assets.
- `public/manus-routes.json` — unchanged; the app still exposes `/` and `/404`, and no new page routes were added.

## Endpoint assumptions

The following are the contracts this staged UI sends. Where a parent endpoint was explicitly guaranteed, the UI uses that shape. Where an existing route was reused, the assumption is called out.

### Session and identity

- `GET /api/session` → `{ principal: { id, actor, roleIds, isAdmin, auditIds, auditWriteIds?, qualifiedAuditIds?, access?, personId?, qualified, qualificationEvidenceId? } }`; 401 when unauthenticated.
- The UI treats `access === "look_only"` or missing write scope as look-only. Non-admin write requires `auditWriteIds` to contain the audit. Admin is not treated as nuclear-qualified.
- Qualification requires `qualified === true`, `qualifiedAuditIds` to contain the audit, and a `personId`. If the server does not return `qualifiedAuditIds`, the UI conservatively shows “not qualified.”
- `GET /api/domain/audits` → `{ audits: [...] }`; client filters to `principal.auditIds` for non-admins. If the endpoint already scopes results, filtering is redundant but harmless.
- `POST /api/domain/audits` with `{ title, scope, due, profileId, standard }` → persisted audit (raw or envelope).

### Configuration and nuclear library

- `GET /api/configuration/catalog?kind=persona|skill|connector` → `{ configurations: [{ kind, configId, version, status, ... }] }` (headers only).
- `GET /api/configuration/:kind/:configId?version=...` → envelope with `payload`, `status`, `version`, source hash where available.
- Active loader behavior: only `status === "active"`; competing active revisions for one config ID fail visibly; exact version is fetched. Draft/retired revisions never become runtime fallbacks.
- `GET /api/nuclear/profiles` → `{ profiles: [...] }`; each profile supplies `id`, label/name/title, standard, status.
- `GET /api/nuclear/skills` → `{ skills: [{ id/configId, version, status, sourceSha256, payload: { id, name/label, purpose, phase, questions, route, skillContract, humanGate, ... } }] }`.
- `GET /api/nuclear/status?auditId=...` → `{ temporal, vault, configuration }` (extra `auditId` is ignored if the route is global).

### Audit portfolio, cards, evidence, documents

- `GET /api/domain/portfolio?auditId=...` → `{ audit, findings, evidence, controls, sources, suppliers, changes, metrics }`.
- `GET /api/kanban?auditId=...` → `{ items, attachments, communications }`; items use `backlog | in_progress | blocked | review | final` and `low | medium | high | critical`.
- `POST /api/kanban/items` with `{ auditId, title, description, status: "backlog", priority, findingId? }` → `{ item }`.
- `POST /api/kanban/items/:itemId/move` with `{ auditId, status, reason }` → updated item/event. `final` is not offered as a direct move; it must come through report approval.
- `POST /api/kanban/items/:itemId/attachments` with `{ auditId, itemId, filename, mediaType, kind: "photo" | "document" | "voice", base64, transcript? }` → attachment with `assetId`/revision/custody metadata.
- `POST /api/kanban/items/:itemId/communications` with `{ auditId, itemId, role: "user", conversationId?, text }` → persisted communication. The server derives the actor. If the server requires a conversation ID for the very first comment, this request may be rejected until a dialogue creates one; that is preferable to inventing an ID.
- `POST /api/agent/dialogue` with `{ auditId, itemId, conversationId?, findingId?, message }` → live response containing answer, provider/model, skill ID/version, trace, and grounding where available.
- `POST /api/evidence/intake` with `{ auditId, linkedFinding, name, mimeType, size, contentBase64, tags }` → persisted evidence and asset.
- `GET /api/evidence/assets/:assetId/download?auditId=...` → original bytes.
- `POST /api/evidence/assets/:assetId/verify` with `{ auditId }` → digest/verification response.
- `GET /api/evidence/vault/status?auditId=...` → actual vault/provider status (extra audit ID is assumed harmless).
- `GET /api/documents?auditId=...` → `{ documents }`.
- `POST /api/documents` with `{ auditId, auditIds: [auditId], title, documentNumber, revision, mimeType, base64, source, effectiveDate? }` → `{ document, asset, ... }`.
- `GET /api/document-control/status?auditId=...` → actual custody/review status (existing route; extra audit ID assumed harmless).
- `POST /api/documents/:documentId/cybersecurity-review` with `{ auditId, status, controls, note, expectedRevision }` → recorded review. The UI only offers this to a currently qualified reviewer and does not invent controls.

### Graph, skills, live AI

- `GET /api/graph/context?auditId=...&findingId=...&asOf=...` → nodes, edges, temporal events, source/schema/ontology proof. The UI also sends `effectiveAt` for valid-time queries; if the server ignores it, the response is still displayed exactly.
- `POST /api/agentkit/run` with `{ auditId, findingId, skillId, skillVersion, answers }` → persisted run/trace.
- `GET /api/agentkit/activity?auditId=...` → persisted runs/activity.
- `POST /api/ai/ask` with `{ auditId, findingId, question, mode: "live" }` → live grounded answer. No alternate audit/finding is selected by the client.
- `GET /api/ai/status` → existing provider status, read-only.

### Reports and approvals

- `GET /api/reports/audit-readiness?auditId=...` → JSON report; `GET /api/reports/audit-readiness.csv?auditId=...` → CSV bytes.
- `GET /api/approval-rules?decisionType=audit_report_finalization&auditId=...` → `{ rules: [{ allowedRoleIds, ... }] }` (existing route; audit ID assumed ignored if global).
- `GET /api/people` → `{ people: [{ id, name, title, roleId, email, organization, active, synthetic?, principalId? }] }`.
- `POST /api/reports/:auditId/approval-route` with `{ auditId, personaId, personId, note }` → approval task.
- `GET /api/reports/approvals?auditId=...` → `{ tasks | approvals }`.
- `POST /api/reports/approvals/:approvalId/approve` with `{ auditId, note }` → approval/finalization. No actor is sent. The UI only enables this for the task’s assigned `target.personId` matching `principal.personId`, with current qualification.

### Clocks and regulatory governance

- `GET /api/temporal/cases?auditId=...` → `{ cases }` of committed case state.
- `GET /api/temporal/cases/:caseId?auditId=...` → case detail/receipts.
- `GET /api/temporal/status?auditId=...` → Temporal/worker/outbox status (extra audit ID assumed harmless).
- `POST /api/temporal/cases` with the full `{ caseId, eventId, policySnapshot, discovery }` plus `auditId`.
- `POST /api/temporal/cases/:caseId/events` with `{ auditId, eventId, expectedVersion, occurredAt, event }`.
- `GET /api/regulatory/snapshots`; `POST /api/regulatory/ingest` with `{ source: "part21" | "appendix_b", asOf? }`; `GET /api/regulatory/coverage?auditId=...`; `GET /api/policy/coverage?auditId=...`; `POST /api/policy/evaluate` with `{ findingId, asOf, auditId }`.
- `GET /api/governance/board?auditId=...`; `POST /api/governance/decide` with `{ auditId, id, action, note, evidenceIds, decisionId }` (existing route; audit ID assumed accepted or ignored).

### Administration and adapters

- `GET /api/access/grants`; `POST /api/access/grants` with `{ principalId, auditId, roleIds, access, personId?, qualificationEvidenceId?, qualifiedUntil? }`.
- `POST /api/people` with `{ name, title, roleId, email, organization, principalId }`.
- `POST /api/configuration/drafts`; `POST /api/configuration/review|activate|retire` with `{ kind, configId, version, note }`.
- `GET /api/mcp/tools`; `POST /api/mcp/call` with `{ auditId, name, arguments }` (existing MCP adapter; audit ID is included for scoped tools).
- `GET /api/ecc/module`; `GET /api/ecc/library`.
- `GET /api/admin/excel/status?auditId=...`; `GET /api/admin/excel/samples`; `GET /api/admin/excel/compare?auditId=...`; `POST /api/admin/excel/upload` with `{ auditId, filename, base64, source }`; `GET /api/approvals/pending?auditId=...`; `POST /api/approvals/workbooks/:workbookId` with `{ auditId, note, expectedRevision, sourceSha256 }`.
- `POST /api/sync/weekly` with `{ auditId }`.

## Deliberate limitations and integration risks

1. **`POST /api/people` and `/api/access/grants` are admin-only.** The parent must expose them with actual administrator authentication. The staged UI does not auto-grant scope and does not treat owner/admin as nuclear-qualified.
2. **Synthetic people are excluded from approval selectors.** If the directory does not mark actual people clearly, the parent should return `synthetic: false` or omit the flag for real people. The server must reject synthetic approvals independently.
3. **Approval assignment is enforced twice.** The UI hides approval unless the current `personId` matches the task and qualification is current. The server must still enforce assignment, separation of duties, and qualification; UI state is not authorization.
4. **Conversation ID timing.** The first card comment may need a conversation ID. The UI sends one only when the server already returned it; it does not invent one. The parent may choose to create the conversation on the first comment or require dialogue first.
5. **Card move `final`.** The server’s Kanban type includes `final`, but direct finalization is disabled in the server contract. The staged UI does not offer `final` as a move target.
6. **Status endpoint query tolerance.** Several existing status routes are global but receive `auditId` as a query parameter. Express normally ignores it; if a route validates an exact query shape, the parent should relax it or confirm it.
7. **New nuclear/temporal/regulatory/access routes may not yet be mounted.** If absent, the staged UI shows the returned error or an empty state; it never falls back to fixtures, a default audit, or a demo provider.
8. **`GET /api/domain/audits` scope.** The UI filters to `principal.auditIds` for non-admins. The server must still reject unauthorized portfolio, graph, evidence, card, document, report, and clock requests.
9. **No local readiness formula.** If the portfolio has no `metrics.readiness`, the UI shows `Unknown`. It does not compute 40/25/20/15 or any other score.
10. **No synthetic decision or notarization.** The staged UI has no buttons for synthetic Hedera or Part 21 decision generation. The existing server wrappers may still be present, but they are not surfaced as real controls.
11. **No Ollama.** The existing LLM is retained. The UI does not claim local inference, model pinning, or egress controls.

## Verification performed

- Client-only TypeScript check: `npx tsc -p /tmp/ui-check/tsconfig.json --noEmit` — **clean** for `client/src/**/*` and `shared/**/*`.
- Full repository `npx tsc --noEmit` was also run and reported only concurrent server-module errors (`server/_core/index.ts`, `server/agentkit.ts`, `server/mcp.ts`) outside this UI change. Those modules were not edited.
- Static scan of the new Home and assurance components found no `@shared/demo`, `@shared/personas`, `@shared/execution`, fixed audit/finding/evidence IDs, `NSS-4820`, `Northstar`, `Jordan`, synthetic Hedera actions, or Ollama wiring.
- No browser test, database read/write, migration, build, or deployment was performed. Those are intentionally outside this staged UI change.

## Acceptance boundary

This work is an engineering UI integration. It is not evidence that the underlying controls are compliant, that source interpretations are approved, that reviewers are qualified, or that original records meet a records-retention standard. Those claims require the parent’s server tests, qualified review, and deployment acceptance.
