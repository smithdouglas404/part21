import { describe, expect, it, vi } from "vitest";
vi.mock("./_core/sdk", () => ({ sdk: {} }));
vi.mock("./domain-store", () => ({ getDomainRecord: vi.fn(), listDomainRecords: vi.fn(), upsertDomainRecord: vi.fn() }));
vi.mock("./event-store", () => ({ appendAssuranceEvent: vi.fn() }));
import { assertAuditPermission, requireAdministrator, requireQualifiedReviewer, type AssurancePrincipal } from "./access-control";
const base: AssurancePrincipal = { id: "test-principal", actor: "Test Person", roleIds: ["auditor"], auditIds: ["audit-a"], auditWriteIds: ["audit-a"], qualifiedAuditIds: [], access: "make_changes", isAdmin: false, qualified: false };
describe("common assurance authorization", () => {
  it("rejects missing audit and cross-audit requests", () => { expect(() => assertAuditPermission(base, "")).toThrow("explicit auditId"); expect(() => assertAuditPermission(base, "audit-b")).toThrow("audit scope"); });
  it("rejects persisted dialogue and attachment writes by look-only principals", () => { expect(() => assertAuditPermission({ ...base, access: "look_only" }, "audit-a", true)).toThrow("look-only"); });
  it("does not turn a read-only audit grant into a write grant", () => { expect(() => assertAuditPermission({ ...base, auditWriteIds: [] }, "audit-a", true)).toThrow("make-changes grant"); });
  it("does not treat a persona or administrator as a qualified reviewer", () => { expect(() => requireAdministrator(base)).toThrow("persona"); expect(() => requireQualifiedReviewer({ ...base, isAdmin: true }, "audit-a")).toThrow("qualification"); });
  it("rejects a qualification valid for a different audit", () => { expect(() => requireQualifiedReviewer({ ...base, qualified: true, personId: "actual-person", qualificationEvidenceId: "actual-proof", qualifiedAuditIds: ["audit-b"] }, "audit-a")).toThrow("does not cover"); });
  it("allows an explicitly scoped qualified identity", () => { expect(() => requireQualifiedReviewer({ ...base, qualified: true, personId: "actual-person", qualificationEvidenceId: "actual-proof", qualifiedAuditIds: ["audit-a"] }, "audit-a")).not.toThrow(); });
});
