import { useState } from "react";
import { FileUp, RefreshCw } from "lucide-react";
import { Configuration } from "./Controlled";
import {
  Badge,
  Empty,
  EndpointPanel,
  ErrorNotice,
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

export function Identity({ principal }: { principal: Principal }) {
  return (
    <Panel
      title="Authenticated identity & permissions"
      subtitle="Lens selection changes presentation only. Permissions, audit membership and qualification come from the server."
    >
      <Json
        value={principal}
        title="Actual session principal, role IDs and audit qualification"
        open
      />
    </Panel>
  );
}
function AccessSetup({ principal }: { principal: Principal }) {
  const people = useResource("/api/people");
  const audits = useResource("/api/domain/audits");
  const grants = useResource("/api/access/grants");
  const [form, setForm] = useState({
    principalId: "",
    auditId: "",
    roleIds: "",
    access: "look_only",
    personId: "",
    qualificationEvidenceId: "",
    qualifiedUntil: "",
  });
  const action = useAction();
  const directory = rows(people.data, "people")
    .map(payload)
    .filter(p => p.synthetic !== true && p.active !== false);
  return (
    <Panel
      title="Actual directory & audit scope setup"
      subtitle={`Administrator ${principal.actor} may configure access, but cannot manufacture a nuclear qualification or upgrade a read-only connector token.`}
    >
      <ResourceState resource={grants} />
      {grants.data && (
        <Json value={grants.data} title="Existing actual audit grants" />
      )}
      <JsonOperation
        title="Register an actual database person"
        path="/api/people"
        initial={{
          name: "",
          title: "",
          roleId: "",
          email: "",
          organization: "",
          principalId: "",
        }}
        description="Register the actual human and their authenticated principal binding. This is a directory entry, not evidence of nuclear qualification. Synthetic directory rows are excluded from approval selection."
        onDone={people.refresh}
      />
      <ResourceState resource={people} />
      <ResourceState resource={audits} />
      <div className="assurance-form assurance-document-form">
        <label>
          Authenticated principal ID
          <input
            value={form.principalId}
            onChange={e => setForm({ ...form, principalId: e.target.value })}
            placeholder="Exact session/connector principal ID—not a display name"
          />
        </label>
        <label>
          Actual audit
          <select
            value={form.auditId}
            onChange={e => setForm({ ...form, auditId: e.target.value })}
          >
            <option value="">Select an existing audit</option>
            {rows(audits.data, "audits").map(a => (
              <option key={id(a)} value={id(a)}>
                {id(a)} · {label(a)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Granted role IDs (comma separated)
          <input
            value={form.roleIds}
            onChange={e => setForm({ ...form, roleIds: e.target.value })}
          />
        </label>
        <label>
          Audit access
          <select
            value={form.access}
            onChange={e => setForm({ ...form, access: e.target.value })}
          >
            <option value="look_only">Look only</option>
            <option value="make_changes">
              Make changes (cannot elevate connector token)
            </option>
          </select>
        </label>
        <label>
          Actual person (optional unless qualifying)
          <select
            value={form.personId}
            onChange={e => setForm({ ...form, personId: e.target.value })}
          >
            <option value="">No qualification person</option>
            {directory.map(p => (
              <option key={id(p)} value={id(p)}>
                {label(p)} · {text(p.principalId, "Binding not returned")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Existing retained qualification evidence ID
          <input
            value={form.qualificationEvidenceId}
            onChange={e =>
              setForm({ ...form, qualificationEvidenceId: e.target.value })
            }
            placeholder="Only an actual retained qualification record"
          />
        </label>
        <label>
          Actual qualification expiry
          <input
            type="datetime-local"
            value={form.qualifiedUntil}
            onChange={e => setForm({ ...form, qualifiedUntil: e.target.value })}
          />
        </label>
        <button
          className="primary-button"
          disabled={
            action.busy ||
            !form.principalId.trim() ||
            !form.auditId ||
            !form.roleIds.trim() ||
            Boolean(
              form.qualificationEvidenceId &&
                (!form.personId || !form.qualifiedUntil)
            )
          }
          onClick={() =>
            action.run(async () => {
              const result = await request("/api/access/grants", {
                principalId: form.principalId.trim(),
                auditId: form.auditId,
                roleIds: form.roleIds
                  .split(",")
                  .map(s => s.trim())
                  .filter(Boolean),
                access: form.access,
                ...(form.personId ? { personId: form.personId } : {}),
                ...(form.qualificationEvidenceId
                  ? {
                      qualificationEvidenceId:
                        form.qualificationEvidenceId.trim(),
                      qualifiedUntil: new Date(
                        form.qualifiedUntil
                      ).toISOString(),
                    }
                  : {}),
              });
              grants.refresh();
              return result;
            })
          }
        >
          Issue reviewed audit access grant
        </button>
      </div>
      <ErrorNotice error={action.error} />
      {action.result && (
        <Json
          value={action.result}
          title="Actual persisted grant / issuance event"
          open
        />
      )}
      <small>
        Refresh the authenticated session after scope or qualification changes.
        No automatic escalation or nuclear qualification is performed.
      </small>
    </Panel>
  );
}
export function AdapterOperations({
  auditId,
  isAdmin,
}: {
  auditId?: string;
  isAdmin: boolean;
}) {
  const manifest = useResource("/api/mcp/tools");
  const connectorConfig = useConfigurations("connector");
  const [tool, setTool] = useState("");
  const [args, setArgs] = useState("{}");
  const action = useAction();
  const tools = rows(manifest.data, "tools");
  const selected = tools.find(t => t.name === tool);
  return (
    <div className="view-stack">
      <Panel
        title="MCP tools & actual adapter contracts"
        subtitle="Tool discovery is not proof of a live enterprise connection. Complete status/provenance is inspectable."
      >
        <ResourceState resource={manifest} />
        {manifest.data && (
          <Json
            value={manifest.data}
            title="Exact MCP tool manifest and input schemas"
          />
        )}
        <ResourceState resource={connectorConfig} />
        {connectorConfig.data.length
          ? connectorConfig.data.map((entry, index) => (
              <Json
                value={entry}
                key={id(entry) || index}
                title={`${label(entry)} · ${text(entry.status)} · ${text(entry.version)}`}
              />
            ))
          : !connectorConfig.loading &&
            !connectorConfig.error && (
              <Empty>No active connector configuration.</Empty>
            )}
        {isAdmin && (
          <div className="assurance-form">
            <label>
              Actual discovered tool
              <select value={tool} onChange={e => setTool(e.target.value)}>
                <option value="">Select a returned tool</option>
                {tools.map(t => (
                  <option value={t.name} key={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <Json value={selected} title="Selected exact tool contract" />
            )}
            <label>
              Explicit arguments JSON
              <textarea
                value={args}
                onChange={e => setArgs(e.target.value)}
                rows={6}
              />
            </label>
            <button
              className="primary-button"
              disabled={action.busy || !auditId || !tool}
              onClick={() =>
                action.run(async () => {
                  const input = JSON.parse(args);
                  if (
                    !input ||
                    Array.isArray(input) ||
                    typeof input !== "object"
                  )
                    throw new Error("Tool arguments must be a JSON object.");
                  for (const field of [
                    "actor",
                    "createdBy",
                    "reviewer",
                    "approvedBy",
                  ])
                    if (field in input)
                      throw new Error(
                        "Do not supply an acting identity; it must be server-derived."
                      );
                  return request("/api/mcp/call", {
                    auditId,
                    name: tool,
                    arguments: { ...input, auditId },
                  });
                })
              }
            >
              Execute selected tool in current audit
            </button>
            {!auditId && (
              <Empty>Select an audit before operational MCP calls.</Empty>
            )}
            <ErrorNotice error={action.error} />
            {action.result && (
              <Json
                value={action.result}
                title="Actual tool result, source IDs and execution proof"
                open
              />
            )}
          </div>
        )}
      </Panel>
      <EndpointPanel title="Embedded ECC module" path="/api/ecc/module" />
      <EndpointPanel
        title="Vendored ECC source inventory"
        path="/api/ecc/library"
        subtitle="Vendored source inventory is not execution status."
      />
    </div>
  );
}
function WorkbookOperations({ auditId }: { auditId?: string }) {
  const status = useResource(
    auditId
      ? scoped("/api/admin/excel/status", auditId)
      : "/api/admin/excel/status"
  );
  const samples = useResource("/api/admin/excel/samples");
  const compare = useResource(
    auditId ? scoped("/api/admin/excel/compare", auditId) : null
  );
  const pending = useResource(
    auditId ? scoped("/api/approvals/pending", auditId) : null
  );
  const action = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const templates = rows(samples.data, "samples", "templates");
  return (
    <Panel
      title="Workbook input adapter"
      subtitle="Workbooks are input sources, not the authoritative system of record. Synthetic templates, if returned, are explicitly sample files."
    >
      <ResourceState resource={status} />
      {status.data && (
        <Json
          value={status.data}
          title="Actual workbook adapter / local-directory status"
          open
        />
      )}
      <ResourceState resource={samples} />
      <div className="assurance-inline">
        {templates.map((sample, index) => {
          const href = String(sample.href ?? sample.downloadUrl ?? "");
          const safe = href.startsWith("/") && !href.startsWith("//");
          return (
            <button
              className="ghost-button"
              key={id(sample) || index}
              disabled={action.busy || !safe}
              onClick={() =>
                action.run(() =>
                  download(href, String(sample.name ?? "workbook.xlsx")).then(
                    () => ({ downloaded: sample, sampleOnly: true })
                  )
                )
              }
            >
              {label(sample)} · sample/template
            </button>
          );
        })}
      </div>
      <div className="assurance-form assurance-query-form">
        <label>
          Actual workbook
          <input
            type="file"
            accept=".xlsx,.xlsm,.xltx,.xls"
            disabled={action.busy || !auditId}
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Actual workbook provenance / source
          <input value={source} onChange={e => setSource(e.target.value)} />
        </label>
        <button
          className="primary-button"
          disabled={action.busy || !auditId || !file || !source.trim()}
          onClick={() =>
            action.run(async () => {
              if (!file) throw new Error("Choose a workbook.");
              const result = await request("/api/admin/excel/upload", {
                auditId,
                filename: file.name,
                source,
                base64: await fileBase64(file),
              });
              status.refresh();
              compare.refresh();
              pending.refresh();
              setFile(null);
              return result;
            })
          }
        >
          <FileUp size={13} />
          Import actual workbook revision
        </button>
      </div>
      {!auditId && (
        <Empty>
          Select an audit before workbook intake, comparison or approval.
        </Empty>
      )}
      <ErrorNotice error={action.error} />
      {action.result && (
        <Json
          value={action.result}
          title="Actual workbook revision hash, changed rows and approval status"
          open
        />
      )}
      <ResourceState resource={compare} />
      {compare.data && (
        <Json value={compare.data} title="Actual revision comparison" />
      )}
      <ResourceState resource={pending} />
      {pending.data && (
        <>
          <RecordList
            data={rows(pending.data, "items", "approvals")}
            onInspect={setSelected}
            empty="No pending workbook imports."
          />
          <Json value={pending.data} title="Exact workbook approval queue" />
        </>
      )}
      {selected && auditId && (
        <div>
          <Json value={selected} open />
          <JsonOperation
            title="Approve inspected actual workbook revision"
            path={`/api/approvals/workbooks/${encodeURIComponent(String(selected.workbookId ?? selected.id ?? ""))}`}
            auditId={auditId}
            initial={{
              note: "",
              expectedRevision: selected.recordRevision ?? selected.revision,
              sourceSha256: selected.sha256,
            }}
            description="Server applies qualified review and revision/hash checks. Approval is not evidence of automatic graph promotion."
            onDone={pending.refresh}
          />
        </div>
      )}
    </Panel>
  );
}
function WeeklySync({ auditId }: { auditId?: string }) {
  const action = useAction();
  return (
    <Panel
      title="Weekly source synchronization"
      subtitle="Run the existing synchronization once now. This does not create or claim an unattended schedule."
    >
      <button
        className="primary-button"
        disabled={action.busy || !auditId}
        onClick={() =>
          action.run(() => request("/api/sync/weekly", { auditId }))
        }
      >
        <RefreshCw size={13} />
        {action.busy
          ? "Checking actual sources…"
          : "Run existing weekly sync now"}
      </button>
      {!auditId && <Empty>Select an audit before synchronization.</Empty>}
      <ErrorNotice error={action.error} />
      {action.result && (
        <Json
          value={action.result}
          title="Complete synchronization result: changed / unchanged / unconfigured / failed"
          open
        />
      )}
    </Panel>
  );
}
export function Admin({
  principal,
  auditId,
}: {
  principal: Principal;
  auditId?: string;
}) {
  if (!principal.isAdmin)
    return (
      <>
        <Identity principal={principal} />
        <Empty>
          Administrator permission is required. A persona lens cannot grant it.
        </Empty>
      </>
    );
  return (
    <div className="view-stack">
      <Identity principal={principal} />
      <AccessSetup principal={principal} />
      <Configuration isAdmin />
      <EndpointPanel
        title="Nuclear integration readiness"
        path={
          auditId
            ? scoped("/api/nuclear/status", auditId)
            : "/api/nuclear/status"
        }
      />
      <EndpointPanel
        title="Existing LLM service status"
        path="/api/ai/status"
        subtitle="Existing LLM retained. No Ollama dispatch or alternate provider is introduced."
      />
      <WeeklySync auditId={auditId} />
      <AdapterOperations auditId={auditId} isAdmin />
      <WorkbookOperations auditId={auditId} />
    </div>
  );
}
