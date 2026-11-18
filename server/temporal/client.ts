import { Client, Connection, type ConnectionOptions } from "@temporalio/client";
import { readFile } from "node:fs/promises";
import { markDeadlineEventDelivered, type DeadlineOutboxTransport, type DeadlineStoreDependencies } from "../deadline-store";
import type { CaseState, CommittedCaseEvent, EventApplication } from "./contracts";
import { APPLY_COMMITTED_CASE_EVENT_UPDATE, COMMITTED_CASE_EVENT_SIGNAL, PART21_CASE_WORKFLOW_TYPE } from "./names";
// Import types only: normal Node code must not load workflow sandbox runtime.
import type { Part21CaseWorkflow } from "./workflows";
export type TemporalConfiguration = { address: string; namespace: string; taskQueue: string; connectionOptions: Pick<ConnectionOptions, "address" | "tls" | "connectTimeout"> & { apiKey?: string } };
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required; Temporal is not configured`); return value;
}
export async function temporalConfigurationFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<TemporalConfiguration> {
  const address = required(env, "TEMPORAL_ADDRESS"), namespace = required(env, "TEMPORAL_NAMESPACE"), taskQueue = required(env, "TEMPORAL_TASK_QUEUE");
  const certPath = env.TEMPORAL_TLS_CERT_PATH, keyPath = env.TEMPORAL_TLS_KEY_PATH;
  if (Boolean(certPath) !== Boolean(keyPath)) throw new Error("Temporal mTLS certificate and key must be configured together");
  if (env.TEMPORAL_TLS !== "true" && env.TEMPORAL_TLS !== "false") throw new Error("TEMPORAL_TLS must be explicitly true or false");
  if ((certPath || env.TEMPORAL_API_KEY || env.TEMPORAL_TLS_CA_PATH) && env.TEMPORAL_TLS !== "true") throw new Error("Temporal credentials require TLS");
  const tls = env.TEMPORAL_TLS === "true" ? {
    ...(certPath && keyPath ? { clientCertPair: { crt: await readFile(certPath), key: await readFile(keyPath) } } : {}),
    ...(env.TEMPORAL_TLS_CA_PATH ? { serverRootCACertificate: await readFile(env.TEMPORAL_TLS_CA_PATH) } : {}),
    ...(env.TEMPORAL_TLS_SERVER_NAME ? { serverNameOverride: env.TEMPORAL_TLS_SERVER_NAME } : {}),
  } : false;
  return { address, namespace, taskQueue, connectionOptions: { address, tls, connectTimeout: "10 seconds", ...(env.TEMPORAL_API_KEY ? { apiKey: env.TEMPORAL_API_KEY } : {}) } };
}
export async function createTemporalClient(config: TemporalConfiguration): Promise<{ client: Client; close: () => Promise<void> }> {
  const connection = await Connection.connect(config.connectionOptions);
  return { client: new Client({ connection, namespace: config.namespace }), close: () => connection.close() };
}
export function part21WorkflowId(caseId: string): string {
  if (!caseId?.trim()) throw new Error("Canonical case ID is required"); return `part21-case:${caseId}`;
}
export function createTemporalOutboxTransport(client: Client, taskQueue: string, deps: DeadlineStoreDependencies, rpcTimeoutMilliseconds = 30000): DeadlineOutboxTransport {
  if (!taskQueue?.trim()) throw new Error("Explicit Temporal task queue is required");
  if (!Number.isSafeInteger(rpcTimeoutMilliseconds) || rpcTimeoutMilliseconds <= 0) throw new Error("Positive RPC timeout required");
  return {
    async deliver(event: CommittedCaseEvent, seed: CaseState): Promise<EventApplication> {
      await client.workflow.withDeadline(Date.now() + rpcTimeoutMilliseconds, () => client.workflow.signalWithStart<typeof Part21CaseWorkflow, [CommittedCaseEvent]>(PART21_CASE_WORKFLOW_TYPE, {
        workflowId: part21WorkflowId(event.caseId), taskQueue, args: [{ state: seed }],
        signal: COMMITTED_CASE_EVENT_SIGNAL, signalArgs: [event],
        workflowIdConflictPolicy: "USE_EXISTING", workflowIdReusePolicy: "REJECT_DUPLICATE",
      }));
      await markDeadlineEventDelivered(event, deps);
      // Deliberately not bound to signaledRunId: follow Continue-As-New for durable receipt.
      const running = client.workflow.getHandle(part21WorkflowId(event.caseId));
      return client.workflow.withDeadline(Date.now() + rpcTimeoutMilliseconds, () => running.executeUpdate<EventApplication, [CommittedCaseEvent]>(APPLY_COMMITTED_CASE_EVENT_UPDATE, { args: [event], updateId: event.eventId }));
    },
  };
}
