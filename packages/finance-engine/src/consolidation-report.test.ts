import { describe, expect, it } from "vitest";
import { buildConsolidatedJournalReport } from "./consolidation-report";

const line = (id: string, entityId: string | undefined, accountId: string, accountType: "asset" | "liability", debitMinor: string, creditMinor: string, basis: "actual" | "elimination" = "actual") => ({ id, entryId: `entry:${id}`, accountId, accountCode: accountId, accountName: accountId, accountType, normalBalance: accountType === "asset" ? "debit" as const : "credit" as const, ...(entityId ? { entityId } : {}), currency: "USD", debitMinor, creditMinor, period: "2026-09", basis });

describe("buildConsolidatedJournalReport", () => {
  it("includes only the effective full-consolidation perimeter and posted eliminations", () => {
    const report = buildConsolidatedJournalReport([line("parent-cash", "parent", "cash", "asset", "10000", "0"), line("parent-equity", "parent", "equity", "liability", "0", "10000"), line("outside-cash", "outside", "cash", "asset", "5000", "0"), line("outside-equity", "outside", "equity", "liability", "0", "5000"), line("eliminate-due-to", undefined, "due-to", "liability", "2500", "0", "elimination"), line("eliminate-due-from", undefined, "due-from", "asset", "0", "2500", "elimination")], "2026-09", [{ id: "parent", consolidated: true, consolidationMethod: "full" }, { id: "outside", consolidated: false, consolidationMethod: "exclude" }]);
    expect(report.entityIds).toEqual(["parent"]); expect(report.includedLineIds).toEqual(["eliminate-due-from", "eliminate-due-to", "parent-cash", "parent-equity"]); expect(report.trialBalance.balanced).toBe(true);
  });
});
