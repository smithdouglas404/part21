import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { auditSkills } from "../shared/skills";
import { nuclearPart21Skills } from "../shared/nuclear-skills";
import { runAuditSkill, previewAuditSkill, validateSkillAnswers, selectGovernedSkill, finalizeAuditReport, prepareAuditReportSnapshot, simulateFullAuditExecution, getExecutableSkillRoutes } from "./agentkit";
import { createAgentServices, validateAgentGraph, getAgentRuntimeMigrations, type AgentServices, type AgentGraph, type GovernedSkill } from "./agent-runtime";
vi.mock("mysql2/promise", () => ({ createPool: vi.fn(() => { throw new Error("TEST GUARD: production database access forbidden"); }) }));
// All records below are explicit isolated test simulations, never exported to runtime or database.
const principal = { id: "test-person", actor: "Test principal", auditIds: ["test-audit"], auditWriteIds: ["test-audit"], access: "make_changes" as const, roleIds: [], isAdmin: false, qualified: false };
const graph: AgentGraph = { source: "mysql-database", schema: { nodes: "test-schema" }, auditId: "test-audit", findingId: "test-finding", ontologyVersion: "ontology-test-revision-9", nodes: [{ id: "node-1", sourceRecordId: "test-finding" }, { id: "node-2", sourceRecordId: "source-1" }], edges: [{ id: "edge-7", from: "node-1", to: "node-2" }], temporalEvents: [{ id: "event-primary-key-42", entityId: "node-1" }], sourceIds: ["test-finding", "source-1"], traversalProof: { query: { auditId: "test-audit", findingId: "test-finding" }, auditId: "test-audit", source: "mysql-database", visitedNodeIds: ["node-1", "node-2"], traversedEdgeIds: ["edge-7"], temporalEventIds: ["event-primary-key-42"] } };
function row(skill = auditSkills[0], candidate = false): GovernedSkill { return { kind: candidate ? "skill_candidate" : "skill", configId: skill.id, version: "test-governed-v4", sourceSha256: createHash("sha256").update(JSON.stringify(skill)).digest("hex"), status: candidate ? "draft" : "active", approvedBy: candidate ? null : "test-reviewer", approvedAt: candidate ? null : "2026-01-01T00:00:00Z", approvalDecisionId: candidate ? null : "test-review-decision", governanceVerified: !candidate, payload: skill }; }
function mockServices(rows: GovernedSkill[] = auditSkills.map(skill => row(skill))) {
  let id = 0;
  return createAgentServices({ now: () => "2026-01-02T00:00:00.000Z", id: () => `test-run-${++id}`, skills: vi.fn(async () => rows), portfolio: vi.fn(async auditId => ({ source: "mysql-database", audit: { id: auditId }, findings: [{ id: "test-finding", auditId }], evidence: [], controls: [], sources: [{ id: "source-1", auditId }], suppliers: [], changes: [], metrics: null })), graph: vi.fn(async () => graph), policy: vi.fn(async scope => ({ auditId: scope.auditId, findingId: scope.findingId, results: [] })), evidence: vi.fn(async () => []), records: vi.fn(async () => []), conversation: vi.fn(async () => null), beginRun: vi.fn(async () => {}), recordTool: vi.fn(async () => {}), finishRun: vi.fn(async () => {}), commitDialogue: vi.fn(async () => {}), invoke: vi.fn(async () => ({ id: "test-response", created: 1, model: "actual-test-model", choices: [{ index: 0, message: { role: "assistant", content: "Test guidance" }, finish_reason: "stop" }] })) });
}
const input = { auditId: "test-audit", findingId: "test-finding", actor: principal.actor, principal, skillId: "frame-scope", answers: {} };

describe("required skill answers and exact selected contract", () => {
  it("does not count optional answers toward mandatory completion", () => {
    const skill = auditSkills.find(row => row.id === "evidence-intake")!;
    const result = validateSkillAnswers(skill, { "evidence-sources": ["Document control"], "evidence-gap": "optional answered" });
    expect(result.missing.map(row => row.id)).toEqual(["evidence-window"]); expect(result.completion).toBe(50);
  });
  it("accepts false as an answer but rejects empty arrays/objects and invalid options", () => {
    const skill = auditSkills[0];
    expect(validateSkillAnswers(skill, { "scope-object": false, "scope-standard": "invented option", "scope-risk": {} }).missing.map(row => row.id)).toEqual(["scope-standard", "scope-risk"]);
  });
  it("rejects absent ID instead of selecting the first skill", async () => { await expect(runAuditSkill({ ...input, skillId: "missing" }, {}, undefined, mockServices())).rejects.toThrow("not available"); });
  it("rejects legacy calls without audit and principal context", async () => { await expect(runAuditSkill("frame-scope")).rejects.toThrow("trusted principal"); });
  it("rejects ambiguous active revisions", () => { expect(() => selectGovernedSkill([row(), { ...row(), version: "other" }], { skillId: "frame-scope" })).toThrow("ambiguous"); });
  it("rejects approval flags without durable governed activation", async () => { await expect(runAuditSkill(input, {}, undefined, mockServices([{ ...row(), governanceVerified: false }]))).rejects.toThrow("activation proof"); });
  it("checks each question of every core and all eleven nuclear contracts", () => {
    for (const skill of [...auditSkills, ...nuclearPart21Skills]) {
      for (const question of skill.questions.filter(row => row.required)) {
        const answers = Object.fromEntries(skill.questions.map(row => [row.id, row.input === "choice" ? row.options?.[0] ?? "test" : row.input === "checklist" ? [row.options?.[0] ?? "test"] : "test answer"]));
        delete answers[question.id];
        expect(validateSkillAnswers(skill, answers).missing.map(row => row.id)).toContain(question.id);
      }
    }
  });
});
describe("real tool dispatch and persistence", () => {
  it("dispatches every core and nuclear route, carrying exact skill/hash and pending gate", async () => {
    for (const skill of [...auditSkills, ...nuclearPart21Skills]) {
      const candidate = nuclearPart21Skills.includes(skill);
      const services = mockServices([row(skill, candidate)]);
      const result = await runAuditSkill({ ...input, skillId: skill.id, mode: candidate ? "preview" : "runtime" }, {}, undefined, services);
      expect(result.routeExecuted).toBe(true); expect(services.portfolio).toHaveBeenCalledWith(input.auditId); expect(services.graph).toHaveBeenCalledWith(input.auditId, input.findingId);
      expect(services.beginRun).toHaveBeenCalledOnce(); expect(services.finishRun).toHaveBeenCalledOnce(); expect(services.recordTool).toHaveBeenCalled();
      expect(result.skillRevision).toBe("test-governed-v4"); expect(result.skillHash).toMatch(/^[a-f0-9]{64}$/); expect(result.humanGate.status).toBe("pending"); expect(result.verdict).toBe("unknown");
      if (candidate) { expect(result.status).toBe("draft_preview"); expect(result.appliedSkill.configurationStatus).toBe("draft"); expect(result.appliedSkill.regulatoryApproval).toBe("not_approved_for_runtime"); }
    }
    expect(getExecutableSkillRoutes()).toHaveLength(16);
  });
  it("does not activate a draft candidate for runtime", async () => { await expect(runAuditSkill({ ...input, skillId: nuclearPart21Skills[0].id }, {}, undefined, mockServices([row(nuclearPart21Skills[0], true)]))).rejects.toThrow("not available"); });
  it("runs a separate draft preview without any writes", async () => {
    const services = mockServices([row(nuclearPart21Skills[0], true)]);
    const result = await previewAuditSkill({ ...input, skillId: nuclearPart21Skills[0].id }, services);
    expect(result.durable).toBe(false); expect(services.beginRun).not.toHaveBeenCalled(); expect(services.recordTool).not.toHaveBeenCalled(); expect(services.finishRun).not.toHaveBeenCalled();
  });
  it("look-only principal cannot run persistent skill even in draft mode", async () => { await expect(runAuditSkill({ ...input, principal: { ...principal, access: "look_only" }, mode: "preview" }, {}, undefined, mockServices())).rejects.toThrow("permission"); });
  it("rejects spoofed actor, cross-audit context, and per-audit write denial", async () => {
    for (const request of [{ ...input, actor: "spoof" }, { ...input, auditId: "other-audit" }, { ...input, principal: { ...principal, auditWriteIds: [] } }]) await expect(runAuditSkill(request, {}, undefined, mockServices())).rejects.toThrow();
  });
  it("rejects wrong finding before graph dispatch", async () => { const services = mockServices(); await expect(runAuditSkill({ ...input, findingId: "another-finding" }, {}, undefined, services)).rejects.toThrow("authorized audit/finding"); expect(services.graph).not.toHaveBeenCalled(); });
  it("graph missing yields explicit unknown without invented traversal", async () => {
    const services = mockServices(); services.graph = vi.fn(async () => { throw new Error("Graph unavailable"); });
    const result = await runAuditSkill(input, {}, undefined, services); expect(result.graph).toBeNull(); expect(result.traversalProof).toBeNull(); expect(result.unknowns.join(" ")).toContain("Graph unavailable"); expect(result.grounding.graphTraversed).toBe(false);
  });
  it("policy failure is unknown and not a substituted keyword evaluator", async () => {
    const services = mockServices(); services.policy = vi.fn(async () => { throw new Error("No approved evaluator"); });
    const result = await runAuditSkill({ ...input, skillId: "finding-challenge" }, {}, undefined, services); expect(result.policy).toBeNull(); expect([...result.unknowns, ...result.advisories].join(" ")).toContain("No approved evaluator");
  });
  it("does not expose mismatched policy/evidence response", async () => {
    const services = mockServices(); services.policy = vi.fn(async () => ({ auditId: "other-audit", findingId: "test-finding", secret: "not allowed" }));
    const result = await runAuditSkill({ ...input, skillId: "finding-challenge" }, {}, undefined, services); expect(result.policy).toBeNull(); expect(JSON.stringify(result)).not.toContain("not allowed");
  });
});
describe("grounding exact keys and report gates", () => {
  it("accepts actual event primary keys and rejects entity ID substitution", () => { expect(validateAgentGraph(graph, input.auditId, input.findingId)).toBe(graph); expect(() => validateAgentGraph({ ...graph, traversalProof: { ...graph.traversalProof, temporalEventIds: ["node-1"] } }, input.auditId, input.findingId)).toThrow("primary keys"); });
  it("rejects cross-audit graph packet and missing ontology", () => { expect(() => validateAgentGraph({ ...graph, auditId: "other" }, input.auditId, input.findingId)).toThrow("scope"); expect(() => validateAgentGraph({ ...graph, ontologyVersion: "" }, input.auditId, input.findingId)).toThrow("ontology"); });
  it("migration function returns additive SQL only", () => { expect(getAgentRuntimeMigrations()).toHaveLength(3); expect(getAgentRuntimeMigrations().every(sql => sql.startsWith("CREATE TABLE IF NOT EXISTS"))).toBe(true); });
  it("static simulation endpoint is disabled without creating records", async () => { await expect(simulateFullAuditExecution()).rejects.toThrow("disabled"); });
  it("report digest is stable across generation timestamps", async () => { const services = mockServices(); const first = await prepareAuditReportSnapshot(input.auditId, services); services.now = () => "2027-01-01T00:00:00Z"; const second = await prepareAuditReportSnapshot(input.auditId, services); expect(first.artifactSha256).toEqual(second.artifactSha256); expect(first.artifact).not.toHaveProperty("generatedAt"); });
  it("rejects boolean approval and mismatched persisted exact artifact", async () => {
    await expect(finalizeAuditReport(input.auditId, input.actor, "note", true, principal, mockServices())).rejects.toThrow("boolean");
    const services = mockServices(); services.records = vi.fn(async () => [{ id: "decision", auditId: input.auditId, principalId: principal.id, status: "approved", artifactSha256: "incorrect" }]); services.finalizeReport = vi.fn(async () => ({}));
    await expect(finalizeAuditReport(input.auditId, input.actor, "note", "decision", principal, services)).rejects.toThrow("exact audit artifact"); expect(services.finalizeReport).not.toHaveBeenCalled();
  });
  it("dispatches parent approval gate only with exact persisted artifact and principal", async () => {
    const services = mockServices(); const prepared = await prepareAuditReportSnapshot(input.auditId, services);
    services.records = vi.fn(async () => [{ id: "decision", auditId: input.auditId, principalId: principal.id, status: "approved", artifactSha256: prepared.artifactSha256 }]); services.finalizeReport = vi.fn(async request => ({ ok: true, artifactSha256: request.artifactSha256 }));
    const result = await finalizeAuditReport(input.auditId, input.actor, "note", { approvalDecisionId: "decision", principal }, undefined, services); expect(result.ok).toBe(true); expect(services.finalizeReport).toHaveBeenCalledWith(expect.objectContaining({ approvalDecisionId: "decision", artifactSha256: prepared.artifactSha256, principal }));
  });
});
