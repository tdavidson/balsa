import { describe, expect, it } from "vitest";
import { buildForecastRun, type ForecastAccount, type ForecastRunInput } from "./forecast-run";
import { stableJson } from "./stable-json";
import type { PostedJournalLine } from "./ledger";

const accounts: ForecastAccount[] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "equity", accountCode: "3000", accountName: "Owner capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "payroll", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" },
];
const account = (id: string) => accounts.find((candidate) => candidate.accountId === id)!;
const posted = (id: string, accountId: string, debitMinor: string, creditMinor: string, period: string, basis: PostedJournalLine["basis"] = "actual"): PostedJournalLine => ({ ...account(accountId), id, entryId: id.split(":")[0]!, basis, currency: "USD", debitMinor, creditMinor, period });

// Cash: 1,200,000 in May; 100,000 of payroll each month June–August → 900,000 at the August as-of.
const history: PostedJournalLine[] = [
  posted("capital:0", "cash", "1200000", "0", "2026-05"), posted("capital:1", "equity", "0", "1200000", "2026-05"),
  ...["2026-06", "2026-07", "2026-08"].flatMap((month) => [posted(`pay-${month}:0`, "payroll", "100000", "0", month), posted(`pay-${month}:1`, "cash", "0", "100000", month)]),
];
const templates: ForecastRunInput["templates"] = [
  { id: "spend", itemType: "obligation", direction: "spend", debitAccountId: "payroll", creditAccountId: "cash" },
  { id: "receipt", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "revenue" },
];
const payroll: ForecastRunInput["drivers"][number] = { id: "payroll", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-payroll" };
const retainer: ForecastRunInput["drivers"][number] = { id: "retainer", label: "Retainer", itemType: "agreement", direction: "receipt", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09" };
const base: ForecastRunInput = { actualLines: history, drivers: [payroll], templates, accounts, currency: "USD", asOfMonth: "2026-08", horizonMonths: 24, minimumCashMinor: "0" };
const value = (run: ReturnType<typeof buildForecastRun>, id: string) => run.nodes.find((node) => node.id === id)?.value;

describe("buildForecastRun", () => {
  it("projects cash forward and finds the cash-out month", () => {
    const run = buildForecastRun(base);
    expect(run.horizon).toEqual({ start: "2026-09", end: "2028-08" });
    expect(value(run, "ending_cash:2026-08")).toBe("900000");
    expect(value(run, "ending_cash:2026-09")).toBe("800000");
    expect(value(run, "net_burn:2026-09")).toBe("100000");
    // 900,000 − 100,000·n < 0 first at n = 10.
    expect(run.runway.cashOutMonth).toBe("2027-06");
    expect(run.runway.runwayMonths).toBe(10);
    expect(run.verificationStatus).toBe("verified");
  });

  it("uses trailing actual burn for context", () => {
    const run = buildForecastRun(base);
    expect(run.runway.trailingBurn3mMinor).toBe("100000");
    expect(run.runway.cashOverTrailingBurn).toBe("9.0");
  });

  it("honours a minimum cash floor above zero", () => {
    const run = buildForecastRun({ ...base, minimumCashMinor: "200000" });
    // 900,000 − 100,000·n < 200,000 first at n = 8.
    expect(run.runway.cashOutMonth).toBe("2027-04");
    expect(run.runway.runwayMonths).toBe(8);
  });

  it("reports no cash-out inside the horizon", () => {
    expect(buildForecastRun({ ...base, drivers: [payroll, retainer] }).runway).toMatchObject({ cashOutMonth: null, runwayMonths: null });
    expect(buildForecastRun({ ...base, horizonMonths: 6 }).runway.cashOutMonth).toBeNull();
  });

  it("has no trailing ratio when cash is not burning", () => {
    const run = buildForecastRun({ ...base, actualLines: history.filter((line) => line.id.startsWith("capital")) });
    expect(run.runway.trailingBurn3mMinor).toBe("0");
    expect(run.runway.cashOverTrailingBurn).toBeNull();
  });

  it("keeps driver lineage on nodes and projected lines", () => {
    const run = buildForecastRun(base);
    expect(run.nodes.find((node) => node.id === "ending_cash:2026-09")?.driverIds).toEqual(["payroll"]);
    expect(run.projectedLines[0]).toMatchObject({ basis: "forecast", period: "2026-09", provenance: { sourceLocation: "forecast-driver:payroll" } });
  });

  it("excludes unmapped drivers as exceptions without moving cash", () => {
    const orphan = { ...retainer, id: "orphan", itemType: "agreement" as const, category: "unmapped" };
    const run = buildForecastRun({ ...base, templates: [templates[0]!], drivers: [payroll, orphan] });
    expect(run.exceptions.map((exception) => exception.driverId)).toEqual(["orphan"]);
    expect(run.verificationStatus).toBe("exception");
    expect(run.runway.cashOutMonth).toBe("2027-06");
  });

  it("excludes drivers whose template account is not an active account", () => {
    const run = buildForecastRun({ ...base, accounts: accounts.filter((candidate) => candidate.accountId !== "payroll") });
    expect(run.exceptions).toEqual([{ driverId: "payroll", reason: "Forecast template account payroll is not an active chart account." }]);
    expect(run.projectedLines).toEqual([]);
  });

  it("ignores posted plan, forecast and scenario journals", () => {
    const withPlan = { ...base, actualLines: [...history, posted("plan:0", "cash", "999999", "0", "2026-08", "plan"), posted("plan:1", "revenue", "0", "999999", "2026-08", "plan")] };
    expect(value(buildForecastRun(withPlan), "ending_cash:2026-08")).toBe("900000");
  });

  it("is deterministic regardless of driver order", () => {
    const one = buildForecastRun({ ...base, drivers: [payroll, retainer] });
    const two = buildForecastRun({ ...base, drivers: [retainer, payroll] });
    expect(stableJson(one)).toBe(stableJson(two));
  });
});
