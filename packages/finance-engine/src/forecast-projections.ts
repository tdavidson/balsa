import type { EntryBasis } from "./ledger";

export type ForecastDriver = { id: string; label: string; itemType: "agreement" | "obligation"; direction: "receipt" | "spend"; category?: string; amountMinor: string; cadence: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom: string; effectiveTo?: string; scenarioId?: string; decisionId?: string; policyId?: string; /** Lineage back to the evidence and fact behind the economic item. */ evidenceId?: string; factId?: string; counterpartyEntityId?: string };
export type ForecastEntryTemplate = { id: string; itemType: ForecastDriver["itemType"]; direction: ForecastDriver["direction"]; category?: string; debitAccountId: string; creditAccountId: string; decisionId?: string; policyId?: string };
export type ProjectedEntry = { idempotencyKey: string; projectionKey: string; period: string; postingDate: string; memo: string; basis: Extract<EntryBasis, "forecast" | "scenario">; scenarioId?: string; sourceDriverId: string; templateId: string; lines: { accountId: string; debitMinor: string; creditMinor: string }[] };

const step: Record<ForecastDriver["cadence"], number> = { once: 0, monthly: 1, quarterly: 3, annual: 12 };
const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const addMonths = (month: string, increment: number) => { const [year, number] = month.split("-").map(Number); const date = new Date(Date.UTC(year!, number! - 1 + increment, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; };
const projectionKey = (driver: ForecastDriver, scenarioId: string | undefined, month: string) => `projection:${driver.id}:${scenarioId ?? "base"}:${month}`;
/** A changed amount or posting template is a new immutable projection version. */
const projectionVersion = (driver: ForecastDriver, template: ForecastEntryTemplate) => `${template.id}:${template.debitAccountId}:${template.creditAccountId}:${driver.amountMinor}`;

/** Expand approved forecast drivers into balanced projected entry drafts. */
export function buildProjectedEntries(drivers: ForecastDriver[], templates: ForecastEntryTemplate[], horizon: { start: string; end: string }, scenarioId?: string): { entries: ProjectedEntry[]; exceptions: { driverId: string; reason: string }[] } {
  const entries: ProjectedEntry[] = []; const exceptions: { driverId: string; reason: string }[] = [];
  for (const driver of drivers) {
    if (!validMonth(driver.effectiveFrom) || !validMonth(horizon.start) || !validMonth(horizon.end) || !/^\d+$/.test(driver.amountMinor)) { exceptions.push({ driverId: driver.id, reason: "Driver needs a valid monthly schedule and minor-unit amount." }); continue; }
    const matches = templates.filter((template) => template.itemType === driver.itemType && template.direction === driver.direction && (!template.category || template.category === driver.category));
    if (matches.length !== 1) { exceptions.push({ driverId: driver.id, reason: matches.length ? "Driver matches multiple forecast-entry templates." : "Driver has no approved forecast-entry template." }); continue; }
    const template = matches[0]!; const last = driver.effectiveTo && driver.effectiveTo < horizon.end ? driver.effectiveTo : horizon.end;
    for (let month = driver.effectiveFrom; month <= last; month = addMonths(month, step[driver.cadence])) {
      if (month < horizon.start) { if (driver.cadence === "once") break; continue; }
      const key = projectionKey(driver, scenarioId, month);
      entries.push({ idempotencyKey: `${key}:${projectionVersion(driver, template)}`, projectionKey: key, period: month, postingDate: `${month}-01`, memo: `Projected: ${driver.label}`, basis: scenarioId ? "scenario" : "forecast", ...(scenarioId ? { scenarioId } : {}), sourceDriverId: driver.id, templateId: template.id, lines: [{ accountId: template.debitAccountId, debitMinor: driver.amountMinor, creditMinor: "0" }, { accountId: template.creditAccountId, debitMinor: "0", creditMinor: driver.amountMinor }] });
      if (driver.cadence === "once") break;
    }
  }
  return { entries, exceptions };
}
