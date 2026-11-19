/**
 * API JSON contract test.
 *
 * The failure this guards against: an unregistered or mistyped API path falling through to the
 * single-page-app shell, so a client expecting JSON receives HTML and reports a misleading
 * "misrouted endpoint" error. Every path advertised in the OpenAPI document, every unknown /api
 * path, and the operational endpoints must all answer with a JSON content type.
 *
 * Usage: BASE_URL=http://127.0.0.1:3000 pnpm exec tsx scripts/api-json-contract.ts
 */
const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

type Result = { path: string; method: string; status: number; contentType: string; ok: boolean; note?: string };
const results: Result[] = [];

function sampleFor(schema: any): string {
  if (!schema) return "AUD-026";
  if (schema.example !== undefined) return String(schema.example);
  if (schema.default !== undefined) return String(schema.default);
  if (schema.enum?.length) return String(schema.enum[0]);
  if (schema.type === "integer" || schema.type === "number") return "1";
  return "AUD-026";
}

async function probe(path: string, method: string, note?: string): Promise<Result> {
  let status = 0;
  let contentType = "";
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(45000),
    });
    status = response.status;
    contentType = response.headers.get("content-type") ?? "";
    // Consume the body so a streamed HTML error page cannot be mistaken for success.
    const body = await response.text();
    const parseable = (() => { try { JSON.parse(body); return true; } catch { return false; } })();
    const ok = contentType.includes("application/json") && (body.trim() === "" || parseable);
    return { path, method, status, contentType, ok, note: note ?? (ok ? undefined : "not JSON") };
  } catch (error) {
    return { path, method, status, contentType, ok: false, note: `request failed: ${(error as Error).message}` };
  }
}

(async () => {
  // 1. Advertised contract: every path in the merged OpenAPI document.
  let documented: Array<{ path: string; method: string }> = [];
  try {
    const response = await fetch(`${BASE}/api/v1/openapi.json`, { signal: AbortSignal.timeout(45000) });
    const spec: any = await response.json();
    for (const [path, operations] of Object.entries<any>(spec.paths ?? {})) {
      for (const method of Object.keys(operations)) {
        if (!["get", "post", "put", "patch", "delete", "head"].includes(method)) continue;
        const resolved = path.replace(/\{([^}]+)\}/g, (_m, name) => sampleFor(operations[method]?.parameters?.find((p: any) => p.name === name)?.schema));
        documented.push({ path: resolved, method: method.toUpperCase() });
      }
    }
    console.log(`OpenAPI document lists ${documented.length} operations across ${Object.keys(spec.paths ?? {}).length} paths.`);
  } catch (error) {
    console.error(`FAILED to read /api/v1/openapi.json: ${(error as Error).message}`);
    process.exit(1);
  }

  for (const entry of documented) {
    results.push(await probe(entry.path, entry.method === "GET" ? "GET" : entry.method, entry.method === "POST" ? "POST without body (contract only)" : undefined));
  }

  // 2. Core reads the workspace depends on.
  for (const path of [
    "/api/health",
    "/api/session",
    "/api/domain/status",
    "/api/domain/audits",
    "/api/domain/portfolio?auditId=AUD-026",
    "/api/part21/process",
    "/api/regulatory/verification",
    "/api/nuclear/skills",
    "/api/kanban?auditId=AUD-026",
  ]) results.push(await probe(path, "GET"));

  // 3. Deliberate misroutes: these are the SPA-fallback cases.
  for (const path of ["/api/domain/auditz", "/api/does-not-exist", "/api/v1/not-a-real-operation"]) {
    results.push(await probe(path, "GET", "unknown path must answer JSON 404"));
  }

  const failures = results.filter(r => !r.ok);
  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[`${r.status} ${r.contentType.split(";")[0] || "no-content-type"}`] = (byStatus[`${r.status} ${r.contentType.split(";")[0] || "no-content-type"}`] ?? 0) + 1;

  console.log("\nContent types observed:");
  for (const [key, count] of Object.entries(byStatus).sort()) console.log(`  ${count.toString().padStart(3)} × ${key}`);

  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const failure of failures) console.log(`  ${failure.method} ${failure.path} → ${failure.status} ${failure.contentType || "no content type"} | ${failure.note}`);
    process.exit(1);
  }
  console.log(`\nPASS: all ${results.length} probes returned JSON. No route fell through to the SPA shell.`);
  process.exit(0);
})();
