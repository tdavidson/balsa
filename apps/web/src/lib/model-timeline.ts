import { addMonths, isValidMonth } from "@balsa/finance-engine";

/** Rolling default when the company has not set a timeline: the forecast runs this many months past the as-of month. */
export const defaultForecastHorizonMonths = 24;
/** Upper bound on a user-set timeline's forecast, so a typo cannot ask for decades of monthly cells. */
export const maxForecastHorizonMonths = 120;
/** Upper bound on how many months one Standard view or export spans. */
export const maxTimelineMonths = 180;

export type StoredTimeline = { modelFirstPeriod: string | null; modelLastPeriod: string | null; fiscalYearEnd: string | null };
export type ModelTimeline = { firstPeriod: string; lastPeriod: string; fiscalYearEndMonth: number; forecastHorizonMonths: number; isDefault: boolean; warnings: string[] };

export const monthsBetween = (from: string, to: string) => { const [fromYear, fromMonth] = from.split("-").map(Number); const [toYear, toMonth] = to.split("-").map(Number); return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!); };
export const parseFiscalYearEndMonth = (stored: string | null) => { const month = Number(stored); return stored && Number.isInteger(month) && month >= 1 && month <= 12 ? month : 12; };

/** Months the forecast runs past `asOfMonth`: up to the user's last period when set, otherwise the rolling default. */
export function forecastHorizonFor(asOfMonth: string, lastPeriod: string | null) {
  if (!lastPeriod || !isValidMonth(lastPeriod)) return defaultForecastHorizonMonths;
  return Math.min(maxForecastHorizonMonths, Math.max(1, monthsBetween(asOfMonth, lastPeriod)));
}

/**
 * The timeline the Standard view and the forecast use. Unset values default to
 * twelve months of history before the as-of month and the rolling forecast
 * horizon after it, with a December fiscal year end.
 */
export function resolveModelTimeline(stored: StoredTimeline, asOfMonth: string): ModelTimeline {
  const warnings: string[] = [];
  const forecastHorizonMonths = forecastHorizonFor(asOfMonth, stored.modelLastPeriod);
  const firstPeriod = stored.modelFirstPeriod && isValidMonth(stored.modelFirstPeriod) ? stored.modelFirstPeriod : addMonths(asOfMonth, -11);
  const lastPeriod = addMonths(asOfMonth, forecastHorizonMonths);
  if (stored.modelLastPeriod && isValidMonth(stored.modelLastPeriod) && stored.modelLastPeriod <= asOfMonth) warnings.push(`The timeline ends in ${stored.modelLastPeriod}, at or before the as-of month ${asOfMonth}; the forecast runs one month.`);
  if (stored.modelLastPeriod && monthsBetween(asOfMonth, stored.modelLastPeriod) > maxForecastHorizonMonths) warnings.push(`The forecast is limited to ${maxForecastHorizonMonths} months past the as-of month.`);
  return { firstPeriod, lastPeriod, fiscalYearEndMonth: parseFiscalYearEndMonth(stored.fiscalYearEnd), forecastHorizonMonths, isDefault: !stored.modelFirstPeriod && !stored.modelLastPeriod && !stored.fiscalYearEnd, warnings };
}

/** Validate a timeline a user submits. Returns an error message, or null when valid. */
export function validateTimeline(input: { firstPeriod: string; lastPeriod: string; fiscalYearEndMonth: number }) {
  if (!isValidMonth(input.firstPeriod) || !isValidMonth(input.lastPeriod)) return "First and last period must be YYYY-MM months.";
  if (input.firstPeriod > input.lastPeriod) return "The first period must come before the last period.";
  if (monthsBetween(input.firstPeriod, input.lastPeriod) + 1 > maxTimelineMonths) return `A timeline can span at most ${maxTimelineMonths} months.`;
  if (!Number.isInteger(input.fiscalYearEndMonth) || input.fiscalYearEndMonth < 1 || input.fiscalYearEndMonth > 12) return "Fiscal year end must be a month from 1 to 12.";
  return null;
}
