import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { callMcpTool, getMcpManifest } from "../mcp";
import { buildAuditReadinessReport, exportBitemporalGraph, getAgentActivity, getAgentKitManifest, reportToCsv, runAuditSkill, simulateCustomAuditExecution, simulateFullAuditExecution } from "../agentkit";
import { ontologyStorageStatus, syncOntologySnapshot } from "../ontology-store";
import { getReportDraft, registerEvidence } from "../evidence";
import { assessRemediationImpact, part21RegulatoryPack, traverseRegulatoryTree } from "../../shared/regulatory";
import { answerGroundedQuestion, configureAiProvider, getAiStatus } from "../ai";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  app.get("/api/mcp/tools", (_req, res) => {
    res.json(getMcpManifest());
  });
  app.post("/api/mcp/call", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const args = req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {};
    res.json({ tool: name, data: callMcpTool(name, args) });
  });
  app.get("/api/agentkit/manifest", (_req, res) => {
    res.json(getAgentKitManifest());
  });
  app.post("/api/agentkit/run", (req, res) => {
    res.json(runAuditSkill(String(req.body?.skillId ?? ""), req.body?.answers ?? {}));
  });
  app.post("/api/agentkit/simulate", (req, res) => {
    res.json(simulateFullAuditExecution(typeof req.body?.findingId === "string" ? req.body.findingId : undefined));
  });
  app.post("/api/agentkit/simulate-custom", (req, res) => {
    res.json(simulateCustomAuditExecution({
      findingId: String(req.body?.findingId ?? "FIND-CUSTOM-01"), title: String(req.body?.title ?? "Custom audit condition"), productId: String(req.body?.productId ?? "NSS-4820"), supplierId: String(req.body?.supplierId ?? "SUP-044"), controlFamily: String(req.body?.controlFamily ?? "21.51 traceability"), alternateConnector: req.body?.alternateConnector === "document-repository-live" ? "document-repository-live" : "vendor-erp-asterion",
    }));
  });
  app.get("/api/agentkit/activity", (req, res) => res.json({ agents: getAgentActivity(typeof req.query.agentId === "string" ? req.query.agentId : undefined) }));
  app.get("/api/agentkit/manifest.json", (_req, res) => res.json(getAgentKitManifest()));
  app.get("/api/graph/export", (req, res) => res.json(exportBitemporalGraph(typeof req.query.findingId === "string" ? req.query.findingId : undefined)));
  app.post("/api/evidence/intake", (req, res) => res.json(registerEvidence(req.body ?? {})));
  app.get("/api/reports/draft", (req, res) => res.json(getReportDraft(typeof req.query.findingId === "string" ? req.query.findingId : undefined)));
  app.get("/api/regulatory/pack", (_req, res) => res.json(part21RegulatoryPack));
  app.get("/api/regulatory/trace", (req, res) => res.json(traverseRegulatoryTree(typeof req.query.findingId === "string" ? req.query.findingId : undefined)));
  app.get("/api/regulatory/impact", (req, res) => res.json(assessRemediationImpact(typeof req.query.findingId === "string" ? req.query.findingId : undefined)));
  app.get("/api/ai/status", (_req, res) => res.json(getAiStatus()));
  app.post("/api/ai/ask", (req, res) => res.json(answerGroundedQuestion(String(req.body?.question ?? ""))));
  app.post("/api/ai/config", (req, res) => res.json(configureAiProvider(req.body?.provider === "anthropic" ? "anthropic" : "openai", String(req.body?.key ?? ""))));
  app.get("/api/ontology/storage", async (_req, res) => {
    res.json(await ontologyStorageStatus());
  });
  app.post("/api/ontology/sync", async (_req, res) => {
    res.json(await syncOntologySnapshot());
  });
  app.get("/api/reports/audit-readiness", (req, res) => {
    res.json(buildAuditReadinessReport(typeof req.query.auditId === "string" ? req.query.auditId : "AUD-026"));
  });
  app.get("/api/reports/audit-readiness.csv", (req, res) => {
    const report = buildAuditReadinessReport(typeof req.query.auditId === "string" ? req.query.auditId : "AUD-026");
    res.setHeader("Content-Disposition", `attachment; filename=part21-${report.audit.id.toLowerCase()}-readiness.csv`);
    res.type("text/csv").send(reportToCsv(report));
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
