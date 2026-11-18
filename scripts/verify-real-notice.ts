import "dotenv/config";
import { createPool } from "mysql2/promise";
import { approvedBaseline, deadlineDependencies, discoveryEvidenceRefs } from "../server/part21-supervision";
import { createPart21Case } from "../server/deadline-store";
import { createTemporalClient, temporalConfigurationFromEnv } from "../server/temporal/client";
import { PART21_CASE_WORKFLOW_TYPE } from "../server/temporal/names";

const principal: any = { id: "admin-demo", actor: "Doug Smith (administrator)", isAdmin: true, access: "make_changes", auditIds: ["AUD-026"], auditWriteIds: ["AUD-026"], roleIds: [], qualified: false, qualifiedAuditIds: [] };
(async () => {
  const db = createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 2 });
  const caseId = `SIM-REAL-${Date.now().toString().slice(-5)}`;
  const baseline = await approvedBaseline("Clock simulation", "Simulation only.");
  const evidence = await discoveryEvidenceRefs("AUD-026");
  // 60-day evaluation clock whose due date lands ~70 seconds from now.
  const documentedAt = new Date(Date.now() - 60 * 86400000 + 70000).toISOString();
  const persisted = await createPart21Case({ caseId, auditId: "AUD-026", actor: "clock-simulation", eventId: `sim:${caseId}:create`, policy: baseline.policy, discovery: { documentedAt, discoveryDecisionId: baseline.decisionId, evidence } }, deadlineDependencies(principal));
  console.log("persisted deadline:", JSON.stringify(persisted.deadlines.map(d => ({ branch: d.branch, dueAt: d.dueAt }))));
  const config = await temporalConfigurationFromEnv();
  const { client, close } = await createTemporalClient(config);
  await client.workflow.start(PART21_CASE_WORKFLOW_TYPE, { workflowId: `sim-real:${caseId}`, taskQueue: config.taskQueue, args: [{ state: persisted }] });
  await close();
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const [rows] = await db.query<any[]>("SELECT branch, due_at, observed_at, recorded_at FROM part21_deadline_notices WHERE case_id=?", [caseId]);
    if ((rows as any[]).length) { console.log("NOTICES PERSISTED:", JSON.stringify(rows)); break; }
    console.log(`t+${(i + 1) * 10}s none yet`);
  }
  await db.end(); process.exit(0);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
