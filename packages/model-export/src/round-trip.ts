import ExcelJS from "exceljs";
import type { DriverPattern, DriverRef } from "@balsa/finance-engine";
import { forecastColumns as C, type ExportPattern } from "./forecast-sheet";
import { modelColumns } from "./model-sheet";

/**
 * The round trip: every export carries a manifest of its editable cells and
 * the values it wrote there, on a very hidden sheet. When the file comes back,
 * `readWorkbookEdits` compares those cells with the manifest and reports what
 * the reader changed. It never decides what to do with an edit: Balsa turns
 * edits into proposed decisions for a person to review, and reports anything
 * it cannot express as a note.
 */

export const manifestSheetName = "Balsa data";
export const manifestFormat = "balsa-export-manifest-1";

export type ManifestDriver = { key: string; id: string; scenarioId: string | null; label: string; row: number; kind: "pattern" | "formula"; pattern?: ExportPattern; formula?: { text: string; startsIn: string; endsIn: string | null; repeatsEvery: number } };
export type ManifestMetric = { name: string; label: string; row: number; pattern: ExportPattern };
export type ManifestModelRow = { variable: string; key: string; coords: Record<string, string>; row: number; kind: "input" | "formula"; values: (number | null)[] };
export type ExportManifest = {
  format: string; exportFormat: string; companyId: string | null; exportedAt: string; asOfPeriod: string;
  drivers: ManifestDriver[]; metrics: ManifestMetric[];
  model: { months: string[]; rows: ManifestModelRow[] } | null;
  seasonality: { firstRow: number; profiles: { name: string; deviations: number[] }[] } | null;
  escalation: { rate: number; everyMonths: number; anchorMonth: number | null } | null;
};

const chunkSize = 30_000; // under a cell's 32,767-character limit

/** Write the manifest as JSON chunks on a sheet readers never see. */
export function writeManifest(workbook: ExcelJS.Workbook, manifest: ExportManifest) {
  const sheet = workbook.addWorksheet(manifestSheetName, { state: "veryHidden" });
  const text = JSON.stringify(manifest);
  sheet.getCell(1, 1).value = manifestFormat;
  for (let index = 0; index * chunkSize < text.length; index += 1) sheet.getCell(2 + index, 1).value = text.slice(index * chunkSize, (index + 1) * chunkSize);
}

function readManifest(workbook: ExcelJS.Workbook): ExportManifest | null {
  const sheet = workbook.getWorksheet(manifestSheetName);
  if (!sheet || sheet.getCell(1, 1).value !== manifestFormat) return null;
  let text = "";
  for (let row = 2; row <= sheet.rowCount; row += 1) { const value = sheet.getCell(row, 1).value; if (typeof value === "string") text += value; }
  try { const manifest = JSON.parse(text) as ExportManifest; return manifest.format === manifestFormat ? manifest : null; } catch { return null; }
}

export type WorkbookEdit =
  | { kind: "driver_pattern"; id: string; scenarioId: string | null; label: string; before: ExportPattern; after: ExportPattern }
  | { kind: "formula_window"; id: string; scenarioId: string | null; label: string; before: NonNullable<ManifestDriver["formula"]>; after: NonNullable<ManifestDriver["formula"]> }
  | { kind: "metric_pattern"; name: string; label: string; before: ExportPattern; after: ExportPattern }
  | { kind: "model_input"; variable: string; key: string; coords: Record<string, string>; months: string[]; before: (number | null)[]; after: number[] };
export type WorkbookEdits = { manifest: ExportManifest; edits: WorkbookEdit[]; notes: string[] };

const plain = (value: ExcelJS.CellValue): ExcelJS.CellValue => value && typeof value === "object" && "result" in value && !(value instanceof Date) ? (value as { result?: ExcelJS.CellValue }).result ?? null : value;
const isFormula = (value: ExcelJS.CellValue) => Boolean(value && typeof value === "object" && !(value instanceof Date) && ("formula" in value || "sharedFormula" in value));
const periodOf = (value: ExcelJS.CellValue): string | null | "invalid" => {
  const resolved = plain(value);
  if (resolved === null || resolved === undefined || resolved === "") return null;
  if (resolved instanceof Date) return `${resolved.getUTCFullYear()}-${String(resolved.getUTCMonth() + 1).padStart(2, "0")}`;
  if (typeof resolved === "number") { const date = new Date(Date.UTC(1899, 11, 30) + Math.round(resolved) * 86_400_000); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
  if (typeof resolved === "string" && /^\d{4}-(0[1-9]|1[0-2])/.test(resolved)) return resolved.slice(0, 7);
  return "invalid";
};
const numberOf = (value: ExcelJS.CellValue): number | null | "invalid" => {
  const resolved = plain(value);
  if (resolved === null || resolved === undefined || resolved === "") return null;
  if (typeof resolved === "number" && Number.isFinite(resolved)) return resolved;
  if (typeof resolved === "string" && /^-?\d+(\.\d+)?$/.test(resolved.trim())) return Number(resolved.trim());
  return "invalid";
};
const textOf = (value: ExcelJS.CellValue) => { const resolved = plain(value); return resolved === null || resolved === undefined ? "" : String(resolved).trim(); };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const bases = new Set(["", "% change", "# change", "log change", "% of", "# per"]);

/** Read a driver or metric row's inputs back as a pattern; `using` cannot be edited in the file, so it comes from the manifest. */
function readPattern(sheet: ExcelJS.Worksheet, row: number, exported: ExportPattern, label: string, notes: string[]): ExportPattern | null {
  const cell = (column: number) => sheet.getCell(row, column).value;
  const problems: string[] = [];
  const num = (column: number, name: string) => { const value = numberOf(cell(column)); if (value === "invalid") { problems.push(`${name} is not a number`); return null; } return value; };
  const initial = num(C.initial, "the initial value"); const repeats = num(C.repeats, "repeats every"); const changesEvery = num(C.changesEvery, "changes every"); const by = num(C.by, "changing by");
  const maxMonths = num(C.maxMonths, "the maximum months"); const maxValue = num(C.maxValue, "the maximum value");
  const starts = periodOf(cell(C.starts)); const ends = periodOf(cell(C.ends));
  if (starts === "invalid" || starts === null) problems.push("the start month is not a date");
  if (ends === "invalid") problems.push("the end month is not a date");
  const basis = textOf(cell(C.basis));
  if (!bases.has(basis)) problems.push(`"${basis}" is not a basis Balsa knows`);
  const seasonality = textOf(cell(C.seasonality)) || null;
  let escalation: ExportPattern["escalation"] = null;
  if (exported.escalation === "company" && [C.escalationRate, C.escalationEvery, C.escalationFrom].every((column) => isFormula(cell(column)))) escalation = "company";
  else {
    const rate = num(C.escalationRate, "the escalation rate"); const every = num(C.escalationEvery, "the escalation cycle"); const from = num(C.escalationFrom, "the escalation month");
    if (rate) escalation = { rate, everyMonths: every ?? 0, anchorMonth: from || null };
  }
  if (initial === null) problems.push("the initial value is empty");
  if (problems.length) { notes.push(`${label}: not proposed, because ${problems.join(", ")}.`); return null; }
  return { initialValue: initial!, startsIn: starts as string, endsIn: ends as string | null, repeatsEvery: repeats ?? 0, basis: basis as ExportPattern["basis"], changesEvery: changesEvery, changingBy: by, using: exported.using, maxMonths: maxMonths || null, maxValue, seasonality, escalation };
}

/** Compare a returned export with the manifest it was written with. Null when the file is not a Balsa export. */
export async function readWorkbookEdits(bytes: Uint8Array | ArrayBuffer): Promise<WorkbookEdits | null> {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load((bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes) as ArrayBuffer); } catch { return null; }
  const manifest = readManifest(workbook);
  if (!manifest) return null;
  const edits: WorkbookEdit[] = []; const notes: string[] = [];
  const forecast = workbook.getWorksheet("Forecast");
  if (forecast) {
    for (const driver of manifest.drivers) {
      const label = `${driver.label}${driver.scenarioId ? " (scenario row)" : ""}`;
      if (driver.kind === "pattern" && driver.pattern) {
        const after = readPattern(forecast, driver.row, driver.pattern, label, notes);
        if (after && !same(after, driver.pattern)) edits.push({ kind: "driver_pattern", id: driver.id, scenarioId: driver.scenarioId, label: driver.label, before: driver.pattern, after });
      } else if (driver.kind === "formula" && driver.formula) {
        const starts = periodOf(forecast.getCell(driver.row, C.starts).value); const ends = periodOf(forecast.getCell(driver.row, C.ends).value); const repeats = numberOf(forecast.getCell(driver.row, C.repeats).value);
        if (starts === "invalid" || starts === null || ends === "invalid" || repeats === "invalid") { notes.push(`${label}: not proposed, because its start, end or repeat is not valid.`); continue; }
        const after = { ...driver.formula, startsIn: starts, endsIn: ends, repeatsEvery: repeats ?? 0 };
        if (!same(after, driver.formula)) edits.push({ kind: "formula_window", id: driver.id, scenarioId: driver.scenarioId, label: driver.label, before: driver.formula, after });
      }
    }
    for (const metric of manifest.metrics) {
      const after = readPattern(forecast, metric.row, metric.pattern, metric.label, notes);
      if (after && !same(after, metric.pattern)) edits.push({ kind: "metric_pattern", name: metric.name, label: metric.label, before: metric.pattern, after });
    }
  }
  const model = workbook.getWorksheet("Model");
  if (model && manifest.model) {
    for (const row of manifest.model.rows) {
      const read = manifest.model.months.map((_, index) => numberOf(model.getCell(row.row, modelColumns.firstMonth + index).value));
      const name = `${row.variable}${row.key ? ` [${row.key.split("|").join(", ")}]` : ""}`;
      if (row.kind === "formula") {
        if (manifest.model.months.some((_, index) => !isFormula(model.getCell(row.row, modelColumns.firstMonth + index).value)) && read.some((value, index) => value !== row.values[index])) notes.push(`${name} is a formula variable; values typed over its cells are not proposed. Change its formula in Balsa.`);
        continue;
      }
      if (read.some((value) => value === "invalid" || value === null)) { notes.push(`${name}: not proposed, because a month is empty or not a number.`); continue; }
      const after = read as number[];
      if (!same(after, row.values)) edits.push({ kind: "model_input", variable: row.variable, key: row.key, coords: row.coords, months: manifest.model.months, before: row.values, after });
    }
  }
  const getStarted = workbook.getWorksheet("Get Started");
  if (getStarted && manifest.seasonality) {
    const changed = manifest.seasonality.profiles.some((profile, index) => textOf(getStarted.getCell(manifest.seasonality!.firstRow + index, 4).value) !== profile.name || profile.deviations.some((deviation, month) => numberOf(getStarted.getCell(manifest.seasonality!.firstRow + index, 5 + month).value) !== deviation));
    const added = textOf(getStarted.getCell(manifest.seasonality.firstRow + manifest.seasonality.profiles.length, 4).value);
    if (changed || added) notes.push("Seasonality profiles on Get Started were changed. Profiles are edited in Balsa (Accounting, Drivers); those edits are not proposed.");
  }
  if (getStarted && manifest.escalation !== undefined) {
    const now = [numberOf(getStarted.getCell("S5").value), numberOf(getStarted.getCell("S6").value), numberOf(getStarted.getCell("S7").value)];
    const was = manifest.escalation ? [manifest.escalation.rate, manifest.escalation.everyMonths, manifest.escalation.anchorMonth] : [null, null, null];
    if (!same(now, was)) notes.push("The company escalation on Get Started was changed. It is set in Balsa (Accounting, Drivers); that edit is not proposed.");
  }
  return { manifest, edits, notes };
}

const decimal = (value: number) => { const text = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""); return text === "-0" ? "0" : text; };
const changeBases = { "% change": "pct_change", "# change": "abs_change", "log change": "log_change", "% of": "pct_of", "# per": "per_unit" } as const;

/** An edited row as a Balsa pattern. Seasonality is named in the file; `profileId` resolves the name. */
export function patternFromExport(pattern: ExportPattern, profileId: (name: string) => string | null): { pattern: DriverPattern } | { problem: string } {
  const result: DriverPattern = { initialValue: decimal(pattern.initialValue), repeatsEveryMonths: pattern.repeatsEvery };
  if (pattern.basis) {
    const basis = changeBases[pattern.basis];
    if (basis === "pct_of" || basis === "per_unit") {
      if (!pattern.using) return { problem: `"${pattern.basis}" needs something to multiply; set it in Balsa` };
      const ref: DriverRef = pattern.using.kind === "driver" ? { kind: "driver", driverId: pattern.using.id } : pattern.using.kind === "metric" ? { kind: "metric", name: pattern.using.name } : { kind: "report_line", line: pattern.using.line };
      result.change = { basis, ref };
    } else result.change = { basis, everyMonths: pattern.changesEvery ?? 0, by: decimal(pattern.changingBy ?? 0) };
  }
  if (pattern.maxMonths) result.maxMonths = pattern.maxMonths;
  if (pattern.maxValue !== null) result.maxValue = decimal(pattern.maxValue);
  if (pattern.seasonality) { const id = profileId(pattern.seasonality); if (!id) return { problem: `there is no seasonality profile named "${pattern.seasonality}"` }; result.seasonalityProfileId = id; }
  if (pattern.escalation === "company") result.escalation = "company";
  else if (pattern.escalation) result.escalation = { rate: decimal(pattern.escalation.rate), everyMonths: pattern.escalation.everyMonths, anchor: pattern.escalation.anchorMonth ? { calendarMonth: pattern.escalation.anchorMonth } : "driver_start" };
  return { pattern: result };
}

/** A Model input row's edited months as step inputs: one entry wherever the value changes, keeping entries outside the file's months. */
export function stepInputs(existing: { coords: Record<string, string>; from: string; value: string }[], coords: Record<string, string>, months: string[], values: number[]) {
  const sameCoords = (entry: { coords: Record<string, string> }) => Object.keys(coords).length === Object.keys(entry.coords).length && Object.entries(coords).every(([dim, item]) => entry.coords[dim] === item);
  const kept = existing.filter((entry) => !sameCoords(entry) || entry.from < months[0]! || entry.from > months.at(-1)!);
  const before = existing.filter((entry) => sameCoords(entry) && entry.from < months[0]!).sort((left, right) => left.from.localeCompare(right.from)).at(-1);
  const entries: { coords: Record<string, string>; from: string; value: string }[] = [];
  let previous = before ? Number(before.value) : 0;
  months.forEach((month, index) => { const value = values[index]!; if (index === 0 ? value !== previous : value !== values[index - 1]) entries.push({ coords, from: month, value: decimal(value) }); previous = value; });
  return [...kept, ...entries];
}
