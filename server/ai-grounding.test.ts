import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { auditSkills } from "../shared/skills";
import { createAgentServices, type AgentGraph, type GovernedSkill, type AgentConversation, type AgentRecord } from "./agent-runtime";
import { answerLiveGroundedQuestion, answerGroundedQuestion, runFindingIntakeDialogue, previewFindingIntakeDialogue, buildLiveAuditBriefAgent, acknowledgeComplianceWarning } from "./ai";
vi.mock("mysql2/promise", () => ({ createPool: vi.fn(() => { throw new Error("TEST GUARD: production database access forbidden"); }) }));
// Deliberately synthetic isolated test inputs; no service or operational database is invoked.
const principal = { id: "test-principal", actor: "Test person", auditIds: ["audit-test"], auditWriteIds: ["audit-test"], access: "make_changes" as const, isAdmin: false, roleIds: [], qualified: false };
const graph: AgentGraph = { source: "mysql-database", schema: { test: true }, auditId: "audit-test", findingId: "finding-test", ontologyVersion: "actual-ontology-test-v7", nodes: [{ id: "finding-node", sourceRecordId: "finding-test" }, { id: "evidence-node", sourceRecordId: "evidence-test" }], edges: [{ id: "edge-exact-test" }], temporalEvents: [{ id: "event-exact-test", entityId: "finding-node" }], sourceIds: ["finding-test", "evidence-test"], traversalProof: { query: { auditId: "audit-test", findingId: "finding-test" }, source: "mysql-database", visitedNodeIds: ["finding-node", "evidence-node"], traversedEdgeIds: ["edge-exact-test"], temporalEventIds: ["event-exact-test"] } };
const rows: GovernedSkill[] = auditSkills.map(skill => ({ kind: "skill", configId: skill.id, version: "database-skill-v5", sourceSha256: createHash("sha256").update(JSON.stringify(skill)).digest("hex"), status: "active", approvedBy: "reviewer-test", approvedAt: "2026-01-01T00:00:00Z", approvalDecisionId: "approval-test", governanceVerified: true, payload: skill }));
function services() {
  let sequence = 0;
  return createAgentServices({ id: () => `test-id-${++sequence}`, now: () => "2026-01-02T00:00:00Z", skills: vi.fn(async () => rows), portfolio: vi.fn(async auditId => ({ source: "mysql-database", audit: { id: auditId }, findings: [{ id: "finding-test", auditId }], evidence: [], controls: [], sources: [{ id: "source-test", auditId }], suppliers: [], changes: [], metrics: null })), graph: vi.fn(async () => graph), policy: vi.fn(async scope => ({ auditId: scope.auditId, findingId: scope.findingId, results: [] })), evidence: vi.fn(async () => []), records: vi.fn(async () => []), conversation: vi.fn(async () => null), beginRun: vi.fn(async () => {}), recordTool: vi.fn(async () => {}), finishRun: vi.fn(async () => {}), commitDialogue: vi.fn(async () => {}), invoke: vi.fn(async () => ({ id: "actual-response-id", created: 1, model: "actual-response-model", choices: [{ index: 0, message: { role: "assistant" as const, content: "Source evidence-test needs review. What record resolves the missing inspection? Human review required." }, finish_reason: "stop" }] })) });
}
const options = { principal, skillId: "finding-challenge" };
const intake = { auditId: "audit-test", message: "The receiving record differs from the certificate.", principal, actor: principal.actor, findingId: "finding-test", itemId: "card-test", conversationId: "conversation-test", expectedRevision: 1, attachmentIds: ["photo-test"] };
function linkedServices() {
  const service = services();
  const conversation: AgentConversation = { id: "conversation-test", auditId: "audit-test", ownerPrincipalId: principal.id, kanbanItemId: "card-test", revision: 1, turns: [{ id: "previous-turn", text: "Actual previous assertion", skillsApplied: [{ id: "finding-challenge", version: "database-skill-v5" }] }], skillsApplied: [{ id: "finding-challenge", version: "database-skill-v5" }] };
  service.conversation = vi.fn(async () => conversation);
  service.records = vi.fn(async type => type === "kanban_item" ? [{ id: "card-test", auditId: "audit-test", conversationId: "conversation-test", findingId: "finding-test", status: "in_progress", attachmentIds: ["photo-test"] }] : type === "kanban_attachment" ? [{ id: "photo-test", auditId: "audit-test", itemId: "card-test", kind: "photo", filename: "test.png", sha256: "test-digest" }] : []);
  return service;
}
describe("intercepted live grounded model identity", () => {
  it("sends exact audit/finding, ontology version, primary keys and governed skill to existing invokeLLM", async () => {
    const service = services();
    const result = await answerLiveGroundedQuestion("What could disprove this?", "audit-test", "finding-test", options, service);
    const params = vi.mocked(service.invoke).mock.calls[0][0];
    const packet = result.groundedContextPacket;
    expect(params.model).toBe("claude-haiku-4-5"); expect(packet.auditId).toBe("audit-test"); expect(packet.findingId).toBe("finding-test"); expect(packet.ontologyVersion).toBe("actual-ontology-test-v7"); expect(packet.traversalProof?.temporalEventIds).toEqual(["event-exact-test"]); expect(packet.skillRevision).toBe("database-skill-v5"); expect(packet.skillHash).toMatch(/^[a-f0-9]{64}$/); expect(packet.appliedSkill.id).toBe("finding-challenge"); expect(packet.sourceIds).toContain("evidence-test");
    expect(JSON.stringify(params)).not.toContain("deterministicGroundingHint"); expect(JSON.stringify(params)).not.toContain("left two evidence records");
    expect(result.model).toBe("actual-response-model"); expect(result.llmInvoked).toBe(true); expect(result.humanGate.status).toBe("pending"); expect(result).toHaveProperty("warning", null);
    expect(service.recordTool).toHaveBeenCalledWith(result.traceId, expect.objectContaining({ tool: "llm.invokeLLM", result: expect.objectContaining({ actualModel: "actual-response-model", responseId: "actual-response-id" }) }));
    expect(service.finishRun).toHaveBeenLastCalledWith(expect.objectContaining({ model: "actual-response-model", answer: result.answer }));
  });
  it("does not silently select a finding/audit for missing context", async () => { const service = services(); await expect(answerLiveGroundedQuestion("question", undefined, undefined, options, service)).rejects.toThrow("Explicit auditId"); expect(service.invoke).not.toHaveBeenCalled(); });
  it("graph unavailable returns explicit portfolio questions, not a model recommendation", async () => { const service = services(); service.graph = vi.fn(async () => { throw new Error("graph missing"); }); const result = await answerLiveGroundedQuestion("question", "audit-test", "finding-test", options, service); expect(result.llmInvoked).toBe(false); expect(result.answer).toContain("portfolio questions only"); expect(service.invoke).not.toHaveBeenCalled(); expect(result.groundedContextPacket.graphSnapshot).toBeNull(); });
  it("provider empty/error response never falls back to invented narrative", async () => { const service = services(); service.invoke = vi.fn(async () => ({ id: "empty", created: 1, model: "test", choices: [] })); const result = await answerLiveGroundedQuestion("question", "audit-test", "finding-test", options, service); expect(result.llmInvoked).toBe(false); expect(result.status).toBe("provider_unavailable"); expect(result.answer).toContain("no AI recommendation"); expect(result.model).toBeNull(); });
  it("read-only grounded question invokes no provider or persistence", async () => { const service = services(); const result = await answerGroundedQuestion("Who owns this?", "audit-test", "finding-test", { principal }, service); expect(result.llmInvoked).toBe(false); expect(service.invoke).not.toHaveBeenCalled(); expect(service.beginRun).not.toHaveBeenCalled(); });
  it("empty audit brief is genuinely empty, no first finding fabricated", async () => { const service = services(); const portfolio = await service.portfolio("audit-test"); service.portfolio = vi.fn(async () => ({ ...portfolio, findings: [] })); const result = await buildLiveAuditBriefAgent("audit-test", "brief", { principal }, service); expect(result.llmInvoked).toBe(false); expect(service.invoke).not.toHaveBeenCalled(); expect(result.answer).toContain("No persisted findings"); });
});
describe("atomic audit-owned card conversation", () => {
  it("linked finding dialogue uses current live provider and exact prior turns/photos/skills", async () => {
    const service = linkedServices(); const result = await runFindingIntakeDialogue(intake, service);
    expect(result.llmInvoked).toBe(true); expect(result.model).toBe("actual-response-model"); expect(result.kanbanItemId).toBe("card-test"); expect(result.revision).toBe(2);
    const params = vi.mocked(service.invoke).mock.calls[0][0]; const packet = JSON.stringify(params);
    expect(packet).toContain("Actual previous assertion"); expect(packet).toContain("photo-test"); expect(packet).toContain("conversation-test"); expect(packet).toContain("database-skill-v5"); expect(packet).toContain(intake.message);
    const commit = vi.mocked(service.commitDialogue).mock.calls[0][0]; expect(commit.createCard).toBe(false); expect(commit.expectedRevision).toBe(1); expect(commit.communications).toHaveLength(2); expect(commit.communications.every(turn => turn.auditId === "audit-test" && turn.itemId === "card-test" && turn.skillsApplied[0].version === "database-skill-v5")).toBe(true); expect(commit.communications[1].text).toContain("Source evidence-test needs review"); expect(commit.communications[1].model).toBe("actual-response-model");
  });
  it("look-only token never persists initial intake", async () => { const service = services(); await expect(runFindingIntakeDialogue({ auditId: "audit-test", message: "note", principal: { ...principal, access: "look_only" } }, service)).rejects.toThrow("permission"); expect(service.beginRun).not.toHaveBeenCalled(); expect(service.commitDialogue).not.toHaveBeenCalled(); });
  it("new unlinked note returns no invented finding and no graph traversal", async () => { const service = services(); const result = await runFindingIntakeDialogue({ auditId: "audit-test", message: "Incomplete note", principal }, service); expect(result.findingId).toBeNull(); expect(result.llmInvoked).toBe(false); expect(service.graph).not.toHaveBeenCalled(); expect(result.answer).toContain("graph unavailable/unlinked"); });
  it("preview may invoke grounded live clarification but performs zero writes", async () => { const service = linkedServices(); const result = await previewFindingIntakeDialogue({ ...intake, principal: { ...principal, access: "look_only" } }, service); expect(result.persisted).toBe(false); expect(result.revision).toBe(1); expect(result.llmInvoked).toBe(true); expect(service.beginRun).not.toHaveBeenCalled(); expect(service.finishRun).not.toHaveBeenCalled(); expect(service.recordTool).not.toHaveBeenCalled(); expect(service.commitDialogue).not.toHaveBeenCalled(); });
  it("rejects another owner, audit, card reassignment, stale revision, and missing supplied conversation", async () => {
    for (const change of [{ ownerPrincipalId: "another" }, { auditId: "other-audit" }, { kanbanItemId: "other-card" }, { revision: 9 }]) {
      const service = linkedServices(); const current = await service.conversation("conversation-test", "audit-test"); service.conversation = vi.fn(async () => ({ ...current!, ...change }));
      await expect(runFindingIntakeDialogue(intake, service)).rejects.toThrow(); expect(service.invoke).not.toHaveBeenCalled(); expect(service.commitDialogue).not.toHaveBeenCalled();
    }
    const missing = linkedServices(); missing.conversation = vi.fn(async () => null);
    await expect(runFindingIntakeDialogue(intake, missing)).rejects.toThrow("does not exist");
  });
  it("rejects same-title cards or photos in another audit and never attaches by resemblance", async () => { const service = linkedServices(); service.records = vi.fn(async () => [{ id: "card-test", auditId: "other-audit", title: "same title" }]); await expect(runFindingIntakeDialogue(intake, service)).rejects.toThrow("does not belong"); expect(service.commitDialogue).not.toHaveBeenCalled(); });
  it("loads the card-owned conversation when the client omits conversationId", async () => {
    const service = linkedServices();
    const result = await runFindingIntakeDialogue({ ...intake, conversationId: undefined, expectedRevision: undefined }, service);
    expect(result.conversationId).toBe("conversation-test"); expect(result.revision).toBe(2); expect(service.commitDialogue).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 1 }));
  });
  it("two concurrent appends cannot both commit the same revision", async () => {
    const service = linkedServices(); let revision = 1;
    service.commitDialogue = vi.fn(async commit => { if (commit.expectedRevision !== revision) throw new Error("revision conflict"); revision = commit.conversation.revision; });
    const results = await Promise.allSettled([runFindingIntakeDialogue(intake, service), runFindingIntakeDialogue(intake, service)]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1); expect(results.filter(row => row.status === "rejected")).toHaveLength(1); expect(revision).toBe(2);
  });
  it("finalization is blocked before writes without persisted decision and actual parent gate", async () => { const service = linkedServices(); await expect(runFindingIntakeDialogue({ ...intake, finalize: true, draftTitle: "title", draftDescription: "description" }, service)).rejects.toThrow("approvalDecisionId"); expect(service.beginRun).not.toHaveBeenCalled(); expect(service.commitDialogue).not.toHaveBeenCalled(); });
  it("rejects a mismatched persisted finding decision before any run or write", async () => {
    const service = linkedServices(); service.finalizeFinding = vi.fn(async () => ({ ok: true }));
    await expect(runFindingIntakeDialogue({ ...intake, finalize: true, approvalDecisionId: "decision", draftTitle: "title", draftDescription: "description" }, service)).rejects.toThrow("does not authorize");
    expect(service.beginRun).not.toHaveBeenCalled(); expect(service.commitDialogue).not.toHaveBeenCalled(); expect(service.finalizeFinding).not.toHaveBeenCalled();
  });
  it("does not accept inline photo or voice bytes outside the managed evidence agent", async () => {
    const service = linkedServices();
    await expect(runFindingIntakeDialogue({ ...intake, base64: "not-real-bytes" } as typeof intake, service)).rejects.toThrow("managed evidence agent");
    expect(service.commitDialogue).not.toHaveBeenCalled();
  });
  it("never fabricates a warning acknowledgement; delegates only to the parent gate", async () => {
    const service = linkedServices(); service.records = vi.fn(async type => type === "warning" ? [{ id: "warning-test", auditId: "audit-test", traceId: "trace-test" }] : []);
    const blocked = await acknowledgeComplianceWarning({ warningId: "warning-test", traceId: "trace-test", actor: principal.actor, principal, auditId: "audit-test", rationale: "review" }, service);
    expect(blocked).toMatchObject({ ok: false, status: "blocked" });
    service.recordWarningDecision = vi.fn(async request => ({ ok: true, decisionId: "decision-test", warning: request.warning.id }));
    const accepted = await acknowledgeComplianceWarning({ warningId: "warning-test", traceId: "trace-test", actor: principal.actor, principal, auditId: "audit-test", rationale: "review" }, service);
    expect(accepted).toMatchObject({ ok: true, decisionId: "decision-test" }); expect(service.recordWarningDecision).toHaveBeenCalledWith(expect.objectContaining({ auditId: "audit-test", warning: expect.objectContaining({ id: "warning-test" }) }));
  });
});
