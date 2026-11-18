# Agent workstream integration handoff

Implementation in progress. No shared database reads, migrations, seeds, or test writes are being performed.

The stable API will be `runAuditSkill({ skillId, answers, auditId, findingId, actor, principal, mode?, skillVersion?, evidenceBindings? }, services?)`, where `principal` is server-derived `{ id, auditIds, permissions }`; accepted permissions are `agent:read`, `agent:write`, `agent:control`. Legacy string calls without explicit context fail closed. `previewAuditSkill` is read-only, including candidate draft guidance. Runtime active skills require database governance approvals; nuclear candidates remain draft.

`runFindingIntakeDialogue` will accept the same trusted principal plus `kanbanItemId`, `findingId`, `expectedRevision`, `attachmentIds`, and skill selections. Intake is WRITE; `previewFindingIntakeDialogue` is a distinct no-write operation. Supplied cards and attachment IDs must already belong to the same audit. Conversation appends use an additive dedicated revision table and atomic card communication/event commit.

`AgentServices` exported from `server/agent-runtime.ts` provides typed injected read portfolio/config, graph, policy, evidence, persistence, and report/finding approval adapters. Parent can configure adapters without changing runtime provider configuration. Graph adapter must return exact auditId/findingId, actual ontologyVersion, exact node/edge/event IDs and database traversal proof. Missing providers/evidence return explicit unknown; no fake recommendation or unconditional warning.

`getAgentRuntimeMigrations()` returns SQL only; parent owns applying the additive tables. No runtime auto-DDL. Existing live `invokeLLM` and `claude-haiku-4-5` are retained. The project catalog queried on 18 November 2026 lists that exact model; no completion was invoked by implementation testing.

## Parent principal alignment

`AgentPrincipal` structurally accepts the parent's `AssurancePrincipal` without conversion. Actor must equal `principal.actor` when present, otherwise principal ID. `look_only` permits `agent:read` but never persistent intake or `runAuditSkill`. `make_changes` permits skill/intake writes; lifecycle control additionally requires admin, and currently returns provider-unavailable rather than inventing a worker.

Pass `runAuditSkill(bodyWithTrustedPrincipal, undefined, undefined, services?)`; the first argument is the full typed input. `previewAuditSkill(bodyWithTrustedPrincipal, services?)` does not write. The legacy `(skillId, answers, explicitContext, services?)` wrapper rejects missing scope. Dialogue accepts parent `itemId` alias as well as `kanbanItemId`; both must agree when supplied.

## Report approval integration contract

`prepareAuditReportSnapshot(auditId, services?)` returns `{auditId, artifact, artifactSha256}`. `artifact` is the exact readiness projection with transient generation timestamp excluded, canonicalized recursively for stable SHA-256; it is draft, not approved. The parent persists approval decision binding to `artifactSha256`.

`finalizeAuditReport(auditId, actor, auditorNarrative, approvalDecisionId, principal, services?)` is supported; alternatively fourth argument `{approvalDecisionId, principal}`. Booleans are rejected. Bind `configureAgentRuntimeAdapters({ finalizeReport: parentFinalizationFunction })` to the actual report-approval owner; wrapper re-prepares the exact artifact, checks database `report_approval_decision` matching audit, trusted principal ID, approved status, and artifact hash, then forwards `{auditId, actor, principal, approvalDecisionId, auditorNarrative, artifact, artifactSha256}` to the parent-owned function. Parent must enforce assigned-person/qualification/SoD and perform graph/write before completion. The wrapper never fabricates approval, calls ungated legacy graph promotion, or certifies compliance. Parent finalization callback must be the actual gate/write implementation, not recursively call the wrapper.

For clarity `runAuditSkill({mode:'preview',...})` is WRITE and durably records draft guidance; `previewAuditSkill` and `previewFindingIntakeDialogue` are separate READ ONLY functions. This corrects the earlier in-progress wording.
