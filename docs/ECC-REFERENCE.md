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
