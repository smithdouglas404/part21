import readline from "node:readline";

const base = String(process.env.PART21_API_BASE_URL ?? "").trim();
const bearer = String(process.env.PART21_BEARER_TOKEN ?? "").trim();
function endpoint() {
  if (!base || !bearer) throw new Error("PART21_API_BASE_URL and PART21_BEARER_TOKEN are required. The stdio bridge never opens the database directly.");
  const url = new URL(base);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Use HTTPS, or HTTP only for a local loopback development endpoint.");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/mcp`;
  return url;
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
input.on("line", line => {
  if (!line.trim()) return;
  queue = queue.then(async () => {
    let payload: any;
    try {
      payload = JSON.parse(line);
      const response = await fetch(endpoint(), { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "X-Client-Name": "Claude Desktop Part21 stdio" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
      if (response.status === 202) return;
      if (!response.ok) throw new Error(`Authenticated Part21 MCP request rejected: HTTP ${response.status}`);
      const data = await response.json();
      if (data) process.stdout.write(`${JSON.stringify(data)}\n`);
    } catch (error) {
      if (payload?.id !== undefined || !payload) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: payload?.id ?? null, error: { code: -32603, message: error instanceof Error ? error.message : "MCP bridge unavailable" } })}\n`);
    }
  });
});
