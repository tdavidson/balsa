"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CurrencyStatement = {
  currency: string;
  balanceSheet: {
    totalAssetsMinor: string;
    totalLiabilitiesAndEquityMinor: string;
    differenceMinor: string;
    balanced: boolean;
  };
  incomeStatement: { netIncomeMinor: string };
  cashFlow?: { operatingMinor: string; investingMinor: string; financingMinor: string; netChangeMinor: string; ties: boolean };
};

type Preview = {
  status: "ready" | "nothing_to_eliminate" | "blocked";
  blockers: string[];
  entries: {
    key: string;
    mappingId: string;
    currency: string;
    debitMinor: string;
    creditMinor: string;
    lines: { accountId: string; debitMinor: string; creditMinor: string; upstreamLineIds: string[] }[];
  }[];
  exceptions: {
    mappingId: string;
    currency: string;
    receivableMinor: string;
    payableMinor: string;
    differenceMinor: string;
    reason: string;
    lineIds: string[];
  }[];
  report: {
    entityIds: string[];
    includedLineIds: string[];
    trialBalance: { balanced: boolean };
    statements: { byCurrency: CurrencyStatement[] };
  };
};

const money = (value: string, currency: string) => { const amount = BigInt(value); const negative = amount < 0n; const absolute = negative ? -amount : amount; return `${negative ? "−" : ""}${currency === "USD" ? "$" : `${currency} `}${(absolute / 100n).toLocaleString()}.${String(absolute % 100n).padStart(2, "0")}`; };

/** Read-only consolidation control; only fully matched pairs become elimination candidates. */
export function IntercompanyEliminationsPanel({ period }: { period: string }) {
  const [preview, setPreview] = useState<Preview | null>(null); const [loading, setLoading] = useState(false); const [posting, setPosting] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); try { const response = await fetch(`/api/intercompany-eliminations?period=${period}`); setPreview(response.ok ? await response.json() as Preview : null); } finally { setLoading(false); } }, [period]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const post = async (mappingId: string) => { setPosting(mappingId); setMessage(null); try { const response = await fetch("/api/intercompany-eliminations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period, mappingId }) }); const result = await response.json(); if (!response.ok) { setMessage((result.blockers as string[] | undefined)?.join(" ") ?? result.error ?? "Unable to post elimination."); return; } setMessage(result.idempotent ? "This elimination was already posted." : "CFO-approved elimination posted; the calculation graph is refreshing."); await load(); } finally { setPosting(null); } };
  if (loading && !preview) return <p className="text-sm text-muted-foreground">Reviewing reciprocal balances…</p>;
  if (!preview) return <p className="text-sm text-muted-foreground">Intercompany preview is unavailable for this period.</p>;

  return <div className="flex flex-col gap-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-medium">Consolidation</h3>
        <p className="mt-1 text-xs text-muted-foreground">The report includes effective full-consolidation entities and posted elimination entries. Currencies are not combined until an approved FX policy exists.</p>
      </div>
      <Button disabled={loading} onClick={() => void load()} size="sm" type="button" variant="outline">{loading ? "Refreshing…" : "Refresh"}</Button>
    </div>

    <section className="flex flex-col gap-3">
      <h4 className="text-xs uppercase tracking-[.12em] text-muted-foreground">Consolidated statement control</h4>
      <p className={cn("text-sm", preview.report.trialBalance.balanced ? "text-muted-foreground" : "text-destructive")}>
        {preview.report.trialBalance.balanced ? "Selected consolidated trial balance is in balance." : "Selected consolidated trial balance is out of balance."}
        {` ${preview.report.entityIds.length} in-scope ${preview.report.entityIds.length === 1 ? "entity" : "entities"} · ${preview.report.includedLineIds.length} included journal lines.`}
      </p>
      {preview.report.statements.byCurrency.length > 0 ? <div className="flex flex-col gap-2">
        {preview.report.statements.byCurrency.map((statement) => <div className="rounded-md border border-border p-3 text-sm" key={statement.currency}>
          <div className="flex items-center justify-between gap-4 font-medium"><span>{statement.currency}</span><span className={cn(statement.balanceSheet.balanced ? "text-muted-foreground" : "text-destructive")}>{statement.balanceSheet.balanced ? "Balances" : "Out of balance"}</span></div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
            <span>Assets <strong className="float-right font-medium text-foreground">{money(statement.balanceSheet.totalAssetsMinor, statement.currency)}</strong></span>
            <span>Liabilities &amp; equity <strong className="float-right font-medium text-foreground">{money(statement.balanceSheet.totalLiabilitiesAndEquityMinor, statement.currency)}</strong></span>
            <span>Net income <strong className="float-right font-medium text-foreground">{money(statement.incomeStatement.netIncomeMinor, statement.currency)}</strong></span>
            <span>Difference <strong className={cn("float-right font-medium", statement.balanceSheet.balanced ? "text-foreground" : "text-destructive")}>{money(statement.balanceSheet.differenceMinor, statement.currency)}</strong></span>
          </div>
          {statement.cashFlow && <div className="mt-3 border-t border-border pt-2 text-xs">
            <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Direct cash flow</span><span className={cn(statement.cashFlow.ties ? "text-muted-foreground" : "text-destructive")}>{statement.cashFlow.ties ? "Ties to cash" : "Does not tie to cash"}</span></div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2"><span>Operating <strong className="float-right font-medium text-foreground">{money(statement.cashFlow.operatingMinor, statement.currency)}</strong></span><span>Investing <strong className="float-right font-medium text-foreground">{money(statement.cashFlow.investingMinor, statement.currency)}</strong></span><span>Financing <strong className="float-right font-medium text-foreground">{money(statement.cashFlow.financingMinor, statement.currency)}</strong></span><span>Net change <strong className="float-right font-medium text-foreground">{money(statement.cashFlow.netChangeMinor, statement.currency)}</strong></span></div>
          </div>}
        </div>)}
      </div> : <p className="text-sm text-muted-foreground">No posted journal lines fall within the selected perimeter for this period.</p>}
    </section>

    <section className="flex flex-col gap-3">
      <h4 className="text-xs uppercase tracking-[.12em] text-muted-foreground">Intercompany eliminations</h4>
      <p className={cn("text-sm font-medium", preview.status === "blocked" ? "text-destructive" : "text-foreground")}>{preview.status.replace(/_/g, " ")}</p>
      {message && <p className={cn("text-xs", message.includes("Unable") || message.includes("cannot") ? "text-destructive" : "text-muted-foreground")}>{message}</p>}
      {preview.entries.length > 0 && <div className="flex flex-col gap-3">
        <h5 className="text-xs uppercase tracking-[.12em] text-muted-foreground">Ready candidates</h5>
        {preview.entries.map((entry) => <div className="rounded-md border border-border p-3 text-sm" key={entry.key}>
          <div className="flex justify-between gap-4"><span>{entry.mappingId} · {entry.currency}</span><span>{money(entry.debitMinor, entry.currency)}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{entry.lines.flatMap((line) => line.upstreamLineIds).length} immutable source journal lines. Posting creates a consolidated-only, reversible elimination entry.</p>
          <Button disabled={posting !== null} onClick={() => void post(entry.mappingId)} size="sm" type="button" variant="outline">{posting === entry.mappingId ? "Posting…" : "Approve and post"}</Button>
        </div>)}
      </div>}
      {preview.exceptions.length > 0 && <div className="flex flex-col gap-3">
        <h5 className="text-xs uppercase tracking-[.12em] text-muted-foreground">Exceptions</h5>
        {preview.exceptions.map((exception) => <div className="rounded-md border border-destructive/30 p-3 text-sm" key={`${exception.mappingId}:${exception.currency}`}>
          <div className="flex justify-between gap-4 text-destructive"><span>{exception.mappingId} · {exception.currency}</span><span>Difference {money(exception.differenceMinor, exception.currency)}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{exception.reason} {exception.lineIds.length} source journal lines are attached.</p>
        </div>)}
      </div>}
      {preview.status === "nothing_to_eliminate" && <p className="text-sm text-muted-foreground">No active reciprocal mapping has balances in this period.</p>}
    </section>
  </div>;
}
