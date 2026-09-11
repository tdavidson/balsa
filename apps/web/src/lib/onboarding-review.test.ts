import { describe, expect, it } from "vitest";
import { buildOnboardingQuestions, onboardingKnowledgeDestination } from "./onboarding-review";

describe("onboarding review", () => {
  it("asks only for company context that evidence cannot establish", () => {
    const questions = buildOnboardingQuestions({ evidence: [{ accountHolder: "Laconia", accountIdentifier: "877-028254-023", accountEntityId: null }, {}], facts: [{ accountingRole: "transaction" }, { accountingRole: "revenue" }], activePolicyCount: 0 });
    expect(questions.map((question) => question.reviewKey)).toEqual(["onboarding:account-ownership", "onboarding:recognition-policy", "onboarding:forecast-drivers"]);
    expect(questions[0]?.question).toContain("••••4023");
  });

  it("does not repeat policy or forecast setup after company policies are active", () => {
    expect(buildOnboardingQuestions({ evidence: [{ accountIdentifier: "1234", accountEntityId: "account" }], facts: [{ accountingRole: "revenue" }], activePolicyCount: 1 })).toEqual([]);
  });

  it("routes confirmed answers to the knowledge file that uses them", () => {
    expect(onboardingKnowledgeDestination("onboarding:account-ownership")).toBe("company");
    expect(onboardingKnowledgeDestination("onboarding:recognition-policy")).toBe("policies");
    expect(onboardingKnowledgeDestination("onboarding:forecast-drivers")).toBe("forecast");
  });
});
