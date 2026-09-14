import { describe, expect, it } from "vitest";
import { normalizeStatementDate, optionalStatementDateSchema } from "./statement-date";

describe("statement date normalization", () => {
  it.each([
    ["2026-09-30", "2026-09-30"],
    ["9/30/2026", "2026-09-30"],
    ["09-30-2026", "2026-09-30"],
    ["September 30, 2026", "2026-09-30"],
    ["September 30th 2026", "2026-09-30"],
  ])("normalizes %s", (input, expected) => expect(normalizeStatementDate(input)).toBe(expected));

  it("drops ambiguous and invalid dates without rejecting the document", () => {
    expect(optionalStatementDateSchema.parse("September 2026")).toBeUndefined();
    expect(optionalStatementDateSchema.parse("02/30/2026")).toBeUndefined();
  });
});
