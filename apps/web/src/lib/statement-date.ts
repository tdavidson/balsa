import { z } from "zod";

const isoDate = /^20\d{2}-(\d{2})-(\d{2})$/;
const numericDate = /^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/;
const namedDate = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})$/i;
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function validDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

/** Normalize explicit statement dates without guessing locale or partial dates. */
export function normalizeStatementDate(value: string): string | undefined {
  const input = value.trim();
  const iso = input.match(isoDate);
  if (iso) {
    const [year, month, day] = input.split("-").map(Number);
    return validDate(year!, month!, day!) ? input : undefined;
  }
  const numeric = input.match(numericDate);
  if (numeric) {
    const month = Number(numeric[1]); const day = Number(numeric[2]); const year = Number(numeric[3]);
    return validDate(year, month, day) ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : undefined;
  }
  const named = input.match(namedDate);
  if (named) {
    const month = months.indexOf(named[1]!.toLowerCase()) + 1; const day = Number(named[2]); const year = Number(named[3]);
    return validDate(year, month, day) ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : undefined;
  }
  return undefined;
}

// A malformed optional date should not discard an otherwise useful document.
// It remains absent and can be recovered from deterministic statement parsing,
// the filename/reporting month, or CFO review.
export const optionalStatementDateSchema = z.string().transform(normalizeStatementDate).optional();
