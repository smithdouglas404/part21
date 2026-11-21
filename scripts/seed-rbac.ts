import "dotenv/config";
import { getStoreDatabase, listAudits, listDomainRecords, upsertDomainRecord } from "../server/domain-store";
import { issueAccessGrant, type AssurancePrincipal } from "../server/access-control";
import { listRbacRoles, upsertRbacRole } from "../server/rbac";

/**
 * Idempotent demonstration directory and access seed.
 *
 * The named people are explicitly synthetic. They exist so an auditor can assign work and
 * route approvals to a named role-holder during a demonstration. They are never treated as
 * qualified nuclear reviewers: qualification still requires an actual person and retained
 * qualification evidence.
 */

type SeedPerson = {
  id: string;
  name: string;
  title: string;
  roleId: string;
  email: string;
  organization: string;
};

const people: SeedPerson[] = [
  { id: "P-001", name: "Jordan Lewis", title: "Assurance Supervisor", roleId: "manager", email: "jordan.lewis@example.invalid", organization: "Northstar Nuclear Assurance" },
  { id: "P-002", name: "Morgan Chen", title: "Quality / Compliance Approver", roleId: "quality", email: "morgan.chen@example.invalid", organization: "Northstar Nuclear Assurance" },
  { id: "P-003", name: "Alex Rivera", title: "Lead Auditor", roleId: "auditor", email: "alex.rivera@example.invalid", organization: "Northstar Nuclear Assurance" },
  { id: "P-004", name: "Priya Shah", title: "Supplier Quality Engineer", roleId: "supplier", email: "priya.shah@example.invalid", organization: "Northstar Nuclear Assurance" },
  { id: "P-005", name: "Evan Brooks", title: "Configuration Engineer", roleId: "engineering", email: "evan.brooks@example.invalid", organization: "Northstar Nuclear Assurance" },
  { id: "P-006", name: "Dana Whitfield", title: "Part 21 Program Manager", roleId: "manager", email: "dana.whitfield@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-007", name: "Samuel Okafor", title: "Quality Assurance Manager", roleId: "quality", email: "samuel.okafor@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-008", name: "Elena Vasquez", title: "Senior Auditor", roleId: "auditor", email: "elena.vasquez@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-009", name: "Marcus Bell", title: "Supplier Auditor", roleId: "supplier", email: "marcus.bell@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-010", name: "Hana Ito", title: "Design Control Engineer", roleId: "engineering", email: "hana.ito@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-011", name: "Renee Calloway", title: "Document Control Lead", roleId: "document_control", email: "renee.calloway@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-012", name: "Victor Alvarez", title: "Regulatory Affairs Lead", roleId: "regulatory", email: "victor.alvarez@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-013", name: "Grace Whitmore", title: "Counsel — Regulatory & Compliance", roleId: "legal", email: "grace.whitmore@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-014", name: "Owen Barrett", title: "Independent Observer", roleId: "observer", email: "owen.barrett@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-015", name: "Liam Foster", title: "Receiving Inspection Supervisor", roleId: "receiving_inspection", email: "liam.foster@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-016", name: "Catherine Doyle", title: "VP, Nuclear Assurance", roleId: "executive", email: "catherine.doyle@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
  { id: "P-017", name: "Tessa Morgan", title: "Part 21 Compliance Analyst", roleId: "auditor", email: "tessa.morgan@nextera.example", organization: "Nextera Nuclear — demonstration directory" },
];

const customRoles = [
  {
    id: "receiving_inspection",
    name: "Receiving inspection supervisor",
    description: "Owns receiving records and field evidence for material acceptance; cannot approve a final report.",
    permissions: ["command_center.read", "audit.read", "skills.read", "governance.read", "clocks.read", "graph.read", "controls.read", "kanban.read", "kanban.write", "evidence.read", "evidence.write", "documents.read", "reports.read", "policy.read", "regulatory.read", "agents.read", "data.read"],
    active: true,
  },
  {
    id: "executive",
    name: "Executive sponsor",
    description: "Read-only portfolio and governance visibility for an accountable executive.",
    permissions: ["command_center.read", "audit.read", "skills.read", "governance.read", "clocks.read", "graph.read", "controls.read", "kanban.read", "evidence.read", "documents.read", "reports.read", "policy.read", "regulatory.read", "agents.read", "data.read"],
    active: true,
  },
];

const allAuditIds = ["AUD-027", "AUD-028", "AUD-005", "AUD-017", "AUD-026", "AUD-008", "AUD-011", "AUD-019", "AUD-021", "AUD-014"];

function scopesFor(roleId: string) {
  if (roleId === "supplier") return { auditIds: ["AUD-005", "AUD-021", "AUD-027"], access: "make_changes" as const };
  if (roleId === "engineering") return { auditIds: ["AUD-014", "AUD-026", "AUD-028"], access: "make_changes" as const };
  if (roleId === "document_control") return { auditIds: ["AUD-008", "AUD-011", "AUD-026"], access: "make_changes" as const };
  if (roleId === "regulatory") return { auditIds: ["AUD-005", "AUD-017", "AUD-021"], access: "make_changes" as const };
  if (roleId === "receiving_inspection") return { auditIds: ["AUD-026"], access: "make_changes" as const };
  if (roleId === "legal" || roleId === "observer" || roleId === "executive") return { auditIds: allAuditIds, access: "look_only" as const };
  return { auditIds: allAuditIds, access: "make_changes" as const };
}

async function main() {
  const database = getStoreDatabase();
  await database.query("UPDATE users SET name='Frank' WHERE openId=?", ["hJb4ZHUeEmhQEsRt87jMfS"]);
  const roles = await listRbacRoles();
  const admin: AssurancePrincipal = {
    id: "system:rbac-seed",
    actor: "Frank",
    roleIds: ["administrator"],
    auditIds: [],
    auditWriteIds: [],
    access: "make_changes",
    isAdmin: true,
    qualified: false,
  };
  const roleIds = new Set(roles.map(role => role.id));
  for (const role of customRoles) {
    if (roleIds.has(role.id)) continue;
    await upsertRbacRole(role, admin);
    roleIds.add(role.id);
    console.log(`Created role ${role.id}`);
  }
  console.log(`Roles: ${roleIds.size} (${[...roleIds].join(", ")})`);

  const auditIds: string[] = (await listAudits()).map((audit: any) => String(audit.id));
  const existingAudits = new Set<string>(auditIds);
  const existingPeople = new Map((await listDomainRecords<any>("person")).map(person => [person.id, person]));
  for (const person of people) {
    if (!existingPeople.has(person.id)) {
      await upsertDomainRecord({
        recordType: "person",
        recordId: person.id,
        payload: { ...person, active: true, synthetic: true, demonstration: true, createdBy: "Frank", createdAt: new Date().toISOString() },
      });
      console.log(`Created ${person.id} ${person.name} — ${person.roleId}`);
    }
  }

  admin.auditIds = [...existingAudits];
  admin.auditWriteIds = [...existingAudits];
  const grants = await listDomainRecords<any>("access_grant");
  const existingKeys = new Set(grants.filter(grant => grant.active !== false).map(grant => `${grant.principalId}|${grant.auditId}|${(grant.roleIds ?? []).join(",")}`));
  let created = 0;
  for (const person of people) {
    const scope = scopesFor(person.roleId);
    for (const auditId of scope.auditIds) {
      if (!existingAudits.has(auditId)) continue;
      const principalId = `person:${person.id}`;
      const key = `${principalId}|${auditId}|${person.roleId}`;
      if (existingKeys.has(key)) continue;
      await issueAccessGrant({
        principalId,
        auditId,
        roleIds: [person.roleId],
        access: scope.access,
        personId: person.id,
      }, admin);
      existingKeys.add(key);
      created += 1;
    }
  }
  console.log(`Audit access grants created: ${created}`);
  console.log(`Directory people: ${people.length}`);
  process.exit(0);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
