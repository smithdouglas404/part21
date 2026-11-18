# ECC and Part 21 skill map

## The distinction

The application vendors the upstream open-source ECC source tree for local inspection and demonstration. The current vendored snapshot contains:

- 327 upstream `SKILL.md` files.
- 72 upstream agent definitions.
- 98 upstream command definitions.

The application-owned nuclear assurance pack contains eight skills. They are ECC-compatible in structure and routed through the application's AgentKit/MCP boundaries, but they are not native upstream ECC skills:

| Application skill | Phase | AgentKit route | Human gate |
| --- | --- | --- | --- |
| Scope framing interview | Scope | `agentkit.audit.scope_framing` | Audit lead confirms scope |
| Evidence intake coach | Evidence | `agentkit.audit.evidence_intake` | Evidence owner confirms sufficiency |
| Genealogy trace guide | Traceability | `agentkit.audit.trace_chain` | Quality reviewer accepts trace boundary |
| Finding challenge dialogue | Findings | `agentkit.audit.finding_challenge` | Audit lead approves finding wording and severity |
| Readiness review facilitator | Closure | `agentkit.audit.readiness_close` | Audit lead and quality approver accept disposition |
| Document-to-policy compiler | Scope | `agentkit.policy.compile_document` | Legal, compliance, and quality approve activation |
| Human decision governance | Closure | `agentkit.governance.human_decision` | Decision owner records disposition and rationale |
| Agent supervision and stop | Closure | `agentkit.runtime.supervision` | Operator confirms lifecycle action and reason |

## Useful upstream ECC skills to demonstrate

The upstream library is broad and coding-agent oriented. The most relevant demonstration candidates for this assurance product are:

- `mcp-server-patterns` — MCP tool/server architecture.
- `mcp-dependency-review` — MCP dependency and boundary review.
- `operator-approval-loop` — human approval patterns.
- `enterprise-agent-ops` — operating agents in an enterprise context.
- `agent-architecture-audit` — agent architecture review.
- `agent-security-hardening` — agent security controls.
- `agent-eval` — evaluation harnesses.
- `knowledge-ops` — knowledge operations and source organization.
- `quality-nonconformance` — quality nonconformance patterns.
- `production-audit` — production audit thinking.
- `production-scheduling` — operational scheduling.
- `verification-loop` — verification and evidence loops.
- `workspace-surface-audit` — UI/workspace interaction audit.
- `click-path-audit` — clickable-flow verification.
- `security-review` and `security-scan` — security review and scanning.
- `continuous-agent-loop` — continuous agent operation patterns.

These upstream skills do not know 10 CFR Part 21 or the client's procedures. They provide reusable operating patterns. The Part 21 application skills supply the nuclear domain context, regulatory trace, graph model, evidence model, and human gates.

## Demonstration flow

1. Start at the launch workspace and choose an assurance persona and audit.
2. Open **Skills** to show the eight application-owned Part 21 skills.
3. Select one skill, such as **Genealogy trace guide**, to see its questions, evidence hints, AgentKit route, and human gate.
4. Open the embedded ECC inventory to show the vendored upstream source catalog.
5. Open the ECC dashboard route to demonstrate the upstream source UI locally mounted inside the application.
6. Ask the grounded chat a question such as: `Which supplier change should I trace first?`
7. The chat returns the selected/applied application skill, the invoked route, graph grounding, and follow-up questions.
8. Move through the guided audit flow. The active skill ribbon changes with the phase.
9. Run the weekly source sync from Administration or call `run_weekly_source_sync` through MCP.
10. Review changed workbooks under pending approvals, then approve a revision only after checking its hash, source, diff, and audit scope.

## What is genuinely operational

The prototype has working skill selection, AgentKit route simulation, MCP tool discovery and invocation, grounded chat skill routing, workbook parsing, hashing, revision comparison, human approval, durable overlay events, and weekly sync logic.

## What remains a production concern

The upstream ECC source is vendored and its inventory is visible, but it is not automatically converted into nuclear audit skills. SAP, Salesforce, document-control, and configuration-management connectors are visible configuration boundaries, not connected sources. The current scheduled weekly run is deployment-gated. Final Part 21 applicability, reportability, and notification decisions require qualified review.
