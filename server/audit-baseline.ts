import { appendAssuranceEvent } from "./event-store";
import { getDomainRecordScoped } from "./domain-store";
import { listControlledConfigurationPayloads, type ControlledConfiguration } from "./config-store";
import { createKanbanItem, listKanbanItems, type KanbanItem } from "./kanban-store";
import { getAuditProfiles } from "./regulatory-runtime";
import type { EvidencePrincipal } from "./evidence-vault";

/**
 * Baseline cards are a projection of three database facts:
 *   1. the audit record (scope, standard and optional governed profile binding),
 *   2. the active audit-profile definition, and
 *   3. the active five-phase method plus the active nuclear skill contracts.
 *
 * Nothing in this module supplies audit content from a fixture. If the controlled phase
 * guide or the audit record is unavailable, baseline generation fails instead of inventing
 * a checklist.
 */

type PhaseDefinition = { id: string; label: string; description?: string; short?: string };
type SkillPayload = {
  id?: string;
  name?: string;
  phase?: string;
  purpose?: string;
  domain?: string;
  humanGate?: string;
  regulatoryRefs?: string[];
  requiredEvidence?: string[];
  part21Sections?: string[];
  appendixBCriteria?: string[];
};
type SkillEnvelope = ControlledConfiguration & { payload: SkillPayload };
type AuditProfile = {
  id: string;
  version: string;
  title: string;
  caseType?: string;
  standard?: string;
  requiredProvisionIds?: string[];
  requiredEvidenceTypes?: string[];
  reviewerRoles?: string[];
  status?: string;
};
type BaselinePrincipal = EvidencePrincipal & {
  actor?: string;
  isAdmin?: boolean;
  access?: "look_only" | "make_changes";
  auditIds?: string[];
  auditWriteIds?: string[];
};

const BASELINE_SOURCE_PREFIX = "AUDIT-BASELINE:";

function roman(value: string) {
  return value.trim().toUpperCase().replace(/[^IVXLCDM]/g, "");
}

/**
 * Convert the two citation dialects used by the application into comparable tokens.
 * Profile IDs look like `10-cfr:21.21(a)(1)` and `10-cfr:part-50:appendix-b:III`;
 * skill references look like `10 CFR 21.21(a)` and `10 CFR 50 Appendix B Criterion III`.
 */
export function citationTokens(value: string): string[] {
  const text = String(value ?? "");
  const tokens = new Set<string>();
  for (const match of text.matchAll(/21\.(\d+)(?:\(([a-z0-9]+)\))?/gi)) {
    const section = `21.${match[1]}`;
    const paragraph = match[2] ? `(${match[2].toLowerCase()})` : "";
    tokens.add(`${section}${paragraph}`);
    tokens.add(section);
    if (paragraph) tokens.add(`${section}`);
  }
  for (const match of text.matchAll(/criterion\s+([ivxlcdm]+)/gi)) {
    tokens.add(`appb:${roman(match[1])}`);
  }
  for (const match of text.matchAll(/appendix[- ]?b\s*:\s*([ivxlcdm]+)/gi)) {
    tokens.add(`appb:${roman(match[1])}`);
  }
  for (const match of text.matchAll(/appendix[- ]?b[^a-z0-9]+([ivxlcdm]+)\b/gi)) {
    tokens.add(`appb:${roman(match[1])}`);
  }
  return [...tokens].filter(token => token && !token.endsWith(":"));
}

function phaseDefinitions(configurations: SkillEnvelope[]): PhaseDefinition[] {
  const guide = configurations.find(configuration => configuration.configId === "audit-phases");
  if (!guide) throw new Error("The controlled audit phase guide (audit-phases) is unavailable; baseline generation is blocked.");
  const payload = guide.payload as unknown as Record<string, unknown>;
  const phases = Object.entries(payload)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value as PhaseDefinition)
    .filter(value => value && typeof value.id === "string" && typeof value.label === "string");
  if (!phases.length) throw new Error("The controlled audit phase guide has no ordered phases; baseline generation is blocked.");
  return phases;
}

function profileForAudit(audit: Record<string, any>, profiles: AuditProfile[]): AuditProfile | null {
  const profileId = String(audit.auditProfileId ?? "").trim();
  const profileVersion = String(audit.auditProfileVersion ?? "").trim();
  if (!profileId) return null;
  return (
    profiles.find(profile => profile.id === profileId && (!profileVersion || profile.version === profileVersion)) ??
    profiles.find(profile => profile.id === profileId) ??
    null
  );
}

function scoreSkill(skill: SkillEnvelope, phase: PhaseDefinition, profile: AuditProfile | null, audit: Record<string, any>) {
  const payload = skill.payload ?? {};
  if (payload.phase !== phase.id) return -1;
  let score = 100;

  const profileCitations = new Set(
    [
      ...(profile?.requiredProvisionIds ?? []),
      ...(Array.isArray(audit.requiredProvisionIds) ? audit.requiredProvisionIds : []),
    ].flatMap(citationTokens)
  );
  const skillCitations = new Set(
    [
      ...(payload.regulatoryRefs ?? []),
      ...(payload.part21Sections ?? []),
      ...(payload.appendixBCriteria ?? []).map(criterion => `Criterion ${criterion}`),
    ].flatMap(citationTokens)
  );
  const overlap = [...skillCitations].filter(token => profileCitations.has(token)).length;
  score += overlap * 10;
  if (skillCitations.size && profileCitations.size) score += 1;

  const caseType = String(profile?.caseType ?? "").toLowerCase();
  const haystack = `${skill.configId} ${payload.name ?? ""} ${payload.domain ?? ""} ${payload.purpose ?? ""}`.toLowerCase();
  const keywords: Record<string, string[]> = {
    "supplier-qualification": ["supplier", "commercial", "dedication", "procurement", "nonconformance"],
    "traceability-configuration": ["design", "configuration", "interface", "trace"],
  };
  for (const keyword of keywords[caseType] ?? []) {
    if (haystack.includes(keyword)) score += 3;
  }
  if (String(audit.standard ?? "").toLowerCase().includes("part 21") && /part21|21\.|appendix-b/.test(haystack)) score += 2;
  return score;
}

function chooseSkill(skills: SkillEnvelope[], phase: PhaseDefinition, profile: AuditProfile | null, audit: Record<string, any>) {
  const ranked = skills
    .map(skill => ({ skill, score: scoreSkill(skill, phase, profile, audit) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.skill.configId.localeCompare(b.skill.configId));
  if (!ranked.length) throw new Error(`No active governed skill is bound to audit phase ${phase.id}; baseline generation is blocked.`);
  return ranked[0].skill;
}

function descriptionFor(phase: PhaseDefinition, skill: SkillEnvelope) {
  const payload = skill.payload ?? {};
  const evidence = Array.isArray(payload.requiredEvidence) ? payload.requiredEvidence.filter(Boolean) : [];
  const refs = Array.isArray(payload.regulatoryRefs) ? payload.regulatoryRefs.filter(Boolean) : [];
  return [
    phase.description ?? "Audit phase work item.",
    `Governed skill: ${payload.name ?? skill.configId} (${skill.configId}@${skill.version}).`,
    payload.purpose ? `Why this matters: ${payload.purpose}` : "",
    evidence.length ? `Evidence to collect: ${evidence.join(", ")}.` : "",
    refs.length ? `Regulatory basis: ${refs.join("; ")}.` : "",
    payload.humanGate ? `Human gate: ${payload.humanGate}` : "Human review is required before this phase can be treated as complete.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function ensureAuditBaseline(auditId: string, principal: BaselinePrincipal) {
  const scope = String(auditId ?? "").trim();
  if (!scope) throw new Error("auditId is required to generate the audit baseline.");
  const audit = await getDomainRecordScoped<Record<string, any>>("audit", scope, scope);
  if (!audit) throw new Error(`Audit ${scope} is not available in the domain store.`);

  const [configurations, profileResult, existing] = await Promise.all([
    listControlledConfigurationPayloads<SkillPayload>("skill"),
    getAuditProfiles(),
    listKanbanItems(scope, principal),
  ]);
  const skills = configurations.filter((configuration): configuration is SkillEnvelope => {
    const payload = configuration.payload as SkillPayload;
    return Boolean(payload && typeof payload === "object" && typeof payload.phase === "string");
  });
  // The phase guide is a method configuration, not a phase-bound skill; read the full
  // active skill configuration set before filtering to executable phase skills.
  const phases = phaseDefinitions(configurations as SkillEnvelope[]);
  const profile = profileForAudit(audit, profileResult.profiles as AuditProfile[]);
  const existingKeys = new Set(
    (existing.items as KanbanItem[])
      .map(item => String(item.sourceRecordId ?? ""))
      .filter(Boolean)
  );
  const created: KanbanItem[] = [];
  const skipped: { phase: string; reason: string }[] = [];

  for (const phase of phases) {
    const sourceRecordId = `${BASELINE_SOURCE_PREFIX}${phase.id}`;
    if (existingKeys.has(sourceRecordId)) {
      skipped.push({ phase: phase.id, reason: "baseline card already exists" });
      continue;
    }
    const skill = chooseSkill(skills as SkillEnvelope[], phase, profile, audit);
    const result = await createKanbanItem(
      {
        auditId: scope,
        title: phase.label,
        description: descriptionFor(phase, skill),
        status: "backlog",
        priority: phase.id === "findings" ? "high" : "medium",
        attention: false,
        source: "audit",
        sourceRecordId,
        skillIds: [skill.configId],
        activeSkillId: skill.configId,
        baselinePhase: phase.id,
        baselineProfileId: profile?.id,
        baselineProfileVersion: profile?.version,
        createdBy: principal.id,
      },
      principal
    );
    if (result?.item) {
      created.push(result.item);
      existingKeys.add(sourceRecordId);
    }
  }

  const event = await appendAssuranceEvent({
    type: "audit.baseline_generated",
    actor: principal.id,
    auditId: scope,
    entityId: scope,
    payload: {
      profileId: profile?.id ?? null,
      profileVersion: profile?.version ?? null,
      phaseIds: phases.map(phase => phase.id),
      createdCardIds: created.map(item => item.id),
      skipped,
      source: "controlled-phase-guide+active-skill-contracts+audit-record",
    },
  });

  return {
    ok: true,
    source: "mysql-domain-records",
    auditId: scope,
    profile: profile ? { id: profile.id, version: profile.version, title: profile.title, caseType: profile.caseType ?? null } : null,
    phases: phases.map(phase => phase.id),
    created: created.map(item => ({ id: item.id, title: item.title, phase: item.baselinePhase, skillId: item.activeSkillId })),
    skipped,
    totalCards: existing.items.length + created.length,
    eventId: event.id,
    humanReviewRequired: true,
  };
}
