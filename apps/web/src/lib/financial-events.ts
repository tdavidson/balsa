const summaryPattern = /balance sheet|holding\b|allocation\b|change in value|net credits?|credits?\s+debits?|total value|total income|total automated|automated payments?\s+total|this period|this year|year-to-date|estimated annual|percentage of holdings|current yield|unrealized|beginning total|ending total|opening total|consolidated|all accounts|total assets|total cash|cash related activity|investment related activity|sales and redemptions|electronic transfers?|closing cash|ending cash|opening cash|cash balance/i;

/** Transfers change the cash location, but are not revenue or expense. */
export function isTransferDescription(description: string) {
  return /(?:^|\b)(?:cash\s+)?transfer(?:s)?\b|internal\s+(?:cash\s+)?move|account\s+(?:sweep|move)|intercompany|auto(?:matic)?\s+bank\s+product\s+(?:deposit|withdrawal)|automatic\s+(?:investment|redemption)|bank\s+deposit\s+program/i.test(description);
}

/** Some statements show sweep activity twice: once in cash flow and once as
 * the matching MMF/BDP counterpart. Use the cash-flow view for roll-forwards. */
export function isSweepCounterpartActivity(description: string) {
  return /^(?:MMF\/BDP|BDP\/MMF)\s+Activity\b/i.test(description) || /automatic\s+(?:redemption|investment).*bank\s+deposit\s+program/i.test(description);
}

/** Investment purchases, sales, and redemptions are investing activity, not operating P&L. */
export function isInvestmentActivity(description: string) {
  return /investment|redemption|\bbought\b|\bbuy\b|\bpurchase\b|\bsold\b|\bsale\b/i.test(description) && !/interest income|dividend income/i.test(description);
}

export type CashActivityCategory = "transfer" | "investment" | "revenue" | "expense" | "unclassified";

export function classifyCashActivity(description: string, direction: "receipt" | "spend"): CashActivityCategory {
  if (isTransferDescription(description)) return "transfer";
  if (isInvestmentActivity(description)) return "investment";
  if (direction === "spend") return "expense";
  return /revenue|sales?|customer|client|management\s+fee|advisory\s+fee|service\s+fee|subscription|retainer|consulting\s+fee|interest\s+income|dividend/i.test(description) ? "revenue" : "unclassified";
}

/** Extract the final currency amount, preserving parentheses and minus signs. */
export function parseFinancialAmount(value: string) {
  const currencyMatches = [...value.matchAll(/[-−]?\s*(?:USD\s*|\$)\s*(\(?\s*[\d,]+(?:\.\d+)?\s*\)?)/gi)];
  // Statements and GL exports frequently omit a currency symbol. Accept a
  // decimal-formatted amount, but not bare integers that could be dates or IDs.
  const bareMatches = [...value.matchAll(/[-−]?\s*(\(?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\s*\)?)/g)];
  const matches = currencyMatches.length ? currencyMatches : bareMatches;
  const match = matches.at(-1);
  if (!match?.[1]) return undefined;
  const amount = Number(match[1].replace(/[(),\s]/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  return /[-−]|\(/.test(match[0]!) ? -amount : amount;
}

export function isDetailedFinancialEvent(description: string) {
  // Deterministic CSV/OFX rows often have ordinary merchant or customer
  // descriptions (for example, "Den Technologies") rather than statement
  // keywords. A non-summary cash event is therefore a transaction by default;
  // summary lines remain excluded before they can reach reporting.
  return Boolean(description.trim()) && !summaryPattern.test(description);
}

/** Balances, totals, and period summaries describe positions, not transactions. */
export function isSummaryDescription(description: string) {
  return summaryPattern.test(description);
}

export function inferFinancialDirection(direction: string, description: string): "receipt" | "spend" {
  // These labels describe the destination account, so their cash direction
  // is opposite the ordinary English meaning of "withdrawal".
  if (/bank\s+product\s+withdrawal|automatic\s+redemption/i.test(description)) return "receipt";
  if (/bank\s+product\s+deposit|automatic\s+investment/i.test(description)) return "spend";
  if (/\b(debit|withdrawal|withdraw|outflow|payment|paid|payroll|expense|spend|cost|purchase|bought)\b|\(\s*\$|[-−]\s*\$/i.test(description)) return "spend";
  if (/\b(credit|deposit|inflow|receipt|received|income|dividend|interest)\b|\+\s*\$/i.test(description)) return "receipt";
  return direction === "spend" ? "spend" : "receipt";
}

export function financialEventKey(event: { month: string; transactionDate?: string | null; amount: string | number; direction: string; description: string }) {
  const activityStart = event.description.search(/activity date|settlement date|period \d{4}-\d{2}/i);
  const detail = activityStart >= 0 ? event.description.slice(activityStart).replace(/\s+/g, " ").trim() : event.description.replace(/\s+/g, " ").trim();
  const activityDate = detail.match(/activity date\s+(20\d{2}-\d{2}-\d{2})/i)?.[1];
  return `${activityDate ?? event.transactionDate ?? event.month}|${event.amount}|${event.direction}|${detail}`;
}
