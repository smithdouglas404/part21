import { describe, expect, it } from "vitest";
import { buildPolicyGraph, evaluatePart21Policy, part21PolicyPack } from "../shared/policy";
import { part21RegulatoryPack } from "../shared/regulatory";

describe("Part 21 policy as code", () => {
  it("maps every indexed regulatory section to at least one executable rule", () => {
    const citations = part21PolicyPack.rules.map((rule) => rule.sourceSectionId);
    for (const section of part21RegulatoryPack.sections) expect(citations).toContain(section.id);
  });

  it("returns versioned, source-linked evaluation results with human gates", () => {
    const result = evaluatePart21Policy("FIND-2026-04", "2026-11-17");
    expect(result.counts.total).toBe(part21PolicyPack.rules.length);
    expect(result.policyVersion).toBe(part21PolicyPack.policyVersion);
    expect(result.results.every((item) => item.provenance.sourceUri === part21PolicyPack.sourceUri)).toBe(true);
    expect(result.results.every((item) => item.rule.humanGate.length > 0)).toBe(true);
  });

  it("builds document-to-rule-to-agent-to-human-gate graph edges", () => {
    const graph = buildPolicyGraph();
    expect(graph.nodes.some((node) => node.type === "policy_document")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "policy_rule")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "human_gate")).toBe(true);
    expect(graph.edges.some((edge) => edge.type === "defines")).toBe(true);
    expect(graph.edges.some((edge) => edge.type === "evaluates")).toBe(true);
    expect(graph.edges.some((edge) => edge.type === "requires")).toBe(true);
  });
});
