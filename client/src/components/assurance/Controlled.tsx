import { useState } from "react";
import {
  Badge,
  Empty,
  EndpointPanel,
  Inspector,
  Json,
  JsonOperation,
  Panel,
  ResourceState,
} from "./Common";
import {
  id,
  label,
  request,
  rows,
  scoped,
  text,
  useAction,
  useResource,
  type Row,
} from "./api";

export function Configuration({ isAdmin }: { isAdmin: boolean }) {
  const catalog = useResource("/api/configuration/catalog");
  const [selected, setSelected] = useState<Row | null>(null);
  const detail = useResource(
    selected
      ? `/api/configuration/${encodeURIComponent(selected.kind)}/${encodeURIComponent(selected.configId)}?version=${encodeURIComponent(selected.version)}`
      : null
  );
  const entries = rows(catalog.data, "configurations", "items", "entries");
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const kinds = [...new Set(entries.map(row => row.kind).filter(Boolean))];
  return (
    <Panel
      title="Controlled configuration revisions"
      subtitle="Catalog rows are headers only. Inspecting a revision loads its exact payload, source hash, approvals and lifecycle evidence."
    >
      <ResourceState resource={catalog} />
      <div className="assurance-form assurance-query-form">
        <label>
          Configuration kind
          <select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">All returned kinds</option>
            {kinds.map(k => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Search ID / version
          <input value={query} onChange={e => setQuery(e.target.value)} />
        </label>
      </div>
      {entries
        .filter(
          row =>
            (!kind || row.kind === kind) &&
            `${row.configId} ${row.version}`
              .toLowerCase()
              .includes(query.toLowerCase())
        )
        .map((entry, index) => (
          <button
            className="assurance-record-row"
            key={`${entry.kind}-${entry.configId}-${entry.version}-${index}`}
            onClick={() => setSelected(entry)}
          >
            <span>
              <strong>{text(entry.configId)}</strong>
              <small>
                {text(entry.kind)} · {text(entry.version)} ·{" "}
                {text(entry.sourceSha256, "Hash returned on detail")}
              </small>
            </span>
            <Badge>{text(entry.status)}</Badge>
          </button>
        ))}
      {!catalog.loading && !catalog.error && !entries.length && (
        <Empty>No controlled configuration headers exist.</Empty>
      )}
      {isAdmin && (
        <JsonOperation
          title="Create a controlled draft revision"
          path="/api/configuration/drafts"
          initial={{
            kind: "",
            configId: "",
            version: "",
            payload: {},
            note: "",
          }}
          description="Submit a new immutable draft revision. Creating or reviewing a draft never silently activates it. Actual source references and qualified interpretation/approval are required."
          onDone={catalog.refresh}
        />
      )}
      {selected && (
        <Inspector
          title={`${text(selected.configId)} · ${text(selected.version)}`}
          description={`${text(selected.kind)} · exact revision · ${text(selected.status)}`}
          onClose={() => setSelected(null)}
        >
          <Json value={selected} title="Catalog header" />
          <ResourceState resource={detail} />
          {detail.data && (
            <Json
              value={detail.data}
              title="Exact payload, digest and review evidence"
              open
            />
          )}
          {isAdmin &&
            ["review", "activate", "retire"].map(operation => (
              <JsonOperation
                key={operation}
                title={`${operation[0].toUpperCase()}${operation.slice(1)} exact revision`}
                path={`/api/configuration/${operation}`}
                initial={{
                  kind: selected.kind,
                  configId: selected.configId,
                  version: selected.version,
                  note: "",
                }}
                description="Authenticated server applies qualification and separation-of-duties controls. Admin visibility is not authority to approve nuclear interpretation."
                onDone={() => {
                  catalog.refresh();
                  detail.refresh();
                }}
              />
            ))}
        </Inspector>
      )}
    </Panel>
  );
}
export function Regulatory({
  auditId,
  isAdmin,
}: {
  auditId: string;
  isAdmin: boolean;
}) {
  const snapshots = useResource("/api/regulatory/snapshots");
  const [source, setSource] = useState<"part21" | "appendix_b">("part21");
  const [asOf, setAsOf] = useState("");
  const action = useAction();
  return (
    <div className="view-stack">
      <Panel
        title="Authoritative source snapshots"
        subtitle="Source bytes, retrieval metadata and point-in-time baselines are separate from approved legal interpretations and executable rules."
      >
        <ResourceState resource={snapshots} />
        {snapshots.data && (
          <Json
            value={snapshots.data}
            title="Actual source snapshots, digests and retrieved provisions"
            open
          />
        )}
        {isAdmin && (
          <div className="assurance-form assurance-query-form">
            <label>
              Source family
              <select
                value={source}
                onChange={e => setSource(e.target.value as typeof source)}
              >
                <option value="part21">10 CFR Part 21</option>
                <option value="appendix_b">10 CFR Part 50 Appendix B</option>
              </select>
            </label>
            <label>
              Requested source baseline (optional)
              <input
                type="date"
                value={asOf}
                onChange={e => setAsOf(e.target.value)}
              />
            </label>
            <button
              className="primary-button"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  const result = await request("/api/regulatory/ingest", {
                    source,
                    ...(asOf ? { asOf } : {}),
                  });
                  snapshots.refresh();
                  return result;
                })
              }
            >
              {action.busy
                ? "Retrieving source…"
                : "Ingest actual source snapshot"}
            </button>
            {action.error && (
              <div className="assurance-error" role="alert">
                {action.error}
              </div>
            )}
            {action.result && (
              <Json
                value={action.result}
                title="Actual ingestion response and immutable source metadata"
              />
            )}
          </div>
        )}
      </Panel>
      <EndpointPanel
        title="Regulatory coverage"
        path={scoped("/api/regulatory/coverage", auditId)}
        keys={["coverage", "provisions", "obligations", "items"]}
        subtitle="Returned provision-to-obligation-to-rule-to-evidence chain. Missing facts remain unknown; this is not a compliance percentage."
      />
    </div>
  );
}
export function Policy({
  auditId,
  findingId,
  canWrite,
  isAdmin,
}: {
  auditId: string;
  findingId: string;
  canWrite: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="view-stack">
      <EndpointPanel
        title="Deterministic policy coverage"
        path={scoped("/api/policy/coverage", auditId)}
        keys={["results", "rules", "coverage", "items"]}
        subtitle="Only returned pass / fail / unknown / not_applicable results are displayed. No keyword-derived readiness is invented."
      />
      {canWrite && (
        <Panel
          title="Explicit policy evaluation"
          subtitle={`Audit ${auditId} · finding ${findingId || "Not selected"}`}
        >
          <JsonOperation
            title="Evaluate actual finding and effective-time evidence"
            path="/api/policy/evaluate"
            auditId={auditId}
            initial={{ findingId, asOf: "" }}
            description="Use a real finding in this audit and actual effective-time inputs. The service resolves approved evaluators; unsupported/missing requirements fail unknown."
          />
        </Panel>
      )}
      {isAdmin && <Configuration isAdmin />}
    </div>
  );
}
export function Governance({
  auditId,
  qualified,
}: {
  auditId: string;
  qualified: boolean;
}) {
  return (
    <div className="view-stack">
      <EndpointPanel
        title="Human governance ledger"
        path={scoped("/api/governance/board", auditId)}
        keys={["items", "decisions", "tasks"]}
        subtitle="Persisted human gates and decisions only. This UI never creates a reportability conclusion or synthetic transaction."
      />
      {qualified ? (
        <Panel title="Record an accountable decision">
          <JsonOperation
            title="Record an actual human disposition"
            path="/api/governance/decide"
            auditId={auditId}
            initial={{
              id: "",
              action: "",
              note: "",
              evidenceIds: [],
              decisionId: "",
            }}
            description="Use an actual governance item, supported action and supporting source/decision IDs. The acting principal is server-derived; this request does not perform NRC transmission."
          />
        </Panel>
      ) : (
        <Empty>
          Qualified review permission for this audit is required to record a
          nuclear disposition. Admin status and persona lenses do not grant it.
        </Empty>
      )}
    </div>
  );
}
