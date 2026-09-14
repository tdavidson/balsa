import { matchPostingRules, type PostingRuleCandidate } from "./posting-rule-matching";

export type ReprocessSourceRow = { id: string; period: string | null; description: string | null; direction: string | null; category?: string | null };
export type ExistingRuleApplication = { sourceRowId: string; postingRuleId: string; ruleSnapshot: string; createdAt: Date };
export type ReprocessOutcome = "unchanged" | "newly_matched" | "changed" | "no_longer_matched" | "unmatched" | "ambiguous" | "unsupported";

/** Deterministic rule-preview diff. It never creates or updates proposals. */
export function previewSourceRowReprocessing<T extends PostingRuleCandidate>(rows: ReprocessSourceRow[], rules: T[], applications: ExistingRuleApplication[]) {
  return rows.map((row) => {
    if (!row.period || !row.description || !row.direction) return { sourceRowId: row.id, outcome: "unsupported" as const, previousRuleId: undefined, ruleIds: [] };
    const previous = applications.filter((item) => item.sourceRowId === row.id).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    const match = matchPostingRules({ month: row.period, description: row.description, direction: row.direction, category: row.category ?? "operating" }, rules);
    if (match.status === "ambiguous") return { sourceRowId: row.id, outcome: "ambiguous" as const, ...(previous ? { previousRuleId: previous.postingRuleId } : {}), ruleIds: match.rules.map((rule) => rule.id) };
    if (match.status === "unmatched") return { sourceRowId: row.id, outcome: previous ? "no_longer_matched" as const : "unmatched" as const, ...(previous ? { previousRuleId: previous.postingRuleId } : {}), ruleIds: [] };
    const sameRule = previous?.postingRuleId === match.rule.id && previous.ruleSnapshot === JSON.stringify(match.rule);
    return { sourceRowId: row.id, outcome: !previous ? "newly_matched" as const : sameRule ? "unchanged" as const : "changed" as const, ...(previous ? { previousRuleId: previous.postingRuleId } : {}), ruleIds: [match.rule.id] };
  });
}
