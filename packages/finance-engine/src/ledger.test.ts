import { describe, expect, it } from "vitest";
import { buildTrialBalance } from "./ledger";

describe("buildTrialBalance", () => {
  it("rolls immutable posted lines by account, entity, currency, and period", () => {
    const trial = buildTrialBalance([
      { id: "1", accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", entityId: "mgmt", currency: "USD", debitMinor: "310000", creditMinor: "0", period: "2026-09", provenance: { factId: "row-1" } },
      { id: "2", accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit", entityId: "mgmt", currency: "USD", debitMinor: "0", creditMinor: "310000", period: "2026-09" },
      { id: "3", accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", entityId: "mgmt", currency: "USD", debitMinor: "100", creditMinor: "0", period: "2026-10" },
    ], "2026-09");
    expect(trial).toMatchObject({ balanced: true, totals: { USD: { debitMinor: "310000", creditMinor: "310000", differenceMinor: "0" } } });
    expect(trial.lines[0]).toMatchObject({ accountCode: "1000", netMinor: "310000", provenance: [{ factId: "row-1" }] });
  });
});
