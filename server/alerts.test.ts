import { describe, expect, it } from "vitest";
import { deriveAlerts } from "./alerts";

const now = "2026-11-20T12:00:00.000Z";

describe("alert rules", () => {
  it("raises a high alert for an open major finding and names its records", () => {
    const alerts = deriveAlerts({
      auditId: "AUD-026", now,
      findings: [{ id: "F-042", title: "Receiving inspection cannot resolve heat-lot chain", severity: "Major", status: "In remediation", owner: "M. Lee" }],
      evidence: [],
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ code: "finding-open-major", severity: "high", findingId: "F-042" });
    expect(alerts[0].sourceIds).toContain("F-042");
    expect(alerts[0].narrative.length).toBeGreaterThan(120);
  });

  it("does not alert on a closed finding", () => {
    const alerts = deriveAlerts({ auditId: "AUD-026", now, findings: [{ id: "F-001", severity: "Major", status: "Closed" }], evidence: [] });
    expect(alerts).toHaveLength(0);
  });

  it("raises evidence review and unapproved change alerts", () => {
    const alerts = deriveAlerts({
      auditId: "AUD-026", now, findings: [],
      evidence: [{ id: "EV-803", status: "Review due", confidence: 0.71 }],
      changes: [{ id: "CHG-014", status: "Review", title: "Heat-lot substitution" }],
    });
    expect(alerts.map(alert => alert.code).sort()).toEqual(["change-unapproved", "evidence-review-due"]);
    expect(alerts.every(alert => alert.status === "open")).toBe(true);
  });

  it("raises a coverage-gap alert that quotes the precedent statement", () => {
    const alerts = deriveAlerts({
      auditId: "AUD-026", now, findings: [], evidence: [],
      precedent: {
        basis: "database: part21_domain_records",
        scope: { auditId: "AUD-026", findingId: "F-042", terms: ["inspection"] },
        comparableFindings: [], relatedAudits: [{ auditId: "AUD-008", auditTitle: "Field records and inspection evidence", findingCount: 0, matchedOn: ["audit title shares \"inspection\""], score: 2 }],
        coverageGap: true,
        coverageStatement: "No comparable finding exists in any other audit.",
        limitations: [],
      },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ code: "precedent-coverage-gap", severity: "low" });
    expect(alerts[0].narrative).toContain("No comparable finding exists");
    expect(alerts[0].sourceIds).toContain("AUD-008");
  });

  it("produces stable ids so re-evaluation cannot duplicate an alert", () => {
    const input = { auditId: "AUD-026", now, findings: [{ id: "F-042", severity: "Major", status: "Open" }], evidence: [] };
    expect(deriveAlerts(input)[0].id).toBe(deriveAlerts(input)[0].id);
  });
});
