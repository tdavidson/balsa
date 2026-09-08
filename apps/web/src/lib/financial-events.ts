const summaryPattern = /balance sheet|holding\b|allocation\b|change in value|net credits?\/?\(debits?\)|total value|total income|total automated|this period|this year|estimated annual|percentage of holdings|current yield|unrealized|beginning total|ending total|opening total/i;
const transactionPattern = /cash flow activity|automated payment|funds received|wired funds|bank product withdrawal|cash transfer|interest income|dividend|sold|bought|purchase|redemption|investment|transaction/i;

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
