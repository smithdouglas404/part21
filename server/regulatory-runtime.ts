import { getControlledConfiguration } from "./config-store";

export async function getControlledRegulatoryPack() {
  return (await getControlledConfiguration<any>("regulatory_source", "10-cfr-part-21")).payload;
}

export async function traverseControlledRegulatoryTree(findingId = "") {
  const pack = await getControlledRegulatoryPack();
  const sections = pack.sections ?? [];
  return { findingId, path: [findingId || "database-finding", ...sections.slice(0, 3).map((section: any) => `§${section.id}`), "human-gate"], violationHypothesis: sections[0]?.summary ?? "Controlled Part 21 source loaded from MySQL.", risk: sections[0]?.defaultRisk ?? "Review required", impactIfNotRemediated: sections[0]?.ifUnmet ?? "Qualified review required.", remediation: pack.implementationGuidance ?? [], sources: pack.sources ?? [], source: "mysql-database-controlled-configuration", regulatoryPackVersion: pack.currentAsOf ?? pack.versionMode };
}

export async function assessControlledRemediationImpact(findingId = "") {
  const trace = await traverseControlledRegulatoryTree(findingId);
  return { findingId, risk: trace.risk, impactIfNotRemediated: trace.impactIfNotRemediated, remediation: trace.remediation.map((item: any) => item.title ?? item.summary ?? String(item)), source: trace.source, sources: trace.sources };
}
