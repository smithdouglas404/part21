import { describe, expect, it } from "vitest";
import type { ConfigurationVersion } from "./config-governance";
import type { GovernanceRepository } from "./config-governance";
import type { RegulatorySnapshot } from "../shared/regulatory";
import { getAuditProfiles, getControlledRegulatoryPack, getRegulatorySourceCatalog, traverseControlledRegulatoryTree, assessControlledRemediationImpact } from "./regulatory-runtime";
import type { RegulatorySnapshotStore } from "./regulatory-source";

const at = "2026-11-18T12:00:00Z";
function profile(id: string, version: string, status: ConfigurationVersion["status"]): ConfigurationVersion {
  return { kind: "audit_profile", configId: id, version, sourceSha256: "a".repeat(64), status, createdBy: "test-author", createdAt: at, payload: { id, version, title: `Test profile ${id}`, caseType: "internal_nuclear_qa", regulationSets: ["10-cfr-part-21", "10-cfr-part-50-appendix-b"], requiredProvisionIds: ["10-cfr:21.21"], requiredEvidenceTypes: ["test-evidence"], reviewerRoles: ["quality_approver"], reportingPath: "qualified human decision" } };
}
function repository(versions: ConfigurationVersion[]) { return { listVersions: async (kind?: string) => kind ? versions.filter(v => v.kind === kind) : versions } as unknown as GovernanceRepository; }
describe("database audit profile definitions (mock only)", () => {
  it("returns candidates from database versions, active-only selection, and an explicit empty state", async () => {
    const active = profile("test-profile", "v1", "active"), draft = profile("test-profile-draft", "v1", "draft"), retired = profile("test-profile-retired", "v1", "retired");
    const result = await getAuditProfiles(repository([active, draft, retired]));
    expect(result.profiles.map(p => [p.id, p.selectionAllowed])).toEqual([["test-profile", true], ["test-profile-draft", false]]);
    expect((await getAuditProfiles(repository([]))).emptyState).toBe(true);
  });
  it("rejects malformed definitions and competing active definitions rather than choosing one", async () => {
    const malformed = profile("test-malformed", "v1", "active"); malformed.payload = { id: "test-other", version: "v1" };
    await expect(getAuditProfiles(repository([malformed]))).rejects.toThrow("Invalid database audit profile");
    await expect(getAuditProfiles(repository([profile("test-profile", "v1", "active"), profile("test-profile", "v2", "active")]))).rejects.toThrow("Competing active");
  });
});
describe("regulatory runtime scope boundaries", () => {
  it("requires an explicit audit instead of selecting the first audit or finding", async () => {
    await expect(traverseControlledRegulatoryTree("test-finding")).rejects.toThrow("Explicit auditId");
    await expect(assessControlledRemediationImpact("test-finding")).rejects.toThrow("Explicit auditId");
    await expect(getControlledRegulatoryPack(undefined, {} as never)).rejects.toThrow("auditId");
  });
  it("returns only stored snapshot catalog data and no operational fallback", async () => {
    const snapshot = { id: "test-snapshot", sourceId: "test-source" } as RegulatorySnapshot;
    const store = { list: async () => [snapshot] } as unknown as RegulatorySnapshotStore;
    const result = await getRegulatorySourceCatalog(store);
    expect(result.snapshots).toEqual([snapshot]); expect(result.humanReviewRequired).toBe(true);
  });
});
