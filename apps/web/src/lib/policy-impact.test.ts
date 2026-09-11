import { describe, expect, it } from "vitest";
import { previewPolicyImpact } from "./policy-impact";

describe("policy impact preview", () => {
  it("shows only affected events at or after the effective date", () => {
    const impact = previewPolicyImpact([
      { id: "old", month: "2026-08", description: "Automatic Investment sweep", amount: "100", direction: "spend", category: "expense" },
      { id: "new", month: "2026-09", description: "Automatic Investment sweep", amount: "200", direction: "spend", category: "expense", sourceName: "Bank" },
    ], { id: "preview", name: "Sweep activity", rule: "Classify descriptions containing \"Automatic Investment\" as transfer." }, "2026-09-01T00:00:00.000Z");
    expect(impact).toMatchObject({ executable: true, matched: 1, changed: 1 });
    expect(impact.events).toEqual([expect.objectContaining({ id: "new", nextCategory: "transfer" })]);
  });
});
