import { describe, expect, it } from "vitest";
import { matchPostingRules } from "./posting-rule-matching";

const event = { month: "2026-09", description: "ACH SAMPLE TECHNOLOGIES MANAGEMENT FEE", direction: "receipt", category: "operating" };
const rule = { id: "fee", descriptionPattern: "sample technologies", direction: "receipt", activity: "operating", effectiveFrom: null, effectiveTo: null, priority: "100" };

describe("matchPostingRules", () => {
  it("matches a single applicable rule case-insensitively", () => {
    expect(matchPostingRules(event, [rule])).toMatchObject({ status: "matched", rule: { id: "fee" } });
  });

  it("keeps an expired rule unmatched", () => {
    expect(matchPostingRules(event, [{ ...rule, effectiveTo: "2026-08" }])).toMatchObject({ status: "unmatched" });
  });

  it("does not choose between multiple applicable rules", () => {
    expect(matchPostingRules(event, [rule, { ...rule, id: "other", priority: "1" }])).toMatchObject({ status: "ambiguous", rules: [{ id: "fee" }, { id: "other" }] });
  });
});
