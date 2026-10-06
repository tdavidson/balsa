import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  context: vi.fn(),
  execute: vi.fn(),
  workspace: vi.fn(),
  outcome: vi.fn(),
  review: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: { protect: mocks.protect },
  requireCompanyAccess: mocks.context,
}));
vi.mock("@/lib/operating-outcomes", () => ({
  executeOperatingOutcome: mocks.execute,
  loadOperatingOutcomeWorkspace: mocks.workspace,
  loadOperatingOutcome: mocks.outcome,
  loadOperatingOutcomeReview: mocks.review,
}));
const { GET, POST } = await import("./route");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({
    company: { id: "company-a" },
    user: { id: "actor" },
  });
});
describe("operating outcome HTTP boundary", () => {
  it("requires current company selection before a mutation", async () => {
    const r = await POST(
      new Request("http://localhost/api/operating-outcomes", {
        method: "POST",
        headers: { "x-company-id": "company-b" },
        body: "{}",
      }),
    );
    expect(r.status).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.protect).toHaveBeenCalledOnce();
  });
  it("bounds requests and validates selections", async () => {
    for (const [body, status] of [
      ["x".repeat(12001), 413],
      ["{", 400],
    ] as const) {
      const r = await POST(
        new Request("http://localhost/api/operating-outcomes", {
          method: "POST",
          headers: { "x-company-id": "company-a" },
          body,
        }),
      );
      expect(r.status).toBe(status);
    }
    expect(
      (
        await GET(
          new Request("http://localhost/api/operating-outcomes?id=invalid"),
        )
      ).status,
    ).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("uses authorized scope for both current and preserved reviews", async () => {
    const id = "12345678-1234-4234-8234-123456789abc";
    mocks.outcome.mockResolvedValue({ companyId: "company-a" });
    mocks.review.mockResolvedValue({ companyId: "company-a" });
    await GET(new Request(`http://localhost/api/operating-outcomes?id=${id}`));
    expect(mocks.outcome).toHaveBeenCalledWith("company-a", id);
    await GET(
      new Request(`http://localhost/api/operating-outcomes?review=${id}`),
    );
    expect(mocks.review).toHaveBeenCalledWith("company-a", id);
    const body = { action: "preserve", companyId: "untrusted" };
    mocks.execute.mockResolvedValue({ companyId: "company-a" });
    await POST(
      new Request("http://localhost/api/operating-outcomes", {
        method: "POST",
        headers: { "x-company-id": "company-a" },
        body: JSON.stringify(body),
      }),
    );
    expect(mocks.execute).toHaveBeenCalledWith("company-a", body, "actor");
  });
  it("reports migration requirements and redacts unexpected errors", async () => {
    mocks.workspace.mockRejectedValueOnce({
      cause: { code: "42P01", message: "private SQL" },
    });
    const missing = await GET(
      new Request("http://localhost/api/operating-outcomes"),
    );
    expect(missing.status).toBe(503);
    expect((await missing.json()).error).toContain("pnpm db:migrate");
    mocks.workspace.mockRejectedValueOnce(new Error("secret payload"));
    const failed = await GET(
      new Request("http://localhost/api/operating-outcomes"),
    );
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain("secret");
  });
  it("validates and scopes outcome selection to a preserved experiment", async () => {
    expect((await GET(new Request("http://localhost/api/operating-outcomes?experiment=bad"))).status).toBe(400);
    const id = "00000000-0000-4000-8000-000000000001";
    mocks.workspace.mockResolvedValue({ companyId: "company-a", predictions: [] });
    await GET(new Request(`http://localhost/api/operating-outcomes?experiment=${id}`));
    expect(mocks.workspace).toHaveBeenCalledWith("company-a", id);
  });

});
