export type ConfigurationCatalogEntry = {
  kind: string;
  configId: string;
  version: string;
  status: "active" | "draft" | "retired";
};

export function selectActiveConfigurationEntries(entries: ConfigurationCatalogEntry[], kind: string) {
  const selected = new Map<string, ConfigurationCatalogEntry>();
  for (const entry of entries) {
    if (entry.kind !== kind || entry.status !== "active") continue;
    const previous = selected.get(entry.configId);
    if (previous && previous.version !== entry.version) {
      throw new Error(`Ambiguous active configuration: ${kind}/${entry.configId}`);
    }
    selected.set(entry.configId, entry);
  }
  return [...selected.values()];
}
