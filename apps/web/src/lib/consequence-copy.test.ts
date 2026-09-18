import { describe, expect, it } from "vitest";
import type { ForecastConsequence } from "@nevermodel/finance-engine";
import { describeCause, describeConsequence } from "./consequence-copy";

const base: ForecastConsequence = {
  asOfMonth: { before: "2026-08", after: "2026-08" }, cash: [], horizonEndCash: { month: "2028-08", beforeMinor: "0", afterMinor: "12000000", deltaMinor: "12000000" },
  cashOutMonth: { before: "2028-03", after: null }, runwayMonths: { before: 14, after: null },
  projectedReceipts: { beforeMinor: "0", afterMinor: "12000000", deltaMinor: "12000000" }, projectedSpending: { beforeMinor: "0", afterMinor: "0", deltaMinor: "0" },
  drivers: { added: [], removed: [], changed: [] }, exceptions: { before: 0, after: 0 },
};

describe("consequence copy", () => {
  it("summarizes cash, runway, and cash-out", () => {
    expect(describeConsequence(base)).toBe("Aug 2028 ending cash +$120k · runway 14 mo → beyond horizon · cash-out Mar 2028 → none");
  });
  it("formats small and negative deltas", () => {
    expect(describeConsequence({ ...base, horizonEndCash: { ...base.horizonEndCash, deltaMinor: "-150000" }, runwayMonths: { before: 14, after: 14 }, cashOutMonth: { before: null, after: null } })).toBe("Aug 2028 ending cash −$1.5k");
    expect(describeConsequence({ ...base, horizonEndCash: { ...base.horizonEndCash, deltaMinor: "95000" }, runwayMonths: { before: 3, after: 3 }, cashOutMonth: { before: null, after: null } })).toBe("Aug 2028 ending cash +$950");
  });
  it("says when nothing moves and when drivers are excluded", () => {
    expect(describeConsequence(null)).toBe("No forecast effect");
    expect(describeConsequence(null, 2)).toBe("No forecast effect · 2 drivers excluded");
  });
  it("describes causes", () => {
    expect(describeCause({ kind: "item_confirmed", subjectLabel: "Acme retainer" })).toBe("Confirmed Acme retainer");
    expect(describeCause({ kind: "period_closed", subjectLabel: null })).toBe("Closed a period");
  });
});
