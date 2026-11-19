/**
 * Regulatory projection into the bitemporal property graph.
 *
 * Provisions become first-class Regulation nodes so a finding can be traversed to the text that
 * governs it, and so the graph can answer "which findings touch 21.21(a)(3)". Nothing is written
 * unless the active ontology admits the Regulation class and a finding-to-regulation relation;
 * an ontology that does not admit the link is a governance gap, not something to work around.
 */
import crypto from "node:crypto";
import { validateOntologyEdge, validateOntologyNode, type ControlledOntology } from "./ontology-store";
import type { RegulatoryProvision, RegulatorySnapshot } from "../shared/regulatory";
import type { CitationResolution } from "./citation-resolver";

type SqlRunner = { execute: (sql: string, values?: any[]) => Promise<any> };

export const REGULATION_NODE_PREFIX = "regulation:";
export const REGULATORY_RELATION_CANDIDATES = ["cites", "governedBy", "regulatedBy"] as const;

export type RegulatoryGraphStatus = {
  ontologyConfigId: string;
  ontologyVersion: string;
  regulationClass: boolean;
  citationRelation: string | null;
  canProject: boolean;
  reason?: string;
};

function provisionCitation(provision: RegulatoryProvision): string {
  const heading = String(provision.heading ?? "");
  const id = String((provision as any).provisionId ?? provision.id ?? "");
  const criterion = id.match(/:([IVX]+)$/)?.[1];
  if (String((provision as any).kind ?? "") === "criterion" && criterion) {
    return `10 CFR 50 Appendix B Criterion ${criterion}`;
  }
  const section = id.match(/(21\.\d+)(?::([a-z0-9]+))?/i);
  if (section) return `10 CFR ${section[1]}${section[2] ? `(${section[2]})` : ""}`;
  return heading.slice(0, 120) || id;
}

export function regulatoryGraphStatus(ontology: ControlledOntology): RegulatoryGraphStatus {
  const classes = (ontology.payload.classes ?? []).map(item => item.id.toLowerCase());
  const relation = (ontology.payload.relations ?? []).find(item =>
    item.from.toLowerCase() === "finding" &&
    item.to.toLowerCase() === "regulation" &&
    REGULATORY_RELATION_CANDIDATES.includes(item.id as any));
  const regulationClass = classes.includes("regulation");
  return {
    ontologyConfigId: ontology.configId,
    ontologyVersion: ontology.version,
    regulationClass,
    citationRelation: relation?.id ?? null,
    canProject: regulationClass && Boolean(relation),
    reason: !regulationClass
      ? "The active ontology does not declare a Regulation class."
      : !relation
        ? "The active ontology declares Regulation but no Finding→Regulation relation; a governed ontology revision is required before citations can be projected."
        : undefined,
  };
}

export function assertRegulatoryProjectionAllowed(ontology: ControlledOntology): RegulatoryGraphStatus {
  const status = regulatoryGraphStatus(ontology);
  if (!status.canProject) throw new Error(`Regulatory graph projection blocked: ${status.reason}`);
  return status;
}

export function regulationNodeId(snapshotId: string, provisionId: string) {
  return `${REGULATION_NODE_PREFIX}${snapshotId}:${provisionId}`;
}

/** Insert Regulation nodes for every provision in a snapshot. Idempotent. */
export async function projectRegulatoryProvisions(db: SqlRunner, snapshot: RegulatorySnapshot, ontology: ControlledOntology) {
  const status = assertRegulatoryProjectionAllowed(ontology);
  let written = 0;
  for (const provision of snapshot.provisions ?? []) {
    const provisionId = String((provision as any).provisionId ?? provision.id ?? "");
    if (!provisionId) continue;
    const citation = provisionCitation(provision);
    const text = String(provision.text ?? "");
    const payload = {
      sourceRecordType: "regulation",
      sourceRecordId: provisionId,
      citation,
      heading: String(provision.heading ?? ""),
      kind: String((provision as any).kind ?? ""),
      snapshotId: snapshot.id,
      sourceId: snapshot.sourceId,
      sourceAsOf: snapshot.sourceAsOf,
      legalStatus: snapshot.legalStatus,
      textSha256: crypto.createHash("sha256").update(text).digest("hex"),
      validFrom: `${snapshot.sourceAsOf}T00:00:00.000Z`,
      text: text.length > 2000 ? `${text.slice(0, 2000)}…` : text,
    };
    const node = { id: regulationNodeId(snapshot.id, provisionId), type: "Regulation", payload };
    validateOntologyNode(ontology, node as any);
    await db.execute(
      "INSERT INTO part21_graph_nodes (id,node_type,label,subtitle,status,payload,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE node_type=VALUES(node_type),label=VALUES(label),subtitle=VALUES(subtitle),payload=VALUES(payload),updated_at=VALUES(updated_at)",
      [node.id, "Regulation", citation, snapshot.sourceAsOf, "ingested", JSON.stringify(payload), new Date()],
    );
    written += 1;
  }
  return { snapshotId: snapshot.id, sourceId: snapshot.sourceId, nodesWritten: written, relation: status.citationRelation };
}

/** Link a finding to the provisions its citations resolve to. Idempotent per finding+provision. */
export async function linkFindingCitations(
  db: SqlRunner,
  input: { auditId: string; findingId: string; resolutions: CitationResolution[]; ontology: ControlledOntology; recordedBy: string; validFrom?: string },
) {
  const status = assertRegulatoryProjectionAllowed(input.ontology);
  const validFrom = input.validFrom ?? new Date().toISOString();
  let edges = 0;
  const skipped: string[] = [];
  for (const resolution of input.resolutions) {
    if (resolution.status !== "resolved" || !resolution.provisionId || !resolution.snapshotId) {
      skipped.push(`${resolution.reference} (${resolution.status})`);
      continue;
    }
    const edge = {
      id: `${status.citationRelation}:${input.findingId}:${resolution.provisionId}`,
      from: input.findingId,
      to: regulationNodeId(resolution.snapshotId, resolution.provisionId),
      relation: status.citationRelation as string,
    };
    // An edge is only meaningful when both endpoints exist in the graph. The finding must be a
    // real projected node; the regulation node is created by the provision projection.
    const [findingRows] = await db.execute("SELECT node_type FROM part21_graph_nodes WHERE id=? LIMIT 1", [input.findingId]);
    const findingType = (findingRows as any[])[0]?.node_type;
    if (!findingType) { skipped.push(`${resolution.reference} (finding ${input.findingId} is not projected in the graph)`); continue; }
    const endpoints = new Map<string, any>([
      [input.findingId, { id: input.findingId, type: String(findingType), payload: {} }],
      [edge.to, { id: edge.to, type: "Regulation", payload: {} }],
    ]);
    validateOntologyEdge(input.ontology, edge as any, endpoints);
    const payload = {
      sourceAuditId: input.auditId,
      sourceRecordType: "finding",
      sourceRecordId: input.findingId,
      citation: resolution.reference,
      provisionId: resolution.provisionId,
      snapshotId: resolution.snapshotId,
      sourceAsOf: resolution.sourceAsOf,
      validFrom,
      recordedBy: input.recordedBy,
    };
    await db.execute(
      "INSERT INTO part21_graph_edges (id,from_id,to_id,relation,label,payload,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE from_id=VALUES(from_id),to_id=VALUES(to_id),relation=VALUES(relation),payload=VALUES(payload),updated_at=VALUES(updated_at)",
      [edge.id, edge.from, edge.to, edge.relation, resolution.reference, JSON.stringify(payload), new Date()],
    );
    edges += 1;
  }
  return { findingId: input.findingId, edgesWritten: edges, skipped };
}

/** Which findings cite a provision, by citation string or provision id. */
export async function findingsCiting(db: SqlRunner, input: { citation: string; auditId?: string }) {
  const [rows] = await db.execute(
    `SELECT e.from_id AS findingId, e.payload AS edgePayload, n.id AS regulationId, n.label AS citation, n.payload AS regulationPayload
       FROM part21_graph_edges e JOIN part21_graph_nodes n ON n.id = e.to_id
      WHERE n.node_type='Regulation' AND (n.label = ? OR n.id LIKE ?)`,
    [input.citation, `%${input.citation}%`],
  );
  const findings = (rows as any[])
    .map(row => {
      const edge = typeof row.edgePayload === "string" ? JSON.parse(row.edgePayload) : row.edgePayload;
      return { findingId: row.findingId, auditId: edge?.sourceAuditId ?? null, citation: row.citation, regulationId: row.regulationId };
    })
    .filter(row => !input.auditId || row.auditId === input.auditId);
  return { citation: input.citation, count: findings.length, findings };
}
