/** Canonical YYYY-MM period helpers shared by journal and forecast entries. */
export type Month = string;

export function isValidMonth(value: unknown): value is Month {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addMonths(month: Month, count: number): Month {
  if (!isValidMonth(month)) throw new Error(`Invalid reporting period: ${month}`);
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, number! - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
