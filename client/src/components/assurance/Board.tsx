import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  MessageSquare,
  Mic,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Workflow,
} from "lucide-react";
import {
  Badge,
  Empty,
  ErrorNotice,
  Inspector,
  Json,
  Panel,
  ResourceState,
} from "./Common";
import {
  download,
  fileBase64,
  formatWhen,
  id,
  label,
  payload,
  request,
  rows,
  scoped,
  storageGet,
  storageSet,
  text,
  useAction,
  useResource,
  type Row,
} from "./api";

// Stage labels are presentation metadata, never operational records or completion claims.
const stages = [
  { id: "backlog", label: "Backlog" },
  { id: "in_progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "review", label: "Review" },
  { id: "final", label: "Final · report approval only" },
];
export function assetId(row: Row) {
  return String(
    row.assetId ??
      row.vaultAssetId ??
      row.evidenceAssetId ??
      row.originalAssetId ??
      ""
  );
}

function hasSkillAnswer(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(hasSkillAnswer);
  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function skillStateLabel(value: unknown) {
  const state = String(value ?? "").trim();
  if (state === "questions_pending") return "Questions pending";
  if (state === "executed") return "Trace recorded";
  if (state === "needs_more_context") return "More context required";
  if (state === "ready_for_human_gate") return "Ready for human review";
  if (state === "failed") return "Run failed";
  return state ? state.replaceAll("_", " ") : "Awaiting activation";
}

function baselineSignal(card: Row): {
  tone: "red" | "amber" | "green" | "gray";
  label: string;
  percent: number;
  detail: string;
} {
  const activation = card.skillActivation as Row | undefined;
  const completion = Math.max(
    0,
    Math.min(100, Number(activation?.completion ?? 0))
  );
  const runStatus = String(activation?.runStatus ?? "");
  const status = String(card.status ?? "backlog");
  if (status === "blocked" || runStatus === "failed")
    return {
      tone: "red",
      label: "Red · blocked",
      percent: completion,
      detail:
        "The phase is blocked or its skill failed. Open the card to see the missing fact or evidence.",
    };
  if (runStatus === "ready_for_human_gate" && completion >= 100)
    return {
      tone: "green",
      label: "Green · skill complete",
      percent: 100,
      detail:
        "The governed questions and evidence are complete. A qualified human gate still applies before the phase is closed.",
    };
  if (
    activation?.status === "executed" ||
    status === "in_progress" ||
    status === "review"
  )
    return {
      tone: "amber",
      label:
        activation?.status === "executed"
          ? "Amber · more context"
          : "Amber · in progress",
      percent: completion,
      detail:
        activation?.status === "executed"
          ? "The skill has run but still needs context, evidence or a human gate."
          : "The governed skill is active. Answer its questions and run the check to complete the phase.",
    };
  return {
    tone: "gray",
    label: "Gray · not started",
    percent: 0,
    detail:
      "Move the card out of Backlog to activate its governed skill and questions.",
  };
}

function CardSkillCheck({
  auditId,
  item,
  canWrite,
  refresh,
  skillMeta,
}: {
  auditId: string;
  item: Row;
  canWrite: boolean;
  refresh: () => void;
  skillMeta: Map<string, { name: string; version: string }>;
}) {
  const action = useAction();
  const activation = item.skillActivation as Row | undefined;
  const questions = Array.isArray(activation?.questions)
    ? (activation!.questions as Row[])
    : [];
  const skillId = String(activation?.skillId ?? item.activeSkillId ?? "").trim();
  const skillVersion = String(
    activation?.skillVersion ?? item.skillVersion ?? ""
  ).trim();
  const skillName =
    text(activation?.skillName) ||
    skillMeta.get(skillId)?.name ||
    skillId ||
    "No governed skill bound";
  const evidenceRegister = useResource(scoped("/api/evidence/records", auditId));
  const existingEvidence = rows(evidenceRegister.data, "evidence", "items");
  const requirements = Array.isArray(activation?.requiredEvidence)
    ? (activation!.requiredEvidence as unknown[]).map(value => String(value))
    : [];
  const persistedAnswers =
    activation?.answers && typeof activation.answers === "object"
      ? (activation.answers as Record<string, unknown>)
      : {};
  const persistedBindings =
    activation?.evidenceBindings &&
    typeof activation.evidenceBindings === "object"
      ? (activation.evidenceBindings as Record<string, string[]>)
      : {};
  const [answers, setAnswers] =
    useState<Record<string, unknown>>(persistedAnswers);
  const [evidenceBindings, setEvidenceBindings] = useState<
    Record<string, string[]>
  >(persistedBindings);
  const [result, setResult] = useState<Row | null>(null);
  useEffect(() => {
    setAnswers(persistedAnswers);
    setEvidenceBindings(persistedBindings);
  }, [item.traceId, activation?.traceId]);
  const linkedEvidenceCount = new Set(
    Object.values(evidenceBindings).flat()
  ).size;
  const missing = questions.filter(
    question => question.required && !hasSkillAnswer(answers[String(question.id)])
  );
  if (!skillId) {
    return (
      <div className="card-skill-check card-skill-empty">
        <span className="tiny-label">GOVERNED SKILL CHECK</span>
        <p>
          This card has no governed skill bound. Add a finding-linked card or
          assign a skill before using the stage move as evidence of completion.
        </p>
      </div>
    );
  }
  return (
    <div className="card-skill-check">
      <div className="card-skill-head">
        <div>
          <span className="tiny-label">GOVERNED SKILL CHECK</span>
          <strong>{skillName}</strong>
          <small>
            {skillVersion || "Revision recorded in the skill library"} ·{" "}
            {skillStateLabel(activation?.status)}
          </small>
        </div>
        <Badge>
          <ShieldCheck size={11} /> Human gate
        </Badge>
      </div>
      {!activation && (
        <p className="card-skill-guidance">
          Moving this card out of Backlog activates the skill and brings its
          questions here. The questions are loaded from the governed contract,
          not written by this screen.
        </p>
      )}
      {activation && (
        <>
          <p className="card-skill-guidance">
            {text(
              activation.humanGate,
              "A qualified reviewer must approve the result before it is used as a finding or closure decision."
            )}
          </p>
          {Array.isArray(activation.advisories) &&
            activation.advisories.length > 0 && (
              <div className="card-skill-advisory">
                <strong>Open governance condition</strong>
                <ul>
                  {activation.advisories.map((advisory: unknown, index: number) => (
                    <li key={index}>{text(advisory)}</li>
                  ))}
                </ul>
                <small>
                  This condition is reserved for a qualified human reviewer. It
                  does not mean the auditor left a required answer blank.
                </small>
              </div>
            )}
          {questions.length === 0 && (
            <p className="card-skill-guidance">
              This skill has no required questions. Run the check to record a
              trace against the card.
            </p>
          )}
          {questions.map(question => {
            const questionId = String(question.id ?? "");
            const value = answers[questionId];
            return (
              <label className="card-skill-question" key={questionId}>
                <span>
                  {text(question.prompt, questionId)}
                  {question.required ? " *" : ""}
                </span>
                {text(question.helper) && <small>{text(question.helper)}</small>}
                {question.input === "choice" &&
                Array.isArray(question.options) ? (
                  <select
                    value={String(value ?? "")}
                    onChange={event =>
                      setAnswers(previous => ({
                        ...previous,
                        [questionId]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select an answer</option>
                    {question.options.map((option: unknown) => (
                      <option key={text(option)} value={text(option)}>
                        {text(option)}
                      </option>
                    ))}
                  </select>
                ) : question.input === "checklist" &&
                  Array.isArray(question.options) ? (
                  <span className="card-skill-checklist">
                    {question.options.map((option: unknown) => {
                      const optionValue = text(option);
                      const selected = Array.isArray(value)
                        ? value.map(String).includes(optionValue)
                        : false;
                      return (
                        <label key={optionValue}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={event =>
                              setAnswers(previous => {
                                const current = Array.isArray(previous[questionId])
                                  ? previous[questionId].map(String)
                                  : [];
                                return {
                                  ...previous,
                                  [questionId]: event.target.checked
                                    ? [...current, optionValue]
                                    : current.filter(item => item !== optionValue),
                                };
                              })
                            }
                          />
                          {optionValue}
                        </label>
                      );
                    })}
                  </span>
                ) : (
                  <textarea
                    rows={2}
                    value={String(value ?? "")}
                    onChange={event =>
                      setAnswers(previous => ({
                        ...previous,
                        [questionId]: event.target.value,
                      }))
                    }
                  />
                )}
                {text(question.evidenceHint) && (
                  <small className="card-skill-evidence">
                    Evidence hint: {text(question.evidenceHint)}
                  </small>
                )}
              </label>
            );
          })}
          {requirements.length > 0 && (
            <details className="card-evidence-bindings">
              <summary>
                Link existing evidence
                <span>
                  {linkedEvidenceCount} of {requirements.length} requirements
                  selected
                </span>
              </summary>
              <p>
                Select only records that already exist in {auditId}. The skill
                marks a requirement complete only when the selected record is
                linked to this finding; selecting an unrelated record does not
                satisfy the requirement.
              </p>
              <ResourceState resource={evidenceRegister} />
              {requirements.map(requirement => (
                <div
                  className="card-evidence-requirement"
                  key={requirement}
                >
                  <strong>{requirement.replaceAll("-", " ")}</strong>
                  {existingEvidence.length ? (
                    <div className="card-evidence-options">
                      {existingEvidence.map(record => {
                        const evidenceId = id(record);
                        const selected = (
                          evidenceBindings[requirement] ?? []
                        ).includes(evidenceId);
                        return (
                          <label key={evidenceId}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={event =>
                                setEvidenceBindings(previous => {
                                  const current = previous[requirement] ?? [];
                                  return {
                                    ...previous,
                                    [requirement]: event.target.checked
                                      ? [...current, evidenceId]
                                      : current.filter(
                                          value => value !== evidenceId
                                        ),
                                  };
                                })
                              }
                            />
                            <span>
                              {text(record.title, evidenceId)}
                              <small>
                                {evidenceId} ·{" "}
                                {text(record.linkedTo, "No finding link")} ·{" "}
                                {text(record.state, "state not recorded")}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <small>
                      No persisted evidence records are available for this audit.
                    </small>
                  )}
                </div>
              ))}
            </details>
          )}
          <div className="assurance-inline">
            <button
              className="primary-button"
              disabled={
                action.busy || !canWrite || missing.length > 0 || !skillVersion
              }
              onClick={() =>
                action.run(async () => {
                  const response = await request("/api/agentkit/run", {
                    auditId,
                    findingId: item.findingId ?? undefined,
                    cardId: item.id,
                    skillId,
                    skillVersion,
                    answers,
                    evidenceBindings,
                  });
                  setResult(response);
                  refresh();
                  return response;
                })
              }
            >
              <Play size={13} />
              {action.busy ? "Running skill check…" : "Run skill check"}
            </button>
            <span className="card-skill-completion">
              {questions.length
                ? `${questions.length - missing.length}/${questions.length} required questions answered`
                : "No required questions"}
            </span>
          </div>
          {!canWrite && (
            <small className="card-skill-readonly">
              Sign in with a make-changes grant to answer and run the skill. The
              questions remain inspectable.
            </small>
          )}
          <ErrorNotice error={action.error} />
          {result && (
            <div className="card-skill-result">
              <strong>
                Skill trace recorded · {skillStateLabel(result.status)}
              </strong>
              <p>
                {text(result.recommendation, "No recommendation was returned.")}
              </p>
              <small>
                Trace {text(result.traceId)} · completion{" "}
                {text(result.completion, "0")}% · human gate{" "}
                {text(result.humanGate?.status, "pending")}
              </small>
              {Array.isArray(result.unknowns) && result.unknowns.length > 0 && (
                <ul>
                  {result.unknowns.map((unknown: unknown, index: number) => (
                    <li key={index}>{text(unknown)}</li>
                  ))}
                </ul>
              )}
              {Array.isArray(result.advisories) &&
                result.advisories.length > 0 && (
                  <div className="card-skill-advisory">
                    <strong>Open governance condition</strong>
                    <ul>
                      {result.advisories.map((advisory: unknown, index: number) => (
                        <li key={index}>{text(advisory)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              <details className="technical-details">
                <summary>Technical trace</summary>
                <Json value={result} />
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function AssetActions({
  asset,
  auditId,
}: {
  asset: Row;
  auditId: string;
}) {
  const action = useAction();
  const original = assetId(asset);
  return (
    <>
      <div className="assurance-inline">
        <button
          className="ghost-button"
          disabled={action.busy || !original}
          onClick={() =>
            action.run(() =>
              download(
                scoped(
                  `/api/evidence/assets/${encodeURIComponent(original)}/download`,
                  auditId
                ),
                String(asset.filename ?? asset.name ?? label(asset))
              ).then(() => ({ downloadedAssetId: original }))
            )
          }
        >
          <Download size={12} />
          Original bytes
        </button>
        <button
          className="ghost-button"
          disabled={action.busy || !original}
          onClick={() =>
            action.run(() =>
              request(
                `/api/evidence/assets/${encodeURIComponent(original)}/verify`,
                { auditId }
              )
            )
          }
        >
          Verify digest
        </button>
      </div>
      {!original && (
        <small>
          Original retained asset reference unavailable. Metadata is not
          preserved original bytes.
        </small>
      )}
      <ErrorNotice error={action.error} />
      {action.result && (
        <Json value={action.result} title="Download / verification response" />
      )}
    </>
  );
}
function Recorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (blob: Blob, filename: string) => Promise<void>;
  disabled: boolean;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const cancelled = useRef(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    },
    []
  );
  const start = async () => {
    setError(null);
    setStarting(true);
    cancelled.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Original audio recording is unavailable in this browser."
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (cancelled.current) {
        stream.current.getTracks().forEach(track => track.stop());
        return;
      }
      const media = new MediaRecorder(stream.current);
      recorder.current = media;
      const chunks: Blob[] = [];
      media.ondataavailable = e => {
        if (e.data.size) chunks.push(e.data);
      };
      media.onerror = () => {
        setError("Audio recording failed. No original recording was uploaded.");
        setRecording(false);
        stream.current?.getTracks().forEach(track => track.stop());
      };
      media.onstop = () => {
        stream.current?.getTracks().forEach(track => track.stop());
        if (cancelled.current) return;
        setRecording(false);
        const blob = new Blob(chunks, { type: media.mimeType || "audio/webm" });
        if (!blob.size) {
          setError("No audio bytes captured.");
          return;
        }
        void onRecorded(
          blob,
          `voice-${new Date().toISOString().replaceAll(":", "-")}.${blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm"}`
        ).catch(e => setError(e instanceof Error ? e.message : String(e)));
      };
      media.start();
      setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach(track => track.stop());
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };
  return (
    <>
      <button
        className={`ghost-button ${recording ? "assurance-recording" : ""}`}
        disabled={disabled || starting}
        onClick={() => (recording ? recorder.current?.stop() : void start())}
      >
        {recording ? <Square size={13} /> : <Mic size={13} />}
        {recording
          ? "Stop & upload original audio"
          : starting
            ? "Requesting microphone…"
            : "Record original voice"}
      </button>
      <ErrorNotice error={error} />
    </>
  );
}
export function AgentResponse({ response }: { response: any }) {
  if (!response) return null;
  const value = response.result ?? response.data ?? response;
  const skill = value.skillInvocation ?? value.appliedSkill ?? value.skill;
  return (
    <div className="chat-answer">
      <div className="assurance-inline">
        <Badge>Human review required</Badge>
        <span>
          Provider {text(value.provider ?? value.modelProvider, "Not returned")}{" "}
          · Model {text(value.model, "Not returned")}
        </span>
      </div>
      <p className="assurance-response">
        {text(
          value.answer ??
            value.agentMessage ??
            value.message ??
            value.output?.answer,
          "No narrative returned; inspect the exact response below."
        )}
      </p>
      <div className="agent-skill-used">
        <Workflow size={13} />
        <strong>
          Skill{" "}
          {typeof skill === "string"
            ? skill
            : text(skill?.id ?? skill?.skillId, "No applied skill returned")}
        </strong>
        <small>
          Version {text(skill?.version ?? value.skillVersion, "Not returned")} ·
          Route {text(skill?.route ?? value.route, "Not returned")}
        </small>
        <small>
          Trace{" "}
          {text(
            value.traceId ?? value.trace?.id ?? value.invocation?.traceId,
            "Not returned"
          )}
        </small>
      </div>
      <Json
        value={response}
        title="Exact grounding, source IDs, graph traversal, tool calls and human gate"
      />
    </div>
  );
}
export function CardDossier({
  auditId,
  item,
  attachments,
  communications,
  skillMeta,
  refresh,
  close,
  onSkill,
  canWrite,
}: {
  auditId: string;
  item: Row;
  attachments: Row[];
  communications: Row[];
  skillMeta: Map<string, { name: string; version: string }>;
  refresh: () => void;
  close: () => void;
  onSkill: () => void;
  canWrite: boolean;
}) {
  const action = useAction();
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const history = rows(item.communications, "communications").length
    ? rows(item.communications)
    : communications.filter(c => c.itemId === id(item));
  const files = rows(item.attachments).length
    ? rows(item.attachments)
    : attachments.filter(
        a =>
          a.itemId === id(item) ||
          (Array.isArray(item.attachmentIds) &&
            item.attachmentIds.includes(id(a)))
      );
  const lastConversation = [...history]
    .sort(
      (a, b) =>
        Date.parse(String(a.createdAt ?? a.timestamp ?? "")) -
        Date.parse(String(b.createdAt ?? b.timestamp ?? ""))
    )
    .reverse()
    .find(c => c.conversationId)?.conversationId;
  const conversationId = item.conversationId ?? lastConversation;
  const findingId = item.findingId ?? item.linkedFindingId;
  const [reply, setReply] = useState<any>(null);
  const attach = async (blob: Blob, filename: string) => {
    await action.run(async () => {
      const result = await request(
        `/api/kanban/items/${encodeURIComponent(id(item))}/attachments`,
        {
          auditId,
          itemId: id(item),
          filename,
          mediaType: blob.type || "application/octet-stream",
          kind: blob.type.startsWith("audio/")
            ? "voice"
            : blob.type.startsWith("image/")
              ? "photo"
              : "document",
          base64: await fileBase64(blob),
          ...(transcript.trim() ? { transcript: transcript.trim() } : {}),
        }
      );
      refresh();
      setTranscript("");
      return result;
    });
  };
  return (
    <Inspector
      title={label(item)}
      description={`${auditId} · card ${id(item)} · finding ${text(findingId, "Not linked")} · conversation ${text(conversationId, "Created by server on first dialogue")}`}
      onClose={close}
    >
      <div className="field-kanban-drawer-body">
        <div className="field-kanban-drawer-status">
          <Badge>{text(item.status)}</Badge>
          <span>Priority {text(item.priority)}</span>
          <span>
            Updated {formatWhen(item.updatedAt, "time not recorded")}
          </span>
        </div>
        <p className="field-kanban-drawer-description">
          {text(item.description, "No description recorded.")}
        </p>
        <details className="technical-details">
          <summary>Technical card record (IDs and revision)</summary>
          <Json value={item} />
        </details>
        <div className="assurance-form">
          <label>
            Target stage
            <select value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">Choose an allowed stage</option>
              {stages
                .filter(s => s.id !== item.status && s.id !== "final")
                .map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Stage-change reason
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
            />
          </label>
          <button
            className="primary-button"
            disabled={action.busy || !canWrite || !target || !reason.trim()}
            onClick={() =>
              action.run(async () => {
                const result = await request(
                  `/api/kanban/items/${encodeURIComponent(id(item))}/move`,
                  { auditId, status: target, reason }
                );
                refresh();
                setReason("");
                setTarget("");
                return result;
              })
            }
          >
            Record stage move
          </button>
          <small>
            Server controls allowed transitions and approval gates. Final is
            reached only through the qualified report-approval path, never by a
            card move. Moving to In progress is not a legal-clock trigger.
          </small>
          <ErrorNotice error={action.error} />
        </div>
        <CardSkillCheck
          auditId={auditId}
          item={item}
          canWrite={canWrite}
          refresh={refresh}
          skillMeta={skillMeta}
        />
        <div className="field-kanban-trace-block">
          <span className="tiny-label">APPLIED SKILLS & EXECUTION</span>
          {Array.isArray(item.skillIds) && item.skillIds.length ? (
            item.skillIds.map((skillId: string) => (
              <Badge key={skillId}>
                {skillMeta.get(skillId)?.name ?? skillId}
              </Badge>
            ))
          ) : (
            <small>No applied skill recorded for this card.</small>
          )}
          <small>
            Governed version{" "}
            {text(
              item.skillVersion ??
                skillMeta.get(String(item.activeSkillId))?.version,
              "recorded in the skill library"
            )}{" "}
            · execution trace{" "}
            {text(
              item.traceId,
              "none yet — run the skill to create one"
            )}
          </small>
          <button className="ghost-button" onClick={onSkill}>
            Open governed skill library
          </button>
        </div>
        <div className="field-kanban-trace-block">
          <span className="tiny-label">ORIGINAL ATTACHMENTS</span>
          {files.length ? (
            files.map((file, i) => (
              <div className="field-kanban-attachment" key={`${id(file)}-${i}`}>
                <Paperclip size={13} />
                <div>
                  <strong>{text(file.filename ?? file.title)}</strong>
                  <small>
                    {text(file.mediaType)} · {text(file.sizeBytes)} bytes ·{" "}
                    {formatWhen(file.createdAt, "time not recorded")}
                  </small>
                  <small>
                    SHA-256 {text(file.sha256)} · asset {text(assetId(file))}
                  </small>
                  {file.transcript && (
                    <p>
                      Supplied / provider-derived transcript:{" "}
                      {text(file.transcript)}
                    </p>
                  )}
                  <AssetActions asset={file} auditId={auditId} />
                  <Json
                    value={file}
                    title="Custody, object version, retention and source metadata"
                  />
                </div>
              </div>
            ))
          ) : (
            <Empty>No persisted attachments on this card.</Empty>
          )}
          <div className="assurance-form">
            <label>
              Optional supplied transcript
              <textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                rows={2}
                placeholder="Only supply text you actually transcribed; original audio is retained separately."
              />
            </label>
            <label className="ghost-button">
              <Paperclip size={13} />
              Attach file / photo
              <input
                type="file"
                hidden
                disabled={action.busy || !canWrite}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) void attach(file, file.name);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="ghost-button">
              Capture photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                disabled={action.busy || !canWrite}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) void attach(file, file.name);
                  e.target.value = "";
                }}
              />
            </label>
            <Recorder disabled={action.busy || !canWrite} onRecorded={attach} />
            <small>
              No speech-to-text is claimed unless a transcript is actually
              supplied or returned by the configured provider.
            </small>
          </div>
        </div>
        <div className="field-kanban-trace-block">
          <span className="tiny-label">PERSISTED CONVERSATION</span>
          <div className="field-kanban-timeline">
            {history.length ? (
              history.map((event, index) => (
                <div
                  key={`${id(event)}-${index}`}
                  className={`field-kanban-message ${event.role === "user" ? "user" : event.role === "system" ? "system" : "agent"}`}
                >
                  <div>
                    <strong>{text(event.actor ?? event.role)}</strong>
                    <small>
                      {formatWhen(
                        event.createdAt ?? event.timestamp,
                        "time not recorded"
                      )}
                    </small>
                  </div>
                  <p>{text(event.text ?? event.message, "No message text")}</p>
                  <small className="field-kanban-message-skill">
                    Skills {text(event.skillIds, "None returned")} · version{" "}
                    {text(event.skillVersion, "Not returned")} · trace{" "}
                    {text(event.traceId, "Not returned")}
                  </small>
                  <Json
                    value={event}
                    title="Message identity, context and execution provenance"
                  />
                </div>
              ))
            ) : (
              <Empty>No persisted communication events.</Empty>
            )}
          </div>
          <div className="field-kanban-note">
            <textarea
              aria-label="Card conversation message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              placeholder="Add a source-grounded note or ask the live agent about this audit/card."
            />
            <div className="assurance-inline">
              <button
                className="ghost-button"
                disabled={action.busy || !canWrite || !message.trim()}
                onClick={() =>
                  action.run(async () => {
                    const result = await request(
                      `/api/kanban/items/${encodeURIComponent(id(item))}/communications`,
                      {
                        auditId,
                        itemId: id(item),
                        role: "user",
                        ...(conversationId ? { conversationId } : {}),
                        text: message,
                      }
                    );
                    refresh();
                    setMessage("");
                    return result;
                  })
                }
              >
                <MessageSquare size={13} />
                Save comment
              </button>
              <button
                className="primary-button"
                disabled={action.busy || !canWrite || !message.trim()}
                onClick={() =>
                  action.run(async () => {
                    const result = await request("/api/agent/dialogue", {
                      auditId,
                      itemId: id(item),
                      ...(conversationId ? { conversationId } : {}),
                      ...(findingId ? { findingId } : {}),
                      message,
                    });
                    setReply(result);
                    refresh();
                    setMessage("");
                    return result;
                  })
                }
              >
                {action.busy ? "Working…" : "Ask live agent on this card"}
              </button>
            </div>
          </div>
          <AgentResponse response={reply} />
        </div>
        {!canWrite && (
          <Empty>
            Look-only access. Persisted dialogue, comments, attachments and
            moves require a make-changes grant for this audit.
          </Empty>
        )}
        <ErrorNotice error={action.error} />
        {action.result && (
          <Json value={action.result} title="Last accepted operation / trace" />
        )}
      </div>
    </Inspector>
  );
}
export function Board({
  auditId,
  findingId,
  canWrite,
  onSkill,
}: {
  auditId: string;
  findingId: string;
  canWrite: boolean;
  onSkill: (findingId: string, skillId?: string) => void;
}) {
  const resource = useResource(scoped("/api/kanban", auditId));
  const library = useResource("/api/nuclear/skills");
  const [selectedId, setSelectedId] = useState(() =>
    storageGet(`assurance-card:${auditId}`)
  );
  const [open, setOpen] = useState(Boolean(selectedId));
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium",
  });
  const action = useAction();
  const items = rows(resource.data, "items", "cards").map(payload);
  const skillNames = new Map(
    rows(library.data, "skills").map(envelope => [
      id(envelope),
      label(payload(envelope)),
    ])
  );
  const skillMeta = new Map(
    rows(library.data, "skills").map(envelope => {
      const skill = payload(envelope);
      return [
        id(envelope),
        {
          name: label(skill),
          version: text(envelope.version ?? skill.version, ""),
        },
      ];
    })
  );
  const baselineCards = items.filter(item =>
    String(item.sourceRecordId ?? "").startsWith("AUDIT-BASELINE:")
  );
  const orderedBaseline = [...baselineCards].sort(
    (a, b) =>
      (Number.parseInt(String(a.title), 10) || 0) -
      (Number.parseInt(String(b.title), 10) || 0)
  );
  const baselineSignals = orderedBaseline.map(card => ({
    card,
    signal: baselineSignal(card),
  }));
  const baselineGreen = baselineSignals.filter(
    entry => entry.signal.tone === "green"
  ).length;
  const baselineAmber = baselineSignals.filter(
    entry => entry.signal.tone === "amber"
  ).length;
  const baselineRed = baselineSignals.filter(
    entry => entry.signal.tone === "red"
  ).length;
  const baselineGray = baselineSignals.filter(
    entry => entry.signal.tone === "gray"
  ).length;
  const selected = items.find(i => id(i) === selectedId);
  const unknownStages = [
    ...new Set(items.map(i => text(i.status, "unassigned"))),
  ].filter(s => !stages.some(stage => stage.id === s));
  const columns = [...stages, ...unknownStages.map(s => ({ id: s, label: s }))];
  return (
    <Panel
      title="Field work & finding dossiers"
      subtitle={`Audit ${auditId} · cards, evidence, conversations and human-gated stage changes`}
      actions={
        <div className="assurance-inline">
          <button
            className="icon-button"
            aria-label="Refresh board"
            onClick={resource.refresh}
          >
            <RefreshCw size={14} />
          </button>
          <button
            className="ghost-button"
            disabled={!canWrite}
            onClick={() => setCreate(!create)}
          >
            <Plus size={13} />
            New card
          </button>
        </div>
      }
    >
      <ResourceState resource={resource} />
      {!resource.loading && !resource.error && (
        <div className="audit-baseline-banner">
          <div>
            <span className="tiny-label">
              START HERE · FIVE-PHASE AUDIT PATH
            </span>
            <strong>
              {baselineCards.length
                ? `${baselineGreen} of ${orderedBaseline.length} phases complete · ${baselineAmber} in progress · ${baselineGray} not started${baselineRed ? ` · ${baselineRed} blocked` : ""}.`
                : "This audit has no work plan yet."}
            </strong>
            <p>
              {baselineCards.length
                ? "Each phase is a governed nuclear skill. Green means its questions and evidence are complete; the human gate still applies. Amber means the skill is active or needs more context. Red means blocked or failed. Select a phase to open its card."
                : "Load the minimum backlog for this audit. Cards are generated from the audit profile, the controlled five-phase method and the active nuclear skill contracts — not from a static checklist."}
            </p>
          </div>
          {!baselineCards.length && (
            <button
              className="primary-button"
              disabled={!canWrite || action.busy}
              onClick={() =>
                action.run(async () => {
                  const result = await request("/api/kanban/baseline", {
                    auditId,
                  });
                  resource.refresh();
                  return result;
                })
              }
            >
              <Plus size={13} />
              {action.busy ? "Loading…" : "Load baseline checklist"}
            </button>
          )}
          {orderedBaseline.length > 0 && (
            <button
              className="primary-button"
              onClick={() => {
                const first = orderedBaseline[0];
                setSelectedId(id(first));
                storageSet(`assurance-card:${auditId}`, id(first));
                setOpen(true);
              }}
            >
              Start with {label(orderedBaseline[0])}
            </button>
          )}
        </div>
      )}
      {orderedBaseline.length > 0 && (
        <div className="audit-baseline-path">
          {baselineSignals.map(({ card, signal }, index) => (
            <button
              className={`audit-baseline-step ${signal.tone}`}
              key={id(card)}
              title={signal.detail}
              onClick={() => {
                setSelectedId(id(card));
                storageSet(`assurance-card:${auditId}`, id(card));
                setOpen(true);
              }}
            >
              <span>{index + 1}</span>
              <strong>{label(card)}</strong>
              <small>
                {skillNames.get(String(card.activeSkillId)) ??
                  String(card.activeSkillId ?? "No skill bound")}
              </small>
              <em className={`baseline-step-signal ${signal.tone}`}>
                {signal.label}
                {signal.percent > 0 ? ` · ${signal.percent}%` : ""}
              </em>
              <div className="baseline-step-meter" aria-hidden="true">
                <i style={{ width: `${signal.percent}%` }} />
              </div>
            </button>
          ))}
        </div>
      )}
      {create && (
        <div className="assurance-form">
          <label>
            Card title
            <input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            Observed condition / scope
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </label>
          <label>
            Priority
            <select
              value={form.priority}
              onChange={e => setForm({ ...form, priority: e.target.value })}
            >
              {["low", "medium", "high", "critical"].map(p => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <small>
            Linked finding:{" "}
            {findingId || "None selected—card remains an intake record"}
          </small>
          <button
            className="primary-button"
            disabled={action.busy || !canWrite || !form.title.trim()}
            onClick={() =>
              action.run(async () => {
                const result = await request("/api/kanban/items", {
                  auditId,
                  ...form,
                  status: "backlog",
                  ...(findingId ? { findingId } : {}),
                });
                const item = result.item ?? result.record;
                if (item && id(item)) {
                  setSelectedId(id(item));
                  storageSet(`assurance-card:${auditId}`, id(item));
                  setOpen(true);
                }
                resource.refresh();
                setCreate(false);
                setForm({ title: "", description: "", priority: "medium" });
                return result;
              })
            }
          >
            Save real intake card
          </button>
        </div>
      )}
      <ErrorNotice error={action.error} />
      {!resource.loading && !resource.error && (
        <>
          {!items.length && (
            <Empty>
              No persisted Kanban cards for this audit. Load the baseline
              checklist above, or create a real intake card.
            </Empty>
          )}
          <div className="field-kanban-board">
            {columns.map(stage => {
              const cards = items
                .filter(item => text(item.status, "unassigned") === stage.id)
                .sort((a, b) => {
                  const aBaseline = String(a.sourceRecordId ?? "").startsWith(
                    "AUDIT-BASELINE:"
                  );
                  const bBaseline = String(b.sourceRecordId ?? "").startsWith(
                    "AUDIT-BASELINE:"
                  );
                  if (aBaseline && bBaseline)
                    return (
                      (Number.parseInt(String(a.title), 10) || 0) -
                      (Number.parseInt(String(b.title), 10) || 0)
                    );
                  if (aBaseline !== bBaseline) return aBaseline ? -1 : 1;
                  return 0;
                });
              return (
                <div className="field-kanban-column" key={stage.id}>
                  <div className="field-kanban-column-head">
                    <strong>{stage.label}</strong>
                    <span>{cards.length}</span>
                  </div>
                  {stage.id === "final" && cards.length === 0 && (
                    <div className="field-kanban-empty">
                      Reserved for the qualified report-approval path. Cards
                      cannot be moved here directly.
                    </div>
                  )}
                  {cards.map(item => (
                    <motion.button
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`field-kanban-card ${item.attention ? "attention" : ""} ${id(item) === selectedId ? "selected" : ""}`}
                      key={id(item)}
                      onClick={() => {
                        setSelectedId(id(item));
                        storageSet(`assurance-card:${auditId}`, id(item));
                        setOpen(true);
                      }}
                    >
                      <div>
                        <small>{id(item)}</small>
                        {item.attention && (
                          <span className="field-kanban-alert-dot" />
                        )}
                      </div>
                      <strong>{label(item)}</strong>
                      {item.activeSkillId && (
                        <span className="field-kanban-skill">
                          <Workflow size={10} />{" "}
                          {skillNames.get(String(item.activeSkillId)) ??
                            String(item.activeSkillId)}
                        </span>
                      )}
                      <p>{text(item.description, "No description recorded")}</p>
                      <small>
                        Finding {text(item.findingId, "Not linked")} ·{" "}
                        {text(item.priority)}
                      </small>
                      <div>
                        <span>
                          <Paperclip size={11} />{" "}
                          {rows(item.attachments).length ||
                            (Array.isArray(item.attachmentIds)
                              ? item.attachmentIds.length
                              : 0)}
                        </span>
                        <span>
                          <MessageSquare size={11} />{" "}
                          {rows(item.communications).length}
                        </span>
                      </div>
                    </motion.button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
      {open && selected && (
        <CardDossier
          auditId={auditId}
          item={selected}
          attachments={rows(resource.data, "attachments")}
          communications={rows(resource.data, "communications")}
          skillMeta={skillMeta}
          refresh={resource.refresh}
          close={() => setOpen(false)}
          canWrite={canWrite}
          onSkill={() => {
            setOpen(false);
            onSkill(
              String(selected.findingId ?? ""),
              String(
                selected.activeSkillId ??
                  (Array.isArray(selected.skillIds)
                    ? selected.skillIds[0]
                    : "") ??
                  ""
              )
            );
          }}
        />
      )}
      {open &&
        selectedId &&
        !selected &&
        !resource.loading &&
        !resource.error && (
          <Empty>
            The previously selected card is unavailable in this audit.{" "}
            <button
              className="text-button"
              onClick={() => {
                setOpen(false);
                setSelectedId("");
                storageSet(`assurance-card:${auditId}`, "");
              }}
            >
              Clear selection
            </button>
          </Empty>
        )}
    </Panel>
  );
}
