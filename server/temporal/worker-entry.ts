import { applyDeadlineSchemaMigration } from "../deadline-store";
import { startTemporalWorker, temporalWorkerOptionsFromEnv } from "./worker";

async function main(): Promise<void> {
  const options = await temporalWorkerOptionsFromEnv();
  // Explicit, additive, opt-in migration. Never runs unless the operator asks for it.
  if (process.env.TEMPORAL_APPLY_MIGRATION === "true") await applyDeadlineSchemaMigration(options.deps);
  try {
    const handle = await startTemporalWorker(options);
    console.info("[part21-temporal] worker started; host restart/monitoring required", { namespace: options.config.namespace, taskQueue: options.config.taskQueue, buildId: options.buildId });
    await handle.runPromise;
  } finally { await options.deps.pool.end(); }
}
main().catch(error => { console.error("[part21-temporal] worker failed", error); process.exitCode = 1; });
