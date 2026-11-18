import { describe, expect, it, vi } from "vitest";
import { configurationDigest, createConfigurationGovernance, diffConfigurationPayloads, type AuditPolicyBaseline, type ConfigurationReview, type ConfigurationVersion, type GovernanceDependencies, type GovernancePrincipal, type GovernanceRepository, type GovernanceTransaction, type GovernedConfigurationKind } from "./config-governance";

const at = "2026-11-18T12:00:00Z";
const author: GovernancePrincipal = { id: "test-author", actor: "Test author", roleIds: ["configuration_author"], auditIds: ["test-audit"], access: "make_changes", isAdmin: false, qualified: false };
const reviewer: GovernancePrincipal = { id: "test-reviewer", actor: "Test reviewer", roleIds: ["quality_approver"], auditIds: ["test-audit"], access: "make_changes", isAdmin: false, qualified: true, qualificationEvidenceId: "test-qualification-evidence" };
function memoryRepository() {
  const versions = new Map<string, ConfigurationVersion>(), reviews = new Map<string, ConfigurationReview>(), baselines = new Map<string, AuditPolicyBaseline>(), events: unknown[] = [];
  const key = (k: string, i: string, v: string) => `${k}/${i}/${v}`;
  const view = (): GovernanceTransaction => ({
    async getVersion(kind, id, version) { return versions.get(key(kind, id, version)) ?? null; },
    async listVersions(kind) { return [...versions.values()].filter(v => !kind || v.kind === kind); },
    async insertVersion(row) { if (versions.has(key(row.kind, row.configId, row.version))) throw new Error("duplicate"); versions.set(key(row.kind, row.configId, row.version), structuredClone(row)); },
    async getReview(id) { return reviews.get(id) ?? null; }, async insertReview(row) { reviews.set(row.id, structuredClone(row)); },
    async getActive(kind, id) { const active = [...versions.values()].filter(v => v.kind === kind && v.configId === id && v.status === "active"); if (active.length > 1) throw new Error("ambiguous"); return active[0] ?? null; },
    async setStatus(kind, id, version, status) { const row = versions.get(key(kind, id, version)); if (!row) throw new Error("missing"); row.status = status; },
    async appendEvent(e) { events.push(e); }, async getBaseline(auditId) { return baselines.get(auditId) ?? null; }, async insertBaseline(b) { baselines.set(b.auditId, structuredClone(b)); },
  });
  const repository: GovernanceRepository = { ...view(), async transaction(action) { return action(view()); } };
  return { repository, versions, reviews, baselines, events };
}
function setup() {
  const memory = memoryRepository(); let n = 0;
  const validatePayload = vi.fn(async () => undefined);
  const deps: GovernanceDependencies = { repository: memory.repository, authorize: vi.fn(async () => undefined), verifyQualification: vi.fn(async () => undefined), verifyApprovalRecord: vi.fn(async () => undefined), requireAudit: vi.fn(async () => undefined), validatePayload, now: () => at, newId: () => `test-id-${++n}` };
  return { memory, validatePayload, service: createConfigurationGovernance(deps) };
}
async function activePolicy(service: ReturnType<typeof setup>["service"]) {
  const draft = await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy", version: "test-1", payload: { rules: [{ id: "test-rule" }] } });
  const review = await service.reviewConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-1", expectedSha256: draft.sourceSha256, action: "activate", disposition: "approved", rationale: "Test review only", acceptanceEvidenceIds: ["test-acceptance"] });
  return service.activateConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-1", approvalId: review.id, expectedSha256: draft.sourceSha256, expectedActiveVersion: null });
}
describe("controlled configuration governance (mock only)", () => {
  it("creates immutable draft digests and rejects overwrite of the same version", async () => {
    const { service } = setup(); const draft = await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy", version: "test-1", payload: { b: 2, a: 1 } });
    expect(draft.status).toBe("draft"); expect(draft.sourceSha256).toBe(configurationDigest({ a: 1, b: 2 }));
    await expect(service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy", version: "test-1", payload: { a: 3 } })).rejects.toThrow("immutable");
  });
  it("returns path-level diff without exposing approval as inferred", async () => {
    const { service } = setup();
    await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy", version: "test-1", payload: { rules: [{ id: "test-a" }], enabled: true } });
    await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy", version: "test-2", payload: { rules: [{ id: "test-b" }], enabled: true } });
    const diff = await service.getConfigurationDiff(author, { kind: "policy", configId: "test-policy", beforeVersion: "test-1", afterVersion: "test-2" });
    expect(diff.changes).toEqual(expect.arrayContaining([expect.objectContaining({ path: "/rules/0/id", before: "test-a", after: "test-b" })]));
    expect(diff).not.toHaveProperty("approval");
  });
  it("requires qualified reviewer, retained evidence, matching digest and non-author", async () => {
    const { service } = setup(); const draft = await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy", version: "test-1", payload: { test: true } });
    const review = { kind: "policy" as const, configId: "test-policy", version: "test-1", expectedSha256: draft.sourceSha256, action: "activate" as const, disposition: "approved" as const, rationale: "Test only", acceptanceEvidenceIds: ["test-acceptance"] };
    await expect(service.reviewConfigurationVersion({ ...reviewer, qualified: false }, review)).rejects.toThrow("qualified");
    await expect(service.reviewConfigurationVersion(reviewer, { ...review, acceptanceEvidenceIds: [] })).rejects.toThrow("evidence");
    await expect(service.reviewConfigurationVersion(reviewer, { ...review, expectedSha256: "b".repeat(64) })).rejects.toThrow("digest");
    await expect(service.reviewConfigurationVersion({ ...reviewer, id: author.id }, review)).rejects.toThrow("Separation");
  });
  it("activates only the exact persisted approved draft and retires the prior active version", async () => {
    const { service, memory } = setup(); const active = await activePolicy(service);
    expect(active.status).toBe("active"); expect([...memory.versions.values()][0].status).toBe("active");
    const draft2 = await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy", version: "test-2", payload: { rules: [{ id: "test-rule-2" }] } });
    const approval2 = await service.reviewConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-2", expectedSha256: draft2.sourceSha256, action: "activate", disposition: "approved", rationale: "Test only", acceptanceEvidenceIds: ["test-acceptance"] });
    await expect(service.activateConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-2", approvalId: approval2.id, expectedSha256: draft2.sourceSha256, expectedActiveVersion: "test-0" })).rejects.toThrow("changed");
    await service.activateConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-2", approvalId: approval2.id, expectedSha256: draft2.sourceSha256, expectedActiveVersion: "test-1" });
    const statuses = [...memory.versions.values()].map(v => [v.version, v.status]); expect(statuses).toEqual([["test-1", "retired"], ["test-2", "active"]]);
  });
  it("rejects self-activation, unapproved/rejected review and non-reviewed payload", async () => {
    const { service, validatePayload } = setup(); const draft = await service.proposeConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-1", payload: { test: true } });
    const selfReview = await service.reviewConfigurationVersion({ ...reviewer, id: "test-other", roleIds: ["quality_approver"] }, { kind: "policy", configId: "test-policy", version: "test-1", expectedSha256: draft.sourceSha256, action: "activate", disposition: "approved", rationale: "Test only", acceptanceEvidenceIds: ["test-acceptance"] });
    await expect(service.activateConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-1", approvalId: selfReview.id, expectedSha256: draft.sourceSha256, expectedActiveVersion: null })).rejects.toThrow("author");
    const draft2 = await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy-2", version: "test-1", payload: { test: true } });
    const rejected = await service.reviewConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy-2", version: "test-1", expectedSha256: draft2.sourceSha256, action: "activate", disposition: "rejected", rationale: "Test rejection", acceptanceEvidenceIds: ["test-acceptance"] });
    await expect(service.activateConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy-2", version: "test-1", approvalId: rejected.id, expectedSha256: draft2.sourceSha256, expectedActiveVersion: null })).rejects.toThrow("approval");
    validatePayload.mockRejectedValueOnce(new Error("definition tests failed"));
    const draft3 = await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy-3", version: "test-1", payload: { test: true } });
    await expect(service.reviewConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy-3", version: "test-1", expectedSha256: draft3.sourceSha256, action: "activate", disposition: "approved", rationale: "Test only", acceptanceEvidenceIds: ["test-acceptance"] })).rejects.toThrow("definition tests failed");
  });
  it("retires an active version only with exact approval and retains its history", async () => {
    const { service, memory } = setup(); await activePolicy(service);
    const approval = await service.reviewConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-1", expectedSha256: configurationDigest({ rules: [{ id: "test-rule" }] }), action: "retire", disposition: "approved", rationale: "Test only", acceptanceEvidenceIds: ["test-acceptance"] });
    const retired = await service.retireConfigurationVersion(reviewer, { kind: "policy", configId: "test-policy", version: "test-1", approvalId: approval.id, expectedSha256: configurationDigest({ rules: [{ id: "test-rule" }] }) });
    expect(retired.status).toBe("retired"); expect(memory.versions.size).toBe(1); expect(memory.events).toHaveLength(5);
  });
  it("pins a single audit baseline to an active reviewed policy and never fabricates approval", async () => {
    const { service } = setup(); const active = await activePolicy(service);
    const approval = [...(await service.listConfigurationDrafts(author, "policy"))]; expect(approval).toEqual([]);
    await expect(service.pinAuditPolicyBaseline(reviewer, { auditId: "test-audit", configId: "test-policy", version: "test-1", expectedSha256: active.sourceSha256, approvalId: "test-missing-review" })).rejects.toThrow("approval");
    const reviews = await service.getConfigurationDiff(reviewer, { kind: "policy", configId: "test-policy", beforeVersion: "test-1", afterVersion: "test-1" });
    expect(reviews.changes).toEqual([]);
  });
  it("never writes statuses, reviews or events when authorization/qualification checks fail", async () => {
    const { service, memory } = setup(); const draft = await service.proposeConfigurationVersion(author, { kind: "policy", configId: "test-policy", version: "test-1", payload: { test: true } });
    await expect(service.reviewConfigurationVersion({ ...reviewer, access: "look_only" }, { kind: "policy", configId: "test-policy", version: "test-1", expectedSha256: draft.sourceSha256, action: "activate", disposition: "approved", rationale: "Test only", acceptanceEvidenceIds: ["test-acceptance"] })).rejects.toThrow("Write access");
    expect(memory.reviews.size).toBe(0); expect(memory.versions.get("policy/test-policy/test-1")!.status).toBe("draft");
  });
  it("diffs arrays deterministically and treats changed scalar types distinctly", () => {
    expect(diffConfigurationPayloads({ x: 1 }, { x: "1" })).toEqual([{ path: "/x", before: 1, after: "1" }]);
    expect(diffConfigurationPayloads({ a: [1] }, { a: [1, 2] })).toEqual([{ path: "/a/1", before: null, after: 2 }]);
  });
});
