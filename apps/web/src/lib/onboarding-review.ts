export type OnboardingEvidence = {
  accountHolder?: string | null;
  accountIdentifier?: string | null;
  accountEntityId?: string | null;
};

export type OnboardingFact = { accountingRole?: string | null };
export type OnboardingQuestion = { reviewKey: string; question: string };
export type OnboardingKnowledgeDestination = "company" | "policies" | "forecast";

const maskedAccount = (identifier: string) => {
  const compact = identifier.replace(/[^0-9A-Za-z]/g, "");
  return compact ? `••••${compact.slice(-4)}` : "an identified account";
};

/** Converts only material missing company context into a small onboarding queue. */
export function buildOnboardingQuestions(input: { evidence: OnboardingEvidence[]; facts: OnboardingFact[]; activePolicyCount: number }): OnboardingQuestion[] {
  if (!input.evidence.length) return [];
  const questions: OnboardingQuestion[] = [];
  const unassignedAccounts = input.evidence.filter((item) => item.accountIdentifier && !item.accountEntityId);
  if (unassignedAccounts.length) {
    const accounts = [...new Set(unassignedAccounts.map((item) => `${item.accountHolder?.trim() || "Unknown holder"} ${maskedAccount(item.accountIdentifier!)}`))].slice(0, 5);
    questions.push({ reviewKey: "onboarding:account-ownership", question: `I found ${unassignedAccounts.length} statement account${unassignedAccounts.length === 1 ? "" : "s"} not yet mapped to a company account (${accounts.join(" · ")}). Which legal entity owns each account, and should it be included in company reporting?` });
  }
  const hasOperatingSignal = input.facts.some((fact) => ["revenue", "expense", "agreement", "transaction"].includes(fact.accountingRole ?? ""));
  if (hasOperatingSignal && input.activePolicyCount === 0) questions.push({ reviewKey: "onboarding:recognition-policy", question: "The uploaded evidence contains operating activity, but no company-specific accounting policy is confirmed. What are the revenue streams, when is each recognized, and which recurring receipts are transfers, pass-throughs, or deposits rather than revenue?" });
  const hasAgreement = input.facts.some((fact) => fact.accountingRole === "agreement");
  if ((hasAgreement || input.evidence.length >= 2) && input.activePolicyCount === 0) questions.push({ reviewKey: "onboarding:forecast-drivers", question: "To ground the forecast in company specifics, which confirmed contracts, fee rates, billing or collection dates, payroll commitments, and other recurring cash drivers should Hemrock treat as the starting assumptions?" });
  return questions;
}

export function onboardingKnowledgeDestination(reviewKey: string | null | undefined): OnboardingKnowledgeDestination | undefined {
  if (reviewKey === "onboarding:account-ownership") return "company";
  if (reviewKey === "onboarding:recognition-policy") return "policies";
  if (reviewKey === "onboarding:forecast-drivers") return "forecast";
  return undefined;
}
