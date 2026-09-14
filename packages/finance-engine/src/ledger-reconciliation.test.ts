import { describe, expect, it } from "vitest";
import { evaluateJournalAuthority, reconcileLedgerMonth } from "./ledger-reconciliation";

const trialBalance = { period: "2026-09", lines: [], totals: { USD: { debitMinor: "100", creditMinor: "100", differenceMinor: "0" } }, balanced: true };
const statements = { period: "2026-09", byCurrency: [{ currency: "USD", incomeStatement: { revenue: [], expenses: [], netIncomeMinor: "0" }, balanceSheet: { assets: [], liabilities: [], equity: [], retainedEarningsMinor: "0", totalAssetsMinor: "0", totalLiabilitiesAndEquityMinor: "0", differenceMinor: "0", balanced: true }, unclassified: [] }] };

describe("reconcileLedgerMonth", () => {
  it("verifies a source row through cash actual and posted cash line", () => {
    const result = reconcileLedgerMonth({ period: "2026-09", sourceRows: [{ id: "row", period: "2026-09", amount: "31.00", currency: "USD", status: "approved" }], cashEvents: [{ id: "event", sourceRowId: "row", isActual: "Y" }], journalLines: [{ id: "cash", sourceRowId: "row", currency: "USD", debitMinor: "3100", creditMinor: "0", statementLine: "cash" }, { id: "revenue", sourceRowId: "row", currency: "USD", debitMinor: "0", creditMinor: "3100", statementLine: "management_fee" }], trialBalance, statements });
    expect(result.verificationStatus).toBe("verified");
    expect(result.sourceRows).toMatchObject([{ status: "reconciled", sourceMinor: "3100" }]);
  });

  it("does not call a row reconciled when journal cash differs", () => {
    const result = reconcileLedgerMonth({ period: "2026-09", sourceRows: [{ id: "row", period: "2026-09", amount: "31.00", currency: "USD", status: "approved" }], cashEvents: [{ id: "event", sourceRowId: "row", isActual: "Y" }], journalLines: [{ id: "cash", sourceRowId: "row", currency: "USD", debitMinor: "3000", creditMinor: "0", statementLine: "cash" }], trialBalance, statements });
    expect(result.sourceRows).toMatchObject([{ status: "amount_mismatch", sourceMinor: "3100", journalCashMinor: "3000" }]);
    expect(result.controls.reasons).toContain("Source-row cash amounts do not agree with journal cash lines.");
  });
  it("does not combine a foreign-currency cash line with the source amount", () => {
    const result = reconcileLedgerMonth({ period: "2026-09", sourceRows: [{ id: "row", period: "2026-09", amount: "31.00", currency: "USD", status: "approved" }], cashEvents: [{ id: "event", sourceRowId: "row", isActual: "Y" }], journalLines: [{ id: "cash", sourceRowId: "row", currency: "CAD", debitMinor: "3100", creditMinor: "0", statementLine: "cash" }], trialBalance, statements });
    expect(result.sourceRows).toMatchObject([{ status: "currency_mismatch" }]);
  });
  it("requires journal ending cash to tie approved bank-statement cash when statements are supplied", () => {
    const result = reconcileLedgerMonth({ period: "2026-09", sourceRows: [], cashEvents: [], journalLines: [], trialBalance: { ...trialBalance, lines: [{ accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash", currency: "USD", debitMinor: "10000", creditMinor: "0", netMinor: "10000", lineIds: [], provenance: [] }] }, statements, cashStatements: [{ sourceId: "bank", sourceName: "Operating", accountIdentifier: "operating-1", chartAccountId: "cash", currency: "USD", endingBalance: "100.00" }] });
    expect(result.controls.cashToStatement).toEqual([expect.objectContaining({ currency: "USD", status: "tied" })]);
  });
  it("makes a bank-cash mismatch an explicit control exception", () => {
    const result = reconcileLedgerMonth({ period: "2026-09", sourceRows: [], cashEvents: [], journalLines: [], trialBalance: { ...trialBalance, lines: [{ accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash", currency: "USD", debitMinor: "10000", creditMinor: "0", netMinor: "10000", lineIds: [], provenance: [] }] }, statements, cashStatements: [{ sourceId: "bank", sourceName: "Operating", accountIdentifier: "operating-1", chartAccountId: "cash", currency: "USD", endingBalance: "90.00" }] });
    expect(result.controls.reasons).toContain("Journal ending cash does not tie to approved bank-statement ending cash.");
  });
  it("keeps a statement account without a chart mapping as a blocker", () => {
    const result = reconcileLedgerMonth({ period: "2026-09", sourceRows: [], cashEvents: [], journalLines: [], trialBalance, statements, cashStatements: [{ sourceId: "bank", sourceName: "Operating", accountIdentifier: "operating-1", currency: "USD", endingBalance: "90.00" }] });
    expect(result.controls.cashToStatement).toEqual(expect.arrayContaining([expect.objectContaining({ status: "unmapped_statement", accountIdentifier: "operating-1" })]));
    expect(result.controls.reasons).toContain("An approved bank statement account is not mapped to a chart cash account.");
  });
  it("requires actual evidence coverage before a period is eligible", () => {
    const report = reconcileLedgerMonth({ period: "2026-09", sourceRows: [], cashEvents: [], journalLines: [], trialBalance, statements });
    const decision = evaluateJournalAuthority(report);
    expect(decision).toMatchObject({ eligible: false, requiredNextStep: "resolve_controls" });
    expect(decision.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/No approved source rows/i)]));
  });
});
