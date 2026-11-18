import { useState } from "react";
import {
  ArrowUpRight,
  ClipboardCheck,
  Plus,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { Badge, Empty, ErrorNotice, ResourceState } from "./Common";
import {
  id,
  label,
  payload,
  request,
  rows,
  text,
  useAction,
  useResource,
  type Principal,
  type Row,
} from "./api";

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <span />
        <span />
        <span />
      </div>
      <div>
        <strong>PART 21</strong>
        <small>ASSURANCE OS</small>
      </div>
    </div>
  );
}
export function AuditCreation({
  onCreated,
}: {
  onCreated: (audit: Row) => void;
}) {
  const profiles = useResource("/api/nuclear/profiles");
  const [form, setForm] = useState({
    title: "",
    scope: "",
    standard: "",
    due: "",
    profileId: "",
  });
  const action = useAction();
  const options = rows(profiles.data, "profiles");
  return (
    <div className="create-audit-form assurance-form">
      <ResourceState resource={profiles} />
      <label>
        Governed audit profile
        <select
          value={form.profileId}
          onChange={e => {
            const selected = options.find(p => id(p) === e.target.value);
            const profile = payload(selected);
            setForm({
              ...form,
              profileId: e.target.value,
              standard:
                typeof profile.standard === "string"
                  ? profile.standard
                  : form.standard,
            });
          }}
        >
          <option value="">Select a persisted profile</option>
          {options.map(p => (
            <option key={id(p)} value={id(p)}>
              {label(p)} · {text(p.status ?? payload(p).status)}
            </option>
          ))}
        </select>
      </label>
      {!profiles.loading && !profiles.error && !options.length && (
        <Empty>
          No governed profiles configured. Audit creation is blocked until a
          profile is available.
        </Empty>
      )}
      <label>
        Audit title
        <input
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
        />
      </label>
      <label>
        Scope
        <textarea
          value={form.scope}
          onChange={e => setForm({ ...form, scope: e.target.value })}
          rows={3}
        />
      </label>
      <label>
        Applicable standard
        <input
          value={form.standard}
          onChange={e => setForm({ ...form, standard: e.target.value })}
          placeholder="As governed by the selected profile"
        />
      </label>
      <label>
        Target due date
        <input
          type="date"
          value={form.due}
          onChange={e => setForm({ ...form, due: e.target.value })}
        />
      </label>
      <p>
        Audit target dates do not start or reset regulatory evaluation clocks.
        The authenticated principal owns this request.
      </p>
      <ErrorNotice error={action.error} />
      <button
        className="primary-button"
        disabled={
          action.busy ||
          !form.title.trim() ||
          !form.scope.trim() ||
          !form.profileId ||
          !form.due ||
          !form.standard.trim()
        }
        onClick={() =>
          action.run(async () => {
            const result = await request("/api/domain/audits", form);
            const audit = payload(result.audit ?? result.record ?? result);
            const createdId = id(audit) || String(result.auditId ?? "");
            if (!createdId)
              throw new Error(
                "Creation returned no persisted audit ID. Refresh the audit register before retrying."
              );
            onCreated({ ...audit, id: createdId });
            return result;
          })
        }
      >
        {action.busy ? "Creating…" : "Create persisted audit"}
      </button>
    </div>
  );
}
export function Launch({
  principal,
  audits,
  personas,
  selectedAudit,
  selectedLens,
  onAudit,
  onLens,
  onEnter,
  onCreated,
  refreshAudits,
}: {
  principal: Principal;
  audits: ReturnType<typeof useResource>;
  personas: {
    data: Row[];
    loading: boolean;
    error: Error | null;
    refresh: () => void;
  };
  selectedAudit: string;
  selectedLens: string;
  onAudit: (id: string) => void;
  onLens: (id: string) => void;
  onEnter: () => void;
  onCreated: (audit: Row) => void;
  refreshAudits: () => void;
}) {
  const [create, setCreate] = useState(false);
  const auditRows = rows(audits.data, "audits").filter(
    audit =>
      principal.isAdmin ||
      !Array.isArray(principal.auditIds) ||
      principal.auditIds.includes(id(audit)) ||
      principal.auditIds.includes(String(audit.auditId ?? ""))
  );
  const chosen = auditRows.find(a => id(a) === selectedAudit);
  const lens = personas.data.find(p => id(p) === selectedLens);
  return (
    <div className="launch-shell">
      <div className="launch-topbar">
        <Brand />
        <span className="tiny-label">
          Signed in: {principal.actor} ·{" "}
          {principal.roleIds?.join(", ") || "No assigned role"}
        </span>
      </div>
      <main className="launch-content">
        <section className="launch-hero">
          <div>
            <div className="eyebrow">AUTHENTICATED ASSURANCE WORKSPACE</div>
            <h1>Start with the decision you need to make.</h1>
            <p>
              Select an audit and a governed persona lens. The lens changes
              perspective—not identity, qualifications, or access rights.
            </p>
          </div>
          <div className="launch-hero-orbit">
            <div className="orbit-core">
              <ShieldCheck size={30} />
            </div>
          </div>
        </section>
        <section className="launch-grid">
          <div className="launch-panel">
            <div className="launch-panel-head">
              <div>
                <span className="tiny-label">01 · PERSPECTIVE</span>
                <h2>Select your assurance lens</h2>
                <p>
                  Loaded from exact active database configuration revisions.
                </p>
              </div>
            </div>
            <ResourceState resource={personas} />
            <div className="launch-personas">
              {personas.data.map(envelope => {
                const p = payload(envelope);
                return (
                  <button
                    key={id(envelope)}
                    className={`launch-persona ${id(envelope) === selectedLens ? "active" : ""}`}
                    onClick={() => onLens(id(envelope))}
                  >
                    <span className="launch-persona-icon">
                      <UserCog size={17} />
                    </span>
                    <span>
                      <strong>{label(p)}</strong>
                      <small>{text(p.title, "")}</small>
                      <em>{text(p.description, "")}</em>
                      <small>
                        Configuration {text(envelope.configId)} ·{" "}
                        {text(envelope.version)}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            {!personas.loading && !personas.error && !personas.data.length && (
              <Empty>
                No active persona configuration. A governed lens must be
                configured before entry.
              </Empty>
            )}
          </div>
          <div className="launch-panel">
            <div className="launch-panel-head">
              <div>
                <span className="tiny-label">02 · AUDIT CONTEXT</span>
                <h2>Resume or create an audit</h2>
                <p>Only authorized database audits are selectable.</p>
              </div>
              <button
                className="ghost-button"
                onClick={() => setCreate(!create)}
              >
                <Plus size={13} />
                New audit
              </button>
            </div>
            {create && (
              <AuditCreation
                onCreated={audit => {
                  onCreated(audit);
                  setCreate(false);
                }}
              />
            )}
            <ResourceState resource={audits} />
            <div className="launch-audit-list">
              {auditRows.map(envelope => {
                const audit = payload(envelope);
                return (
                  <button
                    key={id(envelope)}
                    className={`launch-audit-card ${id(envelope) === selectedAudit ? "active" : ""}`}
                    onClick={() => onAudit(id(envelope))}
                  >
                    <div className="launch-audit-top">
                      <span>{id(envelope)}</span>
                      <Badge>{text(audit.status)}</Badge>
                    </div>
                    <strong>{label(audit)}</strong>
                    <p>
                      {text(audit.standard, "Standard not recorded")} ·{" "}
                      {text(audit.scope, "Scope not recorded")}
                    </p>
                    <div className="launch-audit-meta">
                      <span>Due {text(audit.due)}</span>
                      <span>Owner {text(audit.owner, "Not recorded")}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {!audits.loading && !audits.error && !auditRows.length && (
              <Empty>
                No authorized audits exist. Create an audit above or request
                access from an administrator.
              </Empty>
            )}
            <button className="text-button" onClick={refreshAudits}>
              Refresh audit register
            </button>
          </div>
        </section>
        <section className="launch-bottom">
          <div className="launch-context-card">
            <ClipboardCheck size={20} />
            <div>
              <span className="tiny-label">CONTEXT PREVIEW</span>
              <strong>
                {lens ? label(lens) : "No lens selected"} ·{" "}
                {chosen ? id(chosen) : "No audit selected"}
              </strong>
              <p>
                Permissions remain those of {principal.actor}. Readiness and
                operational records are loaded after entry.
              </p>
            </div>
          </div>
          <button
            className="launch-start-button"
            disabled={!chosen || !lens}
            onClick={onEnter}
          >
            Enter assurance workspace
            <ArrowUpRight size={17} />
          </button>
        </section>
        <div className="launch-footer">
          Human review required · engineering workspace, not a compliance
          certification
        </div>
      </main>
    </div>
  );
}
