# Keep the current demo; add infrastructure later

**User decision: 18 November 2026.** Keep the existing deployed Part 21 demonstration and its current model provider. Do not publish the larger staged upgrade, buy hosting, deploy Temporal/Object Lock/immudb, or alter Socra as part of this decision.

## What stays

The current published application remains at https://part21ops-l6crvfht.manus.space. Existing database records, audit workspaces, Kanban records, knowledge-graph data and Muse connector configuration are not deleted or replaced by choosing to defer infrastructure. Socra at studio.innume.com remains a separate, unchanged deployment.

The larger nuclear architecture implementation is staged source work, not a replacement release. Staged code may differ from the live demo and is not yet an integrated, qualified or deployment-accepted build. Do not publish it until its integration, migration, authorization and evidence checks are completed.

## What is deferred—not lost

**Temporal:** durable, restart-recoverable case workflows, independently triggered regulatory deadline supervision, retries and escalations. The current application does not gain production Temporal execution merely because workflow definitions exist. No production regulatory timer is claimed to be running by this decision.

**A maintained Object Lock-capable vault (supported MinIO/AIStor or another approved S3-compatible service):** protected original object versions, retention and legal holds. Database storage and a SHA-256 hash alone are not proof of WORM protection. Historical attachment metadata cannot reconstruct original file bytes that were never retained.

**immudb:** supplemental cryptographically verifiable event/artifact records and independent checkpoints after a real service and verifier are configured. It is not a replacement for original-file storage and does not establish that an assertion is true.

**Ollama:** excluded from the requested implementation; retain the existing LLM provider.

## Demo claims

Demonstrate only behavior actually provided by the current deployment. Describe source ingestion, new policy governance, Temporal execution, external Object Lock and immudb verification as staged or planned unless independently tested in a connected deployment. A working demo is not a nuclear compliance certification or qualified production system.

No data loss is required to introduce the services later. Use a backed-up, versioned migration and preserve existing identifiers and provenance. Credentials, actual qualifications, source interpretations, hosting, retention settings and deployment acceptance remain explicit human-controlled choices.
