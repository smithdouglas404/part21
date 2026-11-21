import { useState, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  id,
  label,
  payload,
  request,
  rows,
  saveJson,
  text,
  useAction,
  useResource,
  type Row,
} from "./api";

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "ok" | "warn" | "danger" | "info" | "muted" | string;
}) {
  return (
    <span
      className={`badge assurance-badge${tone ? ` assurance-badge-${tone}` : ""}`}
    >
      {children}
    </span>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="assurance-empty">{children}</div>;
}
export function ErrorNotice({ error }: { error?: string | Error | null }) {
  return error ? (
    <div className="assurance-error" role="alert">
      {typeof error === "string" ? error : error.message}
    </div>
  ) : null;
}
export function ResourceState({
  resource,
}: {
  resource: { loading: boolean; error: Error | null; refresh: () => void };
}) {
  return (
    <>
      {resource.loading && <Empty>Loading persisted records…</Empty>}
      {resource.error && (
        <>
          <ErrorNotice error={resource.error} />
          <button className="ghost-button" onClick={resource.refresh}>
            <RefreshCw size={13} />
            Retry
          </button>
        </>
      )}
    </>
  );
}
export function Json({
  value,
  title = "Inspect exact response",
  open = false,
}: {
  value: unknown;
  title?: string;
  open?: boolean;
}) {
  return (
    <details className="draft-preview" open={open}>
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2) ?? "No response available"}</pre>
    </details>
  );
}
const TECHNICAL_KEYS = new Set([
  "payload",
  "contentSha256",
  "payloadSha256",
  "recordType",
  "recordId",
  "sourceRecordType",
  "sourceRecordId",
  "sourceAuditId",
  "graphNodeId",
  "graphEventId",
  "graphEdgesAdded",
  "projected",
  "schema",
  "ontologyVersion",
  "ontologySourceSha256",
  "reportVersion",
  "snapshotHash",
  "recordRevision",
  "revision",
  "storage",
  "dataMode",
]);
const NARRATIVE_KEYS = new Set([
  "summary",
  "narrative",
  "description",
  "rationale",
  "basis",
  "purpose",
  "humanGate",
  "readinessBasis",
  "countBasis",
  "detail",
  "explanation",
  "guidance",
  "recommendation",
  "agentRecommendation",
  "auditorNarrative",
  "scopeNote",
  "traceabilityNote",
]);
const HIDDEN_KEYS = new Set([
  "id",
  "recordId",
  "auditId",
  "createdAt",
  "updatedAt",
  "title",
  "name",
  "label",
  "documentNumber",
  "status",
  "state",
  "severity",
]);
function humanKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}
function scalarText(value: unknown): string {
  if (value == null) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "Not recorded";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "Not recorded";
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed)) {
      const date = new Date(trimmed);
      if (Number.isFinite(date.getTime())) return date.toLocaleString();
    }
    return trimmed;
  }
  if (Array.isArray(value)) return value.map(scalarText).join(" · ");
  return "";
}
function isPlainObject(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function statusTone(value: unknown): "ok" | "warn" | "danger" | "info" | "muted" | undefined {
  const state = String(value ?? "").toLowerCase();
  if (!state) return undefined;
  if (/(critical|gap|overdue|fail|blocked|reject|red)/.test(state)) return "danger";
  if (/(watch|review|pending|open|amber|hold|unknown)/.test(state)) return "warn";
  if (/(healthy|closed|complete|green|approved|current|verified)/.test(state)) return "ok";
  return "info";
}
function humanState(value: unknown): string {
  const state = String(value ?? "").trim();
  if (!state) return "";
  return state
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}
function unwrapRecord(value: unknown): Row | null {
  if (!isPlainObject(value)) return null;
  if (
    isPlainObject(value.payload) &&
    (typeof value.recordType === "string" || typeof value.recordId === "string")
  ) {
    return {
      ...value.payload,
      recordType: value.recordType,
      recordId: value.recordId,
      auditId: value.auditId,
      revision: value.revision,
      updatedAt: value.updatedAt,
    };
  }
  return value;
}
function contextualSummary(record: Row): string {
  const status = scalarText(record.status ?? record.state);
  const owner = scalarText(record.owner ?? record.recordedBy ?? record.createdBy);
  const source = scalarText(record.source ?? record.family ?? record.type);
  if (record.severity && record.status) {
    return [
      `This is a ${scalarText(record.severity)} finding recorded as ${status}.`,
      owner !== "Not recorded"
        ? `${owner} is the accountable owner.`
        : "No accountable owner is recorded.",
      "The record does not, by itself, show a verified closure or an accepted corrective action. Until that decision is recorded with objective evidence, the finding remains open in the audit trail.",
      source !== "Not recorded" ? `The recorded source is ${source}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (record.coverage !== undefined && record.family) {
    return [
      `This control is recorded at ${scalarText(record.coverage)}% coverage with status ${status}.`,
      record.signal ? `The recorded signal is: ${scalarText(record.signal)}.` : "",
      record.next ? `The next action in the record is: ${scalarText(record.next)}.` : "",
      "Coverage is an audit indicator, not a certification that the control is effective.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (record.type && record.source && record.state) {
    const confidence =
      typeof record.confidence === "number"
        ? ` with a recorded confidence of ${record.confidence}`
        : "";
    return [
      `This is a ${scalarText(record.type)} from ${scalarText(record.source)}, recorded as ${status}${confidence}.`,
      record.linkedTo ? `It is linked to ${scalarText(record.linkedTo)}.` : "",
      "Registration is not acceptance: a reviewer must record a disposition before this item can carry a finding.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (record.documentNumber) {
    return [
      `This is controlled document ${scalarText(record.documentNumber)}, revision ${scalarText(record.revision)}, from ${scalarText(record.source)}.`,
      `Its current status is ${status}.`,
      "The original is preserved in the database; cybersecurity review and retention disposition may still be outstanding.",
    ].join(" ");
  }
  if (record.caseId) {
    return `This is a Part 21 evaluation case for ${scalarText(record.title)}. The case record preserves the discovery fact and the gate decisions; the clocks are computed from those recorded facts, not from the audit start date.`;
  }
  if (record.readiness !== undefined) {
    return `This metric record reports readiness ${scalarText(record.readiness)}, ${scalarText(record.openFindings)} open findings and ${scalarText(record.criticalFindings)} critical findings. It is a source-provided indicator, not a compliance determination.`;
  }
  return "";
}
function Collection({
  value,
  depth,
}: {
  value: unknown[];
  depth: number;
}) {
  if (!value.length) return <p className="human-detail-empty">No records in this section.</p>;
  if (value.every(item => !isPlainObject(item) && !Array.isArray(item))) {
    return (
      <div className="human-detail-chips">
        {value.map((item, index) => (
          <span key={index}>{scalarText(item)}</span>
        ))}
      </div>
    );
  }
  return (
    <div className="human-detail-cards">
      {value.slice(0, 12).map((item, index) => (
        <div className="human-detail-card" key={index}>
          <HumanDetail value={item} depth={depth + 1} compact />
        </div>
      ))}
      {value.length > 12 && (
        <p className="human-detail-empty">
          {value.length - 12} more records are available in the collapsed technical record.
        </p>
      )}
    </div>
  );
}
export function HumanDetail({
  value,
  depth = 0,
  compact = false,
}: {
  value: unknown;
  depth?: number;
  compact?: boolean;
}) {
  const original = value;
  const record = unwrapRecord(value);
  if (!record) {
    return <p className="human-detail-lede">{scalarText(value)}</p>;
  }
  const entries = Object.entries(record).filter(
    ([key, item]) =>
      !TECHNICAL_KEYS.has(key) &&
      !HIDDEN_KEYS.has(key) &&
      !NARRATIVE_KEYS.has(key) &&
      item !== undefined &&
      item !== null &&
      !(typeof item === "string" && !item.trim())
  );
  const facts = entries.filter(
    ([, item]) => !Array.isArray(item) && !isPlainObject(item)
  );
  const collections = entries.filter(([, item]) => Array.isArray(item));
  const nested = entries.filter(([, item]) => isPlainObject(item));
  const headlineSource =
    record.title ?? record.name ?? record.label ?? record.documentNumber;
  const headline =
    typeof headlineSource === "string" && headlineSource.trim()
      ? headlineSource.trim()
      : "";
  const status = record.status ?? record.state;
  const severity = record.severity;
  const narratives = [...NARRATIVE_KEYS]
    .filter(key => typeof record[key] === "string" && record[key].trim())
    .map(key => ({ key, text: String(record[key]) }));
  const generatedSummary =
    narratives.some(section => section.key === "summary" || section.key === "narrative")
      ? ""
      : contextualSummary(record);
  return (
    <div className={`human-detail${compact ? " compact" : ""}`}>
      {(headline || status || severity) && (
        <div className="human-detail-head">
          {headline && <strong>{headline}</strong>}
          <div className="human-detail-badges">
            {status && <Badge tone={statusTone(status)}>{humanState(status)}</Badge>}
            {severity && <Badge tone={statusTone(severity)}>{humanState(severity)}</Badge>}
          </div>
        </div>
      )}
      {narratives.map(section => (
        <section className="human-detail-section" key={section.key}>
          {section.key !== "summary" && <h4>{humanKey(section.key)}</h4>}
          <p className={section.key === "summary" ? "human-detail-lede" : undefined}>
            {section.text}
          </p>
        </section>
      ))}
      {generatedSummary && (
        <p className="human-detail-lede">{generatedSummary}</p>
      )}
      {facts.length > 0 && (
        <dl className="human-detail-facts">
          {facts.map(([key, item]) => (
            <div key={key}>
              <dt>{humanKey(key)}</dt>
              <dd>{scalarText(item)}</dd>
            </div>
          ))}
        </dl>
      )}
      {depth < 3 &&
        collections.map(([key, item]) => (
          <section className="human-detail-section" key={key}>
            <h4>
              {humanKey(key)}
              <small>{Array.isArray(item) ? ` · ${item.length}` : ""}</small>
            </h4>
            <Collection value={item as unknown[]} depth={depth} />
          </section>
        ))}
      {depth < 2 &&
        nested.map(([key, item]) => (
          <section className="human-detail-section" key={key}>
            <h4>{humanKey(key)}</h4>
            <HumanDetail value={item} depth={depth + 1} compact />
          </section>
        ))}
      {!compact && depth === 0 && (
        <Json value={original} title="Technical record (exact database fields)" />
      )}
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel assurance-panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
export function Inspector({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="assurance-inspector">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {description ?? "Persisted record detail. Human review required."}
          </SheetDescription>
        </SheetHeader>
        <div className="assurance-inspector-body">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
export function RecordList({
  data,
  onInspect,
  empty = "No persisted records in this scope.",
}: {
  data: Row[];
  onInspect: (row: Row) => void;
  empty?: string;
}) {
  return data.length ? (
    <div className="assurance-record-list">
      {data.map((envelope, index) => {
        const row = payload(envelope);
        return (
          <button
            key={`${id(envelope)}-${index}`}
            className="assurance-record-row"
            onClick={() => onInspect(envelope)}
          >
            <span>
              <strong>{label(envelope)}</strong>
              <small>
                {id(envelope)}
                {row.revision ? ` · revision ${row.revision}` : ""}
              </small>
            </span>
            <Badge>{humanState(text(envelope.status ?? row.status ?? row.state))}</Badge>
          </button>
        );
      })}
    </div>
  ) : (
    <Empty>{empty}</Empty>
  );
}
export function JsonOperation({
  title,
  path,
  auditId,
  initial = {},
  description,
  onDone,
}: {
  title: string;
  path: string;
  auditId?: string;
  initial?: Row;
  description?: string;
  onDone?: () => void;
}) {
  const [source, setSource] = useState(JSON.stringify(initial, null, 2));
  const action = useAction();
  return (
    <details className="draft-preview">
      <summary>{title}</summary>
      <div className="assurance-form">
        <p>
          {description ??
            "Submit explicit inputs to the authenticated API. Server permissions and validation apply."}
        </p>
        <small>
          POST {path}
          {auditId ? ` · audit ${auditId} is fixed by this workspace` : ""}
        </small>
        <textarea
          aria-label={`${title} JSON`}
          value={source}
          onChange={event => setSource(event.target.value)}
          rows={8}
          spellCheck={false}
        />
        <ErrorNotice error={action.error} />
        <button
          className="primary-button"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              const body = JSON.parse(source);
              if (!body || Array.isArray(body) || typeof body !== "object")
                throw new Error("A JSON object is required.");
              for (const field of [
                "actor",
                "createdBy",
                "reviewer",
                "routedBy",
                "approvedBy",
                "personName",
                "personEmail",
              ])
                if (field in body)
                  throw new Error(
                    `Do not supply ${field}; identity must be server-derived.`
                  );
              const result = await request(path, {
                ...body,
                ...(auditId ? { auditId } : {}),
              });
              onDone?.();
              return result;
            })
          }
        >
          {action.busy ? "Submitting…" : "Submit authenticated request"}
        </button>
        {action.result != null && <Json value={action.result} open />}
      </div>
    </details>
  );
}
export function EndpointPanel({
  title,
  path,
  keys = [],
  subtitle,
}: {
  title: string;
  path: string;
  keys?: string[];
  subtitle?: string;
}) {
  const resource = useResource(path);
  const [selected, setSelected] = useState<Row | null>(null);
  const list = rows(resource.data, ...keys);
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      actions={
        <button
          className="icon-button"
          aria-label={`Refresh ${title}`}
          onClick={resource.refresh}
        >
          <RefreshCw size={14} />
        </button>
      }
    >
      <ResourceState resource={resource} />
      {resource.data != null && (
        <>
          {list.length > 0 && (
            <RecordList data={list} onInspect={setSelected} />
          )}
          <Json
            value={resource.data}
            title="Status, provenance and exact returned fields"
          />
          <button
            className="ghost-button"
            onClick={() =>
              saveJson(
                `${title
                  .toLowerCase()
                  .replaceAll(" ", "-")
                  .replaceAll("/", "-")}.json`,
                resource.data
              )
            }
          >
            <Download size={13} />
            Download response
          </button>
        </>
      )}
      {selected && (
        <Inspector title={label(selected)} onClose={() => setSelected(null)}>
          <HumanDetail value={selected} />
        </Inspector>
      )}
    </Panel>
  );
}
