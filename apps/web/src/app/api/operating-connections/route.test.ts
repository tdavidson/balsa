import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  protect: vi.fn(),
  context: vi.fn(),
  execute: vi.fn(),
  load: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: { protect: mocks.protect },
  requireCompanyAccess: mocks.context,
}));
vi.mock("@/lib/operating-connections", () => ({
  executeOperatingConnection: mocks.execute,
  loadOperatingConnections: mocks.load,
}));
const { GET, POST } = await import("./route");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({
    company: { id: "company-a" },
    user: { id: "actor" },
  });
});
describe("operating-connections HTTP boundary", () => {
  it("checks company selection before a write", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/operating-connections", {
            method: "POST",
            headers: { "x-company-id": "other" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.protect).toHaveBeenCalled();
  });
  it("bounds request sizes and rejects malformed JSON", async () => {
    for (const [body, status] of [
      ["x".repeat(100001), 413],
      ["{", 400],
    ] as const)
      expect(
        (
          await POST(
            new Request("http://localhost/api/operating-connections", {
              method: "POST",
              headers: { "x-company-id": "company-a" },
              body,
            }),
          )
        ).status,
      ).toBe(status);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("uses authorized company and actor and bounds errors", async () => {
    mocks.execute.mockResolvedValue({ companyId: "company-a" });
    await POST(
      new Request("http://localhost/api/operating-connections", {
        method: "POST",
        headers: { "x-company-id": "company-a" },
        body: JSON.stringify({ action: "preview", companyId: "other" }),
      }),
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      "company-a",
      { action: "preview", companyId: "other" },
      "actor",
    );
    mocks.load.mockRejectedValueOnce(new Error("sensitive provider response"));
    const error = await GET();
    expect(error.status).toBe(500);
    expect(JSON.stringify(await error.json())).not.toContain("sensitive");
    mocks.load.mockRejectedValueOnce({ cause: { code: "42P01" } });
    const migration = await GET();
    expect(migration.status).toBe(503);
    expect(JSON.stringify(await migration.json())).toContain("pnpm db:migrate");
  });
  it("scopes connection reads to the authorized company", async () => {
    mocks.load.mockResolvedValue({ companyId: "company-a", connected: [] });
    await GET();
    expect(mocks.load).toHaveBeenCalledWith("company-a");
  });
});
