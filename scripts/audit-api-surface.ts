import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

/**
 * Finds clickable UI that calls an endpoint the server does not serve.
 *
 * 1. Collects every `/api/...` string the client code calls, with a best-effort HTTP method.
 * 2. Collects every route registered by the Express application.
 * 3. Matches client calls to routes, treating `:param` and `*` as wildcards.
 * 4. Calls every GET endpoint with a real signed session and reports non-2xx, non-JSON and
 *    "Unknown API route" responses, which is how the launch screen failed silently.
 */
const root = process.cwd();
const clientRoot = path.join(root, "client", "src");
const serverRoot = path.join(root, "server");
const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

type ClientCall = { file: string; raw: string; sample: string; method: string };

function clientCalls(): ClientCall[] {
  const calls: ClientCall[] = [];
  for (const file of walk(clientRoot)) {
    const source = fs.readFileSync(file, "utf8");
    const pattern = /["'`](\/api\/[^"'`\s]*)["'`]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const raw = match[1];
      const window = source.slice(Math.max(0, match.index - 400), match.index + 400);
      const method = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.exec(window)?.[1]?.toUpperCase() ?? "GET";
      const sample = raw
        .replace(/\$\{[^}]*auditId[^}]*\}/gi, "AUD-026")
        .replace(/\$\{[^}]*findingId[^}]*\}/gi, "F-042")
        .replace(/\$\{[^}]*alertId[^}]*\}/gi, "WARN-2214D1C303D54D57")
        .replace(/\$\{[^}]*\}/g, "AUD-026");
      calls.push({ file: path.relative(root, file), raw, sample, method });
    }
  }
  const unique = new Map<string, ClientCall>();
  for (const call of calls) unique.set(`${call.method} ${call.sample}`, call);
  return [...unique.values()];
}

type Route = { method: string; pattern: string; regex: RegExp };

function serverRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of walk(serverRoot)) {
    if (/\.test\.ts$/.test(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    const pattern = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const method = match[1].toUpperCase();
      const routePath = match[2];
      const regex = new RegExp(`^${routePath.replace(/:[^/]+/g, "[^/]+").replace(/\*/g, ".*")}/?$`);
      routes.push({ method, pattern: routePath, regex });
    }
  }
  return routes;
}

function matches(route: Route, call: ClientCall) {
  if (route.method !== call.method) return false;
  const pathname = call.sample.split("?")[0];
  return route.regex.test(pathname);
}

async function main() {
  const calls = clientCalls();
  const routes = serverRoutes();
  console.log(`Client API calls: ${calls.length} across ${new Set(calls.map(c => c.file)).size} files`);
  console.log(`Registered server routes: ${routes.length}\n`);

  const unmatched = calls.filter(call => !routes.some(route => matches(route, call)));
  console.log(`=== UNMATCHED CLIENT CALLS (${unmatched.length}) ===`);
  for (const call of unmatched.sort((a, b) => a.sample.localeCompare(b.sample))) {
    console.log(`${call.method.padEnd(6)} ${call.sample}  [${call.file}]`);
  }

  const token = await sdk.signSession({ openId: process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS", appId: ENV.appId, name: "Frank" }, { expiresInMs: 10 * 60 * 1000 });
  const cookie = `${COOKIE_NAME}=${token}`;
  const getRoutes = routes.filter(route => route.method === "GET" && !route.pattern.includes("*"));
  console.log(`\n=== LIVE GET SWEEP (${getRoutes.length} routes) ===`);
  const failures: string[] = [];
  for (const route of getRoutes.sort((a, b) => a.pattern.localeCompare(b.pattern))) {
    const url = `${base}${route.pattern.replace(/:[^/]+/g, "AUD-026")}`;
    try {
      const response = await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(8000) });
      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text().catch(() => "");
      let problem = "";
      if (!response.ok) problem = `HTTP ${response.status}`;
      else if (!contentType.includes("json")) problem = `non-JSON ${contentType.split(";")[0]}`;
      else if (text.includes("Unknown API route")) problem = "Unknown API route";
      if (problem) { failures.push(`${route.pattern} -> ${problem}`); console.log(`FAIL ${route.pattern} -> ${problem} :: ${text.slice(0, 120).replace(/\s+/g, " ")}`); }
      else console.log(`ok   ${route.pattern} -> ${response.status} ${text.length}b`);
    } catch (error) {
      failures.push(`${route.pattern} -> ${error instanceof Error ? error.message : error}`);
      console.log(`ERR  ${route.pattern} -> ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\n=== SUMMARY ===`);
  console.log(`unmatched client calls: ${unmatched.length}`);
  console.log(`live GET failures: ${failures.length}`);
  if (failures.length) for (const failure of failures) console.log(`- ${failure}`);
  process.exit(unmatched.length || failures.length ? 2 : 0);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
