# Part 21 clock operations: agent behavior, Temporal value, and evidence retention without Object Lock

## 1. Is the agent following the six clocks?

Yes, as of this build — with one boundary you must be able to state out loud.

The conversational agent (Muse, chat, and the audit brief) now receives a computed `part21Clocks` object in its grounding packet on every turn:

- every open case in the active audit,
- all six branches with citation, status, trigger time, due time and days remaining,
- the next unrecorded gate with its citation, question and what it prohibits,
- the skill contracts that govern each branch.

The system instruction is explicit: report the next open gate and its due date exactly as computed, ask the one question that closes it, and never compute, extend or restart a statutory clock.

Branch-to-skill mapping is fixed, not improvised:

| Branch | Governing skills |
|---|---|
| Evaluation | part21-deviation-screening, part21-discovery-clock |
| Interim report | part21-discovery-clock, part21-notification |
| Officer notification | part21-substantial-safety-hazard, part21-notification |
| Supplier notification | supplier-evaluation-transfer, part21-notification |
| NRC initial | part21-notification |
| NRC written | part21-notification |

**The boundary:** these eleven nuclear skills are stored as `skill_candidate/draft`. Six core audit skills are `active`. Draft guidance is real guidance with real questions and real citations, but it carries no qualified regulatory approval, and the app labels it that way. Promotion is a human review action, not a code change.

**Second boundary:** the agent follows the clocks when it is asked. Nothing pushes a reminder at 07:00 on day 45. That is the Temporal question.

## 2. What Temporal would buy you, and what we do instead

### How it works today: derived, event-triggered, pull-based

Every branch status is computed on read from recorded trigger facts:

- the documented discovery timestamp (immutable once recorded),
- evaluation completion, if it happened,
- responsible-officer receipt, if it happened,
- a declared calendar (timezone, working weekdays, holidays, trigger-day handling).

Nothing is stored as a "timer". Because the status is derived, it cannot silently drift, and it cannot be restarted by a UI action — the engine refuses a second case for the same condition precisely because that would reset the statutory clock. Every fact write lands in an append-only revision table with a SHA-256 chain, so the computed status is reproducible later.

That design is genuinely good for **audit and traceability**, and genuinely weak for **timeliness**. The clock is correct whenever anyone looks. If nobody looks, a 60-day evaluation can quietly run out.

### What Temporal adds

1. **Durable timers.** A 60-day timer survives restarts, deploys and outages. It fires whether or not a human opens the app.
2. **Scheduled escalation.** Day 45 warn, day 55 escalate to quality management, day 60 open a red Kanban item and record an overdue event.
3. **Retries and idempotency.** Notification activities retry safely without duplicating records.
4. **Independent history.** The workflow history is a second, tamper-resistant record of "the clock fired at this time and escalated to this person", separate from the application database.
5. **Signals for gates.** A human approval signal resumes the workflow rather than polling a table.
6. **Operational visibility.** "What is due in the next seven days across all audits" becomes a query, not a report someone assembles.

### If you do not use Temporal

You keep the current engine and add a lightweight scheduler:

- a `deadline` table holding computed due dates and escalation state,
- a worker (or MySQL event scheduler / pg_cron) that runs daily, recomputes, and emits escalations,
- idempotency keys so a restart does not double-notify.

That gets you most of the timeliness with far less operational burden. What you give up is durable workflow history, retries with exactly-once semantics, and long-running timers that survive infrastructure changes.

**Recommendation:** ship the demo on the derived engine (it is honest and already working), then add Temporal when the client commits to production hosting. Do not claim 24/7 supervision until a worker is actually running — the Nuclear service readiness panel in the app already says `temporal.configured: false` rather than implying coverage.

## 3. Evidence retention without Object Lock

Object Lock is one way to get WORM storage. It is not the only way, and it is the most expensive and least flexible.

| Option | What it gives you | Cost / trade-off |
|---|---|---|
| **RFC 3161 trusted timestamps + hash chain + Hedera anchoring** | Tamper-*evident*: any altered byte breaks the hash; the anchor proves the record existed at a point in time | Cheapest. Works with the database you already run. Does not prevent deletion by an administrator. |
| **immudb** | Cryptographically verifiable append-only database; client-side proof that a record was not rewritten | Open source, self-hosted, one more service. Strong fit for evidence custody. |
| **MinIO with object locking (compliance mode)** | Self-hosted S3-compatible WORM | You own the operations, patching and backup. |
| **S3 Glacier Vault Lock** | Enforced WORM archive, very low storage cost | Retrieval latency; wrong tool for records under active review. |
| **Azure Blob immutable storage** | Time-based retention or legal hold | Only if the client is already on Azure. |

**Recommended path:** keep original bytes in the current store, add RFC 3161 timestamps on ingest, continue the SHA-256 revision chain, and anchor a daily Merkle root to Hedera Consensus Service. You already have the Hedera demonstration surface, so this is an extension rather than a new platform. Add immudb when the client wants database-level verification; reserve Glacier Vault Lock for the retention subset that legally must be immutable.

Be precise in the demo: a hash proves integrity, not immutability. Only WORM storage or an append-only verified database prevents deletion.

## 4. What must be true before production

1. Promote the eleven nuclear skills through qualified review; drafts cannot govern a real decision.
2. Run a scheduler — Temporal or a worker — before claiming clock supervision.
3. Approve the calendar interpretation (timezone, holidays, working-day definition). Today it is explicitly `not-approved-for-reliance`.
4. Confirm §21.21(c) transmission mechanics with the client's regulatory affairs function; the 2-day and 30-day branches are computed, not submitted.
5. Add trusted timestamping and anchoring for evidence custody.
6. Validate the application under the client's QA program before it is used to support a Part 21 decision.
