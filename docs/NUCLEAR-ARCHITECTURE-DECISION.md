# Nuclear assurance architecture decision

**Part 21 Assurance OS · 18 November 2026**  
**Status: architecture assessment and draft control contracts—not a nuclear qualification, compliance certification, or deployment of Temporal, eCFR ingestion, a protected vault, or Ollama.**

## Executive decision

Your team is right to demand greater specificity. Keep the application’s audit workspace, Kanban, database, knowledge graph, Muse connector and conversation traceability foundation. Change the control architecture underneath them so that exact nuclear obligations, durable workflow execution and accountable human decisions—not broad audit terminology or AI confidence—determine the process.

Use **10 CFR Part 21** as the defect/noncompliance evaluation and notification framework, and **10 CFR Part 50 Appendix B** as the applicable nuclear quality-assurance framework. This is NRC Title 10, not FAA Title 14 Part 21. A generic quality finding is not automatically a Part 21-reportable defect. Scope, safety function, technical evaluation and responsible-officer decisions must be recorded.

The recommended separation is:

```text
Versioned eCFR provisions + separately controlled NRC/guidance documents
                              ↓
Reviewed obligations, applicability decisions and deterministic policy rules
                              ↓
MySQL operational facts + audit-scoped bitemporal knowledge graph
                              ↓
Temporal case workflows, deadlines, task routing and human approvals
                    ↙                         ↘
Muse / application Kanban               Governed original-record vault
                              ↑
Grounded LLM recommendations using approved skills and exact evidence IDs
```

The LLM supports this process. It does not replace the source, determine the legal clock, certify an uploaded statement, approve its own reasoning, or independently transmit NRC notifications.

## 1. What is specifically nuclear?

**Part 21 asks:** Does this entity, activity or basic component fall within scope? Was a deviation or failure to comply discovered? Could the condition create a substantial safety hazard? Who has evaluation capability? What technical evaluation and affected-population search were performed? When did the responsible officer obtain the relevant information? What notifications and records are required? Its important provisions include §§21.2–21.3, 21.6, 21.21, 21.31, 21.41 and 21.51. The inspection/enforcement provisions remain in the coverage inventory, but they are not substitutes for the substantive evaluation requirements. [1]

**Appendix B asks:** Were safety-related design, procurement, document control, item identification, inspection, nonconforming material, corrective action, records and independent audits controlled under the applicable QA program? It has eighteen criteria. Criterion VIII concerns identification and control of materials, parts and components; XV concerns nonconforming material; XVI corrective action; XVII QA records; XVIII audits. Scope and application depend on the entity, activity, licensing basis, commitments and contract. [2]

Audit creation should therefore select a governed profile: internal nuclear QA audit, supplier/basic-component audit, commercial-grade dedication audit, focused Part 21 evaluation-process audit, or NRC inspection-support case. Each profile determines required evidence, applicable criteria, authorized reviewers and reporting path. A regulatory evaluation case can link to multiple audits; it should not be re-created or have its deadline restarted when someone changes workspaces.

The repository currently contains generic labels calling §21.51 “traceability” and §21.61 “nonconforming articles.” These need a qualified, versioned correction. The actual titles are **Maintenance and inspection of records** and **Failure to notify**, respectively. Heat/lot identification and nonconforming material should link to the correct Appendix B criteria, and to Part 21 when the separate applicability/evaluation basis is established. [1][2]

## 2. What the eCFR API supplies—and what it does not

The eCFR API is public and needs **no API key**. It supplies title metadata, point-in-time content and a document hierarchy. I verified the Title 10 metadata, a hierarchy response and Part 21 full XML. The observed titles response reported Title 10 current through **2026-11-09**. That is a source-reported baseline, not a claim that the application is synchronized or current to today. Different source responses can have different currency, so record the actual response metadata and snapshot used. [3][4]

The hierarchy gives us structural identifiers and headings for title, chapter, part, section and appendix. That removes much manual structural work. It does **not** supply our operational knowledge graph, already-reviewed legal interpretations or executable rules. Even paragraph reconstruction requires validation: GPO documents that numbered paragraphs can be represented as text in flat XML paragraphs rather than a complete nested hierarchy. Do not use unstable provider-generated XML node identifiers as permanent legal provision IDs. [5]

Build four linked layers: **source provision → reviewed obligation → executable rule → supporting evidence and human decision**. Preserve exact text, citation/paragraph anchor, source URI, retrieval time, source-as-of date, available amendment metadata and a digest of the raw downloaded bytes. Keep original snapshots separately from parser output. Changes become proposed revisions and impact reviews; they do not silently replace the policy governing an existing case.

Policy-as-code should return `pass`, `fail`, `unknown` or `not_applicable`, with required evidence IDs, applicability basis and reviewer status. Numeric coverage derived from first-word keyword matches is not regulatory compliance. Missing evidence means unknown, not a speculative pass. The LLM may propose an obligation decomposition, but a qualified reviewer approves the interpretation and test cases before activation.

The eCFR contains regulations, not all implementation guidance. NRC Regulatory Guides and inspection procedures need separate source ingestion. NEI and EPRI guidance and NQA-1 require edition, endorsement/commitment and licensing checks. RG1.164 Revision 1 endorses EPRI3002002982 with specific exceptions/clarifications; it does not make every referenced document binding or freely redistributable. [6]

## 3. Temporal: use it, but anchor clocks to the correct facts

Temporal is a good fit for long-running evaluation cases, human decisions, reminders, recovery and workflow history. It belongs alongside Express/MySQL—not inside a chat response or a process-local JavaScript timer. Run a Temporal Service and separately managed TypeScript workers. External tools, database/graph queries, LLM requests and document generation run in Activities. Workflow logic remains deterministic and replay-safe. [7]

**Audit start is not the universal clock trigger.** Preserve the actual event times separately. A late human acknowledgement must not replace the discovery date or reset an already-running obligation. The key §21.21 branches are:

- **Discovery → evaluation:** evaluate as soon as practicable and within 60 days. If a qualifying evaluation cannot finish within that period, a written interim report is required within the same 60-day period, with the expected completion date. An interim report is not an automatic fresh 60 days.
- **Qualifying evaluation completion → officer information:** inform the director/responsible officer as soon as practicable and within five working days under §21.21(a)(3).
- **Supplier determines it lacks evaluation capability → purchaser/affected-licensee notice:** within five working days under §21.21(b). This is a different trigger and duty from officer escalation.
- **Actual responsible-officer receipt of qualifying information → NRC notices:** the initial notice is due within two days; written notice within 30 days of that same receipt—not 30 days after the initial call. Applicability and the rule’s prior-notification exception require evidence and qualified review. [1]

These are independent event-triggered branches, not a serial `60 + 5 + 2 + 30` countdown. Day-45 preparation or reminders can be internal controls, clearly labeled as such. “As soon as practicable” remains visible; the outer limit is not permission to wait.

Five working days must not become 120 hours. Record a qualified, versioned calendar/time interpretation with the relevant timezone, holidays, triggering-day treatment and cutoff. Use deterministic calculations and preserve the resulting due date and explanation. Test year boundaries, weekends, holidays, daylight-saving changes, backdated discovery and earlier officer receipt.

Commit authorized business facts and outbox events together in MySQL. Deliver them to Temporal with stable event IDs; use idempotent Activities and revision checks when updating tasks, warnings and graph provenance. Distinguish committed, delivered and applied: an accepted Signal is not proof that a worker applied the business transition. Retries do not guarantee exactly-once external side effects. Deadline supervision must continue even when an LLM is unavailable or a human task is waiting.

For this app, NRC transmission remains an authorized human action. Store actual method, time, approved artifact and receipt/verification evidence. A completed task or drafted report is not a submission receipt. Maintain a manual contingency for outages. Temporal history is useful execution evidence, but it is not the five-/ten-/fifteen-year regulatory records vault; current Cloud closed-history retention is much shorter. [7]

## 4. Records vault: preservation, integrity and attribution are separate

I have interpreted “Mimo/MDB” as likely **MinIO/immudb**; confirm those names before selecting a vendor.

Prioritize a maintained **versioned Object Lock-capable vault for original bytes**. Store original workbook, PDF, photo and audio bytes as well as approved report/decision artifacts. MySQL keeps searchable metadata and exact object version references. Parsed text, OCR and transcripts are identified derivatives, not replacements for originals.

Object Lock governance mode can be bypassed by appropriately privileged users. Compliance mode prevents early deletion/shortening through the storage API during the protected period. Legal holds supplement timed retention but require controlled release. Protect the infrastructure, keys, backups and clock as well; API-level locking does not prevent disk loss or host compromise. Always retrieve the exact retained object version, not just the latest filename. [8]

A material selection issue: **MinIO’s community repository currently says it is no longer maintained.** Do not choose that distribution by default for a new long-lived nuclear records service. Evaluate a maintained managed Object Lock service or the current supported MinIO/AIStor offering after support and license review. I have not bought or deployed either. [9]

immudb can supplement MySQL with cryptographically verifiable event payloads, digests, signed states and independent checkpoints. It does not replace an original-record vault: its documented retention/truncation can remove value bytes while preserving proofs. Current licensing also requires review; it is not safe to assume every current release is blanket Apache-2.0 open source. [10]

**No storage product certifies Appendix B compliance or proves that a record is true.** Retention, tamper detection and nonrepudiation are different controls. Identity-bound approvals/signatures over exact artifacts, trusted key bindings and timestamps, separation of duties, independent checkpoints, retrievability and tested recovery are needed. §21.51 has record-specific triggers, including at least five years after evaluation, five years after supplier notification and ten years after delivery for basic-component purchaser records; some design categories have fifteen-year purchaser-record periods. Apply longer applicable QA/contract/hold requirements where required, not one global retention setting. [1][2]

The code review found a concrete current gap: the Kanban attachment path hashes incoming bytes but stores metadata/hash, not the original binary or a retrievable object location. That must be corrected before claiming preserved photo/document evidence. A hash alone cannot reproduce a missing file. Existing append-only application writes and mutable database payloads are not demonstrated WORM controls.

## 5. Ollama: feasible as an optional provider, not a compliance shortcut

Ollama can serve local chat, tool-call requests and structured outputs. The application still executes authorized tools, validates results and grounds the prompt in database/graph facts and approved skill revisions. Pin the actual model/provider/version and retain the prompt-context manifest, source IDs, response and review disposition. JSON-schema conformity does not establish factual accuracy. [11]

Use a separately sized, privately reachable inference host with authenticated TLS access. Do not expose Ollama’s unauthenticated local API publicly or assume the application container’s `localhost` is your workstation. Model size, context and concurrency determine RAM/VRAM and latency; benchmark before promising performance. No Ollama host, model or dispatch adapter is deployed by this assessment.

If local-only inference is selected, allowlist approved local models and disable cloud fallback. Ollama documents `OLLAMA_NO_CLOUD=1`; a localhost request alone is not proof of local processing because cloud models can be selected through the local service. Enforce approved data egress outside the prompt. [11]

As requested, a full airgap build and a new Playwright/software-assurance program are deferred. They are not absent requirements merely because we defer them. Local inference does not make Muse field capture or other external connectors airgapped or automatically suitable for restricted nuclear information. Cybersecurity/export overlays require actual scope decisions and technical controls, not just a warning in a skill description.

## 6. Skills and the Muse/Kanban dialogue

Use one overall Part 21 orchestration/coverage layer and focused skills selected by **case type, current stage, known facts, unresolved evidence and user intent**. There is no regulator-mandated skill count. The obligation inventory and applicable Appendix B criteria—not the number of library cards—measure coverage.

Eleven focused draft contracts now cover applicability, discovery/clocks, deviation/defect screening, substantial-safety-hazard evaluation, officer/NRC notification, supplier evaluation capability and transfer, commercial-grade dedication, design/interface control, nonconformance/CAP, records/audits, and postings/communications. They supplement rather than replace general scope, evidence, genealogy, finding challenge and report-closure skills. A full Appendix B audit may need further criterion-specific skills; these eleven are not a claim of all eighteen criteria being implemented.

Each applied skill must carry its ID/revision, governing source/paragraphs, applicability test, required fields/evidence, question contract, executed tools, output, unknowns and human gate. A route string is not an executed agent. Every required answer is checked separately; optional answers must not compensate for missing mandatory evidence.

For the receiving-record example **2-481 / heat 7B-441 / AUD-026**, the agent should first establish whether the actual record and material population exist in that audit’s data. It should ask for the receiving record, certificate, heat/lot identity and discrepancy, then load item-identification/supplier-control skills and, when justified, Part 21 screening. Similar titles are candidate relationships, not proof of a link. Do not attach F-036, F-039 or F-042 based only on resemblance.

One Kanban item becomes the case’s communication/evidence dossier: user messages, audio bytes and transcript, photos/documents, agent answers, skill/tool traces, source-linked assertions, human decisions and stage-change reasons. Each event carries the acting principal, channel, timestamp, audit/case/card IDs and record revision. Moving backlog to active can trigger further skill-led questions, but does not create a legal conclusion or restart the statutory clock. An incomplete note can remain flagged pending clarification; the application should never invent actionable details to make it look complete.

## 7. What must change first in the existing application

The read-only implementation review found seven material areas: inconsistent authentication/audit ownership across equivalent REST/MCP paths; original attachment bytes not retained; first-audit/keyword policy checks; inaccurate generic citations; skill routes that are not dispatched as claimed; incomplete reviewed configuration activation; and no implemented eCFR synchronization/Temporal/vault/Ollama architecture.

The release priority is therefore: **identity and audit isolation plus original evidence preservation first; approved source/citation mapping and real deterministic rules second; durable workflows and records controls next; optional Ollama after provider/egress approval.** Preserve the visible workspace and connector behavior while changing these boundaries through reviewed versions. Do not replace the app or disturb Socra merely to add another service.

TypeScript compilation, existing tests and a build are engineering checks—not nuclear qualification. Release evidence must additionally establish scoped graph traversal, actual source IDs and event IDs, exact skill execution, working-day/day-count tests, restart/replay/idempotency, negative authorization, original-byte download/digest checks, retention/hold controls, and qualified approvals.

## 8. Actual change status from this assessment

The source/architecture review and public API verification are complete. Eleven nuclear skill definitions are **draft candidates**, with four adjacent source-link overlays also draft. They are not downloaded authoritative source snapshots, approved legal interpretations, active nuclear agents or durable timers.

During initial staging, this session’s candidate configuration was automatically marked approved. That was incorrect. Those fifteen newly created rows only were returned to draft, the automatic approval values cleared, and a correction event recorded. No existing approved or operational records were changed. Draft candidates are isolated from legacy runtime lookups; runtime/UI wiring for the unapproved nuclear pack was withdrawn.

A narrowly scoped active-configuration loader repair is prepared: ignore drafts/retired rows, pin exact active revisions, reject competing active versions and permit retry after a loading failure. Four focused tests cover that selection behavior. It does not fix the broader policy/authentication/evidence gaps. It is a saved code change, not a claim of new publication.

**Temporal, live eCFR ingestion/rule compilation, a governed Object Lock vault, immudb verification, Ollama and nuclear V&V remain unimplemented. No new service, subscription or infrastructure purchase was made; this turn does not authorize or perform a new publication or a change to Socra.**

## Technical supporting notes

[Current-code implementation review](/home/ubuntu/part21ops/docs/nuclear-implementation-review.md) identifies concrete files/lines and distinguishes candidate material from runtime behavior. [Temporal research](/home/ubuntu/part21ops/docs/research-temporal.md), [records-vault/Ollama research](/home/ubuntu/part21ops/docs/research-vault-ollama.md) and [eCFR observations](/home/ubuntu/part21ops/docs/research-ecfr.md) contain the detailed verified sources. [Observed Part 21 document hierarchy](/home/ubuntu/part21ops/docs/ecfr-observed-structure.json) is a compact source extraction—not application graph ingestion.

## Primary sources

[1] [10 CFR Part 21, including §21.21 and §21.51](https://www.ecfr.gov/current/title-10/chapter-I/part-21). eCFR is a continuously updated, unofficial legal edition; retain the applicable baseline and reconcile authoritative CFR/Federal Register materials where necessary.

[2] [10 CFR Part 50 Appendix B](https://www.ecfr.gov/current/title-10/chapter-I/part-50/appendix-Appendix%20B%20to%20Part%2050).

[3] [eCFR REST API](https://www.ecfr.gov/reader-aids/ecfr-developer-resources/rest-api-interactive-documentation).

[4] [eCFR date semantics](https://www.ecfr.gov/reader-aids/ecfr-developer-resources/understanding-ecfr-dates).

[5] [GPO eCFR XML guide](https://raw.githubusercontent.com/usgpo/bulk-data/master/ECFR-XML-User-Guide.md).

[6] [NRC RG1.164 Revision 1](https://www.nrc.gov/docs/ML2403/ML24038A310.pdf).

[7] [Temporal TypeScript timers](https://docs.temporal.io/develop/typescript/workflows/timers), [message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing), and [history export](https://docs.temporal.io/cloud/export).

[8] [Object Lock semantics](https://docs.min.io/aistor/administration/object-locking-and-immutability/).

[9] [MinIO community maintenance/license notice](https://github.com/minio/minio).

[10] [immudb retention](https://immudb.io/docs/production/retention/) and [current license](https://github.com/codenotary/immudb/blob/master/LICENSE).

[11] [Ollama FAQ/privacy/cloud-disable](https://docs.ollama.com/faq), [tool calling](https://docs.ollama.com/capabilities/tool-calling), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs), and [API authentication](https://docs.ollama.com/api/authentication).
