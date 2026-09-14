import { describe, expect, it } from "vitest";
import { buildJournalStatements } from "./statements";
import { onboardingJournalFixtures } from "./fixtures/onboarding-journal-fixtures";

describe("redacted onboarding journal fixtures", () => {
  it("never promotes an internal cash transfer into revenue", () => {
    const fixture = onboardingJournalFixtures.internalBankTransfer;
    const statement = buildJournalStatements(fixture.lines, fixture.period).byCurrency[0]!;
    expect(statement.incomeStatement.revenue).toEqual([]);
    expect(statement.incomeStatement.netIncomeMinor).toBe(fixture.expected.revenueMinor);
    expect(statement.cashFlow?.cashMovementMinor).toBe(fixture.expected.cashMovementMinor);
    expect(statement.balanceSheet.balanced).toBe(fixture.expected.balanced);
  });
});
