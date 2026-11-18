import { agentKitAgents } from "../shared/skills";

type AgentRuntimeState = "running" | "paused" | "killed";

const runtime = new Map(agentKitAgents.map((agent) => [agent.id, { agentId: agent.id, name: agent.name, state: "running" as AgentRuntimeState, startedAt: "2026-11-17T13:00:00Z", lastHeartbeat: new Date().toISOString(), killReason: "" }]));

export function getAgentRegistry() {
  return { mode: "embedded-local-registry", agents: Array.from(runtime.values()), controls: ["pause", "resume", "kill", "restart"], observability: { traceStore: "in-memory demo event store", productionTarget: "OpenTelemetry-compatible traces" } };
}

export function controlAgent(agentId: string, action: "pause" | "resume" | "kill" | "restart", reason = "") {
  const item = runtime.get(agentId);
  if (!item) return { ok: false, error: "Agent not found" };
  if (action === "kill" && !reason.trim()) return { ok: false, error: "A kill reason is required for traceability." };
  item.state = action === "kill" ? "killed" : action === "pause" ? "paused" : "running";
  item.killReason = action === "kill" ? reason : "";
  item.lastHeartbeat = new Date().toISOString();
  return { ok: true, agent: item, auditEvent: { action, reason, at: item.lastHeartbeat } };
}
