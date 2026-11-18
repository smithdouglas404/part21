import { describe, expect, it } from "vitest";
import { selectActiveConfigurationEntries, type ConfigurationCatalogEntry } from "../shared/configuration-selection";

const entry = (configId: string, status: ConfigurationCatalogEntry["status"], version = "v1"): ConfigurationCatalogEntry => ({ kind: "skill", configId, status, version });

describe("controlled runtime configuration selection", () => {
  it("does not load draft-only or retired skills", () => {
    expect(selectActiveConfigurationEntries([entry("core", "active"), entry("nuclear", "draft"), entry("old", "retired")], "skill")).toEqual([entry("core", "active")]);
  });
  it("retains the exact active revision when a proposed revision is draft", () => {
    expect(selectActiveConfigurationEntries([entry("core", "active"), entry("core", "draft", "v2")], "skill")[0].version).toBe("v1");
  });
  it("rejects conflicting active revisions", () => {
    expect(() => selectActiveConfigurationEntries([entry("core", "active"), entry("core", "active", "v2")], "skill")).toThrow("Ambiguous active configuration");
  });
  it("deduplicates identical catalog entries and keeps kinds separate", () => {
    expect(selectActiveConfigurationEntries([entry("core", "active"), entry("core", "active"), { ...entry("other", "active"), kind: "persona" }], "skill")).toHaveLength(1);
  });
});
