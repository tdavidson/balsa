import { describe, expect, it } from "vitest";
import type { PostedJournalLine } from "./ledger";
import { buildJournalStatements } from "./statements";
import { buildStandardStatements, fiscalYearOf, resolveStandardMapping, rollupStandardByFiscalYear, standardMappingComplete, suggestStandardLine, type ReportCategory, type StandardMappingAccount, type StandardRow } from "./standard-layout";

type Account = StandardMappingAccount;
const account = (accountId: string, accountType: string, accountName: string, extra: Partial<Account> = {}): Account => ({ accountId, accountCode: accountId, accountName, accountType, normalBalance: accountType === "asset" || accountType === "expense" ? "debit" : "credit", ...extra });

const chart: Account[] = [
  account("1000", "asset", "Operating checking", { balanceTiming: "current" }),
  account("1100", "asset", "Accounts receivable", { balanceTiming: "current", workingCapitalCategory: "receivables" }),
  account("1500", "asset", "Computer equipment", { balanceTiming: "noncurrent" }),
  account("1510", "contra", "Accumulated depreciation", { statementSection: "asset", normalBalance: "credit", balanceTiming: "noncurrent" }),
  account("2000", "liability", "Accounts payable", { balanceTiming: "current" }),
  account("2100", "liability", "Sales tax payable", { balanceTiming: "current" }),
  account("2500", "liability", "SAFE notes", { balanceTiming: "noncurrent" }),
  account("3000", "equity", "Common stock"),
  account("3900", "equity", "Retained earnings"),
  account("4000", "revenue", "Subscription revenue"),
  account("4010", "revenue", "Services revenue"),
  account("4050", "contra", "Sales discounts", { statementSection: "revenue", normalBalance: "debit" }),
  account("4900", "revenue", "Interest earned"),
  account("5000", "expense", "Hosting cost of revenue"),
  account("6000", "expense", "Google Ads advertising"),
  account("6100", "expense", "Engineering contractors"),
  account("6200", "expense", "Office rent"),
  account("6900", "expense", "Depreciation expense"),
  account("6990", "expense", "Sundry"),
];
const byId = new Map(chart.map((item) => [item.accountId, item]));

let sequence = 0;
/** One balanced entry: each leg is [accountId, signed amount], positive = debit. */
function entry(period: string, legs: [string, number][]): PostedJournalLine[] {
  const entryId = `e${++sequence}`;
  return legs.map(([accountId, amount], index) => {
    const item = byId.get(accountId)!;
    return { id: `${entryId}-${index}`, entryId, accountId, accountCode: item.accountCode, accountName: item.accountName, accountType: item.accountType, normalBalance: item.normalBalance, ...(item.statementSection ? { statementSection: item.statementSection } : {}), ...(item.balanceTiming ? { balanceTiming: item.balanceTiming } : {}), ...(item.workingCapitalCategory ? { workingCapitalCategory: item.workingCapitalCategory } : {}), currency: "USD", debitMinor: String(amount > 0 ? amount : 0), creditMinor: String(amount < 0 ? -amount : 0), period, postingDate: `${period}-15` };
  });
}

const journal = [
  ...entry("2026-01", [["1000", 500_000], ["3000", -500_000]]),
  ...entry("2026-01", [["1000", 200_000], ["2500", -200_000]]),
  ...entry("2026-01", [["1500", 36_000], ["1000", -36_000]]),
  ...entry("2026-02", [["1100", 120_000], ["4000", -100_000], ["4010", -20_000]]),
  ...entry("2026-02", [["4050", 5_000], ["1100", -5_000]]),
  ...entry("2026-02", [["1000", 90_000], ["1100", -90_000]]),
  ...entry("2026-02", [["1000", 1_200], ["4900", -1_200]]),
  ...entry("2026-02", [["5000", 15_000], ["6000", 22_000], ["6100", 40_000], ["6200", 8_000], ["6990", 700], ["2000", -85_700]]),
  ...entry("2026-02", [["6900", 1_000], ["1510", -1_000]]),
  ...entry("2026-02", [["1000", 2_000], ["2100", -2_000]]),
  ...entry("2026-03", [["1100", 110_000], ["4000", -110_000]]),
  ...entry("2026-03", [["2000", 60_000], ["1000", -60_000]]),
  ...entry("2026-03", [["6900", 1_000], ["1510", -1_000]]),
];
const categories: ReportCategory[] = [
  { id: "cat-subs", line: "revenue", name: "Subscriptions", sortOrder: 1 },
  { id: "cat-services", line: "revenue", name: "Services", sortOrder: 2 },
];
const row = (rows: StandardRow[], key: string) => rows.find((item) => item.key === key)!;

describe("suggestStandardLine", () => {
  it("suggests a line from the chart's own classifications and names", () => {
    const suggested = Object.fromEntries(chart.map((item) => [item.accountName, suggestStandardLine(item).line]));
    expect(suggested).toMatchObject({
      "Operating checking": "cash", "Accounts receivable": "accounts_receivable", "Computer equipment": "ppe", "Accumulated depreciation": "accumulated_depreciation",
      "Accounts payable": "accounts_payable", "Sales tax payable": "vat_payable", "SAFE notes": "convertible_notes_safes", "Common stock": "equity_investment", "Retained earnings": "retained_earnings",
      "Subscription revenue": "revenue", "Sales discounts": "revenue", "Interest earned": "interest_income", "Hosting cost of revenue": "cogs", "Google Ads advertising": "sga_sales",
      "Engineering contractors": "sga_rd", "Office rent": "sga_ga", "Depreciation expense": "depreciation", "Sundry": "sga_misc",
    });
  });

  it("marks an account no rule recognises as a fallback, and a sectionless contra as unclassified", () => {
    expect(suggestStandardLine(byId.get("6990")!)).toMatchObject({ line: "sga_misc", status: "fallback" });
    expect(suggestStandardLine(account("9", "asset", "Mystery", { balanceTiming: "noncurrent" }))).toMatchObject({ line: "other_assets", status: "fallback" });
    expect(suggestStandardLine(account("x", "contra", "Allowance"))).toMatchObject({ line: null, status: "unclassified" });
  });
});

describe("resolveStandardMapping", () => {
  it("prefers the confirmed line, keeps a category only under its own line, and ignores a line from another section", () => {
    const mapping = resolveStandardMapping([
      { ...byId.get("6990")!, reportLine: "sga_ga" },
      { ...byId.get("4000")!, reportLine: "revenue", reportCategoryId: "cat-subs" },
      { ...byId.get("4010")!, reportLine: "other_income", reportCategoryId: "cat-services" },
      { ...byId.get("6200")!, reportLine: "revenue" },
    ], categories);
    expect(mapping.get("6990")).toMatchObject({ line: "sga_ga", status: "confirmed" });
    expect(mapping.get("4000")).toMatchObject({ line: "revenue", categoryId: "cat-subs", status: "confirmed" });
    expect(mapping.get("4010")).toMatchObject({ line: "other_income", categoryId: null, status: "confirmed" });
    expect(mapping.get("6200")).toMatchObject({ line: "sga_ga", status: "suggested" });
    expect(standardMappingComplete(mapping.values())).toBe(false);
    expect(standardMappingComplete(resolveStandardMapping([{ ...byId.get("6990")!, reportLine: "sga_ga" }], []).values())).toBe(true);
  });
});

describe("buildStandardStatements", () => {
  const accounts = chart.map((item) => item.accountId === "4000" ? { ...item, reportLine: "revenue" as const, reportCategoryId: "cat-subs" } : item.accountId === "4010" ? { ...item, reportLine: "revenue" as const, reportCategoryId: "cat-services" } : item);

  it("ties every total to the ledger statements for each period", () => {
    for (const period of ["2026-01", "2026-02", "2026-03"]) {
      const ledger = buildJournalStatements(journal, period).byCurrency[0]!;
      const standard = buildStandardStatements(journal, period, { accounts, categories }).byCurrency[0]!;
      expect(standard.checks.every((check) => check.ok), JSON.stringify(standard.checks)).toBe(true);
      expect(row(standard.incomeStatement, "net_income").amountMinor).toBe(ledger.incomeStatement.netIncomeMinor);
      expect(row(standard.balanceSheet, "total_assets").amountMinor).toBe(ledger.balanceSheet.totalAssetsMinor);
      expect(row(standard.balanceSheet, "total_liabilities_equity").amountMinor).toBe(ledger.balanceSheet.totalLiabilitiesAndEquityMinor);
      expect(row(standard.balanceSheet, "balance_check").amountMinor).toBe("0");
    }
  });

  it("builds the Standard income statement shape", () => {
    const usd = buildStandardStatements(journal, "2026-02", { accounts, categories }).byCurrency[0]!;
    const is = usd.incomeStatement;
    expect(row(is, "line:revenue").amountMinor).toBe("115000");
    expect(row(is, "line:cogs").amountMinor).toBe("15000");
    expect(row(is, "gross_margin").amountMinor).toBe("100000");
    expect(row(is, "sga").amountMinor).toBe("70700");
    expect(row(is, "ebitda").amountMinor).toBe("29300");
    expect(row(is, "line:interest_income").amountMinor).toBe("1200");
    expect(row(is, "line:depreciation").amountMinor).toBe("1000");
    expect(row(is, "ebt").amountMinor).toBe("29500");
    expect(row(is, "net_income").amountMinor).toBe("29500");
  });

  it("splits a line into its categories with the remainder uncategorized", () => {
    const is = buildStandardStatements(journal, "2026-02", { accounts, categories }).byCurrency[0]!.incomeStatement;
    expect(row(is, "category:cat-subs").amountMinor).toBe("100000");
    expect(row(is, "category:cat-services").amountMinor).toBe("20000");
    expect(row(is, "uncategorized:revenue")).toMatchObject({ amountMinor: "-5000", accounts: [{ accountId: "4050", amountMinor: "-5000" }] });
    expect(is.filter((item) => item.kind === "category").map((item) => item.label)).toEqual(["Subscriptions", "Services"]);
  });

  it("presents contra assets and unclosed earnings so the balance sheet balances", () => {
    const bs = buildStandardStatements(journal, "2026-03", { accounts, categories }).byCurrency[0]!.balanceSheet;
    expect(row(bs, "line:accumulated_depreciation").amountMinor).toBe("-2000");
    expect(row(bs, "line:convertible_notes_safes").amountMinor).toBe("200000");
    expect(row(bs, "current_earnings").amountMinor).toBe("138500");
    expect(row(bs, "balance_check").amountMinor).toBe("0");
  });

  it("lists each contributing account so a figure can be drilled into", () => {
    const usd = buildStandardStatements(journal, "2026-02", { accounts, categories }).byCurrency[0]!;
    for (const item of [...usd.incomeStatement, ...usd.balanceSheet].filter((candidate) => candidate.kind !== "subtotal" && candidate.kind !== "total")) {
      expect(item.accounts.reduce((amount, entry) => amount + BigInt(entry.amountMinor), 0n).toString(), item.key).toBe(item.amountMinor);
    }
    expect(row(usd.incomeStatement, "line:sga_ga").accounts).toEqual([{ accountId: "6200", amountMinor: "8000" }]);
  });

  it("gives every period the same rows, so periods line up as columns", () => {
    const keys = (period: string) => { const usd = buildStandardStatements(journal, period, { accounts, categories }).byCurrency[0]!; return [...usd.incomeStatement, ...usd.balanceSheet, ...usd.cashFlow].map((item) => item.key); };
    expect(keys("2026-01")).toEqual(keys("2026-03"));
  });

  it("returns the full row set at zero for a requested currency with no lines", () => {
    const empty = buildStandardStatements([], "2026-01", { accounts, categories, currency: "USD" }).byCurrency;
    expect(empty).toHaveLength(1);
    expect(empty[0]!.incomeStatement.map((item) => item.key)).toEqual(buildStandardStatements(journal, "2026-02", { accounts, categories }).byCurrency[0]!.incomeStatement.map((item) => item.key));
    expect(empty[0]!.incomeStatement.every((item) => item.amountMinor === "0")).toBe(true);
  });

  it("flags an account it cannot place instead of dropping it silently", () => {
    const orphan: Account = account("1999", "contra", "Unassigned contra");
    byId.set(orphan.accountId, orphan);
    const lines = [...journal, ...entry("2026-03", [["1000", 300], ["1999", -300]])];
    const usd = buildStandardStatements(lines, "2026-03", { accounts: [...accounts, orphan], categories }).byCurrency[0]!;
    expect(usd.unplacedAccountIds).toEqual(["1999"]);
    expect(usd.checks.find((check) => check.key === "all_accounts_placed")?.ok).toBe(false);
  });
});

describe("rollupStandardByFiscalYear", () => {
  it("names a fiscal year by the calendar year it ends in", () => {
    expect(fiscalYearOf("2026-06", 6)).toBe(2026);
    expect(fiscalYearOf("2026-07", 6)).toBe(2027);
    expect(fiscalYearOf("2026-12", 12)).toBe(2026);
  });

  it("sums flows, takes the closing balance sheet, and marks a partial year", () => {
    const columns = ["2026-01", "2026-02", "2026-03"].map((period) => ({ period, basis: "actual" as const, statement: buildStandardStatements(journal, period, { accounts: chart, categories: [] }).byCurrency[0]! }));
    const [year] = rollupStandardByFiscalYear(columns, 12);
    expect(year).toMatchObject({ fiscalYear: 2026, complete: false, periods: ["2026-01", "2026-02", "2026-03"] });
    const sumOf = (key: string) => columns.reduce((amount, column) => amount + BigInt(row(column.statement.incomeStatement, key).amountMinor), 0n).toString();
    expect(row(year!.statement.incomeStatement, "net_income").amountMinor).toBe(sumOf("net_income"));
    expect(row(year!.statement.balanceSheet, "total_assets").amountMinor).toBe(row(columns[2]!.statement.balanceSheet, "total_assets").amountMinor);
    expect(row(year!.statement.cashFlow, "cf_cash_end").amountMinor).toBe(row(columns[2]!.statement.cashFlow, "cf_cash_end").amountMinor);
  });
});
