import { describe, expect, it } from "vitest";
import { adaptGeneralLedgerRows, adaptStatementFacts, adaptTransactionRows, assessPdfText, classifySource, detectSourceCurrencies, expandFinancialFactDates, extractStructuredStatementFacts, mergeStatementFacts, normalizeTransactions, parseCsvRows, parseOfx, transactionExternalKey, validateStatementRollforward } from "./index";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("transaction ingestion", () => {
  it("validates statement roll-forwards independently of model output", () => {
    expect(validateStatementRollforward({ opening: 100, receipts: 50, spending: 25, ending: 125 })).toMatchObject({ status: "matched", expectedEnding: 125, difference: 0 });
    expect(validateStatementRollforward({ opening: 100, receipts: 50, spending: 25, ending: 130 })).toMatchObject({ status: "mismatch", expectedEnding: 125, difference: 5 });
    expect(validateStatementRollforward({ receipts: 50, spending: 25, ending: 125 })).toMatchObject({ status: "incomplete" });
  });
  it("flags weak page extraction instead of treating it as complete", () => {
    expect(assessPdfText([{ page: 1, text: "" }, { page: 2, text: "" }])).toMatchObject({ status: "empty", pageCount: 2, nonEmptyPages: 0 });
    expect(assessPdfText([{ page: 1, text: "Statement period 2026-01" }, { page: 2, text: "" }])).toMatchObject({ status: "weak", nonEmptyPages: 1 });
    expect(assessPdfText([{ page: 1, text: "Beginning balance $100.00; ending balance $125.00; transaction activity" }])).toMatchObject({ status: "good", characters: 71 });
  });
  it("classifies source shape before extraction", () => {
    expect(classifySource({ filename: "January bank statement.pdf", text: "Beginning balance 100.00 Account activity Ending balance 125.00" })).toMatchObject({ kind: "bank_statement", containsTransactions: true, containsBalances: true });
    expect(classifySource({ filename: "quickbooks-detail.xlsx", text: "Date,Description,Debit,Credit" })).toMatchObject({ kind: "quickbooks_transactions", containsTransactions: true });
    expect(classifySource({ filename: "board-model.xlsx", text: "Income statement Forecast Assumptions", sourceRole: "reference_model" })).toMatchObject({ kind: "financial_model", confidence: "high" });
    expect(classifySource({ filename: "balance-sheet.pdf", text: "Balance Sheet Total Assets Total Liabilities" })).toMatchObject({ kind: "balance_sheet", containsBalances: true });
  });
  it("records only explicitly named source currencies", () => {
    expect(detectSourceCurrencies("Currency: CAD\nCAD 1,200.00")).toEqual(["CAD"]);
    expect(detectSourceCurrencies("$1,200.00")).toEqual([]);
    expect(detectSourceCurrencies("USD 100.00 and EUR 50.00")).toEqual(["USD", "EUR"]);
  });
  it("extracts common printed P&L and balance-sheet lines deterministically", () => {
    expect(extractStructuredStatementFacts("Income Statement\nRevenue | $12,500.00\nOperating Expenses | ($3,200.00)\nNet Income | $9,300.00", "profit_and_loss")).toMatchObject([
      { label: "Revenue", value: "$12,500.00", accountingRole: "revenue" },
      { label: "Operating Expenses", value: "($3,200.00)", accountingRole: "expense" },
      { label: "Net Income", value: "$9,300.00", accountingRole: "summary" },
    ]);
    expect(extractStructuredStatementFacts("Balance Sheet\nCash and Cash Equivalents $44,200.00\nTotal Assets $92,000.00", "balance_sheet")).toHaveLength(2);
  });
  it("prefers a deterministic statement line over a model duplicate", () => {
    expect(mergeStatementFacts([{ label: "Revenue", value: "$12,000.00", accountingRole: "revenue", confidence: 0.8 }, { label: "Management agreement", value: "$1,000 monthly", accountingRole: "agreement", confidence: 0.8 }], [{ label: "Revenue", value: "$12,500.00", accountingRole: "revenue", confidence: 0.98 }])).toEqual([
      { label: "Revenue", value: "$12,500.00", accountingRole: "revenue", confidence: 0.98 },
      { label: "Management agreement", value: "$1,000 monthly", accountingRole: "agreement", confidence: 0.8 },
    ]);
  });
  it("normalizes quoted CSV, debit/credit, and dates across months", () => {
    const rows = parseCsvRows('Date,Description,Debit,Credit\n2026-09-03,"Customer, payment",,12500\n2026-10-15,Contractor,3200,');
    expect(normalizeTransactions(rows, "2026-09")).toEqual([
      { date: "2026-09", postedDate: "2026-09-03", description: "Customer, payment", amount: 12500, direction: "receipt", sourceLocation: "row:2" },
      { date: "2026-10", postedDate: "2026-10-15", description: "Contractor", amount: 3200, direction: "spend", sourceLocation: "row:3" },
    ]);
  });
  it("adapts cash, ledger, and statement sources into distinct typed rows", () => {
    expect(adaptTransactionRows("bank_statement", [{ date: "2026-09", postedDate: "2026-09-03", description: "Client receipt", amount: 125, direction: "receipt", sourceLocation: "row:2" }], "USD")).toMatchObject([{ rowType: "bank_transaction", period: "2026-09", amount: "125.00", currency: "USD" }]);
    expect(adaptGeneralLedgerRows(parseCsvRows("Date,Account,Description,Debit,Credit\n2026-09-03,Management Fees,Client invoice,,125.00"), "2026-09", "USD")).toMatchObject([{ rowType: "general_ledger_line", accountName: "Management Fees", debitMinor: "0", creditMinor: "12500" }]);
    expect(adaptStatementFacts("balance_sheet", [{ label: "Cash", value: "$500.00", accountingRole: "closing_balance" }], "2026-09", "USD")).toMatchObject([{ rowType: "balance", amount: "500.00", currency: "USD" }]);
  });

  it("adapts common general-ledger export aliases without treating totals as activity", () => {
    expect(adaptGeneralLedgerRows(parseCsvRows('Posting Date,GL Account,Transaction Description,Debits,Credits\n2026-09-03,Management Fees,Client invoice,,"$1,250.00"'), "2026-09", "USD")).toMatchObject([
      { rowType: "general_ledger_line", accountName: "Management Fees", transactionDate: "2026-09-03", debitMinor: "0", creditMinor: "125000", sourceLocation: "row:2" },
    ]);
  });
  it("bootstraps QuickBooks OFX transactions", () => {
    expect(parseOfx("<STMTTRN><DTPOSTED>20260903<TRNAMT>-3200<NAME>Contractor<MEMO>September invoice</STMTTRN>")).toEqual([{ date: "2026-09", postedDate: "2026-09-03", description: "Contractor · September invoice", amount: 3200, direction: "spend", sourceLocation: "transaction:1" }]);
  });

  it("keeps exact dates and note fields from bank transaction lists", () => {
    const rows = parseCsvRows("Date,Amount,Name,Note\n2026-07-14,60000,Incoming wire,Example Fund II management fee");
    expect(normalizeTransactions(rows, "2026-09")).toEqual([{
      date: "2026-07",
      postedDate: "2026-07-14",
      description: "Incoming wire · Example Fund II management fee",
      amount: 60000,
      direction: "receipt",
      sourceLocation: "row:2",
    }]);
  });

  it("handles realistic bank-export headers and financial amount formats", () => {
    const rows = parseCsvRows('Posted Date,Transaction Description,Money Out,Money In,Details\n2026-08-04,Vendor ACH,"$1,250.50",,Invoice 42\n2026-08-06,Client wire,,"(2,500.00)",August fee');
    expect(normalizeTransactions(rows, "2026-08")).toEqual([
      { date: "2026-08", postedDate: "2026-08-04", description: "Vendor ACH · Invoice 42", amount: 1250.5, direction: "spend", sourceLocation: "row:2" },
      { date: "2026-08", postedDate: "2026-08-06", description: "Client wire · August fee", amount: 2500, direction: "receipt", sourceLocation: "row:3" },
    ]);
  });

  it("expands abbreviated statement dates using the source year", () => {
    expect(expandFinancialFactDates([
      { label: "Cash Flow Activity 7/30", value: "Activity Date 7/30; $24,811.88" },
      { label: "Beginning value as of 7/1/26", value: "$348,126.13" },
    ], "2026-07-31")).toEqual([
      { label: "Cash Flow Activity 2026-07-30", value: "Activity Date 2026-07-30; $24,811.88" },
      { label: "Beginning value as of 2026-07-01", value: "$348,126.13" },
    ]);
  });

  it("gives the same transaction a stable identity across repeated imports", () => {
    const transaction = { date: "2026-09", description: "Customer payment", amount: 12500, direction: "receipt" as const };
    expect(transactionExternalKey(transaction)).toBe(transactionExternalKey({ ...transaction }));
    expect(transactionExternalKey(transaction)).not.toBe(transactionExternalKey({ ...transaction, amount: 12500.01 }));
    expect(transactionExternalKey({ ...transaction, postedDate: "2026-09-03" })).not.toBe(transactionExternalKey({ ...transaction, postedDate: "2026-09-04" }));
  });

  it("loads the Company Zero multi-month fixture without assigning it to the selected month", () => {
    const csv = readFileSync(resolve(process.cwd(), "../../fixtures/company-zero/bank-transactions.csv"), "utf8");
    const transactions = normalizeTransactions(parseCsvRows(csv), "2026-09");
    expect(transactions.map((transaction) => transaction.date)).toEqual(["2026-09", "2026-09", "2026-10", "2026-10"]);
    expect(transactions.reduce((sum, transaction) => sum + (transaction.direction === "receipt" ? transaction.amount : -transaction.amount), 0)).toBe(18600);
  });
});
