import { useState } from "react";
import { Download, FileUp } from "lucide-react";
import { AssetActions } from "./Board";
import {
  Badge,
  Empty,
  ErrorNotice,
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
        {vault.data && <Json value={vault.data} open />}
      </Panel>
      {selected && (
        <Inspector
          title={label(selected)}
          description={`Evidence ${id(selected)} · audit ${auditId}`}
          onClose={() => setSelected(null)}
        >
          <Json value={selected} open />
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
        {status.data && <Json value={status.data} open />}
      </Panel>
      {selected && (
        <Inspector
          title={label(selected)}
          description={`${auditId} · document ${id(selected)} · revision ${text(payload(selected).revision)}`}
          onClose={() => setSelectedId("")}
        >
          <Json value={selected} open />
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
              className="ghost-button"
              disabled={action.busy || !report.data}
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
              JSON
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
              CSV
            </button>
            <button className="ghost-button" onClick={() => window.print()}>
              Print / PDF
            </button>
          </div>
        }
      >
        <ResourceState resource={report} />
        {report.data && (
          <Json
            value={report.data}
            title="Exact report, basis, source links and approval history"
            open
          />
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
