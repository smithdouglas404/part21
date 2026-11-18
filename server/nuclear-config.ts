import { listControlledConfigurations, listControlledConfigurationPayloads, upsertControlledConfiguration } from "./config-store";
import { nuclearPart21Skills } from "../shared/nuclear-skills";

/** Research source metadata only: not downloaded text, approved requirements, or a live regulatory baseline. */
const nuclearRegulatoryOverlays = [
  { configId: "10-cfr-50-appendix-b", title: "10 CFR Part 50 Appendix B — Quality Assurance Criteria", domain: "nuclear-quality-assurance", sourceUrl: "https://www.ecfr.gov/current/title-10/chapter-I/part-50/appendix-Appendix%20B%20to%20Part%2050" },
  { configId: "10-cfr-50-7", title: "10 CFR 50.7 — Employee protection", domain: "employee-protection", sourceUrl: "https://www.ecfr.gov/current/title-10/chapter-I/part-50/section-50.7" },
  { configId: "10-cfr-73-54", title: "10 CFR 73.54 — Protection of digital computer and communication systems", domain: "nuclear-cybersecurity", sourceUrl: "https://www.ecfr.gov/current/title-10/chapter-I/part-73/section-73.54" },
  { configId: "10-cfr-810", title: "10 CFR Part 810 — Assistance to foreign atomic energy activities", domain: "nuclear-export-control", sourceUrl: "https://www.ecfr.gov/current/title-10/chapter-III/part-810" },
];

/** Explicit staging only. Candidate kinds are not consumed by runtime skills/source loaders; never call on startup. */
export async function stageNuclearControlPack() {
  const catalog = await listControlledConfigurations();
  const createdSkills: string[] = [];
  const createdOverlays: string[] = [];
  for (const skill of nuclearPart21Skills) {
    if (catalog.some((row) => row.kind === "skill_candidate" && row.configId === skill.id && row.version === skill.skillContract)) continue;
    await upsertControlledConfiguration({ kind: "skill_candidate", configId: skill.id, version: skill.skillContract, payload: skill, status: "draft" });
    createdSkills.push(skill.id);
  }
  for (const overlay of nuclearRegulatoryOverlays) {
    const version = "research-candidate-v1";
    if (catalog.some((row) => row.kind === "regulatory_source_candidate" && row.configId === overlay.configId && row.version === version)) continue;
    await upsertControlledConfiguration({ kind: "regulatory_source_candidate", configId: overlay.configId, version, payload: { ...overlay, interpretationRequired: true, sourceContentIngested: false, legalStatus: "source-link-only", note: "Separate regulatory overlay; applicability and activation require qualified human review." }, status: "draft" });
    createdOverlays.push(overlay.configId);
  }
  return { source: "mysql-controlled-configuration", createdSkills, createdOverlays, status: "draft", humanApprovalRecorded: false, automaticActivation: false, runtimeFallback: false };
}

export async function getNuclearControlPackStatus() {
  const catalog = await listControlledConfigurations();
  const activeSkills = await listControlledConfigurationPayloads<any>("skill");
  const activeOverlays = await listControlledConfigurationPayloads<any>("regulatory_source");
  return {
    source: "mysql-controlled-configuration",
    candidates: catalog.filter((row) => row.kind === "skill_candidate" || row.kind === "regulatory_source_candidate"),
    activeNuclearSkills: activeSkills.filter((row) => nuclearPart21Skills.some((skill) => skill.id === row.payload?.id)).map((row) => ({ id: row.payload.id, version: row.version, status: row.status, sourceSha256: row.sourceSha256 })),
    activeRegulatoryOverlays: activeOverlays.filter((row) => nuclearRegulatoryOverlays.some((overlay) => overlay.configId === row.configId)).map((row) => ({ id: row.configId, version: row.version, status: row.status, sourceSha256: row.sourceSha256 })),
    automaticActivation: false,
    runtimeFallback: false,
  };
}
