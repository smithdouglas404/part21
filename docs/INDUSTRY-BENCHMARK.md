# Part 21 Assurance OS — capability benchmark and honest gap assessment

## What is now operational in the prototype

The application has a multi-audit launcher, persona selection, in-workspace audit switching, audit-specific graph and finding projections, temporal trace views, source-linked Part 21 policy rules, guided skill phases, local ECC-compatible skill contracts, a vendored ECC source inventory, agent lifecycle controls, evidence registration, report drafting, and an HTTP MCP-style tool surface.

The new workbook adapter is operational for local `.xlsx` files. It can offer synthetic workbooks, parse uploaded workbooks, calculate a SHA-256, summarize sheets and rows, compare the latest revision against the prior in-memory snapshot, and return a human-gated import proposal. This is not yet a live client Excel MCP connection. The application explicitly identifies the adapter as a local demo parser and the production target as a client-hosted Excel MCP service.

## What is still not done

The most important remaining work is not visual. It is production assurance infrastructure:

1. Client-owned system connectors are not connected. Quality, supplier ERP, document control, field data, directory/roles, and configuration systems still need authenticated adapters, source ownership, identity resolution, freshness SLAs, and permission boundaries.
2. Workbook revisions are parsed and diffed, but they do not yet mutate a persistent graph. A qualified user must review and approve the proposed entity/relationship changes, after which an immutable event should be written to durable storage.
3. The demo state is partly in memory and deterministic. Production needs durable audit, finding, evidence, graph, policy, skill-run, decision, and agent-event tables; RBAC; immutable audit logs; retention; backup; and concurrency controls.
4. The current AI chat demonstrates dynamic skill routing and grounded fallback responses, but it does not yet invoke a production LLM provider in the default demo. An approved provider adapter, prompt/version registry, model evaluation set, safety filters, and cost/latency controls are still required.
5. Part 21 policy rules are a traceable application model, not a legal determination. Client applicability, interpretation overlays, safety-significance decisions, reportability, and final notifications require qualified nuclear, quality, legal, and compliance review.
6. The prototype has no formal validation package. A real deployment needs requirements traceability, verification evidence, test protocols, configuration baselines, change control, cybersecurity review, disaster recovery, and qualification appropriate to the client’s quality program.

## Two differentiating capabilities worth finishing first

### 1. Evidence-to-decision digital thread

Make every supplier change, deviation, inspection record, finding, Part 21 provision, policy-rule result, recommendation, human decision, and report paragraph a single bitemporal thread. Add a “reconstruct the decision” action that answers: what was known, from which source, under which revision, which agent tools ran, who reviewed it, what changed afterward, and why the final disposition was accepted. This is more defensible than a generic RAG assistant because it provides decision provenance and temporal replay.

### 2. Continuous Part 21 evaluation queue

Create a 24/7 intake queue that screens new deviations, supplier notices, NCRs, engineering changes, and evidence freshness events. The agents classify and prioritize signals, traverse the policy graph, calculate the 60-day/30-day evaluation risk, recommend next evidence, and route a human gate. The differentiator is not autonomous reporting; it is early detection plus auditable, time-aware decision support that prevents a missed evaluation or notification window.

## Industry comparison

The prototype is stronger than a generic audit dashboard in its combination of graph traceability, temporal events, policy-as-code framing, skill-aware guided work, and visible human gates. It is also differentiated from ordinary RAG because the product model keeps provisions, executable rules, evidence tests, source provenance, and activation approval separate.

It is not yet comparable to a production nuclear QMS, supplier-quality platform, or validated records system. Those products typically provide durable system-of-record behavior, controlled procedures, permissions, approval history, notifications, retention, and client-specific workflows. The current prototype demonstrates the target operating model and integration contracts, but it should not be presented as a qualified compliance system until the gaps above are closed.

## Evidence and sources

The NRC describes RG 1.234 and NEI 14-09 as acceptable methods for evaluating and reporting defects under 10 CFR Part 21, and highlights records for evaluations that do not result in an NRC notification, procurement-document requirements, discovery processes, supplier communication, and transfer of evaluation/reporting responsibility. [1]

The eCFR Part 21 structure includes general provisions, notification at §21.21, procurement documents at §21.31, inspections and records at §§21.41–21.51, and failure to notify at §21.61. The eCFR also notes that its continuously updated content is not itself the official legal edition. [2]

The open-source `excel-mcp-server` project demonstrates a viable adapter pattern: it supports workbook import/export, sheet and cell operations, formulas, tables, charts, and safe folder confinement without requiring Microsoft Excel. It is a possible production connector target, but it is not currently connected to this application. [3]

A nuclear QA software reference describes the same core market expectations: Part 21 screening across the supply chain, evaluation timelines, supplier program requirements, and integration with nonconformance and corrective-action workflows. [4]

[1]: https://www.nrc.gov/facilities-safety/new-reactors/how-we-regulate/regulatory-oversight/quality-assurance-for-new-reactors/guidance-on-implementation-of-10-cfr-part-21-requirements "NRC Guidance on Implementation of 10 CFR Part 21 Requirements"
[2]: https://www.ecfr.gov/current/title-10/chapter-I/part-21 "eCFR 10 CFR Part 21"
[3]: https://github.com/haris-musa/excel-mcp-server "Excel MCP Server"
[4]: https://forgedops.com/glossary/10-cfr-21 "Forged Operations 10 CFR 21 overview"
