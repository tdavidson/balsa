import { describe, expect, it } from "vitest";
import { classifyWithCompanyPolicy, isExecutableCompanyPolicy } from "./company-policy-engine";

describe("company policy engine", () => {
  it("applies an explicit description and category instruction", () => {
    expect(classifyWithCompanyPolicy("Automatic Investment into bank deposit program", [{ id: "policy", name: "Sweep activity", rule: "Classify descriptions containing \"Automatic Investment\" as transfer." }])).toEqual({ category: "transfer", policyId: "policy" });
  });

  it("does not treat general financial guidance as an executable rule", () => {
    expect(classifyWithCompanyPolicy("Client payment", [{ id: "policy", name: "Revenue recognition", rule: "Recognize revenue as services are delivered." }])).toBeUndefined();
    expect(isExecutableCompanyPolicy({ id: "policy", name: "Revenue recognition", rule: "Recognize revenue as services are delivered." })).toBe(false);
  });

  it("honors an effective date and explicit source scope", () => {
    const policy = { id: "policy", name: "Bank sweep", rule: "Classify descriptions containing \"Sweep\" as transfer.", scope: "source:bank_statement", effectiveFrom: "2026-08-01" };
    expect(classifyWithCompanyPolicy("Sweep movement", [policy], { effectiveDate: "2026-07-31", sourceKind: "bank_statement" })).toBeUndefined();
    expect(classifyWithCompanyPolicy("Sweep movement", [policy], { effectiveDate: "2026-08-01", sourceKind: "quickbooks_transactions" })).toBeUndefined();
    expect(classifyWithCompanyPolicy("Sweep movement", [policy], { effectiveDate: "2026-08-01", sourceKind: "bank_statement" })).toEqual({ category: "transfer", policyId: "policy" });
  });
});
