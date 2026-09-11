export type ReconciliationReviewInput = {
  month: string;
  opening?: number;
  ending?: number;
  expectedEnding?: number;
  difference?: number;
  transactionCount: number;
  duplicateGroups: { amount: number; direction: string; date: string | null; sources: string[]; descriptions: string[] }[];
  unclassifiedCount: number;
  balanceConflict?: "opening" | "ending" | "both";
  coverageGapFrom?: string;
  revenueComparison?: { reported: number; cashReceived: number; sources: string[] };
  accountConflict?: { identifier: string; sources: string[] };
  currencyMismatch?: { baseCurrency: string; currencies: string[]; sources: string[]; count: number };
  unmatchedBookCount?: number;
  unmatchedBookSources?: string[];
  bookBalanceComparison?: { statementBalance: number; bookBalance: number; difference: number; statementSources: string[]; bookSources: string[] };
};

export type GroupedReviewQuestion = {
  kind: "balance" | "duplicate" | "classification" | "coverage" | "recognition" | "account" | "currency" | "unmatched" | "books";
  question: string;
  evidence: string[];
};

/** Converts deterministic reconciliation exceptions into grouped CFO questions. */
export function buildReconciliationReview(input: ReconciliationReviewInput): GroupedReviewQuestion[] {
  const questions: GroupedReviewQuestion[] = [];
  if (input.balanceConflict) {
    questions.push({ kind: "balance", question: `Which approved ${input.balanceConflict === "both" ? "opening and ending balances" : `${input.balanceConflict} balance`} should be used for ${input.month}?`, evidence: ["Approved sources report more than one distinct balance for the same period."] });
  } else if (input.opening === undefined || input.ending === undefined) {
    questions.push({ kind: "balance", question: `What approved opening and ending balances should be used for ${input.month}?`, evidence: ["Opening or ending balance is missing from approved evidence."] });
  } else if (input.difference !== undefined && Math.abs(input.difference) > 0.01) {
    questions.push({ kind: "balance", question: `What explains the ${Math.abs(input.difference).toFixed(2)} difference between the calculated and stated ending balance for ${input.month}?`, evidence: [`Calculated ending: ${input.expectedEnding?.toFixed(2) ?? "unknown"}`, `Stated ending: ${input.ending.toFixed(2)}`] });
  }
  if (input.coverageGapFrom) questions.push({ kind: "coverage", question: `Is there a statement or transaction source covering the gap between ${input.coverageGapFrom} and ${input.month}?`, evidence: ["The available monthly evidence skips one or more calendar months."] });
  if (input.revenueComparison) {
    const difference = input.revenueComparison.reported - input.revenueComparison.cashReceived;
    const materiality = Math.max(1_000, Math.abs(input.revenueComparison.reported) * 0.1);
    if (Math.abs(difference) >= materiality) questions.push({ kind: "recognition", question: `The ${input.month} income statement reports ${input.revenueComparison.reported.toFixed(2)} of revenue while approved cash activity shows ${input.revenueComparison.cashReceived.toFixed(2)} of receipts. Is the difference timing/accrual treatment, or should either source be corrected?`, evidence: [`Income-statement sources: ${input.revenueComparison.sources.join(" · ")}`, `Difference: ${difference.toFixed(2)}`] });
  }
  if (input.accountConflict) questions.push({ kind: "account", question: `Approved sources for ${input.month} use account identifier ${input.accountConflict.identifier} but map it to different company accounts. Which account mapping is correct?`, evidence: [`Sources: ${input.accountConflict.sources.join(" · ")}`] });
  if (input.currencyMismatch) questions.push({ kind: "currency", question: `${input.currencyMismatch.count} approved transaction${input.currencyMismatch.count === 1 ? " is" : "s are"} denominated in ${input.currencyMismatch.currencies.join(" / ")}, while the company base currency is ${input.currencyMismatch.baseCurrency}. What conversion treatment should be used before including them in ${input.month}?`, evidence: [`Sources: ${input.currencyMismatch.sources.join(" · ")}`] });
  if (input.unmatchedBookCount) questions.push({ kind: "unmatched", question: `${input.unmatchedBookCount} bank or books transaction${input.unmatchedBookCount === 1 ? " is" : "s are"} unmatched in ${input.month}. Should they be matched to a counterpart, excluded as timing activity, or classified for accounting treatment?`, evidence: [`Sources: ${(input.unmatchedBookSources ?? []).join(" · ")}`] });
  if (input.bookBalanceComparison && Math.abs(input.bookBalanceComparison.difference) > 0.01) questions.push({ kind: "books", question: `What explains the ${Math.abs(input.bookBalanceComparison.difference).toFixed(2)} difference between bank statement ending cash and the books for ${input.month}?`, evidence: [`Statements: ${input.bookBalanceComparison.statementBalance.toFixed(2)} · ${input.bookBalanceComparison.statementSources.join(" · ")}`, `Books: ${input.bookBalanceComparison.bookBalance.toFixed(2)} · ${input.bookBalanceComparison.bookSources.join(" · ")}`] });
  if (input.duplicateGroups.length) {
    const sourceNames = [...new Set(input.duplicateGroups.flatMap((group) => group.sources))];
    questions.push({ kind: "duplicate", question: `Should the ${input.duplicateGroups.length} transaction match${input.duplicateGroups.length === 1 ? "" : "es"} found across these sources be consolidated so each activity is counted once?`, evidence: [`${input.transactionCount} unique transactions after exact matching`, `Sources: ${sourceNames.join(" · ")}`, ...input.duplicateGroups.slice(0, 5).map((group) => `${group.date ?? input.month} · ${group.amount.toFixed(2)} ${group.direction}: ${group.descriptions.join(" / ")}`)] });
  }
  if (input.unclassifiedCount) questions.push({ kind: "classification", question: `How should the ${input.unclassifiedCount} unclassified cash event${input.unclassifiedCount === 1 ? "" : "s"} in ${input.month} be treated?`, evidence: ["The event has a date and amount but no reliable revenue, expense, transfer, or investment classification."] });
  return questions;
}
