import { buildForecastRun, type ForecastAccount, type ForecastRunInput } from "./forecast-run";
import { summarizeActualCash } from "./forecast-actuals";
import { addMonths, isValidMonth } from "./periods";
import { cashMovement, type CashOccurrence } from "./forecast-settlement";
import { matchingForecastTemplates, type ForecastDriver, type ForecastEntryTemplate } from "./forecast-projections";

export const recurrenceRuleVersion = "fixed-driver-recurrence-2026-09-25.1";
export type RecurrenceDefinition = { history?: { patternKey: string; sourceLineIds: string[]; sourceHash: string; expectedDay: number; ruleVersion: string }; sourceFingerprint?: string; ruleVersion: string; driver: ForecastDriver; templates: ForecastEntryTemplate[]; accounts: ForecastAccount[]; currency: string };
export type RecurrencePolicy = { id: string; driverId: string; version: number; status: "active" | "paused"; startMonth: string; endMonth: string; definition: RecurrenceDefinition; definitionHash: string };
export type RecurrenceState = { policy: RecurrencePolicy; state: "active" | "paused" | "expired" | "stale"; reason: string | null; pendingCount: number };
export type RecurrenceContext = Pick<ForecastRunInput, "drivers" | "templates" | "accounts" | "currency">;

/** Approve one fixed schedule and its exact treatment, not every future edit of a driver. */
export function recurrenceDefinition(input: RecurrenceContext, driverId: string): RecurrenceDefinition | null {
  const driver = input.drivers.find((item) => item.id === driverId);
  if (!driver || driver.cadence === "once" || driver.amountFormula !== undefined || driver.amountByMonth !== undefined || driver.scenarioId || !/^[1-9]\d{0,29}$/.test(driver.amountMinor) || !isValidMonth(driver.effectiveFrom) || driver.effectiveTo && !isValidMonth(driver.effectiveTo)) return null;
  const templates = matchingForecastTemplates(driver, input.templates);
  if (templates.length !== 1) return null;
  const template = templates[0]!;
  const accounts = input.accounts.filter((account) => account.accountId === template.debitAccountId || account.accountId === template.creditAccountId).sort((a, b) => a.accountId.localeCompare(b.accountId));
  if (accounts.length !== 2) return null;
  const definition = { ruleVersion: recurrenceRuleVersion, driver, templates, accounts, currency: input.currency };
  // The shared projection engine validates cadence, treatment and supported cash shape.
  return recurringOccurrences(definition, driver.effectiveFrom, driver.effectiveFrom).length ? definition : null;
}

export function recurringOccurrences(definition: RecurrenceDefinition, startMonth: string, endMonth: string): Omit<CashOccurrence, "id" | "version">[] {
  if (!isValidMonth(startMonth) || !isValidMonth(endMonth) || startMonth > endMonth) return [];
  const [sy, sm] = startMonth.split("-").map(Number); const [ey, em] = endMonth.split("-").map(Number);
  const horizonMonths = (ey! - sy!) * 12 + em! - sm! + 1;
  if (horizonMonths > 24) throw new Error("Recurring capture is limited to 24 months per approval.");
  const asOfMonth = addMonths(startMonth, -1);
  const run = buildForecastRun({ actuals: summarizeActualCash([], definition.currency, asOfMonth), drivers: [definition.driver], templates: definition.templates, accounts: definition.accounts, currency: definition.currency, asOfMonth, horizonMonths, minimumCashMinor: "0" });
  const groups = new Map<string, typeof run.projectedLines>();
  for (const line of run.projectedLines) { const key = line.entryId!; groups.set(key, [...(groups.get(key) ?? []), line]); }
  return [...groups].flatMap(([key, lines]) => {
    const movement = cashMovement(lines); if (!movement) return [];
    const expectedDate = definition.history ? `${lines[0]!.period}-${String(Math.min(definition.history.expectedDay, new Date(Date.parse(`${addMonths(lines[0]!.period, 1)}-01T00:00:00Z`) - 86400000).getUTCDate())).padStart(2, "0")}` : movement.postingDate;
    const datedLines = lines.map((line) => ({ ...line, postingDate: expectedDate }));
    return [{ key, label: definition.driver.label, origin: definition.history ? "history" as const : "driver" as const, driverId: definition.driver.id, originalMonth: lines[0]!.period, expectedDate, amountMinor: movement.amountMinor, originalAmountMinor: movement.amountMinor, currency: definition.currency, status: "active" as const, final: false, lines: datedLines, sourceLineIds: definition.history?.sourceLineIds ?? [], autoMatchFactId: null }];
  });
}
