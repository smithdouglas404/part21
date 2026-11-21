import { useState } from "react";
import { Download, FileUp } from "lucide-react";
import { AssetActions } from "./Board";
import {
  Badge,
  Empty,
  ErrorNotice,
  HumanDetail,
  Inspector,
  Json,
  JsonOperation,
  Panel,
  RecordList,
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
  text,
  useAction,
  useConfigurations,
  useResource,
  type Principal,
  type Row,
} from "./api";

export function Evidence({
  auditId,
  findingId,
  portfolio,
  refresh,
  canWrite,
}: {
  auditId: string;
  findingId: string;
  portfolio: Row;
  refresh: () => void;
  canWrite: boolean;
}) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState("");
  const action = useAction();
  const vault = useResource(scoped("/api/evidence/vault/status", auditId));
  const evidence = rows(portfolio.evidence);
  return (
    <div className="view-stack">
      <Panel
        title="Evidence register"
        subtitle={`Persisted records in ${auditId}. Integrity verification is not source truth, identity attribution, WORM or compliance certification.`}
      >
        <div className="assurance-form assurance-query-form">
          <label>
            Original evidence file
            <input
              type="file"
              disabled={!canWrite || action.busy}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Tags (comma separated)
            <input value={tags} onChange={e => setTags(e.target.value)} />
          </label>
          <button
            className="primary-button"
            disabled={!canWrite || action.busy || !file || !findingId}
            onClick={() =>
              action.run(async () => {
                if (!file) throw new Error("Select an original file.");
                const result = await request("/api/evidence/intake", {
                  auditId,
                  linkedFinding: findingId,
                  name: file.name,
                  mimeType: file.type || "application/octet-stream",
                  size: file.size,
                  contentBase64: await fileBase64(file),
                  tags: tags
                    .split(",")
                    .map(t => t.trim())
                    .filter(Boolean),
                });
                refresh();
                setFile(null);
                setTags("");
                return result;
              })
            }
          >
            <FileUp size={13} />
            Register original to selected finding
          </button>
        </div>
        {!findingId && (
          <Empty>
            Select a real finding before finding-bound evidence intake. Unlinked
            field evidence can be attached to an intake card.
          </Empty>
        )}
        <ErrorNotice error={action.error} />
        {action.result && (
          <Json
            value={action.result}
            title="Exact persisted evidence and custody response"
            open
          />
        )}
        <RecordList data={evidence} onInspect={setSelected} />
      </Panel>
      <Panel
        title="Original-record vault status"
        subtitle="Actual provider and retention status, not a storage-product assurance claim."
      >
        <ResourceState resource={vault} />
        {vault.data && <HumanDetail value={vault.data} />}
      </Panel>
      {selected && (
        <Inspector
          title={label(selected)}
          description={`Evidence ${id(selected)} · audit ${auditId}`}
          onClose={() => setSelected(null)}
        >
          <HumanDetail value={selected} />
          <AssetActions asset={payload(selected)} auditId={auditId} />
        </Inspector>
      )}
    </div>
  );
}
export function Documents({
  auditId,
  canWrite,
  qualified,
}: {
  auditId: string;
  canWrite: boolean;
  qualified: boolean;
}) {
  const docs = useResource(scoped("/api/documents", auditId));
  const status = useResource(scoped("/api/document-control/status", auditId));
  const [selectedId, setSelectedId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: "",
    documentNumber: "",
    revision: "",
    source: "",
    effectiveDate: "",
  });
  const action = useAction();
  const list = rows(docs.data, "documents");
  const selected = list.find(row => id(row) === selectedId);
  return (
    <div className="view-stack">
      <Panel
        title="Controlled document register"
        subtitle={`Audit ${auditId} · exact original file, document number and revision. No synthetic decision or notarization action.`}
      >
        <div className="assurance-form assurance-document-form">
          <label>
            Original document
            <input
              type="file"
              disabled={!canWrite || action.busy}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {(
            [
              "title",
              "documentNumber",
              "revision",
              "source",
              "effectiveDate",
            ] as const
          ).map(key => (
            <label key={key}>
              {
                {
                  title: "Record title / download filename",
                  documentNumber: "Document number",
                  revision: "Actual revision",
                  source: "Actual source / origin",
                  effectiveDate: "Effective date (optional)",
                }[key]
              }
              <input
                type={key === "effectiveDate" ? "date" : "text"}
                value={form[key]}
                onChange={e => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <button
            className="primary-button"
            disabled={
              action.busy ||
              !canWrite ||
              !file ||
              !form.title.trim() ||
              !form.documentNumber.trim() ||
              !form.revision.trim() ||
              !form.source.trim()
            }
            onClick={() =>
              action.run(async () => {
                if (!file) throw new Error("Select a file.");
                const result = await request("/api/documents", {
                  auditId,
                  auditIds: [auditId],
                  ...form,
                  mimeType: file.type || "application/octet-stream",
                  base64: await fileBase64(file),
                });
                docs.refresh();
                if (result.document) setSelectedId(id(result.document));
                setFile(null);
                return result;
              })
            }
          >
            Store original controlled record
          </button>
        </div>
        <ErrorNotice error={action.error} />
        {action.result && (
          <Json
            value={action.result}
            title="Actual document registration response"
          />
        )}
        <ResourceState resource={docs} />
        {!docs.loading && !docs.error && (
          <RecordList data={list} onInspect={row => setSelectedId(id(row))} />
        )}
      </Panel>
      <Panel title="Document custody and review boundaries">
        <ResourceState resource={status} />
        {status.data && <HumanDetail value={status.data} />}
      </Panel>
      {selected && (
        <Inspector
          title={label(selected)}
          description={`${auditId} · document ${id(selected)} · revision ${text(payload(selected).revision)}`}
          onClose={() => setSelectedId("")}
        >
          <HumanDetail value={selected} />
          <AssetActions auditId={auditId} asset={payload(selected)} />
          {qualified ? (
            <JsonOperation
              title="Record actual cybersecurity review"
              path={`/api/documents/${encodeURIComponent(id(selected))}/cybersecurity-review`}
              auditId={auditId}
              initial={{
                status: "",
                controls: [],
                note: "",
                expectedRevision: payload(selected).recordRevision,
              }}
              description="Record only controls actually performed. The current qualified principal is the reviewer; selecting reviewed does not perform a malware scan or issue a quality approval."
              onDone={docs.refresh}
            />
          ) : (
            <Empty>
              A qualified audit reviewer must record any cybersecurity review.
              Admin status or a lens alone is insufficient.
            </Empty>
          )}
        </Inspector>
      )}
    </div>
  );
}
function ReadinessNarrative({ report }: { report: Row }) {
  const audit = report.audit ?? {};
  const metrics = report.metrics ?? {};
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const controls = Array.isArray(report.controls) ? report.controls : [];
  const decisions = Array.isArray(report.humanDecisionsRequired)
    ? report.humanDecisionsRequired
    : [];
  return (
    <article className="readiness-report">
      <header className="readiness-report-head">
        <div>
          <span className="tiny-label">10 CFR PART 21 · APPENDIX B</span>
          <h2>{text(audit.title, "Audit readiness report")}</h2>
          <p>
            {text(audit.id, report.auditId)} · {text(audit.scope, "Scope not recorded")} ·{" "}
            {text(audit.standard, "Standard not recorded")}
          </p>
        </div>
        <div className="readiness-report-meta">
          <Badge>{text(audit.status, "Status not recorded")}</Badge>
          <small>Owner {text(audit.owner, "Not assigned")}</small>
          <small>Due {text(audit.due, "Not recorded")}</small>
          <small>
            Draft generated {formatWhen(report.generatedAt, "time not recorded")}
          </small>
        </div>
      </header>
      <section className="readiness-position">
        <span className="tiny-label">EXECUTIVE POSITION</span>
        <h3>{text(report.executivePosition, "Qualified review required")}</h3>
        <p>
          This draft reports the database evidence and the open questions. It is
          not a compliance certification, a reportability determination or an
          NRC notification. A qualified person must resolve every item below
          before the audit is closed.
        </p>
      </section>
      <section className="readiness-metrics">
        <div>
          <span>Readiness signal</span>
          <strong>{text(metrics.readiness, "Unknown")}%</strong>
          <small>{text(metrics.readinessDelta, "No trend recorded")}</small>
        </div>
        <div>
          <span>Open findings</span>
          <strong>{text(metrics.openFindings, String(findings.length))}</strong>
          <small>{text(metrics.criticalFindings, "0")} critical</small>
        </div>
        <div>
          <span>Evidence linked</span>
          <strong>{text(report.evidence?.length, "0")} records</strong>
          <small>Persisted in this audit; not a coverage percentage</small>
        </div>
        <div>
          <span>Supplier exposure</span>
          <strong>{text(metrics.supplierExposure, "0")}</strong>
          <small>{text(metrics.changes30d, "0")} changes in 30 days</small>
        </div>
      </section>
      <section>
        <h3>What the audit found</h3>
        {findings.length ? (
          <div className="readiness-findings">
            {findings.map((finding: Row) => (
              <div className="readiness-finding" key={text(finding.id)}>
                <div>
                  <strong>{text(finding.title, "Finding")}</strong>
                  <small>
                    {text(finding.id)} · {text(finding.severity)} ·{" "}
                    {text(finding.status)} · owner {text(finding.owner, "unassigned")}
                  </small>
                </div>
                <span>{text(finding.age, "")}</span>
              </div>
            ))}
          </div>
        ) : (
          <p>No findings are recorded in this audit scope.</p>
        )}
      </section>
      <section>
        <h3>Control coverage</h3>
        <p>
          These are recorded control statuses, not policy-evaluated coverage
          percentages. A percentage is withheld until a qualified reviewer pins
          the exact Part 21 policy baseline to this audit.
        </p>
        <div className="readiness-controls">
          {controls.map((control: Row) => (
            <div key={text(control.id)}>
              <strong>{text(control.title, text(control.family))}</strong>
              <small>
                Recorded status: {text(control.status, "not recorded")} · next:{" "}
                {text(control.next, "not recorded")}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="readiness-decisions">
        <h3>What still needs a person</h3>
        <ul>
          {decisions.map((decision: unknown) => (
            <li key={text(decision)}>{text(decision)}</li>
          ))}
        </ul>
        <p>{text(report.traceabilityNote, "Traceability note not returned.")}</p>
      </section>
      <footer>
        Report {text(report.reportVersion, "draft")} · data source{" "}
        {text(report.dataMode, "database")} · generated{" "}
        {formatWhen(report.generatedAt, "time not recorded")}
      </footer>
    </article>
  );
}

export function Reports({
  auditId,
  principal,
  canWrite,
  qualified,
}: {
  auditId: string;
  principal: Principal;
  canWrite: boolean;
  qualified: boolean;
}) {
  const report = useResource(scoped("/api/reports/audit-readiness", auditId));
  const approvals = useResource(scoped("/api/reports/approvals", auditId));
  const people = useResource("/api/people");
  const personas = useConfigurations("persona");
  const rules = useResource(
    scoped("/api/approval-rules", auditId, {
      decisionType: "audit_report_finalization",
    })
  );
  const [personId, setPersonId] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [note, setNote] = useState("");
  const action = useAction();
  const actualPeople = rows(people.data, "people")
    .map(payload)
    .filter(p => p.active !== false);
  const rule = rows(rules.data, "rules")[0];
  const allowed = Array.isArray(rule?.allowedRoleIds)
    ? rule.allowedRoleIds
    : [];
  const lensOptions = personas.data.filter(envelope =>
    allowed.includes(id(envelope))
  );
  const approvers = actualPeople.filter(
    p =>
      p.roleId === personaId ||
      (Array.isArray(p.roleIds) && p.roleIds.includes(personaId))
  );
  const tasks = rows(approvals.data, "tasks", "approvals", "items").map(
    payload
  );
  return (
    <div className="view-stack">
      <Panel
        title="Audit readiness report"
        subtitle={`Explicit audit ${auditId}. Displayed readiness is source-provided; no local formula or fabricated prior reports.`}
        actions={
          <div className="assurance-inline">
            <button
              className="primary-button"
              disabled={!report.data}
              onClick={() => window.print()}
            >
              Print / PDF
            </button>
          </div>
        }
      >
        <ResourceState resource={report} />
        {report.data && (
          <>
            <ReadinessNarrative report={report.data} />
            <details className="technical-details">
              <summary>Technical exports and raw report data</summary>
              <div className="assurance-inline">
                <button
                  className="ghost-button"
                  disabled={action.busy}
                  onClick={() =>
                    action.run(() =>
                      download(
                        scoped("/api/reports/audit-readiness", auditId),
                        `readiness-${auditId}.json`
                      ).then(() => ({
                        auditId,
                        format: "JSON",
                        downloadCompleted: true,
                      }))
                    )
                  }
                >
                  <Download size={13} />
                  JSON source
                </button>
                <button
                  className="ghost-button"
                  disabled={action.busy}
                  onClick={() =>
                    action.run(() =>
                      download(
                        scoped("/api/reports/audit-readiness.csv", auditId),
                        `readiness-${auditId}.csv`
                      ).then(() => ({
                        auditId,
                        format: "CSV",
                        downloadCompleted: true,
                      }))
                    )
                  }
                >
                  CSV source
                </button>
              </div>
              <Json value={report.data} />
            </details>
          </>
        )}
      </Panel>
      <Panel
        title="Principal-bound report routing & approval"
        subtitle="Route to an actual person in the database directory. Approval is only available to that assigned, currently qualified authenticated principal."
      >
        <ResourceState resource={people} />
        <ResourceState resource={personas} />
        <ResourceState resource={rules} />
        <div className="assurance-form assurance-query-form">
          <label>
            Authorized reviewer role
            <select
              value={personaId}
              onChange={e => {
                setPersonaId(e.target.value);
                setPersonId("");
              }}
            >
              <option value="">Select a rule-authorized role</option>
              {lensOptions.map(p => (
                <option key={id(p)} value={id(p)}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Named approver from the database directory
            <select
              value={personId}
              onChange={e => setPersonId(e.target.value)}
            >
              <option value="">Select a named approver</option>
              {approvers.map(p => (
                <option key={id(p)} value={id(p)}>
                  {label(p)} · {text(p.title, "Role title not recorded")}
                  {p.synthetic ? " · demonstration directory" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Routing / approval rationale
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
            />
          </label>
          <button
            className="primary-button"
            disabled={
              action.busy ||
              !canWrite ||
              !personId ||
              !personaId ||
              !note.trim()
            }
            onClick={() =>
              action.run(async () => {
                const result = await request(
                  `/api/reports/${encodeURIComponent(auditId)}/approval-route`,
                  { auditId, personaId, personId, note }
                );
                approvals.refresh();
                return result;
              })
            }
          >
            Route report for human review
          </button>
        </div>
        {!actualPeople.length && !people.loading && !people.error && (
          <Empty>
            No directory entry matches the allowed approver roles for this
            decision. An administrator can register a named person and assign an
            authorized role in Role access (RBAC).
          </Empty>
        )}
        {!allowed.length && !rules.loading && !rules.error && (
          <Empty>
            No active report-approval role rule is configured. Routing is
            blocked.
          </Empty>
        )}
        <ErrorNotice error={action.error} />
        {action.result && (
          <Json
            value={action.result}
            title="Exact routing / approval / lifecycle result"
            open
          />
        )}
        <ResourceState resource={approvals} />
        {!approvals.loading && !approvals.error && !tasks.length && (
          <Empty>No approval tasks for this audit.</Empty>
        )}
        {tasks.map((task, index) => {
          const assignedId =
            task.target?.personId ?? task.personId ?? task.assignedPersonId;
          const assigned = Boolean(
            principal.personId &&
              assignedId &&
              String(assignedId) === String(principal.personId)
          );
          const approvalId = task.approvalId ?? id(task);
          const canApprove =
            assigned &&
            qualified &&
            task.status === "pending" &&
            Boolean(approvalId);
          return (
            <div key={approvalId || index} className="assurance-approval">
              <div className="assurance-inline">
                <strong>{text(approvalId)}</strong>
                <Badge>{text(task.status)}</Badge>
                <span>
                  Assigned to {text(task.target?.personName ?? assignedId)}
                </span>
              </div>
              <Json
                value={task}
                title="Assignment, exact report artifact and approval event"
              />
              <button
                className="primary-button"
                disabled={action.busy || !canApprove || !note.trim()}
                onClick={() =>
                  action.run(async () => {
                    const result = await request(
                      `/api/reports/approvals/${encodeURIComponent(approvalId)}/approve`,
                      { auditId, note }
                    );
                    approvals.refresh();
                    report.refresh();
                    return result;
                  })
                }
              >
                Approve as {principal.actor}
              </button>
              {!assigned && (
                <small>
                  Only the assigned actual principal may approve. Actor names
                  cannot be typed or spoofed.
                </small>
              )}
              {assigned && !qualified && (
                <small>
                  Your current audit qualification is missing or expired.
                </small>
              )}
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
