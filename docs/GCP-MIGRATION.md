# Portability plan: embedded ECC module to Gemini Enterprise Agent Platform

The application should keep the nuclear assurance domain layer independent from the agent runtime. The local source already follows that boundary: Part 21 policy rules, ontology mappings, skills, human gates, governance events, and MCP tool contracts live in the application; the runtime registry and observability implementation are adapters.

Google’s current Gemini Enterprise Agent Platform documentation describes a full platform for building, scaling, governing, and optimizing agents. It includes Agent Development Kit (ADK), Skill Registry, RAG Engine, Vector Search, Agent Gateway, semantic governance, IAM, Agent Registry, observability, traces, topology, and evaluation capabilities: https://docs.cloud.google.com/gemini-enterprise-agent-platform.

## What moves cleanly

The local `SKILL.md`-style skill metadata can map to a managed Skill Registry entry. The AgentKit agent definitions can map to ADK agents or another managed runtime. MCP tool definitions can register as MCP servers/tools. The Part 21 ontology and semantic policy graph remain application-owned because they encode the client’s regulated domain model and approved interpretation overlay. The governance decision ledger should remain an immutable application record even if agent execution moves to Google Cloud.

Agent Registry is the natural managed replacement for the embedded local registry. Google describes it as a central hub for discovering and governing agents, MCP servers, tools, standalone skills, and endpoints: https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-registry.

## What replaces the local runtime controls

The current embedded registry supports pause, resume, restart, and kill as a demonstration boundary. In a managed deployment, those controls should call the runtime’s deployment and traffic-management APIs, with a separate emergency-stop path that can revoke tool access or route traffic to a known-good revision. The application should retain the decision event, actor, reason, affected agent, and timestamp regardless of where the runtime is hosted.

## Observability recommendation

Use OpenTelemetry as the portable telemetry contract rather than coupling the domain model to Langfuse or a single vendor. Google’s observability documentation states that agent and MCP telemetry should be emitted in OpenTelemetry format and describes metrics, traces, logs, topology, tool monitoring, and step-by-step traces: https://docs.cloud.google.com/gemini-enterprise-agent-platform/optimize/observability/overview.

Google’s AI-agent developer guidance also recommends OpenTelemetry for observing reasoning steps, tool calls, prompts, responses, external interactions, failures, and latency. It describes Cloud Trace support for generative-AI span and event conventions: https://docs.cloud.google.com/stackdriver/docs/opentelemetry/ai-agent-developers.

This means the application should emit portable spans such as `agent.run`, `skill.apply`, `policy.evaluate`, `mcp.tool_call`, `human_gate`, and `governance.transition`. A Langfuse exporter can be added later if the client wants its UI, but Langfuse should not be the only source of truth for regulatory traceability.

## Policy-as-code recommendation

Do not treat the Part 21 source document as a prompt or vector index alone. Use a compiler pipeline that segments the authoritative document, extracts obligations and conditions, maps terms into the Part 21 ontology, generates candidate rules with confidence and source offsets, attaches required evidence and human gates, and requires controlled human activation before a rule can affect an audit.

The current application demonstrates this through `/api/policy/compile`. The compiler output is explicitly marked as a candidate and not a compliance conclusion. In production, the rule artifact should be versioned, diffable, source-linked, tested against golden cases, and activated only after legal/compliance and quality approval. OPA or another policy engine can be introduced later if the rule language needs formal authorization decisions; it should evaluate the approved rule artifact, not replace the ontology, evidence graph, or decision ledger.

## Recommended target architecture

Keep the Part 21 semantic layer and policy graph behind application APIs and MCP tools. Put agent execution behind an adapter that can target the embedded demo runtime, ADK/Agent Runtime, or another compatible platform. Register agents, MCP servers, and skills in the managed Agent Registry when moving to GCP. Emit OpenTelemetry spans from every agent, policy, MCP, and human-gate action. Keep evidence, policy versions, source provenance, and human decisions in the client-controlled audit store.

The key portability test is simple: changing the agent runtime must not change the meaning of a Part 21 rule, the identity of the evidence, the ontology relationship, or the human approval record.
