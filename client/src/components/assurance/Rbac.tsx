import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, UserPlus, KeyRound, RotateCcw } from "lucide-react";
import {
  Badge,
  Empty,
  ErrorNotice,
  Json,
  Panel,
  ResourceState,
} from "./Common";
import {
  request,
  rows,
  useAction,
  useResource,
  type Principal,
  type Row,
} from "./api";

function permissionKey(area: string, action: string) {
  return `${area}.${action}`;
}

export function RbacAdmin({
  principal,
  auditId,
}: {
  principal: Principal;
  auditId?: string;
}) {
  const snapshot = useResource("/api/admin/rbac");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [draft, setDraft] = useState<{ name: string; description: string; permissions: string[]; active: boolean }>({ name: "", description: "", permissions: [], active: true });
  const [personForm, setPersonForm] = useState({ name: "", title: "", roleId: "", email: "", organization: "Nextera Nuclear — demonstration directory" });
  const [grantForm, setGrantForm] = useState({ personId: "", auditId: auditId ?? "", roleId: "", access: "make_changes" });
  const [filterPerson, setFilterPerson] = useState("");
  const saveRole = useAction();
  const addPerson = useAction();
  const assign = useAction();
  const revoke = useAction();

  const data = snapshot.data ?? {};
  const roles: Row[] = rows(data.roles);
  const people: Row[] = rows(data.people);
  const audits: Row[] = rows(data.audits);
  const assignments: Row[] = rows(data.assignments);
  const areas: Row[] = rows(data.permissionCatalog?.areas);

  const selectedRole = roles.find(role => String(role.id) === selectedRoleId);
  useEffect(() => {
    if (!selectedRole && roles.length) {
      setSelectedRoleId(String(roles[0].id));
      return;
    }
    if (selectedRole) {
      setDraft({
        name: String(selectedRole.name ?? ""),
        description: String(selectedRole.description ?? ""),
        permissions: Array.isArray(selectedRole.permissions) ? selectedRole.permissions.map(String) : [],
        active: selectedRole.active !== false,
      });
    }
  }, [selectedRoleId, snapshot.data]);

  const isWildcard = draft.permissions.includes("*");
  const selectedPerson = people.find(person => String(person.id) === grantForm.personId);
  const visibleAssignments = useMemo(
    () => assignments.filter(item => !filterPerson || String(item.personId ?? "") === filterPerson),
    [assignments, filterPerson]
  );

  if (!principal.isAdmin) {
    return (
      <Panel title="Role-based access control" subtitle="This area is restricted to application administrators.">
        <Empty>You do not have permission to view role administration at this time. Ask an application administrator to review your access.</Empty>
      </Panel>
    );
  }

  function togglePermission(key: string) {
    if (isWildcard) return;
    setDraft(current => ({
      ...current,
      permissions: current.permissions.includes(key)
        ? current.permissions.filter(permission => permission !== key)
        : [...current.permissions, key],
    }));
  }

  return (
    <div className="view-stack">
      <Panel
        title="Role-based access control"
        subtitle={`Signed in as ${principal.actor}. Roles grant permissions by site area; audit grants decide which engagements a person can touch. Changes apply on the next request.`}
        actions={<Badge tone="ok">{roles.length} roles</Badge>}
      >
        <ResourceState resource={snapshot} />
        <div className="assurance-inline">
          <ShieldCheck size={14} />
          <span>
            A denied action is refused politely with a clear message. It is never silently ignored.
          </span>
        </div>
        <Json value={data.effective} title="Your effective permissions" />
      </Panel>

      <Panel
        title="Role permission matrix"
        subtitle="Select a role, then choose the areas and actions it may perform. Administrator always retains every permission."
      >
        {roles.length === 0 && <Empty>No roles are configured yet.</Empty>}
        {roles.length > 0 && (
          <>
            <div className="assurance-form assurance-query-form">
              <label>
                Role
                <select value={selectedRoleId} onChange={event => setSelectedRoleId(event.target.value)}>
                  {roles.map(role => (
                    <option key={String(role.id)} value={String(role.id)}>
                      {String(role.name)} ({String(role.id)})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Display name
                <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>
                Description
                <input value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
              </label>
            </div>
            {isWildcard && (
              <div className="assurance-inline">
                <Badge tone="warn">All permissions</Badge>
                <span>This role is intentionally unrestricted. Remove the wildcard by editing a copy if you need a narrower role.</span>
              </div>
            )}
            <div className="assurance-record-list" style={{ maxHeight: 460, overflow: "auto" }}>
              {areas.map(area => (
                <div className="assurance-record-row" key={String(area.id)} style={{ alignItems: "flex-start" }}>
                  <span>
                    <strong>{String(area.label)}</strong>
                    <small>{String(area.description)}</small>
                  </span>
                  <span style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 10 }}>
                    {(Array.isArray(area.actions) ? area.actions : []).map((action: string) => {
                      const key = permissionKey(String(area.id), action);
                      return (
                        <label key={key} className="assurance-inline" style={{ marginTop: 0, gap: 5 }}>
                          <input
                            type="checkbox"
                            disabled={isWildcard}
                            checked={isWildcard || draft.permissions.includes(key)}
                            onChange={() => togglePermission(key)}
                          />
                          {action}
                        </label>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
            <ErrorNotice error={saveRole.error} />
            <div className="assurance-inline">
              <button
                className="primary-button"
                disabled={saveRole.busy || !draft.name.trim() || (!isWildcard && draft.permissions.length === 0)}
                onClick={() =>
                  saveRole.run(async () => {
                    const result = await request("/api/admin/rbac/roles", {
                      id: selectedRoleId,
                      name: draft.name.trim(),
                      description: draft.description.trim(),
                      permissions: isWildcard ? ["*"] : draft.permissions,
                      active: draft.active,
                    });
                    snapshot.refresh();
                    return result;
                  })
                }
              >
                Save role permissions
              </button>
              <button className="ghost-button" disabled={!selectedRole} onClick={() => selectedRole && setDraft({
                name: String(selectedRole.name ?? ""),
                description: String(selectedRole.description ?? ""),
                permissions: Array.isArray(selectedRole.permissions) ? selectedRole.permissions.map(String) : [],
                active: selectedRole.active !== false,
              })}>
                <RotateCcw size={13} /> Reset changes
              </button>
            </div>
            {saveRole.result && <Json value={saveRole.result} title="Saved role" open />}
          </>
        )}
      </Panel>

      <Panel
        title="Named directory and audit access"
        subtitle="These are explicit demonstration people. They can hold audit access and be assigned work; they cannot establish a nuclear qualification."
        actions={<Badge tone="info">{people.length} people</Badge>}
      >
        <div className="assurance-form assurance-query-form">
          <label>
            Filter assignments by person
            <select value={filterPerson} onChange={event => setFilterPerson(event.target.value)}>
              <option value="">All people</option>
              {people.map(person => (
                <option key={String(person.id)} value={String(person.id)}>
                  {String(person.name)} · {String(person.roleName ?? person.roleId)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="assurance-record-list" style={{ maxHeight: 360, overflow: "auto" }}>
          {people.map(person => (
            <div className="assurance-record-row" key={String(person.id)}>
              <span>
                <strong>{String(person.name)}</strong>
                <small>
                  {String(person.id)} · {String(person.title)} · {String(person.email)}
                </small>
              </span>
              <span style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Badge tone="info">{String(person.roleName ?? person.roleId)}</Badge>
                <Badge>{String(person.grants ?? 0)} grants</Badge>
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Register a named person"
        subtitle="The person is persisted in MySQL and becomes selectable for routing and access assignment."
        actions={<UserPlus size={16} />}
      >
        <div className="assurance-form assurance-document-form">
          <label>
            Full name
            <input value={personForm.name} onChange={event => setPersonForm({ ...personForm, name: event.target.value })} placeholder="e.g. Dana Whitfield" />
          </label>
          <label>
            Title
            <input value={personForm.title} onChange={event => setPersonForm({ ...personForm, title: event.target.value })} placeholder="e.g. Part 21 Program Manager" />
          </label>
          <label>
            Role
            <select value={personForm.roleId} onChange={event => setPersonForm({ ...personForm, roleId: event.target.value })}>
              <option value="">Select a governed role</option>
              {roles.map(role => (
                <option key={String(role.id)} value={String(role.id)}>{String(role.name)}</option>
              ))}
            </select>
          </label>
          <label>
            Email
            <input value={personForm.email} onChange={event => setPersonForm({ ...personForm, email: event.target.value })} placeholder="name@nextera.example" />
          </label>
          <label>
            Organization
            <input value={personForm.organization} onChange={event => setPersonForm({ ...personForm, organization: event.target.value })} />
          </label>
          <button
            className="primary-button"
            disabled={addPerson.busy || !personForm.name.trim() || !personForm.title.trim() || !personForm.roleId || !personForm.email.trim()}
            onClick={() =>
              addPerson.run(async () => {
                const result = await request("/api/people", personForm);
                setPersonForm({ name: "", title: "", roleId: "", email: "", organization: "Nextera Nuclear — demonstration directory" });
                snapshot.refresh();
                return result;
              })
            }
          >
            Add person to directory
          </button>
        </div>
        <ErrorNotice error={addPerson.error} />
        {addPerson.result && <Json value={addPerson.result} title="Persisted person" open />}
      </Panel>

      <Panel
        title="Assign audit access"
        subtitle="A grant binds one person to one audit with a role. The role's area permissions still apply."
        actions={<KeyRound size={16} />}
      >
        <div className="assurance-form assurance-document-form">
          <label>
            Person
            <select
              value={grantForm.personId}
              onChange={event => {
                const person = people.find(item => String(item.id) === event.target.value);
                setGrantForm({ ...grantForm, personId: event.target.value, roleId: String(person?.roleId ?? grantForm.roleId) });
              }}
            >
              <option value="">Select a named person</option>
              {people.map(person => (
                <option key={String(person.id)} value={String(person.id)}>
                  {String(person.name)} · {String(person.roleName ?? person.roleId)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Audit
            <select value={grantForm.auditId} onChange={event => setGrantForm({ ...grantForm, auditId: event.target.value })}>
              <option value="">Select an audit</option>
              {audits.map(audit => (
                <option key={String(audit.id)} value={String(audit.id)}>
                  {String(audit.id)} · {String(audit.title)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role in this audit
            <select value={grantForm.roleId} onChange={event => setGrantForm({ ...grantForm, roleId: event.target.value })}>
              <option value="">Select a role</option>
              {roles.map(role => (
                <option key={String(role.id)} value={String(role.id)}>{String(role.name)}</option>
              ))}
            </select>
          </label>
          <label>
            Access
            <select value={grantForm.access} onChange={event => setGrantForm({ ...grantForm, access: event.target.value })}>
              <option value="make_changes">Look and make changes</option>
              <option value="look_only">Look only</option>
            </select>
          </label>
          <button
            className="primary-button"
            disabled={assign.busy || !grantForm.personId || !grantForm.auditId || !grantForm.roleId}
            onClick={() =>
              assign.run(async () => {
                const result = await request("/api/access/grants", {
                  principalId: `person:${grantForm.personId}`,
                  personId: grantForm.personId,
                  auditId: grantForm.auditId,
                  roleIds: [grantForm.roleId],
                  access: grantForm.access,
                });
                snapshot.refresh();
                return result;
              })
            }
          >
            Issue audit access grant
          </button>
        </div>
        <ErrorNotice error={assign.error} />
        {assign.result && <Json value={assign.result} title="Persisted grant" open />}
      </Panel>

      <Panel
        title="Active access assignments"
        subtitle={`${visibleAssignments.length} active grant${visibleAssignments.length === 1 ? "" : "s"}${filterPerson ? " for the selected person" : ""}. Revocation is recorded as an event and takes effect immediately.`}
        actions={<Badge tone="muted">{visibleAssignments.length}</Badge>}
      >
        <div className="assurance-record-list" style={{ maxHeight: 420, overflow: "auto" }}>
          {visibleAssignments.map(grant => (
            <div className="assurance-record-row" key={String(grant.id)}>
              <span>
                <strong>{String(grant.personName ?? grant.principalId)}</strong>
                <small>
                  {String(grant.auditId)} · {(Array.isArray(grant.roleNames) ? grant.roleNames : grant.roleIds ?? []).map(String).join(", ")} · {String(grant.access)}
                </small>
              </span>
              <span style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Badge tone={grant.access === "make_changes" ? "ok" : "muted"}>{String(grant.access)}</Badge>
                <button
                  className="ghost-button"
                  disabled={revoke.busy}
                  onClick={() => {
                    if (!window.confirm(`Revoke ${String(grant.personName ?? grant.principalId)}'s access to ${String(grant.auditId)}?`)) return;
                    void revoke.run(async () => {
                      const result = await request(`/api/access/grants/${encodeURIComponent(String(grant.id))}/revoke`, {
                        reason: "Withdrawn from the role access administration screen.",
                      });
                      snapshot.refresh();
                      return result;
                    });
                  }}
                >
                  Revoke
                </button>
              </span>
            </div>
          ))}
          {!visibleAssignments.length && <Empty>No active assignments match this filter.</Empty>}
        </div>
        <ErrorNotice error={revoke.error} />
        {revoke.result && <Json value={revoke.result} title="Revocation result" />}
      </Panel>
    </div>
  );
}
