import type { NextFunction, Request, RequestHandler, Response } from "express";
import { connectOpenApi } from "./connect-api";

export const PART21_ROUTE_PREFIX = "/api/v1/part21";

type JsonObject = Record<string, unknown>;
type OpenApiDocument = JsonObject & {
  paths?: Record<string, unknown>;
  components?: JsonObject;
  info?: JsonObject;
  servers?: unknown[];
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function prefixOperationIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prefixOperationIds);
  if (!value || typeof value !== "object") return value;
  const source = value as JsonObject;
  return Object.fromEntries(Object.entries(source).map(([key, child]) => [
    key,
    key === "operationId" && typeof child === "string" ? `part21_${child}` : prefixOperationIds(child),
  ]));
}

/**
 * Rehomes the Part 21 connector paths beneath /api/v1/part21 so they can coexist
 * with the Studio's existing /api/v1 operations without operationId collisions.
 */
export function buildPart21GatewayPaths(part21Document: OpenApiDocument) {
  const paths = asObject(part21Document.paths);
  return Object.fromEntries(Object.entries(paths).map(([path, operations]) => {
    const relativePath = path.replace(/^\/api\/v1/, "");
    return [`${PART21_ROUTE_PREFIX}${relativePath}`, prefixOperationIds(operations)];
  }));
}

export function mergeOpenApiDocuments(studioDocument: OpenApiDocument, part21Document: OpenApiDocument, gatewayUrl: string): OpenApiDocument {
  const studioComponents = asObject(studioDocument.components);
  const part21Components = asObject(part21Document.components);
  const studioSecuritySchemes = asObject(studioComponents.securitySchemes);
  const part21SecuritySchemes = asObject(part21Components.securitySchemes);

  return {
    ...studioDocument,
    openapi: "3.1.0",
    info: {
      ...asObject(studioDocument.info),
      title: "Socra Studio + Part 21 Assurance OS",
      version: `${String(asObject(studioDocument.info).version ?? "2.0.0")}-part21`,
      description: `${String(asObject(studioDocument.info).description ?? "")}`.trim() + " Part 21 Assurance OS tools are exposed under /api/v1/part21 and remain database-backed, audit-scoped, and human-gated for writes.",
    },
    servers: [{ url: gatewayUrl }],
    paths: {
      ...asObject(studioDocument.paths),
      ...buildPart21GatewayPaths(part21Document),
    },
    components: {
      ...studioComponents,
      ...part21Components,
      securitySchemes: {
        ...studioSecuritySchemes,
        ...part21SecuritySchemes,
      },
    },
    "x-part21-gateway": {
      routePrefix: PART21_ROUTE_PREFIX,
      source: "part21-assurance-os",
      writePolicy: "HTTP 202 preview followed by confirm=true after human approval",
      operationalData: "mysql-domain-records",
    },
  };
}

function configuredMode() {
  return process.env.STUDIO_GATEWAY_MODE === "merged" ? "merged" : "part21-only";
}

export function getStudioGatewayStatus(requestOrigin?: string) {
  const upstreamBaseUrl = String(process.env.STUDIO_UPSTREAM_BASE_URL ?? "").trim();
  const upstreamOpenApiUrl = String(process.env.STUDIO_UPSTREAM_OPENAPI_URL ?? "").trim();
  const configuredPublicUrl = String(process.env.STUDIO_PUBLIC_URL ?? requestOrigin ?? "").trim();
  return {
    mode: configuredMode(),
    routePrefix: PART21_ROUTE_PREFIX,
    upstreamConfigured: Boolean(upstreamBaseUrl),
    upstreamBaseUrl: upstreamBaseUrl || null,
    upstreamOpenApiConfigured: Boolean(upstreamOpenApiUrl),
    upstreamOpenApiUrl: upstreamOpenApiUrl || null,
    publicGatewayUrl: configuredPublicUrl || null,
    sharedBearerTokenConfigured: Boolean(process.env.STUDIO_PART21_BEARER_TOKEN),
    tokenValidation: configuredMode() === "merged" && upstreamBaseUrl ? "live_socra_my_access" : "local_part21_connector_token",
    deploymentActionRequired: configuredMode() === "merged" && (!upstreamBaseUrl || !upstreamOpenApiUrl),
    note: configuredMode() === "merged"
      ? "Merged sidecar mode is enabled; point the existing Muse connector at the public gateway OpenAPI. Socra remains the upstream application."
      : "Part 21-only mode is active; no Studio routes are proxied and the local OpenAPI is served.",
  };
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Studio OpenAPI request returned HTTP ${response.status}.`);
    return await response.json() as OpenApiDocument;
  } finally {
    clearTimeout(timer);
  }
}

export async function getMergedStudioOpenApi(publicUrl: string) {
  const upstreamOpenApiUrl = String(process.env.STUDIO_UPSTREAM_OPENAPI_URL ?? "").trim();
  if (configuredMode() !== "merged") return connectOpenApi(publicUrl) as OpenApiDocument;
  if (!upstreamOpenApiUrl) throw new Error("Merged Studio mode requires STUDIO_UPSTREAM_OPENAPI_URL.");
  if (new URL(upstreamOpenApiUrl).origin === new URL(publicUrl).origin) throw new Error("STUDIO_UPSTREAM_OPENAPI_URL must point to the existing Studio origin, not the public gateway origin.");
  const studioDocument = await fetchJson(upstreamOpenApiUrl);
  const part21Document = connectOpenApi(publicUrl) as OpenApiDocument;
  return mergeOpenApiDocuments(studioDocument, part21Document, publicUrl);
}

function shouldForward(req: Request) {
  return req.originalUrl.startsWith("/api/v1/") && req.originalUrl !== "/api/v1/openapi.json";
}

function copyRequestHeaders(req: Request) {
  const headers: Record<string, string> = { accept: String(req.headers.accept ?? "application/json") };
  for (const name of ["authorization", "x-client-name", "x-request-id"]) {
    const value = req.headers[name];
    if (typeof value === "string" && value) headers[name] = value;
  }
  if (req.body && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) headers["content-type"] = "application/json";
  return headers;
}

async function forwardToStudio(req: Request, res: Response) {
  const upstreamBaseUrl = String(process.env.STUDIO_UPSTREAM_BASE_URL ?? "").trim();
  if (!upstreamBaseUrl) return false;
  const publicOrigin = `${req.protocol}://${req.get("host")}`;
  const upstreamOrigin = new URL(upstreamBaseUrl).origin;
  if (publicOrigin === upstreamOrigin) {
    res.status(503).json({ ok: false, error: "Studio upstream points back to the gateway origin; refusing recursive proxying." });
    return true;
  }

  const target = new URL(req.originalUrl, upstreamBaseUrl.endsWith("/") ? upstreamBaseUrl : `${upstreamBaseUrl}/`);
  const body = req.body && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? JSON.stringify(req.body) : undefined;
  const response = await fetch(target, { method: req.method, headers: copyRequestHeaders(req), body });
  res.status(response.status);
  const contentType = response.headers.get("content-type");
  if (contentType) res.setHeader("content-type", contentType);
  const requestId = response.headers.get("x-request-id");
  if (requestId) res.setHeader("x-request-id", requestId);
  res.send(Buffer.from(await response.arrayBuffer()));
  return true;
}

export const studioProxyMiddleware: RequestHandler = async (req, res, next: NextFunction) => {
  if (configuredMode() !== "merged" || !shouldForward(req)) return next();
  try {
    const forwarded = await forwardToStudio(req, res);
    if (!forwarded) return next();
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Studio upstream request failed.", gateway: getStudioGatewayStatus() });
  }
};
