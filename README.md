# Part 21 Assurance OS

A database-driven assurance workspace for 10 CFR Part 21 and 10 CFR Part 50 Appendix B:
audits, findings, evidence, a bitemporal knowledge graph, skill-guided agent dialogue, and
statutory clock supervision.

> **Status: reference implementation, not a validated compliance product.**
> This repository demonstrates an architecture. It has no validation package, no IQ/OQ/PQ,
> no traceability matrix to a software quality standard, and no configuration management
> plan. Read the [Disclaimer](#disclaimer) before using it for anything that matters.

---

## What it actually does

Everything below is backed by the database and by tests in this repository. Nothing is
served from fixtures.

**Regulatory text is ingested, not paraphrased.** 10 CFR Part 21 (119 provisions) and
Part 50 Appendix B (42 provisions) are pulled from the eCFR versioner API, pinned to a source
date, stored with the original response bytes and a SHA-256, and split into addressable
provisions. The current snapshot is dated `2026-11-09`.

**Every displayed citation is verified.** The process model cites specific paragraphs. At
runtime each citation is resolved against the ingested provision heading; the verification
endpoint reports `verified: 14, mismatched: 0`. A citation to a paragraph that does not exist
fails rather than rendering.

**Skill citations are bound, not quoted.** Each nuclear skill declares `regulatoryRefs`.
`server/citation-resolver.ts` resolves those strings to real provisions and reports coverage.
Current state: **36 references, 34 resolved, 2 declared external, 0 unresolved**. Activation
is refused when a reference does not resolve, so a skill cannot guide an auditor with a
citation nobody checked.

**The graph is bitemporal and typed.** Nodes and edges carry valid-from and recorded-at
timestamps, are validated against a controlled ontology before write, and are projected per
audit. Traversal from a finding reaches the products, suppliers, evidence, people and change
events around it.

**The agent is grounded on the database.** Dialogue turns are persisted, each turn selects a
governed skill contract from configuration, the packet carries graph context and computed
clock state, and the model is instructed never to compute, extend or restart a statutory
clock. Regulation text is supplied as bounded verbatim excerpts with their snapshot date.

**Statutory clocks are computed, not stored as dates.** Six Part 21 branches derive from
recorded trigger facts with explicit calendar interpretation. When a supervisor is configured,
each case is bound to a durable workflow and boundary crossings write notices.

**Field capture goes through a connector.** A Muse-compatible OpenAPI surface accepts field
observations, attachments and dialogue, with confirmation previews before any write.

## What it deliberately refuses to do

- Decide whether a condition is a defect, a substantial safety hazard, or reportable.
- Interpret the regulation on a qualified person's behalf.
- Invent affected record counts, supplier substitutions, approvals, or compliance verdicts.
- Compute or extend a statutory deadline on its own.
- Write a graph node whose type the ontology does not admit.

Those refusals are enforced in code, not only in prompts. If a claim is not supported by a
database record or a completed tool result, the system labels it unknown.

## Architecture

```
eCFR API ──► snapshot + originals (hashed) ──► provisions
                                              │
                        ┌─────────────────────┼──────────────────────┐
                        ▼                     ▼                      ▼
                 citation resolver     process model           skill contracts
                        │                     │                      │
                        └──────────┬──────────┴──────────┬───────────┘
                                   ▼                     ▼
                            case engine            agent packet
                          (6 clock branches)   (graph + clocks + excerpts)
                                   │                     │
                                   ▼                     ▼
                          Temporal workflow      grounded LLM dialogue
                                   │                     │
                                   └────────► Kanban / evidence / audit trail
```

| Layer | Location |
|---|---|
| Domain store, graph, ontology | `server/domain-store.ts`, `server/graph-store.ts`, `server/ontology-store.ts` |
| Regulatory ingestion and verification | `server/regulatory-source.ts`, `server/part21-citation-verify.ts` |
| Citation binding | `server/citation-resolver.ts`, `server/regulatory-context.ts` |
| Part 21 case engine and clocks | `server/part21-case.ts`, `server/part21-calendar.ts` |
| Durable supervision | `server/temporal/` |
| Evidence vault | `server/evidence-vault.ts`, `server/vault/` |
| Agent dialogue | `server/ai.ts` |
| Connector surface | `server/connect-api.ts`, `server/studio-gateway.ts` |
| Workspace UI | `client/src/components/assurance/` |

## Quickstart

Requirements: Node.js 22+, pnpm, and a MySQL-compatible database (MySQL 8 or TiDB Serverless
both work).

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL at minimum
pnpm check                    # TypeScript
pnpm test                     # 203 tests, no database required
pnpm build && pnpm start
```

The application refuses to start without `DATABASE_URL`. There is no seeded demo data and no
in-memory fallback: an empty database produces an empty workspace.

To ingest the regulation into your own database:

```bash
pnpm exec tsx scripts/ecfr-ingest-part21.ts
```

This is a deliberate operator action. It is never run automatically at startup, and the
resulting snapshot is marked `ingested-human-review-required`.

## Verify it yourself

These commands are the honest test of the claims above.

```bash
pnpm test                     # unit and contract tests
pnpm test:api                 # probes every documented API route for JSON (needs a running app)
```

```bash
# citation coverage across the skill library
curl -s localhost:3000/api/regulatory/coverage | jq '.accountedPercent, .totals'

# which citations resolve, and which are declared external
curl -s localhost:3000/api/regulatory/coverage | jq '.skills[] | {skillId, resolved: .coverage.resolved}'

# is regulatory graph projection currently permitted by the ontology?
curl -s localhost:3000/api/regulatory/graph-status | jq '{canProject, reason, stagedRevisions}'

# citation verification against ingested provision headings
curl -s localhost:3000/api/regulatory/verification | jq '{verified, mismatched}'
```

## Configuration

See [.env.example](.env.example). The variables that matter:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Required. MySQL-compatible connection string. |
| `PART21_AUTO_SUPERVISE` | Binds Part 21 cases to a Temporal workflow when true. |
| `TEMPORAL_ADDRESS` / `TEMPORAL_TASK_QUEUE` | Frontend and task queue for the supervisor. |
| `STUDIO_GATEWAY_MODE` | `merged` proxies an existing Studio and adds Part 21 routes. |
| `STUDIO_UPSTREAM_BASE_URL` | Upstream Studio origin when gateway mode is merged. |
| `PART21_SETTINGS_KEY` | Encrypts per-user connector secrets at rest. |

No credential is stored in this repository. Bearer tokens for the connector are validated
against the issuing service and are not persisted.

## Known limits

Stated plainly, because the alternative is discovering them in a review.

1. **No validation package.** No IQ/OQ/PQ, no traceability matrix, no configuration
   management plan, no software quality assurance plan. See
   [docs/VALIDATION-ROADMAP.md](docs/VALIDATION-ROADMAP.md).
2. **The ontology revision that admits `Finding → Regulation` citation edges is staged as a
   draft**, not active. Regulation-node projection refuses to run until a qualified reviewer
   activates it. The gate is deliberate.
3. **Temporal runs in development mode** in the hosted demonstration. Workflow history does
   not survive a redeploy. Production requires Temporal Cloud or a self-hosted server with
   its own persistent schemas.
4. **Two citations are declared external**: RG 1.164 (guidance, not ingested) and
   10 CFR 50.7 (outside the ingested snapshots). Neither is silently ignored.
5. **ERP, supplier and document-control adapters are placeholders.** No SAP, Salesforce or
   Veeva integration exists.
6. **Single-tenant.** No row-level tenancy isolation, no HA evidence, no scale testing.
7. **No SBOM, no signed releases, no CVE monitoring process.**

## Disclaimer

**Not legal, regulatory or compliance advice.** This software does not determine whether any
condition, defect, deviation or failure to comply is reportable under 10 CFR Part 21 or any
other requirement. Those determinations require qualified nuclear, quality, legal and
compliance review by the licensee or its authorized representatives. Nothing produced by this
software — including recommendations, insights, generated narrative, clock calculations,
citation resolutions, graph traversal results, or completion hashes — constitutes a regulatory
determination, an approval, or a record of compliance.

**Not validated for nuclear quality assurance use.** This repository has not been developed,
verified or validated under a software quality assurance program meeting 10 CFR Part 50
Appendix B, 10 CFR Part 21, IEEE 1012, IEEE 7-4.3.2, RG 1.168, RG 1.173 or any equivalent
standard. It must not be used to make safety-related decisions, to satisfy a regulatory
commitment, or as a system of record for a licensed facility without an independent
validation program and the licensee's own quality assurance approval.

**No warranty; limitation of liability.** The software is provided "as is", without warranty
of any kind, express or implied, including merchantability, fitness for a particular purpose
and non-infringement. To the maximum extent permitted by law, the authors and copyright
holders are not liable for any claim, damage, loss, regulatory finding, enforcement action, or
other liability arising from use of this software. You are solely responsible for validating
it for your context, for the accuracy of any data you load, and for any decision you make
using it.

**Regulatory source status.** Ingested text comes from the eCFR, an unofficial compilation.
The official regulations are published in the Federal Register and the Code of Federal
Regulations. Snapshots are pinned by date and are not automatically updated; a stale snapshot
will not announce itself. Verify against the official source before relying on any citation.

**Export control and data protection.** This repository contains no export-controlled
technical data and no personal data. If you connect it to supplier, ERP, personnel or document
systems, you become responsible for 10 CFR Part 810 obligations, export-control
classification, and any applicable data protection law in your jurisdiction. The demonstration
data is synthetic; do not load controlled unclassified information into a demonstration
instance.

**No endorsement.** Nothing here is approved, endorsed, certified or qualified by the U.S.
Nuclear Regulatory Commission, the Department of Energy, or any other regulator or standards
body. References to Part 21, Appendix B, Hedera or any vendor describe interfaces and
concepts, not certifications.

**Blockchain demonstration.** The completion hash is a synthetic demonstration modelled on
Hedera. No distributed ledger is contacted and no immutability guarantee is implied.

## License

MIT. See [LICENSE](LICENSE). Third-party components, vendored code and regulatory content are
attributed in [NOTICE](NOTICE). The vendored Everything Claude Code library is MIT licensed,
copyright 2026 Affaan Mustafa; its notice must be retained in any redistribution.

## Closing the validation gap

If you intend to use this in a licensed environment, the work is a program, not a patch. The
staged plan is in [docs/VALIDATION-ROADMAP.md](docs/VALIDATION-ROADMAP.md).
