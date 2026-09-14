import { describe, expect, it } from "vitest";
import { selectConsolidatedJournalLines } from "./consolidation-perimeter";

const line = (id: string, entityId: string | undefined, basis: "actual" | "elimination" = "actual") => ({ id, accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit" as const, ...(entityId ? { entityId } : {}), currency: "USD", debitMinor: "100", creditMinor: "0", period: "2026-09", basis });

describe("consolidation perimeter", () => {
  it("selects effective full-consolidation entities and explicit eliminations only", () => {
    const selected = selectConsolidatedJournalLines([line("parent", "parent"), line("subsidiary", "sub"), line("equity-method", "equity"), line("outside", "outside"), line("elimination", undefined, "elimination")], [{ id: "parent", consolidated: true, consolidationMethod: "full" }, { id: "sub", consolidated: true, consolidationMethod: "full", effectiveFrom: "2026-08" }, { id: "equity", consolidated: true, consolidationMethod: "equity" }, { id: "outside", consolidated: false, consolidationMethod: "exclude" }], "2026-09");
    expect(selected.map((item) => item.id)).toEqual(["parent", "subsidiary", "elimination"]);
  });
});
