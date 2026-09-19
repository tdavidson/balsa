import { addMonths, type ForecastAccount, type ForecastDriver, type ForecastEntryTemplate, type WorkingCapitalCategory } from "@nevermodel/finance-engine";

const cadences = ["once", "monthly", "quarterly", "annual"] as const;
const cashFlowCategories = ["operating", "investing", "financing", "none"] as const;
const workingCapitalCategories = ["receivables", "payables", "deferred_revenue", "prepaids", "inventory", "other"] as const;

/** "1250.5" → "125050". Anything else becomes "", which the engine reports as a driver exception. */
export function amountToMinor(value: string | null | undefined): string {
  if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return "";
  const [whole, fraction = ""] = value.split(".");
  return `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
}

export type EconomicItemDriverRow = { id: string; label: string; type: string; direction: "receipt" | "spend"; category: string | null; amount: string | null; amountFormula?: string | null; cadence: string | null; effectiveFrom: string | null; effectiveTo: string | null; scenarioId: string | null; decisionId: string | null; evidenceId: string | null; factId: string | null; counterpartyEntityId: string | null };
export function economicItemToDriver(item: EconomicItemDriverRow): ForecastDriver {
  return {
    id: item.id, label: item.label, itemType: item.type === "obligation" ? "obligation" : "agreement", direction: item.direction,
    ...(item.category ? { category: item.category } : {}), amountMinor: amountToMinor(item.amount), ...(item.amountFormula ? { amountFormula: item.amountFormula } : {}), cadence: cadences.find((cadence) => cadence === item.cadence) ?? "once", effectiveFrom: item.effectiveFrom ?? "",
    ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), ...(item.scenarioId ? { scenarioId: item.scenarioId } : {}), ...(item.decisionId ? { decisionId: item.decisionId } : {}),
    ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}), ...(item.factId ? { factId: item.factId } : {}), ...(item.counterpartyEntityId ? { counterpartyEntityId: item.counterpartyEntityId } : {}),
  };
}

export type TemplateRow = { id: string; itemType: string; direction: "receipt" | "spend"; category: string | null; debitAccountId: string; creditAccountId: string; decisionId: string | null; policyId: string | null };
export function templateRowToTemplate(row: TemplateRow): ForecastEntryTemplate {
  return { id: row.id, itemType: row.itemType === "obligation" ? "obligation" : "agreement", direction: row.direction, ...(row.category ? { category: row.category } : {}), debitAccountId: row.debitAccountId, creditAccountId: row.creditAccountId, ...(row.decisionId ? { decisionId: row.decisionId } : {}), ...(row.policyId ? { policyId: row.policyId } : {}) };
}

export type ChartAccountRow = { id: string; code: string; name: string; accountType: string; normalBalance: "debit" | "credit"; statementSection: string | null; statementLine: string | null; balanceTiming: string | null; cashFlowCategory: string | null; workingCapitalCategory: string | null };
export function chartAccountToForecastAccount(row: ChartAccountRow): ForecastAccount {
  const timing = row.balanceTiming === "current" || row.balanceTiming === "noncurrent" ? row.balanceTiming : undefined;
  const cashFlow = cashFlowCategories.find((category) => category === row.cashFlowCategory);
  const workingCapital: WorkingCapitalCategory | undefined = workingCapitalCategories.find((category) => category === row.workingCapitalCategory);
  return {
    accountId: row.id, accountCode: row.code, accountName: row.name, accountType: row.accountType, normalBalance: row.normalBalance,
    ...(row.statementSection ? { statementSection: row.statementSection } : {}), ...(row.statementLine ? { statementLine: row.statementLine } : {}),
    ...(timing ? { balanceTiming: timing } : {}), ...(cashFlow ? { cashFlowCategory: cashFlow } : {}), ...(workingCapital ? { workingCapitalCategory: workingCapital } : {}),
  };
}

/** The forecast's as-of month: max(latest closed period, last full calendar month), so posted actuals after an old close stay visible. */
export function forecastAsOfFromClosure(latestClosedPeriod: string | null, now: Date): string {
  const lastFullMonth = addMonths(now.toISOString().slice(0, 7), -1);
  return latestClosedPeriod && latestClosedPeriod > lastFullMonth ? latestClosedPeriod : lastFullMonth;
}
