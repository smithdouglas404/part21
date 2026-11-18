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
            <Badge>{text(envelope.status ?? row.status ?? row.state)}</Badge>
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
            open={!list.length}
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
          <Json value={selected} open />
        </Inspector>
      )}
    </Panel>
  );
}
