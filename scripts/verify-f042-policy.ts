import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";
const auditId = "AUD-026";

async function json(path: string, cookie: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body?.error}`);
  return body;
}

async function main() {
  const token = await sdk.signSession(
    { openId: "hJb4ZHUeEmhQEsRt87jMfS", appId: ENV.appId, name: "Frank" },
    { expiresInMs: 15 * 60 * 1000 }
  );
  const cookie = `${COOKIE_NAME}=${token}`;
  const cards = await json(`/api/kanban?auditId=${auditId}`, cookie);
  const card = cards.items.find(
    (item: any) => item.sourceRecordId === "DEMO-FINDING:F-042"
  );
  if (!card) throw new Error("F-042 demonstration card not found.");
  const activation = card.skillActivation;
  if (!activation) throw new Error("F-042 card has no activated skill.");
  const answers = {
    "finding-signal":
      "Receiving inspection record 2-481 cannot be joined to heat lot 7B-441 or the supplier certification.",
    "finding-test":
      "A complete receiving-to-heat-lot-to-certification chain would disprove the gap; no such chain is currently linked.",
    "finding-severity": "Major",
  };
  const run = await json("/api/agentkit/run", cookie, {
    method: "POST",
    body: JSON.stringify({
      auditId,
      findingId: "F-042",
      cardId: card.id,
      skillId: activation.skillId,
      skillVersion: activation.skillVersion,
      answers,
    }),
  });
  console.log(
    JSON.stringify(
      {
        traceId: run.traceId,
        status: run.status,
        completion: run.completion,
        tools: run.toolCalls?.map((tool: any) => ({
          tool: tool.tool,
          status: tool.status,
        })),
        unknowns: run.unknowns,
        policy: run.policy
          ? {
              policyVersion: run.policy.policyVersion,
              counts: run.policy.counts,
              results: run.policy.results?.map((result: any) => ({
                rule: result.rule?.citation ?? result.rule?.id,
                disposition: result.disposition,
              })),
            }
          : null,
        grounding: {
          graphTraversed: run.grounding?.graphTraversed,
          nodes: run.grounding?.nodeCount,
          edges: run.grounding?.edgeCount,
          temporalEvents: run.grounding?.temporalEventCount,
        },
      },
      null,
      2
    )
  );
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
