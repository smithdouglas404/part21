import { describe, expect, it } from "vitest";
import { regulatoryGraphStatus, assertRegulatoryProjectionAllowed, regulationNodeId } from "./regulatory-graph";
import type { ControlledOntology } from "./ontology-store";

function ontology(relations: any[], classes = ["Finding", "Regulation"]): ControlledOntology {
  return {
    kind: "ontology", configId: "part21-assurance-ontology", version: "test", sourceSha256: "a".repeat(64),
    status: "active", approvedBy: "reviewer", approvedAt: "2026-11-01T00:00:00.000Z",
    payload: { version: "test", classes: classes.map(id => ({ id })), relations },
  } as unknown as ControlledOntology;
}

describe("regulatory graph gate", () => {
  it("blocks projection when the ontology has no citation relation", () => {
    const status = regulatoryGraphStatus(ontology([{ id: "about", from: "Finding", to: "Product" }]));
    expect(status.regulationClass).toBe(true);
    expect(status.citationRelation).toBeNull();
    expect(status.canProject).toBe(false);
    expect(() => assertRegulatoryProjectionAllowed(ontology([]))).toThrow(/governed ontology revision is required/);
  });
  it("blocks projection when the Regulation class is absent", () => {
    const status = regulatoryGraphStatus(ontology([{ id: "cites", from: "Finding", to: "Regulation" }], ["Finding"]));
    expect(status.regulationClass).toBe(false);
    expect(status.canProject).toBe(false);
  });
  it("permits projection when both class and relation are declared", () => {
    const active = ontology([{ id: "cites", from: "Finding", to: "Regulation" }]);
    expect(regulatoryGraphStatus(active)).toMatchObject({ regulationClass: true, citationRelation: "cites", canProject: true });
    expect(assertRegulatoryProjectionAllowed(active).citationRelation).toBe("cites");
  });
  it("names regulation nodes deterministically", () => {
    expect(regulationNodeId("s21", "10-cfr:part-21:21.21:a:1")).toBe("regulation:s21:10-cfr:part-21:21.21:a:1");
  });
});
