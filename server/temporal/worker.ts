import { createServer, type Server } from "node:http";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createDeadlineDatabasePool, dispatchDeadlineOutbox, ensureDeadlineStore, type DeadlineStoreDependencies } from "../deadline-store";
import { createDeadlineActivities } from "./activities";
import { createTemporalClient, createTemporalOutboxTransport, temporalConfigurationFromEnv, type TemporalConfiguration } from "./client";
import type { DeadlineActivities } from "./contracts";
export type TemporalWorkerOptions = {
  config: TemporalConfiguration; deps: DeadlineStoreDependencies; workflowBundlePath: string;
  healthPort: number; healthHost: string; dispatchIntervalMilliseconds: number; healthStaleMilliseconds: number;
  deploymentName: string; buildId: string; useWorkerVersioning: boolean;
  activities?: DeadlineActivities;
};
export type TemporalWorkerHealth = { ready: boolean; workerState: string; namespace: string; taskQueue: string; lastOutboxSuccessAt: string | null; lastOutboxError: string | null; nrcTransmissionMode: "human-recorded-evidence-only" };
export type TemporalWorkerHandle = { worker: Worker; runPromise: Promise<void>; shutdown: () => Promise<void>; health: () => TemporalWorkerHealth };
function number(env: NodeJS.ProcessEnv, key: string, minimum: number): number {
  const value = Number(env[key]); if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${key} must be explicitly configured >= ${minimum}`); return value;
}
export async function temporalWorkerOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<TemporalWorkerOptions> {
  const config = await temporalConfigurationFromEnv(env);
  for (const key of ["TEMPORAL_WORKFLOW_BUNDLE_PATH", "TEMPORAL_HEALTH_HOST", "TEMPORAL_DEPLOYMENT_NAME", "TEMPORAL_BUILD_ID"] as const) if (!env[key]?.trim()) throw new Error(`${key} is required`);
  if (!["true", "false"].includes(env.TEMPORAL_USE_WORKER_VERSIONING ?? "")) throw new Error("TEMPORAL_USE_WORKER_VERSIONING must be explicitly true or false");
  const healthPort = number(env, "TEMPORAL_HEALTH_PORT", 1024); if (healthPort > 65535) throw new Error("Invalid Temporal health port");
  return { config, deps: { pool: createDeadlineDatabasePool(env) }, workflowBundlePath: env.TEMPORAL_WORKFLOW_BUNDLE_PATH!, healthPort, healthHost: env.TEMPORAL_HEALTH_HOST!, dispatchIntervalMilliseconds: number(env, "TEMPORAL_OUTBOX_INTERVAL_MS", 100), healthStaleMilliseconds: number(env, "TEMPORAL_HEALTH_STALE_MS", 1000), deploymentName: env.TEMPORAL_DEPLOYMENT_NAME!, buildId: env.TEMPORAL_BUILD_ID!, useWorkerVersioning: env.TEMPORAL_USE_WORKER_VERSIONING === "true" };
}
/** Starts a worker process; host/operator owns persistence, monitoring, TLS and restart policy. */
export async function startTemporalWorker(options: TemporalWorkerOptions): Promise<TemporalWorkerHandle> {
  await ensureDeadlineStore(options.deps); // Read-only assertion; no startup migration.
  const connection = await NativeConnection.connect(options.config.connectionOptions);
  let clientResource: Awaited<ReturnType<typeof createTemporalClient>> | undefined;
  let worker: Worker | undefined; let server: Server | undefined; let stopped = false;
  let lastSuccess = 0; let lastError: string | null = null;
  try {
    clientResource = await createTemporalClient(options.config);
    worker = await Worker.create({
      connection, namespace: options.config.namespace, taskQueue: options.config.taskQueue,
      workflowBundle: { codePath: options.workflowBundlePath }, activities: options.activities ?? createDeadlineActivities(options.deps),
      shutdownGraceTime: "30 seconds", shutdownForceTime: "45 seconds",
      ...(options.useWorkerVersioning ? { workerDeploymentOptions: { version: { deploymentName: options.deploymentName, buildId: options.buildId }, useWorkerVersioning: true, defaultVersioningBehavior: "PINNED" as const } } : {}),
    });
    const activeWorker = worker;
    const transport = createTemporalOutboxTransport(clientResource.client, options.config.taskQueue, options.deps);
    function health(): TemporalWorkerHealth {
      const workerState = activeWorker.getState();
      return { ready: workerState === "RUNNING" && lastSuccess > 0 && Date.now() - lastSuccess <= options.healthStaleMilliseconds && !lastError, workerState, namespace: options.config.namespace, taskQueue: options.config.taskQueue, lastOutboxSuccessAt: lastSuccess ? new Date(lastSuccess).toISOString() : null, lastOutboxError: lastError, nrcTransmissionMode: "human-recorded-evidence-only" };
    }
    server = createServer((request, response) => {
      if (request.url !== "/health") { response.writeHead(404); response.end(); return; }
      const status = health(); response.writeHead(status.ready ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
      // Health excludes credentials, case/evidence content and raw database errors.
      response.end(JSON.stringify({ ...status, lastOutboxError: status.lastOutboxError ? "outbox dispatch unavailable; inspect secured worker logs" : null }));
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(options.healthPort, options.healthHost, () => { server!.off("error", reject); resolve(); }); });
    let wake: (() => void) | undefined;
    async function dispatchLoop() {
      while (!stopped) {
        try {
          const batch = await dispatchDeadlineOutbox(options.deps, transport);
          const failed = batch.results.find(r => r.status === "retry-pending");
          if (failed) { lastError = failed.error ?? "outbox application pending"; console.error("[part21-temporal]", lastError); }
          else { lastSuccess = Date.now(); lastError = null; }
        } catch (error) { lastError = error instanceof Error ? error.message : String(error); console.error("[part21-temporal] outbox failed:", lastError); }
        if (!stopped) await new Promise<void>(resolve => {
          const timer = setTimeout(() => { wake = undefined; resolve(); }, options.dispatchIntervalMilliseconds);
          wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        });
      }
    }
    const dispatchPromise = dispatchLoop();
    const runPromise = activeWorker.run().finally(async () => {
      stopped = true; wake?.(); await dispatchPromise;
      await new Promise<void>(resolve => server!.close(() => resolve()));
      await clientResource!.close(); await connection.close();
    });
    return { worker: activeWorker, runPromise, health, shutdown: async () => { stopped = true; wake?.(); activeWorker.shutdown(); await runPromise; } };
  } catch (error) {
    server?.close(); await clientResource?.close(); await connection.close(); throw error;
  }
}
