import { describe, expect, it } from "vitest";
import { RBAC_AREAS, assertPermissionList, isPermission, permissionCatalog, permissionGranted } from "./rbac";

describe("RBAC permission catalog", () => {
  it("publishes a unique area and action catalog", () => {
    const ids = RBAC_AREAS.map(area => area.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const area of RBAC_AREAS) {
      expect(area.actions.length).toBeGreaterThan(0);
      expect(new Set(area.actions).size).toBe(area.actions.length);
    }
    expect(permissionCatalog().all).toContain("reports.approve");
    expect(permissionCatalog().all).toContain("kanban.write");
  });

  it("accepts only permissions that exist in the catalog", () => {
    expect(isPermission("audit.read")).toBe(true);
    expect(isPermission("reports.approve")).toBe(true);
    expect(isPermission("*")).toBe(true);
    expect(isPermission("audit.destroy")).toBe(false);
    expect(isPermission("unknown.read")).toBe(false);
  });

  it("rejects an empty or unknown permission list", () => {
    expect(() => assertPermissionList([])).toThrow(/At least one area permission/);
    expect(() => assertPermissionList(["audit.read", "audit.destroy"])).toThrow(/Unknown permission/);
    expect(assertPermissionList(["audit.read", "audit.read", "kanban.write"])).toEqual(["audit.read", "kanban.write"]);
  });

  it("matches wildcard, area wildcard and exact permissions", () => {
    expect(permissionGranted(["*"], "reports", "approve")).toBe(true);
    expect(permissionGranted(["reports.*"], "reports", "approve")).toBe(true);
    expect(permissionGranted(["reports.read"], "reports", "approve")).toBe(false);
    expect(permissionGranted(["reports.read", "reports.approve"], "reports", "approve")).toBe(true);
  });
});
