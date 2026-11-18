# Evidence implementation

The original attachment path discarded binary bytes. This workstream replaces that path with additive versioned MySQL LONGBLOB preservation and exact-byte SHA-256 readback. MySQL preservation is not WORM, compliance certification, record truth, or nonrepudiation.

## Verified provider facts

The official immudb SDK list explicitly labels Node verification as not working. The official state documentation requires clients to preserve and validate trusted state, and notes missing Node state support. This implementation therefore uses the documented REST gateway verification operations and independently supplied trusted checkpoints, not the Node SDK. [1] [2] [3]

S3 Object Lock is version-specific. Retention, legal hold, versioning, original-byte readback and exact VersionId must be checked; governance bypass remains a material limitation. Required Object Lock uploads include an MD5 or SDK checksum. [4]

## References

[1]: https://immudb.io/docs/connecting/sdks/ "Official immudb SDK status"
[2]: https://immudb.io/docs/management/state/ "Official immudb trusted state management"
[3]: https://raw.githubusercontent.com/codenotary/immudb/master/pkg/api/schema/schema.proto "Official immudb REST gateway protocol"
[4]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html "AWS S3 Object Lock controls"

## Parent-facing API contracts available now

`configureEvidenceRuntime({ authorize, resolvePrincipal?, loadRetention?, loadProtectedVault?, repository? })` installs trusted principal authorization and runtime/config loaders. It is not called automatically. `authorize(principal: {id: string}, auditId: string, action: 'read' | 'write' | 'download' | 'hold' | 'review'): Promise<void>` must throw on unauthorized access. Read methods use explicit principal or the parent's request-context `resolvePrincipal`; writes pass the parent-derived actor. Missing runtime/principal configuration fails closed.

`readEvidenceAsset(assetId, auditId, principal?, revision?)` returns `{asset, bytes: Buffer, headers}` after audit-owner checks and digest verification, and appends a durable download custody event. `verifyEvidenceAsset(assetId, auditId, principal?, revision?)` returns the typed retained asset metadata, DB-digest verification, external-verification state, and explicit `original_missing`/external failure results. `getEvidenceVaultStatus(auditId, principal?)` requires a selected audit and reports actual database counts; configured does not mean provider-health verified.

`moveKanbanItem(itemId, status, actor, auditId?, expectedRevision?, reason?)` remains import-compatible but requires the fourth argument at runtime. Three-argument calls throw before lookup or mutation. Direct `final` transitions are disabled; the parent owns qualified report finalization. `appendKanbanCommunication(input)` accepts explicit audit/item/conversation/actor, `skillIds`, optional `skillRevisions: {id, revision}[]`, source IDs, trace ID and channel. Unknown revisions/channel are labeled unknown, not fabricated.

`attachKanbanAsset(input)` preserves base64 original bytes in MySQL LONGBLOB. Voice without original bytes may preserve transcript text only as a derivative with `originalStatus: 'original_missing'`; it is not audio preservation. `retention` may be explicitly supplied from reviewed runtime configuration; absent policy returns `{status:'unknown',sourceIds:[],legalHold:false}`. No fixed ten-year policy is synthesized.

The additive migration export is `migrateEvidenceVault(executor)` in `server/vault/migrations.ts`. Parent must arrange baseline `part21_domain_records` and `part21_assurance_events` tables and run the reviewed migration explicitly; this workstream does not migrate or touch the shared managed database.
