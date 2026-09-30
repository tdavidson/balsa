import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { ImportPreview } from "./import-review";
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!process.env.DATABASE_URL)("financial import reviews", async () => {
  const { auditLog, chartAccounts, closeDatabase, companies, evidence, financialImportReviews, getDatabase, journalEntries, postingProposals, reportingPeriods, sourceRows, sources, users } = await import("@finance/database");
  const { executeImportReview: execute, loadImportReview } = await import("./import-review");
  const { postApprovedJournal } = await import("./journal-posting");
  const db = getDatabase(); const ids: string[] = []; const userIds: string[] = []; const now = new Date("2026-09-25T12:00:00Z");
  async function seed() {
    const [company] = await db.insert(companies).values({ name: `Synthetic import ${randomUUID()}` }).returning(); const id = company!.id; ids.push(id);
    const [user] = await db.insert(users).values({ authProvider: "fixture", authProviderUserId: randomUUID(), email: `${randomUUID()}@example.invalid` }).returning(); userIds.push(user!.id);
    const accounts = await db.insert(chartAccounts).values([{ companyId: id, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash", bankAccountIdentifier: "synthetic-bank" }, { companyId: id, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" }]).returning();
    async function file(amounts: [string, string][], posted = false) {
      const [source] = await db.insert(sources).values({ companyId: id, type: "bank_statement", filename: "Synthetic statement.csv", metadata: JSON.stringify({ classification: { kind: "bank_statement" } }) }).returning();
      const [doc] = await db.insert(evidence).values({ companyId: id, createdByUserId: user!.id, sourceId: source!.id, sourceName: "Synthetic statement", rawText: "Synthetic fixture", status: "approved", identityStatus: "approved", accountIdentifier: "synthetic-bank", currency: "USD", statementPeriodStart: "2026-09-01", statementPeriodEnd: "2026-09-30", openingBalance: "0", endingBalance: "100" }).returning();
      for (const [key, amount] of amounts) {
        const [row] = await db.insert(sourceRows).values({ companyId: id, sourceId: source!.id, evidenceId: doc!.id, sourceKey: key, sourceType: "csv", rowType: "cash_event", period: "2026-09", transactionDate: "2026-09-10", description: `Synthetic ${key}`, amount, currency: "USD", direction: "receipt", accountName: "Cash", rawJson: "{}", status: "approved" }).returning();
        const request = { idempotencyKey: randomUUID(), label: `Synthetic ${key}`, source: "bank_statement", postingDate: "2026-09-10", period: "2026-09", memo: `Synthetic ${key}`, sourceId: source!.id, sourceRowId: row!.id, evidenceId: doc!.id, deferRefresh: true, lines: [{ accountId: accounts[0]!.id, currency: "USD", debitMinor: String(BigInt(amount) * 100n), creditMinor: "0" }, { accountId: accounts[1]!.id, currency: "USD", debitMinor: "0", creditMinor: String(BigInt(amount) * 100n) }] };
        if (posted) await postApprovedJournal(id, request); else await db.insert(postingProposals).values({ companyId: id, sourceId: source!.id, sourceRowId: row!.id, evidenceId: doc!.id, externalKey: request.idempotencyKey, proposalJson: JSON.stringify(request), rationale: "Synthetic reviewed proposal", confidence: "1", status: "approved" });
      }
      return source!.id;
    }
    return { id, file, cashId: accounts[0]!.id };
  }
  async function preview(id: string, sourceId: string, previousSourceId: string | null = null) { return await execute(id, { action: "preview", sourceId, previousSourceId }, null, now) as ImportPreview; }
  const command = (view: ImportPreview, action = "approve") => ({ action, sourceId: view.sourceId, previousSourceId: view.previousSourceId, mode: view.mode, rowMappings: view.rowMappings, previewToken: view.previewToken, name: "Synthetic import review", reason: "Reviewed complete synthetic scope", acknowledgeLimitations: true, requestKey: randomUUID() });
  afterAll(async () => { if (ids.length) await db.delete(companies).where(inArray(companies.id, ids)); if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)); await closeDatabase(); });
  it("rolls back preview journals and audit, then approves the same cash effects exactly once", async () => {
    const f = await seed(); const source = await f.file([["a", "100"]]); const view = await preview(f.id, source);
    expect(view.blockers).toEqual([]); expect(view.after).not.toBeNull();
    expect(await db.select().from(journalEntries).where(eq(journalEntries.companyId, f.id))).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.companyId, f.id))).toHaveLength(0);
    const request = command(view); const result = await execute(f.id, request, null, now) as { savedId: string };
    expect(await execute(f.id, request, null, now)).toMatchObject({ savedId: result.savedId, reused: true });
    const saved = await loadImportReview(f.id, result.savedId);
    expect(saved.snapshot.appliedOutlook?.output.months).toEqual(view.after?.output.months);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.companyId, f.id))).toHaveLength(1);
  });
  it("requires Teller updates to compare their lineage as partial history", async () => {
    const f = await seed(); const old = await f.file([["a", "100"]], true); const incoming = await f.file([["a", "125"]]);
    await db.update(sources).set({ type: "teller", metadata: JSON.stringify({ provider: "teller", previousSourceId: old }) }).where(eq(sources.id, incoming));
    const standalone = await preview(f.id, incoming);
    expect(standalone.blockers).toContain("Compare this bank update with its previous feed import before approving it.");
    const full = await preview(f.id, incoming, old);
    expect(full.blockers).toContain("Bank feeds are partial history, not complete statements. Use partial update and explicitly review row identity mappings.");
    expect(await db.select().from(journalEntries).where(eq(journalEntries.companyId, f.id))).toHaveLength(1);
  });
  it("retains duplicates, reverses changed and removed rows, and preserves the saved comparison", async () => {
    const f = await seed(); const old = await f.file([["a", "100"], ["b", "200"], ["c", "300"]], true); const incoming = await f.file([["a", "100"], ["b", "250"], ["d", "400"]]);
    const view = await preview(f.id, incoming, old); expect(view.blockers).toEqual([]);
    expect(view.rows.map((row) => row.kind)).toEqual(["duplicate", "corrected", "removed", "new"]); expect(view.reversalCount).toBe(2); expect(view.postingCount).toBe(2);
    const [before] = await db.select().from(sources).where(eq(sources.id, old)); expect(JSON.parse(before!.metadata).financialReviewSupersededBy).toBeUndefined();
    const result = await execute(f.id, command(view), null, now) as { savedId: string }; const saved = await loadImportReview(f.id, result.savedId);
    expect(saved.snapshot.appliedOutlook?.output.months).toEqual(view.after?.output.months);
    const control = (value: NonNullable<ImportPreview["after"]>["openingCash"]) => value ? { status: value.status, reasons: value.reasons, accounts: value.accounts, ledgerCashMinor: value.ledgerCashMinor } : null;
    expect(control(saved.snapshot.appliedOutlook?.openingCash)).toEqual(control(view.after?.openingCash));
    expect(saved.snapshot.entryIds).toHaveLength(4);
    const rows = await db.select().from(sourceRows).where(eq(sourceRows.sourceId, incoming)); expect(rows.find((row) => row.sourceKey === "a")?.status).toBe("duplicate");
    expect((await preview(f.id, incoming, old)).blockers.join(" ")).toContain("already superseded");
    expect((await loadImportReview(f.id, result.savedId)).snapshot.preview.rows).toEqual(view.rows);
  });
  it("rejects stale and foreign approvals and preserves blocked evaluations without posting", async () => {
    const f = await seed(); const source = await f.file([["a", "100"]]); const view = await preview(f.id, source);
    await db.update(evidence).set({ identityStatus: "pending" }).where(eq(evidence.sourceId, source));
    await expect(execute(f.id, command(view), null, now)).rejects.toMatchObject({ status: 409 });
    const blocked = await preview(f.id, source); expect(blocked.after).toBeNull(); expect(blocked.blockers.length).toBeGreaterThan(0);
    await expect(execute(f.id, command(blocked), null, now)).rejects.toMatchObject({ status: 422 });
    const result = await execute(f.id, command(blocked, "save_evaluation"), null, now) as { savedId: string };
    const other = await seed();
    await expect(db.insert(financialImportReviews).values({ companyId: other.id, sourceId: source, kind: "evaluation", name: "Foreign source", reason: "Synthetic scope test", requestKey: randomUUID(), requestHash: "synthetic", snapshot: {} })).rejects.toThrow();
    await expect(db.update(financialImportReviews).set({ snapshot: { overwritten: true } }).where(eq(financialImportReviews.id, result.savedId))).rejects.toThrow();
    await expect(preview(other.id, source)).rejects.toMatchObject({ status: 404 }); await expect(loadImportReview(other.id, result.savedId)).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(journalEntries).where(eq(journalEntries.companyId, f.id))).toHaveLength(0);
    expect(await db.select().from(financialImportReviews).where(eq(financialImportReviews.companyId, f.id))).toHaveLength(1);
  });
  it("rolls back the entire preview when a new posting targets a closed period", async () => {
    const f = await seed(); const source = await f.file([["a", "100"]]); await db.insert(reportingPeriods).values({ companyId: f.id, month: "2026-09", status: "closed" });
    const view = await preview(f.id, source); expect(view.after).toBeNull(); expect(view.blockers.join(" ")).toContain("period controls");
    expect(await db.select().from(journalEntries).where(eq(journalEntries.companyId, f.id))).toHaveLength(0);
  });
  it("reconciles evidenced zero starting cash with a pinned account correction and preserves source inspection", async () => {
    const { loadFinancialProgress, correctFinancialProgress, inspectFinancialMonth } = await import("./financial-progress");
    const f = await seed(); const source = await f.file([["a", "100"]]); const [document] = await db.select().from(evidence).where(eq(evidence.sourceId, source));
    await db.update(chartAccounts).set({ bankAccountIdentifier: null }).where(eq(chartAccounts.id, f.cashId));
    const before = await loadFinancialProgress(f.id, now); expect(before.review.outlook.openingCash?.status).not.toBe("reconciled");
    const request = { action: "map_cash_account", accountId: f.cashId, evidenceId: document!.id, previewToken: before.review.previewToken, requestKey: randomUUID(), reason: "Reviewed synthetic identity and zero opening balance" };
    await correctFinancialProgress(f.id, request, null, now); await correctFinancialProgress(f.id, request, null, now);
    const after = await loadFinancialProgress(f.id, now); expect(after.review.outlook.openingCash?.status).toBe("reconciled"); expect(after.review.outlook.openingCash?.ledgerCashMinor).toBe("0");
    await expect(inspectFinancialMonth(f.id, "2026-09", before.review.previewToken, now)).rejects.toMatchObject({ status: 409 });
    expect((await inspectFinancialMonth(f.id, "2026-09", after.review.previewToken, now)).month.month).toBe("2026-09");
    const other = await seed(); const foreignPreview = await loadFinancialProgress(other.id, now);
    await expect(correctFinancialProgress(other.id, { ...request, requestKey: randomUUID(), previewToken: foreignPreview.review.previewToken }, null, now)).rejects.toMatchObject({ status: 404 });
    await db.update(evidence).set({ openingBalance: "1" }).where(eq(evidence.id, document!.id));
    expect((await loadFinancialProgress(f.id, now)).review.outlook.openingCash?.status).not.toBe("reconciled");
    expect(after.review.outlook.openingCash?.status).toBe("reconciled");
  });

  it("reviews overlapping exports with explicit changed identities and retains absent rows", async () => {
    const f = await seed(); const old = await f.file([["a", "100"], ["b", "200"]], true); const incoming = await f.file([["renamed", "150"]]);
    await db.update(evidence).set({ statementPeriodStart: "2026-09-05", statementPeriodEnd: "2026-09-20" }).where(eq(evidence.sourceId, incoming));
    const before = await db.select().from(sourceRows).where(eq(sourceRows.sourceId, old)); const after = await db.select().from(sourceRows).where(eq(sourceRows.sourceId, incoming));
    const selection = { action: "preview", sourceId: incoming, previousSourceId: old, mode: "partial_update", rowMappings: [{ currentRowId: after[0]!.id, previousRowId: before.find((row) => row.sourceKey === "a")!.id }] };
    const view = await execute(f.id, selection, null, now) as ImportPreview; expect(view.blockers).toEqual([]); expect(view.rows.map((row) => row.kind)).toEqual(["corrected", "retained"]); expect(view.reversalCount).toBe(1);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.companyId, f.id))).toHaveLength(2);
    const saved = await execute(f.id, command(view), null, now) as { savedId: string }; const receipt = await loadImportReview(f.id, saved.savedId); expect(receipt.snapshot.appliedOutlook?.output.months).toEqual(view.after?.output.months);
    expect(JSON.parse((await db.select().from(sources).where(eq(sources.id, old)))[0]!.metadata).financialReviewSupersededBy).toBeUndefined();
    expect((await db.select().from(sourceRows).where(eq(sourceRows.id, before.find((row) => row.sourceKey === "b")!.id)))[0]!.status).not.toBe("superseded");
    expect((await execute(f.id, selection, null, now) as ImportPreview).blockers.join(" ")).toContain("already superseded");
  });
  it("requires one-to-one owned mapping and explicit partial corrections", async () => {
    const f = await seed(); const old = await f.file([["a", "100"]], true); const incoming = await f.file([["a", "200"], ["b", "50"]]); const other = await seed(); const foreign = await other.file([["a", "10"]]);
    const prior = (await db.select().from(sourceRows).where(eq(sourceRows.sourceId, old)))[0]!; const rows = await db.select().from(sourceRows).where(eq(sourceRows.sourceId, incoming)); const foreignRow = (await db.select().from(sourceRows).where(eq(sourceRows.sourceId, foreign)))[0]!;
    const selection = { action: "preview", sourceId: incoming, previousSourceId: old, mode: "partial_update" };
    expect((await execute(f.id, selection, null, now) as ImportPreview).blockers.join(" ")).toContain("Explicitly map");
    await expect(execute(f.id, { ...selection, rowMappings: rows.map((row) => ({ currentRowId: row.id, previousRowId: prior.id })) }, null, now)).rejects.toMatchObject({ status: 422 });
    await expect(execute(f.id, { ...selection, rowMappings: [{ currentRowId: rows[0]!.id, previousRowId: foreignRow.id }] }, null, now)).rejects.toMatchObject({ status: 422 });
  });

});
