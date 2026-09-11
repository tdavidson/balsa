export type ReviewedKnowledgeFact = { label: string; value: string; accountingRole?: string };
export type KnowledgeDestination = "company" | "policies" | "allocations" | "accounting" | "forecast";

/** Routes durable findings to the knowledge file that explains how the company operates. */
export function knowledgeDestinationForFact(fact: ReviewedKnowledgeFact): KnowledgeDestination | null {
  const text = `${fact.label} ${fact.value}`.toLowerCase();
  if (/allocation|allocated|shared cost|expense split|reimburs/.test(text)) return "allocations";
  if (/policy|standing rule|accounting treatment|classification rule/.test(text)) return "policies";
  if (/account holder|legal entity|entity name|beneficial owner|company name|business address/.test(text)) return "company";
  if (fact.accountingRole === "agreement" || /agreement|contract|retainer|fee rate|service period|forecast assumption|cadence/.test(text)) return "forecast";
  if (/account number|account ending|opening balance|ending balance|transfer|investment|recognition|deferred revenue|receivable|payable/.test(text)) return "accounting";
  return null;
}
