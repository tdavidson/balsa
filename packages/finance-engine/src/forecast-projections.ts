import type { EntryBasis, PostedJournalLine } from "./ledger";

export type RecognitionProof = { driverId: string; currency: string; throughMonth: string; lines: PostedJournalLine[]; valid: boolean };
export type ForecastDriver = { expectedDay?: number; accountingTreatment?: string; recognitionStart?: string; recognitionEnd?: string; templateId?: string; id: string; label: string; itemType: "agreement" | "obligation"; direction: "receipt" | "spend"; category?: string; amountMinor: string; /** A formula over the forecast model, in major units; when set, `amountMinor` is a display fallback only. */ amountFormula?: string; /** Resolved per-month minor units for a formula driver (set by resolveFormulaDrivers, never stored). */ amountByMonth?: Record<string, string>; cadence: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom: string; effectiveTo?: string; scenarioId?: string; decisionId?: string; policyId?: string; /** Lineage back to the evidence and fact behind the economic item. */ evidenceId?: string; factId?: string; counterpartyEntityId?: string };
export type ForecastEntryTemplate = { id: string; itemType: ForecastDriver["itemType"]; direction: ForecastDriver["direction"]; category?: string; debitAccountId: string; creditAccountId: string; decisionId?: string; policyId?: string };
/** An explicit approved mapping is narrower than a generic direction/category rule. */
export const matchingForecastTemplates = (driver: ForecastDriver, templates: ForecastEntryTemplate[]) => templates.filter((template) => template.itemType === driver.itemType && template.direction === driver.direction && (driver.templateId ? template.id === driver.templateId : !template.category || template.category === driver.category));
export type ProjectedEntry = { idempotencyKey: string; projectionKey: string; period: string; postingDate: string; memo: string; basis: Extract<EntryBasis, "forecast" | "scenario">; scenarioId?: string; sourceDriverId: string; templateId: string; lines: { accountId: string; debitMinor: string; creditMinor: string }[] };

const step: Record<ForecastDriver["cadence"], number> = { once: 0, monthly: 1, quarterly: 3, annual: 12 };
const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const addMonths = (month: string, increment: number) => { const [year, number] = month.split("-").map(Number); const date = new Date(Date.UTC(year!, number! - 1 + increment, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; };
const projectionKey = (driver: ForecastDriver, scenarioId: string | undefined, month: string) => `projection:${driver.id}:${scenarioId ?? "base"}:${month}`;
/** A changed amount or posting template is a new immutable projection version. */
/** A changed amount or posting template is a new immutable projection version. */
const projectionVersion = (template: ForecastEntryTemplate, amountMinor: string) => `${template.id}:${template.debitAccountId}:${template.creditAccountId}:${amountMinor}`;

/**
 * Expand approved forecast drivers into balanced projected entry drafts.
 * A formula driver (resolved `amountByMonth`) posts each emitted month's own amount:
 * a missing or zero month is skipped, and a negative or non-integer month makes the
 * whole driver an exception. The cadence still chooses which months emit.
 */
export function buildProjectedEntries(drivers: ForecastDriver[], templates: ForecastEntryTemplate[], horizon: { start: string; end: string }, scenarioId?: string, accounts: { accountId: string; accountType: string; workingCapitalCategory?: string; statementLine?: string; accountName: string }[] = [], proofs: RecognitionProof[] = []): { entries: ProjectedEntry[]; exceptions: { driverId: string; reason: string }[] } {
  const entries: ProjectedEntry[] = []; const exceptions: { driverId: string; reason: string }[] = [];
  for (const driver of drivers) {
    const monthly = driver.amountByMonth;
    if (driver.expectedDay !== undefined && (!Number.isInteger(driver.expectedDay) || driver.expectedDay < 1 || driver.expectedDay > 31)) { exceptions.push({ driverId: driver.id, reason: "Expected payment day must be between 1 and 31." }); continue; }
    if (!validMonth(driver.effectiveFrom) || !validMonth(horizon.start) || !validMonth(horizon.end) || (monthly === undefined && driver.amountFormula === undefined && !/^\d+$/.test(driver.amountMinor))) { exceptions.push({ driverId: driver.id, reason: "Driver needs a valid monthly schedule and minor-unit amount." }); continue; }
    if (monthly === undefined && driver.amountFormula !== undefined) { exceptions.push({ driverId: driver.id, reason: "Formula driver was not resolved against the forecast model." }); continue; }
    const matches = matchingForecastTemplates(driver, templates);
    if (matches.length !== 1) { exceptions.push({ driverId: driver.id, reason: matches.length ? "Driver matches multiple forecast-entry templates." : "Driver has no approved forecast-entry template." }); continue; }
    const template = matches[0]!;
    if (driver.accountingTreatment && driver.accountingTreatment !== "cash") {
      const result = recognitionEntries(driver, template, horizon, scenarioId, accounts, proofs.find((proof) => proof.driverId === driver.id));
      if (typeof result === "string") exceptions.push({ driverId: driver.id, reason: result }); else entries.push(...result);
      continue;
    } const last = driver.effectiveTo && driver.effectiveTo < horizon.end ? driver.effectiveTo : horizon.end;
    const driverEntries: ProjectedEntry[] = []; let invalid: string | null = null;
    for (let month = driver.effectiveFrom; month <= last; month = addMonths(month, step[driver.cadence])) {
      if (month < horizon.start) { if (driver.cadence === "once") break; continue; }
      const amount = monthly ? monthly[month] : driver.amountMinor;
      if (monthly) {
        if (amount === undefined || amount === "0") { if (driver.cadence === "once") break; continue; }
        if (!/^-?\d+$/.test(amount)) { invalid = `Formula amount for ${month} is invalid.`; break; }
        if (amount.startsWith("-")) { invalid = `Formula amount for ${month} is negative.`; break; }
      }
      const key = projectionKey(driver, scenarioId, month);
      driverEntries.push({ idempotencyKey: `${key}:${projectionVersion(template, amount!)}`, projectionKey: key, period: month, postingDate: `${month}-${String(Math.min(driver.expectedDay ?? 1, new Date(Date.parse(`${addMonths(month, 1)}-01T00:00:00Z`) - 86400000).getUTCDate())).padStart(2, "0")}`, memo: `Projected: ${driver.label}`, basis: scenarioId ? "scenario" : "forecast", ...(scenarioId ? { scenarioId } : {}), sourceDriverId: driver.id, templateId: template.id, lines: [{ accountId: template.debitAccountId, debitMinor: amount!, creditMinor: "0" }, { accountId: template.creditAccountId, debitMinor: "0", creditMinor: amount! }] });
      if (driver.cadence === "once") break;
    }
    if (invalid) { exceptions.push({ driverId: driver.id, reason: invalid }); continue; }
    entries.push(...driverEntries);
  }
  return { entries, exceptions };
}

/** Fixed single payments with an explicit recognition interval use the same balanced journals. */
function recognitionEntries(driver: ForecastDriver, template: ForecastEntryTemplate, horizon: { start: string; end: string }, scenarioId: string | undefined, accounts: { accountId: string; accountType: string; workingCapitalCategory?: string; statementLine?: string; accountName: string }[], proof?: RecognitionProof): ProjectedEntry[] | string {
  const treatment = driver.accountingTreatment;
  const start = driver.recognitionStart; const end = driver.recognitionEnd;
  if (!["accrual", "prepaid"].includes(treatment ?? "") || driver.cadence !== "once" || driver.amountFormula || !start || !end || !validMonth(start) || !validMonth(end) || start > end || !/^[1-9]\d*$/.test(driver.amountMinor)) return "Non-cash treatment requires one fixed payment and an explicit recognition interval.";
  const count = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5)) - Number(start.slice(5)) + 1;
  if (count > 24 || (treatment === "prepaid" ? driver.effectiveFrom > start : driver.effectiveFrom < end)) return "Recognition supports up to 24 months, with prepayment before recognition or accrual payment after recognition.";
  const receipt = driver.direction === "receipt";
  const cashId = receipt ? template.debitAccountId : template.creditAccountId; const incomeId = receipt ? template.creditAccountId : template.debitAccountId;
  const cash = accounts.find((account) => account.accountId === cashId); const income = accounts.find((account) => account.accountId === incomeId);
  if (!cash || cash.accountType !== "asset" || !/cash/i.test(cash.statementLine ?? cash.accountName) || income?.accountType !== (receipt ? "revenue" : "expense")) return "Recognition needs an approved cash-to-revenue or expense-to-cash template.";
  const category = treatment === "prepaid" ? receipt ? "deferred_revenue" : "prepaids" : receipt ? "receivables" : "payables";
  const expectedType = category === "prepaids" || category === "receivables" ? "asset" : "liability";
  const matching = accounts.filter((account) => account.workingCapitalCategory === category && account.accountType === expectedType && account.accountId !== cashId && account.accountId !== incomeId);
  if (matching.length !== 1) return `Recognition requires exactly one active ${category} account with an explicit working-capital mapping.`;
  const holding = matching[0]!.accountId; const total = BigInt(driver.amountMinor); const result: ProjectedEntry[] = [];
  function emit(month: string, amount: bigint, debit: string, credit: string, recognition: boolean) {
    if (amount === 0n) return;
    const key = `${projectionKey(driver, scenarioId, month)}${recognition ? ":recognition" : ""}`;
    result.push({ idempotencyKey: `${key}:${template.id}:${debit}:${credit}:${amount}`, projectionKey: key, period: month, postingDate: `${month}-01`, memo: `${recognition ? "Recognition" : "Payment"}: ${driver.label}`, basis: scenarioId ? "scenario" : "forecast", ...(scenarioId ? { scenarioId } : {}), sourceDriverId: driver.id, templateId: template.id, lines: [{ accountId: debit, debitMinor: String(amount), creditMinor: "0" }, { accountId: credit, debitMinor: "0", creditMinor: String(amount) }] });
  }
  emit(driver.effectiveFrom, total, receipt ? cashId : holding, receipt ? holding : cashId, false);
  for (let index = 0; index < count; index++) emit(addMonths(start, index), total / BigInt(count) + (BigInt(index) < total % BigInt(count) ? 1n : 0n), receipt ? holding : incomeId, receipt ? incomeId : holding, true);
  const past = result.filter((entry) => entry.period < horizon.start);
  if (past.length) {
    if (!proof?.valid || addMonths(proof.throughMonth, 1) !== horizon.start) return "Recognition continuity needs reviewed actual journals through the opening boundary.";
    const actual = proof.lines.filter((line) => line.period <= proof.throughMonth);
    if (actual.some((line) => !["actual", "adjustment"].includes(line.basis ?? "actual") || line.currency !== proof.currency || line.entityId || line.fxRateId || !/^\d+$/.test(line.debitMinor) || !/^\d+$/.test(line.creditMinor) || line.postingDate && line.postingDate.slice(0, 7) !== line.period)) return "Recognition continuity has unsupported actual basis, entity, currency or date scope.";
    const totals = (lines: { accountId: string; debitMinor: string; creditMinor: string }[]) => {
      const values = new Map<string, [bigint, bigint]>();
      for (const line of lines) { const prior = values.get(line.accountId) ?? [0n, 0n]; values.set(line.accountId, [prior[0] + BigInt(line.debitMinor), prior[1] + BigInt(line.creditMinor)]); }
      return JSON.stringify([...values].sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => [id, value.map(String)]));
    };
    if (totals(actual) !== totals(past.flatMap((entry) => entry.lines))) return "Recognition continuity does not reconcile to the scheduled completed payment and recognition. Review its linked journals.";
  }
  return result.filter((entry) => entry.period >= horizon.start && entry.period <= horizon.end);
}
