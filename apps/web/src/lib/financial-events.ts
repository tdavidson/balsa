const summaryPattern = /balance sheet|holding\b|allocation\b|change in value|net credits?\/?\(debits?\)|total value|total income|total automated|this period|this year|estimated annual|percentage of holdings|current yield|unrealized|beginning total|ending total|opening total/i;
const transactionPattern = /cash flow activity|automated payment|funds received|wired funds|bank product withdrawal|cash transfer|interest income|dividend|sold|bought|purchase|redemption|investment|transaction/i;

/** Transfers change the cash location, but are not revenue or expense. */
export function isTransferDescription(description: string) {
  return /(?:^|\b)(?:cash\s+)?transfer(?:s)?\b|internal\s+(?:cash\s+)?move|account\s+(?:sweep|move)|intercompany|auto(?:matic)?\s+bank\s+product\s+deposit|automatic\s+investment|bank\s+deposit\s+program|preferred\s+savings/i.test(description);
}

/** Investment purchases, sales, and redemptions are investing activity, not operating P&L. */
export function isInvestmentActivity(description: string) {
  return /investment|redemption|\bbought\b|\bbuy\b|\bpurchase\b|\bsold\b|\bsale\b/i.test(description) && !/interest income|dividend income/i.test(description);
}

export type CashActivityCategory = "transfer" | "investment" | "revenue" | "expense";

export function classifyCashActivity(description: string, direction: "receipt" | "spend"): CashActivityCategory {
  if (isTransferDescription(description)) return "transfer";
  if (isInvestmentActivity(description)) return "investment";
  return direction === "receipt" ? "revenue" : "expense";
}

export function isDetailedFinancialEvent(description: string) {
  return transactionPattern.test(description) && !summaryPattern.test(description);
}

export function inferFinancialDirection(direction: string, description: string): "receipt" | "spend" {
  if (/\b(debit|withdrawal|withdraw|outflow|payment|paid|payroll|expense|spend|cost|purchase|bought)\b|\(\s*\$|[-−]\s*\$/i.test(description)) return "spend";
  if (/\b(credit|deposit|inflow|receipt|received|income|dividend|interest)\b|\+\s*\$/i.test(description)) return "receipt";
  return direction === "spend" ? "spend" : "receipt";
}

export function financialEventKey(event: { month: string; transactionDate?: string | null; amount: string | number; direction: string; description: string }) {
  const activityStart = event.description.search(/activity date|settlement date|period \d{4}-\d{2}/i);
  const detail = activityStart >= 0 ? event.description.slice(activityStart).replace(/\s+/g, " ").trim() : event.description.replace(/\s+/g, " ").trim();
  return `${event.transactionDate ?? event.month}|${event.amount}|${event.direction}|${detail}`;
}
