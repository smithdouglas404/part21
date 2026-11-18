# Part 21 process, clocks and human gates

**Purpose:** define the operating process the application must support, the timing that must never be inferred, and the human decisions that cannot be delegated to an agent. This is an operating model, not a legal opinion or a compliance certification. Qualified nuclear, quality, legal and compliance review remains required.

**Current status:** the published demo supports audit workspaces, findings, graph traversal, field Kanban, persisted agent dialogue, skills, evidence records and role-routed report approval. Durable regulatory clocks (Temporal), externally protected original-record storage and source-pinned policy activation are staged, not live. Do not demonstrate them as running.

## 1. The regulatory spine

Two frameworks, deliberately kept separate:

- **10 CFR Part 21** governs discovery, evaluation, and notification of defects and noncompliance that could create a substantial safety hazard. It is the reporting framework.
- **10 CFR Part 50 Appendix B** governs the nuclear quality-assurance program across eighteen criteria. It is the control framework.

A quality finding is not automatically a Part 21 reportable defect. Applicability, safety significance and reportability are three separate qualified decisions. Confusing them is the most common and most damaging failure mode in an application like this.

## 2. Event-triggered branches — never a single countdown

Each branch below starts from its own recorded fact. Audit start, Kanban creation, a chat message, or an approval click never starts or restarts a statutory clock.

| Branch | Trigger fact | Obligation | Outer limit | Source |
|---|---|---|---|---|
| Evaluation | Documented discovery of a potential defect/noncompliance | Evaluate and decide whether it could create a substantial safety hazard | As soon as practicable, within 60 days | §21.21(a) |
| Interim report | Evaluation not complete at 60 days | Written interim report with expected completion date | Within the same 60 days — not a fresh 60 | §21.21(a) |
| Officer information | Qualifying evaluation completed | Inform the director/responsible officer | As soon as practicable, within 5 working days | §21.21(a)(3) |
| Supplier capability | Supplier determines it cannot evaluate | Notify purchaser / affected licensee | Within 5 working days | §21.21(b) |
| NRC initial notice | Responsible officer receives qualifying information | Initial notification to NRC | Within 2 days | §21.21(c) |
| NRC written notice | Same officer receipt fact | Written notification | Within 30 days of that same receipt — not 30 days after the call | §21.21(c) |

Working days require a reviewed calendar: timezone, holidays, whether the trigger day counts, and cutoff time. Five working days is not 120 hours. "As soon as practicable" stays visible even when the outer limit has not expired.

## 3. The gates a human must close

Each gate must record who decided, their qualification and evidence reference, the exact artifact hash reviewed, the rationale, and the timestamp. A persona selection, an administrator flag or an agent recommendation is never authority.

1. **Scope and applicability gate** — Is this an entity, activity or basic component within Part 21 scope, and which Appendix B criteria apply?
2. **Discovery gate** — What exactly was discovered, when, by whom, on what evidence? This is the clock trigger and it must be defensible.
3. **Evaluation gate** — Was the technical evaluation adequate, and is a substantial safety hazard possible?
4. **Interim-report gate** — If evaluation is incomplete at day 60, is the interim report complete and issued?
5. **Officer notification gate** — Was the responsible officer informed within five working days, with the evaluation basis?
6. **Reportability gate** — Quality, legal and compliance concurrence on the notification decision and prior-notification exceptions.
7. **Transmission gate** — A named human transmits, and the method, time, recipients, artifact and receipt are recorded. A drafted report is not a submission receipt.
8. **Report finalization gate** — Separation of duties: the author cannot approve their own report; approval binds to the exact artifact hash and triggers the graph promotion.
9. **Records and closure gate** — Retention basis assigned, hold status resolved, retrieval verified, and the case closed with reasons.

## 4. Where each step lives in the application

| Process step | Application surface | Live today |
|---|---|---|
| Audit scoping and profile selection | Audit workspace, governed profile | Partly — profiles staged |
| Discovery capture (voice, photo, document) | Muse → Kanban dossier, original bytes retained | Yes for records; original-byte vault staged |
| Skill-led questioning | Persisted dialogue with skill ID/version and tool trace | Yes |
| Evidence linkage | Evidence register, graph edges, attachment timeline | Yes |
| Deterministic rule evaluation | Pinned source → reviewed obligation → executable rule | Staged |
| Clock supervision and escalation | Temporal workflows, outbox, notices | Staged — no production timers |
| Human decisions | Approval routes, qualification-bound decisions | Yes for report approval; expanded gates staged |
| Notification and receipt | Human-recorded transmission evidence | Not automated by design |
| Graph promotion after approval | Approved revision writer, bitemporal events | Yes |
| Records protection | Versioned original store, Object Lock adapter | MySQL originals live; external Object Lock staged |

## 5. What must be done before this is production-credible

**Process and qualification**
- Approve written Part 21 procedures: discovery, evaluation, officer notification, NRC notification, interim reports, records, and postings under §21.6.
- Define audit profiles and which Appendix B criteria each covers; do not claim all eighteen are implemented.
- Qualify reviewers and record qualification evidence with expiry; separate quality, nuclear, legal and compliance concurrence.
- Train users on the gates and run a tabletop drill of a 60-day evaluation with an interim report and a 2-day notification.

**Software assurance**
- Validation plan and IQ/OQ/PQ against the intended use, with traceability from requirement to test.
- Software QA per the licensee's commitments (for example RG 1.28 / 1.152 or IEEE 730/1012 as applicable) — confirm which apply rather than assuming.
- Negative testing: cross-audit access, look-only tokens, self-approval, unqualified approval, replay and duplicate events.
- Restart, replay and idempotency tests for any workflow engine; clock tests across weekends, holidays, year boundaries and daylight saving.

**Records and security**
- Retention schedule per record class, legal holds, and retrieval testing. §21.51 periods differ by record type; do not apply one global number.
- Backups with restore drills, key management, and immutable audit trail verification.
- Cybersecurity review against the applicable baseline (10 CFR 73.54 where in scope), and export-control review under 10 CFR Part 810 before sharing controlled information externally.
- Access reviews and joiner/mover/leaver process.

**Operations**
- Monitoring and alerting for overdue clocks and failed integrations.
- Supplier flowdown verification under §21.31 and instructions under §21.41.
- Corrective action linkage under Appendix B Criterion XVI, with effectiveness checks.
- Periodic self-assessment and management review of the assurance process itself.

## 6. Demonstration guidance

Show the honest chain: a field observation arrives with original evidence, a skill-led dialogue asks the required questions, the graph shows what is actually linked, the agent recommends but does not decide, a named qualified reviewer approves, and the report hash and graph promotion are recorded.

Say plainly which items are staged: durable clocks, external Object Lock, immudb verification and source-pinned policy activation. A working demo is not a qualified system, and no storage product or hash certifies compliance.
