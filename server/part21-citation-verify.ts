import { PART21_SECTION_TITLES, PART21_BRANCHES, PART21_GATES } from "../shared/part21-process";
import type { RegulatorySnapshot } from "../shared/regulatory";

export type CitationCheck = {
  section: string;
  expectedTitle: string;
  provisionId: string;
  sourceHeading: string | null;
  normalizedHeading: string | null;
  status: "verified" | "mismatch" | "missing";
  textSha256: string | null;
  textLength: number;
};

export type CitationVerification = {
  snapshotId: string;
  sourceAsOf: string;
  retrievedAt: string;
  providerUpToDateAsOf: string | null;
  latestAmendedOn: string | null;
  sourceUri: string | null;
  checks: CitationCheck[];
  verified: number;
  mismatched: number;
  missing: number;
  allVerified: boolean;
  note: string;
};

/** Strip the leading section mark and number so the heading can be compared to the official title. */
export function normalizeHeading(heading: string, section: string): string {
  return heading
    .replace(/^\u00a7\s*/, "")
    .replace(new RegExp(`^${section.replace(/\./g, "\\.")}\\s*`), "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim();
}

/**
 * Verifies the citations the application displays against the exact ingested
 * eCFR snapshot. This is what makes "we use eCFR" checkable rather than claimed:
 * a mismatch means the UI text is stale and must not be shown as current law.
 */
export function verifyProcessCitations(snapshot: RegulatorySnapshot, expectations: Readonly<Record<string, string>> = PART21_SECTION_TITLES): CitationVerification {
  if (!snapshot?.provisions?.length) throw new Error("An ingested regulatory snapshot with provisions is required; citations cannot be verified against nothing.");
  const checks: CitationCheck[] = Object.entries(expectations).map(([section, expectedTitle]) => {
    const provisionId = `10-cfr:${section}`;
    const provision = snapshot.provisions.find(row => row.id === provisionId);
    if (!provision) return { section, expectedTitle, provisionId, sourceHeading: null, normalizedHeading: null, status: "missing" as const, textSha256: null, textLength: 0 };
    const normalized = normalizeHeading(provision.heading ?? "", section);
    const same = normalized.toLowerCase() === expectedTitle.toLowerCase();
    return {
      section,
      expectedTitle,
      provisionId,
      sourceHeading: provision.heading ?? null,
      normalizedHeading: normalized,
      status: same ? "verified" as const : "mismatch" as const,
      textSha256: null,
      textLength: provision.text?.length ?? 0,
    };
  });
  const verified = checks.filter(check => check.status === "verified").length;
  const mismatched = checks.filter(check => check.status === "mismatch").length;
  const missing = checks.filter(check => check.status === "missing").length;
  const xml = snapshot.originals.find(original => original.kind === "full-xml");
  return {
    snapshotId: snapshot.id,
    sourceAsOf: snapshot.sourceAsOf,
    retrievedAt: snapshot.retrievedAt,
    providerUpToDateAsOf: snapshot.providerUpToDateAsOf,
    latestAmendedOn: snapshot.latestAmendedOn,
    sourceUri: xml?.finalUri ?? null,
    checks,
    verified,
    mismatched,
    missing,
    allVerified: mismatched === 0 && missing === 0,
    note: "Verification compares the displayed citation titles and branch citations to the exact ingested eCFR snapshot. It does not establish legal interpretation, applicability, or compliance.",
  };
}

/** Every citation the process model shows must resolve to a section in the snapshot. */
export function verifyProcessModelCoverage(snapshot: RegulatorySnapshot) {
  const citations = new Set<string>();
  for (const branch of PART21_BRANCHES) citations.add(branch.citation);
  for (const gate of PART21_GATES) citations.add(gate.citation);
  const unresolved = [...citations].filter(citation => {
    const match = citation.match(/10 CFR\s+(21\.\d+(?:\([a-z0-9]+\))*)/i);
    if (!match) return true;
    const section = match[1].split("(")[0];
    return !snapshot.provisions.some(provision => provision.id === `10-cfr:${section}`);
  });
  return { totalCitations: citations.size, unresolved, complete: unresolved.length === 0 };
}
