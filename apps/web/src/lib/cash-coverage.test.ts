import { describe, expect, it } from "vitest";
import { cashCoveragePreviewHash } from "./cash-coverage";
type Input = Parameters<typeof cashCoveragePreviewHash>[0];
const line = (id: string): Input["lines"][number] => ({
  id,
  accountId: "cash",
  accountCode: "1000",
  accountName: "Cash",
  accountType: "asset",
  normalBalance: "debit",
  currency: "USD",
  period: "2026-09",
  debitMinor: "100",
  creditMinor: "0",
});
const input: Input = {
  throughDate: "2026-09-25",
  lines: [line("a"), line("b")],
  coverage: {
    startDate: "2026-08-01",
    throughDate: "2026-09-25",
    accounts: [],
    evidence: [
      { id: "doc-a", name: "Synthetic A", hash: "a", status: "approved" },
      { id: "doc-b", name: "Synthetic B", hash: "b", status: "approved" },
    ],
  },
  sourceState: {
    rows: [],
    documents: [
      {
        id: "doc-a",
        accountIdentifier: null,
        reportingMonth: null,
        hash: "a",
        status: "approved",
      },
      {
        id: "doc-b",
        accountIdentifier: null,
        reportingMonth: null,
        hash: "b",
        status: "approved",
      },
    ],
  },
};
describe("coverage preview identity", () => {
  it("is invariant to query row order without mutating reviewed inputs", () => {
    const original = structuredClone(input);
    expect(
      cashCoveragePreviewHash({
        ...input,
        lines: [...input.lines].reverse(),
        coverage: {
          ...input.coverage,
          evidence: [...input.coverage.evidence].reverse(),
        },
        sourceState: {
          ...input.sourceState,
          documents: [...input.sourceState.documents].reverse(),
        },
      }),
    ).toBe(cashCoveragePreviewHash(input));
    expect(input).toEqual(original);
  });
  it("still invalidates for changed amounts, evidence approvals, or cutoff", () => {
    for (const changed of [
      { ...input, throughDate: "2026-09-26" },
      {
        ...input,
        lines: [{ ...input.lines[0]!, debitMinor: "101" }, input.lines[1]!],
      },
      {
        ...input,
        sourceState: {
          ...input.sourceState,
          documents: [
            { ...input.sourceState.documents[0]!, status: "rejected" as const },
            input.sourceState.documents[1]!,
          ],
        },
      },
    ])
      expect(cashCoveragePreviewHash(changed)).not.toBe(
        cashCoveragePreviewHash(input),
      );
  });
});
