import "dotenv/config";
import { listAuditAlerts, raiseAuditAlerts, acknowledgeAuditAlert } from "../alerts";
import { deliverAlertWebhook, listAlertDeliveries, webhookConfiguration } from "../alert-webhook";
import crypto from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { callMcpTool, getMcpManifest } from "../mcp";
import { buildAuditReadinessReport, exportBitemporalGraph, finalizeAuditReport, getAgentActivity, getAgentKitManifest, reportToCsv, runAuditSkill, simulateCustomAuditExecution, simulateFullAuditExecution } from "../agentkit";
import { approveRoutedFinalReport, listReportApprovalTasks, routeFinalReportApproval } from "../report-approval";
import { listAssurancePeople } from "../people";
import { listApprovalRules } from "../approval-rules";
import { appendKanbanCommunication, attachKanbanAsset, createKanbanItem, listKanbanItems, moveKanbanItem } from "../kanban-store";
import { ontologyStorageStatus, syncOntologySnapshot } from "../ontology-store";
import { getReportDraft, registerEvidence } from "../evidence";
import { assessControlledRemediationImpact, getAuditProfiles, getControlledRegulatoryPack, traverseControlledRegulatoryTree } from "../regulatory-runtime";
import { acknowledgeComplianceWarning, answerGroundedQuestion, answerLiveGroundedQuestion, configureAiProvider, getAiStatus, runFindingIntakeDialogue } from "../ai";
import { getEccCatalog, getEmbeddedEccModule } from "../../shared/ecc";
import { decideGovernanceItem, getGovernanceBoard, moveGovernanceItem } from "../../shared/governance";
import { controlAgent, getAgentRegistry } from "../agent-runtime";
import { getVendoredEccLibrary } from "../ecc-library";
import { renderEmbeddedEccDashboard } from "../ecc-dashboard";
import { buildControlledPolicyGraph, compileControlledDocumentToPolicy, evaluateControlledPolicy, getControlledPolicyCoverage, getControlledPolicyPack } from "../policy-runtime";
import { approveWorkbookImport, compareSnapshots, getExcelAdapterStatus, importWorkbookPayload, listPendingWorkbookApprovals, listSampleWorkbooks, readWorkbookSample } from "../xlsx-adapter";
import { handleMcpJsonRpc } from "../mcp-protocol";
import { getEventStoreStatus, listAssuranceEvents } from "../event-store";
import { runWeeklySourceSync } from "../weekly-sync";
import { callConnectedTool, createConnectToken, listConnectTokens, revokeConnectToken } from "../connect-api";
import { generateSyntheticPart21Decision, getDocumentControlStatus, listControlledDocuments, notarizeDocumentWithHederaDemo, registerControlledDocument, reviewDocumentCybersecurity } from "../document-control";
import { getGroundedGraphContext, getGraphStoreStatus, validateGraphOntology } from "../graph-store";
import { getDomainPortfolio, getDomainStoreStatus, listAudits, writeDomainRecordWithEvent } from "../domain-store";
import { getConfigurationStoreStatus, getControlledConfiguration, listControlledConfigurations, listControlledConfigurationPayloads } from "../config-store";
import { getMergedStudioOpenApi, getStudioGatewayStatus, studioProxyMiddleware } from "../studio-gateway";
import { resolveRequestPrincipal, AssuranceAccessError, runAsPrincipal, currentPrincipal, assertAuditPermission } from "../access-control";
import { configureEvidenceRuntime as configureVaultRuntime } from "../evidence-vault";
import { resolveCitations } from "../citation-resolver";
import { regulatoryGraphStatus } from "../regulatory-graph";
import { nuclearPart21Skills } from "../../shared/nuclear-skills";
import { supervisePart21Case, supervisionStatus, temporalIsConfigured } from "../part21-supervision";
import { deleteUserConnector, getMuseSettings, getUserConnectorStatus, museReadiness, setMuseSettings, setUserConnector } from "../muse-settings";
import { createPart21CaseRecord, getPart21Case, listPart21Cases, part21ClockBrief, part21ProcessReference, recordPart21Fact } from "../part21-case";
import { listDomainRecords } from "../domain-store";
import { verifyProcessCitations, verifyProcessModelCoverage } from "../part21-citation-verify";
import { ingestEcfrSource, listSourceSnapshots, getRegulatorySnapshot } from "../regulatory-source";
import { getEvidenceVaultStatus, readEvidenceAsset, verifyEvidenceAsset } from "../evidence-vault";
import { issueAccessGrant, listAccessGrants } from "../access-control";
import { activateConfigurationVersion, proposeConfigurationVersion, retireConfigurationVersion, reviewConfigurationVersion } from "../config-governance";

import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function respondToConnectedTool(req: Request, res: Response, tool: string) {
  try {
    const body = req.body && typeof req.body === "object" ? { ...req.body } as Record<string, unknown> : {};
    const result = await callConnectedTool(req, tool, body, body.confirm === true);
    if ("status" in result && result.status !== undefined) return res.status(result.status).json(result);
    return res.json(result);
  } catch (error) {
    console.error(`[Connector] ${tool} failed`, error);
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Connector tool unavailable", tool, databaseGroundingRequired: true, retryable: true });
  }
}

function firstForwardedValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").split(",")[0].trim();
}

function publicOrigin(req: Request) {
  if (typeof process.env.STUDIO_PUBLIC_URL === "string" && process.env.STUDIO_PUBLIC_URL.trim()) return process.env.STUDIO_PUBLIC_URL.trim();
  const forwardedHost = firstForwardedValue(req.headers["x-forwarded-host"]);
  const forwardedProto = firstForwardedValue(req.headers["x-forwarded-proto"]) || req.protocol;
  return `${forwardedProto}://${forwardedHost || req.get("host")}`;
}

async function temporalSupervisorHealth(): Promise<{ reachable: boolean; workerState?: string; lastOutboxSuccessAt?: string | null; lastOutboxError?: string | null }> {
  const host = process.env.TEMPORAL_HEALTH_HOST || "127.0.0.1";
  const port = process.env.TEMPORAL_HEALTH_PORT || "8090";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { reachable: false };
    const body = (await response.json()) as any;
    return { reachable: Boolean(body?.ready), workerState: body?.workerState, lastOutboxSuccessAt: body?.lastOutboxSuccessAt ?? null, lastOutboxError: body?.lastOutboxError ?? null };
  } catch { return { reachable: false }; }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  // Every request runs inside a principal context so downstream services (the evidence vault,
  // the Kanban, the graph) can authorize the caller without each route re-deriving identity.
  app.use((req, res, next) => {
    const run = async () => {
      let principal: any;
      try { principal = await principalOrReadOnly(req, ""); }
      catch { return next(); }
      // The visitor may read the demonstration estate but never write. Scope is derived from the
      // audits that actually exist, so a look-only principal can traverse what the UI lists.
      if (principal.id === "read-only-visitor") {
        try { principal = { ...principal, auditIds: (await listAudits()).map((audit: any) => audit.id) }; }
        catch { /* leave scope empty if the audit list is unavailable */ }
      }
      (req as any).assurancePrincipal = principal;
      return runAsPrincipal(principal, () => next());
    };
    run().catch(() => next());
  });

  // The evidence runtime is a hard dependency of the Kanban and the document vault. It is
  // configured once at startup; authorization is evaluated per request against the live
  // principal, so a look-only visitor can read but never write.
  configureVaultRuntime({
    authorize: async (principal: any, auditId: string, action: any) => {
      assertAuditPermission(principal, auditId, action !== "read");
    },
    resolvePrincipal: async () => currentPrincipal(),
  });

  app.get("/api/domain/status", async (_req, res) => res.json(await getDomainStoreStatus()));
  app.get("/api/domain/audits", async (_req, res) => {
    const audits = await listAudits();
    // Authorization is resolved from the database on every request, so a grant issued after the
    // browser loaded its session is visible on the next register refresh. Returning the whole
    // register and hiding rows client-side made a stale session look like an empty portfolio.
    let principal: ReturnType<typeof currentPrincipal> | null = null;
    try { principal = currentPrincipal(); } catch { principal = null; }
    const visible = principal && !principal.isAdmin
      ? audits.filter((audit: any) => principal!.auditIds.includes(String(audit.id)))
      : audits;
    return res.json({ source: "mysql-database", audits: visible, authorized: Boolean(principal), total: audits.length });
  });
  // Governed audit profiles come from the controlled configuration table, never from fixtures.
  // The launch screen needs this before an audit exists, so it is not audit-scoped.
  app.get("/api/nuclear/profiles", async (_req, res) => {
    try { res.json(await getAuditProfiles()); }
    catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Governed audit profiles are unavailable." }); }
  });
  app.post("/api/domain/audits", async (req, res) => {
    try {
      const principal = currentPrincipal();
      // Creating an audit is an ordinary auditor activity, not an administrative one. A
      // look-only principal may read the register but must not open a new engagement.
      if (principal.access !== "make_changes") throw new AssuranceAccessError("Look-only access cannot create an audit.", 403);
      const title = String(req.body?.title ?? "").trim();
      const scope = String(req.body?.scope ?? "").trim();
      const due = String(req.body?.due ?? "").trim();
      const profileId = String(req.body?.profileId ?? "").trim();
      const requestedStandard = String(req.body?.standard ?? "").trim();
      if (!title || !scope || !due || !profileId) return res.status(400).json({ error: "title, scope, due and profileId are required." });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due))) return res.status(400).json({ error: "due must be an ISO date (YYYY-MM-DD)." });
      const { profiles } = await getAuditProfiles();
      const profile = profiles.find(item => item.id === profileId);
      if (!profile) return res.status(400).json({ error: `Unknown governed audit profile ${profileId}.` });
      if (profile.status !== "active") return res.status(409).json({ error: `Audit profile ${profileId} is ${profile.status}; only an active profile may scope a new audit.` });
      const standard = requestedStandard || String((profile as any).standard ?? "").trim();
      if (!standard) return res.status(400).json({ error: "An applicable standard is required; the selected profile does not declare one." });
      const existing = await listAudits();
      const highest = existing.reduce((max: number, audit: any) => {
        const match = /^AUD-(\d+)$/.exec(String(audit.id ?? ""));
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);
      const formattedDue = new Date(`${due}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const auditId = `AUD-${String(highest + attempt).padStart(3, "0")}`;
        const payload = {
          id: auditId, title, scope, standard, due: formattedDue, dueDate: due,
          status: "Planned", owner: principal.actor, ownerPrincipalId: principal.id, progress: 0, findings: 0, evidence: "0 / 0 linked",
          auditProfileId: profile.id, auditProfileVersion: profile.version, auditProfileTitle: profile.title,
          regulationSets: (profile as any).regulationSets ?? [], requiredProvisionIds: (profile as any).requiredProvisionIds ?? [],
          createdAt: new Date().toISOString(), createdBy: principal.actor,
        };
        try {
          const written = await writeDomainRecordWithEvent(
            { recordType: "audit", recordId: auditId, auditId, payload },
            { expectedRevision: 0, actor: principal.id, createOnly: true },
            { id: `EVT-${crypto.randomUUID()}`, type: "audit.created", actor: principal.id, auditId, entityId: auditId, payload: { title, scope, standard, dueDate: due, auditProfileId: profile.id, auditProfileVersion: profile.version, source: "launch-screen" } },
          );
          return res.status(201).json({ source: "mysql-database", audit: { ...payload, recordId: auditId, auditId, revision: written.record.revision } });
        } catch (error) {
          if (attempt === 5) throw error;
        }
      }
      return res.status(409).json({ error: "Audit identifier allocation collided five times; refresh the register and retry." });
    } catch (error) {
      const status = error instanceof AssuranceAccessError ? error.status : 500;
      return res.status(status).json({ error: error instanceof Error ? error.message : "Audit creation failed." });
    }
  });
  app.get("/api/domain/portfolio", async (req, res) => res.json(await getDomainPortfolio(typeof req.query.auditId === "string" ? req.query.auditId : "")));
  app.get("/api/configuration/status", async (_req, res) => res.json(await getConfigurationStoreStatus()));
  app.get("/api/configuration/catalog", async (req, res) => res.json({ source: "mysql-database", configurations: await listControlledConfigurations(typeof req.query.kind === "string" ? req.query.kind as any : undefined) }));
  app.get("/api/configuration/:kind/:configId", async (req, res) => res.json(await getControlledConfiguration(req.params.kind as any, req.params.configId, typeof req.query.version === "string" ? req.query.version : undefined)));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  app.get("/api/mcp/tools", async (_req, res) => {
    res.json(await getMcpManifest());
  });
  app.post("/api/mcp/call", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const args = req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {};
    res.json({ tool: name, data: await callMcpTool(name, args) });
  });
  app.get("/api/mcp", (_req, res) => res.json({ name: "part21-assurance-os", endpoint: "/api/mcp", transport: "Streamable HTTP", protocol: "MCP JSON-RPC 2.0" }));
  app.post("/api/mcp", async (req, res) => {
    const payload = req.body;
    const result = Array.isArray(payload) ? (await Promise.all(payload.map(handleMcpJsonRpc))).filter(Boolean) : await handleMcpJsonRpc(payload);
    if (result === null || (Array.isArray(result) && result.length === 0)) return res.status(202).end();
    res.type("application/json").json(result);
  });
  app.get("/api/v1/studio/merge-status", (req, res) => res.json(getStudioGatewayStatus(`${req.protocol}://${req.get("host")}`)));
  app.get("/api/v1/openapi.json", async (req, res) => {
    const publicUrl = publicOrigin(req);
    try {
      res.json(await getMergedStudioOpenApi(publicUrl));
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Merged Studio OpenAPI unavailable.", gateway: getStudioGatewayStatus(publicUrl) });
    }
  });
  app.post("/api/v1/connect/tokens", async (req, res) => {
    if (process.env.CONNECT_ADMIN_KEY && req.headers["x-connect-admin-key"] !== process.env.CONNECT_ADMIN_KEY) return res.status(403).json({ error: "Connector administration key required." });
    res.json(await createConnectToken({ label: String(req.body?.label ?? "Meta Muse"), actor: String(req.body?.actor ?? ""), role: String(req.body?.role ?? ""), auditId: req.body?.auditId ? String(req.body.auditId) : undefined, access: req.body?.access === "make_changes" ? "make_changes" : "look_only" }));
  });
  app.get("/api/v1/connect/tokens", async (_req, res) => res.json({ tokens: await listConnectTokens() }));
  app.post("/api/v1/connect/tokens/:tokenId/revoke", async (req, res) => {
    if (process.env.CONNECT_ADMIN_KEY && req.headers["x-connect-admin-key"] !== process.env.CONNECT_ADMIN_KEY) return res.status(403).json({ error: "Connector administration key required." });
    res.json(await revokeConnectToken(req.params.tokenId, String(req.body?.actor ?? "Connector administrator")));
  });
  app.post("/api/v1/tools/:tool", async (req, res) => {
    const result = await callConnectedTool(req, req.params.tool, req.body && typeof req.body === "object" ? { ...req.body } : {}, req.body?.confirm === true);
    if ("status" in result && result.status !== undefined) return res.status(result.status).json(result);
    res.json(result);
  });
  // These paths are the stable merge surface advertised by the combined Studio OpenAPI document.
  app.post("/api/v1/part21/field/kanban/list", async (req, res) => respondToConnectedTool(req, res, "field_kanban_list"));
  app.post("/api/v1/part21/field/kanban/create", async (req, res) => respondToConnectedTool(req, res, "field_kanban_create"));
  app.post("/api/v1/part21/field/kanban/move", async (req, res) => respondToConnectedTool(req, res, "field_kanban_move"));
  app.post("/api/v1/part21/field/kanban/attach", async (req, res) => respondToConnectedTool(req, res, "field_kanban_attach"));
  app.post("/api/v1/part21/audit/brief", async (req, res) => respondToConnectedTool(req, res, "check_audit_readiness"));
  app.post("/api/v1/part21/audit/brief-agent", async (req, res) => respondToConnectedTool(req, res, "audit_brief_agent"));
  app.post("/api/v1/part21/agent/dialogue", async (req, res) => respondToConnectedTool(req, res, "agent_intake"));
  app.post("/api/v1/part21/excel/list-workbooks", async (req, res) => respondToConnectedTool(req, res, "excel_list_workbooks"));
  app.post("/api/v1/part21/excel/import", async (req, res) => respondToConnectedTool(req, res, "excel_import_workbook"));
  app.post("/api/v1/part21/excel/compare", async (req, res) => respondToConnectedTool(req, res, "excel_compare_revision"));
  app.post("/api/v1/part21/excel/approve", async (req, res) => respondToConnectedTool(req, res, "excel_approve_import"));
  app.post("/api/v1/part21/tools/:tool", async (req, res) => respondToConnectedTool(req, res, req.params.tool));
  // The published connector contract advertises these paths without the /part21 segment.
  // They must be answered locally before the upstream proxy claims the /api/v1 namespace,
  // otherwise a Muse call reaches the Studio and returns its 404 instead of a Part 21 result.
  const connectorAliases: Array<[string, string]> = [
    ["/api/v1/field/kanban/list", "field_kanban_list"],
    ["/api/v1/field/kanban/create", "field_kanban_create"],
    ["/api/v1/field/kanban/move", "field_kanban_move"],
    ["/api/v1/field/kanban/attach", "field_kanban_attach"],
    ["/api/v1/audit/brief", "check_audit_readiness"],
    ["/api/v1/audit/brief-agent", "audit_brief_agent"],
    ["/api/v1/agent/dialogue", "agent_intake"],
    ["/api/v1/excel/list-workbooks", "excel_list_workbooks"],
    ["/api/v1/excel/import", "excel_import_workbook"],
    ["/api/v1/excel/compare", "excel_compare_revision"],
    ["/api/v1/excel/approve", "excel_approve_revision"],
  ];
  for (const [path, tool] of connectorAliases) {
    app.post(path, async (req, res) => respondToConnectedTool(req, res, tool));
  }

  app.use("/api/v1", studioProxyMiddleware);
  app.get("/mcp", (_req, res) => res.json({ name: "part21-assurance-os", endpoint: "/mcp", transport: "Streamable HTTP", protocol: "MCP JSON-RPC 2.0", instructions: "POST initialize, tools/list, tools/call, resources/list, or resources/read requests to this endpoint." }));
  app.post("/mcp", async (req, res) => {
    const payload = req.body;
    const result = Array.isArray(payload) ? (await Promise.all(payload.map(handleMcpJsonRpc))).filter(Boolean) : await handleMcpJsonRpc(payload);
    if (result === null || (Array.isArray(result) && result.length === 0)) return res.status(202).end();
    res.type("application/json").json(result);
  });
  app.get("/api/events/status", async (_req, res) => res.json(await getEventStoreStatus()));
  app.get("/api/events", async (req, res) => res.json(await listAssuranceEvents({ type: typeof req.query.type === "string" ? req.query.type : undefined, entityId: typeof req.query.entityId === "string" ? req.query.entityId : undefined, auditId: typeof req.query.auditId === "string" ? req.query.auditId : undefined })));
  app.get("/api/graph/projection-events", async (req, res) => res.json(await listAssuranceEvents({ type: "graph_projection_completed", auditId: typeof req.query.auditId === "string" ? req.query.auditId : undefined, entityId: typeof req.query.entityId === "string" ? req.query.entityId : undefined })));
  app.post("/api/sync/weekly", async (req, res) => res.json(await runWeeklySourceSync(String(req.body?.actor ?? "Application weekly scheduler"))));
  app.get("/api/approvals/pending", async (_req, res) => res.json({ approvalStatus: "pending_human_review", items: await listPendingWorkbookApprovals(), humanGate: "Qualified reviewer must inspect source provenance and revision diff before approval." }));
  app.post("/api/approvals/workbooks/:workbookId", async (req, res) => res.json(await approveWorkbookImport(req.params.workbookId, String(req.body?.actor ?? "Quality approver"), String(req.body?.note ?? "Approved after human review"))));
  app.get("/api/document-control/status", async (_req, res) => res.json(await getDocumentControlStatus()));
  app.get("/api/documents", async (req, res) => res.json({ documents: await listControlledDocuments({ auditId: typeof req.query.auditId === "string" ? req.query.auditId : undefined }) }));
  app.post("/api/documents", async (req, res) => res.json(await registerControlledDocument(req.body ?? {})));
  app.post("/api/documents/:documentId/cybersecurity-review", async (req, res) => res.json(await reviewDocumentCybersecurity(req.params.documentId, req.body ?? {})));
  app.post("/api/documents/:documentId/notarize", async (req, res) => res.json(await notarizeDocumentWithHederaDemo(req.params.documentId, String(req.body?.actor ?? "Quality approver"))));
  app.post("/api/documents/:documentId/part21-decision", async (req, res) => res.json(await generateSyntheticPart21Decision(req.params.documentId, String(req.body?.actor ?? "Part 21 review agent"))));
  app.get("/api/admin/excel/status", async (_req, res) => res.json(await getExcelAdapterStatus()));
  app.get("/api/admin/excel/samples", async (_req, res) => res.json(await listSampleWorkbooks()));
  app.get("/api/admin/excel/last", async (_req, res) => res.json(await readWorkbookSample()));
  app.post("/api/admin/excel/upload", async (req, res) => res.json(await importWorkbookPayload({ filename: req.body?.filename, base64: req.body?.base64, actor: req.body?.actor, source: req.body?.source })));
  app.get("/api/admin/excel/compare", async (_req, res) => res.json({ ...(await getExcelAdapterStatus()), comparison: compareSnapshots(null, (await readWorkbookSample() as any).snapshot ?? null) }));
  app.get("/api/agentkit/manifest", async (_req, res) => {
    res.json(await getAgentKitManifest());
  });
  app.post("/api/agentkit/run", async (req, res) => {
    res.json(await runAuditSkill(String(req.body?.skillId ?? ""), req.body?.answers ?? {}));
  });
  app.post("/api/agentkit/simulate", async (req, res) => {
    res.json(await simulateFullAuditExecution(typeof req.body?.findingId === "string" ? req.body.findingId : undefined));
  });
  app.post("/api/agentkit/simulate-custom", async (req, res) => {
    res.json(await simulateCustomAuditExecution({
      findingId: String(req.body?.findingId ?? "FIND-CUSTOM-01"), title: String(req.body?.title ?? "Custom audit condition"), productId: String(req.body?.productId ?? "NSS-4820"), supplierId: String(req.body?.supplierId ?? "SUP-044"), controlFamily: String(req.body?.controlFamily ?? "21.51 traceability"), alternateConnector: req.body?.alternateConnector === "document-repository-live" ? "document-repository-live" : "vendor-erp-asterion",
    }));
  });
  app.get("/api/agentkit/activity", async (req, res) => { try { res.json({ agents: await getAgentActivity(typeof req.query.agentId === "string" ? req.query.agentId : undefined) }); } catch (error) { res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Agent activity unavailable", databaseGroundingRequired: true }); } });
  app.get("/api/agentkit/manifest.json", async (_req, res) => res.json(await getAgentKitManifest()));
  app.get("/api/graph/export", async (req, res) => res.json(await exportBitemporalGraph(typeof req.query.findingId === "string" ? req.query.findingId : undefined)));
  app.post("/api/evidence/intake", async (req, res) => res.json(await registerEvidence(req.body ?? {})));
  app.get("/api/reports/draft", async (req, res) => res.json(await getReportDraft(typeof req.query.findingId === "string" ? req.query.findingId : undefined)));
  app.post("/api/reports/finalize", async (req, res) => { try { res.json(await finalizeAuditReport(String(req.body?.auditId ?? ""), String(req.body?.actor ?? "Qualified report approver"), String(req.body?.auditorNarrative ?? ""), req.body?.approved === true)); } catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Report finalization blocked", authoritativeGraphWrite: false }); } });
  app.get("/api/people", async (req, res) => res.json(await listAssurancePeople(typeof req.query.roleId === "string" ? req.query.roleId : undefined)));
  app.get("/api/approval-rules", async (req, res) => res.json({ source: "mysql-domain-records", rules: await listApprovalRules(typeof req.query.decisionType === "string" ? req.query.decisionType as any : undefined) }));
  /**
   * Express 4 does not forward rejected promises to error middleware, so an async handler that
   * throws would become an unhandled rejection and terminate the process. Every route that can
   * fail at runtime is wrapped here and answers JSON.
   */
  const jsonRoute = (handler: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
    try { await handler(req, res); }
    catch (error) {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : "Request failed";
      const explicit = typeof (error as any)?.status === "number" ? Number((error as any).status) : undefined;
      const unavailable = /not configured|unavailable|not available/i.test(message);
      const missing = /not found|does not exist|no such/i.test(message);
      res.status(explicit ?? (missing ? 404 : unavailable ? 503 : 500)).json({ ok: false, error: message });
    }
  };

  app.get("/api/kanban", jsonRoute(async (req: any, res: any) => {
    const auditId = String(req.query.auditId ?? "").trim();
    if (!auditId) return res.status(400).json({ ok: false, error: "auditId is required to list Kanban items" });
    return res.json(await listKanbanItems(auditId));
  }));
  app.post("/api/kanban/items", jsonRoute(async (req: any, res: any) => res.json(await createKanbanItem(req.body ?? {}))));
  app.post("/api/kanban/items/:itemId/move", jsonRoute(async (req: any, res: any) => res.json(await moveKanbanItem(req.params.itemId, req.body?.status, String(req.body?.actor ?? "Field operator")))));
  app.post("/api/kanban/items/:itemId/attachments", jsonRoute(async (req: any, res: any) => res.json(await attachKanbanAsset({ ...(req.body ?? {}), itemId: req.params.itemId }))));
  app.post("/api/kanban/items/:itemId/communications", jsonRoute(async (req: any, res: any) => res.json(await appendKanbanCommunication({ ...(req.body ?? {}), itemId: req.params.itemId, auditId: String(req.body?.auditId ?? ""), conversationId: String(req.body?.conversationId ?? `KANBAN-${req.params.itemId}`), role: req.body?.role === "agent" || req.body?.role === "system" ? req.body.role : "user", actor: String(req.body?.actor ?? "Field operator"), text: String(req.body?.text ?? ""), skillIds: Array.isArray(req.body?.skillIds) ? req.body.skillIds.map(String) : [] }))));
  app.post("/api/reports/:auditId/approval-route", async (req, res) => { try { res.json(await routeFinalReportApproval(req.params.auditId, String(req.body?.personaId ?? ""), String(req.body?.routedBy ?? "Audit workflow"), String(req.body?.note ?? "Final report requires qualified human disposition."), { id: String(req.body?.personId ?? ""), name: String(req.body?.personName ?? ""), email: String(req.body?.personEmail ?? "") })); } catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Report routing failed" }); } });
  app.get("/api/reports/approvals", async (req, res) => res.json(await listReportApprovalTasks(typeof req.query.auditId === "string" ? req.query.auditId : undefined)));
  app.post("/api/reports/approvals/:approvalId/approve", async (req, res) => { try { res.json(await approveRoutedFinalReport(req.params.approvalId, String(req.body?.actor ?? ""), String(req.body?.note ?? ""))); } catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Report approval failed", authoritativeGraphWrite: false }); } });
  app.get("/api/regulatory/pack", async (_req, res) => res.json(await getControlledRegulatoryPack()));
  app.get("/api/regulatory/trace", async (req, res) => res.json(await traverseControlledRegulatoryTree(typeof req.query.findingId === "string" ? req.query.findingId : undefined)));
  app.get("/api/regulatory/impact", async (req, res) => res.json(await assessControlledRemediationImpact(typeof req.query.findingId === "string" ? req.query.findingId : undefined)));
  app.get("/api/ai/status", (_req, res) => res.json(getAiStatus()));
  app.get("/api/graph/store/status", async (_req, res) => res.json(await getGraphStoreStatus()));
  app.get("/api/graph/ontology-validation", async (_req, res) => res.json(await validateGraphOntology()));
  app.get("/api/graph/context", async (req, res) => { try { res.json(await getGroundedGraphContext(typeof req.query.findingId === "string" ? req.query.findingId : "", typeof req.query.auditId === "string" ? req.query.auditId : "")); } catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Graph context unavailable", databaseGroundingRequired: true }); } });
  app.post("/api/ai/ask", async (req, res) => {
    const question = String(req.body?.question ?? "");
    const audits = await listAudits();
    let auditId = String(req.body?.auditId ?? "");
    let portfolio = auditId ? await getDomainPortfolio(auditId) : null;
    if (!auditId || !(portfolio?.findings as any[])?.length) {
      for (const candidate of audits as any[]) {
        const candidatePortfolio = await getDomainPortfolio(candidate.id);
        if ((candidatePortfolio.findings as any[])?.length) { auditId = candidate.id; portfolio = candidatePortfolio; break; }
      }
    }
    portfolio = portfolio ?? await getDomainPortfolio(auditId);
    const findingId = String(req.body?.findingId ?? (portfolio.findings as any[])[0]?.id ?? "");
    if (req.body?.mode === "live") {
      try { return res.json(await answerLiveGroundedQuestion(question, auditId, findingId)); }
      catch (error) { return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : "Live grounded LLM invocation failed", databaseGroundingRequired: true }); }
    }
    return res.json(await answerGroundedQuestion(question, auditId, findingId));
  });
  app.get("/api/alerts", async (req, res) => {
    const auditId = String(req.query.auditId ?? "").trim();
    if (!auditId) return res.status(400).json({ error: "auditId is required" });
    res.json({ auditId, alerts: await listAuditAlerts(auditId) });
  });
  app.post("/api/alerts/raise", async (req, res) => {
    const auditId = String(req.body?.auditId ?? "").trim();
    if (!auditId) return res.status(400).json({ error: "auditId is required" });
    res.json(await raiseAuditAlerts(auditId, req.body?.findingId ? String(req.body.findingId) : null));
  });
  app.post("/api/alerts/:alertId/acknowledge", async (req, res) => {
    const auditId = String(req.body?.auditId ?? "").trim();
    const actor = String(req.body?.actor ?? "").trim();
    const rationale = String(req.body?.rationale ?? "").trim();
    if (!auditId || !actor || !rationale) return res.status(400).json({ error: "auditId, actor and rationale are required" });
    res.json(await acknowledgeAuditAlert({ auditId, alertId: req.params.alertId, actor, rationale }));
  });
  app.get("/api/alerts/webhook/status", async (req, res) => {
    const auditId = String(req.query.auditId ?? "").trim();
    res.json({ ...webhookConfiguration(), auditId: auditId || null, deliveries: auditId ? await listAlertDeliveries(auditId) : [] });
  });
  app.get("/api/alerts/deliveries", async (req, res) => {
    const auditId = String(req.query.auditId ?? "").trim();
    if (!auditId) return res.status(400).json({ error: "auditId is required" });
    res.json({ auditId, deliveries: await listAlertDeliveries(auditId), configuration: webhookConfiguration() });
  });
  app.post("/api/alerts/:alertId/notify", async (req, res) => {
    const auditId = String(req.body?.auditId ?? "").trim();
    if (!auditId) return res.status(400).json({ error: "auditId is required" });
    const alerts = await listAuditAlerts(auditId);
    const alert = alerts.find(item => item.id === req.params.alertId);
    if (!alert) return res.status(404).json({ error: "Alert does not exist in this audit." });
    const delivery = await deliverAlertWebhook({ alert, force: Boolean(req.body?.force) });
    res.status(delivery.ok ? 200 : 502).json({ alertId: alert.id, severity: alert.severity, delivery, configuration: webhookConfiguration() });
  });
  app.post("/api/ai/warnings/:warningId/acknowledge", async (req, res) => res.json(await acknowledgeComplianceWarning({ warningId: req.params.warningId, traceId: String(req.body?.traceId ?? ""), actor: String(req.body?.actor ?? ""), rationale: String(req.body?.rationale ?? "") })));
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
  app.get("/api/agents/registry", async (_req, res) => res.json(await getAgentRegistry()));
  app.post("/api/agents/control", async (req, res) => res.json(await controlAgent(String(req.body?.agentId ?? ""), req.body?.action, String(req.body?.reason ?? ""))));
  app.get("/api/policy/part21", async (_req, res) => res.json(await getControlledPolicyPack()));
  app.get("/api/policy/graph", async (_req, res) => res.json(await buildControlledPolicyGraph()));
  app.get("/api/policy/coverage", async (req, res) => res.json(await getControlledPolicyCoverage(String(req.query.auditId ?? ""))));
  app.post("/api/policy/evaluate", async (req, res) => res.json(await evaluateControlledPolicy(String(req.body?.findingId ?? ""), String(req.body?.asOf ?? new Date().toISOString().slice(0, 10)))));
  app.post("/api/policy/compile", async (req, res) => res.json(await compileControlledDocumentToPolicy(String(req.body?.documentId ?? "10-cfr-part-21"))));
  app.get("/api/ontology/storage", async (_req, res) => {
    res.json(await ontologyStorageStatus());
  });
  app.post("/api/ontology/sync", async (_req, res) => {
    res.json(await syncOntologySnapshot());
  });
  app.get("/api/reports/audit-readiness", async (req, res) => {
    res.json(await buildAuditReadinessReport(typeof req.query.auditId === "string" ? req.query.auditId : ""));
  });
  app.get("/api/reports/audit-readiness.csv", async (req, res) => {
    const report = await buildAuditReadinessReport(typeof req.query.auditId === "string" ? req.query.auditId : "");
    res.setHeader("Content-Disposition", `attachment; filename=part21-${report.audit.id.toLowerCase()}-readiness.csv`);
    res.type("text/csv").send(reportToCsv(report));
  });

  async function withPrincipal(req: Request, res: Response, work: (getPrincipal: () => Promise<Awaited<ReturnType<typeof resolveRequestPrincipal>>>) => Promise<unknown>) {
    try {
      const getPrincipal = () => resolveRequestPrincipal(req);
      res.json(await work(getPrincipal));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Part 21 operation failed";
      const status = error instanceof AssuranceAccessError ? error.status : /not found|does not exist|unknown/i.test(message) ? 404 : /required|invalid|must|cannot|closed|rewritten|already exists|outside/i.test(message) ? 409 : 503;
      res.status(status).json({ ok: false, error: message, databaseGroundingRequired: true });
    }
  }
  async function principalOrReadOnly(req: Request, auditId: string) {
    try { return await resolveRequestPrincipal(req); }
    catch {
      // The published demonstration allows read-only inspection without a session; every write remains authenticated.
      return { id: "read-only-visitor", actor: "Read-only visitor (no session)", roleIds: [], isAdmin: false, qualified: false, access: "look_only" as const, auditIds: auditId ? [auditId] : [], auditWriteIds: [], qualifiedAuditIds: [] } as any;
    }
  }
  const calendarFrom = (req: Request) => ({
    timezone: typeof req.query.timezone === "string" ? req.query.timezone : undefined,
    holidays: typeof req.query.holidays === "string" ? req.query.holidays.split(",").map(value => value.trim()).filter(Boolean) : undefined,
    triggerDay: req.query.triggerDay === "include" ? "include" as const : undefined,
  });
  app.get("/api/session", async (req, res) => {
    try {
      const principal = await resolveRequestPrincipal(req);
      res.json({ authenticated: true, principal, auditIds: principal.auditIds ?? [] });
    } catch {
      try {
        const audits = await listAudits();
        const auditIds = (audits as any[]).map(audit => String(audit.id));
        res.json({
          authenticated: false,
          demoMode: "read-only-visitor",
          principal: { id: "read-only-visitor", actor: "Read-only visitor", roleIds: [], isAdmin: false, qualified: false, access: "look_only", auditIds, auditWriteIds: [], qualifiedAuditIds: [] },
          auditIds,
          notice: "No application session. Inspection is read-only; every write requires a signed-in identity with an audit grant.",
        });
      } catch (error) {
        res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Session unavailable" });
      }
    }
  });
  app.get("/api/nuclear/status", async (req, res) => {
    try {
      const auditId = typeof req.query.auditId === "string" ? req.query.auditId : "";
      const part21 = await listSourceSnapshots("ecfr-part-21");
      const snapshot = part21[0] ?? null;
      const verification = snapshot ? verifyProcessCitations(await getRegulatorySnapshot(snapshot.id)) : null;
      const cases = auditId ? await listDomainRecords<any>("part21_case", auditId).catch(() => []) : [];
      res.json({
        auditId: auditId || null,
        source: "mysql-database",
        regulatorySource: snapshot ? { ingested: true, snapshotId: snapshot.id, sourceAsOf: snapshot.sourceAsOf, latestAmendedOn: snapshot.latestAmendedOn, providerUpToDateAsOf: snapshot.providerUpToDateAsOf, provisions: snapshot.provisions.length, citationsVerified: verification?.verified ?? 0, citationsMismatched: verification?.mismatched ?? 0 } : { ingested: false, note: "No official source snapshot has been ingested; citations must not be presented as current law." },
        temporal: { installed: true, workflow: "Part21CaseWorkflow", timers: ["60 calendar days — evaluation and interim report", "30 days — written notification", "2 days — initial notification"], serviceConfigured: Boolean(process.env.TEMPORAL_ADDRESS && process.env.TEMPORAL_NAMESPACE && process.env.TEMPORAL_TASK_QUEUE), running: (await temporalSupervisorHealth()).reachable, handoff: { ready: false, blockers: ["approved policy snapshot (approvalDecisionId)", "approved calendar snapshot (approvalDecisionId)", "discovery decision with evidence (discoveryDecisionId)"] }, note: "The workflow, deadline store and worker are installed and proven against a real Temporal server in tests. Production has no Temporal service, and no case can hand off until approved policy and calendar snapshots exist, so statutory clocks are currently computed on read rather than supervised by durable timers." },
        evidenceVault: { originalBytes: "mysql", objectLock: process.env.S3_OBJECT_LOCK_BUCKET ? "configured" : "not-configured", immudb: process.env.IMMUDB_ADDRESS ? "configured" : "not-configured", note: "A SHA-256 hash is not WORM protection. External Object Lock and immudb verification are not active." },
        part21Cases: { auditScoped: cases.length, clockModel: "event-triggered branches computed from recorded facts", calendarApproval: "not-approved-for-reliance" },
        humanReviewRequired: true,
      });
    } catch (error) { res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Nuclear status unavailable" }); }
  });
  app.get("/api/settings/muse", async (req, res) => withPrincipal(req, res, async () => { const principal = await principalOrReadOnly(req, ""); return museReadiness(principal.id); }));
  app.put("/api/settings/muse", async (req, res) => withPrincipal(req, res, async () => { const principal = await principalOrReadOnly(req, ""); if (!principal.isAdmin || principal.id === "read-only-visitor") throw new Error("Administrator identity is required to change Muse sharing."); return setMuseSettings(req.body ?? {}, principal.actor); }));
  app.get("/api/me/muse", async (req, res) => withPrincipal(req, res, async () => { const principal = await principalOrReadOnly(req, ""); return getUserConnectorStatus(principal.id); }));
  app.put("/api/me/muse", async (req, res) => withPrincipal(req, res, async () => { const principal = await principalOrReadOnly(req, ""); if (principal.id === "read-only-visitor") throw new Error("Sign in to connect your own Muse connector."); return setUserConnector(principal.id, req.body ?? {}); }));
  app.delete("/api/me/muse", async (req, res) => withPrincipal(req, res, async () => { const principal = await principalOrReadOnly(req, ""); if (principal.id === "read-only-visitor") throw new Error("Sign in to remove a Muse connector."); return deleteUserConnector(principal.id); }));
  app.get("/api/part21/cases/:caseId/supervision", async (req, res) => withPrincipal(req, res, async () => supervisionStatus(req.params.caseId)));
  app.get("/api/nuclear/skills", async (_req, res) => {
    try {
      const active = (await listControlledConfigurationPayloads<any>("skill")).map(row => ({ kind: row.kind, configId: row.configId, version: row.version, status: row.status, approvedBy: row.approvedBy, approvedAt: row.approvedAt, payload: row.payload }));
      res.json({ source: "mysql-database", scope: "10 CFR Part 21 with 10 CFR 50 Appendix B nuclear QA criteria", count: active.length, domains: { part21: active.filter(r => (r.payload as any)?.domain === "nuclear-part21").length, appendixB: active.filter(r => (r.payload as any)?.domain === "nuclear-appendix-b").length, method: active.filter(r => (r.payload as any)?.domain === "nuclear-qa-method").length }, skills: active });
    } catch (error) { res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Skill library unavailable" }); }
  });
  app.get("/api/part21/agent-brief", async (req, res) => {
    try {
      const auditId = String(req.query.auditId ?? "");
      res.json(await part21ClockBrief(auditId, calendarFrom(req)));
    } catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : "Agent clock brief unavailable" }); }
  });
  app.get("/api/part21/process", async (req, res) => res.json(await part21ProcessReference(calendarFrom(req))));
  app.get("/api/part21/cases", async (req, res) => withPrincipal(req, res, async () => { const auditId = String(req.query.auditId ?? ""); const principal = await principalOrReadOnly(req, auditId); return listPart21Cases(auditId, principal); }));
  app.get("/api/part21/cases/:caseId", async (req, res) => withPrincipal(req, res, async () => { const auditId = String(req.query.auditId ?? ""); const principal = await principalOrReadOnly(req, auditId); const view = await getPart21Case(auditId, req.params.caseId, principal, calendarFrom(req));
      let supervision: any = null;
      if (process.env.PART21_AUTO_SUPERVISE === "true" && await temporalIsConfigured()) {
        try { supervision = await supervisePart21Case(view as any, principal as any, "Part 21 baseline recorded at supervision: Mon-Fri working calendar with US federal holidays, 60/30/2-day statutory durations."); }
        catch (error) { supervision = { bound: false, error: error instanceof Error ? error.message : "Supervision unavailable" }; }
      }
      return { ...view, supervision }; }));
  app.post("/api/part21/cases", async (req, res) => withPrincipal(req, res, async getPrincipal => createPart21CaseRecord(req.body ?? {}, await getPrincipal())));
  app.post("/api/part21/cases/:caseId/facts", async (req, res) => withPrincipal(req, res, async getPrincipal => recordPart21Fact({ ...(req.body ?? {}), auditId: String(req.body?.auditId ?? req.query.auditId ?? ""), caseId: req.params.caseId }, await getPrincipal())));
  app.get("/api/regulatory/coverage", async (_req, res) => {
    const snapshots = [...(await listSourceSnapshots("ecfr-part-21")), ...(await listSourceSnapshots("ecfr-part-50-appendix-b"))];
    const skills = nuclearPart21Skills.map(skill => ({
      skillId: skill.id,
      name: skill.name,
      domain: (skill as any).domain ?? null,
      coverage: resolveCitations((skill as any).regulatoryRefs ?? [], snapshots, (skill as any).externalRefs ?? []),
    }));
    const totals = skills.reduce((acc, item) => ({
      references: acc.references + item.coverage.total,
      resolved: acc.resolved + item.coverage.resolved,
      external: acc.external + item.coverage.notApplicable,
      unresolved: acc.unresolved + item.coverage.unresolved + item.coverage.ambiguous,
    }), { references: 0, resolved: 0, external: 0, unresolved: 0 });
    res.json({
      snapshots: snapshots.map(snapshot => ({ id: snapshot.id, sourceId: snapshot.sourceId, sourceAsOf: snapshot.sourceAsOf, provisions: snapshot.provisions.length })),
      totals,
      accountedPercent: totals.references ? Math.round(((totals.resolved + totals.external) / totals.references) * 100) : 0,
      skills,
      humanReviewRequired: true,
    });
  });

  app.get("/api/regulatory/graph-status", async (_req, res) => {
    const [rows] = await (await import("../db-pool")).query(
      "SELECT * FROM part21_controlled_configuration WHERE kind='ontology' AND status='active'",
    );
    const row = (rows as any[])[0];
    if (!row) return res.status(503).json({ ok: false, error: "No active ontology is configured." });
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    const ontology: any = { kind: "ontology", configId: row.config_id, version: row.version, status: row.status, payload };
    const [drafts] = await (await import("../db-pool")).query(
      "SELECT version, status FROM part21_controlled_configuration WHERE kind='ontology' AND config_id=? AND status='draft'",
      [row.config_id],
    );
    res.json({ ...regulatoryGraphStatus(ontology), stagedRevisions: drafts, humanReviewRequired: true });
  });

  app.get("/api/regulatory/snapshots", async (_req, res) => {
    try {
      const part21 = await listSourceSnapshots("ecfr-part-21");
      const appendixB = await listSourceSnapshots("ecfr-part-50-appendix-b");
      res.json({ source: "ecfr-rest-api", snapshots: [...part21, ...appendixB].map(snapshot => ({ id: snapshot.id, sourceId: snapshot.sourceId, regulationSet: snapshot.regulationSet, sourceAsOf: snapshot.sourceAsOf, latestAmendedOn: snapshot.latestAmendedOn, providerUpToDateAsOf: snapshot.providerUpToDateAsOf, retrievedAt: snapshot.retrievedAt, provisions: snapshot.provisions.length, originals: snapshot.originals.length, legalStatus: snapshot.legalStatus })) });
    } catch (error) { res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Regulatory snapshots unavailable" }); }
  });
  app.get("/api/regulatory/verification", async (req, res) => {
    try {
      const requested = typeof req.query.snapshotId === "string" ? req.query.snapshotId : "";
      const snapshot = requested ? await getRegulatorySnapshot(requested) : (await listSourceSnapshots("ecfr-part-21"))[0];
      if (!snapshot) return res.status(404).json({ ok: false, error: "No ingested Part 21 snapshot is available. Ingest the official eCFR source before displaying citations as current." });
      res.json({ ...verifyProcessCitations(snapshot), modelCoverage: verifyProcessModelCoverage(snapshot) });
    } catch (error) { res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Citation verification unavailable" }); }
  });
  app.post("/api/regulatory/ingest", jsonRoute(async (req: any, res: any) => {
    const principal = currentPrincipal();
    if (!principal.isAdmin) return res.status(403).json({ ok: false, error: "Only an administrator may ingest a controlled eCFR source snapshot." });
    const body = req.body ?? {};
    const sourceId = String(body.sourceId ?? "").trim();
    const regulationSet = String(body.regulationSet ?? "10-cfr-part-21");
    const sourceAsOf = String(body.sourceAsOf ?? "").trim();
    if (!sourceId) return res.status(400).json({ ok: false, error: "sourceId is required" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceAsOf)) return res.status(400).json({ ok: false, error: "sourceAsOf must be an ISO date (YYYY-MM-DD)" });
    const result = await ingestEcfrSource({ sourceId, regulationSet: regulationSet as any, sourceAsOf });
    return res.json(result);
  }));

  app.get("/api/evidence/vault/status", jsonRoute(async (req: any, res: any) => {
    const auditId = String(req.query.auditId ?? "").trim();
    if (!auditId) return res.status(400).json({ ok: false, error: "auditId is required for evidence vault status" });
    return res.json(await getEvidenceVaultStatus(auditId, currentPrincipal() as any));
  }));

  app.get("/api/evidence/assets/:assetId/download", jsonRoute(async (req: any, res: any) => {
    const auditId = String(req.query.auditId ?? "").trim();
    if (!auditId) return res.status(400).json({ ok: false, error: "auditId is required to download evidence" });
    const revision = req.query.revision ? Number(req.query.revision) : undefined;
    const result = await readEvidenceAsset(req.params.assetId, auditId, currentPrincipal() as any, revision);
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, String(value));
    return res.send(Buffer.from(result.bytes));
  }));

  app.post("/api/evidence/assets/:assetId/verify", jsonRoute(async (req: any, res: any) => {
    const auditId = String(req.body?.auditId ?? req.query.auditId ?? "").trim();
    if (!auditId) return res.status(400).json({ ok: false, error: "auditId is required to verify evidence" });
    return res.json(await verifyEvidenceAsset(req.params.assetId, auditId, currentPrincipal() as any, req.body?.revision ? Number(req.body.revision) : undefined));
  }));

  app.get("/api/access/grants", jsonRoute(async (_req: any, res: any) => res.json({ source: "mysql-database", grants: await listAccessGrants(currentPrincipal()) })));
  app.post("/api/access/grants", jsonRoute(async (req: any, res: any) => {
    const body = req.body ?? {};
    const principalId = String(body.principalId ?? "").trim();
    const auditId = String(body.auditId ?? "").trim();
    if (!principalId || !auditId) return res.status(400).json({ ok: false, error: "principalId and auditId are required" });
    if (!Array.isArray(body.roleIds) || !body.roleIds.length) return res.status(400).json({ ok: false, error: "roleIds must list at least one governed role" });
    const grant = await issueAccessGrant({
      principalId,
      auditId,
      roleIds: body.roleIds.map(String),
      access: body.access === "look_only" ? "look_only" : "make_changes",
      personId: body.personId ? String(body.personId) : undefined,
      qualificationEvidenceId: body.qualificationEvidenceId ? String(body.qualificationEvidenceId) : undefined,
      qualifiedUntil: body.qualifiedUntil ? String(body.qualifiedUntil) : undefined,
    } as any, currentPrincipal());
    return res.json(grant);
  }));

  app.get("/api/configuration/drafts", jsonRoute(async (req: any, res: any) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    // Read the persisted controlled catalog directly. The governance service adds review,
    // separation-of-duties and qualification gates on writes; listing drafts needs only the rows.
    const rows = await listControlledConfigurations(kind as any);
    const drafts = rows.filter((row: any) => row.status === "draft");
    return res.json({ source: "mysql-database-controlled-configuration", drafts, governanceReviewConfigured: false });
  }));

  app.post("/api/configuration/drafts", jsonRoute(async (req: any, res: any) => {
    const body = req.body ?? {};
    const kind = String(body.kind ?? "").trim();
    const configId = String(body.configId ?? "").trim();
    const version = String(body.version ?? "").trim();
    if (!kind || !configId || !version) return res.status(400).json({ ok: false, error: "kind, configId and version are required" });
    if (body.payload === undefined) return res.status(400).json({ ok: false, error: "payload is required" });
    return res.json(await proposeConfigurationVersion(currentPrincipal() as any, { kind: kind as any, configId, version, payload: body.payload }));
  }));

  app.post("/api/configuration/:operation(review|activate|retire)", jsonRoute(async (req: any, res: any) => {
    const body = req.body ?? {};
    const kind = String(body.kind ?? "").trim();
    const configId = String(body.configId ?? "").trim();
    const version = String(body.version ?? "").trim();
    if (!kind || !configId || !version) return res.status(400).json({ ok: false, error: "kind, configId and version are required" });
    const principal = currentPrincipal() as any;
    const operation = req.params.operation;
    if (operation === "review") {
      const missing = ["expectedSha256", "action", "disposition", "rationale", "acceptanceEvidenceIds"].filter(key => body[key] === undefined || (Array.isArray(body[key]) && !body[key].length));
      if (missing.length) return res.status(400).json({ ok: false, error: `Configuration review requires ${missing.join(", ")}. A reviewer must cite retained acceptance evidence and the exact draft digest.`, required: missing });
      return res.json(await reviewConfigurationVersion(principal, { kind: kind as any, configId, version, expectedSha256: String(body.expectedSha256), action: body.action, disposition: body.disposition, rationale: String(body.rationale), acceptanceEvidenceIds: body.acceptanceEvidenceIds.map(String) }));
    }
    if (operation === "activate") {
      if (!body.approvalId) return res.status(400).json({ ok: false, error: "Activation requires the recorded approvalId from a completed review." });
      return res.json(await activateConfigurationVersion(principal, { kind: kind as any, configId, version, approvalId: String(body.approvalId), expectedSha256: body.expectedSha256 ? String(body.expectedSha256) : undefined, expectedActiveVersion: body.expectedActiveVersion ? String(body.expectedActiveVersion) : null } as any));
    }
    return res.json(await retireConfigurationVersion(principal, { kind: kind as any, configId, version, approvalId: body.approvalId ? String(body.approvalId) : undefined, rationale: String(body.rationale ?? "") } as any));
  }));

  app.post("/api/agent/dialogue", jsonRoute(async (req: any, res: any) => {
    const body = req.body ?? {};
    const auditId = String(body.auditId ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!auditId || !message) return res.status(400).json({ ok: false, error: "auditId and message are required" });
    const principal = currentPrincipal();
    const result = await runFindingIntakeDialogue({
      auditId,
      message,
      findingId: body.findingId ? String(body.findingId) : undefined,
      itemId: body.itemId ? String(body.itemId) : undefined,
      conversationId: body.conversationId ? String(body.conversationId) : undefined,
      expectedRevision: body.expectedRevision === undefined ? undefined : Number(body.expectedRevision),
      finalize: body.finalize === true,
      draftTitle: body.draftTitle ? String(body.draftTitle) : undefined,
      draftDescription: body.draftDescription ? String(body.draftDescription) : undefined,
      approvalDecisionId: body.approvalDecisionId ? String(body.approvalDecisionId) : undefined,
      principal: { ...principal, auditIds: [auditId], auditWriteIds: [auditId] } as any,
    } as any);
    return res.json(result);
  }));

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
    // Last-resort error middleware: never answer an API request with an HTML stack trace.
    app.use((error: any, req: any, res: any, _next: any) => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : "Unexpected server error";
      console.error(`[api] ${req.method} ${req.originalUrl} failed: ${message}`);
      res.status(500).json({ ok: false, error: message });
    });
    // An unknown API path must never fall through to the SPA shell: a client asking for JSON
    // would receive HTML and report a misleading "misrouted endpoint" failure.
    app.use(["/api", "/mcp"], (req, res) => {
      res.status(404).json({
        ok: false,
        error: `Unknown API route: ${req.method} ${req.originalUrl.split("?")[0]}`,
        hint: "Check the path against /api/v1/openapi.json; this server answers JSON for every /api route.",
      });
    });
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

// A single failing request must not terminate the assurance service. Log it, keep serving,
// and let the JSON error middleware answer the caller.
process.on("unhandledRejection", reason => {
  console.error("[process] unhandled rejection:", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", error => {
  console.error("[process] uncaught exception:", error instanceof Error ? error.message : error);
});

startServer().catch(error => { console.error(error); process.exit(1); });
