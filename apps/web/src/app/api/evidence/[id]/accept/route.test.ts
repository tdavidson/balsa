import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ protect: vi.fn(), context: vi.fn(), accept: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { protect: mocks.protect }, requireCompanyAccess: mocks.context }));
vi.mock("@/lib/evidence-acceptance", async () => ({ ...(await vi.importActual<object>("@/lib/evidence-acceptance")), acceptEvidenceFacts: mocks.accept }));
const { POST } = await import("./route");
const { AcceptanceError } = await import("@/lib/evidence-acceptance");
const id = "00000000-0000-4000-8000-000000000001";
const call = (body: unknown, company = "company-a", evidenceId = id) => POST(new Request(`http://localhost/api/evidence/${evidenceId}/accept`, { method: "POST", headers: { "x-company-id": company }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: evidenceId }) });
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ company: { id: "company-a", role: "member" }, user: { id: "actor" } }); });

describe("evidence acceptance HTTP boundary", () => {
  it("checks the company selection, the evidence ID, and the scope before any write", async () => {
    expect((await call({ scope: "assumed" }, "other")).status).toBe(409);
    expect((await call({ scope: "assumed" }, "company-a", "bad")).status).toBe(400);
    expect((await call({ scope: "everything" })).status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.protect).toHaveBeenCalled();
  });
  it("passes the authorized context and bounds errors", async () => {
    mocks.accept.mockResolvedValue({ accepted: 2 });
    expect(await (await call({ scope: "minor" })).json()).toEqual({ accepted: 2 });
    expect(mocks.accept).toHaveBeenCalledWith(expect.objectContaining({ company: expect.objectContaining({ id: "company-a" }) }), id, "minor");
    mocks.accept.mockRejectedValueOnce(new AcceptanceError("Evidence not found", 404));
    expect((await call({ scope: "assumed" })).status).toBe(404);
    mocks.accept.mockRejectedValueOnce(new Error("sensitive provider response"));
    const failure = await call({ scope: "assumed" });
    expect(failure.status).toBe(500); expect(JSON.stringify(await failure.json())).not.toContain("sensitive");
    mocks.accept.mockRejectedValueOnce({ cause: { code: "42703" } });
    const migration = await call({ scope: "assumed" });
    expect(migration.status).toBe(503); expect(JSON.stringify(await migration.json())).toContain("pnpm db:migrate");
  });
});
