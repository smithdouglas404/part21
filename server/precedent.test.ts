import { describe, expect, it } from "vitest";
import { narrativeShape } from "./ai";
import { precedentTerms } from "./precedent";

describe("narrative requirement", () => {
  it("rejects a one-line answer even when it is factually correct", () => {
    const shape = narrativeShape("F-042 is a Major finding owned by M. Lee.");
    expect(shape.compliant).toBe(false);
    expect(shape.paragraphs).toBe(1);
  });

  it("rejects a bulleted answer regardless of length", () => {
    const bullets = [
      "The record shows a Major finding in AUD-026 with an unresolved heat-lot chain and a review-due evidence item.",
      "- F-042 is Major",
      "- EV-803 is review due",
      "- CHG-014 is in review",
      "Prior audits contain no comparable finding, so the precedent is unknown rather than exculpatory.",
      "The recommendation is to resolve the heat-lot chain before closing the finding and to record the accountable lead decision.",
    ].join("\n\n");
    const shape = narrativeShape(bullets);
    expect(shape.bulletLines).toBeGreaterThan(0);
    expect(shape.compliant).toBe(false);
  });

  it("accepts three connected paragraphs of substance", () => {
    const paragraph = (subject: string) => `${subject} The record names F-042, EV-803, CHG-014 and NSS-4820, and it distinguishes what is stored in the database from what is merely asserted by a participant, so the reader can follow the chain from finding to evidence to decision without inferring any fact that the database does not actually hold. It also states which evidence is review-due, which change is still in review, and which conclusion remains unknown pending the accountable lead's decision, because a recommendation that hides its own uncertainty cannot be audited later.`;
    const text = [paragraph("First,"), paragraph("Second,"), paragraph("Third,")].join("\n\n");
    const shape = narrativeShape(text);
    expect(shape.paragraphs).toBe(3);
    expect(shape.words).toBeGreaterThanOrEqual(140);
    expect(shape.compliant).toBe(true);
  });
});

describe("precedent terms", () => {
  it("drops stopwords and short tokens but keeps domain terms", () => {
    const terms = precedentTerms("Receiving inspection cannot resolve the heat-lot chain for audit records");
    expect(terms).toContain("receiving");
    expect(terms).toContain("inspection");
    expect(terms).toContain("heat-lot");
    expect(terms).not.toContain("audit");
    expect(terms).not.toContain("records");
    expect(terms).not.toContain("the");
  });

  it("is deterministic and bounded", () => {
    const input = Array.from({ length: 80 }, (_, index) => `term${index}`).join(" ");
    const terms = precedentTerms(input);
    expect(terms.length).toBeLessThanOrEqual(24);
    expect(terms).toEqual(precedentTerms(input));
  });
});
