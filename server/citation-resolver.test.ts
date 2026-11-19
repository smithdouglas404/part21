import { describe, expect, it } from "vitest";
import { parseCitation, resolveCitation, resolveCitations, assertSkillCitationsResolvable } from "./citation-resolver";
import type { RegulatorySnapshot } from "../shared/regulatory";

function snapshot(id: string, sourceId: string, provisions: any[]): RegulatorySnapshot {
  return {
    id, sourceId, sourceKind: "regulation", regulationSet: null, sourceAsOf: "2026-11-09",
    latestAmendedOn: null, latestIssueDate: null, providerUpToDateAsOf: null, retrievedAt: "2026-11-10T00:00:00.000Z",
    importInProgress: null, originals: [], provisions, parserVersion: "test",
    status: "ingested-human-review-required", legalStatus: "unofficial-ecfr-compilation",
    license: { status: "government-regulatory-text", approvalId: null, basis: "test" }, warnings: [],
  } as unknown as RegulatorySnapshot;
}

const part21 = snapshot("s21", "ecfr-part-21", [
  { id: "10-cfr:part-21:21.21", kind: "section", heading: "§ 21.21 Notification of failure to comply", text: "Full section text." },
  { id: "10-cfr:part-21:21.21:a", kind: "paragraph", paragraphLabel: "a", heading: "§ 21.21(a)", text: "Evaluate." },
  { id: "10-cfr:part-21:21.21:a:1", kind: "paragraph", paragraphLabel: "a)(1", heading: "§ 21.21(a)(1)", text: "Evaluate each failure." },
  { id: "10-cfr:part-21:21.61", kind: "section", heading: "§ 21.61 Immediate notification", text: "Notify within two days." },
]);
const appB = snapshot("s50", "ecfr-part-50-appendix-b", [
  { id: "10-cfr:part-50:appendix-b:VII", kind: "criterion", heading: "VII. Control of Purchased Material", text: "Criterion VII text." },
  { id: "10-cfr:part-50:appendix-b:XVII", kind: "criterion", heading: "XVII. Quality Assurance Records", text: "Criterion XVII text." },
]);
const snapshots = [part21, appB];

describe("citation parsing", () => {
  it("extracts section and paragraph path", () => {
    expect(parseCitation("10 CFR 21.21(a)(1)")).toMatchObject({ family: "part21", section: "21.21", paragraphPath: ["a", "1"] });
  });
  it("extracts an Appendix B criterion", () => {
    expect(parseCitation("10 CFR 50 Appendix B Criterion VII")).toMatchObject({ family: "appendix-b", criterion: "vii" });
  });
});

describe("citation resolution", () => {
  it("resolves a specific paragraph to the deepest provision", () => {
    const result = resolveCitation("10 CFR 21.21(a)(1)", snapshots);
    expect(result.status).toBe("resolved");
    expect(result.provisionId).toBe("10-cfr:part-21:21.21:a:1");
  });
  it("resolves an Appendix B criterion by roman numeral", () => {
    const result = resolveCitation("10 CFR 50 Appendix B Criterion XVII", snapshots);
    expect(result.status).toBe("resolved");
    expect(result.provisionId).toBe("10-cfr:part-50:appendix-b:XVII");
  });
  it("refuses a paragraph that does not exist", () => {
    const result = resolveCitation("10 CFR 21.21(a)(9)", snapshots);
    expect(result.status).toBe("unresolved");
  });
  it("refuses a reference outside the ingested set unless it is declared external", () => {
    expect(resolveCitation("10 CFR 50.7", snapshots).status).toBe("unresolved");
    const coverage = resolveCitations(["10 CFR 50.7"], snapshots, [{ reference: "10 CFR 50.7", basis: "outside ingested set" }]);
    expect(coverage.resolutions[0].status).toBe("not-applicable");
  });
});

describe("skill activation gate", () => {
  it("blocks activation when a citation does not resolve", () => {
    expect(() => assertSkillCitationsResolvable("bad-skill", ["10 CFR 21.21(a)(9)"], snapshots)).toThrow(/cannot be activated/);
  });
  it("permits activation when every citation resolves or is declared external", () => {
    const coverage = assertSkillCitationsResolvable("good-skill", ["10 CFR 21.21(a)(1)", "10 CFR 50.7"], snapshots, [{ reference: "10 CFR 50.7", basis: "outside ingested set" }]);
    expect(coverage.resolved).toBe(1);
    expect(coverage.notApplicable).toBe(1);
  });
});
