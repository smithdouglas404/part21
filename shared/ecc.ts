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

export function getEccCatalog() {
  return { ...eccCatalog, skillCount: 5, agentCount: 5, sourceLinked: true };
}
