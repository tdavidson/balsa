import { classifyWithCompanyPolicy, isExecutableCompanyPolicy, type ExecutableCompanyPolicy } from "./company-policy-engine";

export type PolicyImpactEvent = { id: string; month: string; description: string; amount: string; direction: string; category: string; policyId?: string | null; sourceName?: string | null; sourceKind?: string | null; accountIdentifier?: string | null };
export type PolicyImpact = { executable: boolean; matched: number; changed: number; affectedEventIds: string[]; events: Array<PolicyImpactEvent & { nextCategory: string }> };

/** A non-mutating preview. The same classifier is used when the policy is applied. */
export function previewPolicyImpact(events: PolicyImpactEvent[], policy: ExecutableCompanyPolicy, effectiveFrom?: string) : PolicyImpact {
  const executable = isExecutableCompanyPolicy(policy);
  const effectiveMonth = effectiveFrom?.slice(0, 7);
  const matches = executable ? events.flatMap((event) => {
    if (effectiveMonth && event.month < effectiveMonth) return [];
    const classification = classifyWithCompanyPolicy(event.description, [policy], { effectiveDate: `${event.month}-01`, ...(event.sourceName !== undefined ? { sourceName: event.sourceName } : {}), ...(event.sourceKind !== undefined ? { sourceKind: event.sourceKind } : {}), ...(event.accountIdentifier !== undefined ? { accountIdentifier: event.accountIdentifier } : {}) });
    return classification ? [{ ...event, nextCategory: classification.category }] : [];
  }) : [];
  return { executable, matched: matches.length, changed: matches.filter((event) => event.category !== event.nextCategory || event.policyId !== policy.id).length, affectedEventIds: matches.map((event) => event.id), events: matches.slice(0, 25) };
}
