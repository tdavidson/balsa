import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

config({ path: fileURLToPath(new URL("../../../../.env.local", import.meta.url)) });
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!process.env.DATABASE_URL)("forecast preview parity", async () => {
  if (!process.env.DATABASE_URL) return; // skipped suites still run their factory
  const { calculationRuns, chartAccounts, closeDatabase, companies, decisions, economicItems, evidence, financialStateRevisions, forecastConsequences, forecastEntryTemplates, getDatabase, users } = await import("@finance/database");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const { previewForecastChange, PreviewConflict } = await import("./forecast-preview");
  const { applyDecisionIfEffective } = await import("./decision-effects");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { addMonths } = await import("@balsa/finance-engine");
  const db = getDatabase();
  let companyId = ""; let firstMonth = "";
  const headline = (delta: unknown) => { const value = delta as { horizonEndCash: unknown; cashOutMonth: unknown; runwayMonths: unknown; projectedSpending: unknown; projectedReceipts: unknown }; return { horizonEndCash: value.horizonEndCash, cashOutMonth: value.cashOutMonth, runwayMonths: value.runwayMonths, projectedSpending: value.projectedSpending, projectedReceipts: value.projectedReceipts }; };
  const latest = async () => (await db.select().from(forecastConsequences).where(eq(forecastConsequences.companyId, companyId)).orderBy(desc(sql`${forecastConsequences.revision}::bigint`)).limit(1))[0]!;

  beforeAll(async () => {
    const [company] = await db.insert(companies).values({ name: `Preview parity ${Date.now()}` }).returning({ id: companies.id });
    companyId = company!.id;
    const [cash, payroll] = await db.insert(chartAccounts).values([
      { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
      { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    ]).returning({ id: chartAccounts.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id });
    firstMonth = addMonths(await forecastAsOfMonth(companyId, new Date()), 1);
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
  });

  afterAll(async () => {
    if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
    await closeDatabase();
  });

  it("previews an item confirmation exactly as it later lands", async () => {
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Rent", amount: "500", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    const preview = await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
    await db.update(economicItems).set({ status: "confirmed" }).where(eq(economicItems.id, item!.id));
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "item_confirmed", subjectType: "economic_item", subjectId: item!.id, actorUserId: null, via: "worker" } });
    expect(headline((await latest()).delta)).toEqual(headline(preview.consequence));
  });

  it("carries the draft item's evidence as a source, scoped to the company", async () => {
    const [user] = await db.insert(users).values({ authProvider: "test", authProviderUserId: `preview-sources-${Date.now()}`, email: `preview-sources-${Date.now()}@example.com` }).returning({ id: users.id });
    const [source] = await db.insert(evidence).values({ companyId, createdByUserId: user!.id, sourceName: "Retainer agreement.pdf", rawText: "" }).returning({ id: evidence.id });
    try {
      const [withEvidence] = await db.insert(economicItems).values({ companyId, evidenceId: source!.id, type: "obligation", direction: "spend", label: "Consulting", amount: "300", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
      const preview = await previewForecastChange(companyId, { kind: "confirm_item", itemId: withEvidence!.id });
      expect(preview.sources).toEqual([{ evidenceId: source!.id, sourceName: "Retainer agreement.pdf" }]);

      const [withoutEvidence] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "No source", amount: "40", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
      const previewWithoutEvidence = await previewForecastChange(companyId, { kind: "confirm_item", itemId: withoutEvidence!.id });
      expect(previewWithoutEvidence.sources).toEqual([]);
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it("previews a batch confirmation exactly as a bulk confirm later lands", async () => {
    const [user] = await db.insert(users).values({ authProvider: "test", authProviderUserId: `preview-batch-${Date.now()}`, email: `preview-batch-${Date.now()}@example.com` }).returning({ id: users.id });
    const [source] = await db.insert(evidence).values({ companyId, createdByUserId: user!.id, sourceName: "Batch MSA.pdf", rawText: "" }).returning({ id: evidence.id });
    try {
      const [first, second] = await db.insert(economicItems).values([
        { companyId, evidenceId: source!.id, type: "obligation", direction: "spend", label: "Batch A", amount: "120", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" },
        { companyId, type: "obligation", direction: "spend", label: "Batch B", amount: "45", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" },
      ]).returning({ id: economicItems.id });
      const ids = [first!.id, second!.id];
      const preview = await previewForecastChange(companyId, { kind: "confirm_items", itemIds: ids });
      expect(preview.sources).toEqual([{ evidenceId: source!.id, sourceName: "Batch MSA.pdf" }]);
      await db.update(economicItems).set({ status: "confirmed" }).where(inArray(economicItems.id, ids));
      await refreshCurrentCalculationRun(companyId, { cause: { kind: "item_confirmed", subjectType: "economic_item", subjectId: null, actorUserId: null, via: "worker", subjectIds: ids } });
      expect(headline((await latest()).delta)).toEqual(headline(preview.consequence));
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it("rejects a batch preview that mixes a draft item with a non-draft item", async () => {
    const [draft, confirmed] = await db.insert(economicItems).values([
      { companyId, type: "obligation", direction: "spend", label: "Draft item", amount: "20", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" },
      { companyId, type: "obligation", direction: "spend", label: "Already confirmed", amount: "30", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" },
    ]).returning({ id: economicItems.id });
    try {
      await expect(previewForecastChange(companyId, { kind: "confirm_items", itemIds: [draft!.id, confirmed!.id] })).rejects.toBeInstanceOf(PreviewConflict);
    } finally {
      // The "confirmed" item here was never picked up by a refresh, so it must not linger as an
      // unaccounted-for driver for later tests in this shared company.
      await db.delete(economicItems).where(inArray(economicItems.id, [draft!.id, confirmed!.id]));
    }
  });

  it("previews a decision exactly as it later lands", async () => {
    const effect = { kind: "add_item", item: { label: "Contractor", direction: "spend", amount: 250, cadence: "monthly", effectiveFrom: firstMonth, category: "contractor", accountingTreatment: "cash" } };
    const [decision] = await db.insert(decisions).values({ companyId, question: "Hire a contractor?", answer: "Yes", status: "proposed", effect: JSON.stringify(effect) }).returning({ id: decisions.id });
    const preview = await previewForecastChange(companyId, { kind: "apply_decision", decisionId: decision!.id });
    await db.update(decisions).set({ status: "applied" }).where(eq(decisions.id, decision!.id));
    await applyDecisionIfEffective(companyId, decision!.id, null);
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "decision_applied", subjectType: "decision", subjectId: decision!.id, actorUserId: null, via: "worker" } });
    expect(headline((await latest()).delta)).toEqual(headline(preview.consequence));
  });

  it("previews pattern, metric and new-account decisions exactly as they land", async () => {
    const decide = async (effect: unknown) => {
      const [decision] = await db.insert(decisions).values({ companyId, question: "Pattern?", answer: "Yes", status: "proposed", effect: JSON.stringify(effect) }).returning({ id: decisions.id });
      const preview = await previewForecastChange(companyId, { kind: "apply_decision", decisionId: decision!.id });
      await db.update(decisions).set({ status: "applied" }).where(eq(decisions.id, decision!.id));
      await applyDecisionIfEffective(companyId, decision!.id, null);
      await refreshCurrentCalculationRun(companyId, { cause: { kind: "decision_applied", subjectType: "decision", subjectId: decision!.id, actorUserId: null, via: "worker" } });
      // A change that moves no cash has no consequence on either side.
      const landed = (await latest()).delta;
      if (preview.consequence) expect(headline(landed)).toEqual(headline(preview.consequence));
      return preview.consequence;
    };
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Salaries", amount: "1000", cadence: "monthly", effectiveFrom: firstMonth, status: "confirmed" }).returning({ id: economicItems.id });
    await refreshCurrentCalculationRun(companyId, { cause: { kind: "item_confirmed", subjectType: "economic_item", subjectId: item!.id, actorUserId: null, via: "worker" } });
    await decide({ kind: "set_metric", metric: { name: "heads", label: "Headcount", unit: "people", effectiveFrom: firstMonth, effectiveTo: null, pattern: { initialValue: "4", repeatsEveryMonths: 1, change: { basis: "abs_change", everyMonths: 2, by: "1" } } } });
    expect(await decide({ kind: "set_item_pattern", itemId: item!.id, pattern: { initialValue: "900", repeatsEveryMonths: 1, change: { basis: "per_unit", ref: { kind: "metric", name: "heads" } } } })).not.toBeNull();
    const [cash] = await db.select({ id: chartAccounts.id }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.code, "1000")));
    const [software] = await db.insert(chartAccounts).values({ companyId, code: "6100", name: "Software", accountType: "expense", normalBalance: "debit" }).returning({ id: chartAccounts.id });
    expect(await decide({ kind: "add_item", item: { label: "Software", direction: "spend", amount: 300, cadence: "monthly", effectiveFrom: firstMonth, category: "software", accountingTreatment: "cash", accountId: software!.id, cashAccountId: cash!.id, pattern: { initialValue: "300", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.02" } } } })).not.toBeNull();
    const created = await db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.label, "Software")));
    expect(created[0]?.forecastTemplateId).toBeTruthy();
  });

  it("does not load the ledger when the latest forecast run is current", async () => {
    const ledger = await import("./journal-ledger");
    const spy = vi.spyOn(ledger, "loadPostedJournalLines");
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Insurance", amount: "100", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("falls back to the ledger when the latest run is behind the company revision", async () => {
    const ledger = await import("./journal-ledger");
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Legal", amount: "150", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    const before = (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision;
    const bumped = String(BigInt(before) + 1n);
    await db.update(companies).set({ financialStateRevision: bumped }).where(eq(companies.id, companyId));
    await db.insert(financialStateRevisions).values({ companyId, revision: bumped, kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" });
    try {
      const fallbackSpy = vi.spyOn(ledger, "loadPostedJournalLines");
      const fallback = await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
      expect(fallbackSpy).toHaveBeenCalled();
      fallbackSpy.mockRestore();

      await db.update(companies).set({ financialStateRevision: before }).where(eq(companies.id, companyId));
      const reuseSpy = vi.spyOn(ledger, "loadPostedJournalLines");
      const reused = await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
      expect(reuseSpy).not.toHaveBeenCalled();
      reuseSpy.mockRestore();

      expect(headline(fallback.consequence)).toEqual(headline(reused.consequence));
    } finally {
      await db.update(companies).set({ financialStateRevision: before }).where(eq(companies.id, companyId));
    }
  });

  it("falls back to the ledger when the stored input has the old actualLines shape", async () => {
    const ledger = await import("./journal-ledger");
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Utilities", amount: "80", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    const [row] = await db.select({ id: calculationRuns.id, inputJson: calculationRuns.inputJson }).from(calculationRuns)
      .where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, "forecast-run-%")))
      .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1);
    const originalInputJson = row!.inputJson;
    const parsed = JSON.parse(originalInputJson) as Record<string, unknown>;
    delete parsed.actuals;
    const oldShape = JSON.stringify({ ...parsed, actualLines: [] });
    await db.update(calculationRuns).set({ inputJson: oldShape }).where(eq(calculationRuns.id, row!.id));
    try {
      const fallbackSpy = vi.spyOn(ledger, "loadPostedJournalLines");
      const fallback = await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
      expect(fallbackSpy).toHaveBeenCalled();
      fallbackSpy.mockRestore();

      await db.update(calculationRuns).set({ inputJson: originalInputJson }).where(eq(calculationRuns.id, row!.id));
      const reuseSpy = vi.spyOn(ledger, "loadPostedJournalLines");
      const reused = await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
      expect(reuseSpy).not.toHaveBeenCalled();
      reuseSpy.mockRestore();

      expect(headline(fallback.consequence)).toEqual(headline(reused.consequence));
    } finally {
      await db.update(calculationRuns).set({ inputJson: originalInputJson }).where(eq(calculationRuns.id, row!.id));
    }
  });

  it("sees a chart account and template added after the latest run without a revision bump", async () => {
    const ledger = await import("./journal-ledger");
    const [cash] = await db.select({ id: chartAccounts.id }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.code, "1000")));
    // No refresh: the stored run's input predates this account, so only a fresh account load can map the template.
    const [revenue] = await db.insert(chartAccounts).values({ companyId, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" }).returning({ id: chartAccounts.id });
    await db.insert(forecastEntryTemplates).values({ companyId, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: cash!.id, creditAccountId: revenue!.id });
    const [item] = await db.insert(economicItems).values({ companyId, type: "agreement", direction: "receipt", label: "Retainer", amount: "700", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });

    const reuseSpy = vi.spyOn(ledger, "loadPostedJournalLines");
    const reused = await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
    expect(reuseSpy).not.toHaveBeenCalled();
    reuseSpy.mockRestore();
    expect(reused.exceptionsAfter).toBe(0);
    expect(reused.consequence!.exceptions.after).toBe(reused.consequence!.exceptions.before);
    expect(reused.consequence!.projectedReceipts.deltaMinor).not.toBe("0");

    // A forced full load: the latest run falls behind the company revision, so nothing stored is reused.
    const before = (await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)))[0]!.revision;
    const bumped = String(BigInt(before) + 1n);
    await db.update(companies).set({ financialStateRevision: bumped }).where(eq(companies.id, companyId));
    try {
      const full = await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
      expect(reused).toEqual(full);
    } finally {
      await db.update(companies).set({ financialStateRevision: before }).where(eq(companies.id, companyId));
    }
  });

  it("reuses only a stored run at the current forecast formula version", async () => {
    const ledger = await import("./journal-ledger");
    const [item] = await db.insert(economicItems).values({ companyId, type: "obligation", direction: "spend", label: "Hosting", amount: "60", cadence: "monthly", effectiveFrom: firstMonth, status: "draft" }).returning({ id: economicItems.id });
    const [row] = await db.select({ id: calculationRuns.id, engineVersion: calculationRuns.engineVersion }).from(calculationRuns)
      .where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, "forecast-run-%")))
      .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1);
    // An older formula's run at the head revision: its stored input shape is not guaranteed, so it must not be reused.
    await db.update(calculationRuns).set({ engineVersion: "forecast-run-2026-01-01.1" }).where(eq(calculationRuns.id, row!.id));
    try {
      const spy = vi.spyOn(ledger, "loadPostedJournalLines");
      await previewForecastChange(companyId, { kind: "confirm_item", itemId: item!.id });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      await db.update(calculationRuns).set({ engineVersion: row!.engineVersion }).where(eq(calculationRuns.id, row!.id));
    }
  });
});
