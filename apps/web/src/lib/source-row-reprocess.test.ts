import { describe, expect, it } from "vitest";
import { previewSourceRowReprocessing } from "./source-row-reprocess";

const row = { id: "row", period: "2026-09", description: "Sample Technologies fee", direction: "receipt", category: "operating" };
const rule = { id: "fee", descriptionPattern: "sample technologies", direction: "receipt", activity: "operating", effectiveFrom: null, effectiveTo: null, priority: "100" };

describe("previewSourceRowReprocessing", () => {
  it("shows a rule change rather than replacing it", () => {
    expect(previewSourceRowReprocessing([row], [rule], [{ sourceRowId: "row", postingRuleId: "old", ruleSnapshot: "{}", createdAt: new Date("2026-09-01") }])).toMatchObject([{ outcome: "changed", previousRuleId: "old", ruleIds: ["fee"] }]);
  });
  it("keeps overlap as an exception", () => {
    expect(previewSourceRowReprocessing([row], [rule, { ...rule, id: "other" }], [])).toMatchObject([{ outcome: "ambiguous", ruleIds: ["fee", "other"] }]);
  });
  it("detects an edited rule even when its id remains the same", () => {
    expect(previewSourceRowReprocessing([row], [{ ...rule, descriptionPattern: "sample" }], [{ sourceRowId: "row", postingRuleId: "fee", ruleSnapshot: JSON.stringify(rule), createdAt: new Date("2026-09-01") }])).toMatchObject([{ outcome: "changed", previousRuleId: "fee" }]);
  });
});
