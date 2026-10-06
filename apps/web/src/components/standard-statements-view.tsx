"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RowAccount = { accountId: string; amountMinor: string };
type Row = { key: string; label: string; kind: "line" | "category" | "uncategorized" | "subtotal" | "total"; depth: 0 | 1; amountMinor: string; accounts: RowAccount[] };
type Statement = { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[]; checks?: { key: string; label: string; ok: boolean; differenceMinor: string }[]; unplacedAccountIds?: string[] };
type Month = { period: string; basis: "actual" | "forecast" | "scenario"; statement: Statement };
type Year = { fiscalYear: number; periods: string[]; complete: boolean; statement: Statement };
type Payload = { view: string; currency: string; start: string; end: string; asOfPeriod: string; fiscalYearEndMonth: number; months: Month[]; years: Year[]; mapping: { confirmed: number; total: number; complete: boolean }; accounts: { id: string; code: string; name: string }[] };
type Column = { key: string; label: string; note: string; statement: Statement; periods: string[] };
export type StandardDrill = { period: string; accountIds: string[] };

const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const formatMonth = (period: string) => monthLabel.format(new Date(`${period}-01T00:00:00Z`));
function money(value: string, currency: string) {
  try { const minor = BigInt(value); const negative = minor < 0n; const amount = negative ? -minor : minor; const whole = (amount / 100n).toLocaleString(); return `${negative ? "(" : ""}${currency === "USD" ? "$" : ""}${whole}${negative ? ")" : ""}`; } catch { return "—"; }
}

/**
 * The Standard Financial Model layout: Revenues through Net income, the
 * balance sheet and cash flow, one column per month with actual and forecast
 * marked, and fiscal-year totals. Rows regroup the ledger statements and tie
 * to them; every amount drills down to the accounts behind it.
 */
export function StandardStatementsView({ period, view, onReviewMapping, onShowInLedger }: { period: string; view: "actual" | "projected"; onReviewMapping: () => void; onShowInLedger: (drill: StandardDrill) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState<"monthly" | "annual">("monthly");
  const [drill, setDrill] = useState<{ row: Row; column: Column } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setError(null);
      fetch(`/api/standard-statements?view=${view}`).then(async (response) => { const result = await response.json(); if (cancelled) return; if (response.ok) setData(result); else setError(result.error ?? "Unable to load the Standard view."); }).catch(() => { if (!cancelled) setError("Unable to load the Standard view."); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [view]);

  const columns = useMemo<Column[]>(() => {
    if (!data) return [];
    return scale === "monthly"
      ? data.months.map((month) => ({ key: month.period, label: formatMonth(month.period), note: data.view === "actual" && month.period > data.asOfPeriod ? "Not yet" : month.basis === "actual" ? "Actual" : month.basis === "scenario" ? "Scenario" : "Forecast", statement: month.statement, periods: [month.period] }))
      : data.years.map((year) => ({ key: String(year.fiscalYear), label: `FY${year.fiscalYear}`, note: year.complete ? `${year.periods.length} months` : `${year.periods.length} of 12 months`, statement: year.statement, periods: year.periods }));
  }, [data, scale]);
  const accountName = useMemo(() => new Map((data?.accounts ?? []).map((account) => [account.id, `${account.code} · ${account.name}`])), [data]);

  // Scroll the table, and only the table, so the selected period is in view; the timeline usually starts well before it.
  const tableScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = tableScroll.current; const header = container?.querySelector<HTMLElement>(`[data-period="${period}"]`);
    if (!container || !header || scale !== "monthly") return;
    container.scrollLeft = Math.max(0, header.offsetLeft - container.clientWidth / 2);
  }, [data, scale, period]);

  if (error) return <p className="text-[13px] text-destructive">{error}</p>;
  if (!data) return <p className="text-[13px] text-muted-foreground">Loading Standard view…</p>;
  const failing = data.months.flatMap((month) => (month.statement.checks ?? []).filter((check) => !check.ok).map((check) => `${formatMonth(month.period)}: ${check.label}`));
  // Net cash flow should equal the movement in the Cash line. When it doesn't, the ledger's cash flow (which finds cash accounts by "cash" in the account name or statement line) and the mapping disagree about which accounts are cash.
  const amountOf = (statement: Statement, key: string) => BigInt(statement.cashFlow.find((row) => row.key === key)?.amountMinor ?? "0");
  const cashGaps = data.months.slice(1).filter((month, index) => amountOf(month.statement, "cf_net") !== amountOf(month.statement, "cf_cash_end") - amountOf(data.months[index]!.statement, "cf_cash_end")).length;
  const section = (title: string, pick: (statement: Statement) => Row[]) => <>
    <tr><th className="sticky left-0 z-10 bg-background pt-5 pb-1 text-left text-[11px] font-normal uppercase tracking-[.12em] text-muted-foreground" colSpan={columns.length + 1} scope="colgroup">{title}</th></tr>
    {pick(columns[0]!.statement).map((row, index) => <tr className={cn(row.kind === "total" && "font-medium", (row.kind === "subtotal" || row.kind === "total") && "border-t border-border")} key={row.key}>
      <th className={cn("sticky left-0 z-10 min-w-56 bg-background py-1 pr-4 text-left font-normal", row.depth === 1 && "pl-4 text-muted-foreground", row.kind === "total" && "font-medium")} scope="row">{row.label}</th>
      {columns.map((column) => { const cell = pick(column.statement)[index]!; const drillable = cell.accounts.length > 0; return <td className="px-2 py-1 text-right tabular-nums" key={column.key}>{drillable ? <button className={cn("tabular-nums hover:underline", drill?.row.key === row.key && drill.column.key === column.key && "underline")} onClick={() => setDrill({ row: cell, column })} type="button">{money(cell.amountMinor, data.currency)}</button> : <span className={cn(cell.amountMinor === "0" && "text-muted-foreground")}>{cell.amountMinor === "0" ? "–" : money(cell.amountMinor, data.currency)}</span>}</td>; })}
    </tr>)}
  </>;

  return <div className="flex flex-col gap-4">
    {!data.mapping.complete && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px]">
      <span>{data.mapping.total - data.mapping.confirmed} of {data.mapping.total} accounts use a suggested line. Figures are complete; their placement is not yet confirmed.</span>
      <Button onClick={onReviewMapping} size="sm" type="button" variant="outline">Review mapping</Button>
    </div>}
    {cashGaps > 0 && <p className="text-[13px] text-destructive">In {cashGaps} month{cashGaps === 1 ? "" : "s"}, net cash flow does not equal the change in the Cash line. The ledger&apos;s cash flow treats an account as cash only when its name or statement line says &ldquo;cash&rdquo;; check that every account mapped to Cash does.</p>}
    {failing.length > 0 && <p className="text-[13px] text-destructive">Does not tie to the ledger: {failing.slice(0, 3).join("; ")}{failing.length > 3 ? ` and ${failing.length - 3} more` : ""}.</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
      <span>{formatMonth(data.start)} to {formatMonth(data.end)} · actuals through {formatMonth(data.asOfPeriod)} · fiscal year ends {new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, data.fiscalYearEndMonth - 1, 1)))}</span>
      <div className="flex items-center gap-3"><a className="text-foreground underline underline-offset-4 hover:text-muted-foreground" download href="/api/exports/standard-model" title="Every scenario, the pinned plan, mapping and checks, over the model timeline">Download model (.xlsx)</a>
      <div className="flex rounded-md border border-border" role="tablist" aria-label="Columns">{(["monthly", "annual"] as const).map((value) => <button aria-selected={scale === value} className={cn("px-3 py-1", scale === value ? "bg-muted text-foreground" : "hover:text-foreground")} key={value} onClick={() => { setScale(value); setDrill(null); }} role="tab" type="button">{value === "monthly" ? "Monthly" : "Annual"}</button>)}</div></div>
    </div>
    <div className="overflow-x-auto" ref={tableScroll}>
      <table className="text-[13px]">
        <thead><tr><th className="sticky left-0 z-10 bg-background" />{columns.map((column) => <th className={cn("min-w-24 px-2 pb-1 text-right font-medium", scale === "monthly" && column.key === period && "underline underline-offset-4")} data-period={column.key} key={column.key} scope="col">{column.label}<span className="block text-[11px] font-normal text-muted-foreground">{column.note}</span></th>)}</tr></thead>
        <tbody>
          {section("Income statement", (statement) => statement.incomeStatement)}
          {section("Balance sheet", (statement) => statement.balanceSheet)}
          {section("Cash flow", (statement) => statement.cashFlow)}
        </tbody>
      </table>
    </div>
    {drill && <section className="rounded-md border border-border p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{drill.row.label} · {drill.column.label}</strong><span className="flex gap-3">{scale === "monthly" && <button className="underline underline-offset-2" onClick={() => onShowInLedger({ period: drill.column.periods[0]!, accountIds: drill.row.accounts.map((account) => account.accountId) })} type="button">Show in Ledger view</button>}<button className="text-muted-foreground underline underline-offset-2" onClick={() => setDrill(null)} type="button">Close</button></span></div>
      <div className="mt-2 flex flex-col gap-1">{drill.row.accounts.map((account) => <div className="flex justify-between gap-4" key={account.accountId}><span>{accountName.get(account.accountId) ?? account.accountId}</span><span className="tabular-nums">{money(account.amountMinor, data.currency)}</span></div>)}</div>
    </section>}
  </div>;
}
