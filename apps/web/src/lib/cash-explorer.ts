import { cashFlowTotals, isCashFlowLine, type ForecastRun, type ForecastRunInput, type PostedJournalLine } from "@balsa/finance-engine";

export type CashCategory = { id: string; label: string; direction: "in" | "out"; amounts: Record<string, string> };
export type CashExplorerData = {
  months: (ForecastRun["months"][number] & { netMinor: string; reconciles: boolean })[];
  categories: CashCategory[];
  formulaVersion: string;
  limitations: string[];
};

/** Presentation of one engine snapshot. Never invent classifications or recalculate the forecast. */
export function buildCashExplorer(input: ForecastRunInput, output: ForecastRun, actualLines: PostedJournalLine[], limitations: string[] = []): CashExplorerData {
  const categories = new Map<string, CashCategory>();
  const months = output.months.map((month) => {
    const lines = (month.basis === "actual"
      ? actualLines.filter((line) => line.period === month.month && ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual"))
      : [...(input.openMonth?.month === month.month ? input.openMonth.actualLines.filter((line) => !line.postingDate || line.postingDate <= input.openMonth!.throughDate) : []), ...output.projectedLines.filter((line) => line.period === month.month)])
      .filter((line) => line.currency === output.currency);
    const entries = new Map<string, PostedJournalLine[]>();
    for (const line of lines) {
      const id = line.entryId ?? line.id;
      entries.set(id, [...(entries.get(id) ?? []), line]);
    }
    let receipts = 0n; let spending = 0n;
    for (const entry of entries.values()) {
      // Use the engine's entry-netted cash classification, including transfer elimination.
      const flow = cashFlowTotals(entry);
      const amount = flow.receipts || flow.spending;
      if (!amount) continue;
      receipts += flow.receipts; spending += flow.spending;
      const direction = flow.receipts > 0n ? "in" : "out";
      const source = entry.find((line) => line.provenance?.sourceLocation?.startsWith("forecast-driver:"))?.provenance?.sourceLocation;
      const driver = input.drivers.find((item) => source === `forecast-driver:${item.id}`);
      const occurrence = input.settlement?.occurrences.find((item) => entry[0]?.entryId === `expectation:${item.id}`);
      const accounts = [...new Map(entry.filter((line) => !isCashFlowLine(line)).map((line) => [line.accountId, line])).values()];
      // A compound journal has no unambiguous category allocation. Keep it explicit.
      const label = driver?.label ?? occurrence?.label ?? (accounts.length === 1 ? accounts[0]!.accountName : "Other / split cash activity");
      const key = `${direction}:${driver ? `driver:${driver.id}` : occurrence ? `expectation:${occurrence.driverId ?? occurrence.id}` : accounts.length === 1 ? `account:${accounts[0]!.accountId}` : "split"}`;
      const row = categories.get(key) ?? { id: key, label, direction, amounts: {} };
      row.amounts[month.month] = (BigInt(row.amounts[month.month] ?? "0") + amount).toString();
      categories.set(key, row);
    }
    const net = BigInt(month.receiptsMinor) - BigInt(month.spendingMinor);
    return { ...month, netMinor: net.toString(), reconciles: receipts.toString() === month.receiptsMinor && spending.toString() === month.spendingMinor && BigInt(month.openingCashMinor) + net === BigInt(month.endingCashMinor) };
  });
  return { months, categories: [...categories.values()].sort((a, b) => a.direction.localeCompare(b.direction) || a.label.localeCompare(b.label)), formulaVersion: output.formulaVersion, limitations: [...limitations, ...output.exceptions.map((item) => item.reason)] };
}
