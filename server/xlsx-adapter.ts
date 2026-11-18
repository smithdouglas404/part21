import crypto from "node:crypto";
import XLSX from "xlsx";

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

let lastSnapshot: WorkbookSnapshot | null = null;

function parseRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
}

export function getExcelAdapterStatus() {
  return {
    adapter: "excel-workbook-adapter",
    protocol: "MCP-style HTTP boundary",
    liveMcpConnection: false,
    provider: "Local XLSX parser in demo runtime",
    productionTarget: "Client-hosted Excel MCP server such as excel-mcp-server over stdio/HTTP",
    toolNames: ["excel_list_workbooks", "excel_describe_workbook", "excel_read_range", "excel_import_workbook", "excel_compare_revision"],
    safety: "Upload creates a human-gated import proposal; it does not mutate the assurance graph automatically.",
    lastSnapshot,
  };
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
  return { ok: true, snapshot, previous, diff: compareSnapshots(previous, snapshot), importProposal: { status: "human_review_required", action: "Approve graph import", reason: "Workbook rows can change supplier, finding, evidence, and change context." } };
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
