import { describe, expect, it } from "vitest";
import { recurrenceDefinition, recurringOccurrences, type RecurrenceContext } from "./forecast-recurrence";
const context: RecurrenceContext = {
  currency: "USD",
  drivers: [{ id: "receipt", label: "Approved receipt", itemType: "agreement", direction: "receipt", amountMinor: "10000000", cadence: "monthly", effectiveFrom: "2026-09" }],
  templates: [{ id: "cash-receipt", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "revenue" }],
  accounts: [{ accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit" }, { accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" }],
};
describe("approved recurring cash schedules", () => {
  it("uses canonical driver identities and balanced shared-engine projections", () => {
    const definition = recurrenceDefinition(context, "receipt")!;
    const occurrences = recurringOccurrences(definition, "2026-09", "2026-11");
    expect(occurrences.map((item) => item.key)).toEqual(["projection:receipt:base:2026-09", "projection:receipt:base:2026-10", "projection:receipt:base:2026-11"]);
    expect(occurrences.every((item) => item.lines.reduce((sum, line) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor), 0n) === 0n)).toBe(true);
    expect(occurrences.every((item) => item.autoMatchFactId === null)).toBe(true);
  });
  it("respects cadence and the source schedule's end", () => {
    const input = { ...context, drivers: [{ ...context.drivers[0]!, cadence: "quarterly" as const, effectiveTo: "2027-02" }] };
    const definition = recurrenceDefinition(input, "receipt")!;
    expect(recurringOccurrences(definition, "2026-10", "2027-04").map((item) => item.originalMonth)).toEqual(["2026-12"]);
  });
  it("rejects dynamic amounts, one-off items, transfers, ambiguous treatment and long windows", () => {
    for (const changes of [{ amountFormula: "revenue" }, { cadence: "once" as const }, { amountMinor: "0" }]) expect(recurrenceDefinition({ ...context, drivers: [{ ...context.drivers[0]!, ...changes }] }, "receipt")).toBeNull();
    expect(recurrenceDefinition({ ...context, templates: [...context.templates, { ...context.templates[0]!, id: "duplicate" }] }, "receipt")).toBeNull();
    expect(recurrenceDefinition({ ...context, accounts: context.accounts.map((item) => ({ ...item, accountName: "Cash", accountType: "asset" as const })) }, "receipt")).toBeNull();
    expect(() => recurringOccurrences(recurrenceDefinition(context, "receipt")!, "2026-09", "2028-09")).toThrow("24 months");
  });
});
