/**
 * Supplies regulation text to the conversational agent.
 *
 * The agent is allowed to quote the regulation and forbidden to interpret it as a decision.
 * Excerpts are therefore returned verbatim from the ingested eCFR snapshot, bounded in size,
 * and labelled with the snapshot they came from so a reviewer can trace any quotation back
 * to the original bytes.
 */
import { listSourceSnapshots } from "./regulatory-source";
import { resolveCitation, type CitationResolution } from "./citation-resolver";

export type RegulatoryExcerpt = {
  citation: string;
  provisionId: string;
  heading: string;
  kind: string;
  text: string;
  truncated: boolean;
  snapshotId: string;
  sourceAsOf: string;
  legalStatus: string;
  status: "quoted" | "unresolved";
  reason?: string;
};

const MAX_EXCERPT_CHARS = 700;
const MAX_EXCERPTS = 4;

function truncate(text: string) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_EXCERPT_CHARS) return { text: clean, truncated: false };
  return { text: `${clean.slice(0, MAX_EXCERPT_CHARS)}…`, truncated: true };
}

export async function regulatoryExcerptsFor(citations: string[], limit = MAX_EXCERPTS): Promise<RegulatoryExcerpt[]> {
  const wanted = [...new Set((citations ?? []).map(citation => String(citation ?? "").trim()).filter(Boolean))];
  if (!wanted.length) return [];

  const snapshots = [...(await listSourceSnapshots("ecfr-part-21")), ...(await listSourceSnapshots("ecfr-part-50-appendix-b"))];
  if (!snapshots.length) return [];

  const excerpts: RegulatoryExcerpt[] = [];
  for (const citation of wanted) {
    if (excerpts.length >= limit) break;
    const resolution: CitationResolution = resolveCitation(citation, snapshots);
    if (resolution.status !== "resolved" || !resolution.text) {
      excerpts.push({
        citation,
        provisionId: "",
        heading: "",
        kind: "",
        text: "",
        truncated: false,
        snapshotId: resolution.snapshotId ?? "",
        sourceAsOf: resolution.sourceAsOf ?? "",
        legalStatus: "unofficial-ecfr-compilation",
        status: "unresolved",
        reason: resolution.reason ?? `Reference is ${resolution.status}; no provision text is supplied.`,
      });
      continue;
    }
    const { text, truncated } = truncate(resolution.text);
    const snapshot = snapshots.find(candidate => candidate.id === resolution.snapshotId);
    excerpts.push({
      citation,
      provisionId: resolution.provisionId ?? "",
      heading: resolution.heading ?? "",
      kind: resolution.kind ?? "",
      text,
      truncated,
      snapshotId: resolution.snapshotId ?? "",
      sourceAsOf: resolution.sourceAsOf ?? "",
      legalStatus: snapshot?.legalStatus ?? "unofficial-ecfr-compilation",
      status: "quoted",
    });
  }
  return excerpts;
}

/** Citations the agent should be given text for: computed clock branches plus the applied skill. */
export function citationsForPacket(input: {
  clockBrief?: { cases?: Array<{ branches?: Array<{ citation?: string }> }> } | null;
  skill?: { regulatoryRefs?: string[] } | null;
}): string[] {
  const fromClocks = (input.clockBrief?.cases ?? []).flatMap(item => (item.branches ?? []).map(branch => String(branch.citation ?? "")));
  const fromSkill = input.skill?.regulatoryRefs ?? [];
  return [...new Set([...fromClocks, ...fromSkill].filter(Boolean))];
}
