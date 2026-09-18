import { describe, expect, it } from "vitest";
import { amountToMinor, chartAccountToForecastAccount, economicItemToDriver, forecastAsOfFromClosure, templateRowToTemplate } from "./forecast-drivers";

const item = { id: "i1", label: "Retainer", type: "agreement", direction: "receipt" as const, category: "management_fee", amount: "1250.5", cadence: "monthly", effectiveFrom: "2026-09", effectiveTo: null, scenarioId: null, decisionId: null, evidenceId: "ev1", factId: null, counterpartyEntityId: "cp1" };

describe("forecast driver mapping", () => {
  it("converts decimal amounts to minor units", () => {
    expect(amountToMinor("1250.5")).toBe("125050");
    expect(amountToMinor("0.07")).toBe("7");
    expect(amountToMinor("12")).toBe("1200");
    expect(amountToMinor("-3")).toBe("");
    expect(amountToMinor(null)).toBe("");
  });
  it("maps an economic item with lineage and without undefined keys", () => {
    const driver = economicItemToDriver(item);
    expect(driver).toEqual({ id: "i1", label: "Retainer", itemType: "agreement", direction: "receipt", category: "management_fee", amountMinor: "125050", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev1", counterpartyEntityId: "cp1" });
    expect(economicItemToDriver({ ...item, cadence: null }).cadence).toBe("once");
  });
  it("maps templates and chart accounts", () => {
    expect(templateRowToTemplate({ id: "t", itemType: "obligation", direction: "spend", category: null, debitAccountId: "d", creditAccountId: "c", decisionId: null, policyId: "p" })).toEqual({ id: "t", itemType: "obligation", direction: "spend", debitAccountId: "d", creditAccountId: "c", policyId: "p" });
    expect(chartAccountToForecastAccount({ id: "a", code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementSection: null, statementLine: "Cash", balanceTiming: "current", cashFlowCategory: null, workingCapitalCategory: null })).toEqual({ accountId: "a", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash", balanceTiming: "current" });
  });
  it("uses the later of the latest closed period and the last full calendar month", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    expect(forecastAsOfFromClosure(null, now)).toBe("2026-08");
    // Actuals posted after an old close must not be hidden behind it.
    expect(forecastAsOfFromClosure("2026-05", now)).toBe("2026-08");
    expect(forecastAsOfFromClosure("2026-08", now)).toBe("2026-08");
    expect(forecastAsOfFromClosure("2026-09", now)).toBe("2026-09");
    expect(forecastAsOfFromClosure(null, new Date("2027-01-01T00:00:00Z"))).toBe("2026-12");
  });
});
