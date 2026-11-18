export const eccCatalog = {
  name: "Everything Claude Code (ECC)",
  version: "2.2.3",
  repository: "https://github.com/affaan-m/ECC",
  website: "https://ecc.tools/",
  model: "Open-source collection of skills, agents, hooks, and workflow tools for coding agents",
  localPack: "Northstar Part 21 Assurance Skills",
  compatibility: ["ECC-compatible SKILL.md concepts", "AgentKit routes", "ECC-style human gates", "MCP callable tools"],
  note: "The application owns the nuclear domain skill pack; ECC supplies the open-source hub pattern and cross-harness operating model. Review and pin upstream components before production use.",
};

export const embeddedEccModule = {
  moduleId: "northstar-ecc-module",
  mode: "embedded-source-compatible-module",
  upstream: { name: eccCatalog.name, version: eccCatalog.version, repository: eccCatalog.repository, site: eccCatalog.website },
  components: [
    { id: "skills", label: "Skills", status: "embedded", description: "Local Part 21 skills with progressive questions, evidence hints, and gates." },
    { id: "agents", label: "Agents", status: "embedded", description: "AgentKit agents mapped to skills and callable MCP tools." },
    { id: "registry", label: "Agent registry", status: "embedded", description: "Local lifecycle registry with pause, resume, restart, and kill controls." },
    { id: "hooks", label: "Hooks", status: "mapped", description: "Human-gate and governance transitions are represented as auditable application events." },
    { id: "observability", label: "Observability", status: "mapped", description: "Agent activity is traced now; production adapter target is OpenTelemetry-compatible export." },
    { id: "workflows", label: "Workflows", status: "embedded", description: "Five-phase audit flow plus skill-aware governance board." },
  ],
  inheritance: { upstreamSkillsVisible: true, inheritedComponents: [], localSkillCount: 5, localSkillsOwnedByApplication: true },
  portability: { agentRuntime: "AgentKit-compatible routes", modelBoundary: "provider-neutral", dataBoundary: "MCP and HTTP adapters", target: "Gemini Enterprise / Vertex AI or other agent runtime" },
};

export function getEccCatalog() {
  return { ...eccCatalog, skillCount: 5, agentCount: 5, sourceLinked: true, embedded: true, moduleId: embeddedEccModule.moduleId };
}

export function getEmbeddedEccModule() {
  return embeddedEccModule;
}
