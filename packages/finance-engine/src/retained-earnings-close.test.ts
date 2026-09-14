import { describe, expect, it } from "vitest";
import { previewRetainedEarningsClose } from "./retained-earnings-close";

const line = (id: string, accountId: string, accountType: string, debitMinor: string, creditMinor: string) => ({ id, entryId: `entry-${id}`, accountId, accountCode: accountId, accountName: accountId, accountType, normalBalance: accountType === "revenue" ? "credit" as const : "debit" as const, currency: "USD", debitMinor, creditMinor, period: "2026-01", basis: "actual" as const });

describe("previewRetainedEarningsClose", () => {
  it("prepares balanced close lines with source-line lineage", () => {
    const preview = previewRetainedEarningsClose([line("revenue-line", "revenue", "revenue", "0", "10000"), line("expense-line", "expense", "expense", "4000", "0")], "2026-01", [{ id: "re", code: "3000", name: "Retained Earnings" }]);
    expect(preview.status).toBe("ready"); expect(preview.entries).toHaveLength(1);
    const [entry] = preview.entries;
    expect(entry).toMatchObject({ debitMinor: "10000", creditMinor: "10000" });
    expect(entry?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: "revenue", debitMinor: "10000", creditMinor: "0", upstreamLineIds: ["revenue-line"] }),
      expect.objectContaining({ accountId: "expense", debitMinor: "0", creditMinor: "4000", upstreamLineIds: ["expense-line"] }),
      expect.objectContaining({ accountId: "re", debitMinor: "0", creditMinor: "6000", upstreamLineIds: ["expense-line", "revenue-line"] }),
    ]));
  });
  it("does not invent a close entry without a designated account", () => expect(previewRetainedEarningsClose([line("revenue-line", "revenue", "revenue", "0", "10000")], "2026-01", []).status).toBe("blocked"));
});
