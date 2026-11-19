/**
 * Resolves free-text regulatory references to ingested eCFR provisions.
 *
 * Skills declare citations as strings such as "10 CFR 21.21(a)(1)" or
 * "10 CFR 50 Appendix B Criterion VII". Those strings are only trustworthy if they
 * are bound to a provision that actually exists in the ingested snapshot. This module
 * performs that binding and reports, per reference, whether it resolved, was ambiguous,
 * or does not exist. It never invents a provision: an unresolved reference stays unresolved.
 */
import type { RegulatoryProvision, RegulatorySnapshot } from "../shared/regulatory";

export type CitationStatus = "resolved" | "ambiguous" | "unresolved" | "not-applicable";

export type CitationResolution = {
  reference: string;
  status: CitationStatus;
  provisionId?: string;
  heading?: string;
  kind?: string;
  paragraphLabel?: string;
  text?: string;
  snapshotId?: string;
  sourceAsOf?: string;
  candidates?: number;
  reason?: string;
};

export type CitationCoverage = {
  total: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  notApplicable: number;
  coveragePercent: number;
  resolutions: CitationResolution[];
  humanReviewRequired: true;
};

/** Normalised shape of a parsed reference. */
type Parsed = {
  family: "part21" | "appendix-b" | "unknown";
  section?: string;
  paragraphPath: string[];
  criterion?: string;
};

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx", "xxi", "xxii"];

export function parseCitation(reference: string): Parsed {
  const raw = String(reference ?? "").trim();
  const text = raw.replace(/^10\s*CFR\s*/i, "").replace(/\s+/g, " ").trim();

  // Part 50 Appendix B, optionally followed by a criterion number.
  if (/appendix\s*b/i.test(text) || /part\s*50/i.test(text)) {
    const criterion = text.match(/criterion\s+([ivx]+)/i)?.[1]?.toLowerCase();
    return { family: "appendix-b", paragraphPath: [], criterion };
  }

  // Part 21 section, e.g. "21.21(a)(1)" or "part 21.21(a)".
  const sectionMatch = text.match(/(?:part\s*)?(21\.\d+)/i);
  if (sectionMatch) {
    const section = sectionMatch[1];
    const after = text.slice(text.indexOf(section) + section.length);
    const paragraphPath = [...after.matchAll(/\(([a-z0-9]+)\)/gi)].map(m => m[1].toLowerCase());
    return { family: "part21", section, paragraphPath };
  }

  // Bare paragraph reference such as "21(a)" is not resolvable on its own.
  return { family: "unknown", paragraphPath: [] };
}

function provisionLabel(provision: RegulatoryProvision): string {
  return String((provision as any).paragraphLabel ?? "").toLowerCase().replace(/[()\s]/g, "");
}

function matchesSection(provision: RegulatoryProvision, section: string): boolean {
  const heading = String(provision.heading ?? "");
  const id = String((provision as any).provisionId ?? provision.id ?? "");
  return new RegExp(`(^|[^0-9])${section.replace(".", "\\.")}([^0-9]|$)`).test(heading) || id.includes(section);
}

function matchesCriterion(provision: RegulatoryProvision, criterion: string): boolean {
  const heading = String(provision.heading ?? "");
  const label = provisionLabel(provision);
  const id = String((provision as any).provisionId ?? provision.id ?? "");
  const wanted = criterion.toLowerCase();
  // Ingested criteria carry kind "criterion", a heading such as "III. Design Control",
  // and an identifier ending in ":III". Any of those is sufficient; nothing is guessed.
  if (String((provision as any).kind ?? "") === "criterion") {
    if (new RegExp(`^${wanted}\\.`, "i").test(heading)) return true;
    if (new RegExp(`:${wanted}$`, "i").test(id)) return true;
    if (label === wanted) return true;
  }
  return new RegExp(`criterion\\s+${wanted}\\b`, "i").test(heading);
}

function matchesPath(provision: RegulatoryProvision, path: string[]): boolean {
  if (!path.length) return true;
  const label = provisionLabel(provision);
  const joined = path.join("");
  if (!label) return false;
  return label === joined || label.endsWith(joined) || joined.endsWith(label);
}

/** Resolve one reference against every supplied snapshot. */
export function resolveCitation(reference: string, snapshots: RegulatorySnapshot[]): CitationResolution {
  const parsed = parseCitation(reference);
  if (parsed.family === "unknown") {
    return { reference, status: "unresolved", reason: "The reference does not identify a Part 21 section or Appendix B criterion." };
  }

  const candidates: Array<{ provision: RegulatoryProvision; snapshot: RegulatorySnapshot }> = [];
  for (const snapshot of snapshots) {
    for (const provision of snapshot.provisions ?? []) {
      const hit = parsed.family === "appendix-b"
        ? (parsed.criterion ? matchesCriterion(provision, parsed.criterion) : String(provision.heading ?? "").toLowerCase().includes("appendix b"))
        : (parsed.section ? matchesSection(provision, parsed.section) && matchesPath(provision, parsed.paragraphPath) : false);
      if (hit) candidates.push({ provision, snapshot });
    }
  }

  if (!candidates.length) {
    return {
      reference,
      status: "unresolved",
      reason: parsed.family === "part21"
        ? `No ingested provision matches ${parsed.section}${parsed.paragraphPath.map(p => `(${p})`).join("")}.`
        : `No ingested provision matches the requested Appendix B criterion.`,
    };
  }

  // Prefer the most specific paragraph: the deepest label wins.
  candidates.sort((a, b) => provisionLabel(b.provision).length - provisionLabel(a.provision).length);
  const best = candidates[0];
  const equallySpecific = candidates.filter(c => provisionLabel(c.provision) === provisionLabel(best.provision));

  if (equallySpecific.length > 1 && new Set(equallySpecific.map(c => c.snapshot.id)).size > 1) {
    return {
      reference,
      status: "ambiguous",
      candidates: equallySpecific.length,
      reason: "The same paragraph exists in more than one ingested snapshot; pin the audit's regulatory baseline.",
    };
  }

  const provision = best.provision as any;
  return {
    reference,
    status: "resolved",
    provisionId: String(provision.provisionId ?? provision.id ?? ""),
    heading: String(provision.heading ?? ""),
    kind: String(provision.kind ?? ""),
    paragraphLabel: provision.paragraphLabel ? String(provision.paragraphLabel) : undefined,
    text: String(provision.text ?? ""),
    snapshotId: best.snapshot.id,
    sourceAsOf: best.snapshot.sourceAsOf,
  };
}

export function resolveCitations(
  references: string[],
  snapshots: RegulatorySnapshot[],
  external: { reference: string; basis: string }[] = [],
): CitationCoverage {
  const declared = new Map(external.map(item => [item.reference.trim().toLowerCase(), item.basis]));
  const resolutions = references.map(reference => {
    const resolution = resolveCitation(reference, snapshots);
    if (resolution.status === "resolved" || resolution.status === "ambiguous") return resolution;
    const basis = declared.get(reference.trim().toLowerCase());
    if (!basis) return resolution;
    return { ...resolution, status: "not-applicable" as const, reason: `Declared external reference: ${basis}` };
  });
  const resolved = resolutions.filter(r => r.status === "resolved").length;
  const ambiguous = resolutions.filter(r => r.status === "ambiguous").length;
  const unresolved = resolutions.filter(r => r.status === "unresolved").length;
  const notApplicable = resolutions.filter(r => r.status === "not-applicable").length;
  const total = resolutions.length;
  return {
    total, resolved, ambiguous, unresolved, notApplicable,
    coveragePercent: total ? Math.round((resolved / total) * 100) : 0,
    resolutions,
    humanReviewRequired: true,
  };
}

/**
 * A skill may only be activated when every regulatory reference it makes resolves to an
 * ingested provision. Ambiguous references are treated as failures because they would let
 * an auditor cite a paragraph without knowing which baseline it came from.
 */
export function assertSkillCitationsResolvable(
  skillId: string,
  references: string[],
  snapshots: RegulatorySnapshot[],
  external: { reference: string; basis: string }[] = [],
): CitationCoverage {
  const coverage = resolveCitations(references ?? [], snapshots, external);
  const blocking = coverage.resolutions.filter(r => r.status === "unresolved" || r.status === "ambiguous");
  if (blocking.length) {
    const detail = blocking.map(r => `${r.reference} (${r.status}${r.reason ? `: ${r.reason}` : ""})`).join("; ");
    throw new Error(`Skill ${skillId} cannot be activated: ${blocking.length} regulatory reference(s) do not resolve against the ingested eCFR snapshot. ${detail}`);
  }
  return coverage;
}
