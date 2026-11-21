import { appendAssuranceEvent } from "./event-store";
import { getDomainRecord, getStoreDatabase, listDomainRecords, upsertDomainRecord } from "./domain-store";
import { AssuranceAccessError, type AssurancePrincipal } from "./access-control";

/**
 * Role-based access control for the assurance workspace.
 *
 * A role is a named bundle of area permissions persisted in MySQL. Audit access is still
 * granted separately: a grant binds a principal to an audit and names the roles that apply
 * there. This module resolves the two together and answers one question for a route:
 * may this principal perform this action in this area, for this audit?
 */

export type RbacAction = "read" | "write" | "approve" | "execute" | "export" | "verify" | "decide" | "ingest" | "evaluate" | "control" | "configure" | "assign" | "administer";

export type RbacArea = {
  id: string;
  label: string;
  description: string;
  actions: RbacAction[];
};

export const RBAC_AREAS: RbacArea[] = [
  { id: "command_center", label: "Command center", description: "Portfolio health, readiness and alert summaries.", actions: ["read"] },
  { id: "audit", label: "Audit workbench", description: "Audit execution, findings and narratives.", actions: ["read", "write"] },
  { id: "skills", label: "Audit skills", description: "Governed skill library and guided execution.", actions: ["read", "execute"] },
  { id: "governance", label: "Human governance", description: "Human gates, decisions and routed approvals.", actions: ["read", "decide"] },
  { id: "clocks", label: "Case clocks", description: "Part 21 evaluation and notification clocks.", actions: ["read", "write"] },
  { id: "graph", label: "Genealogy graph", description: "Bitemporal graph traversal and export.", actions: ["read", "export"] },
  { id: "controls", label: "Control coverage", description: "Appendix B control mapping and coverage.", actions: ["read"] },
  { id: "kanban", label: "Field Kanban", description: "Field observations, attachments and stage moves.", actions: ["read", "write"] },
  { id: "evidence", label: "Evidence register", description: "Evidence intake, custody and verification.", actions: ["read", "write", "verify"] },
  { id: "documents", label: "Document control", description: "Controlled documents, revisions and retention.", actions: ["read", "write"] },
  { id: "reports", label: "Audit reports", description: "Report drafting, finalization and approval.", actions: ["read", "write", "approve"] },
  { id: "policy", label: "Policy as code", description: "Executable policy rules and evaluation.", actions: ["read", "evaluate"] },
  { id: "regulatory", label: "Regulatory sources", description: "eCFR ingestion, baselines and traceability.", actions: ["read", "ingest"] },
  { id: "agents", label: "Agent operations", description: "Agent runs, observability and control.", actions: ["read", "control"] },
  { id: "data", label: "Data plane and MCP", description: "Connectors, MCP adapters and data operations.", actions: ["read", "administer"] },
  { id: "admin", label: "Administration", description: "Configuration, access and platform administration.", actions: ["read", "configure", "assign"] },
];

export type RbacRole = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  active: boolean;
  system: boolean;
  updatedBy?: string;
  updatedAt?: string;
};

const ALL_PERMISSIONS = RBAC_AREAS.flatMap(area => area.actions.map(action => `${area.id}.${action}`));

const readAll = RBAC_AREAS.map(area => `${area.id}.read`);

const DEFAULT_ROLES: RbacRole[] = [
  {
    id: "administrator",
    name: "Administrator",
    description: "Full platform administration. Reserved for the accountable application owner.",
    permissions: ["*"],
    active: true,
    system: true,
  },
  {
    id: "manager",
    name: "Assurance manager",
    description: "Owns the audit portfolio, approves final reports and decides escalated human gates.",
    permissions: [...readAll, "audit.write", "skills.execute", "governance.decide", "clocks.write", "graph.export", "kanban.write", "evidence.write", "documents.write", "reports.write", "reports.approve", "policy.evaluate", "agents.control"],
    active: true,
    system: true,
  },
  {
    id: "quality",
    name: "Quality / compliance approver",
    description: "Independently verifies evidence and approves reportability and final report decisions.",
    permissions: [...readAll, "governance.decide", "evidence.verify", "reports.approve"],
    active: true,
    system: true,
  },
  {
    id: "auditor",
    name: "Lead auditor",
    description: "Executes audits, records findings, preserves evidence and drafts reports for approval.",
    permissions: [...readAll, "audit.write", "skills.execute", "clocks.write", "graph.export", "kanban.write", "evidence.write", "documents.write", "reports.write"],
    active: true,
    system: true,
  },
  {
    id: "supplier",
    name: "Supplier quality engineer",
    description: "Works supplier notifications and supplier-scoped evidence without approving final reports.",
    permissions: ["command_center.read", "audit.read", "skills.read", "governance.read", "clocks.read", "graph.read", "controls.read", "kanban.read", "kanban.write", "evidence.read", "evidence.write", "documents.read", "documents.write", "reports.read", "policy.read", "regulatory.read", "agents.read", "data.read"],
    active: true,
    system: true,
  },
  {
    id: "engineering",
    name: "Configuration / design engineer",
    description: "Maintains configuration baselines and engineering evidence; cannot approve reports.",
    permissions: ["command_center.read", "audit.read", "audit.write", "skills.read", "governance.read", "clocks.read", "graph.read", "controls.read", "kanban.read", "kanban.write", "evidence.read", "evidence.write", "documents.read", "reports.read", "policy.read", "regulatory.read", "agents.read", "data.read"],
    active: true,
    system: true,
  },
  {
    id: "document_control",
    name: "Document control specialist",
    description: "Controls document revisions, retention and the evidence register.",
    permissions: ["command_center.read", "audit.read", "skills.read", "governance.read", "graph.read", "controls.read", "kanban.read", "kanban.write", "evidence.read", "evidence.write", "evidence.verify", "documents.read", "documents.write", "reports.read", "policy.read", "regulatory.read", "agents.read", "data.read"],
    active: true,
    system: true,
  },
  {
    id: "regulatory",
    name: "Regulatory affairs lead",
    description: "Maintains regulatory sources, baselines and policy evaluation; does not approve audit reports.",
    permissions: ["command_center.read", "audit.read", "skills.read", "governance.read", "clocks.read", "graph.read", "controls.read", "kanban.read", "evidence.read", "documents.read", "reports.read", "policy.read", "policy.evaluate", "regulatory.read", "regulatory.ingest", "agents.read", "data.read"],
    active: true,
    system: true,
  },
  {
    id: "legal",
    name: "Legal counsel",
    description: "Read-only access to audit, regulatory and governance records for legal review.",
    permissions: ["command_center.read", "audit.read", "governance.read", "clocks.read", "graph.read", "controls.read", "evidence.read", "documents.read", "reports.read", "policy.read", "regulatory.read"],
    active: true,
    system: true,
  },
  {
    id: "observer",
    name: "Read-only observer",
    description: "Inspection access across operational areas with no write authority.",
    permissions: [...readAll],
    active: true,
    system: true,
  },
];

export function permissionCatalog() {
  return { areas: RBAC_AREAS, all: ALL_PERMISSIONS };
}

export function isPermission(value: string) {
  return value === "*" || ALL_PERMISSIONS.includes(value);
}

export function assertPermissionList(permissions: string[]) {
  if (!Array.isArray(permissions) || !permissions.length) throw new AssuranceAccessError("At least one area permission is required.", 400);
  const invalid = permissions.filter(permission => !isPermission(permission));
  if (invalid.length) throw new AssuranceAccessError(`Unknown permission: ${invalid.join(", ")}.`, 400);
  return [...new Set(permissions)];
}

async function seedDefaultRoles() {
  const existing = await listDomainRecords<RbacRole>("rbac_role");
  if (existing.length) return existing;
  const seeded: RbacRole[] = [];
  for (const role of DEFAULT_ROLES) {
    const record = { ...role, updatedBy: "system:bootstrap", updatedAt: new Date().toISOString() };
    await upsertDomainRecord({ recordType: "rbac_role", recordId: role.id, payload: record });
    seeded.push(record);
  }
  return seeded;
}

export async function listRbacRoles(includeInactive = false) {
  const roles = await seedDefaultRoles();
  return roles.filter(role => includeInactive || role.active !== false).sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertRbacRole(input: Partial<RbacRole> & { id?: string }, principal: AssurancePrincipal) {
  if (!principal.isAdmin) throw new AssuranceAccessError("You do not have permission to change role definitions at this time. Ask an application administrator to review your access.", 403);
  const roleId = String(input.id ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(roleId)) throw new AssuranceAccessError("Role ID must be a lowercase identifier such as quality_approver.", 400);
  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  if (!name) throw new AssuranceAccessError("A role name is required.", 400);
  const permissions = assertPermissionList((input.permissions ?? []).map(String));
  const existing = await getDomainRecord<RbacRole>("rbac_role", roleId);
  const record: RbacRole = {
    id: roleId,
    name,
    description,
    permissions,
    active: input.active !== false,
    system: existing?.system ?? false,
    updatedBy: principal.actor,
    updatedAt: new Date().toISOString(),
  };
  await upsertDomainRecord({ recordType: "rbac_role", recordId: roleId, payload: record });
  await appendAssuranceEvent({
    type: existing ? "rbac_role_updated" : "rbac_role_created",
    actor: principal.actor,
    entityId: roleId,
    payload: { roleId, name, permissions, previousPermissions: existing?.permissions ?? null, active: record.active },
  });
  return { ok: true, role: record };
}

function rolePermissions(role: RbacRole) {
  return role.permissions.includes("*") ? ["*"] : role.permissions;
}

export async function effectivePermissions(principal: AssurancePrincipal) {
  if (principal.isAdmin) return ["*"];
  const roles = await listRbacRoles();
  const byId = new Map(roles.map(role => [role.id, role]));
  const grants = await listDomainRecords<any>("access_grant");
  const applicable = grants.filter(grant => {
    if (grant.active === false) return false;
    const identityMatch = grant.principalId === principal.id || (principal.personId && grant.personId === principal.personId);
    if (!identityMatch) return false;
    return !grant.auditId || grant.auditId === "*" || (principal.auditIds ?? []).includes(grant.auditId);
  });
  const roleIds = new Set<string>([...(principal.roleIds ?? []), ...applicable.flatMap(grant => grant.roleIds ?? [])]);
  if (principal.id === "read-only-visitor") roleIds.add("observer");
  const permissions = new Set<string>();
  for (const roleId of roleIds) {
    const role = byId.get(roleId);
    if (!role) continue;
    for (const permission of rolePermissions(role)) permissions.add(permission);
  }
  return [...permissions].sort();
}

export function permissionGranted(permissions: string[], area: string, action: RbacAction) {
  return permissions.includes("*") || permissions.includes(`${area}.*`) || permissions.includes(`${area}.${action}`);
}

const ACTION_VERBS: Record<string, string> = {
  read: "view",
  write: "change",
  approve: "approve",
  execute: "run",
  export: "export",
  verify: "verify",
  decide: "decide",
  ingest: "ingest",
  evaluate: "evaluate",
  control: "control",
  configure: "configure",
  assign: "assign access in",
  administer: "administer",
};

export async function requireAreaPermission(principal: AssurancePrincipal, area: string, action: RbacAction) {
  if (principal.isAdmin) return;
  // A look-only session or connector token cannot exercise a write permission even when its
  // role normally carries one. Read is the only action available without make-changes access.
  if (action !== "read" && principal.access !== "make_changes") {
    throw new AssuranceAccessError("You have look-only access at this time, so this change was not saved. Ask an administrator to review your access if you need to make changes.", 403);
  }
  const permissions = await effectivePermissions(principal);
  if (permissionGranted(permissions, area, action)) return;
  const definition = RBAC_AREAS.find(item => item.id === area);
  const label = definition?.label ?? area;
  const verb = ACTION_VERBS[action] ?? action;
  throw new AssuranceAccessError(`You do not have permission to ${verb} ${label} at this time. Ask an administrator to review your role assignment.`, 403);
}

export async function rbacSnapshot(principal: AssurancePrincipal) {
  if (!principal.isAdmin) throw new AssuranceAccessError("You do not have permission to view role administration at this time. Ask an application administrator to review your access.", 403);
  const [roles, people, audits, grants, userRows] = await Promise.all([
    listRbacRoles(true),
    listDomainRecords<any>("person"),
    listDomainRecords<any>("audit"),
    listDomainRecords<any>("access_grant"),
    getStoreDatabase().query("SELECT id, name, role, openId FROM users").then(([rows]: any) => rows),
  ]);
  const roleById = new Map(roles.map(role => [role.id, role]));
  const personById = new Map(people.map(person => [person.id, person]));
  return {
    source: "mysql-database",
    generatedAt: new Date().toISOString(),
    permissionCatalog: permissionCatalog(),
    roles,
    people: people.filter(person => person.active !== false).map(person => ({
      ...person,
      roleName: roleById.get(person.roleId)?.name ?? person.roleId,
      grants: grants.filter(grant => grant.active !== false && (grant.personId === person.id || grant.principalId === `person:${person.id}`)).length,
    })),
    users: (userRows as any[]).map((user: any) => ({ id: user.id, name: user.name, role: user.role, openId: user.openId ? `${String(user.openId).slice(0, 6)}…` : null })),
    audits: audits.map((audit: any) => ({ id: audit.id, title: audit.title, status: audit.status })),
    assignments: grants.filter(grant => grant.active !== false).map(grant => ({
      ...grant,
      personName: grant.personId ? personById.get(grant.personId)?.name ?? grant.personId : grant.principalId,
      roleNames: (grant.roleIds ?? []).map((roleId: string) => roleById.get(roleId)?.name ?? roleId),
    })),
    effective: await effectivePermissions(principal),
  };
}

export async function createNamedPerson(input: any, principal: AssurancePrincipal) {
  if (!principal.isAdmin) throw new AssuranceAccessError("You do not have permission to add directory people at this time. Ask an application administrator to review your access.", 403);
  const name = String(input?.name ?? "").trim();
  const title = String(input?.title ?? "").trim();
  const roleId = String(input?.roleId ?? "").trim();
  const email = String(input?.email ?? "").trim();
  const organization = String(input?.organization ?? "Nextera Nuclear").trim();
  if (!name || !title || !roleId) throw new AssuranceAccessError("name, title and roleId are required.", 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AssuranceAccessError("A valid email address is required for the directory entry.", 400);
  const roles = await listRbacRoles();
  if (!roles.some(role => role.id === roleId)) throw new AssuranceAccessError(`Unknown role ${roleId}. Create the role before assigning it.`, 404);
  const people = await listDomainRecords<any>("person");
  const highest = people.reduce((max, person) => {
    const numeric = Number(String(person.id).replace(/^P-/, ""));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  const personId = `P-${String(highest + 1).padStart(3, "0")}`;
  const person = {
    id: personId,
    name,
    title,
    roleId,
    email,
    organization,
    active: true,
    synthetic: true,
    demonstration: true,
    createdBy: principal.actor,
    createdAt: new Date().toISOString(),
  };
  await upsertDomainRecord({ recordType: "person", recordId: personId, payload: person });
  await appendAssuranceEvent({ type: "person.registered", actor: principal.actor, entityId: personId, payload: { personId, name, title, roleId, email, demonstration: true } });
  return { ok: true, person };
}
