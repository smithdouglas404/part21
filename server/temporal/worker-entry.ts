import { startTemporalWorker, temporalWorkerOptionsFromEnv } from "./worker";

async function main(): Promise<void> {
  const options = await temporalWorkerOptionsFromEnv();
  try {
    const handle = await startTemporalWorker(options);
    console.info("[part21-temporal] worker started; host restart/monitoring required", { namespace: options.config.namespace, taskQueue: options.config.taskQueue, buildId: options.buildId });
    await handle.runPromise;
  } finally { await options.deps.pool.end(); }
}
main().catch(error => { console.error("[part21-temporal] worker failed", error); process.exitCode = 1; });
