import "dotenv/config";
import { ENV } from "../server/_core/env";
import { sdk } from "../server/_core/sdk";
import { COOKIE_NAME } from "../shared/const";

/**
 * Builds a small, database-backed demonstration lane from the persisted
 * findings in AUD-026. Every card is explicitly marked as a synthetic
 * demonstration card, linked to the real finding record, and moved through the
 * normal audited Kanban path. Re-running the script is idempotent.
 */
const base = process.env.PART21_BASE_URL ?? "http://127.0.0.1:3000";
const auditId = process.env.PART21_AUDIT_ID ?? "AUD-026";

async function api(path: string, cookie: string, init?: RequestInit) {
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
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${response.status}: ${body?.error ?? text}`);
  }
  return body;
}

const plan = [
  {
    findingId: "F-042",
    skillId: "finding-challenge",
    priority: "high",
    target: "review",
    rationale:
      "Receiving inspection cannot resolve the heat-lot chain. The finding challenge records the signal, the counter-evidence test, and the provisional severity before review.",
    answers: {
      "finding-signal":
        "Receiving inspection record 2-481 cannot be joined to heat lot 7B-441 or the supplier certification.",
      "finding-test":
        "A complete receiving-to-heat-lot-to-certification chain would disprove the gap; no such chain is currently linked.",
      "finding-severity": "Major",
    },
  },
  {
    findingId: "F-036",
    skillId: "appendix-b-records-audit",
    priority: "medium",
    target: "review",
    rationale:
      "The traveler still references an obsolete work instruction. Records and audit readiness checks whether the controlled record set and revision evidence support closure.",
    answers: {},
  },
  {
    findingId: "F-039",
    skillId: "supplier-evaluation-transfer",
    priority: "high",
    target: "blocked",
    rationale:
      "The supplier change notification arrived outside the control window. The supplier evaluation skill is activated and the card is blocked pending the purchaser acknowledgement and capability response.",
    answers: {},
  },
];

async function main() {
  const token = await sdk.signSession(
    {
      openId:
        process.env.PART21_TEST_OPEN_ID ?? "hJb4ZHUeEmhQEsRt87jMfS",
      appId: ENV.appId,
      name: "Frank",
    },
    { expiresInMs: 20 * 60 * 1000 }
  );
  const cookie = `${COOKIE_NAME}=${token}`;
  const portfolio = await api(
    `/api/domain/portfolio?auditId=${encodeURIComponent(auditId)}`,
    cookie
  );
  const findings = new Map<string, any>(
    (portfolio.findings ?? []).map((finding: any) => [finding.id, finding])
  );
  const cards = await api(
    `/api/kanban?auditId=${encodeURIComponent(auditId)}`,
    cookie
  );
  const existing = new Set(
    (cards.items ?? []).map((card: any) => String(card.sourceRecordId ?? ""))
  );

  for (const item of plan) {
    const finding = findings.get(item.findingId);
    if (!finding) {
      console.log(`skip ${item.findingId}: finding is not in the audit portfolio`);
      continue;
    }
    const sourceRecordId = `DEMO-FINDING:${item.findingId}`;
    if (existing.has(sourceRecordId)) {
      console.log(`skip ${item.findingId}: demonstration card already exists`);
      continue;
    }
    const created = await api("/api/kanban/items", cookie, {
      method: "POST",
      body: JSON.stringify({
        auditId,
        title: `${item.findingId} — ${finding.title}`,
        description: `Synthetic demonstration card generated from persisted finding ${item.findingId}. ${item.rationale}`,
        status: "backlog",
        priority: item.priority,
        attention: true,
        source: "agent",
        sourceRecordId,
        findingId: item.findingId,
        skillIds: [item.skillId],
        activeSkillId: item.skillId,
        createdBy: "Frank",
      }),
    });
    const cardId = created.item.id;
    console.log(`created ${cardId} for ${item.findingId}`);
    const moved = await api(
      `/api/kanban/items/${encodeURIComponent(cardId)}/move`,
      cookie,
      {
        method: "POST",
        body: JSON.stringify({
          auditId,
          status: item.target,
          reason: `Synthetic demonstration lane: ${item.rationale}`,
        }),
      }
    );
    console.log(
      `moved ${cardId} to ${moved.item.status}; skill ${moved.skillActivation?.skill?.name ?? "not activated"}`
    );
    if (item.findingId === "F-042" && moved.skillActivation?.activation) {
      const activation = moved.skillActivation.activation;
      const run = await api("/api/agentkit/run", cookie, {
        method: "POST",
        body: JSON.stringify({
          auditId,
          findingId: item.findingId,
          cardId,
          skillId: activation.skillId,
          skillVersion: activation.skillVersion,
          answers: item.answers,
        }),
      });
      console.log(
        `ran ${activation.skillName}: ${run.status}, trace ${run.traceId}, graph nodes ${run.grounding?.nodeCount ?? 0}`
      );
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
