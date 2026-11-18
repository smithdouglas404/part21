import { listControlledConfigurationPayloads } from "./config-store";
import { appendAssuranceEvent } from "./event-store";

type AgentRuntimeState = "running" | "paused" | "killed";
type RuntimeAgent = { agentId: string; name: string; state: AgentRuntimeState; startedAt: string; lastHeartbeat: string; killReason: string };
const runtime = new Map<string, RuntimeAgent>();

async function ensureRuntime() {
  if (runtime.size) return;
  const configured = await listControlledConfigurationPayloads<any>("agent_route");
  for (const item of configured) runtime.set(item.payload.id, { agentId: item.payload.id, name: item.payload.name, state: "running", startedAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString(), killReason: "" });
}

export async function getAgentRegistry() {
  await ensureRuntime();
  return { mode: "embedded-local-registry", source: "mysql-database-controlled-configuration", agents: Array.from(runtime.values()), controls: ["pause", "resume", "kill", "restart"], observability: { traceStore: "mysql append-only event ledger", productionTarget: "OpenTelemetry-compatible traces" } };
}

export async function controlAgent(agentId: string, action: "pause" | "resume" | "kill" | "restart", reason = "") {
  await ensureRuntime();
  const item = runtime.get(agentId);
  if (!item) return { ok: false, error: "Agent not found in controlled configuration repository" };
  if (action === "kill" && !reason.trim()) return { ok: false, error: "A kill reason is required for traceability." };
  item.state = action === "kill" ? "killed" : action === "pause" ? "paused" : "running";
  item.killReason = action === "kill" ? reason : "";
  item.lastHeartbeat = new Date().toISOString();
  const auditEvent = await appendAssuranceEvent({ type: `agent.${action}`, actor: "agent-runtime", payload: { agentId, reason, state: item.state } });
  return { ok: true, agent: item, auditEvent };
}
