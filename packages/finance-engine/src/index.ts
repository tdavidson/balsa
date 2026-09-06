export type CashEvent = { month: string; amount: number; kind: "receipt" | "spend"; actual?: boolean };

export type FinancialLine = { id: string; month: string; category: "management_fee" | "salary" | "contractor" | "professional_services" | "allocation" | "prepaid" | "other"; amount: number; direction: "receipt" | "spend"; sourceId?: string; accountingTreatment?: "cash" | "accrual" | "prepaid"; recognitionStart?: string; recognitionEnd?: string };
export type MonthlyProfitAndLoss = { month: string; revenue: number; expenses: number; operatingIncome: number; byCategory: Record<FinancialLine["category"], number>; trace: { lineId: string; sourceId?: string; category: FinancialLine["category"]; amount: number }[] };

export type MonthlyCash = { month: string; receipts: number; spending: number; net: number; endingCash: number; actualReceipts: number; actualSpending: number; actualNet: number; variance: number };

export function buildMonthlyCash(openingCash: number, events: CashEvent[]): MonthlyCash[] {
  const months = [...new Set(events.map((event) => event.month))].sort();
  let cash = openingCash;
  return months.map((month) => {
    const monthEvents = events.filter((event) => event.month === month);
    const receipts = monthEvents.filter((event) => event.kind === "receipt" && !event.actual).reduce((sum, event) => sum + event.amount, 0);
    const spending = monthEvents.filter((event) => event.kind === "spend" && !event.actual).reduce((sum, event) => sum + event.amount, 0);
    const actualReceipts = monthEvents.filter((event) => event.kind === "receipt" && event.actual).reduce((sum, event) => sum + event.amount, 0);
    const actualSpending = monthEvents.filter((event) => event.kind === "spend" && event.actual).reduce((sum, event) => sum + event.amount, 0);
    cash += receipts - spending + actualReceipts - actualSpending;
    const net = receipts - spending;
    const actualNet = actualReceipts - actualSpending;
    return { month, receipts, spending, net, endingCash: cash, actualReceipts, actualSpending, actualNet, variance: actualNet - net };
  });
}

const categories: FinancialLine["category"][] = ["management_fee", "salary", "contractor", "professional_services", "allocation", "prepaid", "other"];

export function buildMonthlyProfitAndLoss(lines: FinancialLine[]): MonthlyProfitAndLoss[] {
  const months = [...new Set(lines.flatMap((line) => [line.month, ...(line.accountingTreatment !== "cash" && line.recognitionStart && line.recognitionEnd ? monthRange(line.recognitionStart, line.recognitionEnd) : [])]))].sort();
  return months.map((month) => {
    const monthLines = lines.filter((line) => line.month === month || (line.accountingTreatment !== "cash" && line.recognitionStart && line.recognitionEnd && month >= line.recognitionStart && month <= line.recognitionEnd)).map((line) => ({ ...line, amount: line.accountingTreatment !== "cash" && line.recognitionStart && line.recognitionEnd ? line.amount / (monthRange(line.recognitionStart, line.recognitionEnd).length || 1) : line.amount }));
    const byCategory = Object.fromEntries(categories.map((category) => [category, 0])) as Record<FinancialLine["category"], number>;
    for (const line of monthLines) if (line.direction === "spend") byCategory[line.category] += line.amount;
    const revenue = monthLines.filter((line) => line.direction === "receipt").reduce((sum, line) => sum + line.amount, 0);
    const expenses = monthLines.filter((line) => line.direction === "spend").reduce((sum, line) => sum + line.amount, 0);
    return { month, revenue, expenses, operatingIncome: revenue - expenses, byCategory, trace: monthLines.map((line) => ({ lineId: line.id, ...(line.sourceId ? { sourceId: line.sourceId } : {}), category: line.category, amount: line.amount })) };
  });
}

function monthRange(start: string, end: string) {
  const result: string[] = [];
  const cursor = new Date(`${start}-01T00:00:00Z`);
  const finish = new Date(`${end}-01T00:00:00Z`);
  while (cursor <= finish) { result.push(cursor.toISOString().slice(0, 7)); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
  return result;
}
