import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { authenticateApiRequest, assertAuditPermission, requireAdministrator, requestPrincipal, AssuranceAccessError } from "./access-control";

const publicPaths = new Set(["/api/health", "/api/platform/config.js", "/api/v1/openapi.json", "/api/v1/studio/merge-status"]);
const localConnectorPaths = ["/api/v1/part21/", "/api/v1/connect/", "/api/v1/tools/", "/api/v1/field/", "/api/v1/audit/", "/api/v1/agent/"];
const administrationPaths = ["/api/access/", "/api/admin/", "/api/ai/config", "/api/ontology/sync", "/api/agents/control", "/api/configuration/drafts", "/api/configuration/review", "/api/configuration/activate", "/api/configuration/retire", "/api/regulatory/ingest", "/api/v1/connect/"];
const operationalPaths = ["/api/domain/portfolio", "/api/kanban", "/api/evidence", "/api/documents", "/api/reports", "/api/graph/context", "/api/graph/export", "/api/graph/projection-events", "/api/ai/ask", "/api/ai/warnings", "/api/agent/dialogue", "/api/agentkit/run", "/api/agentkit/activity", "/api/agentkit/simulate", "/api/policy/evaluate", "/api/policy/coverage", "/api/regulatory/trace", "/api/regulatory/impact", "/api/regulatory/coverage", "/api/temporal/cases", "/api/events"];
function pathUnder(path: string, prefix: string) { return path === prefix || path.startsWith(`${prefix.endsWith("/") ? prefix : prefix + "/"}`); }
export function auditIdFromRequest(req: Request): string {
  const fromPath = req.params.auditId;
  const value = fromPath ?? req.body?.auditId ?? req.query.auditId;
  return typeof value === "string" ? value.trim() : "";
}
export function guardRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
}
export function installApiBoundary(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    const isMcp = path === "/mcp" || path === "/api/mcp" || path.startsWith("/api/mcp/");
    if ((!path.startsWith("/api/") && !isMcp) || publicPaths.has(path) || path.startsWith("/api/oauth/") || path.startsWith("/api/trpc")) return next();
    // Socra's original operations keep Socra's original authentication. Only local Part 21 operations use this boundary.
    if (path.startsWith("/api/v1/") && !localConnectorPaths.some(prefix => path.startsWith(prefix))) return next();
    authenticateApiRequest(req, res, error => {
      if (error) return next(error);
      try {
        const principal = requestPrincipal(req);
        if (administrationPaths.some(prefix => pathUnder(path, prefix))) requireAdministrator(principal);
        if (operationalPaths.some(prefix => pathUnder(path, prefix)) && path !== "/api/evidence/vault/status") {
          const auditId = auditIdFromRequest(req);
          // Route parameters are resolved only after middleware. /reports/:auditId is validated again by its handler.
          if (!(path.startsWith("/api/reports/") && !auditId && !["/api/reports/draft", "/api/reports/finalize", "/api/reports/approvals", "/api/reports/audit-readiness", "/api/reports/audit-readiness.csv"].includes(path))) assertAuditPermission(principal, auditId, req.method !== "GET");
        }
        return next();
      } catch (failure) { return next(failure); }
    });
  });
}
export function installApiErrorHandler(app: Express) {
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Application operation failed";
    const status = error instanceof AssuranceAccessError ? error.status : /not found|not available|does not exist/i.test(message) ? 404 : /required|invalid|missing|scope|mismatch|revision|approval|blocked|immutable/i.test(message) ? 409 : 503;
    res.status(status).json({ ok: false, error: message, databaseGroundingRequired: true, retryable: status === 503 });
  });
}
