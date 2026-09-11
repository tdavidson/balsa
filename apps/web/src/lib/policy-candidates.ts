type AppliedDecision = { id: string; question: string; answer: string; status: string };

export type PolicyCandidate = { key: string; name: string; rule: string; decisionIds: string[] };

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Finds conservative, repeated CFO judgments without activating them automatically. */
export function findPolicyCandidates(decisions: AppliedDecision[]): PolicyCandidate[] {
  const groups = new Map<string, AppliedDecision[]>();
  for (const decision of decisions) {
    if (decision.status !== "applied" || decision.answer.trim().length < 12) continue;
    const key = normalise(decision.answer);
    const group = groups.get(key) ?? [];
    group.push(decision);
    groups.set(key, group);
  }
  return [...groups.entries()].filter(([, group]) => group.length >= 2).map(([key, group]) => ({ key, name: "Repeated CFO treatment", rule: group[0]!.answer.trim(), decisionIds: group.map((decision) => decision.id) })).sort((left, right) => right.decisionIds.length - left.decisionIds.length);
}
