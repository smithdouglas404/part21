import "dotenv/config";
import { createPool } from "mysql2/promise";
import { approvedBaseline, deadlineDependencies, discoveryEvidenceRefs, supervisePart21Case, supervisionStatus } from "../server/part21-supervision";
import { getPart21Case } from "../server/part21-case";
import { createPart21Case } from "../server/deadline-store";
import { createTemporalClient, temporalConfigurationFromEnv } from "../server/temporal/client";
import { PART21_CASE_WORKFLOW_TYPE } from "../server/temporal/names";

const principal: any = { id: "admin-demo", actor: "Doug Smith (administrator)", isAdmin: true, access: "make_changes", auditIds: ["AUD-026"], auditWriteIds: ["AUD-026"], roleIds: [], qualified: false, qualifiedAuditIds: [] };

(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
  const view: any = await getPart21Case("AUD-026", "P21-2026-001", principal, undefined as any);
  const bound = await supervisePart21Case(view, principal, "Baseline approved by administrator at supervision.");
  console.log("REAL CASE ->", JSON.stringify(bound));

  // Short-horizon simulation on a separate case to prove notices are persisted by the worker.
  const simId = `SIM-ADP-${Date.now().toString().slice(-5)}`;
  const baseline = await approvedBaseline("Clock simulation", "Simulation only.");
  const evidence = await discoveryEvidenceRefs("AUD-026");
  const persisted = await createPart21Case({ caseId: simId, auditId: "AUD-026", actor: "clock-simulation", eventId: `sim:${simId}:create`, policy: baseline.policy, discovery: { documentedAt: new Date().toISOString(), discoveryDecisionId: baseline.decisionId, evidence } }, deadlineDependencies(principal));
  const due = new Date(Date.now() + 45000).toISOString();
  const state = { ...persisted, policy: { ...baseline.policy, reminderLeadMilliseconds: [15000] }, deadlines: [{ branch: "evaluation", triggerAt: new Date().toISOString(), dueAt: due, localDue: due, explanation: "Simulated 60-day evaluation", policyId: baseline.policy.id, policyVersion: baseline.policy.version, calendarId: baseline.calendar.id, calendarVersion: baseline.calendar.version, sourceIds: [], status: "pending", applicability: "required" }] };
  const config = await temporalConfigurationFromEnv();
  const { client, close } = await createTemporalClient(config);
  await client.workflow.start(PART21_CASE_WORKFLOW_TYPE, { workflowId: `sim-adapter:${simId}`, taskQueue: config.taskQueue, args: [{ state }] });
  await close();
  console.log("SIM started:", simId, "due", due);
  for (let i = 0; i < 9; i++) {
    await new Promise(r => setTimeout(r, 15000));
    const [rows] = await db.query<any[]>("SELECT branch, kind, observed_at FROM part21_deadline_notices WHERE case_id=?", [simId]);
    if ((rows as any[]).length) { console.log("NOTICES:", JSON.stringify(rows)); break; }
  }
  await db.end(); process.exit(0);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
