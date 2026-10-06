import { describe, expect, it } from "vitest";
import {
  compareOperatingObservation,
  observeOperatingCash,
} from "./operating-outcomes";
import type { CashSettlementInput } from "./forecast-settlement";
import type { PostedJournalLine } from "./ledger";
const lines: PostedJournalLine[] = [
  {
    id: "cash",
    accountId: "cash",
    accountCode: "1000",
    accountName: "Cash",
    accountType: "asset",
    normalBalance: "debit",
    currency: "USD",
    period: "2026-10",
    postingDate: "2026-10-01",
    debitMinor: "2000000",
    creditMinor: "0",
  },
  {
    id: "revenue",
    accountId: "revenue",
    accountCode: "4000",
    accountName: "Revenue",
    accountType: "revenue",
    normalBalance: "credit",
    currency: "USD",
    period: "2026-10",
    postingDate: "2026-10-01",
    debitMinor: "0",
    creditMinor: "2000000",
  },
];
const bindings = [
  {
    nodeId: "receipts",
    month: "2026-10",
    driverId: "driver",
    amountMinor: "2000000",
  },
];
const input: CashSettlementInput = {
  throughDate: "2026-11-30",
  occurrences: [
    {
      id: "occ",
      key: "key",
      label: "Synthetic collection",
      origin: "driver",
      driverId: "driver",
      originalMonth: "2026-10",
      expectedDate: "2026-11-15",
      amountMinor: "2000000",
      originalAmountMinor: "2000000",
      currency: "USD",
      version: 2,
      status: "active",
      final: false,
      lines,
      sourceLineIds: [],
    },
  ],
  actuals: [
    {
      id: "first",
      postingDate: "2026-10-20",
      currency: "USD",
      amountMinor: "1200000",
      debitAccountId: "cash",
      creditAccountId: "revenue",
      entityId: null,
      reversed: false,
      memo: "Synthetic",
    },
    {
      id: "second",
      postingDate: "2026-11-10",
      currency: "USD",
      amountMinor: "800000",
      debitAccountId: "cash",
      creditAccountId: "revenue",
      entityId: null,
      reversed: false,
      memo: "Synthetic",
    },
  ],
  allocations: [
    {
      id: "a",
      occurrenceId: "occ",
      actualEntryId: "first",
      amountMinor: "1200000",
      revoked: false,
    },
    {
      id: "b",
      occurrenceId: "occ",
      actualEntryId: "second",
      amountMinor: "800000",
      revoked: false,
    },
  ],
};
describe("operating outcome calculations", () => {
  it("keeps exact differences, missing data, and incomplete coverage distinct", () => {
    expect(
      compareOperatingObservation("100.000001", "80", "complete"),
    ).toMatchObject({ difference: "-20.000001", provisional: false });
    expect(compareOperatingObservation("100", "0", "partial")).toMatchObject({
      observed: "0",
      difference: "-100",
      provisional: true,
    });
    expect(compareOperatingObservation("100", null, "missing")).toMatchObject({
      observed: null,
      difference: null,
    });
    expect(
      compareOperatingObservation("100", "80", "unavailable"),
    ).toMatchObject({ observed: null, difference: null });
  });
  it("retains the original month while allocating installments by actual posting date", () => {
    const preserved = structuredClone(input);
    const result = observeOperatingCash(bindings, input, "USD")[0]!;
    expect(result).toMatchObject({
      month: "2026-10",
      observedMinor: "2000000",
      differenceMinor: "0",
      status: "settled",
    });
    expect(result.payments.map((p) => [p.date, p.amountMinor])).toEqual([
      ["2026-10-20", "1200000"],
      ["2026-11-10", "800000"],
    ]);
    expect(input).toEqual(preserved);
  });
  it("excludes reversed, revoked, future and overallocated actuals using settlement validation", () => {
    const reversed = {
      ...input,
      actuals: input.actuals.map((a) => ({ ...a, reversed: a.id === "first" })),
    };
    expect(observeOperatingCash(bindings, reversed, "USD")[0]).toMatchObject({
      observedMinor: "800000",
      status: "needs_review",
      invalidAllocationIds: ["a"],
    });
    expect(
      observeOperatingCash(
        bindings,
        { ...input, throughDate: "2026-10-31" },
        "USD",
      )[0],
    ).toMatchObject({ observedMinor: "1200000", invalidAllocationIds: ["b"] });
    expect(
      observeOperatingCash(
        bindings,
        {
          ...input,
          allocations: input.allocations.map((a) => ({ ...a, revoked: true })),
        },
        "USD",
      )[0]?.observedMinor,
    ).toBeNull();
    const over = {
      ...input,
      allocations: [
        ...input.allocations,
        { ...input.allocations[0]!, id: "over", amountMinor: "1" },
      ],
    };
    expect(observeOperatingCash(bindings, over, "USD")[0]).toMatchObject({
      observedMinor: "800000",
      status: "needs_review",
    });
  });
  it("does not match cash by amount, label, or a foreign driver", () => {
    expect(
      observeOperatingCash(
        [{ ...bindings[0]!, driverId: "other" }],
        input,
        "USD",
      )[0],
    ).toMatchObject({
      observedMinor: null,
      status: "not_reconciled",
      payments: [],
    });
  });
});
