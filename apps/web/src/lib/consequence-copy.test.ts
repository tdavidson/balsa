import { describe, expect, it } from "vitest";
import type { ForecastConsequence } from "@nevermodel/finance-engine";
import { describeCause, describeConsequence, describeSources, visibleSources } from "./consequence-copy";

const base: ForecastConsequence = {
  asOfMonth: { before: "2026-08", after: "2026-08" }, rolledForward: false, methodChanged: false, cash: [], horizonEndCash: { month: "2028-08", beforeMinor: "0", afterMinor: "12000000", deltaMinor: "12000000" },
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
  it("leads with the roll when the as-of month moved, without a cash change from the roll itself", () => {
    const rolled: ForecastConsequence = { ...base, asOfMonth: { before: "2026-07", after: "2026-08" }, rolledForward: true, horizonEndCash: { month: "2028-07", beforeMinor: "500000", afterMinor: "500000", deltaMinor: "0" }, runwayMonths: { before: 10, after: 9 }, cashOutMonth: { before: "2027-06", after: "2027-06" } };
    expect(describeConsequence(rolled)).toBe("Forecast rolled forward to Aug 2026 · runway 10 mo → 9 mo");
    expect(describeConsequence({ ...rolled, runwayMonths: { before: 9, after: 9 } })).toBe("Forecast rolled forward to Aug 2026");
    expect(describeConsequence({ ...rolled, horizonEndCash: { ...rolled.horizonEndCash, deltaMinor: "-500000" }, cashOutMonth: { before: "2027-06", after: "2027-05" } })).toBe("Forecast rolled forward to Aug 2026 · Jul 2028 ending cash −$5k · runway 10 mo → 9 mo · cash-out Jun 2027 → May 2027");
  });
  it("leads with the method change before any rolled-forward text", () => {
    expect(describeConsequence({ ...base, methodChanged: true })).toBe("Forecast method updated · Aug 2028 ending cash +$120k · runway 14 mo → beyond horizon · cash-out Mar 2028 → none");
    const rolled: ForecastConsequence = { ...base, methodChanged: true, asOfMonth: { before: "2026-07", after: "2026-08" }, rolledForward: true, horizonEndCash: { ...base.horizonEndCash, month: "2028-07", beforeMinor: "500000", afterMinor: "500000", deltaMinor: "0" }, runwayMonths: { before: 10, after: 9 }, cashOutMonth: { before: "2027-06", after: "2027-06" } };
    expect(describeConsequence(rolled)).toBe("Forecast method updated · Forecast rolled forward to Aug 2026 · runway 10 mo → 9 mo");
  });
  it("treats a missing methodChanged as false", () => {
    const { methodChanged: _unused, ...withoutMethodChanged } = { ...base, methodChanged: false };
    void _unused;
    expect(describeConsequence(withoutMethodChanged as ForecastConsequence)).toBe(describeConsequence(base));
  });
  it("reports the largest monthly cash change when the horizon end and runway did not move", () => {
    const interior: ForecastConsequence = { ...base, horizonEndCash: { ...base.horizonEndCash, deltaMinor: "0" }, runwayMonths: { before: 14, after: 14 }, cashOutMonth: { before: null, after: null },
      cash: [{ month: "2027-02", beforeMinor: "0", afterMinor: "200000", deltaMinor: "200000" }, { month: "2027-03", beforeMinor: "600000", afterMinor: "100000", deltaMinor: "-500000" }, { month: "2027-04", beforeMinor: "0", afterMinor: "0", deltaMinor: "0" }] };
    expect(describeConsequence(interior)).toBe("Mar 2027 ending cash −$5k");
    expect(describeConsequence({ ...interior, cash: [] })).toBe("No forecast effect");
  });
  it("describes causes", () => {
    expect(describeCause({ kind: "item_confirmed", subjectLabel: "Acme retainer" })).toBe("Confirmed Acme retainer");
    expect(describeCause({ kind: "period_closed", subjectLabel: null })).toBe("Closed a period");
  });
  it("describes a bulk confirmation by its subject labels", () => {
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectLabels: ["Acme retainer", "Rent", "Payroll"] })).toBe("Confirmed 3 items: Acme retainer, Rent, Payroll");
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectLabels: ["Acme retainer", "Rent"] })).toBe("Confirmed 2 items: Acme retainer, Rent");
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectLabels: ["Acme retainer", "Rent", "Payroll", "Office", "Travel"] })).toBe("Confirmed 5 items: Acme retainer, Rent, Payroll and 2 more");
    // A single label carried in subjectLabels behaves like an ordinary single-subject cause.
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectLabels: ["Acme retainer"] })).toBe("Confirmed Acme retainer");
  });
  it("counts a bulk cause by its subject ids when some labels did not resolve", () => {
    // Labels can be fewer than ids (a subject deleted since); the count is the ids.
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectIds: ["a", "b", "c", "d", "e"], subjectLabels: ["Acme retainer", "Rent"] })).toBe("Confirmed 5 items: Acme retainer, Rent and 3 more");
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectIds: ["a", "b", "c", "d"], subjectLabels: ["Acme retainer", "Rent", "Payroll", "Office"] })).toBe("Confirmed 4 items: Acme retainer, Rent, Payroll and 1 more");
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectIds: ["a", "b", "c"], subjectLabels: [] })).toBe("Confirmed 3 items");
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectIds: ["a", "b"], subjectLabels: ["Rent"] })).toBe("Confirmed 2 items: Rent and 1 more");
    expect(describeCause({ kind: "item_confirmed", subjectLabel: null, subjectIds: ["a"], subjectLabels: ["Rent"] })).toBe("Confirmed Rent");
  });
  it("labels a month rollover", () => {
    expect(describeCause({ kind: "period_rolled", subjectLabel: null })).toBe("Month rolled forward");
  });
  it("names model and formula changes", () => {
    expect(describeCause({ kind: "model_changed", subjectLabel: "payroll" })).toBe("Changed the model: payroll");
    expect(describeCause({ kind: "model_changed", subjectLabel: null })).toBe("Changed the model");
    expect(describeCause({ kind: "item_formula_changed", subjectLabel: "Payroll" })).toBe("Set a formula on Payroll");
    expect(describeCause({ kind: "item_formula_changed", subjectLabel: null })).toBe("Set a formula on an item");
  });
  it("describes sources", () => {
    expect(describeSources([])).toBeNull();
    expect(describeSources([{ evidenceId: "e1", sourceName: "Acme MSA.pdf" }])).toBe("from Acme MSA.pdf");
    expect(describeSources([{ evidenceId: "e1", sourceName: "Acme MSA.pdf" }, { evidenceId: "e2", sourceName: "Rent lease.pdf" }, { evidenceId: "e3", sourceName: "Payroll register.pdf" }]))
      .toBe("from Acme MSA.pdf and 2 more");
    expect(describeSources([{ evidenceId: "e1", sourceName: "Acme MSA.pdf" }, { evidenceId: "e2", sourceName: "Rent lease.pdf" }])).toBe("from Acme MSA.pdf and 1 more");
  });
  it("falls back to a generic label when the first source's name did not resolve", () => {
    expect(describeSources([{ evidenceId: "e1", sourceName: null }])).toBe("from a source");
  });
  it("splits sources into what to show as links and what to count as overflow, capped at 2 by default", () => {
    const s = (n: number) => ({ evidenceId: `e${n}`, sourceName: `Source ${n}.pdf` });
    expect(visibleSources([])).toEqual({ shown: [], overflow: 0 });
    expect(visibleSources([s(1)])).toEqual({ shown: [s(1)], overflow: 0 });
    expect(visibleSources([s(1), s(2)])).toEqual({ shown: [s(1), s(2)], overflow: 0 });
    expect(visibleSources([s(1), s(2), s(3)])).toEqual({ shown: [s(1), s(2)], overflow: 1 });
    expect(visibleSources([s(1), s(2), s(3), s(4), s(5)])).toEqual({ shown: [s(1), s(2)], overflow: 3 });
  });
  it("honors a custom cap", () => {
    const s = (n: number) => ({ evidenceId: `e${n}`, sourceName: `Source ${n}.pdf` });
    expect(visibleSources([s(1), s(2), s(3)], 1)).toEqual({ shown: [s(1)], overflow: 2 });
  });
});
