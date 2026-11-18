import "dotenv/config";
import { createPool } from "mysql2/promise";
import { approvedBaseline, discoveryEvidenceRefs } from "../server/part21-supervision";
import { createPart21Case } from "../server/deadline-store";
import { createTemporalClient, temporalConfigurationFromEnv } from "../server/temporal/client";
import { PART21_CASE_WORKFLOW_TYPE } from "../server/temporal/names";

const CASE_ID = `SIM-CLOCK-${Date.now().toString().slice(-5)}`;
(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
  const [tables] = await db.query<any[]>("SELECT table_name t FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE '%notice%'");
  console.log("notice tables:", tables.map((r: any) => r.t).join(", ") || "(none)");
  const baseline = await approvedBaseline("Clock simulation", "Simulation harness; not a compliance approval.");
  const now = Date.now();
  const mk = (branch: any, offsetMs: number) => {
    const due = new Date(now + offsetMs).toISOString();
    return { branch, triggerAt: new Date(now).toISOString(), dueAt: due, localDue: due, explanation: `Simulated ${branch} deadline`, policyId: baseline.policy.id, policyVersion: baseline.policy.version, calendarId: baseline.calendar.id, calendarVersion: baseline.calendar.version, sourceIds: [], status: "pending", applicability: "required" } as any;
  };
  const state = {
    caseId: CASE_ID, auditId: "AUD-026", actor: "clock-simulation", version: 0,
    policy: { ...baseline.policy, reminderLeadMilliseconds: [45000, 20000] },
    discovery: { documentedAt: new Date(now).toISOString(), discoveryDecisionId: baseline.decisionId, evidence: await discoveryEvidenceRefs("AUD-026") },
    deadlines: [mk("evaluation", 120000), mk("nrc-initial", 60000)], transmissions: [], closed: false, holds: [],
  };
  await createPart21Case({ caseId: CASE_ID, auditId: "AUD-026", actor: "clock-simulation", eventId: `sim:${CASE_ID}:create`, policy: state.policy as any, discovery: state.discovery as any }, { pool: db as any }).catch((e: any) => console.log("case persist:", e.message));
  const config = await temporalConfigurationFromEnv();
  const { client, close } = await createTemporalClient(config);
  const handle = await client.workflow.start(PART21_CASE_WORKFLOW_TYPE, { workflowId: `sim-clock:${CASE_ID}`, taskQueue: config.taskQueue, args: [{ state }] });
  console.log("workflow started:", handle.workflowId, "| run:", handle.firstExecutionRunId);
  await close();
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 15000));
    const [rows] = await db.query<any[]>("SELECT branch, kind, due_at, observed_at FROM part21_deadline_notices WHERE case_id=? ORDER BY observed_at", [CASE_ID]).catch(() => [[]] as any);
    if (Array.isArray(rows) && rows.length) {
      console.log(`t+${(i + 1) * 15}s notices:`);
      for (const r of rows) console.log("  ", r.branch, r.kind, new Date(r.due_at).toISOString(), "observed", new Date(r.observed_at).toISOString());
      if (rows.length >= 2) break;
    }
  }
  await db.end(); process.exit(0);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
