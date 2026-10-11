import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ protect: vi.fn(), context: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { protect: mocks.protect }, requireCompanyAccess: mocks.context }));
vi.mock("@finance/database", () => ({ companies: {}, recordAudit: vi.fn(), getDatabase: () => ({ transaction: mocks.transaction }) }));
const { PATCH } = await import("./route");
const call = (body: unknown, company = "company-a") => PATCH(new Request("http://localhost/api/review-policy", { method: "PATCH", headers: { "x-company-id": company }, body: JSON.stringify(body) }));
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ company: { id: "company-a", role: "owner" }, user: { id: "actor" } }); });

describe("review policy HTTP boundary", () => {
  it("lets only the owner of the selected company change it", async () => {
    expect((await call({ confidenceThreshold: 0.9 }, "other")).status).toBe(409);
    mocks.context.mockResolvedValue({ company: { id: "company-a", role: "member" }, user: { id: "actor" } });
    expect((await call({ confidenceThreshold: 0.9 })).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects levels below the floor or above certainty", async () => {
    for (const confidenceThreshold of [0.2, 1.5, "0.9"]) expect((await call({ confidenceThreshold })).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("stores a level or always-ask and reports a missing migration", async () => {
    mocks.transaction.mockResolvedValueOnce(null);
    expect(await (await call({ confidenceThreshold: 0.9 })).json()).toMatchObject({ confidenceThreshold: 0.9, previous: null });
    mocks.transaction.mockResolvedValueOnce("0.9");
    expect(await (await call({ confidenceThreshold: null })).json()).toMatchObject({ confidenceThreshold: null, previous: 0.9 });
    mocks.transaction.mockRejectedValueOnce({ cause: { code: "42703" } });
    expect((await call({ confidenceThreshold: 0.8 })).status).toBe(503);
  });
});
