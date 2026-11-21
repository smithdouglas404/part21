import { useEffect, useState } from "react";
import { Play, Workflow } from "lucide-react";
import {
  Badge,
  Empty,
  ErrorNotice,
  Json,
  Panel,
  ResourceState,
} from "./Common";
import { AgentResponse } from "./Board";
import {
  id,
  label,
  payload,
  request,
  rows,
  scoped,
  text,
  useAction,
  useConfigurations,
  useResource,
  type Row,
} from "./api";

function hasAnswer(value: any) {
  return Array.isArray(value)
    ? value.length > 0
    : typeof value === "string"
      ? Boolean(value.trim())
      : value != null;
}
export function Skills({
  auditId,
  findingId,
  canWrite,
  initialSkillId,
}: {
  auditId: string;
  findingId: string;
  canWrite: boolean;
  initialSkillId?: string;
}) {
  const library = useResource("/api/nuclear/skills");
  const configuredPhases = useConfigurations("skill");
  const activity = useResource(scoped("/api/agentkit/activity", auditId));
  const board = useResource(scoped("/api/kanban", auditId));
  const [selectedId, setSelectedId] = useState("");
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [phase, setPhase] = useState("");
  const action = useAction();
  const libraryRows = rows(library.data, "skills");
  const skills = libraryRows.filter(envelope => {
    const value = payload(envelope);
    return Array.isArray(value.questions) || value.route || value.skillContract;
  });
  const phaseGuide = libraryRows.find(
    envelope => id(envelope) === "audit-phases"
  );
  const selectedEnvelope = skills.find(
    envelope =>
      `${id(envelope)}@${envelope.version ?? payload(envelope).version ?? ""}` ===
      selectedId
  );
  const selected = selectedEnvelope ? payload(selectedEnvelope) : null;
  const skillId = selected
    ? String(selected.id ?? selectedEnvelope?.configId ?? "")
    : "";
  const skillVersion = selectedEnvelope?.version ?? selected?.version;
  const skillStatus = selectedEnvelope?.status ?? selected?.status;
  const questions = selected ? rows(selected.questions, "questions") : [];
  const missing = questions.filter(
    question => question.required && !hasAnswer(answers[String(question.id)])
  );
  const guidePayload = phaseGuide ? payload(phaseGuide) : null;
  const controlledPhases: Row[] =
    guidePayload && typeof guidePayload === "object" && !Array.isArray(guidePayload)
      ? Object.entries(guidePayload)
          .filter(
            ([key, value]) =>
              /^\d+$/.test(key) && value && typeof value === "object"
          )
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, value]) => value as Row)
      : [];
  const storedPhases: Row[] = controlledPhases.length
    ? controlledPhases
    : configuredPhases.data.flatMap(envelope => {
        if (Array.isArray(envelope.payload)) return envelope.payload;
        const p = payload(envelope);
        return rows(p.phases, "phases");
      });
  const phases: Row[] = storedPhases.length
    ? storedPhases
    : [
        ...new Set(
          skills.map(envelope => payload(envelope).phase).filter(Boolean)
        ),
      ].map(name => ({ id: name, label: name }));
  const runs = rows(activity.data, "runs", "activity", "agents", "items");
  const baselineCards = rows(board.data, "items")
    .filter(item =>
      String(item.sourceRecordId ?? "").startsWith("AUDIT-BASELINE:")
    )
    .sort(
      (a, b) =>
        (Number.parseInt(String(a.title), 10) || 0) -
        (Number.parseInt(String(b.title), 10) || 0)
    );
  const phaseState = (index: number) => {
    const card = baselineCards[index];
    if (!card) return { tone: "gray", label: "Not started", skill: "" };
    const activation = (card.skillActivation ?? {}) as Row;
    const completion = Number(activation.completion ?? 0);
    const runStatus = String(activation.runStatus ?? "");
    const skill = String(card.activeSkillId ?? "No skill bound");
    if (card.status === "blocked" || runStatus === "failed")
      return { tone: "red", label: "Blocked", skill };
    if (runStatus === "ready_for_human_gate" && completion >= 100)
      return {
        tone: "green",
        label: `Skill complete · ${completion}% · human gate pending`,
        skill,
      };
    if (
      activation.status === "executed" ||
      card.status === "in_progress" ||
      card.status === "review"
    )
      return {
        tone: "amber",
        label:
          activation.status === "executed"
            ? `More context required${completion ? ` · ${completion}%` : ""}`
            : "Skill active · questions pending",
        skill,
      };
    return { tone: "gray", label: "Not started", skill };
  };
  useEffect(() => {
    setAnswers({});
  }, [selectedId, findingId]);
  const select = (envelope: Row) => {
    setSelectedId(
      `${id(envelope)}@${envelope.version ?? payload(envelope).version ?? ""}`
    );
  };
  useEffect(() => {
    if (!initialSkillId) return;
    const match = skills.find(envelope => id(envelope) === initialSkillId);
    if (match) select(match);
    // The library is loaded asynchronously; selecting is intentionally one-way
    // and does not override a later manual choice by the auditor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSkillId, library.data]);
  return (
    <div className="view-stack">
      <Panel
        title="Audit phase flow / PERT"
        subtitle="Phases and dependencies are read from controlled configuration. Presence in the library does not mean executed or complete."
        actions={
          <Badge>
            {baselineCards.filter(
              card =>
                (card.skillActivation as Row | undefined)?.runStatus ===
                "ready_for_human_gate"
            ).length}{" "}
            complete ·{" "}
            {baselineCards.filter(
              card =>
                card.status === "in_progress" ||
                (card.skillActivation as Row | undefined)?.status === "executed"
            ).length}{" "}
            active
          </Badge>
        }
      >
        <ResourceState resource={configuredPhases} />
        <ResourceState resource={board} />
        <div className="assurance-phase-flow">
          {phases.map((p, index) => {
            const state = phaseState(index);
            return (
              <div className="assurance-phase-unit" key={id(p) || index}>
                <button
                  className={`assurance-phase ${phase === id(p) ? "active" : ""} ${state.tone}`}
                  onClick={() => setPhase(phase === id(p) ? "" : id(p))}
                >
                  <Workflow size={15} />
                  <strong>{label(p)}</strong>
                  <small>{text(p.description, "Configured phase")}</small>
                  <small>
                    Governed skill: {state.skill || "not bound"}
                  </small>
                  <span className={`phase-state ${state.tone}`}>
                    {state.label}
                  </span>
                </button>
                {index < phases.length - 1 && (
                  <span className="assurance-phase-arrow">→</span>
                )}
              </div>
            );
          })}
        </div>
        {!phases.length && !configuredPhases.loading && (
          <Empty>No phase flow is configured.</Empty>
        )}
        <Json
          value={{
            phases: storedPhases,
            skillPhaseGroups: phases,
            actualRuns: runs,
          }}
          title="Exact phase dependencies and persisted execution evidence"
        />
      </Panel>
      <Panel
        title="Governed assurance skill library"
        subtitle={`Audit ${auditId} · finding ${findingId || "Not selected"}. Exact skill ID and revision are sent to the execution service.`}
        actions={<Badge>{skills.length} returned contracts</Badge>}
      >
        <ResourceState resource={library} />
        {!library.loading && !library.error && !skills.length && (
          <Empty>
            No configured skills available. Drafts are inspectable but cannot be
            run.
          </Empty>
        )}
        <div className="skill-library-layout">
          <div className="skill-card-grid">
            {skills
              .filter(envelope => !phase || payload(envelope).phase === phase)
              .map(envelope => {
                const skill = payload(envelope);
                const key = `${id(envelope)}@${envelope.version ?? skill.version ?? ""}`;
                return (
                  <button
                    className={`skill-card ${key === selectedId ? "active" : ""}`}
                    key={key}
                    onClick={() => select(envelope)}
                  >
                    <div className="skill-card-top">
                      <Workflow size={14} />
                      <Badge>{text(envelope.status ?? skill.status)}</Badge>
                    </div>
                    <strong>{label(skill)}</strong>
                    <p>{text(skill.purpose, "No purpose returned")}</p>
                    <small>
                      {id(envelope)} · {text(envelope.version ?? skill.version)}
                    </small>
                  </button>
                );
              })}
          </div>
          <div className="skill-detail">
            {selected ? (
              <>
                <div className="skill-detail-head">
                  <div>
                    <span className="tiny-label">
                      {skillId} · revision {text(skillVersion)}
                    </span>
                    <h3>{label(selected)}</h3>
                    <p>{text(selected.purpose, "")}</p>
                  </div>
                  <Badge>{text(selectedEnvelope?.status)}</Badge>
                </div>
                <small>
                  Route {text(selected.route)} · SHA-256{" "}
                  {text(
                    selectedEnvelope?.sourceSha256 ??
                      selectedEnvelope?.payloadSha256
                  )}
                </small>
                <p>Human gate: {text(selected.humanGate)}</p>
                <Json
                  value={selectedEnvelope}
                  title="Exact skill envelope, requirements, citations and tools"
                />
                <div className="assurance-form">
                  {questions.map(question => {
                    const key = String(question.id);
                    const options = Array.isArray(question.options)
                      ? question.options.map(String)
                      : [];
                    return (
                      <label key={key}>
                        {text(question.prompt)}
                        {question.required ? " *" : " (optional)"}
                        {question.input === "choice" ? (
                          <select
                            value={answers[key] ?? ""}
                            onChange={e =>
                              setAnswers({ ...answers, [key]: e.target.value })
                            }
                          >
                            <option value="">Select an answer</option>
                            {options.map(option => (
                              <option key={option}>{option}</option>
                            ))}
                          </select>
                        ) : question.input === "checklist" ? (
                          <div className="assurance-checklist">
                            {options.map(option => {
                              const chosen = Array.isArray(answers[key])
                                ? answers[key]
                                : [];
                              return (
                                <label key={option}>
                                  <input
                                    type="checkbox"
                                    checked={chosen.includes(option)}
                                    onChange={e =>
                                      setAnswers({
                                        ...answers,
                                        [key]: e.target.checked
                                          ? [...chosen, option]
                                          : chosen.filter(
                                              (v: string) => v !== option
                                            ),
                                      })
                                    }
                                  />
                                  {option}
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <textarea
                            value={answers[key] ?? ""}
                            onChange={e =>
                              setAnswers({ ...answers, [key]: e.target.value })
                            }
                            rows={3}
                          />
                        )}
                        <small>
                          {text(question.helper, "")}{" "}
                          {text(question.evidenceHint, "")}
                        </small>
                      </label>
                    );
                  })}
                  <ErrorNotice error={action.error} />
                  {missing.length > 0 && (
                    <small>
                      {missing.length} mandatory responses missing. Optional
                      answers cannot substitute.
                    </small>
                  )}
                  {!findingId && (
                    <Empty>
                      Select a real finding in the audit context bar before
                      running a finding-bound skill.
                    </Empty>
                  )}
                  <button
                    className="primary-button"
                    disabled={
                      action.busy ||
                      !canWrite ||
                      !findingId ||
                      !skillId ||
                      !skillVersion ||
                      skillStatus !== "active" ||
                      missing.length > 0
                    }
                    onClick={() =>
                      action.run(async () => {
                        const result = await request("/api/agentkit/run", {
                          auditId,
                          findingId,
                          skillId,
                          skillVersion,
                          answers,
                        });
                        activity.refresh();
                        return result;
                      })
                    }
                  >
                    <Play size={13} />
                    {action.busy
                      ? "Running exact revision…"
                      : "Run selected skill"}
                  </button>
                  {skillStatus !== "active" && (
                    <small>
                      This contract is not active. No execution is authorized by
                      viewing a draft.
                    </small>
                  )}
                </div>
                <AgentResponse response={action.result} />
              </>
            ) : (
              <Empty>
                Select a returned skill to inspect its exact version, questions,
                applicability, required evidence and human gate.
              </Empty>
            )}
          </div>
        </div>
      </Panel>
      <Panel
        title="Persisted AgentKit execution traces"
        subtitle="No simulation or phase completion is inferred."
      >
        <ResourceState resource={activity} />
        {!activity.loading && !activity.error && !runs.length && (
          <Empty>No persisted runs for this audit.</Empty>
        )}
        {runs.map((run, index) => (
          <Json
            value={run}
            key={`${id(run)}-${index}`}
            title={`${label(run, "Execution trace")} · ${text(run.traceId ?? run.id)} · ${text(run.status)}`}
          />
        ))}
        {activity.data && (
          <Json value={activity.data} title="Complete activity response" />
        )}
      </Panel>
    </div>
  );
}
export function GroundedChat({
  auditId,
  findingId,
}: {
  auditId: string;
  findingId: string;
}) {
  const [question, setQuestion] = useState("");
  const action = useAction();
  const status = useResource("/api/ai/status");
  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-intro">
        <div>
          <span className="tiny-label">LIVE GROUNDED ASSURANCE</span>
          <strong>Ask within the current audit and finding.</strong>
          <p>
            Audit {auditId} · finding {findingId || "Not selected"}. No
            alternate audit or default finding is permitted.
          </p>
        </div>
      </div>
      <ResourceState resource={status} />
      {status.data && (
        <Json value={status.data} title="Actual existing LLM/provider status" />
      )}
      <div className="chat-input-row">
        <textarea
          aria-label="Live graph question"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          rows={3}
          placeholder="Ask about the selected finding, evidence or temporal changes."
        />
        <button
          className="primary-button"
          disabled={action.busy || !findingId || !question.trim()}
          onClick={() =>
            action.run(() =>
              request("/api/ai/ask", {
                auditId,
                findingId,
                question,
                mode: "live",
              })
            )
          }
        >
          {action.busy ? "Requesting live model…" : "Ask live agent"}
        </button>
      </div>
      {!findingId && (
        <Empty>
          Select a persisted finding in this audit. Use card dialogue for
          unlinked intake work.
        </Empty>
      )}
      <ErrorNotice error={action.error} />
      <AgentResponse response={action.result} />
      {Array.isArray(action.result?.followUpQuestions) && (
        <div className="chat-followups">
          {action.result.followUpQuestions.map((q: any, index: number) => (
            <button key={index} onClick={() => setQuestion(text(q))}>
              {text(q)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
