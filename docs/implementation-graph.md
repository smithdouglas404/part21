# Graph workstream implementation

Implementation is in progress; no migration, database query, deployment, seeding, Docker installation, or production test write has been executed by this workstream.

## Atomic API contracts ready for parent integration

`withDomainTransaction<T>(work: (transaction: DomainTransaction) => Promise<T>): Promise<T>` begins one MySQL transaction and commits or rolls back the whole callback. `DomainTransaction` exposes `{ readonly sql: StoreSqlExecutor; readonly active: boolean }`; the transaction must belong to the same store factory and cannot be used after callback completion. `transaction.sql.query(sql, values)` permits the parent-owned outbox or additional approval/access SQL to join that exact transaction.

`writeDomainRecord(record: DomainRecord & { content?: Buffer; contentSha256?: string | null }, options: DomainWriteOptions)` returns persisted identity, auditId, payload, revision, recordedAt, payloadSha256/contentSha256, bytesPersisted:false and graphProjection.projected:false. `DomainRecord` is `{ recordType:string; recordId:string; auditId?:string|null; payload:unknown }`. `DomainWriteOptions` is `{ expectedRevision:number; actor:string|null; transaction?:DomainTransaction; createOnly?:boolean }`. Pass expectedRevision:0 to create an exact new ID; use the envelope's actual revision for updates. A legacy row has revision 0; its exact old snapshot is preserved as revision 0 on its first explicit update.

`getDomainRecordEnvelopeScoped<T extends Record<string,unknown>>(recordType:string, recordId:string, auditId:string, transaction?:DomainTransaction)` returns `DomainRecordEnvelope<T>|null` with `{recordType,recordId,auditId,payload,contentSha256,revision,createdAt,updatedAt}`. `getDomainRecordScoped<T>(recordType,id,auditId,transaction?)` returns only the payload or null. Scope mismatch and unknown audit throw; missing record in a known audit is null.

`appendDomainEventInTransaction(transaction:DomainTransaction,event:DomainTransactionalEvent)` inserts into the existing `part21_assurance_events` table in the same transaction. `DomainTransactionalEvent` is `{id:string;type:string;actor:string;auditId?:string|null;entityId?:string|null;occurredAt?:string;payload:Record<string,unknown>}`. Caller supplies the exact durable event ID. If occurredAt is absent the event uses `UTC_TIMESTAMP(3)` from this transaction, never an application clock or invented trigger. Legal/business triggering facts should be supplied explicitly as occurredAt.

`writeDomainRecordWithEvent(record,options,event)` wraps a record revision and that event atomically; event.entityId and auditId must exactly match record.recordId/auditId. Either options.transaction joins the caller's unit of work, or a transaction is created here. Create an audit using recordType:'audit', recordId:auditId, auditId:auditId; the new audit and event can commit together.

`upsertDomainRecord(record,options?)` retains its old name but is create-only without explicit options. Updating any existing row requires an explicit expectedRevision. It never silently changes audit ownership. Existing update callers must change to read the scoped envelope, then pass the expectedRevision and authenticated actor. Retrying revision conflicts requires rereading and rebuilding the intended change.

The explicit global administrative allowlist is `connect_token`, `person`, `approval_rule`, `access_grant`. Unscoped reads/lists of these tables are supported for authenticated admin/server callers. Tokens, people and rules use null domain ownership; payload auditId in a token is authorization scope, not record ownership. Access grants may have explicit domain audit ownership and are still readable globally for authorization assembly. All operational evidence/finding/conversation/Kanban/document/report/task tables remain strict. `listAudits()` returns actual stored `id`, `recordId` and `auditId` equal to the database audit primary ID, with database-derived counts.

`migrateDomainStore(sql:StoreSqlExecutor)` and `migrateGraphStore(sql:StoreSqlExecutor)` are explicit deployment-owner-only additive migration functions. They are never invoked by ensure/read/write helpers. `ensureDomainStore()` and `ensureGraphStore()` are SELECT-only and fail visibly if required schema is unavailable.

## Current validation evidence

The isolated domain suite initially passed 11 tests before administrative integration additions. Final focused evidence, graph exports, changed-file inventory and remaining blockers will replace this in-progress section before submission.
