import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ protect: vi.fn(), context: vi.fn(), store: vi.fn(), inspect: vi.fn(), propose: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { protect: mocks.protect }, requireCompanyAccess: mocks.context }));
vi.mock("@/lib/blob-store", () => ({ storeSourceBlob: mocks.store }));
vi.mock("@/lib/spreadsheet-extraction", () => ({ inspectSpreadsheet: mocks.inspect }));
vi.mock("@/lib/workbook-round-trip", () => ({ proposeWorkbookEditsWith: mocks.propose }));
const { POST } = await import("./route");

describe("returned workbook intake", () => {
  it("returns a bounded 400 for a recognized malformed export without storing or extracting it", async () => {
    mocks.context.mockResolvedValue({ company: { id: "synthetic" }, user: { id: "synthetic" } });
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Forecast");
    const manifest = workbook.addWorksheet("Balsa data", { state: "veryHidden" });
    manifest.getCell("A1").value = "balsa-export-manifest-1";
    manifest.getCell("A2").value = JSON.stringify({ format: "balsa-export-manifest-1", companyId: "synthetic" });
    const form = new FormData(); form.set("file", new File([new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer)], "synthetic.xlsx"));
    const response = await POST(new Request("http://localhost/api/evidence", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This Balsa workbook has invalid or unsupported export data. Download a fresh export and try again." });
    expect(mocks.protect).toHaveBeenCalledOnce();
    expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.propose).not.toHaveBeenCalled();
  });
});
