import { buildJournalStatements, buildProjectedEntries, buildTrialBalance, convertMinorAtFxRate, selectApprovedFxRate, type PostedJournalLine } from "@nevermodel/finance-engine";
import { detectSourceCurrencies, normalizeTransactions } from "@nevermodel/ingestion";

export type AccountingEvalStage = "extraction" | "journal" | "financial_statements" | "forecasting" | "provenance" | "fx";
export type AccountingEval = { id: string; stage: AccountingEvalStage; reason: string; execute: () => string[] };

const line = (id: string, accountId: string, accountType: string, normalBalance: "debit" | "credit", debitMinor: string, creditMinor: string, period = "2026-09"): PostedJournalLine => ({ id, entryId: id, accountId, accountCode: accountId, accountName: accountId, accountType, normalBalance, currency: "USD", debitMinor, creditMinor, period, provenance: { factId: `${id}-fact` } });

export const accountingEvals: AccountingEval[] = [
  {
    id: "source-rows-retain-direction-currency-and-location",
    stage: "extraction",
    reason: "A transaction must become a source row before any accounting mapping can be proposed.",
    execute: () => {
      const rows = normalizeTransactions([["Date", "Description", "Debit", "Credit"], ["2026-09-03", "Wire received", "", "3,100.00"]], "2026-09");
      return [rows[0]?.postedDate === "2026-09-03" && rows[0]?.direction === "receipt" && rows[0]?.sourceLocation === "row:2" ? "" : "Transaction extraction lost date, direction, or source location.", detectSourceCurrencies("Currency: USD").includes("USD") ? "" : "Explicit source currency was not detected."];
    },
  },
  {
    id: "journal-trial-balance-is-exact",
    stage: "journal",
    reason: "Reported statements begin with balanced posted entries, not inferred cash events.",
    execute: () => {
      const trial = buildTrialBalance([line("cash", "1000", "asset", "debit", "310000", "0"), line("revenue", "4000", "revenue", "credit", "0", "310000")], "2026-09");
      return [trial.balanced ? "" : "A balanced journal did not produce a balanced trial balance."];
    },
  },
  {
    id: "capital-is-financing-not-revenue",
    stage: "financial_statements",
    reason: "Equity contributions must not become operating income.",
    execute: () => {
      const statements = buildJournalStatements([{ ...line("cash", "1000", "asset", "debit", "500000", "0"), entryId: "capital", accountName: "Cash", statementLine: "Cash" }, { ...line("equity", "3000", "equity", "credit", "0", "500000"), entryId: "capital" }], "2026-09").byCurrency[0]?.cashFlow;
      return [statements?.financingMinor === "500000" ? "" : "Capital contribution was not classified as financing cash flow.", statements?.operatingMinor === "0" ? "" : "Capital contribution entered operating cash flow."];
    },
  },
  {
    id: "forecast-is-a-balanced-journal-overlay-before-close",
    stage: "forecasting",
    reason: "Forecasting must produce deterministic balanced journal overlays even while actual periods remain open.",
    execute: () => {
      const projected = buildProjectedEntries([{ id: "fee", label: "Monthly management fee", itemType: "agreement", direction: "receipt", category: "management_fee", amountMinor: "125000", cadence: "monthly", effectiveFrom: "2026-09" }], [{ id: "fee-template", itemType: "agreement", direction: "receipt", category: "management_fee", debitAccountId: "1000", creditAccountId: "4000" }], { start: "2026-09", end: "2026-10" });
      const first = projected.entries[0];
      return [projected.exceptions.length === 0 && projected.entries.length === 2 ? "" : "An approved forecast driver did not expand across an open forecast horizon.", first?.basis === "forecast" && first.lines[0]?.debitMinor === "125000" && first.lines[1]?.creditMinor === "125000" ? "" : "Forecast output was not a balanced journal overlay."];
    },
  },
  {
    id: "statement-lines-retain-source-provenance",
    stage: "provenance",
    reason: "A displayed statement amount must retain a path to the evidence that created its posted journal line.",
    execute: () => {
      const statements = buildJournalStatements([line("cash", "1000", "asset", "debit", "310000", "0"), line("revenue", "4000", "revenue", "credit", "0", "310000")], "2026-09").byCurrency[0];
      const revenue = statements?.incomeStatement.revenue[0];
      return [revenue?.lineIds.includes("revenue") ? "" : "Statement line no longer exposes its posted journal-line identifiers.", revenue?.accountIds.includes("4000") ? "" : "Statement line no longer exposes its contributing account identifiers."];
    },
  },
  {
    id: "fx-rate-selection-is-sourced-and-exact",
    stage: "fx",
    reason: "FX conversion must select an approved direct quote and retain rational minor-unit math.",
    execute: () => {
      const selection = selectApprovedFxRate([{ id: "eur-usd", rateSetId: "approved-source", rateSetStatus: "approved", fromCurrency: "EUR", toCurrency: "USD", rateType: "spot", effectiveDate: "2026-09-01", numerator: "108", denominator: "100", factId: "fx-fact" }], { fromCurrency: "EUR", toCurrency: "USD", rateType: "spot", asOfDate: "2026-09-03" });
      const conversion = convertMinorAtFxRate("10000", selection);
      return [selection.status === "ready" && selection.rate?.factId === "fx-fact" ? "" : "Approved sourced FX quote was not selected.", conversion.status === "ready" && conversion.convertedMinor === "10800" ? "" : "FX conversion did not use exact rational minor-unit math."];
    },
  },
];

export type AccountingEvalResult = { id: string; stage: AccountingEvalStage; reason: string; passed: boolean; errors: string[] };

export function runAccountingEvals(): AccountingEvalResult[] {
  return accountingEvals.map((fixture) => {
    const errors = fixture.execute().filter(Boolean);
    return { id: fixture.id, stage: fixture.stage, reason: fixture.reason, passed: errors.length === 0, errors };
  });
}

export function summarizeAccountingEvals(results: AccountingEvalResult[]) {
  const stages: AccountingEvalStage[] = ["extraction", "journal", "financial_statements", "forecasting", "provenance", "fx"];
  const byStage = Object.fromEntries(stages.map((stage) => {
    const stageResults = results.filter((result) => result.stage === stage);
    const passed = stageResults.filter((result) => result.passed).length;
    return [stage, { fixtures: stageResults.length, passed, failed: stageResults.length - passed, passRate: stageResults.length ? passed / stageResults.length : null }];
  }));
  const passed = results.filter((result) => result.passed).length;
  return { fixtures: results.length, passed, failed: results.length - passed, passRate: results.length ? passed / results.length : null, byStage };
}
