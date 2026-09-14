import { describe, expect, it } from "vitest";
import { hasPostingBasis } from "./posting-basis";

describe("hasPostingBasis", () => {
  it("does not treat a raw source reference as approval", () => {
    expect(hasPostingBasis({})).toBe(false);
  });
  it("accepts each approved-basis type", () => {
    expect(hasPostingBasis({ evidenceId: "evidence" })).toBe(true);
    expect(hasPostingBasis({ factId: "fact" })).toBe(true);
    expect(hasPostingBasis({ decisionId: "decision" })).toBe(true);
    expect(hasPostingBasis({ policyId: "policy" })).toBe(true);
    expect(hasPostingBasis({ approvalEventId: "approval" })).toBe(true);
  });
});
