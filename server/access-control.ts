import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { sdk } from "./_core/sdk";
import { getDomainRecord, listDomainRecords, upsertDomainRecord } from "./domain-store";
import { appendAssuranceEvent } from "./event-store";

export type AssurancePrincipal = {
  id: string;
  actor: string;
  roleIds: string[];
  auditIds: string[];
  auditWriteIds?: string[];
  qualifiedAuditIds?: string[];
  access: "look_only" | "make_changes";
  isAdmin: boolean;
  personId?: string;
  qualified: boolean;
  qualificationEvidenceId?: string;
};
export type AuditAccessGrant = {
  id: string; principalId: string; auditId: string; roleIds: string[];
  access: "look_only" | "make_changes"; active: boolean;
  personId?: string; qualificationEvidenceId?: string; qualifiedUntil?: string;
  issuedBy: string; issuedAt: string;
};
export class AssuranceAccessError extends Error {
  constructor(message: string, public status = 403) { super(message); this.name = "AssuranceAccessError"; }
}
const context = new AsyncLocalStorage<AssurancePrincipal>();
export function runAsPrincipal<T>(principal: AssurancePrincipal, fn: () => T): T { return context.run(principal, fn); }
export function currentPrincipal(): AssurancePrincipal { const value = context.getStore(); if (!value) throw new AssuranceAccessError("Authenticated assurance principal is required.", 401); return value; }
export function requestPrincipal(req: Request): AssurancePrincipal {
  const value = (req as Request & { assurancePrincipal?: AssurancePrincipal }).assurancePrincipal;
  if (!value) throw new AssuranceAccessError("Authenticated assurance principal is required.", 401);
  return value;
}
export function requireAdministrator(principal: AssurancePrincipal) {
  if (!principal.isAdmin) throw new AssuranceAccessError("Application administrator permission is required. A selected persona is not an authorization grant.");
}
export function assertAuditPermission(principal: AssurancePrincipal, auditId: string, write = false) {
  if (!auditId.trim()) throw new AssuranceAccessError("An explicit auditId is required.", 400);
  if (!principal.isAdmin && !principal.auditIds.includes(auditId)) throw new AssuranceAccessError("Record is not available within this principal's audit scope.", 404);
  if (write && principal.access !== "make_changes") throw new AssuranceAccessError("This principal has look-only access; persisted dialogue, attachments and stage moves are write operations.");
  if (write && !principal.isAdmin && !(principal.auditWriteIds ?? []).includes(auditId)) throw new AssuranceAccessError("This principal does not have a make-changes grant for the selected audit.");
}
export function requireQualifiedReviewer(principal: AssurancePrincipal, auditId: string) {
  assertAuditPermission(principal, auditId, true);
  if (!(principal.qualifiedAuditIds ?? []).includes(auditId)) throw new AssuranceAccessError("The reviewer qualification does not cover this audit.");
  if (!principal.qualified || !principal.qualificationEvidenceId || !principal.personId) throw new AssuranceAccessError("A current database qualification, evidence reference and named reviewer identity are required. Administrator or persona selection alone cannot approve a nuclear decision.");
}
async function applyGrants(base: AssurancePrincipal): Promise<AssurancePrincipal> {
  const grants = (await listDomainRecords<AuditAccessGrant>("access_grant")).filter(g => g.active && g.principalId === base.id);
  const qualified = grants.filter(g => g.personId && g.qualificationEvidenceId && g.qualifiedUntil && Date.parse(g.qualifiedUntil) > Date.now());
  const personIds = [...new Set(qualified.map(g => g.personId))];
  return {
    ...base,
    auditIds: [...new Set([...base.auditIds, ...grants.map(g => g.auditId)])],
    roleIds: [...new Set([...base.roleIds, ...grants.flatMap(g => g.roleIds)])],
    auditWriteIds: base.access === "make_changes" ? [...new Set([...base.auditIds, ...grants.filter(g => g.access === "make_changes").map(g => g.auditId)])] : [],
    qualifiedAuditIds: qualified.map(g => g.auditId),
    // A read-only bearer token can never be upgraded by a database role grant.
    access: base.access,
    personId: personIds.length === 1 ? personIds[0] : undefined,
    qualified: qualified.length > 0 && personIds.length === 1,
    qualificationEvidenceId: qualified.length > 0 && personIds.length === 1 ? qualified[0].qualificationEvidenceId : undefined,
  };
}
export async function resolveRequestPrincipal(req: Request): Promise<AssurancePrincipal> {
  const cached = (req as Request & { assurancePrincipal?: AssurancePrincipal }).assurancePrincipal;
  if (cached) return cached;
  const authorization = String(req.headers.authorization ?? "");
  const rawBearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (req.headers.cookie || rawBearer.split(".").length === 3) {
    try {
      const user = await sdk.authenticateRequest(req);
      if (user.isCron) throw new AssuranceAccessError("Scheduled identities require a scoped scheduled-work authorization contract.");
      return applyGrants({ id: user.openId, actor: user.name || user.openId, roleIds: [user.role], auditIds: [], access: "make_changes", isAdmin: user.role === "admin", qualified: false });
    } catch (error) {
      if (!rawBearer) throw new AssuranceAccessError("Sign in with the existing application login.", 401);
    }
  }
  if (rawBearer) {
    const { authenticateConnectRequest } = await import("./connect-api");
    const auth = await authenticateConnectRequest(req);
    if (!auth.ok) throw new AssuranceAccessError(auth.error, auth.status);
    const token = auth.token;
    if (!token.actor || !token.role) throw new AssuranceAccessError("Connector introspection did not identify the acting person and permission.", 401);
    const principalId = `connector:${crypto.createHash("sha256").update(token.tokenHash).digest("hex")}`;
    return applyGrants({ id: principalId, actor: token.actor, roleIds: [token.role], auditIds: token.auditId ? [token.auditId] : [], access: token.access, isAdmin: false, qualified: false });
  }
  throw new AssuranceAccessError("An authenticated application session or bearer connector is required.", 401);
}
export async function authenticateApiRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const principal = await resolveRequestPrincipal(req);
    (req as Request & { assurancePrincipal?: AssurancePrincipal }).assurancePrincipal = principal;
    runAsPrincipal(principal, () => next());
  } catch (error) { const status = error instanceof AssuranceAccessError ? error.status : 503; res.status(status).json({ ok: false, error: error instanceof Error ? error.message : "Authorization unavailable", authenticated: false }); }
}
export async function listAccessGrants(principal: AssurancePrincipal) {
  requireAdministrator(principal);
  return { grants: await listDomainRecords<AuditAccessGrant>("access_grant"), source: "mysql-database" };
}
export async function issueAccessGrant(input: Omit<AuditAccessGrant, "id" | "issuedBy" | "issuedAt" | "active">, principal: AssurancePrincipal) {
  requireAdministrator(principal);
  if (!input.principalId?.trim() || !input.auditId?.trim() || !Array.isArray(input.roleIds) || !input.roleIds.length) throw new AssuranceAccessError("principalId, auditId and at least one role are required.", 400);
  const audits = await listDomainRecords<any>("audit");
  if (!audits.some(a => a.id === input.auditId)) throw new AssuranceAccessError("Audit does not exist.", 404);
  if (input.personId) {
    const person = await getDomainRecord<any>("person", input.personId);
    if (!person?.active) throw new AssuranceAccessError("The named person is not active in the database directory.");
    if (person.principalId && person.principalId !== input.principalId) throw new AssuranceAccessError("The selected directory person is bound to another authenticated identity.");
    if (person.synthetic && input.qualificationEvidenceId) throw new AssuranceAccessError("A synthetic directory person cannot establish a qualified nuclear reviewer. Register the actual person and qualification evidence.");
  }
  if (input.qualificationEvidenceId) {
    if (!input.personId || !input.qualifiedUntil || !Number.isFinite(Date.parse(input.qualifiedUntil)) || Date.parse(input.qualifiedUntil) <= Date.now()) throw new AssuranceAccessError("Qualification requires a named actual person and a future expiry.", 400);
    const evidence = await getDomainRecord<any>("evidence", input.qualificationEvidenceId);
    const asset = evidence ? null : await getDomainRecord<any>("attachment", input.qualificationEvidenceId);
    if (!evidence && !asset) throw new AssuranceAccessError("Qualification evidence must reference an existing retained record.", 404);
  }
  const grant: AuditAccessGrant = { ...input, id: `GRANT-${crypto.randomUUID()}`, active: true, issuedBy: principal.id, issuedAt: new Date().toISOString() };
  await upsertDomainRecord({ recordType: "access_grant", recordId: grant.id, auditId: input.auditId, payload: grant });
  await appendAssuranceEvent({ type: "audit_access_grant_issued", actor: principal.actor, auditId: input.auditId, entityId: grant.id, payload: { principalId: input.principalId, roleIds: input.roleIds, access: input.access, qualificationEvidenceId: input.qualificationEvidenceId ?? null, qualifiedUntil: input.qualifiedUntil ?? null } });
  return { ok: true, grant };
}
export async function assertQualificationForAudit(principal: AssurancePrincipal, auditId: string) {
  requireQualifiedReviewer(principal, auditId);
  const grants = await listDomainRecords<AuditAccessGrant>("access_grant", auditId);
  if (!grants.some(g => g.active && g.principalId === principal.id && g.personId === principal.personId && g.qualificationEvidenceId && g.qualifiedUntil && Date.parse(g.qualifiedUntil) > Date.now())) throw new AssuranceAccessError("No current reviewer qualification applies to this audit.");
}
