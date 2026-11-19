# Validation roadmap

How to take this repository from "working reference implementation" to software a licensee can
put in a quality assurance program. Written for a nuclear QA audience, so it separates what
tooling can produce from what only a qualified person can sign.

> **Nothing in this document is a compliance claim.** It is a plan. The signatures at the end
> are the deliverable, and they cannot be produced by software.

---

## 1. Decide which bar you are clearing

There are two legitimate paths, and they cost very different amounts.

### Path A — Commercial-grade dedication (CGD)

Use when the software supports a safety-related function but was not developed under a nuclear
QA program. You dedicate it using EPRI guidance (report 3002002982, accepted by NRC in
RG 1.164 — cited by this repository as an external reference) or an equivalent utility
process.

- Evidence needed: design, verification, configuration control, operating history, failure
  modes, and an acceptance test suite you can rerun.
- Typical effort: 2–4 months with one QA engineer and one subject-matter expert.
- This is the realistic path for a pilot.

### Path B — Software quality assurance program (safety-related, validated)

Use when the software is itself safety-related, or when the licensee decides it is a system of
record for a regulatory commitment. Requires a program meeting 10 CFR Part 50 Appendix B
Criterion III and XVII, with V&V per IEEE 1012 and software lifecycle per IEEE 1074. RG 1.168
and RG 1.173 describe NRC's expectations for software V&V and configuration management.

- Typical effort: 9–18 months, 3–6 people, independent V&V.
- This is the path for a production deployment inside a licensed facility.

Most first deployments should attempt Path A and let the licensee's QA organization tell you
whether Path B is required. Do not decide this yourself; it is their determination.

## 2. The deliverable set

This is "the product" that does not yet exist. Each item is a controlled document with an
owner, a revision and an approval.

| # | Deliverable | Purpose | Who signs |
|---|---|---|---|
| 1 | Software Quality Assurance Plan (SQAP) | How the program operates: organization, controls, audits | QA Manager |
| 2 | Software Requirements Specification (SRS) | Every function and constraint, uniquely identified and testable | Product + QA |
| 3 | Software Design Description (SDD) | Architecture, modules, data model, interfaces | Engineering |
| 4 | Verification & Validation Plan | What will be verified, how, by whom, independence | V&V Lead |
| 5 | Requirements Traceability Matrix (RTM) | Requirement → design → code → test → result, both directions | V&V Lead |
| 6 | Configuration Management Plan (CMP) | Baselines, change control, version identification, release records | CM Lead |
| 7 | Test Plan, Procedures, Results | Executed evidence, not intentions | Test Lead |
| 8 | Installation Qualification (IQ) | The deployed environment matches the validated configuration | QA |
| 9 | Operational Qualification (OQ) | Every function behaves as specified, including negative cases | QA |
| 10 | Performance Qualification (PQ) | It works in the actual workflow, with actual users and data | QA + user |
| 11 | Discrepancy and Corrective Action Log | Every defect, its disposition, its closure | QA |
| 12 | Cybersecurity assessment | 10 CFR 73.54 / RG 5.71 posture if in a protected scope | Cyber |
| 13 | Training records | Who was trained on what, before use | Line Manager |
| 14 | Supplier qualification file | Vendored components, dependency inventory, SBOM | Procurement + QA |
| 15 | Records retention schedule | What is kept, where, for how long, who can destroy it | Records Manager |

## 3. Staged plan

### Stage 0 — Make the product validatable (weeks 0–2)

Technical prerequisites. Without these, validation cannot start because the baseline is not
stable.

- [ ] Replace development-mode Temporal with a production server (Cloud or self-hosted with
      its own schemas) and prove workflow survival across a redeploy.
- [ ] Activate or reject ontology revision `0.2` (`Finding → Regulation`). Do not leave a
      draft that the UI implies is active.
- [ ] Enforce evidence retention rather than describing it.
- [ ] Remove the remaining placeholders (ERP, supplier, document-control adapters) from any
      screen that implies they are live.
- [ ] Produce an SBOM from `pnpm-lock.yaml`; record licenses for vendored ECC and every
      dependency.
- [ ] Freeze a release baseline: tagged commit, immutable image digest, migration set.
- [ ] Stand up separate development, validation and production environments. Validation must
      not run against a shared database.

### Stage 1 — Requirements and traceability (weeks 2–8)

- [ ] Write the SRS from the code and tests, not from the marketing description. Every
      endpoint, rule and refusal becomes a numbered requirement.
- [ ] Build the RTM as data, not a spreadsheet that drifts: requirement ID → test ID →
      automated test name → last result. The repository already has 203 automated tests;
      map them.
- [ ] Write the CMP and put the ontology, skill contracts and policy pack under configuration
      control — they are configuration items, not code.
- [ ] Independent review of the SRS by someone who did not write it.

### Stage 2 — IQ and OQ (weeks 8–14)

- [ ] IQ: install from the tagged baseline into a clean environment; record every version,
      migration, environment variable and permission. Prove the environment matches the
      validated configuration.
- [ ] OQ: execute every requirement's test, including the negative ones. The refusals matter
      more than the features: unauthorized write rejected, unresolvable citation blocks
      activation, ontology-inadmissible node rejected, clock never computed by the model.
- [ ] Record results with timestamps, executor, environment and evidence artifacts.
- [ ] Log every discrepancy; disposition each one (fix, accept, defer) with QA approval.

### Stage 3 — PQ and pilot (weeks 14–20)

- [ ] Run a real audit in parallel with the existing process, not instead of it.
- [ ] Compare outputs: did the system find what the human process found? Where it differed,
      why?
- [ ] Measure what matters: time to evidence, citation accuracy, missed-clock count,
      reviewer rework.
- [ ] Training and procedure updates before go-live.

### Stage 4 — Operations (continuous)

- [ ] Change control: no production change without impact analysis and re-verification of
      affected requirements.
- [ ] Periodic re-validation on dependency or ontology changes.
- [ ] Annual QA audit of the software program.
- [ ] Regulatory snapshot re-ingestion with review, recorded as a configuration change.
- [ ] Incident and defect trending; cybersecurity patching with a defined window.

## 4. Roles you will need

| Role | Responsibility | Can be the same person? |
|---|---|---|
| QA Manager | Owns the SQAP, approves baselines | No — must be independent of development |
| V&V Lead | Plans and witnesses verification | No — independent of the author |
| Configuration Manager | Baselines, change control, release records | Yes, with QA oversight |
| Subject-Matter Expert | Nuclear QA, Part 21 applicability | No — must be qualified in the domain |
| Cybersecurity | 73.54 scope, assessment | Yes, if qualified |
| Product Owner | Requirements, acceptance | Yes |

The independence requirement is the one teams underestimate. If the person who wrote the code
also signs the V&V, the package is worth very little to an auditor.

## 5. What software can produce, and what it cannot

The repository can generate, on demand and with provenance:

- the requirement inventory from routes, rules and tests;
- a traceability draft mapping tests to requirements;
- test results with timestamps and environment;
- configuration records: ontology versions, skill revisions, policy pack hashes, snapshot
  dates;
- immutable event history for every write.

It cannot produce: an independent reviewer, a qualified signature, a QA organization, or a
determination that the software is suitable for a safety-related application. Those are people
and programs.

## 6. Realistic assessment

| Path | Duration | People | Output |
|---|---|---|---|
| CGD (Path A) | 2–4 months | 2 | Dedication package accepted by utility QA |
| Full SQAP + V&V (Path B) | 9–18 months | 3–6 | Validated software in a licensed environment |
| Demo / pilot only | none | 1 | Credible demonstration, no compliance standing |

If a customer asks "is this validated?", the only honest answer today is **no**, followed by
this document. That answer wins more deals than a hedge, because the buyer's QA organization
already knows what validation costs and will respect a vendor who does too.

## 7. Immediate next actions

1. Choose Path A or Path B with the licensee's QA organization — not internally.
2. Complete Stage 0; a moving baseline cannot be validated.
3. Write the SRS and RTM before writing another feature.
4. Engage an independent reviewer early; retrofitting independence is expensive.
