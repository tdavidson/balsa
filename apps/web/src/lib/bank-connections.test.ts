import { config } from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TellerTransport, TellerTransaction } from "./teller";
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!process.env.DATABASE_URL)("Teller synthetic integration", async () => {
  const dbModule = await import("@finance/database");
  const { bankAccounts, bankConnections, bankConnectSessions, chartAccounts, companies, users, getDatabase, closeDatabase, sourceRows, sources, evidence, journalEntries, auditLog } = dbModule;
  const { bankWorkspace, startBankConnect, finishBankConnect, mapBankAccount, syncBankConnection, disconnectBank } = await import("./bank-connections");
  const db = getDatabase(); const companyIds: string[] = []; const userIds: string[] = []; const keys = generateKeyPairSync("ed25519");
  let storage: string;
  beforeAll(async () => { storage = await mkdtemp(join(tmpdir(), "teller-test-")); vi.stubEnv("FILE_STORAGE_PATH", storage); vi.stubEnv("TELLER_APPLICATION_ID", "app_synthetic"); vi.stubEnv("TELLER_ENVIRONMENT", "sandbox"); vi.stubEnv("TELLER_TOKEN_SIGNING_PUBLIC_KEY", keys.publicKey.export({ type: "spki", format: "pem" }).toString()); vi.stubEnv("TELLER_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64")); });
  afterAll(async () => { if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds)); if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)); await closeDatabase(); await rm(storage, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  async function seed() {
    const [company] = await db.insert(companies).values({ name: `Synthetic Teller ${randomUUID()}` }).returning(); companyIds.push(company!.id);
    const [user] = await db.insert(users).values({ authProvider: "fixture", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }).returning(); userIds.push(user!.id);
    const [chart] = await db.insert(chartAccounts).values({ companyId: company!.id, code: "1000", name: "Synthetic cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" }).returning();
    return { companyId: company!.id, userId: user!.id, chartId: chart!.id };
  }
  async function enrollment(f: Awaited<ReturnType<typeof seed>>, enrollmentId = `enr_${randomUUID().replaceAll("-", "")}`) {
    const session = await startBankConnect(f.companyId, f.userId); const token = `token_${randomUUID().replaceAll("-", "")}`;
    const input = { sessionId: session.sessionId, accessToken: token, user: { id: "usr_synthetic" }, enrollment: { id: enrollmentId }, signatures: [sign(null, createHash("sha256").update([session.nonce, token, "usr_synthetic", enrollmentId, "sandbox"].join(".")).digest(), keys.privateKey).toString("base64")] };
    const accountId = `acc_${randomUUID().replaceAll("-", "")}`;
    const account = { id: accountId, enrollment_id: enrollmentId, name: "Synthetic checking", last_four: "0000", currency: "USD", type: "depository", status: "open", institution: { name: "Synthetic Bank" }, links: { transactions: `https://api.teller.io/accounts/${accountId}/transactions` } };
    const transport = vi.fn<TellerTransport>().mockResolvedValue([account]);
    return { input, transport, accountId, account };
  }
  it("connects, maps, syncs exactly once, stages changes and preserves journal/evidence history", async () => {
    const f = await seed(); const e = await enrollment(f); const connection = await finishBankConnect(f.companyId, f.userId, e.input, e.transport);
    await expect(finishBankConnect(f.companyId, f.userId, e.input, e.transport)).rejects.toThrow("verification failed");
    const workspace = await bankWorkspace(f.companyId); expect(JSON.stringify(workspace)).not.toContain(e.input.accessToken);
    expect((await db.select().from(bankConnections).where(eq(bankConnections.id, connection.id)))[0]!.encryptedToken).not.toContain(e.input.accessToken);
    await mapBankAccount(f.companyId, f.userId, workspace.accounts[0]!.id, f.chartId);
    const row: TellerTransaction = { id: "txn_posted", account_id: e.accountId, amount: "25.05", date: "2026-09-15", description: "Synthetic transfer", status: "posted", type: "transfer" };
    let transactions = [row, { ...row, id: "txn_pending", status: "pending" as const }];
    const transport: TellerTransport = async () => transactions;
    expect(await syncBankConnection(f.companyId, connection.id, f.userId, transport)).toEqual({ imports: 1, pending: 1 });
    expect(await syncBankConnection(f.companyId, connection.id, f.userId, transport)).toEqual({ imports: 0, pending: 1 });
    const initial = await db.select().from(sourceRows).where(eq(sourceRows.companyId, f.companyId)); expect(initial).toHaveLength(1); expect(initial[0]).toMatchObject({ amount: "25.05", direction: "spend", status: "staged" });
    transactions = [{ ...row, amount: "26.05" }, { ...row, id: "txn_pending" }];
    expect(await syncBankConnection(f.companyId, connection.id, null, transport)).toEqual({ imports: 1, pending: 0 });
    expect((await db.select().from(sourceRows).where(eq(sourceRows.id, initial[0]!.id)))[0]!.amount).toBe("25.05");
    const files = await db.select().from(sources).where(eq(sources.companyId, f.companyId)); expect(files).toHaveLength(2);
    expect(files.some((file) => JSON.parse(file.metadata).previousSourceId === initial[0]!.sourceId)).toBe(true);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.companyId, f.companyId))).toHaveLength(0);
    expect((await db.select().from(evidence).where(eq(evidence.companyId, f.companyId))).every((doc) => doc.status === "pending")).toBe(true);
    expect(JSON.stringify(await db.select().from(auditLog).where(eq(auditLog.companyId, f.companyId)))).not.toContain(e.input.accessToken);
    const revoke = vi.fn<TellerTransport>().mockResolvedValue(null); await disconnectBank(f.companyId, connection.id, f.userId, revoke);
    expect(revoke.mock.calls[0]?.slice(1)).toEqual(["/accounts", "DELETE"]);
    expect((await db.select().from(bankConnections).where(eq(bankConnections.id, connection.id)))[0]).toMatchObject({ encryptedToken: null, status: "disconnected" });
    expect(await db.select().from(sources).where(eq(sources.companyId, f.companyId))).toHaveLength(2);
  });
  it("rejects foreign sessions, accounts, mappings, sync and disconnect without touching the provider", async () => {
    const a = await seed(); const b = await seed(); const e = await enrollment(a); const foreignTransport = vi.fn<TellerTransport>();
    await expect(finishBankConnect(b.companyId, b.userId, e.input, foreignTransport)).rejects.toThrow("verification failed"); expect(foreignTransport).not.toHaveBeenCalled();
    const connection = await finishBankConnect(a.companyId, a.userId, e.input, e.transport); const [account] = (await bankWorkspace(a.companyId)).accounts;
    await expect(mapBankAccount(a.companyId, a.userId, account!.id, b.chartId)).rejects.toThrow("Select an active");
    await expect(mapBankAccount(b.companyId, b.userId, account!.id, b.chartId)).rejects.toThrow("not found");
    await expect(syncBankConnection(b.companyId, connection.id, b.userId, foreignTransport)).rejects.toThrow("not found");
    await expect(disconnectBank(b.companyId, connection.id, b.userId, foreignTransport)).rejects.toThrow("not found"); expect(foreignTransport).not.toHaveBeenCalled();
    expect((await bankWorkspace(b.companyId)).accounts).toHaveLength(0);
    await expect(db.update(bankAccounts).set({ chartAccountId: b.chartId }).where(eq(bankAccounts.id, account!.id))).rejects.toThrow();
    const duplicate = await enrollment(b, e.input.enrollment.id); await expect(finishBankConnect(b.companyId, b.userId, duplicate.input, duplicate.transport)).rejects.toThrow();
    expect((await bankWorkspace(a.companyId)).connections).toHaveLength(1);
    expect((await bankWorkspace(b.companyId)).connections).toHaveLength(0);
  });
  it("rolls back malformed or incomplete syncs and rejects expired enrollment sessions", async () => {
    const f = await seed(); const e = await enrollment(f);
    await db.update(bankConnectSessions).set({ expiresAt: new Date(0) }).where(and(eq(bankConnectSessions.companyId, f.companyId), eq(bankConnectSessions.id, e.input.sessionId)));
    await expect(finishBankConnect(f.companyId, f.userId, e.input, e.transport)).rejects.toThrow("verification failed");
    const fresh = await enrollment(f); const connection = await finishBankConnect(f.companyId, f.userId, fresh.input, fresh.transport);
    await mapBankAccount(f.companyId, f.userId, (await bankWorkspace(f.companyId)).accounts[0]!.id, f.chartId);
    await expect(syncBankConnection(f.companyId, connection.id, f.userId, async () => [{ id: "invalid" }])).rejects.toThrow();
    expect(await db.select().from(sources).where(eq(sources.companyId, f.companyId))).toHaveLength(0);
    expect((await bankWorkspace(f.companyId)).connections[0]!.lastSyncedAt).toBeNull();
    await expect(disconnectBank(f.companyId, connection.id, f.userId, async () => { throw new Error("synthetic transport failure"); })).rejects.toThrow();
    expect((await db.select().from(bankConnections).where(eq(bankConnections.id, connection.id)))[0]!.encryptedToken).toBeTruthy();
  });
  it("authenticates and deduplicates webhook delivery, then pauses disconnected enrollments", async () => {
    const f = await seed(); const e = await enrollment(f); const connection = await finishBankConnect(f.companyId, f.userId, e.input, e.transport);
    const { POST } = await import("@/app/api/banks/webhook/route");
    vi.stubEnv("TELLER_WEBHOOK_SECRET", "synthetic-webhook-secret");
    const event = { id: `wh_${randomUUID()}`, type: "transactions.processed", payload: { enrollment_id: e.input.enrollment.id } };
    function request(value: typeof event, signed = true) {
      const body = JSON.stringify(value); const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", "synthetic-webhook-secret").update(`${timestamp}.${body}`).digest("hex");
      return new Request("http://localhost/api/banks/webhook", { method: "POST", body, headers: signed ? { "teller-signature": `t=${timestamp},v1=${signature}` } : {} });
    }
    expect((await POST(request(event, false))).status).toBe(401);
    expect((await POST(request(event))).status).toBe(200); expect((await POST(request(event))).status).toBe(200);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.companyId, f.companyId), eq(auditLog.action, "bank.webhook")))).toHaveLength(1);
    expect((await POST(request({ ...event, id: `wh_${randomUUID()}`, type: "enrollment.disconnected" }))).status).toBe(200);
    expect((await bankWorkspace(f.companyId)).connections[0]).toMatchObject({ id: connection.id, status: "reconnect" });
  });
  it("installs RLS on every bank table", async () => {
    const tables = await db.execute(sql`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('bank_connections', 'bank_accounts', 'bank_connect_sessions')`);
    expect(tables).toHaveLength(3); expect(tables.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);
  });
});
