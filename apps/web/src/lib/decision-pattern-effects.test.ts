import { describe, expect, it } from "vitest";
import { buildForecastRun, type ForecastRunInput } from "@balsa/finance-engine";
import { fixtureBaseInput } from "@/test/forecast-fixture";
import { decisionEffectSchema, effectFromFlat, effectToFlat, flatEffectJsonSchema, flatEffectSchema, type DecisionEffect } from "./decision-effects";
import { projectDecisionEffect } from "./decision-driver-effects";

const pattern = { initialValue: "0.04", repeatsEveryMonths: 1, change: { basis: "pct_of" as const, ref: { kind: "report_line" as const, line: "revenue" } } };
const effects: DecisionEffect[] = [
  { kind: "set_item_pattern", itemId: "00000000-0000-4000-8000-000000000001", pattern },
  { kind: "set_item_pattern", itemId: "00000000-0000-4000-8000-000000000001", pattern: null },
  { kind: "set_metric", metric: { name: "customers", label: "Customers", unit: "customers", effectiveFrom: "2027-01", effectiveTo: null, pattern: { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.05" } } } },
  { kind: "set_metric_actuals", actuals: { name: "customers", values: [{ month: "2026-09", value: "180", factId: "00000000-0000-4000-8000-000000000002", evidenceId: null }] } },
  { kind: "add_item", item: { label: "Hosting", direction: "spend", amount: 1500, cadence: "monthly", effectiveFrom: "2027-01", category: "other", accountingTreatment: "cash", pattern, accountId: "00000000-0000-4000-8000-000000000003", cashAccountId: "00000000-0000-4000-8000-000000000004" } },
];

describe("pattern decision effects", () => {
  it("round-trip through the agent's flat form", () => {
    for (const effect of effects) {
      const flat = effectToFlat(decisionEffectSchema.parse(effect));
      expect(flatEffectSchema.parse(flat)).toEqual(flat);
      // The flat form spells absent values as null; both mean "not set".
      const withoutNulls = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_, item) => (item === null ? undefined : item)));
      expect(withoutNulls(effectFromFlat(flat))).toEqual(withoutNulls(decisionEffectSchema.parse(effect)));
    }
  });

  it("keeps the strict JSON schema in step with the parser", () => {
    const required = new Set((flatEffectJsonSchema as { required: string[] }).required);
    expect(new Set(Object.keys(flatEffectSchema.shape))).toEqual(required);
    expect(Object.keys(effectToFlat(effects[0]!)).sort()).toEqual([...required].sort());
  });

  it("drops an effect whose pattern is not valid instead of guessing", () => {
    const flat = { ...effectToFlat(effects[0]!), patternJson: "{\"initialValue\":\"four percent\"}" };
    expect(effectFromFlat(flat)).toBeUndefined();
    expect(effectFromFlat({ ...flat, patternJson: "not json" })).toBeUndefined();
  });

  it("previews a new driver for an account the way applying it posts", () => {
    const base = fixtureBaseInput();
    const cash = base.accounts.find((account) => account.isCash !== false && /cash/i.test(account.accountName))!;
    const expense = base.accounts.find((account) => account.accountType === "expense")!;
    const effect: DecisionEffect = { kind: "add_item", item: { label: "Tooling", direction: "spend", amount: 700, cadence: "monthly", effectiveFrom: base.asOfMonth === "2026-12" ? "2027-01" : nextMonth(base.asOfMonth), category: "other", accountingTreatment: "cash", accountId: expense.accountId, cashAccountId: cash.accountId } };
    const projected: ForecastRunInput = projectDecisionEffect(base, effect, "d9");
    const driver = projected.drivers.find((candidate) => candidate.id === "decision:d9")!;
    expect(driver.templateId).toBeDefined();
    const run = buildForecastRun(projected);
    expect(run.exceptions.filter((exception) => exception.driverId === "decision:d9")).toEqual([]);
    expect(run.projectedLines.some((line) => line.accountId === expense.accountId && line.debitMinor === "70000")).toBe(true);
  });
});

function nextMonth(month: string) { const [year, number] = month.split("-").map(Number) as [number, number]; const date = new Date(Date.UTC(year, number, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
