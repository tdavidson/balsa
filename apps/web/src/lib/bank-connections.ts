import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { bankAccounts, bankConnections, bankConnectSessions, chartAccounts, evidence, factRecords, getDatabase, recordAudit, sourceRows, sources, withCompanyTransaction, type CompanyTransaction } from "@finance/database";
import { storeSourceBlob } from "./blob-store";
import { accountSchema, BankError, enrollmentSchema, fetchTransactions, normalizedBankRow, openToken, sealToken, tellerConfig, tellerRequest, verifyEnrollment, type TellerTransport } from "./teller";

const scope = (companyId: string, id: string) => and(eq(bankConnections.companyId, companyId), eq(bankConnections.id, id));
const credentialContext = (companyId: string, enrollmentId: string) => `${companyId}:${enrollmentId}`;
async function lock(tx: CompanyTransaction, companyId: string) { await tx.execute(sql`select pg_advisory_xact_lock(7410, hashtext(${companyId}))`); }
async function audit(tx: CompanyTransaction, companyId: string, actorUserId: string | null, id: string, action: string, summary: string) {
  await recordAudit(tx, { companyId, actorUserId, via: actorUserId ? "ui" : "worker", action, entityType: "bank_connection", entityId: id, summary });
}
function assertInstallation(connection: typeof bankConnections.$inferSelect) {
  const config = tellerConfig();
  if (connection.environment !== config.environment || connection.applicationId !== config.applicationId) throw new BankError("This connection belongs to a different Teller environment or application. Restore its environment configuration to manage it.", 409);
}
export async function bankWorkspace(companyId: string) {
  let configurationError: string | null = null; let environment = "sandbox";
  try { environment = tellerConfig().environment; } catch (error) { configurationError = error instanceof BankError ? error.message : "Check Teller configuration."; }
  return withCompanyTransaction(getDatabase(), companyId, async (tx) => {
    const connections = await tx.select({ id: bankConnections.id, enrollmentId: bankConnections.enrollmentId, institution: bankConnections.institution, environment: bankConnections.environment, status: bankConnections.status, lastSyncedAt: bankConnections.lastSyncedAt, error: bankConnections.error }).from(bankConnections).where(eq(bankConnections.companyId, companyId));
    const accounts = await tx.select().from(bankAccounts).where(eq(bankAccounts.companyId, companyId));
    const ledgerAccounts = await tx.select({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name, accountType: chartAccounts.accountType, statementLine: chartAccounts.statementLine }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y")));
    return { companyId, environment, configurationError, connections, accounts, ledgerAccounts };
  });
}
export async function startBankConnect(companyId: string, userId: string) {
  const config = tellerConfig();
  return withCompanyTransaction(getDatabase(), companyId, async (tx) => {
    await tx.delete(bankConnectSessions).where(and(eq(bankConnectSessions.companyId, companyId), lt(bankConnectSessions.expiresAt, new Date())));
    const [session] = await tx.insert(bankConnectSessions).values({ companyId, userId, nonce: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 10 * 60_000) }).returning();
    return { sessionId: session!.id, nonce: session!.nonce, applicationId: config.applicationId, environment: config.environment };
  });
}
export async function finishBankConnect(companyId: string, userId: string, input: unknown, transport: TellerTransport = tellerRequest) {
  const parsed = enrollmentSchema.safeParse(input); if (!parsed.success) throw new BankError("Invalid bank enrollment response.");
  const data = parsed.data; const config = tellerConfig();
  return withCompanyTransaction(getDatabase(), companyId, async (tx) => {
    await lock(tx, companyId);
    const [session] = await tx.select().from(bankConnectSessions).where(and(eq(bankConnectSessions.companyId, companyId), eq(bankConnectSessions.userId, userId), eq(bankConnectSessions.id, data.sessionId)));
    if (!session || session.expiresAt < new Date() || !verifyEnrollment(session.nonce, data)) throw new BankError("Bank connection verification failed. Start Connect bank again.", 403);
    const accounts = z.array(accountSchema).min(1).max(100).parse(await transport(data.accessToken, "/accounts"));
    if (accounts.some((account) => account.enrollment_id !== data.enrollment.id)) throw new BankError("Bank enrollment did not match its accounts.", 403);
    const [existing] = await tx.select().from(bankConnections).where(and(eq(bankConnections.companyId, companyId), eq(bankConnections.enrollmentId, data.enrollment.id), eq(bankConnections.environment, config.environment), eq(bankConnections.applicationId, config.applicationId)));
    const values = { encryptedToken: sealToken(data.accessToken, credentialContext(companyId, data.enrollment.id)), institution: accounts[0]!.institution.name, status: "active", error: null, nextSyncAt: new Date(), updatedAt: new Date() };
    const [connection] = existing ? await tx.update(bankConnections).set(values).where(scope(companyId, existing.id)).returning() : await tx.insert(bankConnections).values({ ...values, companyId, enrollmentId: data.enrollment.id, environment: config.environment, applicationId: config.applicationId, createdByUserId: userId }).returning();
    // An enrollment is globally unique per installation/environment. A foreign company's enrollment cannot be reassigned.
    await tx.update(bankAccounts).set({ status: "closed", updatedAt: new Date() }).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.connectionId, connection!.id)));
    for (const account of accounts) {
      const value = { name: account.name, lastFour: account.last_four, currency: account.currency, accountType: account.type, status: account.links?.transactions ? account.status : "unsupported", updatedAt: new Date() };
      await tx.insert(bankAccounts).values({ ...value, companyId, connectionId: connection!.id, providerAccountId: account.id }).onConflictDoUpdate({ target: [bankAccounts.connectionId, bankAccounts.providerAccountId], set: value });
    }
    await tx.delete(bankConnectSessions).where(and(eq(bankConnectSessions.companyId, companyId), eq(bankConnectSessions.id, session.id)));
    await audit(tx, companyId, userId, connection!.id, "bank.connected", "Connected bank accounts through Teller.");
    return { id: connection!.id };
  });
}
export async function mapBankAccount(companyId: string, userId: string, accountId: string, chartAccountId: string | null) {
  return withCompanyTransaction(getDatabase(), companyId, async (tx) => {
    await lock(tx, companyId);
    const [account] = await tx.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.id, accountId)));
    if (!account) throw new BankError("Bank account not found.", 404);
    if (chartAccountId) {
      const [chart] = await tx.select().from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.id, chartAccountId), eq(chartAccounts.active, "Y")));
      if (!chart || chart.accountType !== (account.accountType === "credit" ? "liability" : "asset") || (account.accountType === "depository" && !/cash/i.test(`${chart.statementLine ?? ""} ${chart.name}`))) throw new BankError("Select an active cash asset for a bank account, or a liability for a credit card.");
      const identifier = `teller:${account.providerAccountId}`;
      if (chart.bankAccountIdentifier && chart.bankAccountIdentifier !== identifier) throw new BankError("This ledger account already maps to another bank identifier. Review that mapping first.", 409);
      const [other] = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.chartAccountId, chartAccountId), ne(bankAccounts.id, accountId)));
      if (other) throw new BankError("This ledger account already maps to another connected bank account.", 409);
      if (account.chartAccountId && account.chartAccountId !== chartAccountId) throw new BankError("Unmap the existing ledger account before choosing a replacement.", 409);
      await tx.update(chartAccounts).set({ bankAccountIdentifier: identifier, updatedAt: new Date() }).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.id, chartAccountId)));
    } else if (account.chartAccountId) {
      await tx.update(chartAccounts).set({ bankAccountIdentifier: null, updatedAt: new Date() }).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.id, account.chartAccountId), eq(chartAccounts.bankAccountIdentifier, `teller:${account.providerAccountId}`)));
    }
    await tx.update(bankAccounts).set({ chartAccountId, updatedAt: new Date() }).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.id, accountId)));
    await tx.update(bankConnections).set({ nextSyncAt: new Date() }).where(scope(companyId, account.connectionId));
    await audit(tx, companyId, userId, account.connectionId, "bank.mapped", chartAccountId ? "Mapped a bank account to the ledger." : "Paused imports for an unmapped bank account.");
  });
}
export async function syncBankConnection(companyId: string, id: string, actorUserId: string | null, transport: TellerTransport = tellerRequest) {
  try {
    return await withCompanyTransaction(getDatabase(), companyId, async (tx) => {
      await lock(tx, companyId);
      const [connection] = await tx.select().from(bankConnections).where(scope(companyId, id));
      if (!connection || !connection.encryptedToken) throw new BankError("Bank connection not found.", 404);
      assertInstallation(connection);
      if (connection.status === "disconnecting") throw new BankError("Finish disconnecting this bank before syncing.", 409);
      const token = openToken(connection.encryptedToken, credentialContext(companyId, connection.enrollmentId));
      const accounts = await tx.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.connectionId, id), eq(bankAccounts.status, "open")));
      let imports = 0; let pending = 0; const started = Date.now();
      for (const account of accounts) {
        if (!account.chartAccountId) continue;
        if (Date.now() - started > 40_000) throw new BankError("Bank sync exceeded its time limit. No partial import was saved.", 422);
        const [chart] = await tx.select().from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.id, account.chartAccountId), eq(chartAccounts.active, "Y")));
        if (!chart) throw new BankError("A mapped ledger account is inactive. Update the bank mapping.", 409);
        const transactions = await fetchTransactions(token, account.providerAccountId, transport, started + 40_000);
        pending += transactions.filter((row) => row.status === "pending").length;
        const posted = transactions.filter((row) => row.status === "posted");
        const months = [...new Set(posted.map((row) => row.date.slice(0, 7)))].sort();
        const snapshots = { ...account.snapshots };
        for (const month of months) {
          const rows = posted.filter((row) => row.date.startsWith(month)).sort((a, b) => a.id.localeCompare(b.id));
          if (rows.length > 1000) throw new BankError("A bank month exceeds the 1,000-row review limit. No partial import was saved.", 422);
          const rawText = JSON.stringify({ version: "teller-v1", chartAccountId: chart.id, currency: account.currency, rows });
          const bytes = Buffer.from(rawText);
          const hash = createHash("sha256").update(bytes).digest("hex");
          if (snapshots[month]?.hash === hash) continue;
          const previousSourceId = snapshots[month]?.sourceId ?? null;
          const name = `${connection.institution} · ${account.name} ${account.lastFour ?? ""} · ${month}`;
          const storageReference = await storeSourceBlob(companyId, hash, bytes);
          const facts = rows.map((row) => ({ label: `${row.description} (${row.id})`, value: `${normalizedBankRow(row).amount} ${account.currency}; ${normalizedBankRow(row).direction}; ${row.date}`, accountingRole: "unknown", confidence: 1, sourceLocation: `teller:${account.providerAccountId}:${row.id}` }));
          const extraction = { summary: "Posted bank feed transactions. Review account ownership, overlap with other imports, and accounting treatment before posting. This feed does not establish opening or closing balances.", facts, questions: [] };
          const [source] = await tx.insert(sources).values({ companyId, type: "teller", filename: `${name}.json`, mimeType: "application/json", storageReference, byteSize: String(bytes.length), hash, ingestionStatus: "staged", processedAt: new Date(), metadata: JSON.stringify({ provider: "teller", adapterVersion: "teller-v1", environment: connection.environment, accountId: account.providerAccountId, chartAccountId: chart.id, previousSourceId, period: month, importedAt: new Date().toISOString(), limitations: ["Provider history is not a complete bank statement.", "Review overlap with prior feeds and uploaded statements before posting."] }) }).returning();
          const [doc] = await tx.insert(evidence).values({ companyId, sourceId: source!.id, createdByUserId: connection.createdByUserId, sourceName: name, reportingMonth: month, currency: account.currency, sourceMime: "application/json", sourceHash: hash, accountIdentifier: `teller:${account.providerAccountId}`, accountEntityId: chart.entityId, statementPeriodStart: `${month}-01`, statementPeriodEnd: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10), rawText, extractedJson: JSON.stringify(extraction) }).returning();
          const storedFacts = await tx.insert(factRecords).values(facts.map((fact) => ({ ...fact, confidence: "1", companyId, evidenceId: doc!.id, currency: account.currency, status: "pending" }))).returning();
          await tx.insert(sourceRows).values(rows.map((row) => ({ ...normalizedBankRow(row), factId: storedFacts.find((fact) => fact.sourceLocation === `teller:${account.providerAccountId}:${row.id}`)!.id, companyId, sourceId: source!.id, evidenceId: doc!.id, sourceType: "teller", currency: account.currency, accountName: `teller:${account.providerAccountId}` })));
          snapshots[month] = { hash, sourceId: source!.id }; imports++;
        }
        await tx.update(bankAccounts).set({ snapshots, updatedAt: new Date() }).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.id, account.id)));
      }
      await tx.update(bankConnections).set({ lastSyncedAt: new Date(), nextSyncAt: new Date(Date.now() + 6 * 3600_000), status: "active", error: null, updatedAt: new Date() }).where(scope(companyId, id));
      await audit(tx, companyId, actorUserId, id, "bank.synced", `Synced bank: ${imports} changed monthly imports staged; ${pending} pending transactions excluded.`);
      return { imports, pending };
    });
  } catch (error) {
    if (!(error instanceof BankError && error.status === 404)) await withCompanyTransaction(getDatabase(), companyId, async (tx) => {
      // Never resurrect a connection that was disconnected while this sync failed.
      await lock(tx, companyId);
      await tx.update(bankConnections).set({ error: error instanceof BankError ? error.message : "Bank sync failed. Check configuration and retry; no partial imports were saved.", nextSyncAt: new Date(Date.now() + 3600_000), updatedAt: new Date() }).where(and(scope(companyId, id), ne(bankConnections.status, "disconnected")));
      await audit(tx, companyId, actorUserId, id, "bank.sync_failed", "Bank sync failed; existing imports and journals were preserved.");
    });
    throw error;
  }
}
export async function disconnectBank(companyId: string, id: string, userId: string, transport: TellerTransport = tellerRequest) {
  return withCompanyTransaction(getDatabase(), companyId, async (tx) => {
    await lock(tx, companyId);
    const [connection] = await tx.select().from(bankConnections).where(scope(companyId, id));
    if (!connection) throw new BankError("Bank connection not found.", 404);
    if (!connection.encryptedToken) return;
    assertInstallation(connection);
    await transport(openToken(connection.encryptedToken, credentialContext(companyId, connection.enrollmentId)), "/accounts", "DELETE");
    await tx.update(bankConnections).set({ encryptedToken: null, status: "disconnected", error: null, updatedAt: new Date() }).where(scope(companyId, id));
    await audit(tx, companyId, userId, id, "bank.disconnected", "Revoked Teller enrollment and removed stored credentials; retained import history.");
  });
}
export async function dueBankConnections() {
  // Privileged scheduler discovery, like the reconciliation queue. Each job then enters company scope.
  const config = tellerConfig();
  return getDatabase().select({ id: bankConnections.id, companyId: bankConnections.companyId }).from(bankConnections).where(and(eq(bankConnections.environment, config.environment), eq(bankConnections.applicationId, config.applicationId), eq(bankConnections.status, "active"), lt(bankConnections.nextSyncAt, new Date()))).orderBy(asc(bankConnections.nextSyncAt)).limit(1);
}
