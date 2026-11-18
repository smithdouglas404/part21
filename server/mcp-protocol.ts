import { callMcpTool, getMcpManifest } from "./mcp";
import { getEventStoreStatus, listAssuranceEvents } from "./event-store";

const excelSchemas: Record<string, Record<string, unknown>> = {
  excel_list_workbooks: { type: "object", properties: {}, additionalProperties: false },
  excel_describe_workbook: { type: "object", properties: {}, additionalProperties: false },
  excel_read_range: { type: "object", properties: { sheet: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
  excel_import_workbook: { type: "object", properties: { filename: { type: "string" }, base64: { type: "string" }, actor: { type: "string" } }, required: ["base64"], additionalProperties: false },
  excel_import_local_workbook: { type: "object", properties: { filename: { type: "string" }, actor: { type: "string" } }, required: ["filename"], additionalProperties: false },
  excel_compare_revision: { type: "object", properties: {}, additionalProperties: false },
  excel_approve_import: { type: "object", properties: { workbookId: { type: "string" }, actor: { type: "string" }, note: { type: "string" } }, required: ["workbookId", "actor"], additionalProperties: false },
};

async function standardTools() {
  return (await getMcpManifest()).tools.map((tool) => ({
    name: tool.name,
    title: tool.name.replaceAll("_", " "),
    description: `${tool.description} Human review is required for side effects.`,
    inputSchema: excelSchemas[tool.name] ?? { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: !tool.name.includes("import") && !tool.name.includes("create"), destructiveHint: false, idempotentHint: false },
  }));
}

function resultContent(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

export async function handleMcpJsonRpc(message: any) {
  const id = message?.id ?? null;
  const method = String(message?.method ?? "");
  if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } }, serverInfo: { name: "part21-assurance-os", version: "1.0.0" }, instructions: "Part 21 assurance MCP server. Operational records come from the database. Synthetic data is available only through explicit administrator demo loading. Human review is required before graph mutation, reporting, or notification." } };
  if (method === "notifications/initialized") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: await standardTools() } };
  if (method === "resources/list") return { jsonrpc: "2.0", id, result: { resources: [{ uri: "part21://event-store/status", name: "Assurance event store status", description: "Durable workbook and MCP event-store status", mimeType: "application/json" }, { uri: "part21://mcp/manifest", name: "Part 21 MCP manifest", description: "Application MCP tool and connector manifest", mimeType: "application/json" }] } };
  if (method === "resources/read") {
    const uri = String(message?.params?.uri ?? "");
    const value = uri === "part21://event-store/status" ? { ...(await getEventStoreStatus()), recentEvents: (await listAssuranceEvents()).slice(-20) } : await getMcpManifest();
    return { jsonrpc: "2.0", id, result: { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] } };
  }
  if (method === "tools/call") {
    const name = String(message?.params?.name ?? "");
    const args = message?.params?.arguments && typeof message.params.arguments === "object" ? message.params.arguments : {};
    try {
      const value = await callMcpTool(name, args);
      return { jsonrpc: "2.0", id, result: resultContent(value, Boolean((value as any)?.error)) };
    } catch (error) {
      return { jsonrpc: "2.0", id, result: resultContent({ error: error instanceof Error ? error.message : "Tool execution failed" }, true) };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}
