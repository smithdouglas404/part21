import { selectActiveConfigurationEntries, type ConfigurationCatalogEntry } from "@shared/configuration-selection";

export let assurancePersonas: any[] = [];
export let auditSkills: any[] = [];
export let auditPhases: any[] = [];
export let agentKitAgents: any[] = [];
export let mcpConnectors: any[] = [];
export let part21Ontology: any = null;
export let part21PolicyPack: any = null;
export let part21RegulatoryPack: any = null;
export let regulatoryTraceForFinding: any = { path: [], violationHypothesis: "", risk: "", impactIfNotRemediated: "", remediation: [] };

let loaded = false;
let loading: Promise<void> | null = null;

async function payload(kind: string, configId: string, version?: string) {
  const suffix = version ? `?version=${encodeURIComponent(version)}` : "";
  const response = await fetch(`/api/configuration/${kind}/${encodeURIComponent(configId)}${suffix}`);
  if (!response.ok) throw new Error(`Controlled configuration unavailable: ${kind}/${configId}`);
  return (await response.json()).payload;
}

export async function loadControlledConfiguration() {
  if (loaded) return;
  if (loading) return loading;
  loading = (async () => {
    const catalog = await fetch("/api/configuration/catalog").then((response) => {
      if (!response.ok) throw new Error("Controlled configuration catalog unavailable");
      return response.json();
    });
    const records = catalog.configurations as ConfigurationCatalogEntry[];
    const readMany = async (kind: string) => Promise.all(selectActiveConfigurationEntries(records, kind).map((record) => payload(record.kind, record.configId, record.version)));
    [assurancePersonas, agentKitAgents, mcpConnectors, auditSkills] = await Promise.all([readMany("persona"), readMany("agent_route"), readMany("connector"), readMany("skill")]);
    auditPhases = auditSkills.find((item) => item.id === "audit-phases") ?? [];
    auditSkills = auditSkills.filter((item) => item.id !== "audit-phases");
    [part21Ontology, part21PolicyPack, part21RegulatoryPack] = await Promise.all([payload("ontology", "part21-assurance-ontology"), payload("policy", "part21-policy-as-code"), payload("regulatory_source", "10-cfr-part-21")]);
    const firstSection = part21RegulatoryPack.sections?.[0];
    regulatoryTraceForFinding = { path: ["Database finding", ...(part21RegulatoryPack.sections ?? []).slice(0, 3).map((section: any) => `§${section.id}`), "Human gate"], violationHypothesis: firstSection?.summary ?? "Controlled regulatory source loaded from MySQL.", risk: firstSection?.defaultRisk ?? "Review required", impactIfNotRemediated: firstSection?.ifUnmet ?? "Qualified review required.", remediation: part21RegulatoryPack.implementationGuidance?.map((item: any) => item.title ?? item.summary ?? String(item)) ?? [] };
    loaded = true;
  })();
  try { await loading; }
  catch (error) { loading = null; throw error; }
}

export function controlledConfigurationLoaded() { return loaded; }
