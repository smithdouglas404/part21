import "dotenv/config";
import { part21ClockBrief } from "../server/part21-case";
(async () => {
  const brief = await part21ClockBrief("AUD-026", { timezone: "America/New_York" });
  console.log("cases:", brief.cases.length, "| instruction:", brief.instruction.slice(0, 60));
  for (const c of brief.cases) {
    console.log("CASE", c.caseId, "| next gate:", c.nextGate?.id, "| pending:", c.pendingGateIds.join(","));
    for (const b of c.branches) console.log(`  ${b.id.padEnd(21)} ${String(b.status).padEnd(18)} due ${String(b.dueAt)} | ${b.daysRemaining}d | skills ${b.skillIds.join(",")}`);
  }
  process.exit(0);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
