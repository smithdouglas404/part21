import { citationsForPacket, regulatoryExcerptsFor } from "./regulatory-context";
import { buildPrecedentPacket } from "./precedent";
import { raiseAuditAlerts } from "./alerts";
import { part21ClockBrief } from "./part21-case";
import { createAgentServices, requireAgentScope, type AgentServices, type AgentScope, type AgentPrincipal, type AgentConversation, type AgentRecord, type GovernedSkill } from "./agent-runtime";
import { runAuditSkill, previewAuditSkill, prepareFindingDraftSnapshot, type AuditSkillInput } from "./agentkit";

// Preserve the existing live managed invokeLLM route; no Ollama or provider/key simulation.
export function getAiStatus() {
  const available = !!process.env.BUILT_IN_FORGE_API_KEY || !!process.env.MANUS_API_KEY;
  return { mode: available ? "managed-live" : "provider-unconfigured", provider: available ? "managed-invokeLLM" : null, keyStored: false, liveDemoAvailable: available, liveDemoModel: process.env.PART21_LLM_MODEL || "claude-haiku-4-5", sandboxEnvironmentProvider: null, keyStorage: "existing server runtime environment", configuredAt: null, note: "Actual response model and invocation status are recorded per run. No client-supplied key is stored by this module." };
}
export function configureAiProvider(_provider: "openai" | "anthropic", _key: string) {
  return { ok: false, status: getAiStatus(), error: "Provider configuration is managed by the authorized server configuration/secret boundary; no key was stored or provider changed." };
}
export interface GroundedQuestionOptions { principal: AgentPrincipal; actor?: string; skillId?: string; skillVersion?: string; answers?: Record<string, unknown>; evidenceBindings?: Record<string, string[]> }
function questionSkill(question: string) {
  const words = new Set(question.toLowerCase().match(/[a-z0-9-]+/g) ?? []);
  if (["trace", "genealogy", "changed", "baseline", "heat", "lot"].some(word => words.has(word))) return "trace-chain";
  if (["regulation", "requirement", "scope", "who"].some(word => words.has(word))) return "frame-scope";
  if (["evidence", "missing", "source"].some(word => words.has(word))) return "evidence-intake";
  return "finding-challenge";
}
function questionInput(question: string, auditId?: string, findingId?: string, options?: GroundedQuestionOptions): AuditSkillInput {
  if (!auditId || !findingId) throw new Error("Explicit auditId and findingId are required; no first-audit/finding fallback is allowed.");
  if (!options?.principal) throw new Error("A trusted audit-scoped principal is required.");
  return { auditId, findingId, actor: options.actor ?? options.principal.actor ?? options.principal.id, principal: options.principal, skillId: options.skillId ?? questionSkill(question), skillVersion: options.skillVersion, answers: options.answers ?? {}, evidenceBindings: options.evidenceBindings };
}
/** Shape check for the narrative requirement: prose paragraphs, not bullet fragments. */
export function narrativeShape(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const bulletLines = text.split("\n").filter(line => /^\s*([-*•]|\d+\.)\s+/.test(line)).length;
  const longest = paragraphs.reduce((max, part) => Math.max(max, part.split(/\s+/).filter(Boolean).length), 0);
  return { words, paragraphs: paragraphs.length, bulletLines, longestParagraphWords: longest, compliant: words >= 140 && paragraphs.length >= 3 && bulletLines === 0 && longest >= 60 };
}
export function buildLlmGroundingPacket(run: Awaited<ReturnType<typeof previewAuditSkill>>) {
  return { auditId: run.auditId, findingId: run.findingId ?? null, traceId: run.traceId, appliedSkill: run.appliedSkill, skillContract: run.skillContract, skillRevision: run.skillRevision, skillHash: run.skillHash, configurationStatus: run.configurationStatus, graphSource: run.graph?.source ?? null, schema: run.graph?.schema ?? null, ontologyVersion: run.graph?.ontologyVersion ?? null, nodeCount: run.graph?.nodes.length ?? 0, edgeCount: run.graph?.edges.length ?? 0, temporalEventCount: run.graph?.temporalEvents.length ?? 0, graphSnapshot: run.graph ? { nodes: run.graph.nodes, edges: run.graph.edges, temporalEvents: run.graph.temporalEvents } : null, traversalProof: run.traversalProof, sourceIds: run.sourceIds, executedTools: run.toolCalls, answers: run.answers, policy: run.policy, unknowns: run.unknowns, followUpQuestions: run.followUpQuestions, humanGate: run.humanGate, factBoundary: "Only exact supplied database records and completed tool results are facts. Questions and answers are assertions, not verified evidence. No inferred supplier substitutions, record counts, clocks, approvals, regulatory paths, or final verdicts. Human review required." };
}
export async function answerGroundedQuestion(question: string, auditId?: string, findingId?: string, options?: GroundedQuestionOptions, services = createAgentServices()) {
  const input = questionInput(question, auditId, findingId, options);
  const run = await previewAuditSkill(input, services);
  return { ...run, question, answer: run.graph ? run.recommendation : "Audit portfolio questions only. Graph provider unavailable or unlinked; no graph traversal or recommendation is claimed.", appliedSkill: run.skillId, skillInvocation: run.appliedSkill, activeAuditId: input.auditId, provider: "provider not invoked", model: null, llmInvoked: false, invocationMode: "read-only skill preview", groundedContextPacket: buildLlmGroundingPacket(run) };
}
async function invokeGrounded(run: Awaited<ReturnType<typeof previewAuditSkill>>, question: string, services: AgentServices, communicationContext?: AgentRecord) {
  const skillForCitations = (run as any)?.skillContract && typeof (run as any).skillContract === "object" ? (run as any).skillContract : null;
  const regulatoryExcerpts = await regulatoryExcerptsFor(citationsForPacket({ clockBrief: communicationContext?.part21Clocks ?? null, skill: skillForCitations })).catch(() => []);
  const precedentTraversal = await buildPrecedentPacket({ auditId: run.auditId, findingId: run.findingId ?? null, question }).catch(() => null);
  const packet = {
    ...buildLlmGroundingPacket(run),
    ...(communicationContext ? { communicationContext, ...(communicationContext.part21Clocks ? { part21Clocks: communicationContext.part21Clocks } : {}) } : {}),
    ...(regulatoryExcerpts.length ? { regulatoryExcerpts } : {}),
    ...(precedentTraversal ? { precedentTraversal } : {}),
  };
  if (!run.graph) return { ...run, answer: "Audit portfolio questions only. No audit-scoped graph traversal is available; provider not invoked and no recommendation issued.", provider: "provider not invoked", model: null, llmInvoked: false, groundedContextPacket: packet };
  const requestedModel = process.env.PART21_LLM_MODEL || "claude-haiku-4-5";
  const call = { id: services.id(), sequence: run.toolCalls.length + 1, tool: "llm.invokeLLM", arguments: { requestedModel, auditId: run.auditId, findingId: run.findingId, packet }, status: "completed" as "completed" | "unknown", result: {} as AgentRecord, sourceIds: run.sourceIds, startedAt: services.now(), completedAt: "" };
  try {
    const response = await services.invoke({ model: requestedModel, maxTokens: 1200, messages: [
      { role: "system", content: "You are a nuclear assurance recommendation assistant, not a regulatory decision maker. Use only the supplied audited database/tool packet. Preserve the applied skill ID, revision and draft/active status. Ask the unanswered required questions individually. Label missing evidence unknown. Never invent facts, legal clocks, approvals, supplier substitutions, affected record counts, or compliance conclusions. Candidate draft guidance has no regulatory approval. When the packet contains part21Clocks, report the next open gate with its citation, due date and days remaining exactly as computed, and ask the one question needed to close that gate. Never compute, extend or restart a statutory clock yourself. When the packet contains regulatoryExcerpts, you may quote that text verbatim and must attribute it to the cited provision and snapshot date; quoted regulation is not a finding, an interpretation or a decision. WRITING FORM: every insight and recommendation must be narrative prose of at least three paragraphs and roughly 220 to 400 words. Never answer with one sentence, a bullet list, or a stack of labelled fragments. Paragraph one states what the records show and names the record IDs, severities, owners and dates. Paragraph two states what precedentTraversal shows about earlier audits, citing the audit and finding IDs it returns; if it reports no comparable finding, say so plainly and treat that absence as unknown rather than as evidence that the control held. Paragraph three states the recommendation, the citation that supports it, the evidence still missing and the human decision required. Use complete sentences and connect the reasoning between paragraphs. A terse answer is a defect even when every fact in it is correct." },
      { role: "user", content: `${question}\n\nAudit-scoped grounding packet:\n${JSON.stringify(packet)}` },
    ] });
    if ((response as any).error) throw new Error(String((response as any).error.message ?? "Provider returned an error"));
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("Provider returned no narrative; no substitute recommendation is generated.");
    let narrative = content;
    if (!narrativeShape(content).compliant) {
      const expansion = await services.invoke({ model: requestedModel, maxTokens: 1200, messages: [
        { role: "system", content: "You rewrite a terse nuclear assurance answer as narrative prose. Preserve every fact, record ID, citation and uncertainty exactly; add no new facts, clocks or conclusions. Produce at least three paragraphs and roughly 220 to 400 words in complete sentences with no bullet lists: first what the records show, second what prior audits show or that no precedent exists, third the recommendation, the supporting citation, the missing evidence and the human decision required." },
        { role: "user", content: `Question: ${question}\n\nGrounded packet:\n${JSON.stringify(packet)}\n\nTerse answer to rewrite:\n${content}` },
      ] }).catch(() => null);
      const expanded = (expansion as any)?.choices?.[0]?.message?.content;
      if (typeof expanded === "string" && narrativeShape(expanded).words > narrativeShape(content).words) narrative = expanded;
    }
    call.result = { responseId: response.id ?? null, requestedModel, actualModel: response.model || null, usage: response.usage ?? null, answer: narrative, narrative: narrativeShape(narrative) };
    call.completedAt = services.now();
    if (run.durable) await services.recordTool(run.traceId, call);
    const raised = await raiseAuditAlerts(run.auditId, run.findingId ?? null).catch(() => null);
    const result = { ...run, toolCalls: [...run.toolCalls, call], question, answer: narrative, narrative: narrativeShape(narrative), precedentTraversal, ...(raised ? { alerts: raised.alerts, alertPersist: { inserted: raised.inserted, existing: raised.existing } } : {}), provider: "managed-invokeLLM", model: response.model || null, requestedModel, modelIdentityStatus: response.model ? "response-reported" : "unknown", llmInvoked: true, invocationMode: "live grounded recommendation", groundedContextPacket: packet, usage: response.usage, warning: null, humanReviewRequired: true };
    if (run.durable) await services.finishRun(result);
    return result;
  } catch (error) {
    call.status = "unknown"; call.completedAt = services.now(); call.result = { error: error instanceof Error ? error.message : String(error), requestedModel, actualModel: null };
    if (run.durable) { await services.recordTool(run.traceId, call); await services.finishRun({ ...run, toolCalls: [...run.toolCalls, call], status: "provider_unavailable", llmInvoked: false, model: null, unknowns: [...run.unknowns, call.result.error] }); }
    return { ...run, toolCalls: [...run.toolCalls, call], status: "provider_unavailable", answer: "Provider unavailable; no AI recommendation issued. Use the grounded required questions.", provider: "provider unavailable", model: null, requestedModel, llmInvoked: false, unknowns: [...run.unknowns, call.result.error], groundedContextPacket: packet, warning: null };
  }
}
export async function answerLiveGroundedQuestion(question: string, auditId?: string, findingId?: string, options?: GroundedQuestionOptions, services = createAgentServices()) {
  const input = questionInput(question, auditId, findingId, options);
  const run = await runAuditSkill(input, {}, undefined, services);
  const response = await invokeGrounded(run, question, services);
  return { ...response, appliedSkill: run.skillId, skillInvocation: run.appliedSkill, activeAuditId: input.auditId };
}
export async function buildLiveAuditBriefAgent(auditId: string, question = "Give me a fact-based audit brief.", options?: GroundedQuestionOptions, services = createAgentServices()) {
  if (!options?.principal) throw new Error("Trusted principal is required for a live audit brief.");
  const scope: AgentScope = { auditId, actor: options.actor ?? options.principal.actor ?? options.principal.id, principal: options.principal };
  requireAgentScope(scope, "agent:write");
  const portfolio = await services.portfolio(auditId);
  if (portfolio.audit?.id !== auditId) throw new Error("Audit portfolio scope mismatch.");
  const findings = portfolio.findings;
  if (!findings.length) return { auditId, answer: "No persisted findings exist in this audit. No finding selected, graph traversed, or model invoked.", llmInvoked: false, model: null, humanReviewRequired: true };
  const components = [];
  for (const finding of findings) {
    const run = await runAuditSkill({ ...scope, findingId: String(finding.id), skillId: options.skillId ?? "frame-scope", skillVersion: options.skillVersion, answers: options.answers ?? {}, evidenceBindings: options.evidenceBindings }, {}, undefined, services);
    components.push(await invokeGrounded(run, question, services));
  }
  return { auditId, answer: components.map(row => `${row.findingId}: ${row.answer}`).join("\n\n"), components, traceIds: components.map(row => row.traceId), llmInvoked: components.some(row => row.llmInvoked), provider: "managed-invokeLLM", humanReviewRequired: true };
}

export interface FindingIntakeInput {
  auditId: string; message: string; principal?: AgentPrincipal; actor?: string; findingId?: string; conversationId?: string; expectedRevision?: number;
  itemId?: string; kanbanItemId?: string; attachmentIds?: string[]; skillId?: string; skillVersion?: string; skillIds?: string[]; answers?: Record<string, unknown>; evidenceBindings?: Record<string, string[]>;
  finalize?: boolean; approvalDecisionId?: string; draftTitle?: string; draftDescription?: string; severity?: string; channel?: "web" | "muse" | "voice";
}
function intakeScope(input: FindingIntakeInput, write: boolean): AgentScope {
  if (!input.principal) throw new Error("Trusted principal is required for intake; request actor text is not authority.");
  const scope = { auditId: input.auditId, findingId: input.findingId, actor: input.actor ?? input.principal.actor ?? input.principal.id, principal: input.principal };
  requireAgentScope(scope, write ? "agent:write" : "agent:read");
  if (!input.message?.trim()) throw new Error("message is required.");
  if (input.itemId && input.kanbanItemId && input.itemId !== input.kanbanItemId) throw new Error("Conflicting itemId/kanbanItemId.");
  const inline = input as FindingIntakeInput & { base64?: unknown; bytes?: unknown; photo?: unknown; voice?: unknown; audio?: unknown };
  if (inline.base64 || inline.bytes || inline.photo || inline.voice || inline.audio) throw new Error("Inline photo/voice bytes are not accepted here; use the managed evidence agent to retain originals, then pass attachmentIds belonging to this card.");
  return scope;
}
export function selectIntakeSkills(rows: GovernedSkill[], card: AgentRecord | null, input: FindingIntakeInput, existing?: AgentConversation | null) {
  const explicit = input.skillId ? [input.skillId] : input.skillIds?.length ? input.skillIds : existing?.skillsApplied?.map((row: AgentRecord) => row.id) ?? (card?.activeSkillId ? [card.activeSkillId] : []);
  const stage = card?.status ?? "backlog";
  const ids = explicit.length ? explicit : [stage === "review" || stage === "final" ? "readiness-close" : stage === "in_progress" && card?.findingId ? "finding-challenge" : "frame-scope"];
  if (!(card?.attachmentIds?.length) && !ids.includes("evidence-intake")) ids.push("evidence-intake");
  // Only an explicit existing case/evidence-state linkage can select a nuclear candidate; never title resemblance.
  for (const row of rows) if (card && row.kind === "skill_candidate" && card.caseType === row.payload.domain && (card.missingEvidence ?? []).some((kind: string) => row.payload.requiredEvidence?.includes(kind)) && !ids.includes(row.configId)) ids.push(row.configId);
  return ids.map((id: string) => {
    const pinnedVersion = input.skillId === id ? input.skillVersion : existing?.skillsApplied?.find((row: AgentRecord) => row.id === id)?.version;
    const matches = rows.filter(row => row.configId === id && (!pinnedVersion || row.version === pinnedVersion));
    if (matches.length !== 1) throw new Error(`Dialogue skill ${id} is missing or has ambiguous revisions; select an exact version.`);
    return matches[0];
  });
}
async function prepareIntake(input: FindingIntakeInput, services: AgentServices, write: boolean) {
  const scope = intakeScope(input, write);
  const portfolio = await services.portfolio(input.auditId);
  if (portfolio.audit?.id !== input.auditId) throw new Error("Intake audit mismatch.");
  const requestedItemId = input.itemId ?? input.kanbanItemId;
  const cards = await services.records("kanban_item", input.auditId);
  const card = requestedItemId ? cards.find(row => row.id === requestedItemId) : null;
  if (requestedItemId && (!card || card.auditId !== input.auditId)) throw new Error("Supplied existing card does not belong to this audit.");
  const conversationId = input.conversationId ?? card?.conversationId;
  const existing = conversationId ? await services.conversation(conversationId, input.auditId) : null;
  if (conversationId && !existing) throw new Error("Supplied conversation does not exist; it cannot silently create a new dossier.");
  if (existing && (existing.auditId !== input.auditId || existing.ownerPrincipalId !== scope.principal.id)) throw new Error("Conversation audit/owner mismatch.");
  if (existing && requestedItemId && requestedItemId !== existing.kanbanItemId) throw new Error("Conversation card cannot be reassigned.");
  if (card?.conversationId && card.conversationId !== existing?.id) throw new Error("Card is linked to another conversation.");
  if (existing && input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) throw new Error("Conversation revision conflict; reload before appending.");
  const itemId = existing?.kanbanItemId ?? requestedItemId;
  const findingId = input.findingId ?? card?.findingId;
  if (input.findingId && card?.findingId && input.findingId !== card.findingId) throw new Error("Card/finding mismatch.");
  if (findingId && !portfolio.findings.some(row => row.id === findingId)) throw new Error("Finding does not belong to this audit.");
  const attachmentIds = [...new Set([...(existing?.attachmentIds ?? []), ...(input.attachmentIds ?? [])])];
  const attachments = await services.records("kanban_attachment", input.auditId);
  for (const id of attachmentIds) if (!itemId || !attachments.some(row => row.id === id && row.auditId === input.auditId && row.itemId === itemId)) throw new Error("Attachment must already belong to the selected audit/card; evidence upload uses the evidence agent.");
  const selections = selectIntakeSkills(await services.skills(true), card ?? null, input, existing);
  return { scope: { ...scope, findingId }, portfolio, existing, card: card ?? null, itemId, attachmentIds, attachments: attachments.filter(row => attachmentIds.includes(row.id)), selections };
}
async function intakeDialogue(input: FindingIntakeInput, services: AgentServices, persist: boolean) {
  const context = await prepareIntake(input, services, persist);
  if (input.finalize && !persist) throw new Error("Read-only preview cannot finalize.");
  if (input.finalize && (!input.approvalDecisionId || !services.finalizeFinding)) throw new Error("Finalization requires a persisted authorized approvalDecisionId and parent finding-approval gate; no draft, approval, or graph writes performed.");
  if (input.finalize && (!input.draftTitle?.trim() || !input.draftDescription?.trim())) throw new Error("Specific draftTitle and draftDescription are required before finalization.");
  if (input.finalize && (!context.existing || !context.itemId)) throw new Error("Finalization requires an existing card-owned conversation; no dossier was created.");
  let approvedDraft: ReturnType<typeof prepareFindingDraftSnapshot> | null = null;
  if (input.finalize) {
    approvedDraft = prepareFindingDraftSnapshot({ title: input.draftTitle!, description: input.draftDescription!, severity: input.severity ?? null, auditId: input.auditId, findingId: context.scope.findingId ?? null, conversationId: context.existing?.id ?? null, kanbanItemId: context.itemId ?? null, sourceTraceIds: [] });
    const decisions = await services.records("finding_approval_decision", input.auditId);
    const approved = decisions.find(row => row.id === input.approvalDecisionId);
    if (!approved || approved.auditId !== input.auditId || approved.status !== "approved" || approved.principalId !== context.scope.principal.id || approved.artifactSha256 !== approvedDraft.artifactSha256) throw new Error("Persisted finding approval decision does not authorize this exact draft/principal; no finalization performed.");
  }
  const part21Clocks = await part21ClockBrief(input.auditId).catch(() => null);
  const runs = [];
  for (const row of context.selections) {
    const request: AuditSkillInput = { ...context.scope, skillId: row.configId, skillVersion: row.version, answers: input.answers ?? {}, evidenceBindings: input.evidenceBindings, mode: row.kind === "skill_candidate" || !row.approvedBy || !row.approvedAt ? "preview" : "runtime" };
    const run = persist ? await runAuditSkill(request, {}, undefined, services) : await previewAuditSkill(request, services);
    runs.push(run);
  }
  const skillsApplied = runs.map(run => run.appliedSkill);
  const conversationId = context.existing?.id ?? services.id();
  const cardId = context.itemId ?? services.id();
  const questions = [...new Set(runs.flatMap(run => run.followUpQuestions))];
  const skillLabel = skillsApplied.map(row => `${row.id}@${row.version} [${row.configurationStatus}; human gate pending]`).join(", ");
  let answer = `${skillLabel}\n${runs.some(run => run.graph) ? "Source-linked tools were dispatched. Required answers and evidence still require qualified review." : "Grounded audit portfolio questions only; graph unavailable/unlinked: no graph traversal or regulatory recommendation is claimed."}\n${questions.map(question => `- ${question}`).join("\n")}`;
  let live: Awaited<ReturnType<typeof invokeGrounded>> | null = null;
  const liveRun = runs.find(run => run.graph);
  if (liveRun) {
    live = await invokeGrounded(liveRun, input.message, services, { auditId: input.auditId, findingId: context.scope.findingId, conversationId, kanbanItemId: cardId, expectedRevision: context.existing?.revision ?? 0, part21Clocks, priorTurns: context.existing?.turns ?? [], currentMessage: input.message, attachments: context.attachments, appliedSkills: skillsApplied, allSkillTraces: runs.map(run => ({ traceId: run.traceId, appliedSkill: run.appliedSkill, toolCalls: run.toolCalls, unknowns: run.unknowns, followUpQuestions: run.followUpQuestions })), factBoundary: "User turns, transcripts, and photo metadata are unverified assertions unless supported by retained source records; original bytes are handled by the evidence agent. Never infer cross-card or cross-audit links." });
    answer = `${skillLabel}\n${live.answer}`;
  }
  const now = services.now();
  const turnSkills = skillsApplied.map(row => ({ id: row.id, version: row.version, sourceSha256: row.sourceSha256, configurationStatus: row.configurationStatus }));
  const userTurn = { id: services.id(), role: "user", actor: context.scope.actor, text: input.message, auditId: input.auditId, findingId: context.scope.findingId ?? null, itemId: cardId, conversationId, attachmentIds: context.attachmentIds, channel: input.channel ?? "web", skillsApplied: turnSkills, createdAt: now };
  const agentTurn = { id: services.id(), role: "agent", actor: "Part21 skill dispatcher", text: answer, auditId: input.auditId, findingId: context.scope.findingId ?? null, itemId: cardId, conversationId, channel: input.channel ?? "web", skillsApplied: turnSkills, traceIds: runs.map(run => run.traceId), model: live?.model ?? null, llmInvoked: live?.llmInvoked ?? false, createdAt: now };
  const conversation: AgentConversation = { ...(context.existing ?? {}), id: conversationId, auditId: input.auditId, ownerPrincipalId: context.scope.principal.id, kanbanItemId: cardId, findingId: context.scope.findingId ?? null, revision: (context.existing?.revision ?? 0) + 1, turns: [...(context.existing?.turns ?? []), userTurn, agentTurn], attachmentIds: context.attachmentIds, skillsApplied, traceIds: [...(context.existing?.traceIds ?? []), ...runs.map(run => run.traceId)], status: "awaiting_user", graphWrite: "not_performed" };
  const card = { ...(context.card ?? { id: cardId, auditId: input.auditId, title: input.message.slice(0, 96), description: input.message, status: "backlog", source: "agent", attention: true, createdBy: context.scope.actor, createdAt: now, attachmentIds: [] }), conversationId, skillIds: turnSkills.map(row => row.id), activeSkillId: turnSkills[0]?.id, skillsApplied: turnSkills };
  const communications = [userTurn, agentTurn].map(turn => ({ ...turn, skillIds: turnSkills.map(row => row.id) }));
  if (persist) await services.commitDialogue({ scope: context.scope, conversation, expectedRevision: context.existing?.revision ?? 0, card, createCard: !context.card, communications });
  let finalization: any = null;
  if (input.finalize) {
    finalization = await services.finalizeFinding!({ ...context.scope, approvalDecisionId: input.approvalDecisionId!, draft: { ...approvedDraft!.artifact, conversationId, kanbanItemId: cardId, sourceTraceIds: runs.map(run => run.traceId) } });
  }
  return { conversationId: persist ? conversationId : context.existing?.id ?? null, kanbanItemId: persist ? cardId : context.itemId ?? null, auditId: input.auditId, findingId: context.scope.findingId ?? null, revision: persist ? conversation.revision : context.existing?.revision ?? 0, answer, awaitingUser: true, skillsApplied, runs: live ? runs.map(run => run.traceId === live!.traceId ? live : run) : runs, llmInvoked: live?.llmInvoked ?? false, provider: live?.provider ?? "provider not invoked; executable skill guidance", model: live?.model ?? null, groundedContextPacket: live?.groundedContextPacket ?? null, part21Clocks, preview: !persist, persisted: persist, graphProjection: "not_performed", humanReviewRequired: true, finalization, grounding: { source: context.portfolio.source, graphTraversed: runs.some(run => run.graph), graphGroundedFindings: runs.filter(run => run.graph).map(run => run.findingId), factBoundary: "No title-based links, invented facts, or legal decisions." }, traceability: { turnsStored: persist ? conversation.turns.length : context.existing?.turns.length ?? 0, kanbanItemId: persist ? cardId : null, traceIds: runs.map(run => run.traceId), atomicAppend: persist } };
}
/** WRITE: authenticated make_changes token required even before a finding is finalized. */
export function runFindingIntakeDialogue(input: FindingIntakeInput, services = createAgentServices()) { return intakeDialogue(input, services, true); }
/** READ ONLY: no run, card, conversation, communication, event, or draft is persisted. */
export function previewFindingIntakeDialogue(input: FindingIntakeInput, services = createAgentServices()) { return intakeDialogue(input, services, false); }
export async function acknowledgeComplianceWarning(input: { warningId: string; traceId?: string; actor: string; rationale: string; auditId?: string; principal?: AgentPrincipal }, services = createAgentServices()) {
  if (!input.auditId || !input.principal) throw new Error("Trusted audit scope is required.");
  requireAgentScope({ auditId: input.auditId, actor: input.actor, principal: input.principal }, "agent:write");
  const warnings = await services.records("warning", input.auditId);
  const warning = warnings.find(row => row.id === input.warningId && (!input.traceId || row.traceId === input.traceId));
  if (!warning) throw new Error("Warning does not exist in this audit/run.");
  if (!services.recordWarningDecision) return { ok: false, status: "blocked", error: "Parent warning-decision gate is not configured; no acknowledgement was persisted." };
  return services.recordWarningDecision({ auditId: input.auditId, actor: input.actor, principal: input.principal, warning, decision: "acknowledged", rationale: input.rationale });
}
