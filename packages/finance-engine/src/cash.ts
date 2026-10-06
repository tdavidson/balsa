import type { CurrencyJournalStatements } from "./statements";

import { cashFlag } from "./cash-flag";

/** The one rule for which balance-sheet lines count as cash; dashboards and forecasts must agree. */
export const isCashStatementLine = (line: { key: string; label: string; isCash?: boolean }) => cashFlag(line, () => /\bcash\b/i.test(`${line.key} ${line.label}`));

export function endingCashMinor(statement: CurrencyJournalStatements | null | undefined): bigint {
  return (statement?.balanceSheet.assets ?? []).filter(isCashStatementLine).reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
}
