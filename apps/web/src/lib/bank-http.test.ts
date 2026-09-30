import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyRoleRequiredError } from "@finance/auth";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), workspace: vi.fn(), sync: vi.fn(), connect: vi.fn(), map: vi.fn(), disconnect: vi.fn(), due: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireOwner: mocks.owner }));
vi.mock("@/lib/bank-connections", () => ({ bankWorkspace: mocks.workspace, syncBankConnection: mocks.sync, finishBankConnect: mocks.connect, mapBankAccount: mocks.map, disconnectBank: mocks.disconnect, dueBankConnections: mocks.due }));
import { GET, POST } from "@/app/api/banks/route";
import { GET as job } from "@/app/api/jobs/banks/route";
import { bankErrorResponse } from "./bank-http";
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("bank HTTP authorization", () => {
  it("does not run a bank action for non-owners", async () => {
    mocks.owner.mockRejectedValue(new CompanyRoleRequiredError("owner"));
    expect((await GET()).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/banks", { method: "POST", body: '{}' }))).status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("takes company and user from authorization, never the payload", async () => {
    mocks.owner.mockResolvedValue({ company: { id: "company-a" }, user: { id: "user-a" } }); mocks.sync.mockResolvedValue({ imports: 0 });
    const id = "00000000-0000-4000-8000-000000000001";
    const response = await POST(new Request("http://localhost/api/banks", { method: "POST", body: JSON.stringify({ action: "sync", id, companyId: "company-b" }) }));
    expect(response.status).toBe(200); expect(mocks.sync).toHaveBeenCalledWith("company-a", id, "user-a");
  });
  it("bounds bodies, rejects invalid IDs and sanitizes provider/storage errors", async () => {
    mocks.owner.mockResolvedValue({ company: { id: "company-a" }, user: { id: "user-a" } });
    expect((await POST(new Request("http://localhost/api/banks", { method: "POST", body: 'x'.repeat(17_000) }))).status).toBe(413);
    expect((await POST(new Request("http://localhost/api/banks", { method: "POST", body: '{"action":"sync","id":"not-an-id"}' }))).status).toBe(400);
    expect(JSON.stringify(await bankErrorResponse(new Error("token_private raw provider stack")).json())).not.toContain("token_private");
    expect((await bankErrorResponse({ cause: { code: "42P01" } }).json()).error).toContain("pnpm db:migrate");
  });
  it("requires cron credentials before discovering any bank connections", async () => {
    vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
    expect((await job(new Request("http://localhost/api/jobs/banks"))).status).toBe(401); expect(mocks.due).not.toHaveBeenCalled();
    vi.stubEnv("TELLER_APPLICATION_ID", "");
    expect(await (await job(new Request("http://localhost/api/jobs/banks", { headers: { authorization: "Bearer synthetic-cron-secret" } }))).json()).toEqual({ enabled: false, synced: 0 });
  });
});
