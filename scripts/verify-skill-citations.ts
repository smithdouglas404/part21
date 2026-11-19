import "dotenv/config";
import { listSourceSnapshots } from "../server/regulatory-source";
import { resolveCitations } from "../server/citation-resolver";
import { nuclearPart21Skills } from "../shared/nuclear-skills";

(async () => {
  const snapshots = [...(await listSourceSnapshots("ecfr-part-21")), ...(await listSourceSnapshots("ecfr-part-50-appendix-b"))];
  console.log("snapshots:", snapshots.map(s => `${s.sourceId}@${s.sourceAsOf}(${s.provisions.length})`).join("  "));
  let total = 0, resolved = 0, unresolved: string[] = [];
  for (const skill of nuclearPart21Skills) {
    const refs = (skill as any).regulatoryRefs ?? [];
    const coverage = resolveCitations(refs, snapshots, (skill as any).externalRefs ?? []);
    total += coverage.total; resolved += coverage.resolved;
    const bad = coverage.resolutions.filter(r => r.status !== "resolved" && r.status !== "not-applicable");
    console.log(`${skill.id.padEnd(34)} ${coverage.resolved}/${coverage.total}  ${bad.length ? "UNRESOLVED: " + bad.map(b => b.reference).join(", ") : ""}`);
    unresolved.push(...bad.map(b => `${skill.id} → ${b.reference} (${b.status})`));
    const ext = coverage.resolutions.filter(r => r.status === "not-applicable").length;
    if (ext) console.log(`   ${skill.id}: ${ext} declared external`);
  }
  console.log(`\nTOTAL ${resolved}/${total} = ${total ? Math.round(resolved / total * 100) : 0}%`);
  if (unresolved.length) { console.log("unresolved refs:"); unresolved.forEach(u => console.log("  " + u)); }
  process.exit(0);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
