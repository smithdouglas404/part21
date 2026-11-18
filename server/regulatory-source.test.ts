import { describe, expect, it, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { appendixBCriteriaInventory, part21SectionInventory } from "../shared/regulatory";
import type { RegulatorySnapshot } from "../shared/regulatory";
import { createMysqlRegulatorySnapshotStore, ecfrRequestUris, getProvisionCoverage, ingestEcfrSource, ingestNrcGuidancePdf, parseEcfrProvisions, registerRegulatorySnapshot, retrieveRegulatoryOriginal, sha256, stableSourceJson, validateProvisionReference, type RawSourceResponse, type RegulatorySnapshotStore, type SourceIngestDependencies } from "./regulatory-source";

const at = "2026-11-18T12:00:00.000Z";
const input = { sourceId: "test-configured-source", regulationSet: "10-cfr-part-21" as const, sourceAsOf: "2026-11-09" };
// Synthetic XML exists only in tests. It makes no legal-source content claim.
const sectionXml = `<DIV5 N="21" TYPE="PART"><HEAD>Part 21 test</HEAD>${part21SectionInventory.map(([id]) => id === "21.21" ? '<DIV8 N="21.21" TYPE="SECTION"><HEAD>Test section</HEAD><P>(a) An entity shall evaluate.</P><P>(1) It must preserve evidence.</P><P>(i) It shall retain this paragraph.</P><P>(ii) It may continue.</P><P>(2) It must record the event.</P><P>(b) It shall notify.</P><P>(1) It shall retain evidence.</P><P>(a) Duplicate anchor unresolved.</P></DIV8>' : `<DIV8 N="${id}" TYPE="SECTION"><HEAD>Test section ${id}</HEAD><P>Test text.</P></DIV8>`).join("")}</DIV5>`;
const hierarchy = { type: "title", identifier: "10", label: "Title 10", children: [{ type: "chapter", identifier: "I", label: "NRC", children: [{ type: "part", identifier: "21", label: "Part21", children: part21SectionInventory.map(([identifier]) => ({ type: "section", identifier, label: `Test section ${identifier}` })) }] }] };
function responses(): RawSourceResponse[] {
  const uris = ecfrRequestUris(input);
  return [
    { kind: "metadata", requestedUri: uris.metadata, finalUri: uris.metadata, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ titles: [{ number: 10, up_to_date_as_of: "2026-11-09", latest_amended_on: "2026-10-01", latest_issue_date: "2026-11-08" }], meta: { import_in_progress: false } })), retrievedAt: at },
    { kind: "hierarchy", requestedUri: uris.hierarchy, finalUri: uris.hierarchy, contentType: "application/json", bytes: Buffer.from(JSON.stringify(hierarchy)), retrievedAt: at },
    { kind: "full-xml", requestedUri: uris["full-xml"], finalUri: uris["full-xml"], contentType: "application/xml; charset=utf-8", bytes: Buffer.from(sectionXml), retrievedAt: at },
  ];
}
function mockDependencies() {
  let n = 0; const snapshots = new Map<string, RegulatorySnapshot>(), originals = new Map<string, Buffer>();
  const store: RegulatorySnapshotStore = { insert: vi.fn(async (snapshot: RegulatorySnapshot, raw: RawSourceResponse[]) => { snapshots.set(snapshot.id, structuredClone(snapshot)); for (const o of snapshot.originals) originals.set(o.id, raw.find((candidate: RawSourceResponse) => candidate.kind === o.kind)!.bytes); }), get: async (id: string) => snapshots.get(id) ?? null, list: async (sourceId?: string) => [...snapshots.values()].filter(s => !sourceId || s.sourceId === sourceId), getOriginal: async (id: string) => originals.get(id)! };
  const deps: SourceIngestDependencies = { store, fetch: vi.fn() as unknown as typeof fetch, now: () => at, newId: () => `test-source-id-${++n}` };
  return { deps, store, originals };
}
describe("public original-source ingestion (mock only)", () => {
  it("pins distinct dates, original raw-byte digests and all response provenance", async () => {
    const { deps, store } = mockDependencies(); const raw = responses();
    const snapshot = await registerRegulatorySnapshot({ ...input, originals: raw }, deps);
    expect(snapshot.sourceAsOf).toBe(input.sourceAsOf); expect(snapshot.latestAmendedOn).toBe("2026-10-01"); expect(snapshot.latestIssueDate).toBe("2026-11-08"); expect(snapshot.retrievedAt).toBe(at);
    const xml = snapshot.originals.find(o => o.kind === "full-xml")!;
    expect(xml.sha256).toBe(sha256(raw[2].bytes)); expect(snapshot.status).toBe("ingested-human-review-required");
    expect((await retrieveRegulatoryOriginal(snapshot.id, xml.id, store)).bytes).toEqual(raw[2].bytes);
  });
  it("validates exact reconstructed paragraphs including sibling numeric after roman", async () => {
    const { deps } = mockDependencies(); const s = await registerRegulatorySnapshot({ ...input, originals: responses() }, deps);
    for (const id of ["10-cfr:21.21(a)", "10-cfr:21.21(a)(1)", "10-cfr:21.21(a)(1)(i)", "10-cfr:21.21(a)(1)(ii)", "10-cfr:21.21(a)(2)", "10-cfr:21.21(b)(1)"]) expect(validateProvisionReference(s, id).id).toBe(id);
    expect(() => validateProvisionReference(s, "10-cfr:21.21(d)(99)")).toThrow("unavailable");
    expect(s.provisions.some(p => p.anchorStatus === "unresolved")).toBe(true);
  });
  it("rejects provider redirects, HTML content types, malformed bytes and hierarchy mismatches", async () => {
    const { deps, store } = mockDependencies();
    for (const alter of [
      (r: RawSourceResponse[]) => { r[2].finalUri = "https://www.ecfr.gov/verify"; },
      (r: RawSourceResponse[]) => { r[2].contentType = "text/html"; },
      (r: RawSourceResponse[]) => { r[2].bytes = Buffer.from("<html>captcha</html>"); },
      (r: RawSourceResponse[]) => { r[1].bytes = Buffer.from(JSON.stringify({ ...hierarchy, identifier: "9" })); },
      (r: RawSourceResponse[]) => { r[2].bytes = Buffer.from(sectionXml.replace('N="21.21"', 'N="21.99"')); },
    ]) { const raw = responses(); alter(raw); await expect(registerRegulatorySnapshot({ ...input, originals: raw }, deps)).rejects.toThrow(); }
    expect(store.insert).not.toHaveBeenCalled();
  });
  it("rejects duplicate originals, future currency and DTD content", async () => {
    const { deps } = mockDependencies(); const raw = responses();
    await expect(registerRegulatorySnapshot({ ...input, originals: [raw[0], raw[0], raw[2]] }, deps)).rejects.toThrow("Exactly one");
    await expect(registerRegulatorySnapshot({ ...input, sourceAsOf: "2026-11-10", originals: raw.map(r => ({ ...r, requestedUri: r.requestedUri.replace("2026-11-09", "2026-11-10"), finalUri: r.finalUri.replace("2026-11-09", "2026-11-10") })) }, deps)).rejects.toThrow("currency");
    raw[2].bytes = Buffer.from('<!DOCTYPE x [<!ENTITY x "bad">]>' + sectionXml);
    await expect(registerRegulatorySnapshot({ ...input, originals: raw }, deps)).rejects.toThrow("DTD");
  });
  it("ingests all 18 distinct AppendixB criteria from actual supplied XML, not a stock rule pack", async () => {
    const { deps, store } = mockDependencies();
    const app = { ...input, regulationSet: "10-cfr-part-50-appendix-b" as const }, uris = ecfrRequestUris(app);
    const xml = `<DIV9 TYPE="APPENDIX" N="Appendix B to Part 50"><HEAD>Test AppendixB</HEAD>${appendixBCriteriaInventory.map(([id, title]) => `<HD1>${id}. ${title}</HD1><P>The test entity shall preserve ${id}.</P>`).join("")}</DIV9>`;
    const raw = responses(); raw[1].bytes = Buffer.from(JSON.stringify({ type: "title", identifier: "10", children: [{ type: "chapter", identifier: "I", children: [{ type: "part", identifier: "50", children: [{ type: "appendix", identifier: "Appendix B to Part 50" }] }] }] }));
    raw[2] = { ...raw[2], requestedUri: uris["full-xml"], finalUri: uris["full-xml"], bytes: Buffer.from(xml) };
    const s = await registerRegulatorySnapshot({ ...app, originals: raw }, deps);
    expect(s.provisions.filter(p => p.kind === "criterion")).toHaveLength(18);
    expect((await getProvisionCoverage(s.id, [], store)).inventory).toHaveLength(18);
    expect(() => parseEcfrProvisions(Buffer.from(xml.replace("XVIII. Audits", "XX. Audits")), raw[1], app.regulationSet, "test-s", "test-o")).toThrow("18 criteria");
  });
  it("never guesses definitions anchors or uses provider NODE as permanent ID", () => {
    const raw = responses(); const xml = `<DIV5 N="21" TYPE="PART" NODE="unstable"><HEAD>Test Part</HEAD>${part21SectionInventory.map(([id]) => id === "21.21" ? '<DIV8 N="21.21" TYPE="SECTION"><HEAD>Test</HEAD><P><I>Basic component.</I> (1)(i) means a test item.</P><P>(A) Definition continuation.</P></DIV8>' : `<DIV8 N="${id}" TYPE="SECTION"><HEAD>Test ${id}</HEAD><P>Test text.</P></DIV8>`).join("")}</DIV5>`;
    const p = parseEcfrProvisions(Buffer.from(xml), raw[1], input.regulationSet, "test-s", "test-o");
    expect(p.filter(p => p.kind === "paragraph").every(p => p.anchorStatus === "unresolved")).toBe(true); expect(p.some(p => p.id.includes("unstable"))).toBe(false);
  });
  it("uses public no-key endpoints and fail-closed fetch options", async () => {
    const { deps } = mockDependencies(); const raw = responses();
    deps.fetch = vi.fn(async (uri, options) => {
      expect(options?.redirect).toBe("error"); expect(options?.headers).not.toHaveProperty("Authorization");
      const r = raw.find((candidate: RawSourceResponse) => candidate.requestedUri === String(uri))!;
      return new Response(new Uint8Array(r.bytes), { headers: { "content-type": r.contentType } });
    }) as typeof fetch;
    expect((await ingestEcfrSource(input, deps)).originals).toHaveLength(3);
  });
  it("keeps NRC PDF guidance metadata/license approvals unverified and separate from law", async () => {
    const { deps } = mockDependencies(); deps.fetch = vi.fn(async () => new Response(new Uint8Array(Buffer.from("%PDF-1.7\n test original")), { headers: { "content-type": "application/pdf" } })) as typeof fetch;
    const s = await ingestNrcGuidancePdf({ sourceId: "test-nrc-guidance", uri: "https://www.nrc.gov/docs/ML2403/ML24038A310.pdf", sourceAsOf: "2024-02-01", edition: "Test edition", licenseBasis: "Review required", licenseApprovalId: "unverified-test-ref" }, deps);
    expect(s.legalStatus).toBe("guidance-not-law"); expect(s.license.status).toBe("review-required"); expect(s.provisions).toEqual([]);
    await expect(ingestNrcGuidancePdf({ sourceId: "test-source", uri: "http://localhost/private.pdf", sourceAsOf: "2024-02-01", edition: "test", licenseBasis: "test" }, deps)).rejects.toThrow("NRC");
  });
  it("fails retrieval when retained original bytes no longer match", async () => {
    const { deps, store, originals } = mockDependencies(); const s = await registerRegulatorySnapshot({ ...input, originals: responses() }, deps); const o = s.originals[0]; originals.set(o.id, Buffer.from("changed"));
    await expect(retrieveRegulatoryOriginal(s.id, o.id, store)).rejects.toThrow("integrity");
  });
  it("survives MySQL JSON key reordering and does not migrate during insert/read", async () => {
    const { deps } = mockDependencies(); const snapshot = await registerRegulatorySnapshot({ ...input, originals: responses() }, deps);
    let stored: { payload: unknown; manifest_sha256: string } | null = null;
    const query = vi.fn(async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith("INSERT INTO part21_regulatory_snapshots")) stored = { payload: JSON.parse(args[4] as string), manifest_sha256: args[5] as string };
      if (sql.startsWith("SELECT payload")) { const sorted = JSON.parse(stableSourceJson(stored!.payload)); return [[{ payload: sorted, manifest_sha256: stored!.manifest_sha256 }], []]; }
      return [[], []];
    });
    const connection = { query, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    const db = { query, getConnection: vi.fn(async () => connection) } as unknown as Pool;
    const store = createMysqlRegulatorySnapshotStore(db);
    await store.insert(snapshot, responses()); expect(await store.get(snapshot.id)).toEqual(snapshot);
    expect(query.mock.calls.some(([sql]) => /CREATE|ALTER|DELETE|UPDATE/.test(sql))).toBe(false);
  });
});
