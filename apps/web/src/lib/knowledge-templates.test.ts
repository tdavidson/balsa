import { describe, expect, it } from "vitest";
import { defaultKnowledgeDocuments, universalAccountingRules } from "./knowledge-templates";

describe("universalAccountingRules", () => {
  it("includes the core accounting decision framework", () => {
    for (const section of [
      "Double-entry and account behavior",
      "Accrual accounting and recognition",
      "Assets, costs, and estimates",
      "Financing, equity, and entity boundaries",
      "Period close and statement integrity",
      "Evidence, judgment, and review",
      "Universal cash-activity rules",
    ]) {
      expect(universalAccountingRules).toContain(`## ${section}`);
    }
  });

  it("keeps universal guidance separate from company policy and deterministic controls", () => {
    expect(universalAccountingRules).toContain("does not select an optional accounting treatment for the company");
    expect(universalAccountingRules).toContain("may not bypass those controls or approve its own judgment");
    expect(universalAccountingRules).toContain("Do not manufacture a plug");
  });

  it("publishes the guidance through the read-only core accounting document", () => {
    const coreAccounting = defaultKnowledgeDocuments.find((document) => document.slug === "core-accounting");

    expect(coreAccounting?.content).toContain(universalAccountingRules);
  });
});
