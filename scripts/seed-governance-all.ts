import "dotenv/config";
import {
  getDomainPortfolio,
  listAudits,
  listDomainRecords,
  writeDomainRecord,
} from "../server/domain-store";

const ACTOR = "Frank · governance detail seed";

function seedsFor(audit: any, findings: any[]) {
  const auditId = String(audit.id ?? audit.auditId ?? "");
  const suffix = auditId.replace("AUD-", "");
  const primary = findings[0] ?? { id: auditId, title: "audit scope", owner: "M. Lee" };
  const secondary = findings[1] ?? primary;
  const at = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86400000).toISOString();
  const future = (daysAhead: number) =>
    new Date(Date.now() + daysAhead * 86400000).toISOString();
  const label = String(audit.title ?? auditId);
  return [
    {
      id: `GOV-${suffix}-01`,
      auditId,
      title: `Confirm Part 21 applicability for ${label}`,
      summary: `Confirm the scope anchor, governing license or approval, and qualified reviewer for ${auditId} before any reportability conclusion is recorded.`,
      state: "in_review",
      priority: "critical",
      findingId: String(primary.id ?? ""),
      skillId: "part21-applicability",
      agentId: "nuclear-applicability-screen",
      requiredFields: ["scope anchor", "applicability basis", "qualified approver"],
      completedFields: ["scope anchor"],
      owner: "M. Lee",
      lastUpdated: at(2),
      history: [
        {
          at: at(2),
          actor: "nuclear-applicability-screen",
          action: "routed",
          note: `Scope record for ${label} requires a qualified human decision.`,
          state: "in_review",
        },
      ],
    },
    {
      id: `GOV-${suffix}-02`,
      auditId,
      title: `Accept evidence sufficiency for ${primary.id}`,
      summary: `Review the source record, effective date and linkage for ${String(primary.title ?? "the primary finding").toLowerCase()}. Registration alone is not acceptance.`,
      state: "ready",
      priority: "high",
      findingId: String(primary.id ?? ""),
      skillId: "evidence-intake",
      agentId: "nuclear-evidence-curator",
      requiredFields: ["source record", "effective date", "owner", "evidence note"],
      completedFields: ["source record", "owner"],
      owner: String(primary.owner ?? "M. Lee"),
      lastUpdated: at(1),
      history: [],
    },
    {
      id: `GOV-${suffix}-03`,
      auditId,
      title: `Challenge severity and corrective action for ${secondary.id}`,
      summary: `Test the recorded severity, causal basis and proposed corrective action for ${String(secondary.title ?? "the secondary finding").toLowerCase()} before the finding is treated as dispositioned.`,
      state: "backlog",
      priority: "high",
      findingId: String(secondary.id ?? ""),
      skillId: "finding-challenge",
      agentId: "nuclear-finding-challenger",
      requiredFields: ["finding basis", "severity rationale", "corrective action"],
      completedFields: [],
      owner: String(secondary.owner ?? "Tessa Morgan"),
      lastUpdated: at(3),
      history: [],
    },
    {
      id: `GOV-${suffix}-04`,
      auditId,
      title: "Route the final readiness report to a qualified approver",
      summary: `Prepare the ${auditId} report position and route it to a named, currently qualified approver. The route does not itself approve the report.`,
      state: "deferred",
      priority: "medium",
      skillId: "readiness-close",
      agentId: "nuclear-readiness-facilitator",
      requiredFields: ["readiness position", "action list", "approver"],
      completedFields: ["readiness position", "action list", "approver"],
      deferUntil: future(3),
      deferredAt: at(1),
      deferredDurationHours: 96,
      owner: "D. Novak",
      lastUpdated: at(1),
      history: [
        {
          at: at(1),
          actor: "D. Novak",
          action: "defer",
          note: "Awaiting the evidence-sufficiency decision before routing the final report.",
          state: "deferred",
        },
      ],
    },
    {
      id: `GOV-${suffix}-05`,
      auditId,
      title: "Verify the responsible-officer contact and notice path",
      summary: `Confirm the current escalation contact and electronic Part 21 notice location used by ${auditId}.`,
      state: "complete",
      priority: "medium",
      skillId: "frame-scope",
      agentId: "nuclear-scope-facilitator",
      requiredFields: ["contact test", "approval note"],
      completedFields: ["contact test", "approval note"],
      decision: "accept",
      decisionNote: "Contact path verified against the persisted people directory.",
      owner: "M. Lee",
      lastUpdated: at(6),
      history: [
        {
          at: at(6),
          actor: "M. Lee",
          action: "accept",
          note: "Contact path verified against the persisted people directory.",
          state: "complete",
        },
      ],
    },
  ];
}

async function main() {
  const audits = await listAudits();
  const summary: Record<string, unknown> = {};
  for (const audit of audits) {
    const auditId = String(audit.id ?? audit.auditId ?? "");
    const existing = await listDomainRecords("governance", auditId);
    if (existing.length >= 5) {
      summary[auditId] = { existing: existing.length };
      continue;
    }
    const portfolio = await getDomainPortfolio(auditId);
    const created: string[] = [];
    for (const seed of seedsFor(portfolio.audit, portfolio.findings as any[])) {
      try {
        await writeDomainRecord(
          { recordType: "governance", recordId: seed.id, auditId, payload: seed },
          { expectedRevision: 0, actor: ACTOR, createOnly: true }
        );
        created.push(seed.id);
      } catch (error) {
        created.push(`${seed.id}: ${String(error)}`);
      }
    }
    summary[auditId] = { created };
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
