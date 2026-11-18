import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dashboardPath = path.resolve(process.cwd(), "vendor/ecc/scripts/dashboard-web.js");
const eccDashboard = require(dashboardPath) as {
  loadAgents: (root: string) => unknown[];
  loadSkills: (root: string) => unknown[];
  loadCommands: (root: string) => unknown[];
  loadRules: (root: string) => unknown[];
  loadMcps: (root: string) => unknown[];
  loadHooks: (root: string) => unknown[];
  renderHTML: (data: Record<string, unknown>) => string;
};

const eccRoot = path.resolve(process.cwd(), "vendor/ecc");

export function renderEmbeddedEccDashboard() {
  return eccDashboard.renderHTML({
    agents: eccDashboard.loadAgents(eccRoot),
    skills: eccDashboard.loadSkills(eccRoot),
    commands: eccDashboard.loadCommands(eccRoot),
    rules: eccDashboard.loadRules(eccRoot),
    mcps: eccDashboard.loadMcps(eccRoot),
    hooks: eccDashboard.loadHooks(eccRoot),
  });
}
