import "dotenv/config";
import { answerLiveGroundedQuestion } from "../server/ai";
import { listAuditAlerts, raiseAuditAlerts } from "../server/alerts";

/**
 * Live task battery: the questions an auditor and an audit leader actually ask, run against the
 * database and the live model. Every task is graded on evidence, not on prose quality alone:
 * the model must be invoked, the skill must be governed, the answer must be narrative prose,
 * the precedent traversal must be attached, and alerts must be persisted.
 */

const auditId = process.argv[2] ?? "AUD-026";
const principal = {
  id: "battery-auditor", actor: "Battery Auditor",
  auditIds: [auditId], auditWriteIds: [auditId], access: "make_changes" as const,
  isAdmin: false, roleIds: [], qualified: false,
};

type Task = { persona: "auditor" | "leader"; skillId: string; findingId: string; question: string; expectAlert: boolean };

const tasks: Task[] = [
  { persona: "auditor", skillId: "finding-challenge", findingId: "F-042", question: "What does the record show for F-042, what have past audits seen, and what should I do next?", expectAlert: true },
  { persona: "auditor", skillId: "evidence-intake", findingId: "F-039", question: "Which evidence is missing or awaiting review for F-039, and what would make it acceptable?", expectAlert: true },
  { persona: "auditor", skillId: "trace-chain", findingId: "F-042", question: "Trace the heat-lot chain for NSS-4820 and tell me exactly where it breaks.", expectAlert: true },
  { persona: "leader", skillId: "frame-scope", findingId: "F-036", question: "As the accountable audit lead, where is this audit exposed and what decision do I need to make this week?", expectAlert: true },
  { persona: "leader", skillId: "readiness-close", findingId: "F-039", question: "Can this audit be closed, and if not, what specifically is blocking closure?", expectAlert: true },
];

(async () => {
  const results: any[] = [];
  for (const task of tasks) {
    const started = Date.now();
    try {
      const result: any = await answerLiveGroundedQuestion(task.question, auditId, task.findingId, { principal, skillId: task.skillId });
      const shape = result.narrative ?? { words: 0, paragraphs: 0, compliant: false };
      const alerts = Array.isArray(result.alerts) ? result.alerts : [];
      const checks = {
        llmInvoked: result.llmInvoked === true,
        narrativeCompliant: shape.compliant === true,
        precedentAttached: !!result.precedentTraversal,
        alertsRaised: alerts.length > 0,
        skillGoverned: !!result.skillRevision,
      };
      results.push({ ...task, ms: Date.now() - started, model: result.model, words: shape.words, paragraphs: shape.paragraphs, alerts: alerts.map((a: any) => `${a.severity}:${a.code}`), checks, pass: Object.values(checks).every(Boolean), excerpt: String(result.answer ?? "").slice(0, 200) });
    } catch (error) {
      results.push({ ...task, ms: Date.now() - started, pass: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const raised = await raiseAuditAlerts(auditId, "F-042");
  const open = await listAuditAlerts(auditId);

  console.log("=== TASK BATTERY ===");
  for (const row of results) {
    console.log(`${row.pass ? "PASS" : "FAIL"}  ${row.persona.padEnd(7)} ${row.skillId.padEnd(18)} ${row.findingId}  words=${row.words ?? "-"} paras=${row.paragraphs ?? "-"} alerts=${row.alerts?.length ?? 0} ${row.error ? `error=${row.error}` : ""}`);
    console.log(`      checks=${JSON.stringify(row.checks ?? {})}`);
  }
  console.log(`\npass ${results.filter(r => r.pass).length}/${results.length}`);
  console.log(`alerts raised now: inserted=${raised.inserted} existing=${raised.existing}; open alerts for ${auditId}=${open.filter(a => a.status === "open").length}`);
  console.log(JSON.stringify({ auditId, generatedAt: new Date().toISOString(), results, alertCodes: [...new Set(open.map(a => a.code))] }, null, 2));
  process.exit(results.every(r => r.pass) ? 0 : 1);
})().catch(error => { console.error("BATTERY FAILED:", error instanceof Error ? error.message : error); process.exit(1); });
