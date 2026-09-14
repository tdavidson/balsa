import { describe, expect, it } from "vitest";
import { buildJournalCalculationGraph } from "./journal-calculation-graph";

const source = { sourceId: "source", factId: "fact" };
const trialBalance = { period: "2026-09", balanced: true, totals: { USD: { debitMinor: "10000", creditMinor: "10000", differenceMinor: "0" } }, lines: [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit" as const, statementLine: "Cash", currency: "USD", debitMinor: "10000", creditMinor: "0", netMinor: "10000", lineIds: ["cash-line"], provenance: [source] },
  { accountId: "equity", accountCode: "3000", accountName: "Equity", accountType: "equity", normalBalance: "credit" as const, statementLine: "Equity", currency: "USD", debitMinor: "0", creditMinor: "10000", netMinor: "-10000", lineIds: ["equity-line"], provenance: [source] },
] };
const statements = { period: "2026-09", byCurrency: [{ currency: "USD", incomeStatement: { revenue: [], expenses: [], netIncomeMinor: "0" }, balanceSheet: { assets: [{ key: "Cash", label: "Cash", amountMinor: "10000", accountIds: ["cash"], lineIds: ["cash-line"], provenance: [source] }], liabilities: [], equity: [{ key: "Equity", label: "Equity", amountMinor: "10000", accountIds: ["equity"], lineIds: ["equity-line"], provenance: [source] }], retainedEarningsMinor: "0", totalAssetsMinor: "10000", totalLiabilitiesAndEquityMinor: "10000", differenceMinor: "0", balanced: true }, unclassified: [] }] };
const ledgerReconciliation = { period: "2026-09", verificationStatus: "verified" as const, summary: { approvedSourceRows: 1, actualCashEvents: 1, postedJournalLines: 2, sourceRowsMissingActual: 0, sourceRowsMissingJournal: 0, amountMismatches: 0, sourceUnlinkedActuals: 0, unapprovedSourcePostings: 0 }, sourceRows: [{ sourceRowId: "row", status: "reconciled" as const, journalLineIds: ["cash-line", "equity-line"] }], controls: { trialBalanceBalanced: true, statementBalances: { USD: true }, cashToStatement: [], reasons: [] } };

describe("buildJournalCalculationGraph", () => {
  it("creates source, statement, and control nodes with stable journal lineage", () => {
    const graph = buildJournalCalculationGraph({ period: "2026-09", trialBalance, statements, ledgerReconciliation, accountBalances: [] });
    expect(graph.verificationStatus).toBe("verified");
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "journal_line:cash-line", value: "cash-line", verification: { status: "verified", reasons: [] } }),
      expect.objectContaining({ id: "statement_line:USD:assets:Cash", value: "10000" }),
      expect.objectContaining({ id: "control:balance_sheet:USD", value: "0", verification: { status: "verified", reasons: [] } }),
    ]));
  });
  it("replays identical approved journal inputs into an identical graph", () => {
    const input = { period: "2026-09", trialBalance, statements, ledgerReconciliation, accountBalances: [] };
    expect(buildJournalCalculationGraph(input)).toEqual(buildJournalCalculationGraph(input));
  });
  it("makes unresolved account reconciliation an exception", () => {
    const graph = buildJournalCalculationGraph({ period: "2026-09", trialBalance, statements, ledgerReconciliation, accountBalances: [{ currency: "USD", key: "cash", accountIds: ["cash"], sourceRowIds: ["row"], ledgerMinor: "10000", statementMinor: "0", differenceMinor: "10000", status: "mismatch" }] });
    expect(graph.nodes.find((node) => node.id === "control:account_reconciliation")?.verification.status).toBe("exception");
  });
  it("makes a cash-to-bank difference a graph exception with the cash account as input", () => {
    const graph = buildJournalCalculationGraph({ period: "2026-09", trialBalance, statements, ledgerReconciliation: { ...ledgerReconciliation, controls: { ...ledgerReconciliation.controls, cashToStatement: [{ currency: "USD", journalCashMinor: "10000", statementCashMinor: "9000", differenceMinor: "1000", sourceIds: ["bank"], status: "mismatch" }] } }, accountBalances: [] });
    expect(graph.verificationStatus).toBe("exception");
    expect(graph.nodes.find((node) => node.id === "control:cash_to_statement:USD")).toMatchObject({ value: "1000", inputNodeIds: ["account_balance:USD:cash:consolidated"], verification: { status: "exception" } });
  });
  it("keeps a projected graph visibly unverified without applying actual reconciliation controls", () => {
    const graph = buildJournalCalculationGraph({ period: "2026-10", trialBalance: { ...trialBalance, period: "2026-10" }, statements: { ...statements, period: "2026-10" }, view: "projected", asOfPeriod: "2026-09" });
    expect(graph.verificationStatus).toBe("unverified");
    expect(graph.nodes.find((node) => node.id === "control:projected_basis")).toMatchObject({ verification: { status: "unverified" } });
    expect(graph.nodes.find((node) => node.id === "control:source_ledger_reconciliation")).toBeUndefined();
  });
  it("makes each FX rate and CTA reserve inspectable graph inputs", () => {
    const graph = buildJournalCalculationGraph({ period: "2026-09", trialBalance, statements, fxTranslation: { presentationCurrency: "USD", status: "ready", reasons: [], ctaMinor: "1000", selections: [{ lineId: "cash-line", rateId: "closing-rate", rateType: "closing" }] } });
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "fx_rate", id: "fx_rate:cash-line:closing-rate" }),
      expect.objectContaining({ kind: "translation_reserve", value: "1000" }),
      expect.objectContaining({ id: "control:presentation_translation:USD", verification: { status: "verified", reasons: [] } }),
    ]));
  });
  it("keeps approved allocations visible as controls until a balanced allocation entry is posted", () => {
    const graph = buildJournalCalculationGraph({ period: "2026-09", trialBalance, statements, allocationAnalysis: { lines: [{ allocationId: "allocation", eventId: "spend", period: "2026-09", payerEntityId: "manager", bearerEntityId: "fund", amountMinor: "2500", sourceId: "statement", status: "ready", reasons: [] }], controls: [{ eventId: "spend", period: "2026-09", sourceAmountMinor: "10000", allocatedMinor: "2500", unallocatedMinor: "7500", status: "reconciled", reasons: [] }] } });
    expect(graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "allocation:allocation", kind: "allocation", value: "2500" }), expect.objectContaining({ id: "control:allocation_total:spend", verification: { status: "verified", reasons: [] } })]));
  });
});
