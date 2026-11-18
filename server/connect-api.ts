import crypto from "node:crypto";
import type { Request } from "express";
import { appendAssuranceEvent } from "./event-store";
import { listDomainRecords, upsertDomainRecord } from "./domain-store";
import { callMcpTool } from "./mcp";

type ConnectToken = { id: string; tokenHash: string; label: string; actor: string; role: string; auditId?: string; access: "look_only" | "make_changes"; createdAt: string; revokedAt?: string };
const writeTools = new Set(["field_kanban_create", "field_kanban_move", "field_kanban_attach", "excel_import_local_workbook", "excel_import_workbook", "excel_approve_import"]);

function bearer(req: Request) { const value = String(req.headers.authorization ?? ""); return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }

function configuredStudioBridgeToken(): ConnectToken | undefined {
  const raw = String(process.env.STUDIO_PART21_BEARER_TOKEN ?? "").trim();
  if (!raw) return undefined;
  return {
    id: "STUDIO-BRIDGE-TOKEN",
    tokenHash: hash(raw),
    label: "Existing Studio bearer token",
    actor: String(process.env.STUDIO_BRIDGE_ACTOR ?? "Studio connector actor"),
    role: String(process.env.STUDIO_BRIDGE_ROLE ?? "Studio connector role"),
    auditId: process.env.STUDIO_BRIDGE_AUDIT_ID ? String(process.env.STUDIO_BRIDGE_AUDIT_ID) : undefined,
    access: process.env.STUDIO_BRIDGE_ACCESS === "make_changes" ? "make_changes" : "look_only",
    createdAt: "server-configuration",
  };
}

async function authenticateAgainstStudio(raw: string): Promise<ConnectToken | undefined> {
  if (process.env.STUDIO_GATEWAY_MODE !== "merged") return undefined;
  const upstreamBaseUrl = String(process.env.STUDIO_UPSTREAM_BASE_URL ?? "").trim();
  if (!upstreamBaseUrl) return undefined;
  try {
    const response = await fetch(new URL("/api/v1/my_access", upstreamBaseUrl), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${raw}` },
      body: "{}",
    });
    if (!response.ok) return undefined;
    const result = await response.json() as any;
    const access = result?.access ?? result?.data?.access ?? result?.result?.access;
    const actor = result?.actor ?? result?.data?.actor ?? result?.result?.actor;
    const role = result?.role ?? result?.data?.role ?? result?.result?.role;
    return {
      id: "STUDIO-LIVE-INTROSPECTION",
      tokenHash: hash(raw),
      label: "Live Socra bearer token",
      actor: String(actor ?? process.env.STUDIO_BRIDGE_ACTOR ?? "Socra connector actor"),
      role: String(role ?? process.env.STUDIO_BRIDGE_ROLE ?? "Socra connector role"),
      auditId: process.env.STUDIO_BRIDGE_AUDIT_ID ? String(process.env.STUDIO_BRIDGE_AUDIT_ID) : undefined,
      access: access === "look_only" ? "look_only" : (process.env.STUDIO_BRIDGE_ACCESS === "look_only" ? "look_only" : "make_changes"),
      createdAt: "live-socra-introspection",
    };
  } catch {
    return undefined;
  }
}

export async function createConnectToken(input: { label: string; actor: string; role: string; auditId?: string; access: "look_only" | "make_changes" }) {
  const raw = `p21_${crypto.randomBytes(24).toString("base64url")}`;
  const token: ConnectToken = { id: `CON-${Date.now()}`, tokenHash: hash(raw), label: input.label, actor: input.actor, role: input.role, auditId: input.auditId, access: input.access, createdAt: new Date().toISOString() };
  await upsertDomainRecord({ recordType: "connect_token", recordId: token.id, payload: token });
  await appendAssuranceEvent({ type: "connect_token_created", actor: input.actor, auditId: input.auditId, entityId: token.id, payload: { label: token.label, role: token.role, access: token.access } });
  return { tokenId: token.id, token: raw, shownOnce: true, access: token.access, actor: token.actor, role: token.role, auditId: token.auditId };
}

export async function authenticateConnectRequest(req: Request) {
  const raw = bearer(req);
  if (!raw) return { ok: false as const, status: 401, error: "Bearer token required." };
  const tokens = await listDomainRecords<ConnectToken>("connect_token");
  const configuredToken = configuredStudioBridgeToken();
  const token = tokens.find((candidate) => candidate.tokenHash === hash(raw) && !candidate.revokedAt)
    ?? (configuredToken?.tokenHash === hash(raw) ? configuredToken : undefined)
    ?? await authenticateAgainstStudio(raw);
  if (!token) return { ok: false as const, status: 401, error: "Invalid or revoked connector token." };
  return { ok: true as const, token };
}

export async function callConnectedTool(req: Request, tool: string, args: Record<string, unknown>, confirm = false) {
  const auth = await authenticateConnectRequest(req);
  if (!auth.ok) return auth;
  if (auth.token.access === "look_only" && writeTools.has(tool)) return { ok: false as const, status: 403, error: "This connector is look-only; a make-changes token is required." };
  if (auth.token.auditId && typeof args.auditId === "string" && args.auditId !== auth.token.auditId) return { ok: false as const, status: 404, error: "Audit is outside this connector's customer scope." };
  if (auth.token.auditId && !args.auditId && ["field_kanban_create", "field_kanban_attach"].includes(tool)) args.auditId = auth.token.auditId;
  if (writeTools.has(tool) && !confirm) {
    await appendAssuranceEvent({ type: "connect_confirmation_preview", actor: auth.token.actor, auditId: auth.token.auditId, entityId: tool, payload: { tool, args, clientName: req.headers["x-client-name"] ?? "unknown" } });
    return { ok: false as const, status: 202, needs_confirmation: true, preview: `This would call ${tool} as ${auth.token.actor} (${auth.token.role})${auth.token.auditId ? ` for audit ${auth.token.auditId}` : ""}. Send confirm=true only after the person approves.` };
  }
  const result = await callMcpTool(tool, { ...args, actor: String(args.actor ?? auth.token.actor) });
  await appendAssuranceEvent({ type: "connect_tool_call", actor: auth.token.actor, auditId: auth.token.auditId ?? (typeof args.auditId === "string" ? args.auditId : undefined), entityId: tool, payload: { tool, args, confirm, clientName: req.headers["x-client-name"] ?? "unknown", outcome: (result as any)?.error ? "error" : "ok" } });
  return { ok: true as const, data: result, actor: auth.token.actor, role: auth.token.role, tool };
}

export function connectOpenApi(publicUrl = "") {
  const serverUrl = publicUrl || "https://YOUR_DEPLOYED_HOST";
  const toolPath = (tool: string, description: string, properties: Record<string, unknown> = {}) => ({ post: { operationId: tool, summary: description, security: [{ bearerAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { ...properties, confirm: { type: "boolean", description: "Required true after the human approves a write preview." } }, additionalProperties: true } } } }, responses: { "200": { description: "Completed" }, "202": { description: "Human confirmation required" }, "401": { description: "Invalid token" }, "403": { description: "Scope or permission denied" } } } });
  return { openapi: "3.1.0", info: { title: "Part 21 Assurance OS Connector", version: "1.0.0", description: "Database-backed Part 21 audit, field engagement, evidence, Excel, graph, and human-governance connector for Meta Muse and other REST clients." }, servers: [{ url: serverUrl }], security: [{ bearerAuth: [] }], paths: { "/api/v1/tools/{tool}": { post: { operationId: "callPart21Tool", summary: "Call a Part 21 Assurance OS tool", security: [{ bearerAuth: [] }], parameters: [{ name: "tool", in: "path", required: true, schema: { type: "string", enum: ["field_kanban_list", "field_kanban_create", "field_kanban_move", "field_kanban_attach", "excel_list_workbooks", "excel_import_local_workbook", "excel_compare_revision", "excel_approve_import", "check_audit_readiness", "recommend_next_moves"] } }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { confirm: { type: "boolean" } }, additionalProperties: true } } } }, responses: { "200": { description: "Completed" }, "202": { description: "Human confirmation required" }, "401": { description: "Invalid token" }, "403": { description: "Permission denied" } } } }, "/api/v1/field/kanban/list": toolPath("fieldKanbanList", "List the selected audit's field Kanban", { auditId: { type: "string" } }), "/api/v1/field/kanban/create": toolPath("fieldKanbanCreate", "Create a field observation or backlog item", { auditId: { type: "string" }, title: { type: "string" }, description: { type: "string" }, priority: { type: "string" } }), "/api/v1/field/kanban/move": toolPath("fieldKanbanMove", "Move a field item through its workflow", { itemId: { type: "string" }, status: { type: "string" } }), "/api/v1/field/kanban/attach": toolPath("fieldKanbanAttach", "Attach a photo, document, or voice transcript", { itemId: { type: "string" }, auditId: { type: "string" }, kind: { type: "string" }, filename: { type: "string" }, base64: { type: "string" }, transcript: { type: "string" } }), "/api/v1/audit/brief": toolPath("auditBrief", "Read the selected audit portfolio and graph-backed readiness context", { auditId: { type: "string" } }) }, components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Part21ConnectorToken" } } } };
}

export async function listConnectTokens() { const tokens = await listDomainRecords<ConnectToken>("connect_token"); return tokens.map(({ tokenHash: _hash, ...safe }) => safe); }

export async function revokeConnectToken(tokenId: string, actor: string) {
  const tokens = await listDomainRecords<ConnectToken>("connect_token");
  const token = tokens.find((candidate) => candidate.id === tokenId);
  if (!token) throw new Error("Connector token was not found.");
  const revokedAt = new Date().toISOString();
  await upsertDomainRecord({ recordType: "connect_token", recordId: token.id, payload: { ...token, revokedAt } });
  await appendAssuranceEvent({ type: "connect_token_revoked", actor, auditId: token.auditId, entityId: token.id, payload: { label: token.label } });
  return { ok: true, tokenId, revokedAt };
}
