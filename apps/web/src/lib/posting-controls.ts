export function validatePostingActivity(activity: string | undefined, accountTypes: string[], policyId: string | undefined) {
  if (!activity || activity === "operating" || policyId) return [];
  if (accountTypes.some((type) => type === "revenue" || type === "expense")) {
    return [`${activity} cash activity cannot post to revenue or expense without an approved accounting policy.`];
  }
  return [];
}
