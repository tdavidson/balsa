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

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const number = (value: string | number | null | undefined) => Number(value ?? 0).toLocaleString();
const cost = (value: string | null | undefined) => value === null || value === undefined ? "Cost unavailable" : `$${Number(value).toFixed(4)}`;
const operation = (value: string) => value.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

export function UsageModal({ open, onOpenChange, companyName }: { open: boolean; onOpenChange: (open: boolean) => void; companyName: string }) {
  const [tab, setTab] = useState<"conversations" | "calls">("conversations");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: (Conversation | Call)[]; total: number; pageSize: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/usage?tab=${tab}&page=${page}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (payload) setResult(payload); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [open, page, query, tab]);

  function changeTab(next: "conversations" | "calls") { setTab(next); setPage(1); setResult(null); }
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[84vh] gap-0 overflow-hidden rounded-xl border-rule bg-[#f7f7f8] p-0 dark:bg-[#1b1c20] sm:max-w-[960px]">
      <DialogHeader className="border-b border-rule px-6 py-6 pr-14 text-left"><DialogTitle className="display text-[26px] font-medium">Usage</DialogTitle><DialogDescription>Conversation history and model activity for {companyName}.</DialogDescription></DialogHeader>
      <div className="flex items-center gap-1 border-b border-rule px-6 pt-3"><button type="button" className={`border-b-2 px-1 pb-3 text-[13px] ${tab === "conversations" ? "border-ink text-ink" : "border-transparent text-ink-2"}`} onClick={() => changeTab("conversations")}>Conversations</button><button type="button" className={`border-b-2 px-1 pb-3 text-[13px] ${tab === "calls" ? "border-ink text-ink" : "border-transparent text-ink-2"}`} onClick={() => changeTab("calls")}>Agent calls</button></div>
      <div className="grid min-h-0 gap-4 p-6">
        <label className="relative block"><span className="sr-only">Search usage</span><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-pencil" aria-hidden="true" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); setResult(null); }} placeholder={tab === "calls" ? "Search operations, models, or status" : "Search questions and responses"} className="h-9 rounded-lg border-rule bg-transparent pl-9 shadow-none" /></label>
        <div className="min-h-0 overflow-auto">
          {!result ? <p className="py-12 text-center text-[13px] text-ink-2">Loading usage…</p> : result.items.length === 0 ? <Empty className="border-0 py-12"><EmptyHeader><EmptyMedia variant="icon"><BarChart3 aria-hidden="true" /></EmptyMedia><EmptyTitle>No matching usage</EmptyTitle><EmptyDescription>Try a different search or tab.</EmptyDescription></EmptyHeader></Empty> : tab === "conversations" ? <Accordion type="multiple" className="border-t border-rule">{(result.items as Conversation[]).map((item) => <AccordionItem value={item.id} key={item.id}><AccordionTrigger className="gap-4 py-3 text-left hover:no-underline"><span className="grid min-w-0 flex-1 gap-1"><span className="line-clamp-2 text-[14px] text-ink">{item.question}</span><span className="text-[12px] font-normal text-pencil">{dateFormatter.format(new Date(item.createdAt))} · {item.model ?? "Auto"} · {cost(item.cost)}</span></span></AccordionTrigger><AccordionContent className="grid gap-3 pb-4"><p className="rounded-xl bg-background px-4 py-3 text-[14px] text-ink">{item.question}</p><p className="prose-serif text-[15px] leading-6 text-ink-2">{item.answer || "No response was recorded."}</p><span className="text-[12px] text-pencil">{number(item.totalTokens)} tokens · {cost(item.cost)}</span></AccordionContent></AccordionItem>)}</Accordion> : <Accordion type="multiple" className="border-t border-rule">{(result.items as Call[]).map((item) => <AccordionItem value={item.id} key={item.id}><AccordionTrigger className="gap-4 py-3 text-left hover:no-underline"><span className="grid min-w-0 flex-1 gap-1"><span className="text-[14px] text-ink">{operation(item.operation)}</span><span className="text-[12px] font-normal text-pencil">{item.model} · {item.status} · {cost(item.cost)}</span></span></AccordionTrigger><AccordionContent className="grid gap-1 pb-4 text-[12px] text-ink-2"><span>{dateFormatter.format(new Date(item.createdAt))} · {number(item.totalTokens)} tokens · {number(item.latencyMs)} ms</span><span>{item.provider} · {number(item.inputTokens)} input · {number(item.outputTokens)} output</span>{item.error ? <span className="text-red-ink">{item.error}</span> : null}</AccordionContent></AccordionItem>)}</Accordion>}
        </div>
        <div className="flex items-center justify-between border-t border-rule pt-3 text-[12px] text-ink-2"><span>{result ? `${result.total.toLocaleString()} result${result.total === 1 ? "" : "s"}` : ""}</span><span className="flex items-center gap-2"><Button variant="ghost" size="icon" className="size-7" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="size-4" /></Button><span>Page {page} of {totalPages}</span><Button variant="ghost" size="icon" className="size-7" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}><ChevronRight className="size-4" /></Button></span></div>
      </div>
    </DialogContent>
  </Dialog>;
}
