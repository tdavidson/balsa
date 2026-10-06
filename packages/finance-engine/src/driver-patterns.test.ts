import { describe, expect, it } from "vitest";
import { describePattern, escalationSteps, patternAfterAmountChange, resolvePatternDrivers, validateSeasonality, type DriverPattern, type PatternContext } from "./driver-patterns";
import { buildProjectedEntries } from "./forecast-projections";
import { monthRange } from "./forecast-model";
import type { ForecastDriver, ForecastEntryTemplate } from "./forecast-projections";
import { summarizeActualCash } from "./forecast-actuals";
import { buildForecastRun, type ForecastAccount } from "./forecast-run";

const months = monthRange("2027-01", "2029-12");
const driver = (id: string, pattern: DriverPattern | undefined, extra: Partial<ForecastDriver> = {}): ForecastDriver => ({ id, label: id, itemType: "agreement", direction: "receipt", amountMinor: "0", cadence: "monthly", effectiveFrom: "2027-01", ...(pattern ? { pattern } : {}), ...extra });
const templates: ForecastEntryTemplate[] = [
  { id: "t-subs", itemType: "agreement", direction: "receipt", category: "subscriptions", debitAccountId: "cash", creditAccountId: "rev-subs" },
  { id: "t-services", itemType: "agreement", direction: "receipt", category: "services", debitAccountId: "cash", creditAccountId: "rev-services" },
  { id: "t-hosting", itemType: "obligation", direction: "spend", category: "hosting", debitAccountId: "cogs", creditAccountId: "cash" },
  { id: "t-sales", itemType: "obligation", direction: "spend", category: "commission", debitAccountId: "sales", creditAccountId: "cash" },
];
const accountLines = new Map([["rev-subs", "revenue"], ["rev-services", "revenue"], ["cogs", "cogs"], ["sales", "sga_sales"]]);
const resolve = (drivers: ForecastDriver[], context?: PatternContext) => resolvePatternDrivers(drivers, { months, templates, accountLines, ...(context ? { context } : {}) });
const amounts = (result: ReturnType<typeof resolve>, id: string, ...picks: string[]) => picks.map((month) => result.drivers.find((item) => item.id === id)!.amountByMonth![month]);

describe("pattern bases", () => {
  it("repeats a fixed amount monthly, quarterly or once", () => {
    const result = resolve([driver("m", { initialValue: "100", repeatsEveryMonths: 1 }), driver("q", { initialValue: "100", repeatsEveryMonths: 3 }), driver("o", { initialValue: "100", repeatsEveryMonths: 0 })]);
    expect(amounts(result, "m", "2027-01", "2027-02", "2028-06")).toEqual(["10000", "10000", "10000"]);
    expect(amounts(result, "q", "2027-01", "2027-02", "2027-04")).toEqual(["10000", "0", "10000"]);
    expect(amounts(result, "o", "2027-01", "2027-02")).toEqual(["10000", "0"]);
  });

  it("grows a salary 5% every 12 months, and an annual payment 10% a year", () => {
    const result = resolve([
      driver("salary", { initialValue: "1000", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 12, by: "0.05" } }),
      driver("licence", { initialValue: "1000", repeatsEveryMonths: 12, change: { basis: "pct_change", everyMonths: 12, by: "0.10" } }),
    ]);
    expect(amounts(result, "salary", "2027-12", "2028-01", "2029-01")).toEqual(["100000", "105000", "110250"]);
    expect(amounts(result, "licence", "2027-01", "2027-06", "2028-01", "2029-01")).toEqual(["100000", "0", "110000", "121000"]);
  });

  it("adds a fixed step, and grows logarithmically", () => {
    const result = resolve([
      driver("step", { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "abs_change", everyMonths: 3, by: "10" } }),
      driver("log", { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "log_change", everyMonths: 1, by: "0.5" } }),
    ]);
    expect(amounts(result, "step", "2027-01", "2027-03", "2027-04", "2027-07")).toEqual(["10000", "10000", "11000", "12000"]);
    // 100 × round(offset/1 + 1)^0.5: offset 1 → √2, offset 3 → √4.
    expect(amounts(result, "log", "2027-01", "2027-02", "2027-04")).toEqual(["10000", "14142", "20000"]);
  });

  it("caps each period, stops after N months, and respects the end date", () => {
    const result = resolve([
      driver("capped", { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.5" }, maxValue: "200" }),
      driver("short", { initialValue: "100", repeatsEveryMonths: 1, maxMonths: 3 }),
      driver("ends", { initialValue: "100", repeatsEveryMonths: 1 }, { effectiveTo: "2027-02" }),
    ]);
    expect(amounts(result, "capped", "2027-01", "2027-02", "2027-03", "2027-06")).toEqual(["10000", "15000", "20000", "20000"]);
    expect(amounts(result, "short", "2027-03", "2027-04")).toEqual(["10000", "0"]);
    expect(amounts(result, "ends", "2027-02", "2027-03")).toEqual(["10000", "0"]);
  });
});

describe("linked drivers", () => {
  const revenue = driver("subs", { initialValue: "12000", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.02" } }, { category: "subscriptions" });
  const services = driver("services", { initialValue: "3000", repeatsEveryMonths: 1 }, { category: "services" });

  it("sets a cost as a percentage of another driver", () => {
    const hosting = driver("hosting", { initialValue: "0.04", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "driver", driverId: "subs" } } }, { itemType: "obligation", direction: "spend", category: "hosting" });
    const result = resolve([revenue, hosting]);
    expect(amounts(result, "subs", "2027-01", "2027-02")).toEqual(["1200000", "1224000"]);
    expect(amounts(result, "hosting", "2027-01", "2027-02")).toEqual(["48000", "48960"]);
  });

  it("sets a cost per unit of an operating metric that grows on its own pattern", () => {
    const support = driver("support", { initialValue: "12", repeatsEveryMonths: 1, change: { basis: "per_unit", ref: { kind: "metric", name: "customers" } } }, { itemType: "obligation", direction: "spend" });
    const result = resolve([support], { metrics: [{ name: "customers", effectiveFrom: "2027-01", pattern: { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.1" } } }] });
    expect(amounts(result, "support", "2027-01", "2027-02", "2027-03")).toEqual(["120000", "132000", "145200"]);
    expect(result.metrics.customers?.["2027-03"]).toBe("121");
  });

  it("sets a commission as a percentage of total revenue across every revenue driver", () => {
    const commission = driver("commission", { initialValue: "0.1", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "report_line", line: "revenue" } } }, { itemType: "obligation", direction: "spend", category: "commission" });
    const result = resolve([revenue, services, commission]);
    expect(amounts(result, "commission", "2027-01")).toEqual(["150000"]);
  });

  it("reports a cycle on every driver in it and produces nothing for them", () => {
    const a = driver("a", { initialValue: "0.1", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "driver", driverId: "b" } } });
    const b = driver("b", { initialValue: "0.1", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "driver", driverId: "a" } } });
    const selfLine = driver("self", { initialValue: "0.1", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "report_line", line: "revenue" } } }, { category: "subscriptions" });
    const result = resolve([a, b, selfLine]);
    expect(result.exceptions.map((item) => item.driverId).sort()).toEqual(["a", "b", "self"]);
    expect(result.exceptions.every((item) => /refers back to itself/.test(item.reason))).toBe(true);
    expect(result.drivers.find((item) => item.id === "a")!.amountByMonth).toBeUndefined();
  });

  it("names a missing reference rather than reading it as zero", () => {
    const result = resolve([driver("x", { initialValue: "2", repeatsEveryMonths: 1, change: { basis: "per_unit", ref: { kind: "metric", name: "seats" } } })]);
    expect(result.exceptions[0]?.reason).toMatch(/No operating metric or model variable is named seats/);
  });

  it("rejects a pattern that would post a negative amount", () => {
    const result = resolve([driver("down", { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "abs_change", everyMonths: 1, by: "-60" } })]);
    expect(result.exceptions[0]?.reason).toMatch(/negative/);
  });
});

describe("seasonality and escalation", () => {
  const retail = { id: "retail", name: "Retail holiday", deviations: ["-0.2", "-0.2", "-0.1", "-0.1", "0", "0", "0", "0", "0", "0", "0.2", "0.4"] };
  const summer = { id: "summer", name: "Summer slow", deviations: ["0.1", "0.1", "0.1", "0", "-0.1", "-0.2", "-0.2", "0", "0.1", "0.1", "0", "0"] };

  it("validates that a profile sums to zero", () => {
    expect(validateSeasonality(retail)).toBeNull();
    expect(validateSeasonality({ ...retail, deviations: [...retail.deviations.slice(0, 11), "0.5"] })).toMatch(/sum to zero/);
  });

  it("shifts when an amount lands without changing the year, per driver", () => {
    const result = resolve([driver("shop", { initialValue: "1000", repeatsEveryMonths: 1, seasonalityProfileId: "retail" }), driver("camp", { initialValue: "1000", repeatsEveryMonths: 1, seasonalityProfileId: "summer" })], { seasonality: [retail, summer] });
    const year = (id: string) => monthRange("2027-01", "2027-12").reduce((sum, month) => sum + Number(amounts(result, id, month)[0]), 0);
    expect(year("shop")).toBe(1_200_000); expect(year("camp")).toBe(1_200_000);
    expect(amounts(result, "shop", "2027-12", "2027-06")).toEqual(["140000", "100000"]);
    expect(amounts(result, "camp", "2027-12", "2027-06")).toEqual(["100000", "80000"]);
  });

  it("does not compound seasonality into growth", () => {
    const result = resolve([driver("grow", { initialValue: "1000", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 12, by: "0.1" }, seasonalityProfileId: "retail" })], { seasonality: [retail] });
    expect(amounts(result, "grow", "2027-12", "2028-12")).toEqual(["140000", "154000"]);
  });

  it("escalates on whatever cycle is set, from the driver's start or a calendar month", () => {
    expect(escalationSteps({ rate: "0.03", everyMonths: 12, anchor: "driver_start" }, "2027-04", "2028-03")).toBe(0);
    expect(escalationSteps({ rate: "0.03", everyMonths: 12, anchor: "driver_start" }, "2027-04", "2028-04")).toBe(1);
    expect(escalationSteps({ rate: "0.03", everyMonths: 6, anchor: { calendarMonth: 1 } }, "2027-04", "2027-07")).toBe(1);
    expect(escalationSteps({ rate: "0.03", everyMonths: 6, anchor: { calendarMonth: 1 } }, "2027-04", "2028-01")).toBe(2);
    expect(escalationSteps({ rate: "0.03", everyMonths: 18, anchor: "driver_start" }, "2027-01", "2029-07")).toBe(1);
    const result = resolve([
      driver("lease", { initialValue: "1000", repeatsEveryMonths: 1, escalation: { rate: "0.03", everyMonths: 12, anchor: "driver_start" } }, { effectiveFrom: "2027-04" }),
      driver("company", { initialValue: "1000", repeatsEveryMonths: 1, escalation: "company" }),
    ], { escalation: { rate: "0.1", everyMonths: 6, anchor: { calendarMonth: 7 } } });
    expect(amounts(result, "lease", "2028-03", "2028-04", "2029-04")).toEqual(["100000", "103000", "106090"]);
    expect(amounts(result, "company", "2027-06", "2027-07", "2028-01")).toEqual(["100000", "110000", "121000"]);
  });

  it("compounds escalation exactly and rounds once, as a spreadsheet does", () => {
    // Rounding each step to six places would give 1.001200 after six steps; the exact power rounds to 1.001201.
    const result = resolve([driver("tiny", { initialValue: "1000000", repeatsEveryMonths: 1, escalation: { rate: "0.0002", everyMonths: 1, anchor: "driver_start" } }, { effectiveFrom: "2027-01" })]);
    expect(amounts(result, "tiny", "2027-07")).toEqual(["100120100"]);
  });

  it("explains a pattern in plain words", () => {
    expect(describePattern({ initialValue: "1000", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 12, by: "0.05" } })).toBe("1000 every month, changing 5% every year");
    expect(describePattern({ initialValue: "0.04", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "report_line", line: "revenue" } } })).toBe("4% of total revenue, every month");
    expect(describePattern({ initialValue: "100", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.07" } })).toBe("100 every month, changing 7% every month");
    expect(describePattern({ initialValue: "0.07", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "report_line", line: "revenue" } } })).toBe("7% of total revenue, every month");
  });
});

describe("in a forecast run", () => {
  it("posts pattern amounts through the normal projection and leaves fixed drivers alone", () => {
    const accounts: ForecastAccount[] = [
      { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", isCash: true },
      { accountId: "rev-subs", accountCode: "4000", accountName: "Subscriptions", accountType: "revenue", normalBalance: "credit", reportLine: "revenue" },
      { accountId: "cogs", accountCode: "5000", accountName: "Hosting", accountType: "expense", normalBalance: "debit", reportLine: "cogs" },
    ];
    const subs = driver("subs", undefined, { amountMinor: "1000000", category: "subscriptions" });
    const hosting = driver("hosting", { initialValue: "0.05", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "report_line", line: "revenue" } } }, { itemType: "obligation", direction: "spend", category: "hosting" });
    const run = buildForecastRun({ actuals: summarizeActualCash([], "USD", "2026-12"), drivers: [subs, hosting], templates, accounts, currency: "USD", asOfMonth: "2026-12", horizonMonths: 3, minimumCashMinor: "0" });
    expect(run.exceptions).toEqual([]);
    const posted = (accountId: string) => run.projectedLines.filter((line) => line.accountId === accountId && line.period === "2027-02").reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n);
    expect(posted("cogs")).toBe(50000n);
    expect(posted("rev-subs")).toBe(-1000000n);
    expect(run.months.at(-1)?.endingCashMinor).toBe(String(3 * (1000000 - 50000)));
  });
});

describe("amount changes and safety", () => {
  it("restarts a growing pattern from a changed amount, and turns a rate into a fixed amount", () => {
    expect(patternAfterAmountChange({ initialValue: "1000", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 12, by: "0.05" } }, 1500)).toMatchObject({ initialValue: "1500.00", change: { basis: "pct_change" } });
    expect(patternAfterAmountChange({ initialValue: "0.04", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "report_line", line: "revenue" } } }, 900)).toBeUndefined();
    expect(patternAfterAmountChange(undefined, 900)).toBeUndefined();
  });

  it("never projects an unresolved pattern as if its initial value were a fixed amount", () => {
    const unresolved = driver("raw", { initialValue: "500", repeatsEveryMonths: 1 }, { amountMinor: "50000", category: "subscriptions" });
    const projection = buildProjectedEntries([unresolved], templates, { start: "2027-01", end: "2027-03" });
    expect(projection.entries).toEqual([]);
    expect(projection.exceptions[0]?.reason).toMatch(/Pattern driver was not resolved/);
  });

  it("reports a stored pattern it cannot read instead of using it", () => {
    const result = resolve([driver("broken", { initialValue: "0", repeatsEveryMonths: 0, unreadable: true })]);
    expect(result.exceptions[0]?.reason).toMatch(/could not be read/);
  });
});

describe("metrics fed from actuals", () => {
  const customers = { name: "customers", effectiveFrom: "2026-01", pattern: { initialValue: "50", repeatsEveryMonths: 1, change: { basis: "pct_change" as const, everyMonths: 1, by: "0.1" } }, actuals: { "2026-11": "180", "2026-12": "200" } };
  const support = driver("support", { initialValue: "10", repeatsEveryMonths: 1, change: { basis: "per_unit", ref: { kind: "metric", name: "customers" } } }, { itemType: "obligation", direction: "spend", effectiveFrom: "2026-12" });

  it("continues the pattern from the last actual and uses actuals for their months", () => {
    const result = resolvePatternDrivers([support], { months: monthRange("2026-12", "2027-03"), templates, context: { metrics: [customers] } });
    expect(result.metrics.customers).toMatchObject({ "2026-12": "200", "2027-01": "220", "2027-02": "242" });
    expect(amounts(result, "support", "2026-12", "2027-01")).toEqual(["200000", "220000"]);
  });

  it("uses the pattern as written when there are no actuals", () => {
    const result = resolvePatternDrivers([support], { months: monthRange("2026-12", "2027-01"), templates, context: { metrics: [{ ...customers, actuals: {} }] } });
    expect(result.metrics.customers?.["2026-01"]).toBeUndefined();
    expect(Number(result.metrics.customers?.["2026-12"])).toBeCloseTo(50 * 1.1 ** 11, 3);
  });
});
