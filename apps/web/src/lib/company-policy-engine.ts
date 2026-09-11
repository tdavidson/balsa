import type { CashActivityCategory } from "./financial-events";

export type ExecutableCompanyPolicy = { id: string; name: string; rule: string; scope?: string | null; effectiveFrom?: string | Date | null };
export type PolicyClassification = { category: CashActivityCategory; policyId: string };
export type PolicyContext = { effectiveDate?: string | Date | null; sourceKind?: string | null; sourceName?: string | null; accountIdentifier?: string | null };

const categories = ["transfer", "investment", "revenue", "expense", "unclassified"] as const;

function categoryFromRule(rule: string) {
  const match = rule.match(/(?:classify|treat|record)[\s\S]{0,180}?\b(?:as|to)\s+(transfer|investment|revenue|expense|unclassified)\b|(?:=>|→)\s*(?:classify\s+as\s+)?(transfer|investment|revenue|expense|unclassified)\b/i);
  const category = match?.[1] ?? match?.[2];
  return categories.includes(category as CashActivityCategory) ? category as CashActivityCategory : undefined;
}

function matchPhrases(policy: ExecutableCompanyPolicy) {
  const quoted = [...policy.rule.matchAll(/["“]([^"”]{3,})["”]/g)].map((match) => match[1]!.trim());
  if (quoted.length) return quoted;
  const beforeArrow = policy.rule.split(/(?:=>|→|\bclassify\b|\btreat\b|\brecord\b)/i)[0]?.trim();
  return beforeArrow && beforeArrow.length >= 3 ? [beforeArrow] : [policy.name.trim()];
}

/** Whether a policy has both an explicit matching phrase and a ledger category. */
export function isExecutableCompanyPolicy(policy: ExecutableCompanyPolicy) {
  return Boolean(categoryFromRule(policy.rule) && matchPhrases(policy).some((phrase) => phrase.trim().length >= 3));
}

export function policyAppliesInContext(policy: ExecutableCompanyPolicy, description: string, context: PolicyContext) {
  if (policy.effectiveFrom && context.effectiveDate && new Date(context.effectiveDate) < new Date(policy.effectiveFrom)) return false;
  const scope = policy.scope?.trim().toLowerCase() || "company";
  if (scope === "company" || scope === "all") return true;
  const [kind, ...parts] = scope.split(":");
  const target = parts.join(":").trim();
  if (!target) return false;
  if (kind === "source") return `${context.sourceKind ?? ""} ${context.sourceName ?? ""}`.toLowerCase().includes(target);
  if (kind === "account") return (context.accountIdentifier ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(target.replace(/[^a-z0-9]/g, ""));
  if (kind === "description") return description.toLowerCase().includes(target);
  return false;
}

/**
 * Applies only an explicit, auditable policy instruction. Natural-language
 * context remains guidance for review; it cannot mutate a ledger category.
 */
export function classifyWithCompanyPolicy(description: string, policies: ExecutableCompanyPolicy[], context: PolicyContext = {}): PolicyClassification | undefined {
  const normalizedDescription = description.toLowerCase();
  for (const policy of policies) {
    if (!policyAppliesInContext(policy, description, context)) continue;
    const category = categoryFromRule(policy.rule);
    if (!category || !isExecutableCompanyPolicy(policy)) continue;
    const phrase = matchPhrases(policy).find((candidate) => normalizedDescription.includes(candidate.toLowerCase()));
    if (phrase) return { category, policyId: policy.id };
  }
  return undefined;
}
