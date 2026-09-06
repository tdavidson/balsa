"use client";

import { ArrowUp, BookOpenText, ChartColumn, Check, ChevronDown, CircleHelp, FileText, History, LoaderCircle, MessageSquareText, Paperclip, Pencil, Plus, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-rule pb-4 text-[13px]">
      <span className="text-ink-2">{title}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink">{children}</div>
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
type ForecastMonth = { month: string; receipts: number; spending: number; endingCash: number; actualReceipts: number; actualSpending: number; actualNet?: number; variance?: number; status?: "open" | "closed"; trace?: { description: string; evidenceId: string | null; sourceName?: string | null }[] };
type PnlMonth = { month: string; revenue: number; expenses: number; operatingIncome: number; byCategory: Record<string, number> };
type ObligationSummary = { id: string; label: string; unpaidAmount: number; status: string };
type DueFromFund = { entityId: string; entityName: string; amount: number };

export function AppShell({ company, user, modelOptions }: AppShellProps) {
  const [message, setMessage] = useState("");
  const [composerPlaceholder, setComposerPlaceholder] = useState("Tell me what needs attention");
  const [model, chooseModel] = useStoredChoice("nevermodel.model", "auto", (value) => modelOptions.some((option) => option.value === value));
  const [storedEffort, chooseEffort] = useStoredChoice("nevermodel.effort", "auto", (value) => efforts.some((option) => option.value === value));
  const effort = storedEffort as Effort;
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [history, setHistory] = useState<ConversationTurn[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [activeReviewQuestionId, setActiveReviewQuestionId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [reviewQuestions, setReviewQuestions] = useState<ReviewQuestion[]>([]);
  const [agentDecisions, setAgentDecisions] = useState<AgentDecision[]>([]);
  const [forecast, setForecast] = useState<ForecastMonth[]>([]);
  const [pnl, setPnl] = useState<PnlMonth[]>([]);
  const [obligations, setObligations] = useState<ObligationSummary[]>([]);
  const [dueFromFunds, setDueFromFunds] = useState<DueFromFund[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [editingItem, setEditingItem] = useState<EvidenceItem | null>(null);
  const [editSummary, setEditSummary] = useState("");
  const [editFacts, setEditFacts] = useState<{ label: string; value: string; confidence: number }[]>([]);
  const [closeSummary, setCloseSummary] = useState<{ month: string; actualNet: number; variance: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const requestAbortController = useRef<AbortController | null>(null);

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
  const currentForecast = forecast.find((month) => month.month === selectedMonth);
  const currentPnl = pnl.find((month) => month.month === selectedMonth);
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
      .then((payload) => { if (payload) { setEvidence(payload.evidence); setReviewQuestions(payload.reviewItems ?? []); } })
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
      const [obligationsResponse, allocationsResponse] = await Promise.all([fetch("/api/obligations"), fetch("/api/allocations")]);
      if (obligationsResponse.ok) { const data = await readJson(obligationsResponse); setObligations(data.obligations ?? []); }
      if (allocationsResponse.ok) { const data = await readJson(allocationsResponse); setDueFromFunds(data.dueFromFunds ?? []); }
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
    setTurns((current) => [...current, { id: crypto.randomUUID(), question, answer, model: model === "auto" ? null : model, createdAt: new Date().toISOString() }]);
    if (activeReviewQuestionId && payload.resolvedQuestions?.some((resolution: { id: string }) => resolution.id === activeReviewQuestionId)) setActiveReviewQuestionId(null);
    setPendingQuestion(null);
    setHistory(null);
    const [refreshedEvidence, refreshedDecisions] = await Promise.all([fetch("/api/evidence"), fetch("/api/decisions")]);
    if (refreshedEvidence.ok) {
      const evidencePayload = await readJson(refreshedEvidence);
      setEvidence(evidencePayload.evidence);
      setReviewQuestions(evidencePayload.reviewItems ?? []);
    }
    if (refreshedDecisions.ok) {
      const decisionsPayload = await readJson(refreshedDecisions);
      if (decisionsPayload.decisions) setAgentDecisions(decisionsPayload.decisions);
    }
    return payload;
  }

  function newChat() {
    setTurns([]);
    setMessage("");
    setFiles([]);
    setSelectedFiles([]);
    setNotice(null);
    setSubmissionStatus(null);
    setPendingQuestion(null);
    setActiveReviewQuestionId(null);
  }

  function answerInChat(item: ReviewQuestion) {
    setTurns([]);
    setMessage(`Regarding “${item.question}”: `);
    setFiles([]);
    setSelectedFiles([]);
    setNotice(null);
    setSubmissionStatus(null);
    setPendingQuestion(null);
    setActiveReviewQuestionId(item.id);
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
    if (isSubmitting || (!submittedMessage && files.length === 0)) return;
    const abortController = new AbortController();
    requestAbortController.current = abortController;
    setIsSubmitting(true);
    setPendingQuestion(submittedMessage || `Uploaded ${files.join(", ")}`);
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
        await askAgent(submittedMessage, [], abortController.signal);
        return;
      }
      const payloads: { id: string; sourceName: string; status: "pending" | "approved"; extraction: EvidenceItem["extraction"] }[] = [];
      let importedActuals = 0;
      let duplicateActuals = 0;
      if (selectedFiles.length) {
        for (const [index, file] of selectedFiles.entries()) {
          setSubmissionStatus(`Reading ${file.name} (${index + 1} of ${selectedFiles.length})…`);
          const looksLikeTransactions = /\.(csv|xlsx|xls|qbo|ofx)$/i.test(file.name) && (/bank|transaction|actual|statement|quickbooks|qbo|ofx/i.test(file.name) || (/\.csv$/i.test(file.name) && /date/i.test(await file.slice(0, 2000).text()) && /amount|debit|credit|value|total/i.test(await file.slice(0, 2000).text())));
          if (looksLikeTransactions) {
            const actualsForm = new FormData(); actualsForm.append("file", file);
            const actualsResponse = await request("/api/actuals", { method: "POST", body: actualsForm });
            const actualsPayload = await readJson(actualsResponse);
            if (!actualsResponse.ok) throw new Error(actualsPayload.error ?? `Unable to import ${file.name}`);
            importedActuals += Number(actualsPayload.imported ?? 0);
            if (actualsPayload.duplicate) duplicateActuals += 1;
            if (actualsPayload.id && actualsPayload.extraction) payloads.push({ id: actualsPayload.id, sourceName: file.name, status: "approved", extraction: actualsPayload.extraction });
            continue;
          }
          const form = new FormData(); form.append("file", file); form.append("model", model); if (submittedMessage) form.append("instructions", submittedMessage); if (effort !== "auto") form.append("effort", effort);
          const response = await request("/api/evidence", { method: "POST", body: form });
          const payload = await readJson(response);
          if (!response.ok) throw new Error(payload.error ?? `Unable to process ${file.name}`);
          payloads.push({ ...payload, sourceName: file.name, status: "pending" });
        }
      }
      setEvidence((current) => [...payloads.map((payload) => ({ id: payload.id, sourceName: payload.sourceName, status: payload.status, extraction: payload.extraction })), ...current]);
      const question = submittedMessage || `I uploaded ${files.join(", ")}. Review what I shared, tell me what you found, and ask me about anything that needs clarification.`;
      const chatEvidence = payloads.map((payload) => ({
        id: payload.id,
        sourceName: payload.sourceName,
        summary: payload.extraction?.summary,
        facts: payload.extraction?.facts ?? [],
        questions: payload.extraction?.questions ?? [],
      }));
      setSubmissionStatus("Considering the files and preparing a response…");
      await askAgent(question, chatEvidence, abortController.signal);
      setNotice(`${payloads.length} evidence source${payloads.length === 1 ? "" : "s"} captured${importedActuals ? `; ${importedActuals} actual transactions imported` : duplicateActuals ? `; ${duplicateActuals} actual file${duplicateActuals === 1 ? "" : "s"} already imported` : ""}.`);
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
      if (requestAbortController.current === abortController) requestAbortController.current = null;
      setIsSubmitting(false);
      setSubmissionStatus(null);
      setPendingQuestion(null);
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
  const bars = forecast.slice(0, 12).map((month) => {
    const closed = month.status === "closed";
    const net = closed ? month.actualReceipts - month.actualSpending : month.receipts - month.spending;
    return { month: month.month, closed, net };
  });
  const maxAbs = Math.max(1, ...bars.map((bar) => Math.abs(bar.net)));
  const zeroY = 95;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-end px-7">
        <AccountMenu company={company.name} baseCurrency={company.currency} user={user} />
      </header>

      <main className="mx-auto grid w-full max-w-[776px] flex-1 content-start gap-10 px-7 pt-6 pb-16">
        <section className="grid gap-5" aria-label="Conversation">
          {turns.length > 0 && (
            <ol className="grid gap-6">
              {turns.map((turn) => (
                <li key={turn.id} className="grid gap-3">
                  <div className="flex justify-end">
                    <p className="max-w-[82%] rounded-[18px] bg-rule px-4 py-2.5 text-[15px] leading-[1.45] text-ink sm:max-w-[70%]">{turn.question}</p>
                  </div>
                  <div className="flex justify-start">
                    <p className="prose-serif max-w-[62ch] text-[17px] leading-[1.5] text-ink" style={{ fontVariationSettings: '"opsz" 17' }}>{turn.answer}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {isSubmitting && pendingQuestion && submissionStatus && (
            <div className="grid gap-3" aria-live="polite">
              <div className="flex justify-end">
                <p className="max-w-[82%] rounded-[18px] bg-rule px-4 py-2.5 text-[15px] leading-[1.45] text-ink sm:max-w-[70%]">{pendingQuestion}</p>
              </div>
              <p className="flex items-center gap-2 text-[13px] text-ink-2" role="status">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> {submissionStatus}
                <button type="button" className="ml-1 rounded-md border border-rule px-2 py-0.5 text-[12px] text-ink transition-colors hover:bg-rule focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={stopSubmission}>Stop</button>
              </p>
            </div>
          )}
          <form
            className="grid gap-3 rounded-[10px] border border-input px-[18px] pt-4 pb-3 transition-colors focus-within:border-ink"
            onSubmit={submit}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
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
              {isSubmitting ? (
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
              <button className={quietButton} type="button" onClick={newChat} disabled={turns.length === 0 && !message && files.length === 0 && !notice}>
                <Plus className="size-3.5" aria-hidden="true" /> New chat
              </button>
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

        <section className="grid gap-3.5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="display text-[22px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 22' }}>Waiting on you</h2>
            <span className="text-[13px] text-ink-2">{needsInputCount ? `${needsInputCount} item${needsInputCount === 1 ? "" : "s"}` : "Nothing"}</span>
          </div>
          {needsInputCount === 0 ? (
            <p className="max-w-[60ch] border-t border-rule pt-4 text-ink-2">
              Nothing is waiting on you. When a document is ambiguous, the question shows up here.
            </p>
          ) : (
            <div className="border-t border-rule">
              {reviewQuestions.length > 0 && (
                <div>
                  <div className="border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2">Questions for you · answer in chat</div>
                  {reviewQuestions.map((item) => (
                    <div className="grid gap-0.5 border-b border-rule py-3.5" key={item.id}>
                      <button className="w-fit max-w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" type="button" onClick={() => answerInChat(item)}>
                        <span className="mark">{item.question}</span>
                      </button>
                      <div className="text-[13px] text-ink-2">Opens a new chat thread with this question ready to answer.</div>
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
                        <button className={actionButton} type="button" aria-label="Apply proposed decision" onClick={() => updateAgentDecision(decision.id, "applied")}><Check /></button>
                        <button className={actionButton} type="button" aria-label="Reject proposed decision" onClick={() => updateAgentDecision(decision.id, "rejected")}><Trash2 /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="grid gap-3.5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="display text-[22px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 22' }}>
              {selectedMonth ? monthLabel(selectedMonth) : "Company position"}
            </h2>
            <div className="flex items-center gap-3 text-[13px] text-ink-2">
              {currentForecast?.status && <span className="hidden sm:inline">{isClosed ? "Closed, in ink" : "Open, forecast in pencil"}</span>}
              {forecast.length > 0 && (
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger size="sm" className="h-7 rounded-md border-rule px-2 text-[13px] shadow-none dark:bg-transparent" aria-label="Month">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent className="border-rule">
                    {forecast.map((month) => (
                      <SelectItem key={month.month} value={month.month}>{monthLabel(month.month)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

          {currentPnl && (
            <Detail title={`Monthly P&L, ${money(currentPnl.operatingIncome)} operating income`}>
              {Object.entries(currentPnl.byCategory).filter(([, amount]) => amount > 0).map(([category, amount]) => (
                <span key={category} className="capitalize">{category.replace(/_/g, " ")} <span className="text-ink-2">{money(amount)}</span></span>
              ))}
            </Detail>
          )}
          {(obligations.some((item) => item.unpaidAmount > 0) || dueFromFunds.length > 0) && (
            <Detail title="Open commitments">
              {obligations.filter((item) => item.unpaidAmount > 0).slice(0, 4).map((item) => (
                <span key={item.id}>{item.label} <span className="text-ink-2">{money(item.unpaidAmount)} unpaid</span></span>
              ))}
              {dueFromFunds.map((fund) => (
                <span key={fund.entityId}>{fund.entityName} <span className="text-ink-2">owes {money(fund.amount)}</span></span>
              ))}
            </Detail>
          )}
          {currentForecast?.trace?.length ? (
            <Detail title="Calculated from">
              {[...new Set(currentForecast.trace.map((entry) => entry.sourceName).filter(Boolean))].map((source) => (
                <span key={source}>{source}</span>
              ))}
            </Detail>
          ) : null}

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
                      <title>{`${monthLabel(bar.month)}: ${money(bar.net)} ${bar.closed ? "actual" : "forecast"}`}</title>
                      <rect x={x} y={negative ? zeroY : zeroY - height} width={width} height={height} className={cn(negative ? "fill-red-ink" : bar.closed ? "fill-ink" : "fill-pencil-2")} opacity={negative && !bar.closed ? 0.35 : 1} />
                      <text x={x + width / 2} y="162" textAnchor="middle" fontSize="11" className={cn("font-sans", selected ? "fill-ink" : "fill-pencil")}>{monthLabel(bar.month, shortMonthFormatter)}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          ) : (
            <p className="max-w-[60ch] text-ink-2">Your forecast builds itself here once there is an opening cash balance and at least one approved agreement or obligation.</p>
          )}
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
                          {turn.answer && <span className="prose-serif line-clamp-2 text-[13px] leading-5 text-ink-2">{turn.answer}</span>}
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
