import { describe, expect, it } from "vitest";
import { reconcileAccountBalances } from "./account-reconciliation";

const cash = { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit" as const, statementLine: "Cash", currency: "USD", debitMinor: "10000", creditMinor: "0", netMinor: "10000", lineIds: ["line"], provenance: [] };

describe("reconcileAccountBalances", () => {
  it("reconciles an exact approved statement line without guessing", () => {
    expect(reconcileAccountBalances([cash], [{ sourceRowId: "source", factId: "fact", label: "Cash", amount: "100.00", currency: "USD", status: "approved", factStatus: "treatment_approved" }])).toMatchObject([{ status: "reconciled", ledgerMinor: "10000", statementMinor: "10000" }]);
  });
  it("keeps a nonmatching statement label as an exception", () => {
    expect(reconcileAccountBalances([cash], [{ sourceRowId: "source", label: "Cash and equivalents", amount: "100.00", currency: "USD", status: "approved", factStatus: "treatment_approved" }])).toEqual(expect.arrayContaining([expect.objectContaining({ status: "unmapped_statement" }), expect.objectContaining({ status: "unmapped_ledger" })]));
  });
  it("uses an approved source-row mapping instead of fuzzy label matching", () => {
    expect(reconcileAccountBalances([cash], [{ sourceRowId: "source", label: "Cash and equivalents", amount: "100.00", currency: "USD", status: "approved", factStatus: "treatment_approved" }], [{ sourceRowId: "source", chartAccountId: "cash", status: "approved", mappingType: "account_balance" }])).toMatchObject([{ status: "reconciled", accountIds: ["cash"] }]);
  });
});
