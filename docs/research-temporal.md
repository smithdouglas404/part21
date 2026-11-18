# Temporal design implications for the Part 21 application

**Author:** Manus AI · **Reviewed:** November 18, 2026

Use Temporal as a candidate durable orchestration layer beside Node/Express and MySQL, not as the bitemporal graph or regulatory records repository. The recommendations below are design proposals; no Temporal installation, running worker, integration, deployment, or compliance validation is asserted.

## Statutory clocks need distinct triggering events

**Audit start is not discovery.** Section 21.3 defines discovery as completion of the documentation first identifying a deviation or failure to comply potentially associated with a substantial safety hazard within the evaluation procedures. Preserve `auditStartedAt`, initial issue-identification time, human-confirmed `discoveredAt`, the discovery document/version, and database transaction time separately. Confirmation in the UI must preserve the actual triggering date, not substitute today's approval date. Late intake or correction must not silently restart clocks. The government-maintained eCFR is authoritative but unofficial; the retrieved §21.21 page reported title currency through November 13, 2026. [1] [6]

The required triggers are:

- **Evaluation:** as soon as practicable and within **60 calendar days of discovery**. If the potentially safety-significant matter cannot be evaluated within that period, prepare and submit an interim report in writing to the Commission through the officer/director or designated person **within those same 60 days**. It describes the matter and states when evaluation will finish. Track that stated completion date; do not treat an interim report as an automatic additional 60 days. [1] [7]
- **Supplier lacks evaluation capability:** inform purchasers or affected licensees **within five working days of the supplier's determination that it lacks capability**, not audit start, discovery, or a generic “evaluation overdue” event. Record `capabilityDeterminedAt` and recipient-specific notification evidence. This branch is different from being capable but needing more evaluation time. [1]
- **Qualifying completed evaluation:** inform the director/responsible officer as soon as practicable and **within five working days after completion**, when §21.21(a)(3)'s defect or qualifying failure-to-comply conditions apply. Record `evaluationCompletedAt` separately from actual officer information receipt. [1]
- **NRC initial notice:** **within two calendar days following officer receipt of information** identifying the defect/failure. **Written notice:** **within 30 calendar days following that receipt**, not 30 days after initial notice. The two-day initial requirement does not apply to the interim report. Do not make the system wait for a Kanban move or the full five-working-day allowance when actual qualifying information was received earlier. [1] [7]

Keep the rule's “as soon as practicable” requirement visible; the outer deadline is not a recommended waiting period. Section 21.21(d)(2)'s actual-knowledge exception for prior written Commission notification needs source evidence and a qualified human decision. Regulatory Guide 1.234 Revision 1 endorses NEI 14-09 Revision 1 with clarifications for specified nuclear-power applicants/licensees, dedicating entities and suppliers; it is guidance, not a replacement for the regulation or a blanket interpretation for every Part 21 entity. [1] [8]

**Human-only NRC notification is the application's safety policy**, not a claim that the regulation forbids software assistance. Temporal may draft, remind, route and escalate. An authenticated officer or authorized human designee makes and attests the external notification; the officer retains responsibility. The current initial-notice rule specifies fax or telephone and verification of fax receipt by calling the Operations Center. A prepared report, internal email, approved draft, timer firing or Kanban move is not evidence of NRC submission. Persist actual contact/submission time, method, submitting human, approved report hash and receipt/verification evidence. [1]

## Workflow structure for clocks, approvals, Kanban and Muse

Use one `Part21CaseWorkflow` per organization and deviation/evaluation case, with a stable business Workflow ID and links to relevant audits. Audits are scope/provenance, not the statutory clock owner. Carry only case IDs, record revisions, human event IDs, policy/calendar versions, trigger timestamps and deadlines. MySQL remains authoritative for operational records and bitemporal graph revisions.

Keep independent deadline branches within the case workflow for evaluation/interim, supplier capability notification, officer escalation, initial NRC notice and written NRC notice. Branches activate from their particular committed facts; they must not be implemented as one serial “60 + 5 + 2 + 30” countdown. Use workflow `sleep` or timed `condition` to wait for completion evidence, an approved correction, or the next warning/deadline. TypeScript durable timers are persisted and resource-light, can last months, and resolve after service/worker recovery if the due time passed during an outage. They are not ordinary Express process timers. [9]

Use small task/approval child workflows where they have an independent lifecycle; do not put every Kanban edit or Muse token into the statutory case history. Kanban is a MySQL-backed projection of tasks, accepted human decisions and workflow delivery/application status. Muse output stays a sourced recommendation until a qualified human accepts it. Run LLM calls, graph queries, document generation, notification preparation and database writes in Activities, not workflow code. TypeScript workflows execute in a deterministic sandbox; external state and side effects go through Activities, whose recorded outputs support replay. [4] [10]

For human commands, define typed messages with `defineSignal`, `defineUpdate` and `setHandler`. **Signals** suit committed asynchronous facts and remain deliverable when the worker is temporarily unavailable, but acknowledgment means the service accepted the signal—not that its handler ran. **Updates** suit state-sensitive actions such as accepting an approval or validating a transition when the client needs a result; validators are synchronous and cannot query MySQL. Updates require a responsive worker to accept/reject. **Queries** are read-only, do not add history, and need a worker; use the database projection for the main dashboard rather than treating Queries as an audit log. [11]

Authenticate and authorize humans in Express, validate record versions in the database, and record the actor there; a client-supplied approver name is not identity proof. Serialize transitions or guard async handlers against interleaving. Wait for `allHandlersFinished` before completing or Continue-As-New. Use current Worker Versioning or patching and replay tests for code changes; altering Activity/timer command order can break existing histories. [11] [12] [13]

## Transactional outbox and recovery behavior

The following is an application integration recommendation, not a Temporal-provided atomic transaction across MySQL and Temporal:

1. In a single MySQL transaction, append the authorized human fact/command and its bitemporal revision, plus an outbox row containing case Workflow ID, immutable business event ID, expected revision and payload reference. If MySQL is unavailable, fail visibly; do not create operational facts in memory or fixtures.
2. A dispatcher starts/signals/updates the workflow and retries transport failures. Use explicit Workflow ID conflict/reuse policies; Signal-With-Start can atomically start-or-signal within Temporal, but it does not make the MySQL transaction atomic. Distinguish `committed`, `delivered`, `applied` and `rejected` states. Never label an outbox row applied merely because a Signal call returned. [11]
3. Deduplicate by the immutable event/decision ID in workflow state and in database Activity transactions using uniqueness constraints. Signal handlers need application deduplication. Updates deduplicate by Update ID on the service **per run**; maintain business deduplication across Continue-As-New, resets and recovery. Use business operation keys stable across runs rather than only Run ID plus Activity ID when the side effect must never repeat across resets. [4] [12]
4. Every Activity that mutates records/projections returns the already-committed result on duplicate invocation. A worker can commit a write and crash before reporting success, causing Activity re-execution. Temporal observes an Activity completion once but can execute it multiple times: this is **not exactly-once external side effects**. Record stale/conflicting transitions visibly instead of dropping them or overwriting human facts. [4]
5. On recovery, reconstruct pending work from the database and workflow history, re-deliver unapplied events, and reconcile case revisions, deadlines and projections. Catch-up emits overdue warnings with original due dates; it never replaces them with recovery time. Workflow reset is a controlled operator action, not an undo of MySQL writes or an external human notification. [3] [9]

Activities retry by default with exponential backoff—one-second initial interval, coefficient 2, maximum interval 100 seconds, unlimited attempts unless constrained by timeouts/policy. Workflow Executions do **not** retry by default; Workflow Task retries/replay are a different mechanism. Set explicit `startToCloseTimeout`, a total `scheduleToCloseTimeout` where appropriate, and permanent-error handling. Heartbeat lengthy imports/document operations. Catch exhausted preparation/delivery failures so the statutory case remains open and visibly blocked rather than dying or waiting silently indefinitely. Keep deadline supervision independent of a slow retrying Activity. [14] [15]

Do not automatically retry a fax/telephone regulatory submission as an Activity: external delivery can be ambiguous and human-only notice must stay human-only. Internal reminders can use idempotency/delivery records and escalate uncertain outcomes for review. Ordinary outages cannot guarantee timely real-world action; require early warning margins, worker/task-queue and outbox monitoring, on-call response, backups/recovery testing and a manual regulatory-notification contingency. [4] [9]

## Working-day calendars are governed policy inputs

Temporal timers measure fixed periods; they do not supply the Part 21 legal working-day calendar. Do not implement five working days as 120 hours. Use a human-approved, versioned calendar policy recording jurisdiction/entity, IANA time zone, working weekdays, applicable holiday/observance rules, triggering-day treatment and deadline cutoff. Store the computed local date, UTC instant, calendar version and calculation explanation with each obligation. Sections 21.3 and 21.21 do not themselves specify a universal weekend/holiday exclusion algorithm; obtain the client's applicable interpretation rather than claiming US federal holidays are always the correct calendar. [1] [6] [9]

Calculate deadlines through a recorded Activity result or a pure deterministic function using an immutable calendar snapshot. Never fetch a changing holiday API directly during replay. Calendar days for the 60/2/30-day rules must remain calendar days; local-date arithmetic and DST can differ from simply adding multiples of 24 hours. Trigger-date, calendar or policy corrections require an authorized revision, explanation and recalculated deadline event; preserve the original result and any missed-deadline evidence. Test weekends, observed holidays, year boundaries, DST, backdated discovery and earlier officer receipt before enabling clocks. [7] [10]

## Hosting, licensing and record retention

Both **Temporal Server and TypeScript SDK are MIT-licensed**, allowing commercial use/modification/distribution with copyright/license notices retained and an “as is” warranty disclaimer. They are not Apache-licensed in the reviewed repositories. Dependency licenses still need review. Self-hosting has no Temporal software fee, but service infrastructure, persistence/visibility storage, security, upgrades, monitoring and disaster recovery remain the operator's responsibility. A CLI development server is not evidence of production readiness. [16] [17] [18]

Temporal Cloud manages the Service; application workers still run in the customer's environment. For this proposal, deploy a separate managed TypeScript worker process beside—not inside the lifecycle of—Express requests. Cloud does not eliminate worker capacity, networking, authentication or availability requirements. Current Cloud pricing is consumption-based for Actions, history storage and support, with self-serve entry from $0/month; that is not a promise of zero operating cost. Recheck rates/contract terms when selecting hosting. Configure payload encryption where required rather than assuming SDK payload encryption is automatic; minimize sensitive evidence in history. [5] [19]

Event History is durably persisted and append-only for execution/replay/debugging, but bounded. Use Continue-As-New before limits, carrying pending obligations, original triggers and deduplication state, and retain the run chain in MySQL. It is not a substitute for approved evidence, bitemporal valid/transaction time, accountable human identities or legal-hold controls. Rejected Update validators and Queries do not create history events; Activity retries are not a complete business attempt ledger. Principal Attribution is documented as pre-release and may identify the Express service principal rather than the acting human. [3] [11] [14]

Section 21.51 requires evaluations retained at least **five years after evaluation**; suppliers' purchaser/affected-licensee notifications **five years after notification**; supplier purchaser records **ten years after delivery**; and certain standard-design certification/approval purchaser records **15 years**. Records must be available for NRC inspection. Apply record-specific rules and other applicable QA/legal holds, not one five-year global setting. [2]

Cloud closed-history retention is configurable up to **90 days**. Cloud Export can send eligible closed histories to object storage, but must be enabled before closure, has no guaranteed historical backfill, delivers at least once with possible duplicates, and may take up to 24 hours. Self-hosted Archival also preserves closed histories beyond retention, but official documentation labels it **experimental**. Neither feature alone provides the application's validated regulatory archive. Keep MySQL/evidence archives, retention controls, immutable versions/hashes and tested restoration independent of workflow retention. [5] [20] [21]

## References

[1]: https://www.ecfr.gov/current/title-10/chapter-I/part-21/subject-group-ECFR4f71805c7289910/section-21.21 "10 CFR 21.21 — Notification and evaluation"
[2]: https://www.ecfr.gov/current/title-10/chapter-I/part-21/subject-group-ECFRe8d39c64608af9e/section-21.51 "10 CFR 21.51 — Maintenance and inspection of records"
[3]: https://docs.temporal.io/workflow-execution/event "Temporal Events and Event History"
[4]: https://docs.temporal.io/activity-definition "Temporal Activity Definition and idempotency"
[5]: https://temporal.io/pricing "Temporal platform pricing and self-hosted option"
[6]: https://www.ecfr.gov/current/title-10/chapter-I/part-21 "10 CFR Part 21 — Definitions including discovery"
[7]: https://www.nrc.gov/docs/ML1605/ML16054A825.pdf "NRC-hosted NEI 14-09 Revision 1 — Sections 7 through 9"
[8]: https://downloads.regulations.gov/NRC-2023-0167-0005/content.pdf "NRC Regulatory Guide 1.234 Revision 1 — March 2024"
[9]: https://docs.temporal.io/develop/typescript/workflows/timers "Temporal TypeScript durable timers"
[10]: https://docs.temporal.io/develop/typescript/workflows/basics "Temporal TypeScript Workflow basics and determinism"
[11]: https://docs.temporal.io/develop/typescript/workflows/message-passing "Temporal TypeScript Signals Queries Updates and handlers"
[12]: https://docs.temporal.io/handling-messages "Temporal message concurrency and deduplication"
[13]: https://docs.temporal.io/develop/typescript/workflows/versioning "Temporal TypeScript Workflow versioning and replay safety"
[14]: https://docs.temporal.io/encyclopedia/retry-policies "Temporal Retry Policies and defaults"
[15]: https://docs.temporal.io/develop/typescript/activities/timeouts "Temporal TypeScript Activity timeouts retries and heartbeats"
[16]: https://github.com/temporalio/temporal/blob/main/LICENSE "Temporal Server MIT license"
[17]: https://github.com/temporalio/sdk-typescript/blob/main/LICENSE "Temporal TypeScript SDK MIT license"
[18]: https://docs.temporal.io/self-hosted-guide "Temporal self-hosted service guide"
[19]: https://docs.temporal.io/evaluate/cloud "Temporal Cloud hosting and worker boundary"
[20]: https://docs.temporal.io/cloud/export "Temporal Cloud Workflow History Export and delivery guarantees"
[21]: https://docs.temporal.io/self-hosted-guide/archival "Temporal experimental self-hosted Archival"
