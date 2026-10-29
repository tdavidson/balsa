import { describe, expect, it } from "vitest";
import { buildReconciliationLedger } from "./reconciliation-ledger";

describe("reconciliation ledger", () => {
  it("assigns every event a transparent, non-posting reconciliation state", () => {
    const entries = buildReconciliationLedger([
      { id: "bank", month: "2026-09", date: "2026-09-02", amount: 100, direction: "receipt", description: "Transaction client payment", sourceName: "Bank", evidenceStatus: "approved" },
      { id: "books", month: "2026-09", date: "2026-09-02", amount: 100, direction: "receipt", description: "Transaction client payment", sourceName: "Books", evidenceStatus: "approved" },
      { id: "pending", month: "2026-09", amount: 40, direction: "spend", description: "Vendor payment", sourceName: "CSV", evidenceStatus: "pending" },
      { id: "cad", month: "2026-09", amount: 20, currency: "CAD", direction: "receipt", description: "Canadian receipt", sourceName: "CAD bank", evidenceStatus: "approved" },
    ], "USD");
    expect(entries.map((entry) => entry.kind)).toEqual(["duplicate", "duplicate", "staged", "currency_pending"]);
    expect(entries[0]?.counterpartEventId).toBe("books");
  });

  it("uses the more specific bank-to-books state instead of calling that pair a duplicate", () => {
    const entries = buildReconciliationLedger([
      { id: "bank", month: "2026-09", date: "2026-09-02", amount: 100, direction: "receipt", description: "ACH Sample Technologies", sourceName: "Bank", sourceKind: "bank_statement", evidenceStatus: "approved" },
      { id: "books", month: "2026-09", date: "2026-09-03", amount: 100, direction: "receipt", description: "Sample Technologies payment", sourceName: "QuickBooks", sourceKind: "quickbooks_transactions", evidenceStatus: "approved" },
    ], "USD");
    expect(entries.map((entry) => entry.kind)).toEqual(["book_match", "book_match"]);
  });

  it("keeps a document-confirmed but treatment-pending row staged", () => {
    const [entry] = buildReconciliationLedger([{ id: "staged", month: "2026-09", amount: 100, direction: "receipt", description: "Client payment", evidenceStatus: "approved", isActual: "N", accountingTreatment: "pending" }], "USD");
    expect(entry?.kind).toBe("staged");
  });
});
