import fs from "node:fs";
import path from "node:path";

export type AssuranceEvent = {
  id: string;
  type: string;
  occurredAt: string;
  actor: string;
  auditId?: string;
  entityId?: string;
  payload: Record<string, unknown>;
};

const dataDir = process.env.PART21_DATA_DIR || path.resolve(process.cwd(), "data");
const eventFile = path.join(dataDir, "assurance-events.jsonl");

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(eventFile)) fs.writeFileSync(eventFile, "", "utf8");
}

function readEvents(): AssuranceEvent[] {
  ensureStore();
  return fs.readFileSync(eventFile, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as AssuranceEvent]; } catch { return []; }
  });
}

export function appendAssuranceEvent(event: Omit<AssuranceEvent, "id" | "occurredAt"> & Partial<Pick<AssuranceEvent, "id" | "occurredAt">>) {
  ensureStore();
  const persisted: AssuranceEvent = { id: event.id || `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, occurredAt: event.occurredAt || new Date().toISOString(), ...event };
  fs.appendFileSync(eventFile, `${JSON.stringify(persisted)}\n`, "utf8");
  return persisted;
}

export function listAssuranceEvents(filters: { type?: string; entityId?: string; auditId?: string } = {}) {
  return readEvents().filter((event) => (!filters.type || event.type === filters.type) && (!filters.entityId || event.entityId === filters.entityId) && (!filters.auditId || event.auditId === filters.auditId));
}

export function getEventStoreStatus() {
  ensureStore();
  return { provider: "append-only JSONL event store", durable: true, path: eventFile, eventCount: readEvents().length, productionTarget: "PostgreSQL or client-qualified event store with immutable retention controls" };
}
