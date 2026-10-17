import { describe, expect, it } from "vitest";
import { matchStatementAccount, normalizeAccountIdentifier } from "./account-matching";

describe("account matching", () => {
  const candidates = [{ id: "account-1", name: "Operating account", attributes: JSON.stringify({ accountIdentifier: "000-000001-234", accountHolder: "Synthetic Example Company LLC" }) }];

  it("normalizes masked account identifiers", () => {
    expect(normalizeAccountIdentifier("000-000001-234")).toBe("000000001234");
  });

  it("matches a statement to a known account", () => {
    expect(matchStatementAccount({ accountIdentifier: "1234" }, candidates)?.id).toBe("account-1");
  });

  it("returns no match for an unknown account", () => {
    expect(matchStatementAccount({ accountIdentifier: "999" }, candidates)).toBeUndefined();
  });
});
