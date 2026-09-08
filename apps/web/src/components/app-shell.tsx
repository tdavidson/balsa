"use client";

import { ArrowUp, BookOpenText, ChartColumn, Check, ChevronDown, CircleHelp, FileText, History, LoaderCircle, MessageSquareText, Paperclip, Pencil, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConversationTurn } from "@/app/api/conversations/route";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function monthLabel(month: string, formatter = monthFormatter) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return formatter.format(new Date(`${month}-01T00:00:00Z`));
}

function money(amount: number, currency = "$") {
  const formatted = Math.abs(amount).toLocaleString();
  return amount < 0 ? `−${currency}${formatted}` : `${currency}${formatted}`;
}

type Effort = "auto" | "low" | "medium" | "high";
const efforts: { value: Effort; label: string }[] = [
  { value: "auto", label: "Auto effort" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** A choice remembered per browser. Server renders the fallback; the client reads storage on hydration. */
const storageListeners = new Set<() => void>();
function subscribeStorage(listener: () => void) {
  storageListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { storageListeners.delete(listener); window.removeEventListener("storage", listener); };
}
function readStored(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  storageListeners.forEach((listener) => listener());
}
function useStoredChoice(key: string, fallback: string, allowed: (value: string) => boolean) {
  const stored = useSyncExternalStore(subscribeStorage, () => readStored(key), () => null);
  const value = stored && allowed(stored) ? stored : fallback;
  return [value, (next: string) => writeStored(key, next)] as const;
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

const quietSelect = "h-7 gap-1 rounded-md border-0 bg-transparent px-1.5 text-[13px] text-ink-2 shadow-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:bg-transparent dark:hover:bg-transparent [&_svg]:hidden";
const quietButton = "inline-flex items-center gap-1.5 rounded-md text-[13px] text-ink-2 transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50";

/** Parse a JSON body, or turn an empty or HTML error body into a readable message. */
async function readJson(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: response.ok ? "Unexpected response from the server" : `Request failed (${response.status})` };
  }
}

/** A raw excerpt that only restates the extracted summary adds nothing; show excerpts only when they differ. */
function repeatsSummary(excerpt: string, summary: string | undefined) {
  if (!summary) return false;
  const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = normalise(excerpt);
  const b = normalise(summary);
  return a.length === 0 || a === b || a.includes(b) || b.includes(a);
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^\)]+\)|\*[^*]+\*|_[^_]+_)/g).filter(Boolean);
  return tokens.map((token, index) => {
    if (/^\*\*.*\*\*$|^__.*__$/.test(token)) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (/^`.*`$/.test(token)) return <code key={index} className="rounded bg-rule px-1 py-0.5 font-mono text-[0.85em]">{token.slice(1, -1)}</code>;
    const link = token.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="underline underline-offset-2">{link[1]}</a>;
    if (/^\*.*\*$|^_.*_$/.test(token)) return <em key={index}>{token.slice(1, -1)}</em>;
    return <span key={index}>{token}</span>;
  });
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let list: { text: string; ordered: boolean }[] = [];
  const flushList = () => {
    if (!list.length) return;
    const ordered = list[0]!.ordered;
    const List = ordered ? "ol" : "ul";
    nodes.push(<List key={`list-${nodes.length}`} className={cn(ordered ? "list-decimal" : "list-disc", "my-2 grid gap-1 pl-5")}>{list.map((item, index) => <li key={index}>{renderInlineMarkdown(item.text)}</li>)}</List>);
    list = [];
  };
  let code = false;
  let codeLines: string[] = [];
  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      if (code) { nodes.push(<pre key={`code-${index}`} className="my-3 overflow-x-auto rounded-lg bg-rule p-3 font-mono text-[13px]"><code>{codeLines.join("\n")}</code></pre>); codeLines = []; }
      code = !code;
      return;
    }
    if (code) { codeLines.push(line); return; }
    const item = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.+)$/);
    if (item) { list.push({ text: item[2]!, ordered: Boolean(item[1]) }); return; }
    flushList();
    if (!line.trim()) return;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { nodes.push(<h3 key={index} className="display mt-4 text-[1.05em] font-medium first:mt-0">{renderInlineMarkdown(heading[2]!)}</h3>); return; }
    nodes.push(<p key={index} className="my-2 first:mt-0 last:mb-0">{renderInlineMarkdown(line)}</p>);
  });
  if (code) nodes.push(<pre key="code-final" className="my-3 overflow-x-auto rounded-lg bg-rule p-3 font-mono text-[13px]"><code>{codeLines.join("\n")}</code></pre>);
  flushList();
  return <div className="markdown-message">{nodes}</div>;
}

function composerCallToAction(now: Date, context: { needsInputCount: number; hasConversation: boolean; hasFiles: boolean }) {
  const hour = now.getHours();
  const day = now.getDay();
  const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  if (context.hasFiles) return "Add a note about these files, then send them for review";
  if (context.needsInputCount > 0) return "Answer a waiting question, or ask me to inspect the evidence";
  if (context.hasConversation) return "Ask a follow-up, add context, or tell me what to decide";
  if (day === 1) return `Good ${timeOfDay} — start the week with what needs attention`;
  if (day === 5) return `Good ${timeOfDay} — close the week with a question or update`;
  if (day === 0 || day === 6) return `Good ${timeOfDay} — catch me up on what changed`;
  return `Good ${timeOfDay} — tell me what to work on`;
}

const actionButton = "grid size-7 place-items-center rounded-md border border-rule text-ink-2 transition-colors hover:bg-rule hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg]:size-3.5";

function Figure({ label, value, note, pencil, negative }: { label: string; value: string; note: string; pencil?: boolean; negative?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block text-[13px] text-ink-2">{label}</span>
      <strong className={cn("figure mt-1.5 block text-[26px] leading-[1.15]", pencil && "font-normal text-ink-2", negative && "text-red-ink")}>{value}</strong>
      <em className="mt-1 block truncate text-[12px] text-pencil not-italic">{note}</em>
    </div>
  );
}

type AppShellProps = {
  company: { name: string; currency: string };
  user: { email: string; name: string | null };
  modelOptions: { value: string; label: string }[];
};

type EvidenceItem = {
  id: string;
  sourceName: string;
  sourceMime?: string | null;
  sourceSize?: string | null;
  sourceHash?: string | null;
  sourceExcerpt?: string;
  createdAt?: string;
  status: string;
  extraction: { summary: string; facts: { label: string; value: string; confidence: number }[]; questions: string[] } | null;
};
type ChatEvidence = {
  id?: string;
  sourceName: string;
  summary?: string | undefined;
  facts: { label: string; value: string; confidence: number }[];
  questions: string[];
};
type ReviewQuestion = { id: string; evidenceId?: string | null; question: string; answer?: string | null; status: string };
type AgentDecision = { id: string; question: string; answer: string; status: "proposed" | "applied" | "rejected" };
type ForecastMonth = { month: string; receipts: number; spending: number; endingCash: number; openingCash?: number; actualReceipts: number; actualSpending: number; actualNet?: number; variance?: number; status?: "open" | "closed"; trace?: { description: string; evidenceId: string | null; sourceName?: string | null; amount?: number; kind?: "receipt" | "spend"; actual?: boolean }[] };
type PnlMonth = { month: string; revenue: number; expenses: number; operatingIncome: number; byCategory: Record<string, number>; revenueByCategory: Record<string, number>; trace?: { description?: string; amount: number; direction: "receipt" | "spend"; category: string }[] };
type PeriodPreset = "month" | "quarter" | "ytd" | "year" | "custom";

export function AppShell({ company, user, modelOptions }: AppShellProps) {
  const [message, setMessage] = useState("");
  const [composerPlaceholder, setComposerPlaceholder] = useState("Tell me what needs attention");
  const [model, chooseModel] = useStoredChoice("nevermodel.model", "auto", (value) => modelOptions.some((option) => option.value === value));
  const [storedEffort, chooseEffort] = useStoredChoice("nevermodel.effort", "auto", (value) => efforts.some((option) => option.value === value));
  const effort = storedEffort as Effort;
  const [activeThreadId, setActiveThreadId] = useState("main");
  const [threads, setThreads] = useState<Record<string, ConversationTurn[]>>({ main: [] });
  const [history, setHistory] = useState<ConversationTurn[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [activeReviewQuestionId, setActiveReviewQuestionId] = useState<string | null>(null);
  const [activeReviewQuestion, setActiveReviewQuestion] = useState<ReviewQuestion | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [reviewQuestions, setReviewQuestions] = useState<ReviewQuestion[]>([]);
  const [agentDecisions, setAgentDecisions] = useState<AgentDecision[]>([]);
  const [forecast, setForecast] = useState<ForecastMonth[]>([]);
  const [pnl, setPnl] = useState<PnlMonth[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("month");
  const [statementTab, setStatementTab] = useState<"income" | "cash" | "balance">("income");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [editingItem, setEditingItem] = useState<EvidenceItem | null>(null);
  const [editSummary, setEditSummary] = useState("");
  const [editFacts, setEditFacts] = useState<{ label: string; value: string; confidence: number }[]>([]);
  const [closeSummary, setCloseSummary] = useState<{ month: string; actualNet: number; variance: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const requestAbortController = useRef<AbortController | null>(null);
  const turns = threads[activeThreadId] ?? [];
  const setTurns = (next: ConversationTurn[] | ((current: ConversationTurn[]) => ConversationTurn[])) => setThreads((current) => ({ ...current, [activeThreadId]: typeof next === "function" ? next(current[activeThreadId] ?? []) : next }));

  // Grow the composer with its content, up to a cap, and shrink back when cleared.
  useEffect(() => {
    const element = composerInput.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [message]);
  useEffect(() => {
    if (turns.length > 0) composerInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [turns.length]);
  const anchorDate = selectedMonth ? new Date(`${selectedMonth}-01T00:00:00Z`) : null;
  const anchorYear = anchorDate?.getUTCFullYear();
  const anchorMonth = anchorDate ? anchorDate.getUTCMonth() + 1 : 1;
  const periodStart = periodPreset === "custom" ? (customStart || selectedMonth) : periodPreset === "ytd" ? `${anchorYear}-01` : periodPreset === "year" ? `${anchorYear}-01` : periodPreset === "quarter" ? `${anchorYear}-${String(Math.floor((anchorMonth - 1) / 3) * 3 + 1).padStart(2, "0")}` : selectedMonth;
  const periodEnd = periodPreset === "custom" ? (customEnd || selectedMonth) : periodPreset === "ytd" || periodPreset === "quarter" ? selectedMonth : periodPreset === "year" ? `${anchorYear}-12` : selectedMonth;
  const periodForecastRows = forecast.filter((month) => month.month >= periodStart && month.month <= periodEnd);
  const periodPnlRows = pnl.filter((month) => month.month >= periodStart && month.month <= periodEnd);
  const lastForecast = periodForecastRows.at(-1);
  const currentForecast = lastForecast ? { ...lastForecast, openingCash: periodForecastRows[0]?.openingCash, receipts: periodForecastRows.reduce((sum, row) => sum + row.receipts, 0), spending: periodForecastRows.reduce((sum, row) => sum + row.spending, 0), actualReceipts: periodForecastRows.reduce((sum, row) => sum + row.actualReceipts, 0), actualSpending: periodForecastRows.reduce((sum, row) => sum + row.actualSpending, 0), trace: periodForecastRows.flatMap((row) => row.trace ?? []) } : undefined;
  const currentPnl = periodPnlRows.length ? { month: periodPnlRows[0]!.month, revenue: periodPnlRows.reduce((sum, row) => sum + row.revenue, 0), expenses: periodPnlRows.reduce((sum, row) => sum + row.expenses, 0), operatingIncome: periodPnlRows.reduce((sum, row) => sum + row.operatingIncome, 0), byCategory: periodPnlRows.reduce<Record<string, number>>((totals, row) => { for (const [category, amount] of Object.entries(row.byCategory)) totals[category] = (totals[category] ?? 0) + amount; return totals; }, {}), revenueByCategory: periodPnlRows.reduce<Record<string, number>>((totals, row) => { for (const [category, amount] of Object.entries(row.revenueByCategory)) totals[category] = (totals[category] ?? 0) + amount; return totals; }, {}), trace: periodPnlRows.flatMap((row) => row.trace ?? []) } : undefined;
  const periodLabel = periodPreset === "quarter" ? `Q${Math.floor((anchorMonth - 1) / 3) + 1} ${anchorYear}` : periodPreset === "ytd" ? `YTD ${monthLabel(selectedMonth)}` : periodPreset === "year" ? `${anchorYear}` : periodPreset === "custom" ? `${monthLabel(periodStart)} – ${monthLabel(periodEnd)}` : monthLabel(selectedMonth);
  const pendingEvidence = evidence.filter((item) => item.status === "pending");
  const needsInputCount = pendingEvidence.length + reviewQuestions.length + agentDecisions.filter((decision) => decision.status === "proposed").length;
  useEffect(() => {
    const updatePlaceholder = () => setComposerPlaceholder(composerCallToAction(new Date(), { needsInputCount, hasConversation: turns.length > 0, hasFiles: files.length > 0 }));
    updatePlaceholder();
    const timer = window.setInterval(updatePlaceholder, 60_000);
    return () => window.clearInterval(timer);
  }, [files.length, needsInputCount, turns.length]);
  useEffect(() => {
    fetch("/api/evidence")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => { if (payload) { setEvidence(payload.evidence); setReviewQuestions(uniqueById(payload.reviewItems ?? [])); } })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/decisions").then((response) => response.ok ? response.json() : null).then((payload) => { if (payload?.decisions) setAgentDecisions(payload.decisions); }).catch(() => undefined);
  }, []);

  async function updateAgentDecision(id: string, status: AgentDecision["status"]) {
    const response = await fetch("/api/decisions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (response.ok) setAgentDecisions((current) => current.map((decision) => decision.id === id ? { ...decision, status } : decision));
  }

  useEffect(() => {
    async function loadForecast() {
      const monthsResponse = await fetch("/api/months");
      const monthsPayload = monthsResponse.ok ? await readJson(monthsResponse) : null;
      if (monthsPayload?.months?.length === 0) {
        const month = new Date().toISOString().slice(0, 7);
        await fetch("/api/months", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) });
      }
      const response = await fetch("/api/forecast");
      const payload = response.ok ? await readJson(response) : null;
      if (payload?.months) { setForecast(payload.months); setSelectedMonth(payload.months[0]?.month ?? ""); }
      const pnlResponse = await fetch("/api/pnl");
      const pnlPayload = pnlResponse.ok ? await readJson(pnlResponse) : null;
      if (pnlPayload?.months) setPnl(pnlPayload.months);
    }
    loadForecast().catch(() => undefined);
  }, []);


  function collectFiles(fileList: FileList | null) {
    if (!fileList) return;
    const selected = Array.from(fileList);
    setSelectedFiles(selected);
    setFiles(selected.map((file) => file.name));
    setNotice(null);
  }

  function modelChoice() {
    return { model, ...(effort === "auto" ? {} : { effort }) };
  }

  async function askAgent(question: string, newEvidence: ChatEvidence[] = [], signal?: AbortSignal) {
    const requestThreadId = activeThreadId;
    const conversationHistory = turns.slice(-10).flatMap((turn) => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.answer },
    ]).filter((entry) => entry.content.trim());
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(signal ? { signal } : {}),
      body: JSON.stringify({ message: question, history: conversationHistory, evidence: newEvidence, reviewQuestionId: activeReviewQuestionId ?? undefined, month: selectedMonth || undefined, ...modelChoice() }),
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(payload.error ?? "Unable to ask the finance agent");
    const answer = [payload.answer, payload.forecastExplanation].filter(Boolean).join(" ").trim();
    setThreads((current) => ({ ...current, [requestThreadId]: [...(current[requestThreadId] ?? []), { id: crypto.randomUUID(), question, answer, model: model === "auto" ? null : model, createdAt: new Date().toISOString() }] }));
    if (activeReviewQuestionId && payload.resolvedQuestions?.some((resolution: { id: string }) => resolution.id === activeReviewQuestionId)) {
      setActiveReviewQuestionId(null);
      setActiveReviewQuestion(null);
    }
    setPendingQuestion(null);
    setHistory(null);
    const [refreshedEvidence, refreshedDecisions] = await Promise.all([fetch("/api/evidence"), fetch("/api/decisions")]);
    if (refreshedEvidence.ok) {
      const evidencePayload = await readJson(refreshedEvidence);
      setEvidence(evidencePayload.evidence);
      setReviewQuestions(uniqueById(evidencePayload.reviewItems ?? []));
    }
    if (refreshedDecisions.ok) {
      const decisionsPayload = await readJson(refreshedDecisions);
      if (decisionsPayload.decisions) setAgentDecisions(decisionsPayload.decisions);
    }
    return payload;
  }

  function newChat() {
    const nextThreadId = `thread-${crypto.randomUUID()}`;
    setThreads((current) => ({ ...current, [nextThreadId]: [] }));
    setActiveThreadId(nextThreadId);
    setMessage("");
    setFiles([]);
    setSelectedFiles([]);
    setNotice(null);
    setSubmissionStatus(null);
    setPendingQuestion(null);
    setActiveReviewQuestionId(null);
    setActiveReviewQuestion(null);
  }

  function clearCurrentThread() {
    if (submittingThreadId === activeThreadId) requestAbortController.current?.abort();
    setThreads((current) => ({ ...current, [activeThreadId]: [] }));
    setMessage("");
    setNotice(null);
    setActiveReviewQuestion(null);
    setActiveReviewQuestionId(null);
  }

  function answerInChat(item: ReviewQuestion) {
    // An untouched chat is already a suitable place to answer the question.
    // Keep a separate tab when the current chat contains a conversation or is
    // still processing a request, so that we do not disturb that work.
    const currentThread = threads[activeThreadId] ?? [];
    const useCurrentThread = currentThread.length === 0 && submittingThreadId !== activeThreadId;
    const nextThreadId = useCurrentThread ? activeThreadId : `thread-${crypto.randomUUID()}`;
    if (!useCurrentThread) setThreads((current) => ({ ...current, [nextThreadId]: [] }));
    setActiveThreadId(nextThreadId);
    setMessage("");
    setFiles([]);
    setSelectedFiles([]);
    setNotice(null);
    setSubmissionStatus(null);
    setPendingQuestion(null);
    setActiveReviewQuestionId(item.id);
    setActiveReviewQuestion(item);
    requestAnimationFrame(() => composerInput.current?.focus());
  }

  function discussDecision(decision: AgentDecision) {
    const currentThread = threads[activeThreadId] ?? [];
    const useCurrentThread = currentThread.length === 0 && submittingThreadId !== activeThreadId;
    const nextThreadId = useCurrentThread ? activeThreadId : `thread-${crypto.randomUUID()}`;
    if (!useCurrentThread) setThreads((current) => ({ ...current, [nextThreadId]: [] }));
    setActiveThreadId(nextThreadId);
    setFiles([]);
    setSelectedFiles([]);
    setNotice(null);
    setSubmissionStatus(null);
    setPendingQuestion(null);
    setActiveReviewQuestionId(null);
    setActiveReviewQuestion(null);
    setMessage(`Please help me review this proposed decision.\nQuestion: ${decision.question}\nProposed answer: ${decision.answer}`);
    requestAnimationFrame(() => composerInput.current?.focus());
  }

  function stopSubmission() {
    requestAbortController.current?.abort();
    setSubmissionStatus("Stopping…");
  }

  async function openHistory() {
    setHistoryOpen(true);
    if (history) return;
    const response = await fetch("/api/conversations");
    if (response.ok) { const data = await readJson(response); setHistory(data.turns ?? []); } else setHistory([]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const submittedMessage = message.trim();
    if (!submittedMessage && files.length === 0) return;
    const contextualQuestion = activeReviewQuestion ? `Regarding “${activeReviewQuestion.question}”: ${submittedMessage}` : submittedMessage;
    const requestThreadId = activeThreadId;
    setActiveReviewQuestion(null);
    const abortController = new AbortController();
    requestAbortController.current = abortController;
    setIsSubmitting(true);
    setSubmittingThreadId(requestThreadId);
    setPendingQuestion(contextualQuestion || `Uploaded ${files.join(", ")}`);
    setSubmissionStatus(selectedFiles.length ? `Reading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}…` : "Thinking about your message…");
    setNotice(null);
    setMessage("");
    const request = (input: RequestInfo | URL, init: RequestInit = {}) => fetch(input, { ...init, signal: abortController.signal });
    try {
      const closeCommand = submittedMessage.match(/^close\s+(?:month\s+)?(\d{4}-\d{2})$/i);
      if (closeCommand) {
        const response = await request("/api/months", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: closeCommand[1], status: "closed" }) });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error ?? "Unable to close month");
        const summary = payload.summary as { actualNet?: number; variance?: number } | undefined;
        if (summary?.actualNet !== undefined && summary.variance !== undefined) setCloseSummary({ month: closeCommand[1]!, actualNet: summary.actualNet, variance: summary.variance });
        setNotice(`${closeCommand[1]} close completed${summary ? ` · actual net ${company.currency} ${summary.actualNet?.toLocaleString()} · variance ${summary.variance?.toLocaleString()}` : ""}.`);
        const refreshed = await request("/api/forecast");
        if (refreshed.ok) { const data = await readJson(refreshed); setForecast(data.months); }
        return;
      }
      const reopenCommand = submittedMessage.match(/^(?:open|reopen)\s+(?:month\s+)?(\d{4}-\d{2})$/i);
      if (reopenCommand) {
        const response = await request("/api/months", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: reopenCommand[1], status: "open" }) });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error ?? "Unable to reopen month");
        setNotice(`${reopenCommand[1]} reopened.`);
        const refreshed = await request("/api/forecast");
        if (refreshed.ok) { const data = await readJson(refreshed); setForecast(data.months); }
        return;
      }
      const decisionCommand = submittedMessage.match(/^decision\s*:\s*(.+?)\s*=>\s*(.+)$/i);
      const policyCommand = submittedMessage.match(/^policy\s*:\s*(.+?)\s*=>\s*(.+)$/i);
      if (decisionCommand || policyCommand) {
        const response = await request("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decisionCommand ? { question: decisionCommand[1], answer: decisionCommand[2] } : { question: "Standing CFO policy", answer: policyCommand![2], policyName: policyCommand![1], policyRule: policyCommand![2] }) });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error ?? "Unable to save decision");
        setNotice(policyCommand ? `Policy “${policyCommand[1]}” saved.` : "Decision saved.");
        const refreshedEvidence = await request("/api/evidence");
        if (refreshedEvidence.ok) {
          const evidencePayload = await readJson(refreshedEvidence);
          setEvidence(evidencePayload.evidence);
          setReviewQuestions(evidencePayload.reviewItems ?? []);
        }
        return;
      }
      const openingCommand = submittedMessage.match(/^(?:set\s+)?opening\s+(?:cash|balance)\s+(?:for\s+)?(\d{4}-\d{2})\s*(?:to|=)?\s*\$?([\d,]+(?:\.\d+)?)$/i);
      if (openingCommand) {
        const response = await request("/api/months", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: openingCommand[1], openingCash: openingCommand[2]!.replace(/,/g, "") }) });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error ?? "Unable to set opening balance");
        setNotice(`Opening cash set for ${openingCommand[1]}.`);
        const refreshed = await request("/api/forecast");
        if (refreshed.ok) { const data = await readJson(refreshed); setForecast(data.months); }
        return;
      }
      if (!selectedFiles.length) {
        await askAgent(contextualQuestion, [], abortController.signal);
        return;
      }
      const payloads: { id: string; sourceName: string; status: "pending" | "approved"; extraction: EvidenceItem["extraction"] }[] = [];
      let importedActuals = 0;
      let duplicateActuals = 0;
      const failedFiles: string[] = [];
      if (selectedFiles.length) {
        for (const [index, file] of selectedFiles.entries()) {
          setSubmissionStatus(`Reading ${file.name} (${index + 1} of ${selectedFiles.length})…`);
          try {
          const filePreview = /\.(csv|xlsx|xls)$/i.test(file.name) ? await file.slice(0, 4000).text() : "";
          const looksLikeTransactions = /\.(qbo|ofx)$/i.test(file.name) || (/\.(csv|xlsx|xls)$/i.test(file.name) && /bank|transaction|actual|statement/i.test(file.name) && /date/i.test(filePreview) && /amount|debit|credit|value|total/i.test(filePreview));
          if (looksLikeTransactions) {
            const actualsForm = new FormData(); actualsForm.append("file", file);
            const actualsResponse = await request("/api/actuals", { method: "POST", body: actualsForm });
            const actualsPayload = await readJson(actualsResponse);
            if (actualsResponse.ok) {
              importedActuals += Number(actualsPayload.imported ?? 0);
              if (actualsPayload.duplicate) duplicateActuals += 1;
              if (actualsPayload.id && actualsPayload.extraction) payloads.push({ id: actualsPayload.id, sourceName: file.name, status: "approved", extraction: actualsPayload.extraction });
              continue;
            }
            if (actualsResponse.status !== 400 || !/no transactions|needs an amount/i.test(String(actualsPayload.error ?? ""))) throw new Error(actualsPayload.error ?? `Unable to import ${file.name}`);
          }
          const form = new FormData(); form.append("file", file); form.append("model", model); if (submittedMessage) form.append("instructions", submittedMessage); if (effort !== "auto") form.append("effort", effort);
          const response = await request("/api/evidence", { method: "POST", body: form });
          const payload = await readJson(response);
          if (!response.ok) throw new Error(payload.error ?? `Unable to process ${file.name}`);
          payloads.push({ ...payload, sourceName: file.name, status: "pending" });
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            failedFiles.push(`${file.name}: ${error instanceof Error ? error.message : "processing failed"}`);
          }
        }
      }
      setEvidence((current) => [...payloads.map((payload) => ({ id: payload.id, sourceName: payload.sourceName, status: payload.status, extraction: payload.extraction })), ...current]);
      const question = contextualQuestion || `I uploaded ${files.join(", ")}. Review what I shared, tell me what you found, and ask me about anything that needs clarification.`;
      const chatEvidence = payloads.map((payload) => ({
        id: payload.id,
        sourceName: payload.sourceName,
        summary: payload.extraction?.summary,
        facts: payload.extraction?.facts ?? [],
        questions: payload.extraction?.questions ?? [],
      }));
      setSubmissionStatus("Considering the files and preparing a response…");
      await askAgent(question, chatEvidence, abortController.signal);
      setNotice(`${payloads.length} file${payloads.length === 1 ? "" : "s"} processed${importedActuals ? `; ${importedActuals} actual transactions imported` : duplicateActuals ? `; ${duplicateActuals} actual file${duplicateActuals === 1 ? "" : "s"} already imported` : ""}${failedFiles.length ? `; ${failedFiles.length} failed: ${failedFiles.join(" · ")}` : "."}`);
      setFiles([]);
      setSelectedFiles([]);
      const refreshedEvidence = await request("/api/evidence");
      if (refreshedEvidence.ok) {
        const evidencePayload = await readJson(refreshedEvidence);
        setEvidence(evidencePayload.evidence);
        setReviewQuestions(evidencePayload.reviewItems ?? []);
      }
      if (importedActuals) {
        const refreshed = await request("/api/forecast");
        if (refreshed.ok) { const data = await readJson(refreshed); setForecast(data.months); }
        const refreshedPnl = await request("/api/pnl");
        if (refreshedPnl.ok) { const data = await readJson(refreshedPnl); setPnl(data.months); }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setNotice("Request stopped. No assistant response was saved.");
        return;
      }
      if (submittedMessage) setMessage((current) => current.trim() ? current : submittedMessage);
      setNotice(error instanceof Error ? `The request failed: ${error.message}` : "The request failed while contacting the model.");
    } finally {
      const ownsRequest = requestAbortController.current === abortController;
      if (ownsRequest) requestAbortController.current = null;
      if (ownsRequest) {
        setIsSubmitting(false);
        setSubmittingThreadId(null);
        setSubmissionStatus(null);
        setPendingQuestion(null);
      }
    }
  }

  async function reviewItem(id: string, status: "approved" | "rejected") {
    const response = await fetch("/api/evidence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (response.ok) setEvidence((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  }

  async function editItem(item: EvidenceItem) {
    if (!item.extraction) return;
    setEditingItem(item);
    setEditSummary(item.extraction.summary);
    setEditFacts(item.extraction.facts.map((fact) => ({ ...fact })));
  }

  async function saveEdit() {
    if (!editingItem?.extraction || !editSummary.trim()) {
      setEditingItem(null);
      return;
    }
    const extraction = { ...editingItem.extraction, summary: editSummary.trim(), facts: editFacts.filter((fact) => fact.label.trim() && fact.value.trim()).map((fact) => ({ ...fact, label: fact.label.trim(), value: fact.value.trim() })) };
    const response = await fetch("/api/evidence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingItem.id, extractedJson: JSON.stringify(extraction) }) });
    if (response.ok) setEvidence((current) => current.map((entry) => entry.id === editingItem.id ? { ...entry, extraction } : entry));
    setEditingItem(null);
  }

  const proposed = agentDecisions.filter((decision) => decision.status === "proposed");
  const isClosed = currentForecast?.status === "closed";
  const bars = periodForecastRows.map((month) => {
    const actual = month.actualReceipts !== 0 || month.actualSpending !== 0;
    const net = actual ? month.actualReceipts - month.actualSpending : month.receipts - month.spending;
    return { month: month.month, actual, net };
  });
  const maxAbs = Math.max(1, ...bars.map((bar) => Math.abs(bar.net)));
  const zeroY = 95;

  return (
    <div className="flex min-h-screen flex-col" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); collectFiles(event.dataTransfer.files); }}>
      <header className="flex h-14 items-center justify-end px-7">
        <AccountMenu company={company.name} baseCurrency={company.currency} user={user} />
      </header>

      <main className="mx-auto grid w-full max-w-[776px] flex-1 content-start gap-10 px-7 pt-6 pb-16">
        <section className="grid gap-5" aria-label="Conversation">
          {Object.keys(threads).length > 1 && <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-rule pb-1" role="tablist" aria-label="Chat threads">
            {Object.entries(threads).map(([id, thread], index) => <span key={id} className={cn("inline-flex shrink-0 items-center rounded-md", id === activeThreadId && "bg-rule")}><button type="button" role="tab" aria-selected={id === activeThreadId} className={cn("rounded-md px-3 py-1.5 text-[13px] text-ink-2 hover:bg-rule", id === activeThreadId && "text-ink")} onClick={() => { setActiveThreadId(id); setMessage(""); setActiveReviewQuestion(null); setActiveReviewQuestionId(null); }}>{id === "main" ? "Chat" : `Chat ${index + 1}`}{thread.length ? <span className="ml-1 text-pencil">· {thread.length}</span> : null}</button><button type="button" aria-label={`Clear ${id === "main" ? "chat" : `Chat ${index + 1}`}`} className="px-1.5 text-ink-2 hover:text-ink" onClick={() => { if (submittingThreadId === id) requestAbortController.current?.abort(); setThreads((current) => { const next = { ...current }; delete next[id]; const remaining = Object.keys(next); if (!remaining.length) next.main = []; if (activeThreadId === id) setActiveThreadId(remaining[0] ?? "main"); return next; }); }}>×</button></span>)}
          </div>}
          {turns.length > 0 && (
            <ol className="grid gap-6">
              {turns.map((turn) => (
                <li key={turn.id} className="grid gap-3">
                  <div className="flex justify-end">
                    <p className="max-w-[82%] rounded-[18px] bg-rule px-4 py-2.5 text-[15px] leading-[1.45] text-ink sm:max-w-[70%]">{turn.question}</p>
                  </div>
                  <div className="flex justify-start">
                    <div className="prose-serif max-w-[70ch] text-[17px] leading-[1.5] text-ink" style={{ fontVariationSettings: '"opsz" 17' }}><MarkdownMessage content={turn.answer} /></div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {isSubmitting && submittingThreadId === activeThreadId && pendingQuestion && submissionStatus && (
            <div className="grid gap-3" aria-live="polite">
              <div className="flex justify-end">
                <p className="max-w-[82%] rounded-[18px] bg-rule px-4 py-2.5 text-[15px] leading-[1.45] text-ink sm:max-w-[70%]">{pendingQuestion}</p>
              </div>
              <p className="flex items-center gap-2 text-[13px] text-ink-2" role="status">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> {submissionStatus}
              </p>
            </div>
          )}
          {activeReviewQuestion && (
            <div className="grid gap-1 rounded-[12px] border border-rule bg-rule/35 px-4 py-3" aria-label="Question being answered">
              <span className="text-[12px] uppercase tracking-[0.1em] text-ink-2">Answering waiting question</span>
              <p className="text-[15px] leading-[1.45] text-ink">Regarding “{activeReviewQuestion.question}”</p>
            </div>
          )}
          <form
            className="grid gap-3 rounded-[10px] border border-input px-[18px] pt-4 pb-3 transition-colors focus-within:border-ink"
            onSubmit={submit}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              collectFiles(event.dataTransfer.files);
            }}
          >
            <label htmlFor="nevermodel-message" className="sr-only">What should we work on?</label>
            <textarea
              id="nevermodel-message"
              ref={composerInput}
              className="prose-serif max-h-[60vh] min-h-[72px] w-full resize-none overflow-y-auto bg-transparent text-[19px] leading-[1.45] text-ink outline-none placeholder:text-pencil"
              style={{ fontVariationSettings: '"opsz" 19' }}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={composerPlaceholder}
              rows={2}
            />
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Selected files">
                {files.map((file) => (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2 py-1 text-[12px] text-ink-2" key={file}>
                    <FileText className="size-3.5" aria-hidden="true" /> {file}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <input
                ref={fileInput}
                hidden
                multiple
                type="file"
                accept=".pdf,.csv,.xlsx,.xls,.qbo,.ofx,.md,.txt,.json"
                onChange={(event) => collectFiles(event.target.files)}
              />
              <div className="flex min-w-0 items-center gap-1">
                <button
                  className={cn(quietButton, "mr-1 size-7 justify-center")}
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  aria-label="Attach a statement, invoice, or agreement"
                  title="Attach a statement, invoice, or agreement"
                >
                  <Paperclip className="size-4" aria-hidden="true" />
                </button>
                <Select value={model} onValueChange={chooseModel}>
                  <SelectTrigger size="sm" className={quietSelect} aria-label="Model">
                    <SelectValue />
                    <ChevronDown className="!block size-3.5 opacity-70" aria-hidden="true" />
                  </SelectTrigger>
                  <SelectContent className="border-rule">
                    {modelOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={effort} onValueChange={(value) => chooseEffort(value as Effort)}>
                  <SelectTrigger size="sm" className={quietSelect} aria-label="Reasoning effort">
                    <SelectValue />
                    <ChevronDown className="!block size-3.5 opacity-70" aria-hidden="true" />
                  </SelectTrigger>
                  <SelectContent className="border-rule">
                    {efforts.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isSubmitting && submittingThreadId === activeThreadId ? (
                <button className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-paper transition-colors outline-none hover:bg-ink/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" type="button" onClick={stopSubmission} aria-label="Stop request">
                  <Square className="size-3.5 fill-current" aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-paper transition-colors outline-none hover:bg-ink/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:bg-rule disabled:text-pencil"
                  type="submit"
                  disabled={!message.trim() && files.length === 0}
                  aria-label="Send"
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </form>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button className={quietButton} type="button" onClick={newChat}>
                <Plus className="size-3.5" aria-hidden="true" /> New chat
              </button>
              {turns.length > 0 && <button className={quietButton} type="button" onClick={clearCurrentThread}>Clear chat</button>}
              <button className={quietButton} type="button" onClick={openHistory}>
                <History className="size-3.5" aria-hidden="true" /> History
              </button>
              <Link href="/usage" rel="noopener noreferrer" className={quietButton}>
                <ChartColumn className="size-3.5" aria-hidden="true" /> Usage
              </Link>
              <Link href="/knowledge" className={quietButton}>
                <BookOpenText className="size-3.5" aria-hidden="true" /> Knowledge
              </Link>
            </div>
            <Link href="/about" className={quietButton}>
              <CircleHelp className="size-3.5" aria-hidden="true" /> Hints on how to use
            </Link>
          </div>
          {notice && (
            <p className="prose-serif text-[17px] leading-[1.5] text-ink" style={{ fontVariationSettings: '"opsz" 17' }} role="status">
              {notice}
            </p>
          )}
        </section>

        {needsInputCount > 0 && <section className="grid gap-3.5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="display text-[22px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 22' }}>Waiting on you</h2>
            <span className="text-[13px] text-ink-2">{`${needsInputCount} item${needsInputCount === 1 ? "" : "s"}`}</span>
          </div>
          {
            <div className="border-t border-rule">
              {reviewQuestions.length > 0 && (
                <div>
                  <div className="border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2">Questions for you · answer in chat</div>
                  {reviewQuestions.map((item) => (
                    <div className="grid gap-0.5 border-b border-rule py-3.5" key={item.id}>
                      <button className="w-fit max-w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" type="button" onClick={() => answerInChat(item)}>
                        <span className="mark">{item.question}</span>
                      </button>
                      <div className="text-[12px] text-pencil">Regarding {item.evidenceId ? (evidence.find((source) => source.id === item.evidenceId)?.sourceName ?? "uploaded evidence") : "company evidence"}</div>
                      <div className="text-[13px] text-ink-2">Opens a chat with this question ready to answer.</div>
                    </div>
                  ))}
                </div>
              )}
              {pendingEvidence.length > 0 && (
                <div>
                  <div className="border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2">Evidence to review · edit, approve, or reject</div>
                  {pendingEvidence.slice(0, 4).map((item) => (
                    <div className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-rule py-3.5" key={item.id}>
                      <div className="min-w-0">
                        <div>{item.extraction?.summary ?? item.sourceName}</div>
                        <div className="mt-0.5 text-[13px] text-ink-2">
                          {item.sourceName}
                          {item.sourceSize ? ` · ${Math.round(Number(item.sourceSize) / 1024)} KB` : ""}
                          {` · ${item.extraction?.facts.length ?? 0} facts extracted`}
                        </div>
                        {item.sourceExcerpt && !repeatsSummary(item.sourceExcerpt, item.extraction?.summary) && (
                          <div className="mt-1 truncate text-[13px] text-ink-2">
                            “{item.sourceExcerpt.replace(/\s+/g, " ").trim()}”
                          </div>
                        )}
                        {item.extraction?.questions.length ? (
                          <div className="mt-1 text-[13px]"><span className="mark">{item.extraction.questions[0]}</span></div>
                        ) : null}
                        {item.extraction?.facts.length ? (
                          <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-ink-2">
                            {item.extraction.facts.slice(0, 3).map((fact) => (
                              <span key={`${item.id}-${fact.label}`}>
                                {fact.label} <span className={cn("font-medium", fact.confidence >= 0.8 ? "text-ink" : "text-ink-2")}>{fact.value}</span>
                                {fact.confidence < 0.8 && <span className="text-pencil"> {Math.round(fact.confidence * 100)}%</span>}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <span className="flex gap-1">
                        <button className={actionButton} type="button" aria-label="Edit extracted evidence" onClick={() => editItem(item)}><Pencil /></button>
                        <button className={actionButton} type="button" aria-label="Approve extracted evidence" onClick={() => reviewItem(item.id, "approved")}><Check /></button>
                        <button className={actionButton} type="button" aria-label="Reject extracted evidence" onClick={() => reviewItem(item.id, "rejected")}><Trash2 /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {proposed.length > 0 && (
                <div>
                  <div className="border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2">Decisions to review · apply or reject</div>
                  {proposed.map((decision) => (
                    <div className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-rule py-3.5" key={decision.id}>
                      <div className="min-w-0">
                        <div>{decision.question}</div>
                        <div className="mt-0.5 text-[13px] text-ink-2">Proposed answer: {decision.answer}</div>
                      </div>
                      <span className="flex gap-1">
                        <button className={actionButton} type="button" aria-label="Apply proposed decision" title="Apply" onClick={() => updateAgentDecision(decision.id, "applied")}><Check /></button>
                        <button className={actionButton} type="button" aria-label="Reject proposed decision" title="Reject" onClick={() => updateAgentDecision(decision.id, "rejected")}><Trash2 /></button>
                        <button className={actionButton} type="button" aria-label="Discuss proposed decision in chat" title="Discuss in chat" onClick={() => discussDecision(decision)}><MessageSquareText /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          }
        </section>}

        <section className="grid gap-3.5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="display text-[22px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 22' }}>
              {selectedMonth ? periodLabel : "Company position"}
            </h2>
            <div className="flex items-center gap-3 text-[13px] text-ink-2">
              {currentForecast?.status && <span className="hidden sm:inline">{isClosed ? "Closed, in ink" : "Open, forecast in pencil"}</span>}
              <button type="button" className="hidden items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-ink-2 hover:bg-rule hover:text-ink sm:flex" onClick={() => window.location.reload()}><RefreshCw className="size-3.5" aria-hidden="true" /> Refresh</button>
              {forecast.length > 0 && (
                <>
                  <Select value={periodPreset} onValueChange={(value) => setPeriodPreset(value as PeriodPreset)}>
                    <SelectTrigger size="sm" className="h-7 rounded-md border-rule px-2 text-[13px] shadow-none dark:bg-transparent" aria-label="Reporting period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-rule">
                      <SelectItem value="month">Month</SelectItem>
                      <SelectItem value="quarter">Quarter</SelectItem>
                      <SelectItem value="ytd">Year to date</SelectItem>
                      <SelectItem value="year">Calendar year</SelectItem>
                      <SelectItem value="custom">Custom range</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger size="sm" className="h-7 rounded-md border-rule px-2 text-[13px] shadow-none dark:bg-transparent" aria-label="Anchor month">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent className="border-rule">
                      {forecast.map((month) => (
                        <SelectItem key={month.month} value={month.month}>{monthLabel(month.month)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {periodPreset === "custom" && (
                    <span className="hidden items-center gap-1.5 lg:flex">
                      <Input aria-label="Custom period start" type="month" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="h-7 w-[116px] px-2 text-[12px]" />
                      <span>–</span>
                      <Input aria-label="Custom period end" type="month" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="h-7 w-[116px] px-2 text-[12px]" />
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          {closeSummary?.month === selectedMonth && (
            <p className="text-[13px] text-ink-2">Closed with actual net {money(closeSummary.actualNet)} and variance {money(closeSummary.variance)}.</p>
          )}

          <div className="grid grid-cols-2 gap-6 border-y border-rule py-5 sm:grid-cols-4">
            <Figure
              label="Cash"
              value={currentForecast ? money(currentForecast.endingCash) : "—"}
              note={currentForecast ? (isClosed ? "Ending cash" : "Projected ending cash") : "Awaiting opening balance"}
              pencil={Boolean(currentForecast) && !isClosed}
              negative={Boolean(currentForecast && currentForecast.endingCash < 0)}
            />
            <Figure
              label={isClosed ? "Received" : "Expected in"}
              value={currentForecast ? money(isClosed ? currentForecast.actualReceipts : currentForecast.receipts) : "—"}
              note={currentForecast ? (isClosed ? "Actual receipts" : "From approved agreements") : "No agreements yet"}
              pencil={Boolean(currentForecast) && !isClosed}
            />
            <Figure
              label={isClosed ? "Spent" : "Expected out"}
              value={currentForecast ? money(isClosed ? currentForecast.actualSpending : currentForecast.spending) : "—"}
              note={currentForecast ? (isClosed ? "Actual spending" : "From approved obligations") : "No obligations yet"}
              pencil={Boolean(currentForecast) && !isClosed}
            />
            <Figure
              label="Net"
              value={currentForecast ? money(isClosed ? currentForecast.actualReceipts - currentForecast.actualSpending : currentForecast.receipts - currentForecast.spending) : "—"}
              note={
                currentForecast
                  ? `Variance ${money(currentForecast.variance ?? currentForecast.actualReceipts - currentForecast.actualSpending - (currentForecast.receipts - currentForecast.spending))}`
                  : `${company.currency}, deterministic`
              }
              pencil={Boolean(currentForecast) && !isClosed}
              negative={Boolean(currentForecast && (isClosed ? currentForecast.actualReceipts - currentForecast.actualSpending : currentForecast.receipts - currentForecast.spending) < 0)}
            />
          </div>

          {bars.length ? (
            <div className="grid gap-2.5">
              <div className="flex gap-4 text-[13px] text-ink-2">
                <span><i className="mr-1.5 inline-block size-2.5 rounded-[2px] bg-ink align-[-1px]" />Actual</span>
                <span><i className="mr-1.5 inline-block size-2.5 rounded-[2px] bg-pencil-2 align-[-1px]" />Forecast</span>
              </div>
              <svg viewBox="0 0 720 170" className="block h-auto w-full" role="img" aria-label="Net cash flow by month. Closed months in ink, forecast months in pencil.">
                <line x1="0" y1={zeroY} x2="720" y2={zeroY} className="stroke-rule" strokeWidth="1" />
                {bars.map((bar, index) => {
                  const slot = 720 / bars.length;
                  const width = Math.min(28, slot * 0.5);
                  const x = index * slot + (slot - width) / 2;
                  const height = Math.max(2, (Math.abs(bar.net) / maxAbs) * 65);
                  const negative = bar.net < 0;
                  const selected = bar.month === selectedMonth;
                  return (
                    <g key={bar.month} className="cursor-pointer" onClick={() => setSelectedMonth(bar.month)}>
                      <title>{`${monthLabel(bar.month)}: ${money(bar.net)} ${bar.actual ? "actual" : "forecast"}`}</title>
                      <rect x={x} y={negative ? zeroY : zeroY - height} width={width} height={height} className={cn(negative ? "fill-red-ink" : bar.actual ? "fill-ink" : "fill-pencil-2")} opacity={negative && !bar.actual ? 0.35 : 1} />
                      <text x={x + width / 2} y="162" textAnchor="middle" fontSize="11" className={cn("font-sans", selected ? "fill-ink" : "fill-pencil")}>{monthLabel(bar.month, shortMonthFormatter)}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (
            <p className="max-w-[60ch] text-ink-2">Your forecast builds itself here once there is an opening cash balance and at least one approved agreement or obligation.</p>
          )}

          {currentForecast && (
            <section className="grid gap-3 border-t border-rule pt-5" aria-label="Financial statements">
              <h3 className="text-[13px] uppercase tracking-[0.12em] text-ink-2">Financial statements</h3>
              <div className="flex w-full border-b border-rule" role="tablist" aria-label="Financial statements">
                {([['income', 'Income statement'], ['cash', 'Cash flow statement'], ['balance', 'Balance sheet']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={statementTab === value} className={cn("border-b-2 px-3 py-2 text-[13px] text-ink-2", statementTab === value ? "border-ink text-ink" : "border-transparent hover:text-ink")} onClick={() => setStatementTab(value)}>{label}</button>)}
              </div>
              <div className="w-full rounded-lg border border-rule p-4">
                {statementTab === "income" && <div>
                  <div className="text-[13px] text-ink-2">Income statement</div>
                  <div className="mt-2 grid gap-1 text-[13px]">
                    <span>Revenue <span className="float-right">{money(currentPnl?.revenue ?? 0)}</span></span>
                    <span>Expenses <span className="float-right">{money(currentPnl?.expenses ?? 0)}</span></span>
                    <span className="border-t border-rule pt-1 font-medium">Operating income <span className="float-right">{money(currentPnl?.operatingIncome ?? 0)}</span></span>
                  </div>
                  {currentPnl && <div className="mt-3 grid gap-1 border-t border-rule pt-2 text-[12px] text-ink-2"><span className="text-[11px] uppercase tracking-wide text-pencil">Revenue breakdown</span>{Object.entries(currentPnl.revenueByCategory).filter(([, amount]) => amount > 0).map(([category, amount]) => <span key={`revenue-${category}`} className="capitalize">{category.replace(/_/g, " ")} <span className="float-right">{money(amount)}</span></span>)}<span className="mt-1 text-[11px] uppercase tracking-wide text-pencil">Expense breakdown</span>{Object.entries(currentPnl.byCategory).filter(([, amount]) => amount > 0).map(([category, amount]) => <span key={category} className="capitalize">{category.replace(/_/g, " ")} <span className="float-right">{money(amount)}</span></span>)}</div>}
                  {currentPnl?.trace?.length ? <details className="mt-3 min-w-0 border-t border-rule pt-2 text-[12px]"><summary className="cursor-pointer text-ink-2">Transaction detail ({currentPnl.trace.length})</summary><div className="mt-2 grid max-h-40 min-w-0 gap-1 overflow-x-auto overflow-y-auto">{currentPnl.trace.map((line, index) => <span key={`${line.description}-${index}`} className="flex min-w-max justify-between gap-4 whitespace-nowrap"><span>{line.description ?? line.category}</span><span className="shrink-0">{line.direction === "spend" ? "−" : "+"}{money(line.amount)}</span></span>)}</div></details> : null}
                  {periodPnlRows.length > 1 && <div className="mt-4 overflow-x-auto border-t border-rule pt-3"><table className="w-full text-[12px]"><thead><tr className="text-left text-ink-2"><th className="pb-2 font-normal">Period</th><th className="pb-2 text-right font-normal">Revenue</th><th className="pb-2 text-right font-normal">Expenses</th><th className="pb-2 text-right font-normal">Operating income</th></tr></thead><tbody>{periodPnlRows.map((row) => <tr key={row.month} className="border-t border-rule"><td className="py-2">{monthLabel(row.month)}</td><td className="py-2 text-right">{money(row.revenue)}</td><td className="py-2 text-right">{money(row.expenses)}</td><td className="py-2 text-right">{money(row.operatingIncome)}</td></tr>)}</tbody></table></div>}
                </div>}
                {statementTab === "cash" && <div>
                  <div className="text-[13px] text-ink-2">Cash flow statement</div>
                  <div className="mt-2 grid gap-1 text-[13px]">
                    <span>Beginning period cash <span className="float-right">{money(currentForecast.openingCash ?? (currentForecast.endingCash - (isClosed ? currentForecast.actualReceipts - currentForecast.actualSpending : currentForecast.receipts - currentForecast.spending)))}</span></span>
                    <span>Cash from operations <span className="float-right">{money(isClosed ? currentForecast.actualReceipts - currentForecast.actualSpending : currentForecast.receipts - currentForecast.spending)}</span></span>
                    <span>Cash from financing <span className="float-right">{money(0)}</span></span>
                    <span>Cash from investing <span className="float-right">{money(0)}</span></span>
                    <span className="border-t border-rule pt-1 font-medium">Ending cash <span className="float-right">{money(currentForecast.endingCash)}</span></span>
                  </div>
                  {currentForecast.trace && <div className="mt-3 grid max-h-36 min-w-0 gap-1 overflow-x-auto overflow-y-auto border-t border-rule pt-2 text-[12px] text-ink-2">{currentForecast.trace.filter((entry) => entry.amount).map((entry, index) => <span key={`${entry.description}-${index}`} className="flex min-w-max justify-between gap-4 whitespace-nowrap"><span>{entry.description}</span><span className="shrink-0">{entry.kind === "spend" ? "−" : "+"}{money(entry.amount ?? 0)}</span></span>)}</div>}
                  {periodForecastRows.length > 1 && <div className="mt-4 overflow-x-auto border-t border-rule pt-3"><table className="w-full text-[12px]"><thead><tr className="text-left text-ink-2"><th className="pb-2 font-normal">Period</th><th className="pb-2 text-right font-normal">Beginning</th><th className="pb-2 text-right font-normal">Net change</th><th className="pb-2 text-right font-normal">Ending</th></tr></thead><tbody>{periodForecastRows.map((row) => <tr key={row.month} className="border-t border-rule"><td className="py-2">{monthLabel(row.month)}</td><td className="py-2 text-right">{money(row.openingCash ?? 0)}</td><td className="py-2 text-right">{money(row.actualReceipts - row.actualSpending)}</td><td className="py-2 text-right">{money(row.endingCash)}</td></tr>)}</tbody></table></div>}
                </div>}
                {statementTab === "balance" && <div>
                  <div className="text-[13px] text-ink-2">Balance sheet snapshot</div>
                  <div className="mt-2 grid gap-1 text-[13px]">
                    <span>Cash and equivalents <span className="float-right">{money(currentForecast.endingCash)}</span></span>
                    <span>Period <span className="float-right">{monthLabel(currentForecast.month)}</span></span>
                    <span className="border-t border-rule pt-1 font-medium">Position <span className="float-right">{currentForecast.endingCash < 0 ? "Deficit" : "Positive"}</span></span>
                  </div>
                  {periodForecastRows.length > 1 && <div className="mt-4 overflow-x-auto border-t border-rule pt-3"><table className="w-full text-[12px]"><thead><tr className="text-left text-ink-2"><th className="pb-2 font-normal">Period</th><th className="pb-2 text-right font-normal">Total assets / cash</th><th className="pb-2 text-right font-normal">Position</th></tr></thead><tbody>{periodForecastRows.map((row) => <tr key={row.month} className="border-t border-rule"><td className="py-2">{monthLabel(row.month)}</td><td className="py-2 text-right">{money(row.endingCash)}</td><td className="py-2 text-right">{row.endingCash < 0 ? "Deficit" : "Positive"}</td></tr>)}</tbody></table></div>}
                </div>}
              </div>
            </section>
          )}

          {currentForecast?.trace?.length ? (
            <details className="border-b border-rule pb-4 text-[13px]">
              <summary className="cursor-pointer list-none text-ink-2 [&::-webkit-details-marker]:hidden">Calculated from <span className="ml-1 text-pencil">({new Set(currentForecast.trace.map((entry) => entry.sourceName).filter(Boolean)).size} sources)</span></summary>
              <div className="mt-2 grid gap-1 text-ink">
                {[...new Set(currentForecast.trace.map((entry) => entry.sourceName).filter(Boolean))].map((source) => (
                  <span key={source}>{source}</span>
                ))}
              </div>
            </details>
          ) : null}
        </section>
      </main>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[80vh] gap-0 overflow-hidden rounded-xl border-rule bg-[#f7f7f8] p-0 dark:bg-[#1b1c20] sm:max-w-[960px]">
          <DialogHeader className="border-b border-rule px-6 py-6 pr-14 text-left">
            <DialogTitle className="display text-[26px] font-medium" style={{ fontVariationSettings: '"opsz" 26' }}>History</DialogTitle>
            <DialogDescription>Past conversations for {company.name}. Choose one to continue it.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] min-h-0">
            <div className="p-3">
              {history === null ? (
                <div className="grid gap-3 p-2" aria-label="Loading conversation history">
                  {Array.from({ length: 5 }, (_, index) => (
                    <div className="grid gap-2 rounded-xl bg-background/70 p-4" key={index}>
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-3 w-3/5" />
                    </div>
                  ))}
                </div>
              ) : history.length === 0 ? (
                <Empty className="border-0 py-20">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><MessageSquareText aria-hidden="true" /></EmptyMedia>
                    <EmptyTitle>No conversations yet</EmptyTitle>
                    <EmptyDescription>Ask a question in chat and it will appear here.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="grid gap-1">
                  {history.map((turn) => (
                    <li key={turn.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start whitespace-normal rounded-xl px-4 py-3 text-left font-normal hover:bg-background focus-visible:bg-background dark:hover:bg-background/40 dark:focus-visible:bg-background/40"
                        onClick={() => { setTurns([turn]); setActiveReviewQuestionId(null); setHistoryOpen(false); }}
                      >
                        <span className="grid min-w-0 flex-1 gap-1">
                          <span className="line-clamp-2 text-[15px] leading-5 text-ink">{turn.question}</span>
                          {turn.answer && <span className="prose-serif line-clamp-2 text-[13px] leading-5 text-ink-2">{turn.answer.replace(/[#*_`]/g, "")}</span>}
                          <span className="mt-1 text-[12px] text-pencil">{dateFormatter.format(new Date(turn.createdAt))} at {timeFormatter.format(new Date(turn.createdAt))}{turn.model ? ` · ${turn.model}` : ""}</span>
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className="rounded-xl border-rule sm:max-w-[840px]">
          <DialogHeader>
            <DialogTitle className="display text-[22px] font-medium" style={{ fontVariationSettings: '"opsz" 22' }}>Edit extracted facts</DialogTitle>
            <DialogDescription>Correct the interpretation before it is used in the forecast.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            Summary
            <textarea
              className="min-h-[96px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] text-ink outline-none focus:border-ink"
              value={editSummary}
              onChange={(event) => setEditSummary(event.target.value)}
              autoFocus
              rows={3}
            />
          </label>
          {editFacts.length > 0 && (
            <div className="grid max-h-[220px] gap-2 overflow-auto">
              {editFacts.map((fact, index) => (
                <div className="grid grid-cols-[1fr_1.5fr] gap-2" key={`${fact.label}-${index}`}>
                  <Input aria-label={`Fact ${index + 1} label`} value={fact.label} onChange={(event) => setEditFacts((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, label: event.target.value } : entry))} />
                  <Input aria-label={`Fact ${index + 1} value`} value={fact.value} onChange={(event) => setEditFacts((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, value: event.target.value } : entry))} />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={() => setEditingItem(null)}>Cancel</Button>
            <Button type="button" className="rounded-full" onClick={saveEdit} disabled={!editSummary.trim()}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
