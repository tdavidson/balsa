"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { CashExplorerData } from "@/lib/cash-explorer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { exactMoney as money } from "./opening-cash-review";
import { cn } from "@/lib/utils";

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
// Convert only bounded chart coordinates to numbers; monetary values remain exact integers.
const ratio = (value: bigint, range: bigint) => Number(value * 10000n / (range || 1n)) / 10000;

export function CashExplorer({ data, currency, busy, onInspect }: { data: CashExplorerData; currency: string; busy: boolean; onInspect: (month: string) => void }) {
  const [selected, setSelected] = useState(data.months.find((month) => month.basis === "forecast")?.month ?? data.months[0]?.month ?? "");
  const [spreadsheet, setSpreadsheet] = useState(false);
  const tableId = useId();
  const current = data.months.find((month) => month.month === selected) ?? data.months[0];
  if (!current) return <Empty><EmptyHeader><EmptyTitle>No cash outlook yet</EmptyTitle><EmptyDescription>Import financial evidence and review your starting balance to build an outlook.</EmptyDescription></EmptyHeader></Empty>;
  const index = data.months.indexOf(current);
  const start = Math.floor(index / 6) * 6;
  const visible = data.months.slice(start, start + 6);
  const cash = visible.map((month) => BigInt(month.endingCashMinor));
  const low = cash.reduce((min, n) => n < min ? n : min, 0n);
  const high = cash.reduce((max, n) => n > max ? n : max, 0n);
  const y = (n: bigint) => 185 - ratio(n - low, high - low) * 135;
  const maximumFlow = visible.reduce((max, month) => [BigInt(month.receiptsMinor), BigInt(month.spendingMinor), max].reduce((a, b) => a > b ? a : b), 1n);
  const pointX = (i: number) => i * 160 + 80;
  const metrics = [
    ["Opening cash", current.openingCashMinor], ["Cash in", current.receiptsMinor], ["Cash out", current.spendingMinor], ["Net cash flow", current.netMinor], ["Ending cash", current.endingCashMinor],
  ];
  const tableRows = [
    { id: "opening", label: "Opening cash", values: data.months.map((month) => month.openingCashMinor), total: true },
    ...["in", "out"].flatMap((direction) => [
      ...data.categories.filter((row) => row.direction === direction).map((row) => ({ id: row.id, label: `${direction === "in" ? "In" : "Out"} · ${row.label}`, values: data.months.map((month) => row.amounts[month.month] ?? "0"), total: false })),
      { id: direction, label: direction === "in" ? "Total cash in" : "Total cash out", values: data.months.map((month) => direction === "in" ? month.receiptsMinor : month.spendingMinor), total: true },
    ]),
    { id: "net", label: "Net cash flow", values: data.months.map((month) => month.netMinor), total: true },
    { id: "ending", label: "Ending cash", values: data.months.map((month) => month.endingCashMinor), total: true },
  ];
  return <section id="cash-outlook" className="flex scroll-mt-6 flex-col gap-4" aria-label="Cash outlook">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="text-2xl font-semibold">Your cash, month by month</h2><p className="mt-1 text-sm text-muted-foreground">Explore the balances, activity and evidence behind your outlook.</p></div>
      <Select value={current.month} onValueChange={setSelected}><SelectTrigger aria-label="Cash outlook month" className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{data.months.map((month) => <SelectItem key={month.month} value={month.month}>{monthLabel(month.month)} · {month.basis}</SelectItem>)}</SelectGroup></SelectContent></Select>
    </div>
    <p className="text-sm text-muted-foreground">{monthLabel(current.month)} · {current.basis === "actual" ? "Posted actuals" : "Forecast, including any posted month-to-date activity"}. Proposed agreements enter the base forecast only after approval.</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-live="polite">{metrics.map(([label, value]) => <Card key={label}><CardHeader><CardTitle>{label}</CardTitle></CardHeader><CardContent><p className="text-xl font-semibold tabular-nums">{money(value, currency)}</p></CardContent></Card>)}</div>
    {data.limitations.length > 0 && <Alert><AlertTitle>Review coverage and assumptions</AlertTitle><AlertDescription>{data.limitations[0]} All {data.limitations.length} limitations are listed under “How this outlook is calculated” below.</AlertDescription></Alert>}
    {!current.reconciles && <Alert variant="destructive"><AlertTitle>Cash reconciliation needs review</AlertTitle><AlertDescription>The categories or cash roll-forward do not tie to this month’s reported totals. Inspect the supporting journals before relying on this balance.</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Solid = actual · Dashed / outlined = forecast · All values in {currency}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={start === 0} onClick={() => setSelected(data.months[Math.max(0, start - 6)]!.month)}>Previous 6 months</Button><Button size="sm" variant="outline" disabled={start + 6 >= data.months.length} onClick={() => setSelected(data.months[start + 6]!.month)}>Next 6 months</Button></div></div>
    <Card><CardHeader><CardTitle>Ending cash</CardTitle><CardDescription>{monthLabel(visible[0]!.month)} – {monthLabel(visible.at(-1)!.month)} · Negative balances appear below zero.</CardDescription></CardHeader><CardContent className="overflow-x-auto">
      <svg viewBox={`0 0 ${visible.length * 160} 245`} className="min-w-[720px] w-full" role="img" aria-label="Monthly ending cash, with exact value labels and actual or forecast status">
        <line x1="15" x2={visible.length * 160 - 15} y1={y(0n)} y2={y(0n)} stroke="var(--border)" /><text x="15" y={y(0n) - 5} fontSize="10" fill="var(--muted-foreground)">0</text>
        {visible.map((month, i) => <g key={month.month}>
          {i > 0 && <line x1={pointX(i - 1)} y1={y(cash[i - 1]!)} x2={pointX(i)} y2={y(cash[i]!)} stroke="var(--primary)" strokeWidth="2.5" strokeDasharray={month.basis === "forecast" ? "6 5" : undefined} />}
          <circle cx={pointX(i)} cy={y(cash[i]!)} r={month.month === current.month ? 6 : 4} fill={month.basis === "actual" ? "var(--primary)" : "var(--background)"} stroke="var(--primary)" strokeWidth="2" />
          <text x={pointX(i)} y={y(cash[i]!) - 15} textAnchor="middle" fontSize="12" fill="var(--foreground)">{money(month.endingCashMinor, currency)}</text>
          <text x={pointX(i)} y="216" textAnchor="middle" fontSize="12" fill="var(--foreground)">{monthLabel(month.month)}</text><text x={pointX(i)} y="234" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{month.basis}</text>
        </g>)}
      </svg>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Cash in and cash out</CardTitle><CardDescription>Left bar: cash in · Right bar: cash out. Transfers between cash accounts are netted within each journal entry.</CardDescription></CardHeader><CardContent className="overflow-x-auto">
      <svg viewBox={`0 0 ${visible.length * 160} 265`} className="min-w-[720px] w-full" role="img" aria-label="Monthly cash in and cash out, with exact value labels and actual or forecast status">
        <line x1="15" x2={visible.length * 160 - 15} y1="190" y2="190" stroke="var(--border)" />
        {visible.map((month, i) => <g key={month.month}>{[month.receiptsMinor, month.spendingMinor].map((value, j) => { const height = ratio(BigInt(value), maximumFlow) * 125; const x = pointX(i) + (j === 0 ? -36 : 6); return <g key={j}>
          <rect x={x} y={190 - height} width="30" height={height} fill={month.basis === "actual" ? (j === 0 ? "var(--primary)" : "var(--muted-foreground)") : "var(--muted)"} stroke={j === 0 ? "var(--primary)" : "var(--muted-foreground)"} strokeDasharray={month.basis === "forecast" ? "4 3" : undefined} />
          <text x={pointX(i)} y={j === 0 ? 20 : 38} textAnchor="middle" fontSize="11" fill="var(--foreground)">{j === 0 ? "In" : "Out"} {money(value, currency)}</text>
          <text x={x + 15} y="207" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{j === 0 ? "In" : "Out"}</text>
        </g>; })}<text x={pointX(i)} y="233" textAnchor="middle" fontSize="12" fill="var(--foreground)">{monthLabel(month.month)}</text><text x={pointX(i)} y="251" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{month.basis}</text></g>)}
      </svg>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>What makes up {monthLabel(current.month)}</CardTitle><CardDescription>Cash categories come from approved forecast inputs and posted account mappings.</CardDescription></CardHeader><CardContent className="grid gap-6 md:grid-cols-2">{["in", "out"].map((direction) => <div key={direction}><h3 className="mb-3 font-medium">Cash {direction}</h3><dl className="flex flex-col gap-2">{data.categories.filter((row) => row.direction === direction && BigInt(row.amounts[current.month] ?? "0") !== 0n).map((row) => <div key={row.id} className="flex justify-between gap-4 text-sm"><dt>{row.label}</dt><dd className="whitespace-nowrap tabular-nums">{money(row.amounts[current.month], currency)}</dd></div>)}</dl><p className="mt-3 border-t pt-3 font-medium">Total <span className="float-right tabular-nums">{money(direction === "in" ? current.receiptsMinor : current.spendingMinor, currency)}</span></p></div>)}</CardContent></Card>
    <div className="flex flex-wrap gap-3"><Button variant="outline" aria-expanded={spreadsheet} aria-controls={tableId} onClick={() => setSpreadsheet(!spreadsheet)}>{spreadsheet ? "Hide spreadsheet" : "Show spreadsheet"}</Button><Button disabled={busy} onClick={() => onInspect(current.month)}>Inspect {monthLabel(current.month)} calculation & sources</Button><Button variant="ghost" asChild><Link href="/goal-decisions">Review decisions</Link></Button><Button variant="ghost" asChild><Link href={`/?cashMonth=${current.month}`}>Ask about this month</Link></Button></div>
    {spreadsheet && <Card id={tableId}><CardHeader><CardTitle>Cash-flow spreadsheet</CardTitle><CardDescription>Read-only · {currency} · The same snapshot as the summary and charts. Change inputs through their review and approval flows.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Monthly cash categories and balances in {currency}</caption><thead><tr><th scope="col" className="sticky left-0 bg-card p-3 text-left">Category</th>{data.months.map((month) => <th scope="col" key={month.month} className={cn("min-w-40 p-3 text-right", month.month === current.month && "bg-muted")}><button type="button" className="underline underline-offset-4" onClick={() => setSelected(month.month)}>{monthLabel(month.month)}</button><span className="block text-xs font-normal text-muted-foreground">{month.basis}{!month.reconciles ? " · review needed" : ""}</span></th>)}</tr></thead><tbody>{tableRows.map((row) => <tr key={row.id} className={cn("border-t", row.total && "font-semibold")}><th scope="row" className="sticky left-0 min-w-56 bg-card p-3 text-left">{row.label}</th>{row.values.map((value, i) => <td key={data.months[i]!.month} className={cn("whitespace-nowrap p-3 text-right tabular-nums", data.months[i]!.month === current.month && "bg-muted")}>{money(value, currency)}</td>)}</tr>)}</tbody></table></CardContent></Card>}
    <details className="text-sm"><summary className="cursor-pointer">How this outlook is calculated & what needs review</summary><div className="mt-3 flex flex-col gap-2"><p>Cash in − cash out = net cash flow. Opening cash + net cash flow = ending cash. Each month’s ending cash carries into the next month’s opening cash.</p><p>{money(current.openingCashMinor, currency)} + {money(current.receiptsMinor, currency)} − {money(current.spendingMinor, currency)} = {money(current.endingCashMinor, currency)}{!current.reconciles ? " (does not reconcile; inspect journals)" : ""}</p><p>Calculation version: {data.formulaVersion}. Unapproved proposals are excluded. Forecast periods may include posted activity and remaining approved expectations.</p><ul className="list-disc pl-5">{data.limitations.map((reason, i) => <li key={i}>{reason}</li>)}</ul></div></details>
  </section>;
}
