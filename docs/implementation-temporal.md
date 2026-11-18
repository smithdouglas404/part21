# Temporal Part 21 deadline workstream

**Workstream:** `temporal`  
**Status:** staged implementation and finite-test evidence; **not deployed, not activated, and not a compliance certification**.  
**Date:** 18 November 2026

This workstream adds a durable Temporal case/deadline implementation beside the existing application. It does **not** change the live demo, start a permanent worker or Temporal service, run a database migration, modify Socra, add Ollama, or claim that the application is compliant with 10 CFR Part 21 or Appendix B. The current application remains unchanged by this workstream; parent integration and deployment are separate.

## What is implemented

The implementation is in `server/temporal/` and `server/deadline-store.ts`, with focused tests in `server/temporal-*.test.ts`.

- `server/temporal/contracts.ts` defines typed case facts, approved policy/calendar snapshots, deadlines, transmission evidence, workflow seeds, Activity contracts, and the public input shapes.
- `server/temporal/calendar.ts` validates approved snapshots and computes deadlines with Luxon. It is a pure function used **outside** workflow replay. It supports calendar days and working days, reviewed weekdays/holidays, explicit trigger-day inclusion/exclusion, reviewed local cutoff, DST overlap policy, nonexistent-time policy, and explicit calendar coverage bounds.
- `server/temporal/domain.ts` implements the deterministic business transition reducer. It keeps the original documented discovery and actual officer receipt separate, creates independent branches, requires versioned evidence and qualified decision IDs, and refuses to close a case while any deadline remains pending or unknown.
- `server/temporal/workflows.ts` is the deterministic Temporal workflow. It performs no database, filesystem, provider, network, or LLM I/O. It uses typed Signals, an Update with a synchronous validator, a Query, durable timers, duplicate/version checks, and Continue-As-New when suggested.
- `server/temporal/activities.ts` wraps the database store as Activities. Optional projection callbacks are injected; there are no imports into `server/ai.ts`, Kanban code, or client code.
- `server/temporal/client.ts` builds an explicit Temporal client and outbox transport from environment configuration. There is no default endpoint, namespace, task queue, or mutable global client.
- `server/temporal/worker.ts` creates the separately managed worker, a finite outbox dispatch loop, and an actual-state health endpoint. `server/temporal/worker-entry.ts` is the continuous-process entry.
- `server/temporal/build.ts` produces two separate artifacts: a workflow bundle and a Node worker entry. `server/temporal/Dockerfile` and `server/temporal/compose.yaml` are staged worker-only deployment contracts.
- `server/temporal/schema.ts` contains additive MySQL table definitions and an explicit migration list. `server/deadline-store.ts` implements the audit-scoped transactional facts, deadlines, outbox, notices, and idempotency gates.

## Public API and export contract

### Database and case facts

```ts
ensureDeadlineStore(deps, { applyAdditiveMigration?: boolean }): Promise<void>
applyDeadlineSchemaMigration(deps): Promise<void>

createPart21Case(input: CreatePart21CaseInput, deps: DeadlineStoreDependencies): Promise<CaseState>
applyPart21CaseEvent(input: ApplyPart21CaseEventInput, deps: DeadlineStoreDependencies): Promise<CaseState>
listPart21Cases(auditId: string, deps: DeadlineStoreDependencies, actor: string): Promise<CaseState[]>
getDeadlineStatus(input: { auditId: string; caseId: string; actor: string }, deps: DeadlineStoreDependencies)
dispatchDeadlineOutbox(deps, transport, { limit?, leaseSeconds?, auditId? })
createPart21DeadlineService(deps)
```

`createPart21DeadlineService(deps)` is the stable facade for parent Express/MCP endpoints:

```ts
{
  createCase(input),
  applyEvent(input),
  listCases(auditId, actor),
  getStatus({ auditId, caseId, actor }),
  dispatchOutbox(transport, options?)
}
```

`DeadlineStoreDependencies` requires a `Pool` and injects:

- `authorize({ auditId, actor, action }, tx)` — must derive the principal and audit membership from the authenticated session, not request-body fields. It runs inside the transaction for fact writes.
- `verifyPolicy(snapshots, tx)` — must verify the exact active/approved database configuration revisions, hashes, source IDs, and persisted qualified approval decisions.
- `verifyEvidence({ auditId, actor, evidence, request }, tx)` — must verify audit-scoped vault/evidence records and versions, qualified decision IDs, transmitting-human authority, method, approved artifact, recipients, and verification evidence.

There is deliberately no fallback implementation for these adapters. Missing authorization, policy, evidence, or provider configuration fails explicitly. The store never selects another audit and never invents an approval, receipt, or source ID.

### Temporal client, worker, and build

```ts
temporalConfigurationFromEnv(env?): Promise<TemporalConfiguration>
createTemporalClient(config): Promise<{ client, close }>
part21WorkflowId(caseId): string
createTemporalOutboxTransport(client, taskQueue, deps, rpcTimeoutMilliseconds?)
temporalWorkerOptionsFromEnv(env?): Promise<TemporalWorkerOptions>
startTemporalWorker(options): Promise<TemporalWorkerHandle>
buildTemporalArtifacts(outputDirectory?): Promise<{ workflowBundlePath, workerEntryPath }>
createDeadlineActivities(deps, callbacks?)
```

`startTemporalWorker` returns `{ worker, runPromise, shutdown, health }`. Health reports the actual SDK worker state, namespace, task queue, last successful outbox dispatch, and whether the last dispatch failed. It is **not** an always-on promise; the host must supply restart policy, monitoring, and on-call response.

### Workflow definitions

```ts
Part21CaseWorkflow(seed: WorkflowSeed): Promise<CaseState>
committedCaseEventSignal
applyCommittedCaseEventUpdate
deadlineStateQuery
```

Stable names are centralized in `server/temporal/names.ts`:

- Workflow type: `Part21CaseWorkflow`
- Workflow ID: `part21-case:<canonical case ID>`
- Signal: `part21.committed-case-event`
- Update: `part21.apply-committed-case-event`
- Query: `part21.deadline-state`

The Update validator checks audit/case scope and revision envelope. Business deduplication uses the immutable event ID in workflow state and in MySQL; the Update ID is an additional transport-level deduplication key. A duplicate delivery returns the already-recorded result rather than applying twice. A Signal acknowledgment alone is not treated as business application; the Activity receipt is required.

## Independent deadline branches

The workflow and reducer implement these branches independently:

- **Evaluation:** from original documented discovery. The approved policy supplies the duration and calendar. An interim obligation is created with the same trigger and an `unknown` applicability until a human decision resolves it.
- **Interim:** the interim report obligation is due under the same approved discovery-period rule. A separate `interim-expected-completion` tracking obligation records the human-stated expected completion date. That tracking date is **not** an automatic extension of the evaluation or interim deadline.
- **Supplier capability:** from the supplier's determination that it lacks evaluation capability, with explicit affected purchaser/licensee recipient IDs.
- **Officer escalation:** from qualifying evaluation completion, with a reviewed working-day calendar.
- **NRC initial and written notice:** from **actual responsible-officer receipt** of qualifying information, not discovery, audit start, evaluation completion, or initial notice. Both branches are created from the same receipt timestamp. The initial branch is not a prerequisite for the written branch.

The workflow creates 2-day and 30-day branches only when an actual receipt is recorded. It does not use discovery as a fallback receipt. A transmission must reference a qualifying trigger and carry an approved decision ID, artifact version/hash, verification evidence, explicit recipients, method, and authenticated transmitting human. A draft, task completion, or internal email is not a submission receipt. There is no automated NRC transmission Activity.

Reminders are internal controls and do not reset any deadline. Human holds and LLM holds are recorded as facts but do not stop timers or change due dates. Overdue catch-up emits notices with the original due date and an observation time after that date; it never replaces the original due date with recovery time.

## Policy, calendar, and clock inputs

No runtime legal duration is hardcoded in the workflow or reducer. `PolicySnapshot` supplies:

- exact policy ID, version, SHA-256, approval decision ID, approver, approval timestamp, and source IDs;
- durations for evaluation, supplier, officer, initial notice, and written notice, each with an explicit unit and an embedded approved `CalendarSnapshot`;
- explicit reminder lead times (an empty array disables reminders).

`CalendarSnapshot` supplies the reviewed IANA timezone, ISO working weekdays, holiday dates, valid-from/valid-through coverage, trigger-day treatment, local cutoff, DST-overlap choice, and nonexistent-time policy. The resulting deadline records the UTC instant, local date/time, explanation, policy/calendar IDs and versions, and source IDs. Calendar coverage outside the approved range fails rather than extrapolating. The calculation is performed outside Temporal replay and passed as committed data.

The workflow uses Temporal's deterministic `Date.now()` and durable `condition` timers only. It does not fetch a holiday API, read a wall clock, or calculate a legal deadline during replay.

## Database tables and migration boundary

The additive tables are defined in `server/temporal/schema.ts`:

- `part21_cases` — audit-scoped case state, revision, timestamps; unique canonical `case_id` prevents the same case from being silently recreated in another audit.
- `part21_case_events` — immutable event payload, request SHA-256, expected/actual revision, actor, occurrence time, resulting state; primary key `(audit_id,event_id)` and unique `(audit_id,case_id,version)`.
- `part21_deadlines` — immutable deadline revision per case/branch/version.
- `part21_deadline_outbox` — committed event payload and `committed`, `delivered`, `applied`, or `rejected` status; lease token/expiry and attempts.
- `part21_deadline_notices` — idempotent reminder/overdue notices keyed by a stable digest.

`createPart21Case` and `applyPart21CaseEvent` write the case state, event, deadline revisions, and outbox row in one transaction. The outbox is not marked applied merely because Temporal accepted a Signal. `markDeadlineEventDelivered` records transport acceptance; `recordDeadlineApplication` records the Activity result after the workflow has applied the committed state.

Outbox claiming uses a read-only candidate query followed by an atomic conditional lease `UPDATE` per row. It deliberately does **not** use `FOR UPDATE SKIP LOCKED`, because the managed production database is TiDB and that syntax is not verified as available. A dispatcher that loses the lease race sees `affectedRows = 0` and skips the row. An expired lease is retryable. Earlier non-applied revisions block later revisions from being selected; the workflow also rejects out-of-order revisions and waits for the missing predecessor.

`ensureDeadlineStore` defaults to a **read-only presence assertion**. It does not create tables at startup. `applyDeadlineSchemaMigration` is the explicit parent migration entry point and must only be called by an operator-reviewed migration. No migration was run in this workstream.

## Worker build and operation contract

Required environment variables:

| Variable | Requirement |
| --- | --- |
| `TEMPORAL_ADDRESS` | Explicit service address; no default |
| `TEMPORAL_NAMESPACE` | Explicit namespace |
| `TEMPORAL_TASK_QUEUE` | Explicit task queue |
| `TEMPORAL_TLS` | Literal `true` or `false` |
| `TEMPORAL_TLS_CERT_PATH` / `TEMPORAL_TLS_KEY_PATH` | Optional mTLS pair; both or neither |
| `TEMPORAL_TLS_CA_PATH` | Optional CA bundle |
| `TEMPORAL_API_KEY` | Optional API key; requires TLS |
| `TEMPORAL_WORKFLOW_BUNDLE_PATH` | Path to the separately built workflow bundle |
| `TEMPORAL_HEALTH_HOST` / `TEMPORAL_HEALTH_PORT` | Health listener |
| `TEMPORAL_HEALTH_STALE_MS` | Maximum age of a successful outbox dispatch before health fails |
| `TEMPORAL_OUTBOX_INTERVAL_MS` | Finite dispatch interval |
| `TEMPORAL_DEPLOYMENT_NAME` / `TEMPORAL_BUILD_ID` | Worker deployment identity |
| `TEMPORAL_USE_WORKER_VERSIONING` | Literal `true` or `false` |
| `DATABASE_URL` | Required by the worker's database pool; no fallback |

Build and start commands are intentionally not added to `package.json`, which the parent owns:

```sh
pnpm exec tsx server/temporal/build.ts /path/to/dist/temporal
TEMPORAL_WORKFLOW_BUNDLE_PATH=/path/to/dist/temporal/workflow-bundle.js \
  node /path/to/dist/temporal/worker-entry.js
```

The build produces a workflow bundle and a separate worker entry. `server/temporal/Dockerfile` uses a Node 22 bookworm/glibc base because the Temporal TypeScript SDK does not support musl/Alpine. `server/temporal/compose.yaml` is a **worker-only** manifest with `restart: unless-stopped`, a health check, a private env file, and no Temporal server or database service. It does not deploy or install anything. The health endpoint is unauthenticated only for liveness/readiness and contains no case/evidence content or credentials.

## Test evidence

All focused tests are finite and local. No production database connection was opened by them.

```sh
pnpm exec tsc --noEmit -p server/temporal/tsconfig.json
pnpm exec vitest run server/temporal-calendar.test.ts server/temporal-store.test.ts server/temporal-workflow.test.ts
pnpm exec tsx server/temporal/build.ts /tmp/temporal-artifacts
```

Results:

- Scoped TypeScript check: **passed**.
- Focused tests: **3 files, 24 tests passed**.
  - `server/temporal-calendar.test.ts`: 19 tests covering spring/fall DST, local-clock preservation, 47-hour DST days, weekends, holidays, year boundaries, trigger-day inclusion, calendar coverage, timezone/approval validation, independent branches, interim behavior, recipient/evidence gates, backdated discovery, earlier officer receipt, and no hold-based closure.
  - `server/temporal-store.test.ts`: 3 tests covering immutable outbox payload mismatch, missing committed event, and mismatched application receipt rejection without a database.
  - `server/temporal-workflow.test.ts`: 2 real `@temporalio/testing` time-skipping tests. The first runs independent 2/30/60-day branches with human and LLM holds, duplicate Update delivery, a cross-audit rejection, overdue notices, and `Worker.runReplayHistory`. The second stops a worker, advances four days, starts a new worker, applies a backdated actual receipt, and verifies catch-up uses the original due date. Both tests use a finite official test server and mocked Activities.
- Production artifact build: workflow bundle **1.79 MiB**, worker entry **20 KiB**.
- Worker fail-closed check: with `TEMPORAL_ADDRESS` unset, the built entry exits 1 with `TEMPORAL_ADDRESS is required; Temporal is not configured` and starts no listener or worker.

The workflow test uses `maxCachedWorkflows: 0` for the simulated process handoff so the test does not depend on a dead worker's sticky cache. This is a test-harness setting, not a production recommendation.

No database integration test was run. The managed database is shared with production, and this workstream was explicitly prohibited from migrations, seeds, and test writes. The transactional store, TiDB DDL compatibility, lease contention, and Activity retry behavior still require a staging database integration test.

## Dependencies

Parent-provided packages used by this workstream:

- `@temporalio/workflow`, `@temporalio/worker`, `@temporalio/client` — runtime
- `@temporalio/testing` — finite test server only
- `luxon` — calendar arithmetic; `@types/luxon` for TypeScript
- Existing `mysql2` — database pool and transactions
- Existing `esbuild` and `tsx` — separate workflow/worker artifact build
- Node.js 22 with glibc

`fast-xml-parser` is not used here. No package.json or lockfile change was made.

## Remaining external blockers

1. **Parent authorization adapter.** `authorize` must be implemented from the authenticated principal and audit membership. It must reject request-body actors and enforce roles for case creation, fact application, and human transmission attestation.
2. **Parent policy verifier.** `verifyPolicy` must read the exact approved/active configuration revisions, verify hashes and source IDs, and confirm persisted qualified approval decisions. Draft candidates must not become runtime policy.
3. **Parent evidence/decision verifier.** `verifyEvidence` must resolve audit-scoped vault records and exact versions, verify artifact hashes, confirm decision IDs, and validate transmitting-human authority, method, recipients, and receipt/verification evidence. Without it, case facts fail closed.
4. **Reviewed additive migration.** The parent must review and apply `applyDeadlineSchemaMigration` to a staging copy first. The shared production database must not be migrated by this workstream. TiDB compatibility of the exact DDL, JSON/ENUM handling, `INSERT IGNORE`, and lease contention needs staging verification.
5. **Temporal service and worker host.** No endpoint, namespace, task queue, TLS/mTLS credential, API key, worker host, or persistent service exists. The user has deferred hosting choice. The operator must supply these and a restart/monitoring/on-call contract; a sandbox process is not an always-on service.
6. **Parent endpoint wiring.** The expected `cases`, `status`, and `events` endpoints are not implemented here. The parent must derive `auditId`/`actor` from authentication and call `createPart21DeadlineService`; it must not accept a client-selected audit or actor as authority.
7. **UI and deployed-environment V&V.** The current UI is unchanged. Negative authorization, audit isolation, replay/restart, real TiDB transaction/idempotency, health/restart, and deployed clock tests remain to be run. TypeScript/tests/build are engineering checks, not nuclear qualification.
8. **Human NRC process.** No automated NRC call exists. The organization still needs an authorized transmitting human, approved artifact workflow, receipt/verification procedure, manual outage contingency, and evidence retention independent of Temporal history.
9. **Multi-audit case linking.** This workstream's case has one primary `auditId` and `listPart21Cases(auditId)` scope. The architecture permits a case to link multiple audits; a separate governed audit-link table/API is not implemented and must be added if required.
10. **Records retention.** Temporal history is execution evidence, not the five/ten/fifteen-year regulatory records vault. The parent must connect approved retention, legal hold, original-byte preservation, and retrievable object versions.
11. **Worker versioning and payload protection.** `TEMPORAL_USE_WORKER_VERSIONING` is operator-selected. The service must support the chosen deployment/versioning behavior. Payload encryption/classification, sensitive-evidence minimization in history, and backup/DR remain deployment controls.
12. **Container build.** The Dockerfile and compose file are staged, not built or deployed. Base-image, dependency-license, private-registry, and secret-file reviews remain with the parent/operator.

## Changed paths

- `server/deadline-store.ts`
- `server/temporal/API-EVIDENCE.md`
- `server/temporal/Dockerfile`
- `server/temporal/activities.ts`
- `server/temporal/build.ts`
- `server/temporal/calendar.ts`
- `server/temporal/client.ts`
- `server/temporal/compose.yaml`
- `server/temporal/contracts.ts`
- `server/temporal/domain.ts`
- `server/temporal/names.ts`
- `server/temporal/schema.ts`
- `server/temporal/tsconfig.json`
- `server/temporal/worker-entry.ts`
- `server/temporal/worker.ts`
- `server/temporal/workflows.ts`
- `server/temporal/.gitignore`
- `server/temporal-calendar.test.ts`
- `server/temporal-store.test.ts`
- `server/temporal-workflow.test.ts`
- `docs/implementation-temporal.md`

No `package.json`, lockfile, `server/_core/index.ts`, `server/connect-api.ts`, `server/mcp.ts`, client file, plan/TODO, or git operation was changed by this workstream. No Ollama path was added, and Socra was not modified.
