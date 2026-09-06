"use client";

import { ArrowUp, Check, ChevronDown, FileText, History, LoaderCircle, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
type ReviewQuestion = { id: string; evidenceId?: string | null; question: string; answer?: string | null; status: string };
type AgentDecision = { id: string; question: string; answer: string; status: "proposed" | "applied" | "rejected" };
type ForecastMonth = { month: string; receipts: number; spending: number; endingCash: number; actualReceipts: number; actualSpending: number; actualNet?: number; variance?: number; status?: "open" | "closed"; trace?: { description: string; evidenceId: string | null; sourceName?: string | null }[] };
type PnlMonth = { month: string; revenue: number; expenses: number; operatingIncome: number; byCategory: Record<string, number> };
type ObligationSummary = { id: string; label: string; unpaidAmount: number; status: string };
type DueFromFund = { entityId: string; entityName: string; amount: number };

export function AppShell({ company, user, modelOptions }: AppShellProps) {
  const [message, setMessage] = useState("");
  const [model, chooseModel] = useStoredChoice("nevermodel.model", "auto", (value) => modelOptions.some((option) => option.value === value));
  const [storedEffort, chooseEffort] = useStoredChoice("nevermodel.effort", "auto", (value) => efforts.some((option) => option.value === value));
  const effort = storedEffort as Effort;
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [history, setHistory] = useState<ConversationTurn[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileText, setFileText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const currentForecast = forecast.find((month) => month.month === selectedMonth);
  const currentPnl = pnl.find((month) => month.month === selectedMonth);
  const pendingEvidence = evidence.filter((item) => item.status === "pending");
  const needsInputCount = pendingEvidence.length + reviewQuestions.length + agentDecisions.filter((decision) => decision.status === "proposed").length;
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
      const monthsPayload = monthsResponse.ok ? await monthsResponse.json() : null;
      if (monthsPayload?.months?.length === 0) {
        const month = new Date().toISOString().slice(0, 7);
        await fetch("/api/months", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) });
      }
      const response = await fetch("/api/forecast");
      const payload = response.ok ? await response.json() : null;
      if (payload?.months) { setForecast(payload.months); setSelectedMonth(payload.months[0]?.month ?? ""); }
      const pnlResponse = await fetch("/api/pnl");
      const pnlPayload = pnlResponse.ok ? await pnlResponse.json() : null;
      if (pnlPayload?.months) setPnl(pnlPayload.months);
      const [obligationsResponse, allocationsResponse] = await Promise.all([fetch("/api/obligations"), fetch("/api/allocations")]);
      if (obligationsResponse.ok) { const data = await obligationsResponse.json(); setObligations(data.obligations ?? []); }
      if (allocationsResponse.ok) { const data = await allocationsResponse.json(); setDueFromFunds(data.dueFromFunds ?? []); }
    }
    loadForecast().catch(() => undefined);
  }, []);


  async function collectFiles(fileList: FileList | null) {
    if (!fileList) return;
    const selected = Array.from(fileList);
    setSelectedFiles(selected);
    setFiles(selected.map((file) => file.name));
    const readable = selected.filter((file) => /\.(txt|md|csv|json)$/i.test(file.name));
    if (readable.length) {
      const contents = await Promise.all(readable.map(async (file) => `--- ${file.name} ---\n${await file.text()}`));
      setFileText(contents.join("\n\n"));
    } else {
      setFileText("");
    }
    setNotice(null);
  }

  function modelChoice() {
    return { model, ...(effort === "auto" ? {} : { effort }) };
  }

  function newChat() {
    setTurns([]);
    setMessage("");
    setFiles([]);
    setSelectedFiles([]);
    setFileText("");
    setNotice(null);
  }

  async function openHistory() {
    setHistoryOpen(true);
    if (history) return;
    const response = await fetch("/api/conversations");
    if (response.ok) { const data = await response.json(); setHistory(data.turns ?? []); } else setHistory([]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() && files.length === 0) return;
    setIsSubmitting(true);
    setNotice(null);
    try {
      const closeCommand = message.trim().match(/^close\s+(?:month\s+)?(\d{4}-\d{2})$/i);
      if (closeCommand) {
        const response = await fetch("/api/months", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: closeCommand[1], status: "closed" }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to close month");
        const summary = payload.summary as { actualNet?: number; variance?: number } | undefined;
        if (summary?.actualNet !== undefined && summary.variance !== undefined) setCloseSummary({ month: closeCommand[1]!, actualNet: summary.actualNet, variance: summary.variance });
        setNotice(`${closeCommand[1]} close completed${summary ? ` · actual net ${company.currency} ${summary.actualNet?.toLocaleString()} · variance ${summary.variance?.toLocaleString()}` : ""}.`);
        setMessage("");
        const refreshed = await fetch("/api/forecast");
        if (refreshed.ok) { const data = await refreshed.json(); setForecast(data.months); }
        return;
      }
      const reopenCommand = message.trim().match(/^(?:open|reopen)\s+(?:month\s+)?(\d{4}-\d{2})$/i);
      if (reopenCommand) {
        const response = await fetch("/api/months", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: reopenCommand[1], status: "open" }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to reopen month");
        setNotice(`${reopenCommand[1]} reopened.`);
        setMessage("");
        const refreshed = await fetch("/api/forecast");
        if (refreshed.ok) { const data = await refreshed.json(); setForecast(data.months); }
        return;
      }
      const decisionCommand = message.trim().match(/^decision\s*:\s*(.+?)\s*=>\s*(.+)$/i);
      const policyCommand = message.trim().match(/^policy\s*:\s*(.+?)\s*=>\s*(.+)$/i);
      if (decisionCommand || policyCommand) {
        const response = await fetch("/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decisionCommand ? { question: decisionCommand[1], answer: decisionCommand[2] } : { question: "Standing CFO policy", answer: policyCommand![2], policyName: policyCommand![1], policyRule: policyCommand![2] }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to save decision");
        setNotice(policyCommand ? `Policy “${policyCommand[1]}” saved.` : "Decision saved.");
        const refreshedEvidence = await fetch("/api/evidence");
        if (refreshedEvidence.ok) {
          const evidencePayload = await refreshedEvidence.json();
          setEvidence(evidencePayload.evidence);
          setReviewQuestions(evidencePayload.reviewItems ?? []);
        }
        setMessage("");
        return;
      }
      const openingCommand = message.trim().match(/^(?:set\s+)?opening\s+(?:cash|balance)\s+(?:for\s+)?(\d{4}-\d{2})\s*(?:to|=)?\s*\$?([\d,]+(?:\.\d+)?)$/i);
      if (openingCommand) {
        const response = await fetch("/api/months", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: openingCommand[1], openingCash: openingCommand[2]!.replace(/,/g, "") }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to set opening balance");
        setNotice(`Opening cash set for ${openingCommand[1]}.`);
        setMessage("");
        const refreshed = await fetch("/api/forecast");
        if (refreshed.ok) { const data = await refreshed.json(); setForecast(data.months); }
        return;
      }
      if (!selectedFiles.length && /^(what|how|why|show|explain|forecast|cash|runway)\b/i.test(message.trim())) {
        const question = message.trim();
        const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: question, month: selectedMonth || undefined, ...modelChoice() }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to ask the finance agent");
        const questions = payload.questions?.length ? ` ${payload.questions.join(" ")}` : "";
        const proposals = payload.proposedDecisions?.length ? ` Proposed: ${payload.proposedDecisions.map((proposal: { question: string; answer: string }) => `${proposal.question}: ${proposal.answer}`).join("; ")}` : "";
        setTurns((current) => [...current, { id: crypto.randomUUID(), question, answer: `${payload.answer} ${payload.forecastExplanation ?? ""}${questions}${proposals}`.trim(), model: model === "auto" ? null : model, createdAt: new Date().toISOString() }]);
        setHistory(null);
        if (payload.proposedDecisions?.length) {
          const refreshed = await fetch("/api/decisions");
          if (refreshed.ok) { const data = await refreshed.json(); if (data.decisions) setAgentDecisions(data.decisions); }
        }
        setMessage("");
        return;
      }
      const payloads: { id: string; sourceName: string; extraction: EvidenceItem["extraction"] }[] = [];
      let importedActuals = 0;
      let duplicateActuals = 0;
      if (selectedFiles.length) {
        for (const file of selectedFiles) {
          const looksLikeTransactions = /\.(csv|xlsx|xls|qbo|ofx)$/i.test(file.name) && (/bank|transaction|actual|statement|quickbooks|qbo|ofx/i.test(file.name) || (/\.csv$/i.test(file.name) && /date/i.test(await file.slice(0, 2000).text()) && /amount|debit|credit|value|total/i.test(await file.slice(0, 2000).text())));
          if (looksLikeTransactions) {
            const actualsForm = new FormData(); actualsForm.append("file", file);
            const actualsResponse = await fetch("/api/actuals", { method: "POST", body: actualsForm });
            const actualsPayload = await actualsResponse.json();
            if (!actualsResponse.ok) throw new Error(actualsPayload.error ?? `Unable to import ${file.name}`);
            importedActuals += Number(actualsPayload.imported ?? 0);
            if (actualsPayload.duplicate) duplicateActuals += 1;
            continue;
          }
          const form = new FormData(); form.append("file", file); form.append("model", model); if (effort !== "auto") form.append("effort", effort);
          const response = await fetch("/api/evidence", { method: "POST", body: form });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? `Unable to process ${file.name}`);
          payloads.push({ ...payload, sourceName: file.name });
        }
        if (message.trim()) {
          const response = await fetch("/api/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message.trim(), sourceName: "conversation context", ...modelChoice() }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "Unable to process conversation context");
          payloads.push({ ...payload, sourceName: "conversation context" });
        }
      } else {
        const response = await fetch("/api/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message.trim() || fileText || `Attached evidence: ${files.join(", ")}`, sourceName: files[0] ?? "conversation", ...modelChoice() }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to process evidence");
        payloads.push({ ...payload, sourceName: files[0] ?? "conversation" });
      }
      setNotice(`${payloads.length} evidence source${payloads.length === 1 ? "" : "s"} captured${importedActuals ? `; ${importedActuals} actual transactions imported` : duplicateActuals ? `; ${duplicateActuals} actual file${duplicateActuals === 1 ? "" : "s"} already imported` : ""}.`);
      setEvidence((current) => [...payloads.map((payload) => ({ id: payload.id, sourceName: payload.sourceName, status: "pending", extraction: payload.extraction })), ...current]);
      setMessage("");
      setFiles([]);
      setSelectedFiles([]);
      setFileText("");
      const refreshedEvidence = await fetch("/api/evidence");
      if (refreshedEvidence.ok) {
        const evidencePayload = await refreshedEvidence.json();
        setEvidence(evidencePayload.evidence);
        setReviewQuestions(evidencePayload.reviewItems ?? []);
      }
      if (importedActuals) {
        const refreshed = await fetch("/api/forecast");
        if (refreshed.ok) { const data = await refreshed.json(); setForecast(data.months); }
        const refreshedPnl = await fetch("/api/pnl");
        if (refreshedPnl.ok) { const data = await refreshedPnl.json(); setPnl(data.months); }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to process evidence");
    } finally {
      setIsSubmitting(false);
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
        <AccountMenu company={company.name} user={user} />
      </header>

      <main className="mx-auto grid w-full max-w-[776px] flex-1 content-start gap-10 px-7 pt-6 pb-16">
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
            className="prose-serif min-h-[72px] w-full resize-none bg-transparent text-[19px] leading-[1.45] text-ink outline-none placeholder:text-pencil"
            style={{ fontVariationSettings: '"opsz" 19' }}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setNotice(null);
            }}
            placeholder="Fund II pays us $60k quarterly, or drop a bank statement here"
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
            <button
              className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-paper transition-colors outline-none hover:bg-ink/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:bg-rule disabled:text-pencil"
              type="submit"
              disabled={isSubmitting || (!message.trim() && files.length === 0)}
              aria-label="Send"
            >
              {isSubmitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="size-4" aria-hidden="true" />}
            </button>
          </div>
        </form>
        <div className="-mt-6 grid gap-5">
          {notice && (
            <p className="prose-serif text-[17px] leading-[1.5] text-ink" style={{ fontVariationSettings: '"opsz" 17' }} role="status">
              {notice}
            </p>
          )}
          {turns.length > 0 && (
            <ol className="grid gap-5">
              {turns.map((turn) => (
                <li key={turn.id} className="grid gap-1.5">
                  <p className="text-[13px] text-ink-2">{turn.question}</p>
                  <p className="prose-serif max-w-[62ch] text-[17px] leading-[1.5] text-ink" style={{ fontVariationSettings: '"opsz" 17' }}>{turn.answer}</p>
                </li>
              ))}
            </ol>
          )}
          <div className="flex items-center gap-4">
            <button className={quietButton} type="button" onClick={newChat} disabled={turns.length === 0 && !message && files.length === 0 && !notice}>
              <Plus className="size-3.5" aria-hidden="true" /> New chat
            </button>
            <button className={quietButton} type="button" onClick={openHistory}>
              <History className="size-3.5" aria-hidden="true" /> History
            </button>
          </div>
        </div>

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
              {proposed.map((decision) => (
                <div className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-rule py-3.5" key={decision.id}>
                  <div className="min-w-0">
                    <div>{decision.question}</div>
                    <div className="mt-0.5 text-[13px] text-ink-2">Proposed: {decision.answer}</div>
                  </div>
                  <span className="flex gap-1">
                    <button className={actionButton} type="button" aria-label="Apply proposal" onClick={() => updateAgentDecision(decision.id, "applied")}><Check /></button>
                    <button className={actionButton} type="button" aria-label="Reject proposal" onClick={() => updateAgentDecision(decision.id, "rejected")}><Trash2 /></button>
                  </span>
                </div>
              ))}
              {reviewQuestions.map((item) => (
                <div className="grid gap-0.5 border-b border-rule py-3.5" key={item.id}>
                  <div><span className="mark">{item.question}</span></div>
                  <div className="text-[13px] text-ink-2">
                    Answer above with <span className="text-ink">decision: {item.question} =&gt; your answer</span>
                  </div>
                </div>
              ))}
              {pendingEvidence.slice(0, 4).map((item) => (
                <div className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-rule py-3.5" key={item.id}>
                  <div className="min-w-0">
                    <div>{item.extraction?.summary ?? item.sourceName}</div>
                    <div className="mt-0.5 text-[13px] text-ink-2">
                      {item.sourceName}
                      {item.sourceSize ? ` · ${Math.round(Number(item.sourceSize) / 1024)} KB` : ""}
                      {` · ${item.extraction?.facts.length ?? 0} facts extracted`}
                    </div>
                    {item.sourceExcerpt && (
                      <div className="prose-serif mt-1 truncate text-[14px] text-ink-2" style={{ fontVariationSettings: '"opsz" 14' }}>
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
                    <button className={actionButton} type="button" aria-label="Edit evidence" onClick={() => editItem(item)}><Pencil /></button>
                    <button className={actionButton} type="button" aria-label="Approve evidence" onClick={() => reviewItem(item.id, "approved")}><Check /></button>
                    <button className={actionButton} type="button" aria-label="Reject evidence" onClick={() => reviewItem(item.id, "rejected")}><Trash2 /></button>
                  </span>
                </div>
              ))}
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
        <DialogContent className="max-h-[80vh] overflow-hidden rounded-xl border-rule p-0 sm:max-w-[520px]">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="display text-[22px] font-medium" style={{ fontVariationSettings: '"opsz" 22' }}>History</DialogTitle>
            <DialogDescription>Past questions for {company.name}. Pick one to bring it back.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto px-6 pb-6">
            {history === null ? (
              <p className="border-t border-rule pt-4 text-[13px] text-ink-2">Loading…</p>
            ) : history.length === 0 ? (
              <p className="border-t border-rule pt-4 text-[13px] text-ink-2">No questions yet. Ask one above and it will be kept here.</p>
            ) : (
              <ul className="border-t border-rule">
                {history.map((turn) => (
                  <li key={turn.id}>
                    <button
                      type="button"
                      className="grid w-full grid-cols-[1fr_auto] items-baseline gap-4 border-b border-rule py-3 text-left outline-none hover:bg-rule/60 focus-visible:bg-rule/60"
                      onClick={() => { setTurns([turn]); setHistoryOpen(false); }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{turn.question}</span>
                        {turn.answer && <span className="prose-serif mt-0.5 block truncate text-[13px] text-ink-2">{turn.answer}</span>}
                      </span>
                      <span className="text-[12px] whitespace-nowrap text-pencil">{dateFormatter.format(new Date(turn.createdAt))}, {timeFormatter.format(new Date(turn.createdAt))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className="rounded-xl border-rule sm:max-w-[480px]">
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
