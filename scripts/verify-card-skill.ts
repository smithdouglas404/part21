import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";
const auditId = process.env.PART21_AUDIT_ID ?? "AUD-026";

async function json(path: string, cookie: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function main() {
  const token = await sdk.signSession(
    {
      openId:
        process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS",
      appId: ENV.appId,
      name: "Frank",
    },
    { expiresInMs: 15 * 60 * 1000 }
  );
  const cookie = `${COOKIE_NAME}=${token}`;
  const session = await json("/api/session", cookie);
  console.log("session", session.status, {
    actor: session.body?.principal?.actor,
    access: session.body?.principal?.access,
    isAdmin: session.body?.principal?.isAdmin,
    writeAudits: session.body?.principal?.auditWriteIds,
  });

  const registry = await json(
    `/api/agents/registry?auditId=${encodeURIComponent(auditId)}`,
    cookie
  );
  console.log("registry", registry.status, {
    agents: registry.body?.agents?.length,
    first: registry.body?.agents?.[0]?.name,
  });

  const cards = await json(
    `/api/kanban?auditId=${encodeURIComponent(auditId)}`,
    cookie
  );
  const baseline = (cards.body?.items ?? []).find(
    (card: any) =>
      String(card.sourceRecordId ?? "").startsWith("AUDIT-BASELINE:") &&
      card.status === "backlog"
  );
  console.log("baseline card", {
    id: baseline?.id,
    title: baseline?.title,
    skill: baseline?.activeSkillId,
  });
  if (!baseline) throw new Error("No backlog baseline card available.");

  const move = await json(
    `/api/kanban/items/${encodeURIComponent(baseline.id)}/move`,
    cookie,
    {
      method: "POST",
      body: JSON.stringify({
        auditId,
        status: "in_progress",
        reason: "Integration check: activate the governed skill at stage entry.",
      }),
    }
  );
  console.log("move", move.status, {
    status: move.body?.item?.status,
    skillStatus: move.body?.item?.skillStatus,
    skill: move.body?.skillActivation?.skill?.name,
    version: move.body?.skillActivation?.activation?.skillVersion,
    questions: move.body?.skillActivation?.activation?.questions?.length,
    error: move.body?.error,
    activationError: move.body?.skillActivationError,
  });

  const activation = move.body?.skillActivation?.activation;
  if (!activation) throw new Error("Stage move did not activate a skill.");
  const answers: Record<string, unknown> = {};
  for (const question of activation.questions ?? []) {
    answers[question.id] =
      question.input === "choice"
        ? question.options?.[0]
        : question.input === "checklist"
          ? [question.options?.[0]]
          : "Integration check answer grounded in the selected audit record.";
  }
  const run = await json("/api/agentkit/run", cookie, {
    method: "POST",
    body: JSON.stringify({
      auditId,
      findingId: baseline.findingId ?? undefined,
      cardId: baseline.id,
      skillId: activation.skillId,
      skillVersion: activation.skillVersion,
      answers,
    }),
  });
  console.log("run", run.status, {
    traceId: run.body?.traceId,
    status: run.body?.status,
    completion: run.body?.completion,
    tools: run.body?.toolCalls?.length,
    unknowns: run.body?.unknowns,
    error: run.body?.error,
  });

  const after = await json(
    `/api/kanban?auditId=${encodeURIComponent(auditId)}`,
    cookie
  );
  const card = (after.body?.items ?? []).find(
    (item: any) => item.id === baseline.id
  );
  console.log("card lineage", {
    status: card?.status,
    skillStatus: card?.skillStatus,
    traceId: card?.traceId,
    skillVersion: card?.skillVersion,
  });
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
