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
import { answerGroundedQuestion, answerLiveGroundedQuestion, configureAiProvider, getAiStatus } from "../ai";
import { getEccCatalog, getEmbeddedEccModule } from "../../shared/ecc";
import { decideGovernanceItem, getGovernanceBoard, moveGovernanceItem } from "../../shared/governance";
import { controlAgent, getAgentRegistry } from "../agent-runtime";
import { getVendoredEccLibrary } from "../ecc-library";
import { renderEmbeddedEccDashboard } from "../ecc-dashboard";
import { buildPolicyGraph, compileDocumentToPolicy, evaluatePart21Policy, getPolicyCoverage, part21PolicyPack } from "../../shared/policy";
import { approveWorkbookImport, compareSnapshots, getExcelAdapterStatus, importWorkbookPayload, listPendingWorkbookApprovals, listSampleWorkbooks, readWorkbookSample } from "../xlsx-adapter";
import { handleMcpJsonRpc } from "../mcp-protocol";
import { getEventStoreStatus, listAssuranceEvents } from "../event-store";
import { runWeeklySourceSync } from "../weekly-sync";
import { generateSyntheticPart21Decision, getDocumentControlStatus, listControlledDocuments, notarizeDocumentWithHederaDemo, registerControlledDocument, reviewDocumentCybersecurity } from "../document-control";
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
  app.get("/mcp", (_req, res) => res.json({ name: "part21-assurance-os", endpoint: "/mcp", transport: "Streamable HTTP", protocol: "MCP JSON-RPC 2.0", instructions: "POST initialize, tools/list, tools/call, resources/list, or resources/read requests to this endpoint." }));
  app.post("/mcp", async (req, res) => {
    const payload = req.body;
    const result = Array.isArray(payload) ? (await Promise.all(payload.map(handleMcpJsonRpc))).filter(Boolean) : await handleMcpJsonRpc(payload);
    if (result === null || (Array.isArray(result) && result.length === 0)) return res.status(202).end();
    res.type("application/json").json(result);
  });
  app.get("/api/events/status", (_req, res) => res.json(getEventStoreStatus()));
  app.get("/api/events", (req, res) => res.json(listAssuranceEvents({ type: typeof req.query.type === "string" ? req.query.type : undefined, entityId: typeof req.query.entityId === "string" ? req.query.entityId : undefined, auditId: typeof req.query.auditId === "string" ? req.query.auditId : undefined })));
  app.post("/api/sync/weekly", (req, res) => res.json(runWeeklySourceSync(String(req.body?.actor ?? "Application weekly scheduler"))));
  app.get("/api/approvals/pending", (_req, res) => res.json({ approvalStatus: "pending_human_review", items: listPendingWorkbookApprovals(), humanGate: "Qualified reviewer must inspect source provenance and revision diff before approval." }));
  app.post("/api/approvals/workbooks/:workbookId", (req, res) => res.json(approveWorkbookImport(req.params.workbookId, String(req.body?.actor ?? "Quality approver"), String(req.body?.note ?? "Approved after human review"))));
  app.get("/api/document-control/status", (_req, res) => res.json(getDocumentControlStatus()));
  app.get("/api/documents", (req, res) => res.json({ documents: listControlledDocuments({ auditId: typeof req.query.auditId === "string" ? req.query.auditId : undefined }) }));
  app.post("/api/documents", (req, res) => res.json(registerControlledDocument(req.body ?? {})));
  app.post("/api/documents/:documentId/cybersecurity-review", (req, res) => res.json(reviewDocumentCybersecurity(req.params.documentId, req.body ?? {})));
  app.post("/api/documents/:documentId/notarize", (req, res) => res.json(notarizeDocumentWithHederaDemo(req.params.documentId, String(req.body?.actor ?? "Quality approver"))));
  app.post("/api/documents/:documentId/part21-decision", (req, res) => res.json(generateSyntheticPart21Decision(req.params.documentId, String(req.body?.actor ?? "Part 21 review agent"))));
  app.get("/api/admin/excel/status", (_req, res) => res.json(getExcelAdapterStatus()));
  app.get("/api/admin/excel/samples", (_req, res) => res.json(listSampleWorkbooks()));
  app.get("/api/admin/excel/last", (_req, res) => res.json(readWorkbookSample()));
  app.post("/api/admin/excel/upload", (req, res) => res.json(importWorkbookPayload({ filename: req.body?.filename, base64: req.body?.base64, actor: req.body?.actor, source: req.body?.source })));
  app.get("/api/admin/excel/compare", (_req, res) => res.json({ ...getExcelAdapterStatus(), comparison: compareSnapshots(null) }));
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
  app.post("/api/ai/ask", async (req, res) => {
    const question = String(req.body?.question ?? "");
    if (req.body?.mode === "live") {
      try { return res.json(await answerLiveGroundedQuestion(question)); }
      catch (error) { return res.status(502).json({ ...answerGroundedQuestion(question), llmInvoked: false, liveError: error instanceof Error ? error.message : "Live LLM invocation failed" }); }
    }
    return res.json(answerGroundedQuestion(question));
  });
  app.post("/api/ai/config", (req, res) => res.json(configureAiProvider(req.body?.provider === "anthropic" ? "anthropic" : "openai", String(req.body?.key ?? ""))));
  app.get("/api/ecc/catalog", (_req, res) => res.json(getEccCatalog()));
  app.get("/api/ecc/module", (_req, res) => res.json(getEmbeddedEccModule()));
  app.get("/api/ecc/library", (_req, res) => res.json(getVendoredEccLibrary()));
  app.get("/ecc", (_req, res) => res.type("html").send(renderEmbeddedEccDashboard()));
  app.get("/ecc/", (_req, res) => res.type("html").send(renderEmbeddedEccDashboard()));
  app.get("/api/activity", (_req, res) => res.json({ entries: [] }));
  app.get("/api/governance/board", (_req, res) => res.json(getGovernanceBoard()));
  app.post("/api/governance/move", (req, res) => res.json(moveGovernanceItem(String(req.body?.id ?? ""), req.body?.target, String(req.body?.actor ?? "Assurance user"))));
  app.post("/api/governance/decide", (req, res) => res.json(decideGovernanceItem(String(req.body?.id ?? ""), req.body?.action, String(req.body?.note ?? ""), req.body?.deferUntil, String(req.body?.actor ?? "Assurance user"))));
  app.get("/api/agents/registry", (_req, res) => res.json(getAgentRegistry()));
  app.post("/api/agents/control", (req, res) => res.json(controlAgent(String(req.body?.agentId ?? ""), req.body?.action, String(req.body?.reason ?? ""))));
  app.get("/api/policy/part21", (_req, res) => res.json(part21PolicyPack));
  app.get("/api/policy/graph", (_req, res) => res.json(buildPolicyGraph()));
  app.get("/api/policy/coverage", (req, res) => res.json(getPolicyCoverage(String(req.query.auditId ?? "AUD-026"))));
  app.post("/api/policy/evaluate", (req, res) => res.json(evaluatePart21Policy(String(req.body?.findingId ?? "FIND-2026-04"), String(req.body?.asOf ?? new Date().toISOString().slice(0, 10)))));
  app.post("/api/policy/compile", (req, res) => res.json(compileDocumentToPolicy(String(req.body?.documentId ?? "10-cfr-part-21"))));
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
