import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ protect: vi.fn(), context: vi.fn(), compare: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { protect: mocks.protect }, requireCompanyAccess: mocks.context }));
vi.mock("@/lib/goal-reviews", () => ({ inspectGoalComparison: mocks.compare, GoalReviewError: class extends Error {} }));
const { GET } = await import("./route");
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ company: { id: "authorized-company" } }); });
describe("goal comparison HTTP boundary", () => {
  it("requires a baseline UUID and a reviewed preview", async () => {
    for (const query of ["", "?baseline=invalid&preview=bad", `?baseline=${randomUUID()}`]) expect((await GET(new Request(`http://localhost/api/goal-review/bridge${query}`))).status).toBe(400);
    expect(mocks.compare).not.toHaveBeenCalled(); expect(mocks.protect).toHaveBeenCalledTimes(3);
  });
  it("uses authorized company scope rather than a supplied company", async () => {
    const baseline = randomUUID(); const preview = "a".repeat(64); mocks.compare.mockResolvedValue({ bridge: {} });
    const response = await GET(new Request(`http://localhost/api/goal-review/bridge?baseline=${baseline}&preview=${preview}&companyId=foreign`));
    expect(response.status).toBe(200); expect(mocks.compare).toHaveBeenCalledWith("authorized-company", baseline, preview);
  });
  it("bounds unexpected errors", async () => {
    mocks.compare.mockRejectedValue(new Error("Sensitive database payload"));
    const response = await GET(new Request(`http://localhost/api/goal-review/bridge?baseline=${randomUUID()}&preview=${"a".repeat(64)}`));
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("Sensitive");
  });
});
