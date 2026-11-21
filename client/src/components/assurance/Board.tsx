import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  RefreshCw,
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
          <span>Updated {text(item.updatedAt)}</span>
        </div>
        <p className="field-kanban-drawer-description">
          {text(item.description, "No description recorded.")}
        </p>
        <Json value={item} title="Card identity, source IDs and revision" />
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
        </div>
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
                    {text(file.createdAt)}
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
                    <small>{text(event.createdAt ?? event.timestamp)}</small>
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
                ? `${baselineCards.length} baseline work cards are loaded.`
                : "This audit has no work plan yet."}
            </strong>
            <p>
              {baselineCards.length
                ? "Each card is linked to its governed nuclear skill and the evidence it expects. Open a card, then use Open governed skill library to work the questions."
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
          {orderedBaseline.map((card, index) => (
            <button
              className="audit-baseline-step"
              key={id(card)}
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
              <em>{text(card.status)}</em>
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
