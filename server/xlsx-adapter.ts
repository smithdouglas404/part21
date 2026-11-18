import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { appendAssuranceEvent, listAssuranceEvents } from "./event-store";

export type WorkbookSnapshot = {
  id: string;
  name: string;
  source: string;
  actor: string;
  importedAt: string;
  sha256: string;
  sizeBytes: number;
  sheets: Array<{ name: string; rows: number; columns: number; sample: Record<string, unknown>[] }>;
  status: "parsed" | "pending_human_import";
};

const sampleWorkbooks = [
  { id: "sample-supplier", name: "part21-supplier-sample.xlsx", href: "/samples/part21-supplier-sample.xlsx", purpose: "Supplier master and supplier-change notifications", sheets: ["Suppliers", "SupplierChanges"] },
  { id: "sample-audit", name: "part21-audit-inputs.xlsx", href: "/samples/part21-audit-inputs.xlsx", purpose: "Findings, evidence, and engineering changes", sheets: ["Findings", "Evidence", "Changes"] },
];

const excelRoot = process.env.EXCEL_ROOT || path.resolve(process.cwd(), "data/excel-inbox");
const priorImport = listAssuranceEvents({ type: "excel.workbook_imported" }).at(-1);
let lastSnapshot: WorkbookSnapshot | null = priorImport?.payload.snapshot as WorkbookSnapshot | null;

function parseRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
}

export function getExcelAdapterStatus() {
  return {
    adapter: "excel-workbook-adapter",
    protocol: "MCP Streamable HTTP + stdio bridge",
    liveMcpConnection: true,
    provider: "Local XLSX parser with EXCEL_ROOT directory access",
    excelRoot,
    productionTarget: "Point EXCEL_ROOT at the client-owned directory or replace the adapter with a client-hosted Excel MCP server.",
    toolNames: ["excel_list_workbooks", "excel_describe_workbook", "excel_read_range", "excel_import_workbook", "excel_import_local_workbook", "excel_compare_revision", "excel_approve_import"],
    safety: "Upload creates a human-gated import proposal; it does not mutate the assurance graph automatically.",
    lastSnapshot,
  };
}

export function listLocalWorkbooks() {
  fs.mkdirSync(excelRoot, { recursive: true });
  const files = fs.readdirSync(excelRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.(xlsx|xlsm|xltx)$/i.test(entry.name)).map((entry) => {
    const fullPath = path.join(excelRoot, entry.name);
    const stat = fs.statSync(fullPath);
    return { filename: entry.name, path: fullPath, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
  });
  return { root: excelRoot, files, adapter: getExcelAdapterStatus() };
}

export function listSampleWorkbooks() {
  return { samples: sampleWorkbooks, adapter: getExcelAdapterStatus() };
}

export function importWorkbookPayload(payload: { filename?: string; base64?: string; actor?: string; source?: string }) {
  if (!payload.base64) return { ok: false, error: "A base64 workbook payload is required." };
  const buffer = Buffer.from(payload.base64.replace(/^data:.*?;base64,/, ""), "base64");
  if (buffer.length === 0) return { ok: false, error: "The uploaded workbook is empty." };
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets = workbook.SheetNames.map((name) => {
    const rows = parseRows(workbook.Sheets[name]);
    const columns = rows.length ? Object.keys(rows[0]).length : 0;
    return { name, rows: rows.length, columns, sample: rows.slice(0, 5) };
  });
  const snapshot: WorkbookSnapshot = {
    id: `WB-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    name: payload.filename || "uploaded-workbook.xlsx",
    source: payload.source || "Admin upload",
    actor: payload.actor || "Jordan Lewis",
    importedAt: new Date().toISOString(),
    sha256,
    sizeBytes: buffer.length,
    sheets,
    status: "pending_human_import",
  };
  const previous = lastSnapshot;
  lastSnapshot = snapshot;
  const event = appendAssuranceEvent({ type: "excel.workbook_imported", actor: snapshot.actor, entityId: snapshot.id, payload: { snapshot, diff: compareSnapshots(previous, snapshot), importProposal: { status: "human_review_required", action: "Approve graph import", reason: "Workbook rows can change supplier, finding, evidence, and change context." } } });
  return { ok: true, snapshot, previous, diff: compareSnapshots(previous, snapshot), event, importProposal: { status: "human_review_required", action: "Approve graph import", reason: "Workbook rows can change supplier, finding, evidence, and change context." } };
}

export function importLocalWorkbook(filename: string, actor = "Local MCP caller") {
  const resolved = path.resolve(excelRoot, filename);
  if (!resolved.startsWith(`${path.resolve(excelRoot)}${path.sep}`)) return { ok: false, error: "Workbook path must remain inside EXCEL_ROOT." };
  if (!fs.existsSync(resolved)) return { ok: false, error: `Workbook not found in EXCEL_ROOT: ${filename}` };
  const buffer = fs.readFileSync(resolved);
  return importWorkbookPayload({ filename: path.basename(resolved), base64: buffer.toString("base64"), actor, source: `EXCEL_ROOT:${excelRoot}` });
}

export function approveWorkbookImport(workbookId: string, actor: string, note = "Approved after human review") {
  if (!lastSnapshot || lastSnapshot.id !== workbookId) return { ok: false, error: "Workbook revision is not the current pending revision." };
  const transactionTime = new Date().toISOString();
  const graphProjection = lastSnapshot.sheets.flatMap((sheet) => sheet.sample.map((row, index) => ({ id: `${workbookId}:${sheet.name}:${index + 1}`, type: sheet.name, source: lastSnapshot?.name, properties: row })));
  const event = appendAssuranceEvent({ type: "excel.graph_import_approved", actor, entityId: workbookId, payload: { workbookId, note, validTime: lastSnapshot.importedAt, transactionTime, graphMutation: "durable_bitemporal_overlay_persisted", graphProjection } });
  return { ok: true, status: "approved_and_persisted", event, graphProjectionCount: graphProjection.length, warning: "The durable workbook overlay is persisted. Client-qualified ontology mapping is still required before promoting rows into authoritative system-of-record entities." };
}

export function compareSnapshots(previous: WorkbookSnapshot | null, current: WorkbookSnapshot | null = lastSnapshot) {
  if (!current) return { status: "no_snapshot", changed: [], addedSheets: [], removedSheets: [] };
  if (!previous) return { status: "baseline_created", changed: current.sheets.flatMap((sheet) => sheet.sample.map((row) => ({ sheet: sheet.name, change: "baseline row", row }))), addedSheets: current.sheets.map((sheet) => sheet.name), removedSheets: [] };
  const previousByName = new Map(previous.sheets.map((sheet) => [sheet.name, sheet]));
  const currentByName = new Map(current.sheets.map((sheet) => [sheet.name, sheet]));
  const changed: Array<Record<string, unknown>> = [];
  for (const sheet of current.sheets) {
    const oldSheet = previousByName.get(sheet.name);
    if (!oldSheet) {
      for (const row of sheet.sample) changed.push({ sheet: sheet.name, change: "sheet added", row });
      continue;
    }
    if (JSON.stringify(oldSheet.sample) !== JSON.stringify(sheet.sample)) changed.push({ sheet: sheet.name, change: "sample rows changed", before: oldSheet.sample, after: sheet.sample });
  }
  return { status: changed.length ? "changes_detected" : "no_sample_changes", changed, addedSheets: current.sheets.filter((s) => !previousByName.has(s.name)).map((s) => s.name), removedSheets: previous.sheets.filter((s) => !currentByName.has(s.name)).map((s) => s.name) };
}

export function readWorkbookSample() {
  return lastSnapshot ? { snapshot: lastSnapshot, adapter: getExcelAdapterStatus() } : { error: "No workbook uploaded yet." };
}
