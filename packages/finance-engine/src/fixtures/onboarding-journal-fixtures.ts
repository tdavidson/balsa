import type { PostedJournalLine } from "../ledger";

/**
 * Redacted regression cases from onboarding. Add a new case before fixing any
 * material production discrepancy; these never contain company names or files.
 */
export const onboardingJournalFixtures = {
  internalBankTransfer: {
    period: "2026-07",
    lines: [
      { id: "transfer-checking", entryId: "transfer-1", accountId: "checking", accountCode: "1000", accountName: "Operating cash", accountType: "asset", normalBalance: "debit", statementLine: "cash", currency: "USD", debitMinor: "125000", creditMinor: "0", period: "2026-07", provenance: { sourceId: "redacted-bank-source", sourceLocation: "transaction:1" } },
      { id: "transfer-savings", entryId: "transfer-1", accountId: "savings", accountCode: "1010", accountName: "Reserve cash", accountType: "asset", normalBalance: "debit", statementLine: "cash", currency: "USD", debitMinor: "0", creditMinor: "125000", period: "2026-07", provenance: { sourceId: "redacted-bank-source", sourceLocation: "transaction:1" } },
    ] satisfies PostedJournalLine[],
    expected: { revenueMinor: "0", cashMovementMinor: "0", balanced: true },
  },
} as const;
