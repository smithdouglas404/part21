# ECC integration reference

The application uses ECC as an upstream open-source reference, not as a rebranded internal acronym.

- Repository: https://github.com/affaan-m/ECC
- Official site: https://ecc.tools/
- Repository README used for structure and installation: https://raw.githubusercontent.com/affaan-m/ecc/main/README.md

Verified upstream model from the repository and official site:

- `agents/` — specialized subagents
- `skills/` — reusable workflows loaded on demand
- `commands/` — command shims
- `rules/` — common and language standards
- `hooks/` — runtime automation and enforcement
- `scripts/` — install, repair, synchronization, orchestration, and checks
- `docs/` — setup, architecture, and operating guides

The Part 21 application owns its nuclear assurance skill pack. It uses an ECC-compatible catalog shape and maps each local skill to an AgentKit route, MCP tools, evidence expectations, and a human approval gate. The app must not imply that the local nuclear skills are upstream ECC skills.

## Embedded module boundary

The current application includes an embedded `northstar-ecc-module` manifest in source. Its local components include Skills, Agents, an Agent registry, mapped Hooks, mapped Observability, and embedded Workflows. The local Part 21 pack is owned by the application and is not fetched at runtime from the upstream repository.

The embedded module is intentionally adapter-shaped. It makes the skill and agent boundaries portable to a future Gemini Enterprise or Vertex AI deployment without claiming that this demo already provides Google’s production registry, routing plane, or distributed trace store. The current runtime exposes `/api/ecc/module`, `/api/agents/registry`, and `/api/agents/control` so those boundaries are inspectable and replaceable.
