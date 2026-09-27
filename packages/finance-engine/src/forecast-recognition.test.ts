import { describe, expect, it } from "vitest";
import { buildProjectedEntries, type ForecastDriver, type RecognitionProof } from "./forecast-projections";
const accounts = [{ accountId: "cash", accountName: "Cash", accountType: "asset" }, { accountId: "expense", accountName: "Expense", accountType: "expense" }, { accountId: "revenue", accountName: "Revenue", accountType: "revenue" }, ...[["prepaids", "asset"], ["receivables", "asset"], ["payables", "liability"], ["deferred_revenue", "liability"]].map(([id, type]) => ({ accountId: id!, accountName: id!, accountType: type!, workingCapitalCategory: id! }))];
const driver: ForecastDriver = { id: "one", label: "Synthetic service", itemType: "obligation", direction: "spend", amountMinor: "10001", cadence: "once", effectiveFrom: "2026-10", accountingTreatment: "prepaid", recognitionStart: "2026-10", recognitionEnd: "2026-12" };
function run(value = driver, chart = accounts) { return buildProjectedEntries([value], [{ id: "template", itemType: value.itemType, direction: value.direction, debitAccountId: value.direction === "spend" ? "expense" : "cash", creditAccountId: value.direction === "spend" ? "cash" : "revenue" }], { start: "2026-09", end: "2027-02" }, undefined, chart); }
describe("projected recognition journals", () => {
  it.each(["prepaid", "accrual"])("balances %s receipts and spending with exact penny allocation", (accountingTreatment) => {
    for (const direction of ["spend", "receipt"] as const) {
      const value: ForecastDriver = { ...driver, direction, itemType: direction === "spend" ? "obligation" : "agreement", accountingTreatment, effectiveFrom: accountingTreatment === "prepaid" ? "2026-09" : "2027-01" };
      const result = run(value); expect(result.exceptions).toEqual([]); expect(result.entries).toHaveLength(4);
      const cash = result.entries.filter((entry) => entry.lines.some((line) => line.accountId === "cash")); expect(cash).toHaveLength(1); expect(cash[0]?.period).toBe(value.effectiveFrom);
      const recognition = result.entries.filter((entry) => entry.projectionKey.endsWith(":recognition")); expect(recognition.map((entry) => entry.lines[0]!.debitMinor)).toEqual(["3334", "3334", "3333"]);
      for (const entry of result.entries) expect(entry.lines.reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n)).toBe(0n);
      const holding = accountingTreatment === "prepaid" ? direction === "spend" ? "prepaids" : "deferred_revenue" : direction === "spend" ? "payables" : "receivables";
      expect(result.entries.flatMap((entry) => entry.lines).filter((line) => line.accountId === holding).reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n)).toBe(0n);
    }
  });
  it("refuses ambiguous mappings, past unsupported balances, formulas and recurring recognition", () => {
    for (const value of [{ ...driver, effectiveFrom: "2026-08" }, { ...driver, recognitionEnd: "2029-01" }, { ...driver, cadence: "monthly" as const }, { ...driver, amountFormula: "100", amountByMonth: { "2026-10": "10000" } }]) expect(run(value).exceptions).toHaveLength(1);
    expect(run(driver, [...accounts, { accountId: "other", accountName: "Other", accountType: "asset", workingCapitalCategory: "prepaids" }]).exceptions).toHaveLength(1);
    expect(run(driver, accounts.filter((account) => account.accountId !== "prepaids")).entries).toHaveLength(0);
  });
  it("carries an exactly reconciled schedule across months without repeating its payment or changing pennies", () => {
    const full = run(); const completed = full.entries.filter((entry) => entry.period === "2026-10");
    const proof: RecognitionProof = { driverId: driver.id, currency: "USD", throughMonth: "2026-10", valid: true, lines: completed.flatMap((entry) => entry.lines.map((line, index) => ({ ...line, id: `${entry.projectionKey}:${index}`, entryId: entry.projectionKey, accountCode: line.accountId, accountName: line.accountId, accountType: line.accountId === "expense" ? "expense" : "asset", normalBalance: "debit" as const, currency: "USD", period: entry.period, postingDate: entry.postingDate, basis: "actual" as const }))) };
    const templates = [{ id: "template", itemType: driver.itemType, direction: driver.direction, debitAccountId: "expense", creditAccountId: "cash" }];
    const next = buildProjectedEntries([driver], templates, { start: "2026-11", end: "2027-02" }, undefined, accounts, [proof]);
    expect(next.exceptions).toEqual([]); expect(next.entries.map((entry) => [entry.period, entry.lines[0]!.debitMinor])).toEqual([["2026-11", "3334"], ["2026-12", "3333"]]);
    expect(next.entries.flatMap((entry) => entry.lines).some((line) => line.accountId === "cash")).toBe(false);
    const mismatch = { ...proof, lines: proof.lines.slice(1) };
    expect(buildProjectedEntries([driver], templates, { start: "2026-11", end: "2027-02" }, undefined, accounts, [mismatch]).exceptions[0]?.reason).toContain("does not reconcile");
    expect(buildProjectedEntries([driver], templates, { start: "2026-11", end: "2027-02" }, undefined, accounts, [{ ...proof, valid: false }]).entries).toHaveLength(0);
  });

});
