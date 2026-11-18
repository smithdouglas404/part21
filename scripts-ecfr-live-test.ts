import "dotenv/config";
import { ingestEcfrSource, type RegulatorySnapshotStore } from "./server/regulatory-source";
const snapshots = new Map<string, any>(); const originals = new Map<string, Buffer>();
const store: RegulatorySnapshotStore = {
  async insert(s, raw) { snapshots.set(s.id, s); for (const o of s.originals) { const r = raw.find(x => x.kind === o.kind); if (r) originals.set(o.id, r.bytes); } },
  async get(id) { return snapshots.get(id) ?? null; },
  async list() { return [...snapshots.values()]; },
  async getOriginal(id) { const b = originals.get(id); if (!b) throw new Error("missing"); return b; },
};
(async () => {
  const started = Date.now();
  const snap = await ingestEcfrSource({ sourceId: "ecfr-part-21", regulationSet: "10-cfr-part-21", sourceAsOf: "2026-11-09" }, { store, fetch: globalThis.fetch, now: () => new Date().toISOString(), newId: () => `SNAP-${Math.random().toString(36).slice(2)}` });
  console.log("OK", JSON.stringify({ id: snap.id, sourceAsOf: snap.sourceAsOf, amended: snap.latestAmendedOn, upToDate: snap.providerUpToDateAsOf, provisions: snap.provisions.length, sections: snap.provisions.filter(p => p.kind === "section").length, paragraphs: snap.provisions.filter(p => p.kind === "paragraph").length, unresolved: snap.provisions.filter(p => p.anchorStatus === "unresolved").length, ms: Date.now() - started }, null, 1));
  for (const p of snap.provisions.filter(p => p.kind === "section")) console.log(p.citation, "|", p.heading);
  const s2151 = snap.provisions.find(p => p.id === "10-cfr:21.51");
  console.log("\n21.51 text starts:", s2151?.text.slice(0, 260));
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
