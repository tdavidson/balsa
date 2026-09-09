import { describe, expect, it } from "vitest";
import { matchStatementAccount, normalizeAccountIdentifier } from "./account-matching";

describe("account matching", () => {
  const candidates = [{ id: "account-1", name: "Operating account", attributes: JSON.stringify({ accountIdentifier: "877-028254-023", accountHolder: "Laconia Advisory Services LLC" }) }];

  it("normalizes masked account identifiers", () => {
    expect(normalizeAccountIdentifier("877-028254-023")).toBe("877028254023");
  });

  it("matches a statement to a known account", () => {
    expect(matchStatementAccount({ accountIdentifier: "4023" }, candidates)?.id).toBe("account-1");
  });

  it("returns no match for an unknown account", () => {
    expect(matchStatementAccount({ accountIdentifier: "999" }, candidates)).toBeUndefined();
  });
});
