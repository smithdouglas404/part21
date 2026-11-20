import "dotenv/config";
import { createPool, type Pool } from "mysql2/promise";

/**
 * Cross-audit precedent traversal.
 *
 * The audit-scoped graph answers "what is true inside this audit". This module answers a
 * different question: "has the organisation met this failure mode before, and what happened?"
 * It reads every persisted finding and audit title in the database, ranks prior audits and
 * prior findings against the current question/finding, and returns the exact record IDs that
 * produced each match so the agent can cite them rather than assert vague "past experience".
 *
 * Nothing here is a fixture. If the portfolio has no history, the packet says so and the
 * agent must report an absence of precedent instead of inventing one.
 */

export type PrecedentFinding = {
  findingId: string;
  auditId: string;
  auditTitle: string | null;
  title: string;
  severity: string | null;
  status: string | null;
  owner: string | null;
  age: number | null;
  matchedOn: string[];
  score: number;
};

export type PrecedentAudit = {
  auditId: string;
  auditTitle: string | null;
  findingCount: number;
  matchedOn: string[];
  score: number;
};

export type PrecedentPacket = {
  basis: "database: part21_domain_records";
  scope: { auditId: string | null; findingId: string | null; terms: string[] };
  comparableFindings: PrecedentFinding[];
  relatedAudits: PrecedentAudit[];
  coverageGap: boolean;
  coverageStatement: string;
  limitations: string[];
};

const STOPWORDS = new Set([
  "about", "after", "again", "against", "audit", "audits", "because", "been", "before", "being",
  "between", "cannot", "could", "does", "doing", "during", "each", "from", "have", "having",
  "here", "into", "itself", "just", "more", "most", "must", "only", "other", "over", "same",
  "should", "some", "such", "than", "that", "their", "them", "then", "there", "these", "they",
  "this", "those", "through", "under", "until", "very", "was", "were", "what", "when", "where",
  "which", "while", "will", "with", "within", "would", "your", "record", "records", "review",
  "needs", "need", "please", "tell", "show", "give", "help", "status", "findings", "finding",
]);

export function precedentTerms(...inputs: Array<string | null | undefined>): string[] {
  const text = inputs.filter(Boolean).join(" ").toLowerCase();
  const tokens = text.match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  const unique = new Set<string>();
  for (const raw of tokens) {
    const token = raw.replace(/^-+|-+$/g, "");
    if (token.length < 5 || STOPWORDS.has(token)) continue;
    unique.add(token);
    if (unique.size >= 24) break;
  }
  return [...unique];
}

let sharedPool: Pool | null = null;
function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for precedent traversal.");
  if (!sharedPool) sharedPool = createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3, waitForConnections: true });
  return sharedPool;
}

function parsePayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") return payload as Record<string, unknown>;
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function buildPrecedentPacket(input: { auditId?: string | null; findingId?: string | null; question?: string | null }): Promise<PrecedentPacket> {
  const auditId = input.auditId ?? null;
  const findingId = input.findingId ?? null;

  const [findingRows] = await pool().query<any[]>(
    "SELECT audit_id, record_id, payload, created_at FROM part21_domain_records WHERE record_type = 'finding'",
  );
  const [auditRows] = await pool().query<any[]>(
    "SELECT audit_id, payload FROM part21_domain_records WHERE record_type = 'audit'",
  );

  const findings = (findingRows as any[]).map(row => {
    const payload = parsePayload(row.payload);
    return {
      auditId: String(row.audit_id),
      findingId: String(row.record_id),
      title: str(payload.title) ?? "(untitled finding)",
      severity: str(payload.severity),
      status: str(payload.status),
      owner: str(payload.owner),
      age: typeof payload.age === "number" ? payload.age : null,
      createdAt: row.created_at ? String(row.created_at) : null,
    };
  });
  const auditTitles = new Map<string, string | null>(
    (auditRows as any[]).map(row => [String(row.audit_id), str(parsePayload(row.payload).title)]),
  );
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.auditId, (counts.get(finding.auditId) ?? 0) + 1);

  const current = findingId ? findings.find(f => f.findingId === findingId) ?? null : null;
  const terms = precedentTerms(current?.title, input.question);
  const termSet = new Set(terms);

  const comparable: PrecedentFinding[] = [];
  for (const finding of findings) {
    if (finding.auditId === auditId) continue; // precedent means a different audit
    if (finding.findingId === findingId) continue;
    const haystack = new Set(precedentTerms(finding.title));
    const matchedOn: string[] = [];
    let score = 0;
    for (const term of haystack) {
      if (termSet.has(term)) { matchedOn.push(`shared term "${term}"`); score += 2; }
    }
    if (current?.severity && finding.severity === current.severity) { matchedOn.push(`same severity ${finding.severity}`); score += 1; }
    if (current?.owner && finding.owner && finding.owner === current.owner) { matchedOn.push(`same owner ${finding.owner}`); score += 1; }
    if (score < 2) continue;
    comparable.push({ ...finding, auditTitle: auditTitles.get(finding.auditId) ?? null, matchedOn, score });
  }
  comparable.sort((a, b) => b.score - a.score || a.findingId.localeCompare(b.findingId));

  const related: PrecedentAudit[] = [];
  for (const [id, title] of auditTitles) {
    if (id === auditId) continue;
    const haystack = new Set(precedentTerms(title));
    const matchedOn: string[] = [];
    let score = 0;
    for (const term of haystack) {
      if (termSet.has(term)) { matchedOn.push(`audit title shares "${term}"`); score += 2; }
    }
    const auditFindings = comparable.filter(f => f.auditId === id).length;
    if (score > 0 || auditFindings > 0) {
      related.push({ auditId: id, auditTitle: title ?? null, findingCount: counts.get(id) ?? 0, matchedOn, score: score + auditFindings });
    }
  }
  related.sort((a, b) => b.score - a.score || a.auditId.localeCompare(b.auditId));

  const topFindings = comparable.slice(0, 6);
  const topAudits = related.slice(0, 6);
  const coverageGap = topAudits.length > 0 && topFindings.length === 0;
  const coverageStatement = topFindings.length
    ? `${topFindings.length} comparable finding(s) exist in other audits; the strongest is ${topFindings[0].findingId} in ${topFindings[0].auditId} (${topFindings[0].matchedOn.join(", ")}).`
    : topAudits.length
      ? `No comparable finding exists in any other audit. ${topAudits.length} prior audit(s) touched the same subject (${topAudits.map(a => `${a.auditId} with ${a.findingCount} finding(s)`).join("; ")}), so the subject was examined before without a recorded finding — either the control held then, or the examination did not test this failure mode. That distinction is not recorded and must be treated as unknown.`
      : "No prior audit or finding in the database shares a meaningful term with this question. There is no precedent to cite.";

  return {
    basis: "database: part21_domain_records",
    scope: { auditId, findingId, terms },
    comparableFindings: topFindings,
    relatedAudits: topAudits,
    coverageGap,
    coverageStatement,
    limitations: [
      "Matching is lexical and attribute-based (title terms, severity, owner). It is a retrieval aid, not a similarity model, and it does not establish that two findings share a root cause.",
      "Only findings and audit titles are compared. Evidence, corrective actions and effectiveness reviews are not yet part of precedent matching.",
      "A prior audit with zero findings is not proof that no problem existed; it may mean the audit did not test for it.",
    ],
  };
}
