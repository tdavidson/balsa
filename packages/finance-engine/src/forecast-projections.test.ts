import { describe, expect, it } from "vitest";
import { buildProjectedEntries } from "./forecast-projections";

describe("buildProjectedEntries", () => {
  it("expands one approved driver into balanced monthly forecast entries", () => {
    const output = buildProjectedEntries([{ id: "fee", label: "Retainer", itemType: "agreement", direction: "receipt", category: "management_fee", amountMinor: "125000", cadence: "monthly", effectiveFrom: "2026-09" }], [{ id: "fee-template", itemType: "agreement", direction: "receipt", category: "management_fee", debitAccountId: "cash", creditAccountId: "revenue" }], { start: "2026-09", end: "2026-11" });
    expect(output.exceptions).toEqual([]); expect(output.entries).toHaveLength(3); expect(output.entries[0]).toMatchObject({ period: "2026-09", basis: "forecast", lines: [{ accountId: "cash", debitMinor: "125000" }, { accountId: "revenue", creditMinor: "125000" }] });
    expect(output.entries[0]!.projectionKey).toBe("projection:fee:base:2026-09");
  });
  it("keeps an unmapped driver as an exception", () => expect(buildProjectedEntries([{ id: "fee", label: "Retainer", itemType: "agreement", direction: "receipt", amountMinor: "1", cadence: "once", effectiveFrom: "2026-09" }], [], { start: "2026-09", end: "2026-09" }).exceptions).toEqual([{ driverId: "fee", reason: "Driver has no approved forecast-entry template." }]));
  it("changes the immutable posting version when a driver amount changes", () => {
    const driver = { id: "fee", label: "Retainer", itemType: "agreement" as const, direction: "receipt" as const, amountMinor: "100", cadence: "once" as const, effectiveFrom: "2026-09" };
    const template = { id: "template", itemType: "agreement" as const, direction: "receipt" as const, debitAccountId: "cash", creditAccountId: "revenue" };
    const original = buildProjectedEntries([driver], [template], { start: "2026-09", end: "2026-09" }).entries[0]!;
    const changed = buildProjectedEntries([{ ...driver, amountMinor: "200" }], [template], { start: "2026-09", end: "2026-09" }).entries[0]!;
    expect(changed.projectionKey).toBe(original.projectionKey);
    expect(changed.idempotencyKey).not.toBe(original.idempotencyKey);
  });
});
