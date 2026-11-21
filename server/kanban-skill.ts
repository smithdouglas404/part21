import { getControlledConfiguration } from "./config-store";
import {
  activateKanbanSkill,
  listKanbanItems,
  type KanbanSkillActivation,
} from "./kanban-store";
import type { EvidencePrincipal } from "./evidence-vault";

/**
 * Bind the card's governed skill to the card when work starts.
 *
 * The activation is persisted on the card and in the assurance event log. It
 * carries the exact skill revision and the questions the auditor must answer;
 * it does not claim the skill was executed or that a regulatory conclusion was
 * reached.
 */
export async function activateCardSkill(
  itemId: string,
  auditId: string,
  actor: string,
  principal?: EvidencePrincipal
) {
  const cards = await listKanbanItems(auditId, principal);
  const item = cards.items.find(card => card.id === itemId);
  if (!item) throw new Error("Card does not exist in this audit.");
  const skillId = item.activeSkillId ?? item.skillIds?.[0];
  if (!skillId) {
    return {
      ok: false,
      itemId,
      auditId,
      reason:
        "No governed skill is bound to this card. Add a finding-linked skill before relying on a stage move for evidence.",
    };
  }
  const configuration = await getControlledConfiguration<any>("skill", skillId);
  const contract = configuration.payload ?? {};
  const activation: KanbanSkillActivation = {
    skillId,
    skillVersion: configuration.version,
    skillName: String(contract.name ?? skillId),
    status: "questions_pending",
    activatedAt: new Date().toISOString(),
    activatedBy: actor,
    questions: Array.isArray(contract.questions) ? contract.questions : [],
    requiredEvidence: Array.isArray(contract.requiredEvidence)
      ? contract.requiredEvidence
      : [],
    humanGate: String(contract.humanGate ?? "Qualified human review required."),
  };
  const result = await activateKanbanSkill(
    itemId,
    auditId,
    actor,
    activation,
    principal
  );
  return {
    ...result,
    activation,
    skill: {
      id: skillId,
      name: activation.skillName,
      version: activation.skillVersion,
      purpose: String(contract.purpose ?? ""),
      humanGate: activation.humanGate,
      requiredEvidence: activation.requiredEvidence,
    },
  };
}
