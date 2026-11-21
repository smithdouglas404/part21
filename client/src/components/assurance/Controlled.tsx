import { useState } from "react";
import {
  Badge,
  Empty,
  EndpointPanel,
  ErrorNotice,
  HumanDetail,
  Inspector,
  Json,
  JsonOperation,
  Panel,
  ResourceState,
} from "./Common";
import {
  formatWhen,
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
          <HumanDetail value={selected} />
          <ResourceState resource={detail} />
          {detail.data && (
            <>
              <HumanDetail value={detail.data} />
              <details className="technical-details">
                <summary>
                  Technical payload, digest and review evidence
                </summary>
                <Json value={detail.data} />
              </details>
            </>
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
  const snapshotRows = rows(snapshots.data, "snapshots");
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
          <>
            {snapshotRows.length ? (
              <div className="assurance-record-list">
                {snapshotRows.map((snapshot, index) => (
                  <div
                    className="assurance-record-row snapshot-record"
                    key={text(snapshot.id, String(index))}
                  >
                    <HumanDetail value={snapshot} compact />
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                No ingested source snapshot is recorded yet. The screen will
                not invent a regulation baseline or provision count.
              </Empty>
            )}
            <details className="technical-details">
              <summary>
                Technical source snapshot record (IDs, digests and provision
                payload)
              </summary>
              <Json value={snapshots.data} />
            </details>
          </>
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
      <section className="policy-page-intro">
        <div>
          <span className="tiny-label">WHAT THIS PAGE DOES</span>
          <h2>Decide whether this audit can rely on the Part 21 policy rules</h2>
          <p>
            The policy library turns the controlled Part 21 text into
            deterministic rules. This page answers three questions: is a
            reviewed policy revision pinned to this audit, what do the rules say
            for a selected finding, and which exceptions still need a qualified
            person. It does not issue a reportability or compliance verdict.
          </p>
        </div>
        <div className="policy-intro-steps">
          <div>
            <b>1</b>
            <span>
              <strong>Check the baseline</strong>
              <small>
                A qualified reviewer must pin the exact approved revision before
                any rule result can be used.
              </small>
            </span>
          </div>
          <div>
            <b>2</b>
            <span>
              <strong>Evaluate a finding</strong>
              <small>
                The service returns pass, fail, unknown or not applicable for
                each rule.
              </small>
            </span>
          </div>
          <div>
            <b>3</b>
            <span>
              <strong>Review the exceptions</strong>
              <small>
                A named, qualified person records the disposition and evidence.
              </small>
            </span>
          </div>
        </div>
      </section>
      <PolicyNarrative
        auditId={auditId}
        findingId={findingId}
        canWrite={canWrite}
      />
      {isAdmin && <PolicyRevisions />}
    </div>
  );
}
function PolicyRevisions() {
  const catalog = useResource("/api/configuration/catalog?kind=policy");
  const entries = rows(catalog.data, "configurations", "items");
  return (
    <Panel
      title="Policy library revisions"
      subtitle="Only controlled policy revisions are shown here. An active library revision is not the same thing as an audit-pinned baseline."
    >
      <ResourceState resource={catalog} />
      {!catalog.loading && !catalog.error && !entries.length && (
        <Empty>
          No controlled policy revision exists. The application will not invent
          one or evaluate findings against an empty library.
        </Empty>
      )}
      {entries.map((entry, index) => (
        <div
          className="policy-revision-row"
          key={`${text(entry.configId)}-${text(entry.version)}-${index}`}
        >
          <div>
            <strong>
              {text(entry.configId, "Policy revision").replaceAll("-", " ")}
            </strong>
            <small>
              Revision {text(entry.version, "not recorded")} · approved{" "}
              {formatWhen(entry.approvedAt)} by{" "}
              {text(entry.approvedBy, "approver not recorded")}
            </small>
          </div>
          <Badge>{text(entry.status, "status not recorded")}</Badge>
        </div>
      ))}
      <p className="assurance-note">
        This list tells you which policy rule packs exist and who approved them.
        It does not tell you that a rule pack is pinned to this audit, and it
        does not create a policy result.
      </p>
      <details className="technical-details">
        <summary>Technical revision catalog (IDs and SHA-256)</summary>
        <Json value={catalog.data} />
      </details>
    </Panel>
  );
}

function PolicyNarrative({
  auditId,
  findingId,
  canWrite,
}: {
  auditId: string;
  findingId: string;
  canWrite: boolean;
}) {
  const coverage = useResource(scoped("/api/policy/coverage", auditId));
  const evaluationAction = useAction();
  const message = coverage.error?.message ?? "";
  const baselineMissing = /No reviewed policy baseline pinned/i.test(message);
  if (coverage.loading) {
    return (
      <Panel
        title="Part 21 policy evaluation"
        subtitle={`Audit ${auditId}. Loading the pinned policy revision and deterministic rule results.`}
      >
        <ResourceState resource={coverage} />
      </Panel>
    );
  }
  if (baselineMissing) {
    return (
      <Panel
        title="Part 21 policy evaluation is waiting for a qualified baseline decision"
        subtitle={`Audit ${auditId}. The controlled policy library is active, but this audit has no pinned reviewed baseline.`}
      >
        <div className="policy-gate">
          <strong>Why no policy result is shown</strong>
          <p>
            The application will not evaluate findings against an unpinned or
            inferred policy revision. A qualified quality manager must pin the
            exact approved Part 21 policy revision to this audit before rule
            results can be used as evidence. This is a governance gate, not a
            screen failure, and the agent records it as an open human decision.
          </p>
          <p>To close the gate, the reviewer must confirm all three items:</p>
          <ul>
            <li>The exact active policy revision and its SHA-256 digest.</li>
            <li>
              The reviewer's current nuclear qualification and its evidence
              reference for this audit.
            </li>
            <li>
              The retained activation review that accepted the policy payload
              and its definition tests.
            </li>
          </ul>
          <small>
            No approval, pass result, reportability conclusion, or NRC
            notification has been created by this screen.
          </small>
          <p>
            What to do next: take these three confirmations to the qualified
            quality manager for this audit. The baseline is pinned through the
            controlled configuration process; this screen deliberately offers no
            self-approval control.
          </p>
        </div>
        <details className="technical-details">
          <summary>Technical reason returned by the policy service</summary>
          <p>{message}</p>
        </details>
      </Panel>
    );
  }
  if (coverage.error) {
    return (
      <Panel title="Part 21 policy evaluation">
        <ResourceState resource={coverage} />
      </Panel>
    );
  }
  const evaluations = rows(coverage.data, "evaluations");
  const evaluation = coverage.data?.evaluation ?? evaluations[0];
  if (!evaluation) {
    return (
      <Panel
        title="Part 21 policy evaluation"
        subtitle={`Audit ${auditId}. The pinned baseline is available, but no finding has been evaluated yet.`}
      >
        <Empty>
          The pinned baseline is ready. Select a persisted finding in the
          context bar, then run the evaluation to create a rule-level result. No
          policy conclusion is inferred from an empty audit.
        </Empty>
        {canWrite && findingId && (
          <div className="policy-evaluate-action">
            <p>
              This evaluates the selected finding against the pinned policy
              revision. It does not approve the result or make a reportability
              decision.
            </p>
            <button
              className="primary-button"
              disabled={evaluationAction.busy}
              onClick={() =>
                evaluationAction.run(async () => {
                  const result = await request("/api/policy/evaluate", {
                    auditId,
                    findingId,
                    asOf: new Date().toISOString().slice(0, 10),
                  });
                  coverage.refresh();
                  return result;
                })
              }
            >
              {evaluationAction.busy
                ? "Evaluating selected finding…"
                : "Evaluate selected finding"}
            </button>
            <ErrorNotice error={evaluationAction.error} />
          </div>
        )}
        {canWrite && !findingId && (
          <p className="assurance-note">
            Select a finding in the context bar to enable the evaluation.
          </p>
        )}
      </Panel>
    );
  }
  const results = rows(evaluation, "results");
  const totals = results.reduce(
    (counts, result) => {
      const disposition = text(result.disposition, "unknown");
      if (disposition in counts) counts[disposition] += 1;
      return counts;
    },
    { pass: 0, fail: 0, unknown: 0, not_applicable: 0 } as Record<
      string,
      number
    >
  );
  const exceptions = results.filter(result =>
    ["fail", "unknown"].includes(text(result.disposition))
  );
  return (
    <Panel
      title="Part 21 policy evaluation"
      subtitle={`Audit ${auditId}. Results are deterministic rule evaluations against the pinned reviewed policy revision.`}
    >
      <div className="policy-summary">
        <p>
          The policy service evaluated {results.length} rules for finding{" "}
          {text(evaluation.findingId, "not recorded")} against policy revision{" "}
          {text(evaluation.policyVersion, "not recorded")}. {totals.pass} passed,{" "}
          {totals.fail} failed, {totals.unknown} remained unknown, and{" "}
          {totals.not_applicable} were not applicable.
        </p>
        <p>
          A rule result is evidence for a qualified reviewer. It is not a
          reportability determination, a compliance certification, or an NRC
          notification.
        </p>
      </div>
      <div className="policy-count-grid">
        {Object.entries(totals).map(([key, value]) => (
          <div key={key}>
            <strong>{value}</strong>
            <small>{key.replaceAll("_", " ")}</small>
          </div>
        ))}
      </div>
      {exceptions.length > 0 ? (
        <div className="policy-exceptions">
          <span className="tiny-label">Rules requiring a person</span>
          {exceptions.map((result, index) => (
            <article key={text(result.rule?.id, String(index))}>
              <div>
                <strong>
                  {text(result.rule?.citation, "Citation not returned")} ·{" "}
                  {text(result.rule?.title, "Rule title not returned")}
                </strong>
                <Badge>{text(result.disposition)}</Badge>
              </div>
              <p>
                {Array.isArray(result.reasons) && result.reasons.length
                  ? result.reasons.map(String).join(" ")
                  : "No reason text was returned; the rule remains open."}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="policy-clear">
          No failed or unknown rule was returned for this evaluation. A
          qualified reviewer must still accept the result before it is used.
        </p>
      )}
      <details className="technical-details">
        <summary>Technical rule results and provenance</summary>
        <Json value={coverage.data} />
      </details>
    </Panel>
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
