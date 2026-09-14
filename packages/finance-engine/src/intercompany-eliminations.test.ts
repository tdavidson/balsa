import { describe, expect, it } from "vitest";
import { previewIntercompanyEliminations } from "./intercompany-eliminations";

const line = (id: string, entityId: string, accountId: string, debitMinor: string, creditMinor: string) => ({ id, entryId: `entry:${id}`, accountId, accountCode: accountId, accountName: accountId, accountType: accountId === "due-from" ? "asset" : "liability", normalBalance: accountId === "due-from" ? "debit" as const : "credit" as const, entityId, currency: "USD", debitMinor, creditMinor, period: "2026-09", basis: "actual" as const });
const mapping = { id: "map", fromEntityId: "parent", toEntityId: "sub", receivableAccountId: "due-from", payableAccountId: "due-to", effectiveFrom: "2026-01" };

describe("previewIntercompanyEliminations", () => {
  it("prepares a balanced consolidated-only elimination with exact source-line lineage", () => {
    const preview = previewIntercompanyEliminations([line("receivable", "parent", "due-from", "25000", "0"), line("payable", "sub", "due-to", "0", "25000")], "2026-09", [mapping]);
    expect(preview.status).toBe("ready"); expect(preview.entries[0]).toMatchObject({ debitMinor: "25000", creditMinor: "25000" });
    expect(preview.entries[0]?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: "due-to", upstreamLineIds: ["payable"] }), expect.objectContaining({ accountId: "due-from", upstreamLineIds: ["receivable"] })]));
  });
  it("blocks an unequal pair instead of generating a partial elimination", () => {
    const preview = previewIntercompanyEliminations([line("receivable", "parent", "due-from", "25000", "0"), line("payable", "sub", "due-to", "0", "24000")], "2026-09", [mapping]);
    expect(preview.status).toBe("blocked"); expect(preview.entries).toEqual([]); expect(preview.exceptions[0]?.differenceMinor).toBe("1000");
  });
});
