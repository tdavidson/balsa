"use client";

import { useEffect, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";

type Conversation = { id: string; question: string; answer: string; model: string | null; cost: string | null; totalTokens: string | null; createdAt: string };
type Call = { id: string; provider: string; model: string; operation: string; inputTokens: string | null; outputTokens: string | null; totalTokens: string | null; cost: string | null; latencyMs: string | null; status: string; error: string | null; createdAt: string };
type Summary = { chatTurns: number; modelRuns: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: number; unpricedRuns: number; modelRows: { provider: string; model: string; runs: number; inputTokens: number; outputTokens: number; totalTokens: number; cost: number; latency: number }[]; dateRows: { period: string; runs: number; totalTokens: number; cost: number }[] };

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const number = (value: string | number | null | undefined) => Number(value ?? 0).toLocaleString();
const cost = (value: string | null | undefined) => value === null || value === undefined ? "Cost unavailable" : `$${Number(value).toFixed(4)}`;
const operation = (value: string) => value.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

export function UsageModal({ open, onOpenChange, companyName }: { open: boolean; onOpenChange: (open: boolean) => void; companyName: string }) {
  const [tab, setTab] = useState<"summary" | "conversations" | "calls">("summary");
  const [rollup, setRollup] = useState<"daily" | "weekly" | "monthly" | "annual">("monthly");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: (Conversation | Call)[]; total: number; pageSize: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/usage?tab=${tab}&rollup=${rollup}&page=${page}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (payload) { if (tab === "summary") setSummary(payload.summary); else setResult(payload); } })
      .catch(() => undefined);
    return () => controller.abort();
  }, [open, page, query, rollup, tab]);

  function changeTab(next: "summary" | "conversations" | "calls") { setTab(next); setPage(1); setResult(null); setSummary(null); }
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[84vh] flex-col gap-0 overflow-hidden rounded-xl border-rule bg-[#f7f7f8] p-0 dark:bg-[#1b1c20] sm:max-w-[960px]">
      <DialogHeader className="border-b border-rule px-6 py-6 pr-14 text-left"><DialogTitle className="display text-[26px] font-medium">Usage</DialogTitle><DialogDescription>Conversation history and model activity for {companyName}.</DialogDescription></DialogHeader>
      <div className="flex items-center gap-1 border-b border-rule px-6 pt-3"><button type="button" className={`border-b-2 px-1 pb-3 text-[13px] ${tab === "summary" ? "border-ink text-ink" : "border-transparent text-ink-2"}`} onClick={() => changeTab("summary")}>Summary</button><button type="button" className={`border-b-2 px-1 pb-3 text-[13px] ${tab === "conversations" ? "border-ink text-ink" : "border-transparent text-ink-2"}`} onClick={() => changeTab("conversations")}>Conversations</button><button type="button" className={`border-b-2 px-1 pb-3 text-[13px] ${tab === "calls" ? "border-ink text-ink" : "border-transparent text-ink-2"}`} onClick={() => changeTab("calls")}>Agent calls</button></div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "summary" ? <>{!summary ? <p className="py-12 text-center text-[13px] text-ink-2">Loading usage…</p> : <div className="grid gap-7"><div className="grid grid-cols-2 gap-5 border-y border-rule py-5 sm:grid-cols-4"><Metric label="Chat turns" value={number(summary.chatTurns)} /><Metric label="Model runs" value={number(summary.modelRuns)} /><Metric label="Total tokens" value={number(summary.totalTokens)} note={`${number(summary.inputTokens)} in · ${number(summary.outputTokens)} out`} /><Metric label="Reported cost" value={cost(String(summary.cost))} note={summary.unpricedRuns ? `${number(summary.unpricedRuns)} unpriced` : "All runs priced"} /></div><section className="grid gap-3"><div className="flex items-end justify-between gap-3"><h3 className="display text-[20px]">Activity over time</h3><select value={rollup} onChange={(event) => { setRollup(event.target.value as typeof rollup); setSummary(null); }} className="h-8 rounded-md border border-rule bg-transparent px-2 text-[12px] text-ink-2"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="annual">Annual</option></select></div><div className="grid gap-2 border-t border-rule pt-2">{summary.dateRows.map((row) => <div className="flex justify-between border-b border-rule py-2 text-[13px]" key={row.period}><span>{row.period}</span><span className="text-ink-2">{number(row.runs)} runs · {number(row.totalTokens)} tokens · {cost(String(row.cost))}</span></div>)}</div></section><section className="grid gap-3"><h3 className="display text-[20px]">By model</h3><div className="grid gap-2 border-t border-rule pt-2">{summary.modelRows.map((row) => <div className="grid grid-cols-[1fr_auto] border-b border-rule py-2 text-[13px]" key={`${row.provider}-${row.model}`}><span><span className="block text-ink">{row.model}</span><span className="text-ink-2">{row.provider} · {number(row.runs)} runs · {number(row.totalTokens)} tokens</span></span><span className="text-right">{cost(String(row.cost))}<span className="block text-[12px] text-ink-2">{number(row.latency / Math.max(1, row.runs))} ms avg</span></span></div>)}</div></section></div>}</> : <><label className="relative block"><span className="sr-only">Search usage</span><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-pencil" aria-hidden="true" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); setResult(null); }} placeholder={tab === "calls" ? "Search operations, models, or status" : "Search questions and responses"} className="h-9 rounded-lg border-rule bg-transparent pl-9 shadow-none" /></label><div className="mt-4">{!result ? <p className="py-12 text-center text-[13px] text-ink-2">Loading usage…</p> : result.items.length === 0 ? <Empty className="border-0 py-12"><EmptyHeader><EmptyMedia variant="icon"><BarChart3 aria-hidden="true" /></EmptyMedia><EmptyTitle>No matching usage</EmptyTitle><EmptyDescription>Try a different search or tab.</EmptyDescription></EmptyHeader></Empty> : tab === "conversations" ? <Accordion type="multiple" className="border-t border-rule">{(result.items as Conversation[]).map((item) => <AccordionItem value={item.id} key={item.id}><AccordionTrigger className="gap-4 py-3 text-left hover:no-underline"><span className="grid min-w-0 flex-1 gap-1"><span className="line-clamp-2 text-[14px] text-ink">{item.question}</span><span className="text-[12px] font-normal text-pencil">{dateFormatter.format(new Date(item.createdAt))} · {item.model ?? "Auto"} · {cost(item.cost)}</span></span></AccordionTrigger><AccordionContent className="grid gap-3 pb-4"><p className="rounded-xl bg-background px-4 py-3 text-[14px] text-ink">{item.question}</p><p className="prose-serif text-[15px] leading-6 text-ink-2">{item.answer || "No response was recorded."}</p><span className="text-[12px] text-pencil">{number(item.totalTokens)} tokens · {cost(item.cost)}</span></AccordionContent></AccordionItem>)}</Accordion> : <Accordion type="multiple" className="border-t border-rule">{(result.items as Call[]).map((item) => <AccordionItem value={item.id} key={item.id}><AccordionTrigger className="gap-4 py-3 text-left hover:no-underline"><span className="grid min-w-0 flex-1 gap-1"><span className="text-[14px] text-ink">{operation(item.operation)}</span><span className="text-[12px] font-normal text-pencil">{item.model} · {item.status} · {cost(item.cost)}</span></span></AccordionTrigger><AccordionContent className="grid gap-1 pb-4 text-[12px] text-ink-2"><span>{dateFormatter.format(new Date(item.createdAt))} · {number(item.totalTokens)} tokens · {number(item.latencyMs)} ms</span><span>{item.provider} · {number(item.inputTokens)} input · {number(item.outputTokens)} output</span>{item.error ? <span className="text-red-ink">{item.error}</span> : null}</AccordionContent></AccordionItem>)}</Accordion>}</div></>}
        </div>
        {tab !== "summary" && <div className="flex items-center justify-between border-t border-rule pt-3 text-[12px] text-ink-2"><span>{result ? `${result.total.toLocaleString()} result${result.total === 1 ? "" : "s"}` : ""}</span><span className="flex items-center gap-2"><Button variant="ghost" size="icon" className="size-7" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="size-4" /></Button><span>Page {page} of {totalPages}</span><Button variant="ghost" size="icon" className="size-7" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}><ChevronRight className="size-4" /></Button></span></div>}
      </div>
    </DialogContent>
  </Dialog>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) { return <div><span className="block text-[12px] text-ink-2">{label}</span><strong className="figure mt-1 block text-[22px] leading-[1.15]">{value}</strong>{note ? <span className="mt-1 block text-[11px] text-pencil">{note}</span> : null}</div>; }
