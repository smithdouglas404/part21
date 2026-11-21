import crypto from "node:crypto";
import {
  getDomainRecordEnvelopeScoped,
  listDomainRecords,
  requireAudit,
  writeDomainRecordWithEvent,
} from "./domain-store";

export type GovernanceState =
  | "backlog"
  | "ready"
  | "in_review"
  | "deferred"
  | "complete";
export type GovernanceDecision = "accept" | "decline" | "defer";

export type GovernanceItem = {
  id: string;
  title: string;
  summary: string;
  state: GovernanceState;
  priority: "critical" | "high" | "medium";
  findingId?: string;
  skillId: string;
  agentId: string;
  requiredFields: string[];
  completedFields: string[];
  decision?: GovernanceDecision;
  decisionNote?: string;
  deferUntil?: string;
  deferredAt?: string;
  deferredDurationHours?: number;
  owner: string;
  lastUpdated: string;
  history: {
    at: string;
    actor: string;
    action: string;
    note: string;
    state: GovernanceState;
  }[];
};

export const GOVERNANCE_COLUMNS: GovernanceState[] = [
  "backlog",
  "ready",
  "in_review",
  "deferred",
  "complete",
];

function normalize(payload: Record<string, unknown>): GovernanceItem {
  const id = String(payload.id ?? "").trim();
  if (!id) throw new Error("Persisted governance record has no id.");
  const state = String(payload.state ?? "backlog") as GovernanceState;
  if (!GOVERNANCE_COLUMNS.includes(state)) {
    throw new Error(`Persisted governance record ${id} has an invalid state.`);
  }
  return {
    ...(payload as unknown as GovernanceItem),
    id,
    state,
    requiredFields: Array.isArray(payload.requiredFields)
      ? payload.requiredFields.map(String)
      : [],
    completedFields: Array.isArray(payload.completedFields)
      ? payload.completedFields.map(String)
      : [],
    history: Array.isArray(payload.history)
      ? (payload.history as GovernanceItem["history"])
      : [],
  };
}

function missingFields(item: GovernanceItem) {
  return item.requiredFields.filter(
    field => !item.completedFields.includes(field)
  );
}

export async function getGovernanceBoard(auditId: string) {
  if (!auditId.trim()) throw new Error("auditId is required for the governance board.");
  await requireAudit(auditId);
  const items = (await listDomainRecords<Record<string, unknown>>(
    "governance",
    auditId
  ))
    .map(normalize)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    source: "mysql-database",
    auditId,
    items,
    columns: GOVERNANCE_COLUMNS,
    generatedAt: new Date().toISOString(),
    note: "Only persisted human gates for this audit are returned. The board never creates a reportability conclusion or synthetic transaction.",
  };
}

async function loadItem(auditId: string, id: string) {
  if (!auditId.trim()) throw new Error("auditId is required.");
  if (!id.trim()) throw new Error("A governance item id is required.");
  const envelope = await getDomainRecordEnvelopeScoped<Record<string, unknown>>(
    "governance",
    id,
    auditId
  );
  if (!envelope) throw new Error(`Governance item ${id} was not found in ${auditId}.`);
  return { envelope, item: normalize(envelope.payload) };
}

async function persist(
  auditId: string,
  item: GovernanceItem,
  expectedRevision: number,
  actor: string,
  eventType: string,
  eventPayload: Record<string, unknown>
) {
  return writeDomainRecordWithEvent(
    {
      recordType: "governance",
      recordId: item.id,
      auditId,
      payload: item,
    },
    { expectedRevision, actor },
    {
      id: crypto.randomUUID(),
      type: eventType,
      actor,
      auditId,
      entityId: item.id,
      payload: eventPayload,
    }
  );
}

export async function moveGovernanceItem(
  auditId: string,
  id: string,
  target: GovernanceState,
  actor: string
) {
  if (!GOVERNANCE_COLUMNS.includes(target)) {
    throw new Error(`Unsupported governance target ${target}.`);
  }
  if (!actor.trim()) throw new Error("An authenticated actor is required.");
  const { envelope, item } = await loadItem(auditId, id);
  const missing = missingFields(item);
  if (
    (target === "ready" || target === "in_review" || target === "complete") &&
    missing.length > 0
  ) {
    return {
      ok: false,
      error: "Required fields are missing",
      missingFields: missing,
      item,
    };
  }
  const now = new Date().toISOString();
  const updated: GovernanceItem = {
    ...item,
    state: target,
    lastUpdated: now,
    history: [
      ...item.history,
      {
        at: now,
        actor,
        action: `move:${item.state}->${target}`,
        note: missing.length
          ? `Moved with ${missing.length} missing fields.`
          : "Required fields present.",
        state: target,
      },
    ],
  };
  await persist(auditId, updated, envelope.revision, actor, "governance.moved", {
    from: item.state,
    to: target,
    missingFields: missing,
  });
  return {
    ok: true,
    item: updated,
    warning: missing.length
      ? `Missing fields: ${missing.join(", ")}`
      : undefined,
  };
}

export async function decideGovernanceItem(
  auditId: string,
  id: string,
  action: GovernanceDecision,
  note: string,
  deferUntil: string | undefined,
  actor: string
) {
  if (!["accept", "decline", "defer"].includes(action)) {
    throw new Error(`Unsupported governance decision ${action}.`);
  }
  if (!actor.trim()) throw new Error("An authenticated actor is required.");
  if (!note.trim()) {
    throw new Error("A decision update is required for every human action.");
  }
  if (
    action === "defer" &&
    (!deferUntil ||
      Number.isNaN(Date.parse(deferUntil)) ||
      Date.parse(deferUntil) <= Date.now())
  ) {
    throw new Error("Deferral requires a future defer-until timestamp.");
  }
  const { envelope, item } = await loadItem(auditId, id);
  const now = new Date().toISOString();
  const updated: GovernanceItem = {
    ...item,
    decision: action,
    decisionNote: note,
    lastUpdated: now,
  };
  if (action === "defer") {
    updated.state = "deferred";
    updated.deferUntil = deferUntil;
    updated.deferredAt = item.deferredAt ?? now;
    updated.deferredDurationHours = Math.max(
      0,
      (Date.parse(deferUntil!) - Date.parse(updated.deferredAt)) / 3600000
    );
  }
  if (action === "accept") updated.state = "complete";
  if (action === "decline") updated.state = "in_review";
  updated.history = [
    ...item.history,
    { at: now, actor, action, note, state: updated.state },
  ];
  await persist(auditId, updated, envelope.revision, actor, "governance.decided", {
    action,
    note,
    state: updated.state,
    deferUntil: updated.deferUntil ?? null,
  });
  return {
    ok: true,
    item: updated,
    auditEvent: {
      actor,
      action,
      note,
      at: now,
      deferUntil: updated.deferUntil ?? null,
    },
  };
}
