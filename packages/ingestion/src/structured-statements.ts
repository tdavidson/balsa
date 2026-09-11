import type { SourceKind } from "./source-classification";

export type StructuredStatementFact = { label: string; value: string; accountingRole: "revenue" | "expense" | "summary"; confidence: number };

const revenueLabel = /^(?:total\s+)?(?:revenue|sales|management fees?|advisory fees?|service fees?|fee income|interest income|dividend income)\b/i;
const expenseLabel = /^(?:total\s+)?(?:cost of (?:revenue|sales)|operating expenses?|expenses?|payroll|salaries|wages|rent|professional fees?|legal fees?|taxes|insurance|marketing|advertising)\b/i;
const balanceLabel = /^(?:cash(?: and cash equivalents)?|accounts receivable|accounts payable|total assets|total liabilities|members?['’]? equity|shareholders?['’]? equity|retained earnings|total cash)\b/i;
const totalLabel = /^(?:gross profit|operating income|net income|net loss|total (?:assets|liabilities|equity|cash))\b/i;

function printedAmount(line: string) {
  const matches = [...line.matchAll(/\(?\s*(?:\$|USD\s*)?\s*[\d,]+\.\d{2}\s*\)?/g)];
  return matches.at(-1)?.[0]?.trim();
}

function cleanLabel(line: string, amount: string) {
  return line.slice(0, line.lastIndexOf(amount)).replace(/[|:·]+\s*$/, "").replace(/\s+/g, " ").trim();
}

/** Extracts common financial-statement line items directly from printed text. */
export function extractStructuredStatementFacts(text: string, kind: SourceKind): StructuredStatementFact[] {
  if (kind !== "profit_and_loss" && kind !== "balance_sheet") return [];
  const facts: StructuredStatementFact[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const amount = printedAmount(rawLine);
    if (!amount) continue;
    const label = cleanLabel(rawLine, amount);
    if (!label || label.length > 120) continue;
    const accountingRole = revenueLabel.test(label) ? "revenue" : expenseLabel.test(label) ? "expense" : totalLabel.test(label) || (kind === "balance_sheet" && balanceLabel.test(label)) ? "summary" : undefined;
    if (!accountingRole) continue;
    if (!facts.some((fact) => fact.label.toLowerCase() === label.toLowerCase() && fact.value === amount)) facts.push({ label, value: amount, accountingRole, confidence: 0.98 });
  }
  return facts;
}

/** Keeps deterministic statement lines when model extraction repeats the same label. */
export function mergeStatementFacts<T extends { label: string; value: string; accountingRole: string; confidence: number }>(modelFacts: T[], statementFacts: StructuredStatementFact[]): Array<T | StructuredStatementFact> {
  const statementLabels = new Set(statementFacts.map((fact) => fact.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  return [...statementFacts, ...modelFacts.filter((fact) => !statementLabels.has(fact.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()))];
}
