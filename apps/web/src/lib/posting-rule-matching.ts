export type PostingRuleCandidate = {
  id: string;
  descriptionPattern: string;
  direction: string | null;
  activity: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  priority: string;
};

export type PostingRuleEvent = {
  month: string;
  description: string;
  direction: string;
  category: string;
};

export type PostingRuleMatch<T extends PostingRuleCandidate> =
  | { status: "matched"; rule: T }
  | { status: "unmatched"; rules: [] }
  | { status: "ambiguous"; rules: T[] };

/**
 * Match rules without interpreting accounting. More than one applicable rule
 * remains an exception: priority controls display order, never silently picks
 * an accounting treatment.
 */
export function matchPostingRules<T extends PostingRuleCandidate>(event: PostingRuleEvent, rules: T[]): PostingRuleMatch<T> {
  const matches = rules.filter((rule) =>
    (!rule.direction || rule.direction === event.direction)
    && (!rule.activity || rule.activity === event.category)
    && (!rule.effectiveFrom || event.month >= rule.effectiveFrom)
    && (!rule.effectiveTo || event.month <= rule.effectiveTo)
    && event.description.toLocaleLowerCase().includes(rule.descriptionPattern.toLocaleLowerCase()),
  );
  if (matches.length === 0) return { status: "unmatched", rules: [] };
  if (matches.length === 1) return { status: "matched", rule: matches[0]! };
  return { status: "ambiguous", rules: matches };
}
