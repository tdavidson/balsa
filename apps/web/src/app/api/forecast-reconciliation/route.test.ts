import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ protect: vi.fn(), context: vi.fn(), execute: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { protect: mocks.protect }, requireCompanyAccess: mocks.context }));
vi.mock("@/lib/forecast-reconciliation", () => ({ executeForecastReconciliation: mocks.execute, loadForecastReconciliation: mocks.load, ReconciliationError: class extends Error {} }));
const { GET, POST } = await import("./route");
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ company: { id: "company-a" }, user: { id: "actor" } }); });

describe("forecast reconciliation HTTP boundary", () => {
  it("rejects stale company selection before calling the mutation service", async () => {
    const response = await POST(new Request("http://localhost/api/forecast-reconciliation", { method: "POST", headers: { "x-company-id": "company-b" }, body: "{}" }));
    expect(response.status).toBe(409); expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.protect).toHaveBeenCalledOnce();
  });
  it("bounds the request and rejects invalid JSON", async () => {
    for (const [body, status] of [["x".repeat(16_001), 413], ["{broken", 400]] as const) {
      const response = await POST(new Request("http://localhost/api/forecast-reconciliation", { method: "POST", headers: { "x-company-id": "company-a" }, body }));
      expect(response.status).toBe(status);
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("uses the authorized company and actor, never values supplied in the body", async () => {
    const body = { action: "create_goal", companyId: "untrusted", actorUserId: "untrusted" };
    mocks.execute.mockResolvedValue({ goal: {} });
    await POST(new Request("http://localhost/api/forecast-reconciliation", { method: "POST", headers: { "x-company-id": "company-a" }, body: JSON.stringify(body) }));
    expect(mocks.execute).toHaveBeenCalledWith("company-a", body, "actor");
  });
  it("bounds unexpected errors and gives an actionable missing-migration error", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Sensitive internal payload"));
    const failed = await GET(); expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain("Sensitive");
    mocks.load.mockRejectedValueOnce({ cause: { code: "42P01", message: "private SQL" } });
    const missing = await GET(); expect(missing.status).toBe(503); expect(await missing.json()).toEqual({ error: "Forecast review storage needs migration. Run pnpm db:migrate and retry." });
  });
});
