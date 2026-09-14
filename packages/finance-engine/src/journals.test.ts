import { describe, expect, it } from "vitest";
import { validateJournalEntry } from "./journals";

describe("validateJournalEntry", () => {
  const base = { idempotencyKey: "bank-row-1", postingDate: "2026-09-01", period: "2026-09" };
  it("accepts balanced integer-minor-unit postings", () => {
    expect(validateJournalEntry({ ...base, lines: [{ accountId: "cash", currency: "USD", debitMinor: "310000", creditMinor: "0", externalKey: "row:1" }, { accountId: "fee", currency: "USD", debitMinor: "0", creditMinor: "310000" }] })).toMatchObject({ valid: true, totals: { USD: { differenceMinor: "0" } } });
  });
  it("rejects unbalanced, ambiguous, and duplicate-source postings", () => {
    const result = validateJournalEntry({ ...base, lines: [{ accountId: "cash", currency: "USD", debitMinor: "100", creditMinor: "1", externalKey: "row:1" }, { accountId: "fee", currency: "USD", debitMinor: "0", creditMinor: "90", externalKey: "row:1" }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/exactly one positive/i), expect.stringMatching(/do not balance/i), expect.stringMatching(/repeats an external/i)]));
  });
  it("requires each entity to balance, not only the consolidated entry", () => {
    const result = validateJournalEntry({ ...base, lines: [{ accountId: "cash", entityId: "entity-a", currency: "USD", debitMinor: "100", creditMinor: "0" }, { accountId: "revenue", entityId: "entity-b", currency: "USD", debitMinor: "0", creditMinor: "100" }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/entity-a:USD debits and credits do not balance/i), expect.stringMatching(/entity-b:USD debits and credits do not balance/i)]));
  });
});
