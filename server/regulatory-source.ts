import { createHash, randomUUID } from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { appendixBCriteriaInventory, part21SectionInventory } from "../shared/regulatory";
import type { OriginalKind, RegulatoryProvision, RegulatorySnapshot, RegulationSet, SourceOriginal } from "../shared/regulatory";

export const ECFR_API_ORIGIN = "https://www.ecfr.gov";
export const REGULATORY_PARSER_VERSION = "ecfr-conservative-paragraphs-v1";
export interface RawSourceResponse {
  kind: OriginalKind; requestedUri: string; finalUri: string; contentType: string;
  bytes: Buffer; retrievedAt: string;
}
export interface RegulatorySnapshotStore {
  insert(snapshot: RegulatorySnapshot, originals: RawSourceResponse[]): Promise<void>;
  get(id: string): Promise<RegulatorySnapshot | null>;
  list(sourceId?: string): Promise<RegulatorySnapshot[]>;
  getOriginal(id: string): Promise<Buffer>;
}
export interface SourceIngestDependencies {
  store: RegulatorySnapshotStore;
  fetch: typeof fetch;
  now: () => string;
  newId: () => string;
}
export interface EcfrIngestInput { sourceId: string; regulationSet: RegulationSet; sourceAsOf: string }
export function sha256(bytes: Buffer | string) { return createHash("sha256").update(bytes).digest("hex"); }
export function stableSourceJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSourceJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSourceJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function assertIsoDate(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new Error(`${name} must be a valid ISO date`);
  return value;
}
export function assertInstant(value: string, name: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${name} must include a valid timezone-qualified instant`);
  return new Date(value).toISOString();
}
export function ecfrRequestUris(input: EcfrIngestInput) {
  assertIsoDate(input.sourceAsOf, "sourceAsOf");
  if (!input.sourceId?.trim()) throw new Error("Configured sourceId is required");
  if (!["10-cfr-part-21", "10-cfr-part-50-appendix-b"].includes(input.regulationSet)) throw new Error("Unsupported regulationSet");
  const full = new URL(`/api/versioner/v1/full/${input.sourceAsOf}/title-10.xml`, ECFR_API_ORIGIN);
  full.searchParams.set("part", input.regulationSet === "10-cfr-part-21" ? "21" : "50");
  if (input.regulationSet === "10-cfr-part-50-appendix-b") full.searchParams.set("appendix", "Appendix B to Part 50");
  return { metadata: `${ECFR_API_ORIGIN}/api/versioner/v1/titles.json`, hierarchy: `${ECFR_API_ORIGIN}/api/versioner/v1/structure/${input.sourceAsOf}/title-10.json`, "full-xml": full.href };
}
function sameUri(a: string, b: string) {
  const left = new URL(a), right = new URL(b);
  left.searchParams.sort(); right.searchParams.sort();
  return left.href === right.href;
}
function validateResponse(raw: RawSourceResponse, expectedUri: string) {
  if (!sameUri(raw.requestedUri, expectedUri) || !sameUri(raw.finalUri, expectedUri)) throw new Error(`Unexpected source/final URI for ${raw.kind}; redirects/access verification are not regulatory content`);
  if (!raw.bytes.length || raw.bytes.length > 30 * 1024 * 1024) throw new Error("Source bytes absent or exceed 30 MiB limit");
  assertInstant(raw.retrievedAt, "retrievedAt");
  const mime = raw.contentType.split(";")[0].trim().toLowerCase();
  const valid = raw.kind === "metadata" || raw.kind === "hierarchy" ? mime === "application/json" : raw.kind === "guidance-pdf" ? mime === "application/pdf" : ["application/xml", "text/xml"].includes(mime);
  if (!valid) throw new Error(`Invalid ${raw.kind} content type: ${raw.contentType}`);
  if (raw.kind === "guidance-pdf" && raw.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("NRC source is not PDF bytes");
}
type XmlNode = { [name: string]: unknown; ":@"?: Record<string, string> };
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false, processEntities: true });
function children(node: XmlNode): XmlNode[] {
  const key = Object.keys(node).find(k => k !== ":@");
  const value = key ? node[key] : undefined;
  return Array.isArray(value) ? value as XmlNode[] : [];
}
function tag(node: XmlNode) { return Object.keys(node).find(k => k !== ":@") ?? ""; }
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", mdash: "\u2014", ndash: "\u2013", sect: "\u00a7" });
/** The XML parser leaves some entities in text nodes; decode deterministically so legal text is stored as published. */
export function decodeSourceEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match);
}
function text(node: XmlNode): string {
  if (tag(node) === "#text") return decodeSourceEntities(String(node["#text"] ?? ""));
  return children(node).map(text).join("");
}
function normalizedText(node: XmlNode) { return text(node).replace(/\s+/g, " ").trim(); }
function descendants(nodes: XmlNode[], predicate: (node: XmlNode) => boolean): XmlNode[] {
  return nodes.flatMap(node => [...(predicate(node) ? [node] : []), ...descendants(children(node), predicate)]);
}
function xmlDecode(raw: Buffer) {
  const declaration = raw.subarray(0, 200).toString("ascii");
  const encoding = declaration.match(/encoding=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "utf-8";
  if (!["utf-8", "utf8", "iso-8859-1", "windows-1252", "us-ascii"].includes(encoding)) throw new Error(`Unsupported declared XML encoding: ${encoding}`);
  return new TextDecoder(encoding, { fatal: true }).decode(raw);
}
interface HierarchyNode { identifier: string; label: string; type: string; children?: HierarchyNode[]; received_on?: string; reserved?: boolean }
function parseHierarchy(raw: RawSourceResponse, set: RegulationSet) {
  const root = JSON.parse(raw.bytes.toString("utf8")) as HierarchyNode;
  if (root.type !== "title" || root.identifier !== "10" || !Array.isArray(root.children)) throw new Error("Unexpected Title 10 hierarchy schema");
  function find(node: HierarchyNode, type: string, id: string): HierarchyNode[] {
    return [...(node.type === type && node.identifier === id ? [node] : []), ...(node.children ?? []).flatMap(c => find(c, type, id))];
  }
  const chapters = find(root, "chapter", "I");
  if (chapters.length !== 1) throw new Error("NRC chapter hierarchy absent/ambiguous");
  const parts = find(chapters[0], "part", set === "10-cfr-part-21" ? "21" : "50");
  if (parts.length !== 1) throw new Error("Requested part hierarchy absent/ambiguous");
  if (set === "10-cfr-part-50-appendix-b") {
    const appendices = find(parts[0], "appendix", "Appendix B to Part 50");
    if (appendices.length !== 1) throw new Error("Appendix B hierarchy absent/ambiguous");
    return { root, selected: appendices[0], sections: [] as HierarchyNode[] };
  }
  const collect = (n: HierarchyNode): HierarchyNode[] => [...(n.type === "section" ? [n] : []), ...(n.children ?? []).flatMap(collect)];
  return { root, selected: parts[0], sections: collect(parts[0]) };
}
const lowerRoman = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"];
function numberingDepth(token: string, path: string[]): number | null {
  if (/^[a-z]$/.test(token)) {
    // A roman marker below a numerical paragraph is subordinate; otherwise alphabetic.
    const nextTop = path[0] ? String.fromCharCode(path[0].charCodeAt(0) + 1) : "a";
    if (token !== nextTop && lowerRoman.includes(token) && path.length >= 2 && /^\d+$/.test(path[1])) return 2;
    return 0;
  }
  if (/^\d+$/.test(token)) return path.length >= 4 && /^[A-Z]$/.test(path[3]) ? 4 : 1;
  if (lowerRoman.includes(token)) return 2;
  if (/^[A-Z]$/.test(token)) return 3;
  return null;
}
/** Reconstruct ONLY supported, sequentially validated leading paragraph labels.
 * Ambiguous definition/continuation paragraphs retain local locators and no invented legal anchor.
 */
function paragraphProvisions(nodes: XmlNode[], parentId: string, citation: string, snapshotId: string, originalId: string): RegulatoryProvision[] {
  const result: RegulatoryProvision[] = [];
  let path: string[] = [];
  const lastAtParent = new Map<string, string>();
  let definitionContext = false;
  nodes.forEach((node, ordinal) => {
    const value = normalizedText(node);
    if (!value) return;
    const leading = value.match(/^(\([a-zA-Z0-9]+\))+/)?.[0];
    if (!leading && tag(children(node)[0] ?? {}) === "I" && /\bmeans\b|^.*\. \(/.test(value)) { definitionContext = true; path = []; }
    let valid = !!leading && !definitionContext;
    const tokens = [...(leading ?? "").matchAll(/\(([a-zA-Z0-9]+)\)/g)].map(m => m[1]);
    let next = [...path];
    for (const token of tokens) {
      const depth = numberingDepth(token, next);
      if (depth === null || (depth > 0 && next.length < depth)) { valid = false; break; }
      next = [...next.slice(0, depth), token];
      const key = next.slice(0, -1).join("/");
      const previous = lastAtParent.get(key);
      const series = depth === 0 ? [..."abcdefghijklmnopqrstuvwxyz"] : depth === 1 || depth === 4 ? null : depth === 2 ? lowerRoman : [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
      const sequenceValid = series ? (!previous ? series.indexOf(token) === 0 : series.indexOf(token) === series.indexOf(previous) + 1 || token === previous) : (!previous ? token === "1" : Number(token) === Number(previous) + 1 || token === previous);
      if (!sequenceValid) valid = false;
    }
    if (valid) {
      path = next;
      for (let depth = 0; depth < path.length; depth++) lastAtParent.set(path.slice(0, depth).join("/"), path[depth]);
      const anchor = path.map(t => `(${t})`).join("");
      const id = `${parentId}${anchor}`;
      if (result.some(p => p.id === id)) valid = false;
      else {
        // Link only to a parent paragraph actually present in the source; never invent an empty provision.
        let effectiveParent = parentId;
        for (let depth = path.length - 1; depth >= 1; depth--) {
          const prefix = path.slice(0, depth).map(t => `(${t})`).join("");
          if (result.some(p => p.id === `${parentId}${prefix}`)) { effectiveParent = `${parentId}${prefix}`; break; }
        }
        result.push({ id, snapshotId, parentId: effectiveParent, kind: "paragraph", citation: `${citation}${anchor}`, heading: anchor, text: value, originalId, xmlLocator: `${parentId}/P[${ordinal + 1}]`, anchorStatus: "validated-numbering", paragraphLabel: anchor });
      }
    }
    if (!valid) result.push({ id: `${snapshotId}:${parentId}:unresolved:${ordinal + 1}`, snapshotId, parentId, kind: "paragraph", citation, heading: "Unnumbered or unresolved paragraph; parent citation only", text: value, originalId, xmlLocator: `${parentId}/P[${ordinal + 1}]`, anchorStatus: "unresolved" });
  });
  return result;
}
export function parseEcfrProvisions(raw: Buffer, hierarchyRaw: RawSourceResponse, set: RegulationSet, snapshotId: string, originalId: string): RegulatoryProvision[] {
  const xml = xmlDecode(raw);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("DTD/entities forbidden in eCFR source");
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid eCFR XML");
  const nodes = parser.parse(xml) as XmlNode[];
  const hierarchy = parseHierarchy(hierarchyRaw, set);
  const rootKind = set === "10-cfr-part-21" ? "PART" : "APPENDIX";
  const rootN = set === "10-cfr-part-21" ? "21" : "Appendix B to Part 50";
  const roots = descendants(nodes, n => n[":@"]?.["@_TYPE"] === rootKind && n[":@"]?.["@_N"] === rootN);
  if (roots.length !== 1) throw new Error("Requested full XML root is absent or ambiguous");
  const root = roots[0];
  const rootId = set === "10-cfr-part-21" ? "10-cfr:part-21" : "10-cfr:part-50:appendix-b";
  const baseCitation = set === "10-cfr-part-21" ? "10 CFR Part 21" : "10 CFR Part 50 Appendix B";
  const rootProvision: RegulatoryProvision = { id: rootId, snapshotId, parentId: null, kind: set === "10-cfr-part-21" ? "part" : "appendix", citation: baseCitation, heading: normalizedText(children(root).find(n => tag(n) === "HEAD") ?? {}), text: normalizedText(root), originalId, xmlLocator: `${tag(root)}[@N='${rootN}']`, anchorStatus: "structural" };
  if (!rootProvision.heading) throw new Error("Source root heading absent");
  if (set === "10-cfr-part-21") {
    const sections = descendants(children(root), n => n[":@"]?.["@_TYPE"] === "SECTION");
    const xmlIds = sections.map(n => n[":@"]?.["@_N"] ?? "");
    if (new Set(xmlIds).size !== xmlIds.length || hierarchy.sections.some(s => !xmlIds.includes(s.identifier)) || xmlIds.some(id => !hierarchy.sections.some(s => s.identifier === id))) throw new Error("Full XML/metadata hierarchy section mismatch");
    if (part21SectionInventory.some(([id]) => !xmlIds.includes(id))) throw new Error("Part21 full XML is missing an inventory section; baseline ingestion rejected");
    return [rootProvision, ...sections.flatMap(section => {
      const sectionId = section[":@"]!["@_N"].replace(/^§\s*/, "");
      if (!/^21\.\d+$/.test(sectionId)) throw new Error("Invalid Part21 section identifier");
      const id = `10-cfr:${sectionId}`;
      const heading = normalizedText(children(section).find(n => tag(n) === "HEAD") ?? {});
      const paragraphNodes = children(section).filter(n => /^(P|P-\d+|PSPACE|FP)$/.test(tag(n)));
      const provision: RegulatoryProvision = { id, snapshotId, parentId: rootId, kind: "section", citation: `10 CFR ${sectionId}`, heading, text: paragraphNodes.map(normalizedText).join("\n"), originalId, xmlLocator: `${tag(section)}[@N='${sectionId}']`, anchorStatus: "structural" };
      return [provision, ...paragraphProvisions(paragraphNodes, id, provision.citation, snapshotId, originalId)];
    })];
  }
  const all = children(root);
  const headingPositions = all.map((n, i) => ({ n, i })).filter(({ n }) => /^HD\d*$/.test(tag(n)) && /^[IVX]+\.\s+/.test(normalizedText(n)));
  const expected = appendixBCriteriaInventory.map(([id]) => id);
  if (headingPositions.map(({ n }) => normalizedText(n).split(".")[0]).join("|") !== expected.join("|")) throw new Error("AppendixB XML must contain all 18 criteria exactly once in source order");
  const criteria = headingPositions.flatMap(({ n, i }, index) => {
    const numeral = normalizedText(n).split(".")[0];
    const id = `${rootId}:${numeral}`;
    const pNodes = all.slice(i + 1, headingPositions[index + 1]?.i ?? all.length).filter(p => /^(P|P-\d+|PSPACE|FP)$/.test(tag(p)));
    const criterion: RegulatoryProvision = { id, snapshotId, parentId: rootId, kind: "criterion", citation: `${baseCitation}, Criterion ${numeral}`, heading: normalizedText(n), text: pNodes.map(normalizedText).join("\n"), originalId, xmlLocator: `${tag(n)}[${index + 1}]`, anchorStatus: "structural" };
    return [criterion, ...paragraphProvisions(pNodes, id, criterion.citation, snapshotId, originalId)];
  });
  const introduction = all.slice(0, headingPositions[0].i).filter(p => tag(p) === "P");
  return [rootProvision, ...paragraphProvisions(introduction, rootId, baseCitation, snapshotId, originalId), ...criteria];
}
function originalManifest(raw: RawSourceResponse, id: string): SourceOriginal {
  return { id, kind: raw.kind, requestedUri: raw.requestedUri, finalUri: raw.finalUri, contentType: raw.contentType, sha256: sha256(raw.bytes), sizeBytes: raw.bytes.length, retrievedAt: assertInstant(raw.retrievedAt, "retrievedAt"), storage: { provider: "mysql-original-source-bytes", objectId: id, versionId: id, integrityVerified: true } };
}
export async function registerRegulatorySnapshot(input: EcfrIngestInput & { originals: RawSourceResponse[] }, deps: SourceIngestDependencies = defaultSourceDependencies()) {
  const uris = ecfrRequestUris(input);
  if (input.originals.length !== 3 || new Set(input.originals.map(r => r.kind)).size !== 3) throw new Error("Exactly one metadata, hierarchy and full-xml original required");
  const get = (kind: keyof typeof uris) => { const raw = input.originals.find(r => r.kind === kind); if (!raw) throw new Error(`Missing ${kind}`); validateResponse(raw, uris[kind]); return raw; };
  const metadataRaw = get("metadata"), hierarchyRaw = get("hierarchy"), xmlRaw = get("full-xml");
  const metadata = JSON.parse(metadataRaw.bytes.toString("utf8"));
  const titles = Array.isArray(metadata.titles) ? metadata.titles.filter((t: { number: number }) => t.number === 10) : [];
  if (titles.length !== 1 || typeof metadata.meta?.import_in_progress !== "boolean") throw new Error("Title 10 metadata schema absent or ambiguous");
  const title = titles[0];
  const upToDate = assertIsoDate(title.up_to_date_as_of, "provider up_to_date_as_of");
  if (input.sourceAsOf > upToDate) throw new Error("Requested sourceAsOf is later than provider-reported currency");
  const amended = title.latest_amended_on === null ? null : assertIsoDate(title.latest_amended_on, "latest_amended_on");
  const issued = title.latest_issue_date === null ? null : assertIsoDate(title.latest_issue_date, "latest_issue_date");
  const id = deps.newId();
  const originals = input.originals.map(raw => originalManifest(raw, deps.newId()));
  const xmlOriginal = originals.find(o => o.kind === "full-xml")!;
  const provisions = parseEcfrProvisions(xmlRaw.bytes, hierarchyRaw, input.regulationSet, id, xmlOriginal.id);
  const unresolved = provisions.filter(p => p.anchorStatus === "unresolved").length;
  const snapshot: RegulatorySnapshot = { id, sourceId: input.sourceId, sourceKind: "ecfr-regulation", regulationSet: input.regulationSet, sourceAsOf: input.sourceAsOf,
    latestAmendedOn: amended, latestIssueDate: issued, providerUpToDateAsOf: upToDate, retrievedAt: originals.map(o => o.retrievedAt).sort().at(-1)!, importInProgress: metadata.meta.import_in_progress,
    originals, provisions, parserVersion: REGULATORY_PARSER_VERSION, status: "ingested-human-review-required", legalStatus: "unofficial-ecfr-compilation",
    license: { status: "government-regulatory-text", approvalId: null, basis: "GPO eCFR reuse guidance; unofficial compilation, not a certification" },
    warnings: [...(unresolved ? [`${unresolved} paragraphs have only parent citations; legal paragraph anchors require source/qualified validation.`] : []), ...(metadata.meta.import_in_progress ? ["Provider reports import in progress"] : []), ...(amended && amended > input.sourceAsOf ? ["Provider latest_amended_on is later than the pinned sourceAsOf; this metadata is not a statement of content at the pinned date."] : []), ...(issued && issued > input.sourceAsOf ? ["Provider latest_issue_date is later than the pinned sourceAsOf; title metadata is broader than the pinned content."] : []), "Source ingestion does not activate obligations or executable rules."] };
  await deps.store.insert(snapshot, input.originals);
  return snapshot;
}
async function download(kind: OriginalKind, uri: string, deps: SourceIngestDependencies): Promise<RawSourceResponse> {
  const response = await deps.fetch(uri, { headers: { Accept: kind === "full-xml" ? "application/xml, text/xml" : kind === "guidance-pdf" ? "application/pdf" : "application/json", "Accept-Encoding": "gzip, deflate" }, redirect: "error", signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Source HTTP ${response.status} for ${kind}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing source response body");
  const chunks: Buffer[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 30 * 1024 * 1024) throw new Error("Source exceeds 30 MiB limit"); chunks.push(Buffer.from(value)); } } finally { await reader.cancel(); }
  return { kind, requestedUri: uri, finalUri: response.url || uri, contentType: response.headers.get("content-type") ?? "", bytes: Buffer.concat(chunks), retrievedAt: deps.now() };
}
export async function ingestEcfrSource(input: EcfrIngestInput, deps: SourceIngestDependencies = defaultSourceDependencies()) {
  const uris = ecfrRequestUris(input);
  const originals = await Promise.all((Object.entries(uris) as [keyof typeof uris, string][]).map(([kind, uri]) => download(kind, uri, deps)));
  return registerRegulatorySnapshot({ ...input, originals }, deps);
}
export async function ingestNrcGuidancePdf(input: { sourceId: string; uri: string; sourceAsOf: string; edition: string; licenseBasis: string; licenseApprovalId?: string }, deps: SourceIngestDependencies = defaultSourceDependencies()) {
  if (!input.sourceId?.trim() || !input.edition?.trim() || !input.licenseBasis?.trim()) throw new Error("Guidance sourceId, edition and license basis required");
  assertIsoDate(input.sourceAsOf, "sourceAsOf");
  const uri = new URL(input.uri);
  if (uri.protocol !== "https:" || uri.hostname !== "www.nrc.gov" || !/^\/docs\/ML[\dA-Za-z]+\/ML[\dA-Za-z]+\.pdf$/i.test(uri.pathname) || uri.search || uri.hash || uri.username || uri.password) throw new Error("Only exact NRC ADAMS public PDF URI permitted");
  const raw = await download("guidance-pdf", uri.href, deps); validateResponse(raw, uri.href);
  const id = deps.newId(), original = originalManifest(raw, deps.newId());
  const snapshot: RegulatorySnapshot = { id, sourceId: input.sourceId, sourceKind: "nrc-guidance-pdf", regulationSet: null, sourceAsOf: input.sourceAsOf, latestAmendedOn: null, latestIssueDate: null, providerUpToDateAsOf: null, retrievedAt: raw.retrievedAt, importInProgress: null, originals: [original], provisions: [], parserVersion: "pdf-original-metadata-v1", status: "ingested-human-review-required", legalStatus: "guidance-not-law", license: { status: "review-required", approvalId: input.licenseApprovalId ?? null, basis: `${input.edition}: ${input.licenseBasis}; supplied approval reference is unverified and cannot authorize activation` }, warnings: ["Guidance is not automatically law; edition, endorsement, commitments, redistribution rights and source/license approval require qualified review.", "PDF original retained; no automatic legal obligation extraction."] };
  await deps.store.insert(snapshot, [raw]); return snapshot;
}
export async function listSourceSnapshots(sourceId?: string, store: RegulatorySnapshotStore = getRegulatorySnapshotStore()) { return store.list(sourceId); }
export async function getRegulatorySnapshot(id: string, store: RegulatorySnapshotStore = getRegulatorySnapshotStore()) {
  if (!id?.trim()) throw new Error("snapshotId required");
  const snapshot = await store.get(id); if (!snapshot) throw new Error(`Source snapshot unavailable: ${id}`); return snapshot;
}
export async function retrieveRegulatoryOriginal(snapshotId: string, originalId: string, store: RegulatorySnapshotStore = getRegulatorySnapshotStore()) {
  const snapshot = await getRegulatorySnapshot(snapshotId, store);
  const manifest = snapshot.originals.find(o => o.id === originalId);
  if (!manifest) throw new Error("Original does not belong to requested snapshot");
  const bytes = await store.getOriginal(originalId);
  if (sha256(bytes) !== manifest.sha256 || bytes.length !== manifest.sizeBytes) throw new Error("Original byte integrity mismatch");
  return { manifest, bytes };
}
export function validateProvisionReference(snapshot: RegulatorySnapshot, provisionId: string, expectedTextSha256?: string) {
  const provision = snapshot.provisions.find(p => p.id === provisionId);
  if (!provision || provision.anchorStatus === "unresolved") throw new Error(`Exact validated provision unavailable: ${provisionId}`);
  if (expectedTextSha256 && sha256(provision.text) !== expectedTextSha256) throw new Error("Provision text digest mismatch");
  return provision;
}
export async function getProvisionCoverage(snapshotId: string, mappings: { provisionId: string; interpretationApprovalId?: string; evaluatorApprovalId?: string }[] = [], store: RegulatorySnapshotStore = getRegulatorySnapshotStore()) {
  const snapshot = await getRegulatorySnapshot(snapshotId, store);
  const expectedIds = snapshot.regulationSet === "10-cfr-part-21" ? part21SectionInventory.map(([n]) => `10-cfr:${n}`) : snapshot.regulationSet === "10-cfr-part-50-appendix-b" ? appendixBCriteriaInventory.map(([n]) => `10-cfr:part-50:appendix-b:${n}`) : [];
  return { snapshotId, sourceAsOf: snapshot.sourceAsOf, inventory: expectedIds.map(id => ({ provisionId: id, present: snapshot.provisions.some(p => p.id === id), mappings: mappings.filter(m => m.provisionId === id), status: mappings.some(m => m.provisionId === id && m.interpretationApprovalId && m.evaluatorApprovalId) ? "approval-references-present-unverified" : "unknown-unreviewed" })), unresolvedParagraphs: snapshot.provisions.filter(p => p.anchorStatus === "unresolved").map(p => ({ id: p.id, xmlLocator: p.xmlLocator, parentId: p.parentId })), complianceCoverage: null, humanReviewRequired: true };
}
export const REGULATORY_SOURCE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS part21_regulatory_snapshots (snapshot_id VARCHAR(180) PRIMARY KEY, source_id VARCHAR(180) NOT NULL, source_as_of DATE NOT NULL, retrieved_at VARCHAR(40) NOT NULL, payload JSON NOT NULL, manifest_sha256 CHAR(64) NOT NULL, INDEX idx_regulatory_source (source_id, source_as_of))`,
  `CREATE TABLE IF NOT EXISTS part21_regulatory_originals (original_id VARCHAR(180) PRIMARY KEY, snapshot_id VARCHAR(180) NOT NULL, raw_bytes LONGBLOB NOT NULL, sha256 CHAR(64) NOT NULL, FOREIGN KEY (snapshot_id) REFERENCES part21_regulatory_snapshots(snapshot_id))`,
] as const;
/** Parent-owned deployment migration only; never invoked by imports or reads. */
export async function migrateRegulatorySourceStore(db: Pick<Pool, "query">) { for (const sql of REGULATORY_SOURCE_MIGRATIONS) await db.query(sql); }
let sourcePool: Pool | null = null;
function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; source snapshot fallback disabled");
  return sourcePool ??= createPool({ uri: process.env.DATABASE_URL, connectionLimit: 3 });
}
export function createMysqlRegulatorySnapshotStore(db: Pool): RegulatorySnapshotStore {
  const hydrate = (row: { payload: unknown; manifest_sha256: string }): RegulatorySnapshot => {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    if (sha256(stableSourceJson(payload)) !== row.manifest_sha256) throw new Error("Source manifest integrity mismatch");
    return payload as RegulatorySnapshot;
  };
  return {
    async insert(snapshot, raw) {
      const connection = await db.getConnection();
      try { await connection.beginTransaction();
        const serialized = JSON.stringify(snapshot);
        await connection.query("INSERT INTO part21_regulatory_snapshots (snapshot_id, source_id, source_as_of, retrieved_at, payload, manifest_sha256) VALUES (?,?,?,?,?,?)", [snapshot.id, snapshot.sourceId, snapshot.sourceAsOf, snapshot.retrievedAt, serialized, sha256(stableSourceJson(snapshot))]);
        for (const original of snapshot.originals) {
          const bytes = raw.find(r => r.kind === original.kind)?.bytes;
          if (!bytes || sha256(bytes) !== original.sha256) throw new Error("Original bytes/manifest mismatch");
          await connection.query("INSERT INTO part21_regulatory_originals (original_id, snapshot_id, raw_bytes, sha256) VALUES (?,?,?,?)", [original.id, snapshot.id, bytes, original.sha256]);
        }
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    },
    async get(id) { const [rows] = await db.query<any[]>("SELECT payload, manifest_sha256 FROM part21_regulatory_snapshots WHERE snapshot_id=?", [id]); return rows.length ? hydrate(rows[0]) : null; },
    async list(sourceId) { const [rows] = await db.query<any[]>(sourceId ? "SELECT payload, manifest_sha256 FROM part21_regulatory_snapshots WHERE source_id=? ORDER BY source_as_of DESC, retrieved_at DESC" : "SELECT payload, manifest_sha256 FROM part21_regulatory_snapshots ORDER BY source_id, source_as_of DESC", sourceId ? [sourceId] : []); return rows.map(hydrate); },
    async getOriginal(id) { const [rows] = await db.query<any[]>("SELECT raw_bytes, sha256 FROM part21_regulatory_originals WHERE original_id=?", [id]); if (rows.length !== 1) throw new Error("Original source bytes unavailable"); const bytes = Buffer.from(rows[0].raw_bytes); if (sha256(bytes) !== rows[0].sha256) throw new Error("Original source digest mismatch"); return bytes; },
  };
}
export function getRegulatorySnapshotStore() { return createMysqlRegulatorySnapshotStore(database()); }
function defaultSourceDependencies(): SourceIngestDependencies { return { store: getRegulatorySnapshotStore(), fetch: globalThis.fetch, now: () => new Date().toISOString(), newId: randomUUID }; }
