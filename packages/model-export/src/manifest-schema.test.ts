import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportFormatVersion, manifestFormat, InvalidWorkbookExport } from "./manifest-schema";
import { readWorkbookEdits, writeManifest, type ExportManifest } from "./round-trip";

const valid: ExportManifest = { format: manifestFormat, exportFormat: exportFormatVersion, companyId: "synthetic", exportedAt: "2026-10-06T00:00:00.000Z", asOfPeriod: "2026-09", drivers: [], metrics: [], model: null, seasonality: null, escalation: null };
async function bytes(value: unknown, marker = manifestFormat) {
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Forecast"); workbook.addWorksheet("Model");
  writeManifest(workbook, value as ExportManifest);
  workbook.getWorksheet("Balsa data")!.getCell("A1").value = marker;
  return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}
describe("untrusted export manifests", () => {
  it("accepts a supported manifest and distinguishes an ordinary workbook", async () => {
    expect((await readWorkbookEdits(await bytes(valid)))?.manifest).toEqual(valid);
    const ordinary = new ExcelJS.Workbook(); ordinary.addWorksheet("Budget");
    expect(await readWorkbookEdits(await ordinary.xlsx.writeBuffer() as ArrayBuffer)).toBeNull();
  });
  it.each([
    { format: manifestFormat, companyId: "synthetic" },
    { ...valid, exportFormat: "future-version" },
    { ...valid, exportedAt: null },
    { ...valid, seasonality: { firstRow: 1_048_576, profiles: [{ name: "one", deviations: Array(12).fill(0) }, { name: "two", deviations: Array(12).fill(0) }] } },
    { ...valid, asOfPeriod: "2026-13" },
    { ...valid, model: { months: ["2026-10", "2026-10"], rows: [] } },
    { ...valid, model: { months: ["2026-10"], rows: [{ variable: "units", key: "", coords: {}, row: -1, kind: "input", values: [1] }] } },
    { ...valid, model: { months: ["2026-10"], rows: [{ variable: "units", key: "", coords: {}, row: 10, kind: "input", values: [1, 2] }] } },
  ])("rejects malformed recognized export %# instead of extracting it", async (value) => {
    await expect(readWorkbookEdits(await bytes(value))).rejects.toBeInstanceOf(InvalidWorkbookExport);
  });
  it("rejects a damaged marker and invalid JSON with a bounded error", async () => {
    await expect(readWorkbookEdits(await bytes(valid, "balsa-export-manifest-99"))).rejects.toThrow("Download a fresh export");
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Forecast"); writeManifest(workbook, valid);
    workbook.getWorksheet("Balsa data")!.getCell("A2").value = "{";
    await expect(readWorkbookEdits(await workbook.xlsx.writeBuffer() as ArrayBuffer)).rejects.toBeInstanceOf(InvalidWorkbookExport);
  });
});
