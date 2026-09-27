import { describe, expect, it } from "vitest";
import { reconcileOpeningCash, type OpeningCashInput } from "./opening-cash";
const fixture = (): OpeningCashInput => ({ period: "2026-08", currency: "USD", expectedCashMinor: "50000000", accounts: [
  { accountId: "cash", accountCode: "1000", accountName: "Bank cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash", bankAccountIdentifier: "synthetic-1234", entityId: null, active: true },
], statements: [{ id: "statement", sourceId: "source", name: "Synthetic August statement", hash: "hash", kind: "bank_statement", status: "approved", identityStatus: "approved", accountIdentifier: "synthetic-1234", entityId: null, currency: "USD", startDate: "2026-08-01", endDate: "2026-08-31", openingBalance: "0", endingBalance: "500,000.00" }], lines: [
  { id: "cash-line", accountId: "cash", accountCode: "1000", accountName: "Bank cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash", currency: "USD", debitMinor: "50000000", creditMinor: "0", period: "2026-08", postingDate: "2026-08-31" },
  { id: "capital-line", accountId: "capital", accountCode: "3000", accountName: "Capital", accountType: "equity", normalBalance: "credit", currency: "USD", debitMinor: "0", creditMinor: "50000000", period: "2026-08", postingDate: "2026-08-31" },
] });
describe("opening cash evidence controls", () => {
  it("ties exact-boundary statements to the shared trial balance and preserves supporting inputs", () => {
    const input = fixture(); const result = reconcileOpeningCash(input);
    expect(result).toMatchObject({ status: "reconciled", ledgerCashMinor: "50000000", boundary: "2026-08-31" });
    expect(result.accounts[0]).toMatchObject({ differenceMinor: "0", journalLineIds: ["cash-line"], balances: [{ evidenceId: "statement", valueMinor: "50000000" }] });
    expect(result.inputs).toEqual(input);
  });
  it("accepts exact next-month opening evidence and evidenced zero activity", () => {
    const input = fixture(); input.statements[0]!.startDate = "2026-09-01"; input.statements[0]!.endDate = "2026-09-30"; input.statements[0]!.openingBalance = "500000";
    expect(reconcileOpeningCash(input).status).toBe("reconciled");
    input.lines = []; input.expectedCashMinor = "0"; input.statements[0]!.openingBalance = "0";
    expect(reconcileOpeningCash(input).status).toBe("reconciled");
    input.statements = []; expect(reconcileOpeningCash(input).status).toBe("needs_review");
  });
  it.each([
    ["unapproved identity", (input: OpeningCashInput) => { input.statements[0]!.identityStatus = "pending"; }],
    ["incorrect boundary", (input: OpeningCashInput) => { input.statements[0]!.endDate = "2026-08-30"; }],
    ["wrong account", (input: OpeningCashInput) => { input.statements[0]!.accountIdentifier = "another-bank"; }],
    ["wrong currency", (input: OpeningCashInput) => { input.statements[0]!.currency = "CAD"; }],
    ["wrong entity", (input: OpeningCashInput) => { input.statements[0]!.entityId = "another-entity"; }],
    ["unknown source type", (input: OpeningCashInput) => { input.statements[0]!.kind = "financial_model"; }],
    ["unsupported precision", (input: OpeningCashInput) => { input.statements[0]!.endingBalance = "500000.001"; }],
    ["omitted cash account", (input: OpeningCashInput) => { input.accounts.push({ ...input.accounts[0]!, accountId: "second", accountCode: "1010", bankAccountIdentifier: "second-bank" }); }],
    ["ambiguous mapping", (input: OpeningCashInput) => { input.accounts.push({ ...input.accounts[0]!, accountId: "second", accountCode: "1010" }); }],
    ["forecast mismatch", (input: OpeningCashInput) => { input.expectedCashMinor = "50000001"; }],
    ["unbalanced journals", (input: OpeningCashInput) => { input.lines.pop(); }],
  ])("does not pass %s", (_name, mutate) => { const input = fixture(); mutate(input); expect(reconcileOpeningCash(input).status).toBe("needs_review"); });
  it("exposes conflicts and differences without netting unrelated statements together", () => {
    const input = fixture(); input.statements[0]!.endingBalance = "499000";
    expect(reconcileOpeningCash(input).accounts[0]?.differenceMinor).toBe("100000");
    input.statements.push({ ...input.statements[0]!, id: "corrected", endingBalance: "500000" });
    expect(reconcileOpeningCash(input).accounts[0]).toMatchObject({ state: "needs_review", statementMinor: null });
  });
  it("does not treat an unreviewed correction as reconciled", () => {
    const input = fixture(); input.statements.push({ ...input.statements[0]!, id: "pending-correction", status: "pending" });
    expect(reconcileOpeningCash(input).status).toBe("needs_review");
  });
  it("blocks malformed supporting amounts instead of treating them as zero", () => {
    const input = fixture(); input.lines[0]!.debitMinor = "invalid";
    expect(reconcileOpeningCash(input).reasons).toContain("A supporting journal amount is invalid.");
  });

});
