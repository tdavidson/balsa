"use client";

import { ArrowUp, BookOpenText, ChartColumn, Check, ChevronDown, CircleHelp, FileText, LoaderCircle, MessageSquareText, Paperclip, Pencil, Plus, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CompanyRole } from "@finance/auth";
import type { ForecastRunway } from "@nevermodel/finance-engine";
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
import { UsageModal } from "@/components/usage-modal";
import { AccountingModal } from "@/components/accounting-modal";
import { FinancialInspector } from "@/components/financial-inspector";
import { ForecastConsequenceLine } from "@/components/forecast-consequence-line";
import { ForecastWhatChanged } from "@/components/forecast-what-changed";

// Next inlines NEXT_PUBLIC_ variables at build time, so this is a build-time constant.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function monthLabel(month: string, formatter = monthFormatter) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return formatter.format(new Date(`${month}-01T00:00:00Z`));
}

function dateLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function firstDayOfMonth(month: string) {
  return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : "";
}

function lastDayOfMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "";
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).toISOString().slice(0, 10);
}

function accountingValue(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/[$,\s]/g, "");
  const negative = /^\(.*\)$/.test(normalized) || normalized.startsWith("-");
  const parsed = Number(normalized.replace(/[()]/g, ""));
  return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : undefined;
}

function money(amount: number, currency = "$") {
  const formatted = Math.abs(amount).toLocaleString();
  return amount < 0 ? `−${currency}${formatted}` : `${currency}${formatted}`;
}

function journalMoney(amountMinor: string) {
  return money(Number(BigInt(amountMinor)) / 100);
}

function shortFileName(name: string, maxLength = 48) {
  if (name.length <= maxLength) return name;
  const extension = name.match(/\.[^.]+$/)?.[0] ?? "";
  const prefixLength = Math.max(12, maxLength - extension.length - 1);
  return `${name.slice(0, prefixLength)}…${extension}`;
}

type Effort = "auto" | "low" | "medium" | "high";
type WorkbookSheetRole = "historical_statement" | "chart_of_accounts" | "forecast_drivers" | "schedule" | "presentation" | "reference_only" | "exclude";
type WorkbookProposal = { createdAt: string; chartAccountMappings: { worksheet: string; sourceLabel: string; accountType: string; statementSection: string; suggestedAccountName: string; reason: string }[]; historicalCoverage: { worksheet: string; period: string; statement: string; reason: string }[]; forecastDrivers: { worksheet: string; driver: string; unit: string; rationale: string }[]; questions: string[] };
const efforts: { value: Effort; label: string }[] = [
  { value: "auto", label: "Auto effort" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const accountingRoleOptions = ["transaction", "opening_balance", "ending_balance", "transfer", "investment_movement", "revenue", "expense", "financing", "summary", "agreement", "unknown"] as const;
const workbookSheetRoleLabels: Record<WorkbookSheetRole, string> = {
  historical_statement: "Historical statements",
  chart_of_accounts: "Chart of accounts",
  forecast_drivers: "Forecast drivers",
  schedule: "Supporting schedule",
  presentation: "Presentation / dashboard",
  reference_only: "Reference only",
  exclude: "Exclude",
};

function suggestedWorkbookSheetRole(name: string, sampleLabels: string[]): WorkbookSheetRole {
  const content = `${name} ${sampleLabels.join(" ")}`.toLowerCase();
  if (/chart\s*(of)?\s*accounts|\bcoa\b|account\s*(list|map)/.test(content)) return "chart_of_accounts";
  if (/assumption|driver|input|forecast|budget|scenario|plan/.test(content)) return "forecast_drivers";
  if (/schedule|headcount|payroll|debt|capex|fixed\s*asset|revenue\s*detail|working\s*capital/.test(content)) return "schedule";
  if (/income\s*statement|profit\s*(and|&)\s*loss|\bp\s*&\s*l\b|balance\s*sheet|cash\s*flow|historical|actual/.test(content)) return "historical_statement";
  if (/dashboard|cover|summary|output|presentation|board/.test(content)) return "presentation";
  return "reference_only";
}
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

function processingChanges(runs: EvidenceItem["ingestionRuns"] | undefined) {
  const latest = [...(runs ?? [])].reverse().find((run) => run.stage === "review" && run.metadata.includes('"changes"'));
  if (!latest) return null;
  try { return JSON.parse(latest.metadata) as { changes?: { added: { label: string; value: string }[]; removed: { label: string; value: string }[]; changed: { label: string; before: string; after: string }[] }; reconciliation?: string; forecast?: string }; } catch { return null; }
}

/** Human-readable, source-level result of a durable intake stage. */
function processingRunDetail(run: NonNullable<EvidenceItem["ingestionRuns"]>[number]) {
  try {
    const metadata = JSON.parse(run.metadata) as Record<string, unknown>;
    const count = (key: string) => typeof metadata[key] === "number" ? metadata[key] : undefined;
    if (run.stage === "storage") return metadata.storageReference ? "Original retained" : undefined;
    if (run.stage === "classification") return count("transactions") !== undefined ? `${count("transactions")} transactions identified` : undefined;
    if (run.stage === "extraction") return [count("facts") !== undefined ? `${count("facts")} facts` : undefined, count("questions") !== undefined ? `${count("questions")} source questions` : undefined].filter(Boolean).join(" · ") || undefined;
    if (run.stage === "validation") return [count("months") !== undefined ? `${count("months")} months checked` : undefined, count("exceptions") !== undefined ? `${count("exceptions")} exceptions` : undefined].filter(Boolean).join(" · ") || undefined;
    if (run.stage === "matching") return [count("matched") !== undefined ? `${count("matched")} matched` : undefined, count("unmatched") !== undefined ? `${count("unmatched")} unmatched` : undefined].filter(Boolean).join(" · ") || undefined;
    if (run.stage === "grouped_review") return count("questions") !== undefined ? `${count("questions")} CFO questions prepared` : undefined;
    if (run.stage === "reconciliation") return [count("months") !== undefined ? `${count("months")} months reconciled` : undefined, count("exceptions") !== undefined ? `${count("exceptions")} exceptions` : undefined].filter(Boolean).join(" · ") || undefined;
  } catch { /* An older run can have non-JSON metadata. */ }
  return undefined;
}

function readableProcessingError(error: string | null | undefined) {
  if (!error) return "Extraction failed";
  if (/statementPeriod(?:Start|End)/.test(error) && /invalid_(?:format|string)|must match pattern/.test(error)) return "The model returned an invalid statement date. Retry extraction.";
  if (/\[\s*\{|ZodError|invalid_(?:format|type)|must match pattern/.test(error)) return "The model returned data in an unexpected format. Retry extraction.";
  return error.length > 240 ? `${error.slice(0, 237)}…` : error;
}

function processingStatusLabel(status: string) {
  if (status === "waiting") return "Queued";
  if (status === "running") return "In progress";
  if (status === "interrupted") return "Interrupted";
  return status;
}

function ingestionStatusLabel(item: EvidenceItem) {
  const status = item.ingestionStatus ?? item.status;
  const latestExtraction = [...(item.ingestionRuns ?? [])]
    .filter((run) => run.stage === "extraction")
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  if (latestExtraction?.status === "interrupted") return "Extraction interrupted";
  if (status === "extracting" && latestExtraction?.status === "waiting") return "Queued for extraction";
  if (status === "extracting") return "Extracting facts and evidence";
  if (status === "stored") return "Stored; waiting for extraction";
  if (status === "reconciling") return "Checking against other sources";
  if (status === "review") return "Ready for review";
  if (status === "reconciled") return "Reconciled";
  if (status === "failed") return "Processing failed";
  if (status === "interrupted") return "Processing interrupted";
  return status;
}

type ProcessingStage = { key: string; label: string; status: "waiting" | "running" | "succeeded" | "failed" | "interrupted"; detail?: string };

function aggregateProcessingTimeline(items: EvidenceItem[]) {
  const labels = [
    ["identify", "Classify sources"],
    ["extract", "Extract facts and provenance"],
    ["validate", "Validate balances"],
    ["match", "Match transactions"],
    ["review", "Prepare grouped review"],
  ] as const;
  const timelines = items.map(processingTimeline);
  return labels.map(([key, label]) => {
    const statuses = timelines.map((timeline) => timeline.find((stage) => stage.key === key)?.status ?? "waiting");
    const status: ProcessingStage["status"] = statuses.includes("failed")
      ? "failed"
      : statuses.includes("interrupted")
        ? "interrupted"
      : statuses.includes("running")
        ? "running"
        : statuses.length > 0 && statuses.every((value) => value === "succeeded")
          ? "succeeded"
          : "waiting";
    return { key, label, status };
  });
}

/** Converts durable run records into the fixed workflow a CFO expects to see. */
function processingTimeline(item: EvidenceItem): ProcessingStage[] {
  const latest = (stages: string[]) => [...(item.ingestionRuns ?? [])].filter((run) => stages.includes(run.stage)).sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const stage = (key: string, label: string, stages: string[], fallback: ProcessingStage["status"], detail?: string): ProcessingStage => {
    const run = latest(stages);
    const resolvedDetail = run ? processingRunDetail(run) ?? (run.error ? readableProcessingError(run.error) : undefined) : detail;
    return { key, label, status: run?.status as ProcessingStage["status"] ?? fallback, ...(resolvedDetail ? { detail: resolvedDetail } : {}) };
  };
  const classification = item.sourceMetadata?.classification;
  const extracted = Boolean(item.extraction);
  return [
    stage("identify", "Identify source", ["classification"], classification ? "succeeded" : "waiting", classification ? `${classification.kind.replace(/_/g, " ")} · ${classification.confidence} confidence` : undefined),
    stage("extract", "Extract evidence", ["extraction"], extracted ? "succeeded" : "waiting", extracted ? `${item.extraction?.facts.length ?? 0} facts · ${item.extraction?.questions.length ?? 0} questions` : undefined),
    stage("validate", "Validate balances", ["validation"], extracted ? "waiting" : "waiting"),
    stage("match", "Cross-check sources", ["matching", "reconciliation"], extracted ? "waiting" : "waiting"),
    stage("review", "Prepare review", ["grouped_review", "review"], item.status === "approved" ? "succeeded" : extracted ? "waiting" : "waiting"),
  ];
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^\)]+\)|\*[^*]+\*|_[^_]+_)/g).filter(Boolean);
  return tokens.map((token, index) => {
    if (/^\*\*.*\*\*$|^__.*__$/.test(token)) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (/^`.*`$/.test(token)) return <code key={index} className="rounded bg-rule px-1 py-0.5 font-mono text-[0.85em]">{token.slice(1, -1)}</code>;
    const link = token.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
    if (link) {
      const href = link[2]?.trim();
      if (href && /^(https?:|mailto:)/i.test(href)) return <a key={index} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{link[1]}</a>;
      return <span key={index}>{link[1]}</span>;
    }
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
  if (context.needsInputCount > 0) return "Start with something that needs your input";
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
  company: { id: string; name: string; currency: string };
  companies: { id: string; name: string; baseCurrency: string; role: CompanyRole }[];
  /** The signed-in user's role in the active company, passed straight through to the account menu. */
  role: CompanyRole;
  staleSelection: boolean;
  user: { email: string; name: string | null; hasAvatar?: boolean };
  modelOptions: { value: string; label: string }[];
  loginEnabled: boolean;
};

type EvidenceItem = {
  id: string;
  sourceName: string;
  sourceMime?: string | null;
  sourceSize?: string | null;
  sourceHash?: string | null;
  currency?: string | null;
  reportingMonth?: string | null;
  accountHolder?: string | null;
  accountIdentifier?: string | null;
  statementPeriodStart?: string | null;
  statementPeriodEnd?: string | null;
  sourceMetadata?: {
    sourceRole?: "reference_model";
    classification?: { kind: string; confidence: "high" | "medium" | "low"; containsTransactions?: boolean; containsBalances?: boolean; containsSummaries?: boolean };
    pdfQuality?: { status: "good" | "weak" | "empty"; pageCount: number; nonEmptyPages: number; characters: number; warnings: string[] };
    workbook?: {
      worksheetCount: number;
      definedNames: string[];
      worksheets: { name: string; rows: number; columns: number; formulas: number; sampleLabels: string[] }[];
    };
    workbookReview?: Record<string, WorkbookSheetRole>;
    workbookProposal?: WorkbookProposal;
    workbookProposalReview?: Record<string, "approved" | "rejected">;
    workbookProposalApplication?: Record<string, string>;
  };
  storageReference?: string | null;
  ingestionStatus?: string | null;
  ingestionError?: string | null;
  processedAt?: string | null;
  sourceExcerpt?: string;
  createdAt?: string;
  status: string;
  identityStatus: string;
  extraction: { summary: string; facts: { label: string; value: string; accountingRole?: string; confidence: number; factId?: string; factStatus?: string; sourceLocation?: string | null; currency?: string | null }[]; questions: string[] } | null;
  ingestionRuns?: { id: string; stage: string; status: string; error?: string | null; startedAt: string; completedAt?: string | null; metadata: string }[];
  approvals?: { id: string; factId?: string | null; layer: string; action: string; previousValue?: string | null; nextValue?: string | null; createdAt: string; userName?: string | null; userEmail?: string | null }[];
};
type ChatEvidence = {
  id?: string;
  sourceName: string;
  summary?: string | undefined;
  facts: { label: string; value: string; confidence: number }[];
  questions: string[];
};
type ReviewQuestion = { id: string; reviewKey?: string | null; evidenceId?: string | null; question: string; answer?: string | null; status: string };
type AgentDecision = { id: string; question: string; answer: string; status: "proposed" | "applied" | "rejected"; effectSummary?: string | null };
type ProposedItem = { id: string; type: "agreement" | "obligation"; label: string; counterparty?: string | null; counterpartyName?: string | null; direction: "receipt" | "spend"; amount: number | null; cadence?: string | null; effectiveFrom?: string | null; effectiveTo?: string | null; category?: string | null; basis: string; accountingTreatment: string; confidence?: number | null; rationale?: string | null; status: "draft" | "confirmed" | "rejected"; sourceName?: string | null };
type BalanceSheetView = { month: string; hasOpening: boolean; balances: Record<string, number>; cashByAccount: { accountId: string | null; name: string; balance: number }[]; assets: number; liabilities: number; equity: number; check: number; balanced: boolean };
type CashFlowView = { month: string; netIncome: number; eliminations: number; changes: Record<string, number>; operatingIndirect: number; operating: number; investing: number; financing: number; transfers: number; adjustments: number; netChange: number; openingCash?: number; endingCash?: number; ties: boolean };
type EntityStructureView = { legalEntities: { id: string; name: string; consolidated: boolean }[]; accounts: { id: string; name: string; ownerEntityId: string | null }[] };
type JournalStatementView = { balanceSheet: { assets: LineItem[]; liabilities: LineItem[]; equity: LineItem[]; retainedEarningsMinor: string; totalAssetsMinor: string; totalLiabilitiesAndEquityMinor: string; differenceMinor: string; balanced: boolean } };
type LineItem = { key: string; label: string; amountMinor: string };
type ForecastMonth = { month: string; receipts: number; spending: number; endingCash: number; hasCashBalance?: boolean; openingCash?: number; actualReceipts: number; actualSpending: number; actualNet?: number; variance?: number; contractualReceipts?: number; contractualSpending?: number; assumedReceipts?: number; assumedSpending?: number; outstanding?: { receivables: { label: string; month: string; amount: number }[]; payables: { label: string; month: string; amount: number }[] }; intercompany?: { entityId: string; name?: string; balance: number }[]; status?: "open" | "closed" | "history"; balanceSheet?: BalanceSheetView; cashFlow?: CashFlowView; journalStatement?: JournalStatementView | null; calculation?: { id: string; kind: "source_line" | "opening_position" | "ending_cash" | "operating_income" | "balance_sheet_check" | "cash_rollforward_check" | "transfer_revenue_check" | "statement_cash_check" | "month_continuity_check" | "duplicate_source_check" | "transfer_pairing_check" | "allocation_total_check" | "intercompany_elimination_check"; label: string; formula: string; value: number | boolean; inputNodeIds: string[]; lineIds: string[]; verification: { status: "verified" | "provisional" | "unverified" | "exception"; reasons: string[] } }[]; trace?: { description: string; evidenceId: string | null; sourceName?: string | null; amount?: number; kind?: "receipt" | "spend"; actual?: boolean; basis?: string | null }[] };
type ReconciliationMonth = { month: string; status: "reconciled" | "exception"; opening?: number; ending?: number; receipts: number; spending: number; net: number; expectedEnding?: number; difference?: number; transactionCount: number; duplicateCount: number; duplicateGroups?: { key: string; transactionIds: string[]; sources: string[]; amount: number; direction: string; date: string | null; descriptions: string[] }[]; transferGroups?: { key: string; transactionIds: string[]; sources: string[]; amount: number; direction: string; date: string | null; descriptions: string[] }[]; bookMatchGroups?: { key: string; transactionIds: string[]; sources: string[]; amount: number; direction: string; date: string | null; descriptions: string[] }[]; reviewQuestions?: { kind: string; question: string; evidence: string[] }[]; sourceNames: string[]; pendingSources: string[]; stagedTransactionCount?: number; stagedSourceNames?: string[]; stagedTransactions?: { id: string; date: string | null; description: string; amount: number; direction: "receipt" | "spend"; category: string; sourceName: string; sourceLocation?: string | null }[]; revenueComparison?: { reported: number; cashReceived: number; sources: string[] }; bookBalanceComparison?: { statementBalance: number; bookBalance: number; difference: number; statementSources: string[]; bookSources: string[] }; exceptions: string[]; transactions: { id: string; date: string | null; description: string; amount: number; direction: "receipt" | "spend"; category: string; sourceName: string; sourceLocation?: string | null }[] };
type ReconciliationLedgerSummary = { total: number; byKind: Record<string, number> };
type CalculationTraceNode = { id: string; nodeKey: string; kind: string; month: string; label: string; formula: string; value: number | boolean | null; inputNodeIds: string[]; lineIds: string[]; provenance: { evidenceId?: string; sourceId?: string; sourceName?: string; sourceLocation?: string; factId?: string; accountId?: string; period?: string }[]; verificationStatus: "verified" | "provisional" | "unverified" | "exception"; verificationReasons: string[] };
type CalculationRunView = { id: string; engineVersion: string; asOfMonth: string; horizonStart: string; horizonEnd: string; verificationStatus: string; createdAt: string; financialStateRevision: string; isCurrentFormula?: boolean; isCurrentState?: boolean };
type PnlMonth = { month: string; revenue: number; expenses: number; operatingIncome: number; byCategory: Record<string, number>; revenueByCategory: Record<string, number>; allocatedOut?: number; uncategorized?: number; trace?: { description?: string; amount: number; direction: "receipt" | "spend"; category: string; kind?: string; basis?: string | null }[] };
type JournalDashboardMonth = { month: string; status: "history" | "open"; verification: string; basis: "actual" | "forecast" | "scenario"; forecast: { openingCash: number; endingCash: number; receipts: number; spending: number; net: number; actualReceipts: number; actualSpending: number; actualNet: number; hasCashBalance: boolean; cashFlow: { operating: number; investing: number; financing: number; netChange: number; openingCash: number; endingCash: number; ties: boolean } }; pnl: PnlMonth; balanceSheet: { assets: number; liabilities: number; equity: number; retainedEarnings: number; check: number; balanced: boolean; balances: Record<string, number> }; statements: JournalStatementView | null };
type PeriodPreset = "month" | "quarter" | "ytd" | "last12" | "year" | "custom";
type StatementCadence = "monthly" | "quarterly" | "annual";

function cadenceKey(month: string, cadence: StatementCadence) {
  if (cadence === "monthly") return month;
  if (cadence === "annual") return month.slice(0, 4);
  return `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;
}

function cadenceLabel(key: string, cadence: StatementCadence) {
  if (cadence === "monthly") return monthLabel(key);
  return key;
}

function aggregateForecastRows(rows: ForecastMonth[], cadence: StatementCadence) {
  const groups = new Map<string, ForecastMonth[]>();
  for (const row of rows) {
    const key = cadenceKey(row.month, cadence);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, entries]) => {
    const first = entries[0]!;
    const last = entries.at(-1)!;
    return {
      ...last,
      month: key,
      endMonth: last.month,
      openingCash: first.openingCash,
      receipts: entries.reduce((sum, row) => sum + row.receipts, 0),
      spending: entries.reduce((sum, row) => sum + row.spending, 0),
      actualReceipts: entries.reduce((sum, row) => sum + row.actualReceipts, 0),
      actualSpending: entries.reduce((sum, row) => sum + row.actualSpending, 0),
    };
  });
}

function aggregatePnlRows(rows: PnlMonth[], cadence: StatementCadence) {
  const groups = new Map<string, PnlMonth[]>();
  for (const row of rows) {
    const key = cadenceKey(row.month, cadence);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, entries]) => ({
    month: key,
    revenue: entries.reduce((sum, row) => sum + row.revenue, 0),
    expenses: entries.reduce((sum, row) => sum + row.expenses, 0),
    operatingIncome: entries.reduce((sum, row) => sum + row.operatingIncome, 0),
  }));
}

export function AppShell({ company, companies, role, staleSelection, user, modelOptions, loginEnabled }: AppShellProps) {
  const [message, setMessage] = useState("");
  const [composerPlaceholder, setComposerPlaceholder] = useState("Tell me what needs attention");
  const [model, chooseModel] = useStoredChoice("nevermodel.model", "auto", (value) => modelOptions.some((option) => option.value === value));
  const [storedEffort, chooseEffort] = useStoredChoice("nevermodel.effort", "auto", (value) => efforts.some((option) => option.value === value));
  const effort = storedEffort as Effort;
  const [activeThreadId, setActiveThreadId] = useState("main");
  const [threads, setThreads] = useState<Record<string, ConversationTurn[]>>({ main: [] });
  const [usageOpen, setUsageOpen] = useState(false);
  const [accountingOpen, setAccountingOpen] = useState(false);
  const [calculationTraceOpen, setCalculationTraceOpen] = useState(false);
  const [calculationRun, setCalculationRun] = useState<CalculationRunView | null>(null);
  const [calculationRunHistory, setCalculationRunHistory] = useState<CalculationRunView[]>([]);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [calculationNodes, setCalculationNodes] = useState<CalculationTraceNode[]>([]);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [reprocessingEvidenceId, setReprocessingEvidenceId] = useState<string | null>(null);
  const locallyRunningExtractionIds = useRef(new Set<string>());
  const [savingWorkbookReviewId, setSavingWorkbookReviewId] = useState<string | null>(null);
  const [draftingWorkbookProposalId, setDraftingWorkbookProposalId] = useState<string | null>(null);
  const [reviewingWorkbookProposalKey, setReviewingWorkbookProposalKey] = useState<string | null>(null);
  const [applyingWorkbookProposalKey, setApplyingWorkbookProposalKey] = useState<string | null>(null);
  const [batchApprovalEvidenceId, setBatchApprovalEvidenceId] = useState<string | null>(null);
  const [treatmentDrafts, setTreatmentDrafts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadSourceRole, setUploadSourceRole] = useState<"standard" | "reference_model">("standard");
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [activeReviewQuestionId, setActiveReviewQuestionId] = useState<string | null>(null);
  const [activeReviewQuestion, setActiveReviewQuestion] = useState<ReviewQuestion | null>(null);
  const [activeDecision, setActiveDecision] = useState<AgentDecision | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [reviewQuestions, setReviewQuestions] = useState<ReviewQuestion[]>([]);
  const [agentDecisions, setAgentDecisions] = useState<AgentDecision[]>([]);
  const [proposedItems, setProposedItems] = useState<ProposedItem[]>([]);
  const [entityStructure, setEntityStructure] = useState<EntityStructureView>({ legalEntities: [], accounts: [] });
  const [selectedEntity, setSelectedEntity] = useState<string>("consolidated");
  const entityQuery = selectedEntity === "consolidated" ? "" : `?entity=${selectedEntity}`;
  const [forecast, setForecast] = useState<ForecastMonth[]>([]);
  const [runway, setRunway] = useState<(ForecastRunway & { revision: string; horizonEnd: string; stale: boolean; exceptions: number }) | null>(null);
  const [calculationBasis, setCalculationBasis] = useState<"persisted" | "live_preview">("live_preview");
  const [reconciliation, setReconciliation] = useState<ReconciliationMonth[]>([]);
  const [reconciliationLedger, setReconciliationLedger] = useState<ReconciliationLedgerSummary | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [pnl, setPnl] = useState<PnlMonth[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("month");
  const [statementCadence, setStatementCadence] = useState<StatementCadence>("monthly");
  const [statementTab, setStatementTab] = useState<"income" | "cash" | "balance">("income");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  /** The one place that applies a /api/journal-financials payload, so every caller keeps forecast, P&L, and runway in sync — none can update one without the other. */
  const applyJournalDashboard = (payload: { months?: JournalDashboardMonth[]; runway?: (ForecastRunway & { revision: string; horizonEnd: string; stale: boolean; exceptions: number }) | null } | null) => {
    const rows = payload?.months;
    if (rows) {
      setForecast(rows.map((row) => ({ month: row.month, status: row.status, openingCash: row.forecast.openingCash, endingCash: row.forecast.endingCash, hasCashBalance: row.forecast.hasCashBalance, receipts: row.forecast.receipts, spending: row.forecast.spending, actualReceipts: row.forecast.actualReceipts, actualSpending: row.forecast.actualSpending, actualNet: row.forecast.actualNet, contractualReceipts: row.basis === "forecast" ? row.forecast.receipts : 0, contractualSpending: row.basis === "forecast" ? row.forecast.spending : 0, assumedReceipts: row.basis === "scenario" ? row.forecast.receipts : 0, assumedSpending: row.basis === "scenario" ? row.forecast.spending : 0, variance: 0, journalStatement: row.statements, balanceSheet: { month: row.month, hasOpening: true, balances: row.balanceSheet.balances, cashByAccount: [], assets: row.balanceSheet.assets, liabilities: row.balanceSheet.liabilities, equity: row.balanceSheet.equity + row.balanceSheet.retainedEarnings, check: row.balanceSheet.check, balanced: row.balanceSheet.balanced }, cashFlow: { month: row.month, netIncome: row.pnl.operatingIncome, eliminations: 0, changes: {}, operatingIndirect: row.forecast.cashFlow.operating, operating: row.forecast.cashFlow.operating, investing: row.forecast.cashFlow.investing, financing: row.forecast.cashFlow.financing, transfers: 0, adjustments: 0, netChange: row.forecast.cashFlow.netChange, openingCash: row.forecast.cashFlow.openingCash, endingCash: row.forecast.cashFlow.endingCash, ties: row.forecast.cashFlow.ties } })));
      setPnl(rows.map((row) => ({ ...row.pnl, month: row.month })));
      setCalculationBasis("live_preview");
    }
    setRunway(payload?.runway ?? null);
  };
  const selectPeriodPreset = (value: string) => {
    const next = value as PeriodPreset;
    setPeriodPreset(next);
    if (next === "custom") {
      setCustomStart((current) => current || firstDayOfMonth(rangeEnd.slice(0, 7) || selectedMonth));
      setCustomEnd((current) => current || rangeEnd || lastDayOfMonth(selectedMonth));
    }
  };
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
  const effectiveRangeEnd = rangeEnd || lastDayOfMonth(selectedMonth);
  const anchorMonth = effectiveRangeEnd.slice(0, 7) || selectedMonth;
  const anchorDate = anchorMonth ? new Date(`${anchorMonth}-01T00:00:00Z`) : null;
  const anchorYear = anchorDate?.getUTCFullYear();
  const anchorMonthNumber = anchorDate ? anchorDate.getUTCMonth() + 1 : 1;
  const periodStart = periodPreset === "custom" ? (customStart || firstDayOfMonth(anchorMonth)) : periodPreset === "ytd" ? `${anchorYear}-01-01` : periodPreset === "year" ? `${anchorYear}-01-01` : periodPreset === "last12" ? firstDayOfMonth(new Date(Date.UTC(anchorYear!, anchorMonthNumber! - 12, 1)).toISOString().slice(0, 7)) : periodPreset === "quarter" ? `${anchorYear}-${String(Math.floor((anchorMonthNumber - 1) / 3) * 3 + 1).padStart(2, "0")}-01` : firstDayOfMonth(anchorMonth);
  const periodEnd = periodPreset === "custom" ? (customEnd || effectiveRangeEnd) : periodPreset === "year" ? `${anchorYear}-12-31` : effectiveRangeEnd;
  const periodStartMonth = periodStart.slice(0, 7);
  const periodEndMonth = periodEnd.slice(0, 7);
  const customRangeIsValid = periodPreset !== "custom" || !periodStart || !periodEnd || periodStart <= periodEnd;
  const periodForecastRows = customRangeIsValid ? forecast.filter((month) => month.month >= periodStartMonth && month.month <= periodEndMonth) : [];
  const periodPnlRows = customRangeIsValid ? pnl.filter((month) => month.month >= periodStartMonth && month.month <= periodEndMonth) : [];
  const lastForecast = periodForecastRows.at(-1);
  const sumRows = (pick: (row: ForecastMonth) => number | undefined) => periodForecastRows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
  const currentForecast = lastForecast ? { ...lastForecast, openingCash: periodForecastRows[0]?.openingCash, receipts: sumRows((row) => row.receipts), spending: sumRows((row) => row.spending), actualReceipts: sumRows((row) => row.actualReceipts), actualSpending: sumRows((row) => row.actualSpending), variance: sumRows((row) => row.variance), contractualReceipts: sumRows((row) => row.contractualReceipts), contractualSpending: sumRows((row) => row.contractualSpending), assumedReceipts: sumRows((row) => row.assumedReceipts), assumedSpending: sumRows((row) => row.assumedSpending), trace: periodForecastRows.flatMap((row) => row.trace ?? []) } : undefined;
  const endingCashCalculation = currentForecast?.calculation?.find((node) => node.kind === "ending_cash");
  const calculationChecks = currentForecast?.calculation?.filter((node) => node.kind.endsWith("_check")) ?? [];
  const periodJournalStatement = lastForecast?.journalStatement;
  const periodJournalAssets = periodJournalStatement ? Number(BigInt(periodJournalStatement.balanceSheet.totalAssetsMinor)) / 100 : undefined;
  const periodCashFlow = periodForecastRows.length ? periodForecastRows.reduce<CashFlowView | undefined>((total, row) => {
    if (!row.cashFlow) return total;
    if (!total) return { ...row.cashFlow, changes: { ...row.cashFlow.changes } };
    const changes = Object.fromEntries(Object.keys(total.changes).map((key) => [key, (total.changes[key] ?? 0) + (row.cashFlow!.changes[key] ?? 0)]));
    return { ...total, netIncome: total.netIncome + row.cashFlow.netIncome, eliminations: total.eliminations + row.cashFlow.eliminations, changes, operatingIndirect: total.operatingIndirect + row.cashFlow.operatingIndirect, operating: total.operating + row.cashFlow.operating, investing: total.investing + row.cashFlow.investing, financing: total.financing + row.cashFlow.financing, transfers: total.transfers + row.cashFlow.transfers, adjustments: total.adjustments + row.cashFlow.adjustments, netChange: total.netChange + row.cashFlow.netChange, ...(row.cashFlow.endingCash !== undefined ? { endingCash: row.cashFlow.endingCash } : {}), ties: total.ties && row.cashFlow.ties };
  }, undefined) : undefined;
  const ledgerLabel = (ledger: string) => ledger.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  const currentPnl = periodPnlRows.length ? { month: periodPnlRows[0]!.month, allocatedOut: periodPnlRows.reduce((sum, row) => sum + (row.allocatedOut ?? 0), 0), uncategorized: periodPnlRows.reduce((sum, row) => sum + (row.uncategorized ?? 0), 0), revenue: periodPnlRows.reduce((sum, row) => sum + row.revenue, 0), expenses: periodPnlRows.reduce((sum, row) => sum + row.expenses, 0), operatingIncome: periodPnlRows.reduce((sum, row) => sum + row.operatingIncome, 0), byCategory: periodPnlRows.reduce<Record<string, number>>((totals, row) => { for (const [category, amount] of Object.entries(row.byCategory)) totals[category] = (totals[category] ?? 0) + amount; return totals; }, {}), revenueByCategory: periodPnlRows.reduce<Record<string, number>>((totals, row) => { for (const [category, amount] of Object.entries(row.revenueByCategory)) totals[category] = (totals[category] ?? 0) + amount; return totals; }, {}), trace: periodPnlRows.flatMap((row) => row.trace ?? []) } : undefined;
  const displayedForecastRows = aggregateForecastRows(periodForecastRows, statementCadence);
  const displayedPnlRows = aggregatePnlRows(periodPnlRows, statementCadence);
  const approvedBalanceSheet = evidence.filter((item) => item.status === "approved" && item.identityStatus === "approved" && item.sourceMetadata?.classification?.kind === "balance_sheet" && item.extraction && (item.reportingMonth ?? item.statementPeriodEnd?.slice(0, 7) ?? "") <= periodEndMonth).sort((a, b) => (a.reportingMonth ?? a.statementPeriodEnd ?? "").localeCompare(b.reportingMonth ?? b.statementPeriodEnd ?? "")).at(-1);
  const balanceFacts = approvedBalanceSheet?.extraction?.facts.filter((fact) => fact.factStatus === "approved" || fact.factStatus === "treatment_approved") ?? [];
  const balanceFact = (pattern: RegExp) => accountingValue(balanceFacts.find((fact) => pattern.test(fact.label))?.value);
  const reportedCash = balanceFact(/^(?:cash(?: and cash equivalents)?|total cash)\b/i);
  const totalAssets = balanceFact(/^total assets\b/i) ?? reportedCash;
  const totalLiabilities = balanceFact(/^total liabilities\b/i);
  const reportedEquity = balanceFact(/^(?:total )?(?:shareholders?|stockholders?|members?)['’]? equity\b/i);
  const shareholdersEquity = reportedEquity ?? (totalAssets !== undefined && totalLiabilities !== undefined ? totalAssets - totalLiabilities : undefined);
  const periodLabel = periodPreset === "quarter" ? `Quarter ending ${dateLabel(periodEnd)}` : periodPreset === "ytd" ? `YTD through ${dateLabel(periodEnd)}` : periodPreset === "last12" ? `Last 12 months through ${dateLabel(periodEnd)}` : periodPreset === "year" ? `${anchorYear}` : periodPreset === "custom" ? `${dateLabel(periodStart)} – ${dateLabel(periodEnd)}` : `Month ending ${dateLabel(periodEnd)}`;
  const pendingEvidence = evidence.filter((item) => item.identityStatus !== "rejected" && (item.status !== "approved" || item.extraction?.facts.some((fact) => fact.factStatus !== "treatment_approved")));
  const processingEvidence = evidence.filter((item) => ["stored", "extracting", "reconciling", "processing"].includes(item.ingestionStatus ?? ""));
  const failedEvidence = evidence.filter((item) => item.ingestionStatus === "failed");
  const processingStages = aggregateProcessingTimeline(evidence);
  const hasFinancialOutput = Boolean(currentForecast && (
    currentForecast.hasCashBalance !== false
    || (currentForecast.trace?.length ?? 0) > 0
    || currentForecast.receipts !== 0
    || currentForecast.spending !== 0
    || currentForecast.actualReceipts !== 0
    || currentForecast.actualSpending !== 0
  ));
  const discoveredAccounts = [...evidence.reduce<Map<string, { holder: string | null | undefined; identifier: string | null | undefined; currency: string | null | undefined }>>((accounts, item) => {
    if (item.accountIdentifier || item.accountHolder) accounts.set(`${item.accountHolder ?? ""}|${item.accountIdentifier ?? ""}`, { holder: item.accountHolder, identifier: item.accountIdentifier, currency: item.currency });
    return accounts;
  }, new Map()).values()];
  const coveredMonths = [...new Set(evidence.map((item) => item.reportingMonth ?? item.statementPeriodEnd?.slice(0, 7)).filter((month): month is string => Boolean(month)))].sort();
  const draftItems = proposedItems.filter((item) => item.status === "draft");
  const needsInputCount = pendingEvidence.length + reviewQuestions.length + agentDecisions.filter((decision) => decision.status === "proposed").length + draftItems.length;
  useEffect(() => {
    const updatePlaceholder = () => setComposerPlaceholder(composerCallToAction(new Date(), { needsInputCount, hasConversation: turns.length > 0, hasFiles: files.length > 0 }));
    updatePlaceholder();
    const timer = window.setInterval(updatePlaceholder, 60_000);
    return () => window.clearInterval(timer);
  }, [files.length, needsInputCount, turns.length]);
  useEffect(() => {
    async function loadConversations() {
      const response = await fetch("/api/conversations");
      if (!response.ok) return;
      const payload = await readJson(response) as { turns?: ConversationTurn[] };
      if (!payload.turns?.length) return;
      const restored = payload.turns.reduce<Record<string, ConversationTurn[]>>((grouped, turn) => {
        const threadId = turn.threadId || "main";
        grouped[threadId] = [...(grouped[threadId] ?? []), turn];
        return grouped;
      }, {});
      setThreads(restored);
      setActiveThreadId(Object.keys(restored).at(-1) ?? "main");
    }
    loadConversations().catch(() => undefined);
  }, [company.id]);
  useEffect(() => {
    async function loadEvidence() {
      const response = await fetch("/api/evidence");
      if (!response.ok) return;
      const payload = await readJson(response);
      if (payload.evidence) {
        setEvidence(payload.evidence);
        setReviewQuestions(uniqueById(payload.reviewItems ?? []));
      }
    }
    loadEvidence().catch(() => undefined);
  }, []);

  const loadCalculationTrace = (runId?: string) => {
    const query = new URLSearchParams();
    if (runId) query.set("runId", runId); else if (selectedMonth) query.set("period", selectedMonth);
    fetch(`/api/calculations${query.size ? `?${query.toString()}` : ""}`).then((response) => response.ok ? response.json() : null).then((payload) => {
      setCalculationRun(payload?.run ?? null);
      setCalculationRunHistory(payload?.runs ?? []);
      setCalculationNodes(payload?.nodes ?? []);
    }).catch(() => undefined);
  };
  const recalculateBaseCase = async () => {
    setIsRecalculating(true);
    try {
      const response = await fetch(`/api/calculations${selectedMonth ? `?period=${encodeURIComponent(selectedMonth)}` : ""}`, { method: "POST" });
      if (!response.ok) throw new Error("Calculation failed");
      await loadCalculationTrace();
    } catch {
      setNotice("Unable to recalculate the base case. Please try again.");
    } finally {
      setIsRecalculating(false);
    }
  };
  useEffect(() => {
    if (!calculationTraceOpen) return;
    loadCalculationTrace();
    // Fetch only when the dialog opens; selecting history is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculationTraceOpen]);

  // A hosted deployment also drains these durable jobs through its scheduler.
  // On localhost there may be no scheduler, so the open browser safely runs a
  // small queue through the same authenticated reprocessing endpoint. The
  // durable waiting record remains the source of truth across reloads.
  useEffect(() => {
    const queued = evidence.filter((item) => {
      const latestExtraction = [...(item.ingestionRuns ?? [])]
        .filter((run) => run.stage === "extraction")
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
      return latestExtraction?.status === "waiting" && !locallyRunningExtractionIds.current.has(item.id);
    });
    const availableSlots = Math.max(0, 2 - locallyRunningExtractionIds.current.size);
    for (const item of queued.slice(0, availableSlots)) {
      locallyRunningExtractionIds.current.add(item.id);
      void fetch(`/api/evidence/${item.id}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modelChoice()),
      }).then(async (response) => {
        if (response.ok) return;
        const payload = await readJson(response);
        setNotice(payload.error ?? `Unable to extract ${shortFileName(item.sourceName)}.`);
      }).catch(() => {
        setNotice(`Unable to extract ${shortFileName(item.sourceName)}.`);
      }).finally(async () => {
        locallyRunningExtractionIds.current.delete(item.id);
        const response = await fetch("/api/evidence");
        if (!response.ok) return;
        const payload = await readJson(response);
        if (payload.evidence) {
          setEvidence(payload.evidence);
          setReviewQuestions(uniqueById(payload.reviewItems ?? []));
        }
      });
    }
  // `modelChoice` is intentionally read from the current render when a queued
  // job is claimed; subsequent UI choices apply only to subsequent jobs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence, model, effort]);

  // Ingestion may continue after the upload/chat request returns. Keep the shell
  // current while the documents modal is open or any source reports active work.
  useEffect(() => {
    const shouldPoll = documentsOpen || processingEvidence.length > 0;
    if (!shouldPoll) return;
    let cancelled = false;
    async function refreshBackgroundWork() {
      const [evidenceResponse, decisionsResponse] = await Promise.all([
        fetch("/api/evidence"),
        fetch("/api/decisions"),
      ]);
      if (cancelled) return;
      if (evidenceResponse.ok) {
        const payload = await readJson(evidenceResponse);
        if (payload.evidence) {
          setEvidence(payload.evidence);
          setReviewQuestions(uniqueById(payload.reviewItems ?? []));
        }
      }
      if (decisionsResponse.ok) {
        const payload = await readJson(decisionsResponse);
        if (payload.decisions) setAgentDecisions(payload.decisions);
      }
      if (processingEvidence.length > 0) {
        const reconciliationResponse = await fetch("/api/reconciliation");
        if (reconciliationResponse.ok) {
          const payload = await readJson(reconciliationResponse);
          if (payload.months) setReconciliation(payload.months);
          if (payload.ledger) setReconciliationLedger(payload.ledger);
        }
      }
    }
    refreshBackgroundWork().catch(() => undefined);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshBackgroundWork().catch(() => undefined);
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [documentsOpen, processingEvidence.length]);

  useEffect(() => {
    fetch("/api/decisions").then((response) => response.ok ? response.json() : null).then((payload) => { if (payload?.decisions) setAgentDecisions(payload.decisions); }).catch(() => undefined);
    refreshProposedItems().catch(() => undefined);
    refreshEntities().catch(() => undefined);
  }, []);

  // Re-read the statements when the entity view changes (the initial load is handled below).
  const firstEntityRender = useRef(true);
  useEffect(() => {
    if (firstEntityRender.current) { firstEntityRender.current = false; return; }
    refreshFinancialState().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntity]);

  async function refreshEntities() {
    const response = await fetch("/api/entities");
    if (response.ok) { const payload = await readJson(response); setEntityStructure({ legalEntities: payload.legalEntities ?? [], accounts: payload.accounts ?? [] }); }
  }

  async function refreshProposedItems() {
    const response = await fetch("/api/items");
    if (response.ok) { const payload = await readJson(response); if (payload.items) setProposedItems(payload.items); }
  }

  async function reviewProposedItems(ids: string[], status: "confirmed" | "rejected") {
    const response = await fetch("/api/items", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, status }) });
    if (!response.ok) { setNotice("Unable to update the proposed items."); return; }
    setProposedItems((current) => current.map((item) => ids.includes(item.id) ? { ...item, status } : item));
    await refreshFinancialState();
  }

  async function updateAgentDecision(id: string, status: AgentDecision["status"]) {
    const response = await fetch("/api/decisions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    const payload = await readJson(response);
    if (response.ok) {
      setAgentDecisions((current) => current.map((decision) => decision.id === id ? { ...decision, status } : decision));
      if (payload.mutation?.applied) setNotice(`Applied: ${payload.mutation.applied}`);
      await refreshFinancialState();
    } else setNotice(payload.error ?? "Unable to update this decision.");
  }

  useEffect(() => {
    async function loadForecast() {
      const response = await fetch("/api/journal-financials");
      const payload = response.ok ? await readJson(response) : null;
      applyJournalDashboard(payload);
      if (payload?.months) { const initialMonth = payload.months[0]?.month ?? ""; setSelectedMonth(initialMonth); setRangeEnd(lastDayOfMonth(initialMonth)); }
      const reconciliationResponse = await fetch("/api/reconciliation");
      const reconciliationPayload = reconciliationResponse.ok ? await readJson(reconciliationResponse) : null;
      if (reconciliationPayload?.months) setReconciliation(reconciliationPayload.months);
      if (reconciliationPayload?.ledger) setReconciliationLedger(reconciliationPayload.ledger);
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

  function chooseFiles(sourceRole: "standard" | "reference_model" = "standard") {
    setUploadSourceRole(sourceRole);
    fileInput.current?.click();
  }

  function modelChoice() {
    return { model, ...(effort === "auto" ? {} : { effort }) };
  }

  async function refreshReconciliation(runAgain = false) {
    setIsReconciling(true);
    try {
      const response = await fetch(runAgain ? "/api/reconciliation?run=again" : "/api/reconciliation", runAgain ? { method: "POST" } : undefined);
      if (response.ok) {
        const payload = await readJson(response);
        if (payload.months) setReconciliation(payload.months);
        if (payload.ledger) setReconciliationLedger(payload.ledger);
      }
      if (runAgain) {
        const evidenceResponse = await fetch("/api/evidence");
        if (evidenceResponse.ok) {
          const payload = await readJson(evidenceResponse);
          if (payload.evidence) setEvidence(payload.evidence);
        }
      }
    } finally {
      setIsReconciling(false);
    }
  }

  async function refreshFinancialState() {
    const [financialResponse, evidenceResponse] = await Promise.all([
      fetch(`/api/journal-financials${entityQuery}`),
      fetch("/api/evidence"),
    ]);
    refreshProposedItems().catch(() => undefined);
    if (financialResponse.ok) applyJournalDashboard(await readJson(financialResponse));
    if (evidenceResponse.ok) {
      const payload = await readJson(evidenceResponse);
      if (payload.evidence) {
        setEvidence(payload.evidence);
        setReviewQuestions(uniqueById(payload.reviewItems ?? []));
      }
    }
    await refreshReconciliation();
  }

  async function reprocessEvidence(item: EvidenceItem) {
    setReprocessingEvidenceId(item.id);
    try {
      const response = await fetch(`/api/evidence/${item.id}/reprocess`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(modelChoice()) });
      const payload = await readJson(response);
      if (response.ok) {
        setEvidence((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "pending", extraction: payload.extraction } : entry));
        const refreshed = await fetch("/api/evidence");
        if (refreshed.ok) { const data = await readJson(refreshed); setEvidence(data.evidence); setReviewQuestions(uniqueById(data.reviewItems ?? [])); }
        await refreshReconciliation();
      } else setNotice(payload.error ?? "Unable to reprocess this document.");
    } catch {
      setNotice("Unable to reprocess this document.");
    } finally {
      setReprocessingEvidenceId(null);
    }
  }

  async function askAgent(question: string, newEvidence: ChatEvidence[] = [], signal?: AbortSignal, attachmentNames: string[] = []) {
    const requestThreadId = activeThreadId;
    const conversationHistory = turns.slice(-10).flatMap((turn) => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.answer },
    ]).filter((entry) => entry.content.trim());
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(signal ? { signal } : {}),
      body: JSON.stringify({ message: question, threadId: requestThreadId, history: conversationHistory, evidence: newEvidence, attachments: attachmentNames, reviewQuestionId: activeReviewQuestionId ?? undefined, decisionId: activeDecision?.id ?? undefined, month: selectedMonth || undefined, ...modelChoice() }),
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(payload.error ?? "Unable to ask the finance agent");
    const answer = [payload.answer, payload.forecastExplanation].filter(Boolean).join(" ").trim();
    const reviewContext = activeReviewQuestion ? { type: "question" as const, text: activeReviewQuestion.question } : activeDecision ? { type: "decision" as const, text: activeDecision.question } : undefined;
    setThreads((current) => ({ ...current, [requestThreadId]: [...(current[requestThreadId] ?? []), { id: crypto.randomUUID(), threadId: requestThreadId, question, answer, ...(reviewContext ? { reviewContext } : {}), ...(attachmentNames.length ? { attachments: attachmentNames } : {}), model: model === "auto" ? null : model, createdAt: new Date().toISOString() }] }));
    setActiveReviewQuestionId(null);
    setActiveReviewQuestion(null);
    if (payload.resolvedDecisionIds?.length) setAgentDecisions((current) => current.map((decision) => payload.resolvedDecisionIds.includes(decision.id) ? { ...decision, status: payload.resolvedDecisions?.find((resolution: { id: string }) => resolution.id === decision.id)?.status ?? decision.status } : decision));
    setActiveDecision(null);
    setPendingQuestion(null);
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
    setActiveDecision(null);
  }

  function clearCurrentThread() {
    if (submittingThreadId === activeThreadId) requestAbortController.current?.abort();
    setThreads((current) => ({ ...current, [activeThreadId]: [] }));
    setMessage("");
    setNotice(null);
    setActiveReviewQuestion(null);
    setActiveReviewQuestionId(null);
    setActiveDecision(null);
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
    setActiveDecision(null);
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
    setActiveDecision(decision);
    setMessage("");
    requestAnimationFrame(() => composerInput.current?.focus());
  }

  function reviewReferenceModel(item: EvidenceItem) {
    setDocumentsOpen(false);
    setActiveReviewQuestionId(null);
    setActiveReviewQuestion(null);
    setActiveDecision(null);
    setMessage(`Review the reference model “${shortFileName(item.sourceName)}”. Use its workbook structure to propose the statement layout, chart-of-accounts mappings, historical periods, and forecast drivers we should learn from it. Do not treat workbook formulas or outputs as posted actuals; identify the smallest set of CFO decisions needed before using it as onboarding context.`);
    requestAnimationFrame(() => composerInput.current?.focus());
  }

  async function saveWorkbookReview(item: EvidenceItem, worksheetRoles: Record<string, WorkbookSheetRole>) {
    setSavingWorkbookReviewId(item.id);
    try {
      const response = await fetch(`/api/evidence/${item.id}/workbook-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worksheetRoles }) });
      const payload = await readJson(response);
      if (!response.ok) {
        setNotice(payload.error ?? "Unable to save workbook review.");
        return;
      }
      setEvidence((current) => current.map((entry) => entry.id === item.id ? { ...entry, sourceMetadata: { ...entry.sourceMetadata, workbookReview: payload.workbookReview } } : entry));
      setNotice("Workbook roles saved to company knowledge. They guide future review but do not import model figures.");
    } catch {
      setNotice("Unable to save workbook review.");
    } finally {
      setSavingWorkbookReviewId(null);
    }
  }

  async function draftWorkbookProposal(item: EvidenceItem) {
    setDraftingWorkbookProposalId(item.id);
    try {
      const response = await fetch(`/api/evidence/${item.id}/workbook-review/proposals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(modelChoice()) });
      const payload = await readJson(response);
      if (!response.ok) {
        setNotice(payload.error ?? "Unable to draft onboarding proposals.");
        return;
      }
      setEvidence((current) => current.map((entry) => entry.id === item.id ? { ...entry, sourceMetadata: { ...entry.sourceMetadata, workbookProposal: payload.workbookProposal } } : entry));
      setNotice("Onboarding proposals are ready for review. Nothing has been created or posted.");
    } catch {
      setNotice("Unable to draft onboarding proposals.");
    } finally {
      setDraftingWorkbookProposalId(null);
    }
  }

  async function reviewWorkbookProposal(item: EvidenceItem, proposalId: string, status: "approved" | "rejected") {
    const key = `${item.id}:${proposalId}`;
    setReviewingWorkbookProposalKey(key);
    try {
      const response = await fetch(`/api/evidence/${item.id}/workbook-review/proposal-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId, status }) });
      const payload = await readJson(response);
      if (!response.ok) {
        setNotice(payload.error ?? "Unable to review workbook proposal.");
        return;
      }
      setEvidence((current) => current.map((entry) => entry.id === item.id ? { ...entry, sourceMetadata: { ...entry.sourceMetadata, workbookProposalReview: payload.workbookProposalReview } } : entry));
      setNotice(status === "approved" ? "Proposal approved as onboarding guidance. It has not created an account, driver, or entry." : "Proposal rejected.");
    } catch {
      setNotice("Unable to review workbook proposal.");
    } finally {
      setReviewingWorkbookProposalKey(null);
    }
  }

  function discussWorkbookProposal(item: EvidenceItem, proposal: string) {
    setDocumentsOpen(false);
    setActiveReviewQuestionId(null);
    setActiveReviewQuestion(null);
    setActiveDecision(null);
    setMessage(`Regarding the reference model “${shortFileName(item.sourceName)}”: ${proposal}\n\nWhat evidence, policy, or CFO decision should determine whether we use this suggestion? Do not create accounts, drivers, or entries until I approve the specific application.`);
    requestAnimationFrame(() => composerInput.current?.focus());
  }

  function workbookProposalActions(item: EvidenceItem, proposalId: string, summary: string) {
    const status = item.sourceMetadata?.workbookProposalReview?.[proposalId];
    const saving = reviewingWorkbookProposalKey === `${item.id}:${proposalId}`;
    if (status) return <span className={cn("text-[11px]", status === "approved" ? "text-ink-2" : "text-pencil")}>{status === "approved" ? "Approved guidance" : "Rejected"}</span>;
    return <span className="flex shrink-0 items-center gap-1"><button type="button" className="cursor-pointer rounded-md border border-rule p-1 text-ink-2 hover:text-ink disabled:opacity-50" title="Accept as onboarding guidance" aria-label="Accept as onboarding guidance" disabled={saving} onClick={() => reviewWorkbookProposal(item, proposalId, "approved")}><Check className="size-3.5" /></button><button type="button" className="cursor-pointer rounded-md border border-rule p-1 text-ink-2 hover:text-ink disabled:opacity-50" title="Reject proposal" aria-label="Reject proposal" disabled={saving} onClick={() => reviewWorkbookProposal(item, proposalId, "rejected")}><Trash2 className="size-3.5" /></button><button type="button" className="cursor-pointer rounded-md border border-rule p-1 text-ink-2 hover:text-ink" title="Discuss proposal" aria-label="Discuss proposal" onClick={() => discussWorkbookProposal(item, summary)}><MessageSquareText className="size-3.5" /></button></span>;
  }

  async function applyWorkbookAccountProposal(item: EvidenceItem, proposalId: string) {
    const key = `${item.id}:${proposalId}`;
    setApplyingWorkbookProposalKey(key);
    try {
      const response = await fetch(`/api/evidence/${item.id}/workbook-review/proposal-application`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId }) });
      const payload = await readJson(response);
      if (!response.ok) { setNotice(payload.error ?? "Unable to create draft account."); return; }
      setEvidence((current) => current.map((entry) => entry.id === item.id ? { ...entry, sourceMetadata: { ...entry.sourceMetadata, workbookProposalApplication: { ...entry.sourceMetadata?.workbookProposalApplication, [proposalId]: payload.accountId } } } : entry));
      setNotice(payload.alreadyApplied ? "This draft account already exists." : `Created inactive draft account ${payload.account?.code ?? ""}. Edit and activate it in Accounting before use.`);
    } catch {
      setNotice("Unable to create draft account.");
    } finally {
      setApplyingWorkbookProposalKey(null);
    }
  }

  function stopSubmission() {
    requestAbortController.current?.abort();
    setSubmissionStatus("Stopping…");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const submittedMessage = message.trim();
    if (!submittedMessage && files.length === 0) return;
    const contextualQuestion = submittedMessage;
    const requestThreadId = activeThreadId;
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
        await refreshFinancialState();
        return;
      }
      const reopenCommand = submittedMessage.match(/^(?:open|reopen)\s+(?:month\s+)?(\d{4}-\d{2})$/i);
      if (reopenCommand) {
        const response = await request("/api/months", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: reopenCommand[1], status: "open" }) });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error ?? "Unable to reopen month");
        setNotice(`${reopenCommand[1]} reopened.`);
        await refreshFinancialState();
        return;
      }
      const decisionCommand = submittedMessage.match(/^decision\s*:\s*(.+?)\s*=>\s*(.+)$/i);
      const policyCommand = submittedMessage.match(/^policy\s*:\s*(.+?)\s*=>\s*(.+)$/i);
      if (decisionCommand || policyCommand) {
        const response = await request(policyCommand ? "/api/policies" : "/api/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policyCommand ? { action: "preview", name: policyCommand[1], rule: policyCommand[2], scope: "company" } : { question: decisionCommand![1], answer: decisionCommand![2] }) });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error ?? "Unable to save decision");
        setNotice(policyCommand ? `Policy “${policyCommand[1]}” would match ${payload.impact?.matched ?? 0} transaction${payload.impact?.matched === 1 ? "" : "s"}. Review and activate it in Knowledge.` : "Decision saved.");
        const refreshedEvidence = await request("/api/evidence");
        if (refreshedEvidence.ok) {
          const evidencePayload = await readJson(refreshedEvidence);
          setEvidence(evidencePayload.evidence);
          setReviewQuestions(uniqueById(evidencePayload.reviewItems ?? []));
        }
        await refreshFinancialState();
        return;
      }
      const entityCommand = submittedMessage.match(/^entity\s*:\s*(.+?)\s*(\(?(?:not\s+consolidated|standalone|unconsolidated)\)?)?$/i);
      if (entityCommand) {
        const response = await request("/api/entities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "legal_entity", name: entityCommand[1], consolidated: !entityCommand[2] }) });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error ?? "Unable to save the entity");
        setNotice(`${payload.created ? "Created" : "Updated"} legal entity ${payload.entity?.name ?? entityCommand[1]}${entityCommand[2] ? " (not consolidated)" : ""}.`);
        await Promise.all([refreshEntities(), refreshFinancialState()]);
        return;
      }
      const accountCommand = submittedMessage.match(/^account\s*:\s*(.+?)\s*=>\s*(.+)$/i);
      if (accountCommand) {
        const identifier = accountCommand[1]!.match(/\b(\d{4})\b/)?.[1];
        const response = await request("/api/entities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "account", name: accountCommand[1], ownerName: accountCommand[2], ...(identifier ? { accountIdentifier: identifier } : {}) }) });
        const payload = await readJson(response);
        if (!response.ok) throw new Error(payload.error ?? "Unable to save the account");
        setNotice(`Account ${payload.account?.name ?? accountCommand[1]} belongs to ${accountCommand[2]}.`);
        await Promise.all([refreshEntities(), refreshFinancialState()]);
        return;
      }
      if (!selectedFiles.length) {
        await askAgent(contextualQuestion, [], abortController.signal);
        return;
      }
      const payloads: { id: string; sourceName: string; status: "pending" | "approved"; identityStatus?: "pending" | "approved"; extraction: EvidenceItem["extraction"]; reprocessEvidenceIds?: string[] }[] = [];
      let importedActuals = 0;
      let duplicateActuals = 0;
      const failedFiles: string[] = [];
      if (selectedFiles.length) {
        for (const [index, file] of selectedFiles.entries()) {
          setSubmissionStatus(`Reading ${file.name} (${index + 1} of ${selectedFiles.length})…`);
          try {
          const filePreview = /\.(csv|xlsx|xls)$/i.test(file.name) ? await file.slice(0, 4000).text() : "";
          const looksLikeTransactions = uploadSourceRole !== "reference_model" && (/\.(qbo|ofx)$/i.test(file.name) || (/\.(csv|xlsx|xls)$/i.test(file.name) && /bank|transaction|actual|statement/i.test(file.name) && /date/i.test(filePreview) && /amount|debit|credit|value|total/i.test(filePreview)));
          if (looksLikeTransactions) {
            const actualsForm = new FormData(); actualsForm.append("file", file); if (submittedMessage) actualsForm.append("instructions", submittedMessage); actualsForm.append("model", model); if (effort !== "auto") actualsForm.append("effort", effort);
            const actualsResponse = await request("/api/actuals", { method: "POST", body: actualsForm });
            const actualsPayload = await readJson(actualsResponse);
            if (actualsResponse.ok) {
              importedActuals += Number(actualsPayload.imported ?? 0);
              if (actualsPayload.duplicate) duplicateActuals += 1;
              if (actualsPayload.id && actualsPayload.extraction) payloads.push({ id: actualsPayload.id, sourceName: file.name, status: "pending", extraction: actualsPayload.extraction, reprocessEvidenceIds: actualsPayload.reprocessEvidenceIds });
              continue;
            }
            if (actualsResponse.status !== 400 || !/no transactions|needs an amount/i.test(String(actualsPayload.error ?? ""))) throw new Error(actualsPayload.error ?? `Unable to import ${file.name}`);
          }
          const form = new FormData(); form.append("file", file); form.append("model", model); form.append("defer", "true"); if (uploadSourceRole === "reference_model") form.append("sourceRole", "reference_model"); if (submittedMessage) form.append("instructions", submittedMessage); if (effort !== "auto") form.append("effort", effort);
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
      const affectedEvidenceIds = [...new Set(payloads.flatMap((payload) => payload.reprocessEvidenceIds ?? []))];
      for (const [index, evidenceId] of affectedEvidenceIds.entries()) {
        setSubmissionStatus(`Reprocessing related evidence (${index + 1} of ${affectedEvidenceIds.length})…`);
        const response = await request(`/api/evidence/${evidenceId}/reprocess`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(modelChoice()) });
        const payload = await readJson(response);
        if (!response.ok) failedFiles.push(`Related evidence: ${payload.error ?? "reprocessing failed"}`);
      }
      setEvidence((current) => uniqueById([...payloads.map((payload) => ({ id: payload.id, sourceName: payload.sourceName, identityStatus: payload.identityStatus ?? "pending", status: payload.status, extraction: payload.extraction })), ...current]));
      const readyPayloads = payloads.filter((payload) => payload.extraction);
      if (!readyPayloads.length && payloads.length) {
        setNotice(`${payloads.length} file${payloads.length === 1 ? "" : "s"} queued for extraction. The processing timeline will update automatically.`);
        setFiles([]);
        setSelectedFiles([]);
        const refreshedEvidence = await request("/api/evidence");
        if (refreshedEvidence.ok) { const evidencePayload = await readJson(refreshedEvidence); setEvidence(evidencePayload.evidence); setReviewQuestions(uniqueById(evidencePayload.reviewItems ?? [])); }
        return;
      }
      const question = contextualQuestion || `I uploaded ${files.join(", ")}. Review what I shared, tell me what you found, and ask me about anything that needs clarification.`;
      const chatEvidence = readyPayloads.map((payload) => ({
        id: payload.id,
        sourceName: payload.sourceName,
        summary: payload.extraction?.summary,
        facts: payload.extraction?.facts ?? [],
        questions: payload.extraction?.questions ?? [],
      }));
      setSubmissionStatus("Considering the files and preparing a response…");
      await askAgent(question, chatEvidence, abortController.signal, selectedFiles.map((file) => file.name));
      setNotice(`${payloads.length} file${payloads.length === 1 ? "" : "s"} processed${importedActuals ? `; ${importedActuals} transactions staged for accounting approval` : duplicateActuals ? `; ${duplicateActuals} transaction file${duplicateActuals === 1 ? "" : "s"} already imported` : ""}${failedFiles.length ? `; ${failedFiles.length} failed: ${failedFiles.join(" · ")}` : "."}`);
      setFiles([]);
      setSelectedFiles([]);
      setUploadSourceRole("standard");
      const refreshedEvidence = await request("/api/evidence");
      if (refreshedEvidence.ok) {
        const evidencePayload = await readJson(refreshedEvidence);
        setEvidence(evidencePayload.evidence);
        setReviewQuestions(uniqueById(evidencePayload.reviewItems ?? []));
      }
      await refreshReconciliation();
      if (importedActuals) await refreshFinancialState();
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
    const response = await fetch("/api/evidence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status, layer: "document" }) });
    if (response.ok) {
      setEvidence((current) => current.map((item) => item.id === id ? { ...item, identityStatus: status, status: status === "rejected" ? "rejected" : item.status } : item));
      await refreshFinancialState();
    } else {
      const payload = await readJson(response);
      setNotice(payload.error ?? "Unable to update this document.");
    }
  }

  async function reviewFact(evidenceId: string, factId: string, status: "approved" | "rejected", layer: "fact" | "treatment", accountingRole?: string) {
    const response = await fetch("/api/evidence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: evidenceId, factId, status, layer, ...(accountingRole ? { accountingRole } : {}) }) });
    if (!response.ok) {
      const payload = await readJson(response);
      setNotice(payload.error ?? "Unable to update this approval.");
      return;
    }
    setEvidence((current) => current.map((item) => item.id === evidenceId && item.extraction ? { ...item, extraction: { ...item.extraction, facts: item.extraction.facts.map((fact) => fact.factId === factId ? { ...fact, ...(accountingRole ? { accountingRole } : {}), factStatus: layer === "treatment" ? "treatment_approved" : status } : fact) } } : item));
    await refreshFinancialState();
  }

  async function reviewFactBatch(item: EvidenceItem, layer: "fact" | "treatment") {
    const facts = item.extraction?.facts.filter((fact) => fact.factId && (layer === "fact" ? fact.factStatus === "pending" : fact.factStatus === "approved")) ?? [];
    if (!facts.length) return;
    setBatchApprovalEvidenceId(item.id);
    setNotice(null);
    try {
      for (const fact of facts) {
        const response = await fetch("/api/evidence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, factId: fact.factId, status: "approved", layer }) });
        if (!response.ok) {
          const payload = await readJson(response);
          throw new Error(payload.error ?? "Unable to update this approval.");
        }
      }
      await refreshFinancialState();
      setNotice(`${facts.length} ${layer === "fact" ? "extracted fact" : "proposed treatment"}${facts.length === 1 ? "" : "s"} approved.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update this approval.");
    } finally {
      setBatchApprovalEvidenceId(null);
    }
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
    if (response.ok) {
      setEvidence((current) => current.map((entry) => entry.id === editingItem.id ? { ...entry, extraction } : entry));
      await refreshFinancialState();
    }
    setEditingItem(null);
  }

  const proposed = agentDecisions.filter((decision) => decision.status === "proposed");
  const isClosed = currentForecast?.status === "closed";
  const showActuals = isClosed || currentForecast?.status === "history";
  const assumedNote = currentForecast && (currentForecast.assumedReceipts || currentForecast.assumedSpending) ? ` · assumed ${money((currentForecast.assumedReceipts ?? 0) - (currentForecast.assumedSpending ?? 0))} net` : "";
  const bars = displayedForecastRows.map((month) => {
    const actual = month.actualReceipts !== 0 || month.actualSpending !== 0;
    const net = actual ? month.actualReceipts - month.actualSpending : month.receipts - month.spending;
    return { month: month.month, endMonth: month.endMonth, actual, net };
  });
  const maxAbs = Math.max(1, ...bars.map((bar) => Math.abs(bar.net)));
  const zeroY = 95;

  return (
    <div className="flex min-h-screen flex-col" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); collectFiles(event.dataTransfer.files); }}>
      <header className="flex h-14 items-center justify-end px-7">
        <AccountMenu company={{ id: company.id, name: company.name, baseCurrency: company.currency }} companies={companies} role={role} staleSelection={staleSelection} user={user} loginEnabled={loginEnabled} />
      </header>

      <main className="mx-auto grid w-full max-w-[776px] flex-1 content-start gap-10 px-7 pt-6 pb-16">
        <section className="grid gap-5" aria-label="Conversation">
          {Object.keys(threads).length > 1 && <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-rule pb-1" role="tablist" aria-label="Chat threads">
            {Object.entries(threads).map(([id, thread], index) => <span key={id} className={cn("inline-flex shrink-0 items-center rounded-md", id === activeThreadId && "bg-rule")}><button type="button" role="tab" aria-selected={id === activeThreadId} className={cn("rounded-md px-3 py-1.5 text-[13px] text-ink-2 hover:bg-rule", id === activeThreadId && "text-ink")} onClick={() => { setActiveThreadId(id); setMessage(""); setActiveReviewQuestion(null); setActiveReviewQuestionId(null); setActiveDecision(null); }}>{id === "main" ? "Chat" : `Chat ${index + 1}`}{thread.length ? <span className="ml-1 text-pencil">· {thread.length}</span> : null}</button><button type="button" aria-label={`Clear ${id === "main" ? "chat" : `Chat ${index + 1}`}`} className="px-1.5 text-ink-2 hover:text-ink" onClick={() => { if (submittingThreadId === id) requestAbortController.current?.abort(); setThreads((current) => { const next = { ...current }; delete next[id]; const remaining = Object.keys(next); if (!remaining.length) next.main = []; if (activeThreadId === id) setActiveThreadId(remaining[0] ?? "main"); return next; }); }}>×</button></span>)}
          </div>}
          {turns.length > 0 && (
            <ol className="grid gap-6">
              {turns.map((turn) => (
                <li key={turn.id} className="grid gap-3">
                  {turn.reviewContext && <div className="grid gap-1 rounded-[12px] border border-rule bg-rule/35 px-4 py-3"><span className="text-[12px] uppercase tracking-[0.1em] text-ink-2">{turn.reviewContext.type === "decision" ? "Reviewing proposed decision" : "Answering waiting question"}</span><p className="text-[15px] leading-[1.45] text-ink">{turn.reviewContext.text}</p></div>}
                  <div className="flex justify-end">
                    <div className="grid max-w-[82%] justify-items-end gap-1.5 sm:max-w-[70%]">
                      <p className="rounded-[18px] bg-rule px-4 py-2.5 text-[15px] leading-[1.45] text-ink">{turn.question}</p>
                      {turn.attachments?.length ? <div className="flex max-w-full flex-wrap justify-end gap-1.5">{turn.attachments.map((name, index) => <span key={`${turn.id}-attachment-${index}`} title={name} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-rule bg-background px-2 py-1 text-[12px] text-ink-2"><Paperclip className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{shortFileName(name)}</span></span>)}</div> : null}
                    </div>
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
              {activeReviewQuestion && <div className="grid gap-1 rounded-[12px] border border-rule bg-rule/35 px-4 py-3" aria-label="Question being answered"><span className="text-[12px] uppercase tracking-[0.1em] text-ink-2">Answering waiting question</span><p className="text-[15px] leading-[1.45] text-ink">{activeReviewQuestion.question}</p></div>}
              {activeDecision && <div className="grid gap-1 rounded-[12px] border border-rule bg-rule/35 px-4 py-3" aria-label="Decision being reviewed"><span className="text-[12px] uppercase tracking-[0.1em] text-ink-2">Reviewing proposed decision</span><p className="text-[15px] leading-[1.45] text-ink">{activeDecision.question}</p><p className="text-[13px] leading-[1.45] text-ink-2">Proposed answer: {activeDecision.answer}</p></div>}
              <div className="flex justify-end">
                <div className="grid max-w-[82%] justify-items-end gap-1.5 sm:max-w-[70%]">
                  <p className="rounded-[18px] bg-rule px-4 py-2.5 text-[15px] leading-[1.45] text-ink">{pendingQuestion}</p>
                  {selectedFiles.length ? <div className="flex max-w-full flex-wrap justify-end gap-1.5">{selectedFiles.map((file, index) => <span key={`pending-attachment-${index}`} title={file.name} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-rule bg-background px-2 py-1 text-[12px] text-ink-2"><Paperclip className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{shortFileName(file.name)}</span></span>)}</div> : null}
                </div>
              </div>
              <p className="flex items-center gap-2 text-[13px] text-ink-2" role="status">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> {submissionStatus}
              </p>
            </div>
          )}
          {activeReviewQuestion && !(isSubmitting && submittingThreadId === activeThreadId) && (
            <div className="grid gap-1 rounded-[12px] border border-rule bg-rule/35 px-4 py-3" aria-label="Question being answered">
              <span className="text-[12px] uppercase tracking-[0.1em] text-ink-2">Answering waiting question</span>
              <p className="text-[15px] leading-[1.45] text-ink">Regarding “{activeReviewQuestion.question}”</p>
            </div>
          )}
          {activeDecision && !(isSubmitting && submittingThreadId === activeThreadId) && (
            <div className="grid gap-1 rounded-[12px] border border-rule bg-rule/35 px-4 py-3" aria-label="Decision being reviewed">
              <span className="text-[12px] uppercase tracking-[0.1em] text-ink-2">Reviewing proposed decision</span>
              <p className="text-[15px] leading-[1.45] text-ink">{activeDecision.question}</p>
              <p className="text-[13px] leading-[1.45] text-ink-2">Proposed answer: {activeDecision.answer}</p>
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
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Selected files">
                {files.map((file, index) => (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-rule px-2 py-1 text-[12px] text-ink-2" key={`selected-file-${index}`} title={file}>
                    <FileText className="size-3.5 shrink-0" aria-hidden="true" /> <span className="truncate">{shortFileName(file)}</span>
                  </span>
                ))}
                {uploadSourceRole === "reference_model" && <span className="rounded-md border border-rule bg-rule/35 px-2 py-1 text-[12px] text-ink-2">Reference model · formulas are used as context, not reported results</span>}
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
                  onClick={() => chooseFiles()}
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
              <button className={quietButton} type="button" onClick={() => { setDocumentsOpen(true); setSelectedEvidenceId(evidence[0]?.id ?? null); }}>
                <FileText className="size-3.5" aria-hidden="true" /> Documents
              </button>
              <button className={quietButton} type="button" onClick={() => setAccountingOpen(true)}>
                <BookOpenText className="size-3.5" aria-hidden="true" /> Accounting
              </button>
              <button className={quietButton} type="button" onClick={() => setUsageOpen(true)}>
                <ChartColumn className="size-3.5" aria-hidden="true" /> Usage
              </button>
              <Link href="/knowledge" className={quietButton}>
                <BookOpenText className="size-3.5" aria-hidden="true" /> Knowledge
              </Link>
            </div>
            {siteUrl && (
              <a href={siteUrl} target="_blank" rel="noreferrer" className={quietButton}>
                <CircleHelp className="size-3.5" aria-hidden="true" /> How Nevermodel works
              </a>
            )}
          </div>
          {notice && (
            <p className="prose-serif text-[17px] leading-[1.5] text-ink" style={{ fontVariationSettings: '"opsz" 17' }} role="status">
              {notice}
            </p>
          )}
        </section>

        {evidence.length > 0 && <section className="grid min-w-0 gap-3.5 overflow-hidden" aria-live="polite" aria-label="Documents processing">
          <div className="flex items-baseline justify-between gap-4">
            <div><h2 className="display text-[22px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 22' }}>Processing run</h2><p className="mt-1 text-[13px] text-ink-2">{processingEvidence.length > 0 ? "New evidence is being checked automatically." : failedEvidence.length > 0 ? "Some evidence could not be processed. Retry it here or in Documents." : "All loaded documents have completed extraction."}</p></div>
            {processingEvidence.length > 0 ? <span className="flex items-center gap-1.5 text-[13px] text-ink-2"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Live</span> : failedEvidence.length > 0 ? <span className="text-[13px] text-red-ink">Needs attention</span> : <span className="flex items-center gap-1.5 text-[13px] text-ink-2"><Check className="size-3.5" aria-hidden="true" /> Complete</span>}
          </div>
          <div className="grid gap-4 border-y border-rule py-4 sm:grid-cols-[minmax(0,1fr)_minmax(280px,1fr)]">
            <div className="grid gap-2 text-[13px]">
              {processingStages.map((stage) => <div className="flex items-center gap-2" key={stage.key}>
                {stage.status === "succeeded" ? <Check className="size-3.5 text-ink" aria-hidden="true" /> : stage.status === "running" ? <LoaderCircle className="size-3.5 animate-spin text-ink-2" aria-hidden="true" /> : <span className={cn("grid size-3.5 place-items-center rounded-full border text-[9px]", stage.status === "failed" ? "border-red-ink text-red-ink" : "border-pencil text-pencil")} aria-hidden="true">{stage.status === "failed" ? "!" : ""}</span>}
                <span className={stage.status === "succeeded" ? "text-ink" : stage.status === "failed" ? "text-red-ink" : "text-ink-2"}>{stage.label}</span>
                <span className={cn("ml-auto text-[12px]", stage.status === "failed" ? "text-red-ink" : "text-pencil")}>{stage.status === "succeeded" ? "Complete" : stage.status === "running" ? "Running" : stage.status === "failed" ? "Failed" : "Waiting"}</span>
              </div>)}
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-rule pt-3 text-[12px] sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
              <span><strong className="block text-[17px] font-normal text-ink">{evidence.length}</strong>documents loaded</span>
              <span><strong className="block text-[17px] font-normal text-ink">{evidence.reduce((total, item) => total + (item.extraction?.facts.length ?? 0), 0)}</strong>facts extracted</span>
              <span><strong className="block text-[17px] font-normal text-ink">{reconciliation.reduce((total, row) => total + row.transactionCount, 0)}</strong>transactions checked</span>
              <span><strong className="block text-[17px] font-normal text-ink">{reconciliation.reduce((total, row) => total + row.exceptions.length, 0)}</strong>exceptions</span>
            </div>
          </div>
          <div className="grid min-w-0 gap-0 text-[13px]">
            <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_88px] gap-4 border-b border-rule pb-2 text-[11px] uppercase tracking-[0.1em] text-ink-2 sm:grid"><span>Document</span><span>Result</span><span className="text-right">Action</span></div>
            {evidence.map((item) => {
                const failed = item.ingestionStatus === "failed" || item.ingestionStatus === "interrupted";
              const active = ["stored", "extracting", "reconciling", "processing"].includes(item.ingestionStatus ?? "");
              return <div className="grid min-w-0 gap-1 border-b border-rule py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_88px] sm:items-center sm:gap-4" key={`processing-${item.id}`}>
                <span className="min-w-0 truncate text-ink" title={item.sourceName}>{shortFileName(item.sourceName)}</span>
                <span className={cn("min-w-0 truncate", failed ? "text-red-ink" : "text-ink-2")} title={failed ? item.ingestionError ?? undefined : undefined}>{failed ? readableProcessingError(item.ingestionError) : ingestionStatusLabel(item)}</span>
                <span className="flex justify-start sm:justify-end">{failed && item.storageReference ? <Button type="button" variant="outline" size="sm" className="w-[88px] shrink-0" onClick={() => void reprocessEvidence(item)} disabled={reprocessingEvidenceId === item.id}>{reprocessingEvidenceId === item.id ? "Retrying…" : "Retry"}</Button> : failed ? <span className="text-[12px] text-red-ink">Unavailable</span> : active ? <LoaderCircle className="size-3.5 animate-spin text-ink-2" aria-label="Processing" /> : <Check className="size-3.5 text-ink-2" aria-label="Processed" />}</span>
              </div>;
            })}
          </div>
        </section>}

        {needsInputCount > 0 && <section className="grid gap-3.5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="display text-[22px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 22' }}>Needs your input</h2>
            <span className="text-[13px] text-ink-2">{`${needsInputCount} item${needsInputCount === 1 ? "" : "s"}`}</span>
          </div>
          {
            <div className="border-t border-rule">
              {reviewQuestions.length > 0 && (
                <div>
                  <div className="border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2">Clarifications · answer in chat</div>
                  {reviewQuestions.map((item) => (
                    <div className="grid gap-0.5 border-b border-rule py-3.5" key={`question-${item.id}`}>
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
                  <div className="border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2">Evidence review · edit, approve, or reject</div>
                  {pendingEvidence.slice(0, 4).map((item) => (
                    <div className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-rule py-3.5" key={`evidence-${item.id}`}>
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
                        <div className="mt-3 grid gap-2 border-l-2 border-rule pl-3 text-[13px]">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span><span className="mr-2 text-[11px] uppercase tracking-[0.12em] text-pencil">1 · Document identity</span>{item.identityStatus === "approved" ? <span className="text-ink">Confirmed</span> : item.identityStatus === "rejected" ? <span className="text-red-ink">Rejected</span> : <span className="text-ink-2">Confirm this is the right source, entity, and period.</span>}</span>
                            {item.identityStatus === "pending" && <button className="rounded border border-rule px-2 py-1 text-[11px] text-ink-2 hover:bg-rule" type="button" onClick={() => reviewItem(item.id, "approved")}>Confirm document</button>}
                          </div>
                          <div><span className="mr-2 text-[11px] uppercase tracking-[0.12em] text-pencil">2 · Extracted facts</span><span className="text-ink-2">Approve each fact after the document is confirmed.</span></div>
                          <div><span className="mr-2 text-[11px] uppercase tracking-[0.12em] text-pencil">3 · Accounting treatment</span><span className="text-ink-2">Approve the proposed role before it can affect financial state.</span></div>
                        </div>
                        {item.identityStatus === "approved" && item.extraction?.facts.length ? <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]"><span className="text-ink-2">{item.extraction.facts.filter((fact) => fact.factStatus === "pending").length} facts awaiting review · {item.extraction.facts.filter((fact) => fact.factStatus === "approved").length} treatments awaiting approval</span>{item.extraction.facts.some((fact) => fact.factStatus === "pending") ? <button className="rounded border border-rule px-2 py-1 text-[11px] text-ink-2 hover:bg-rule disabled:opacity-50" type="button" disabled={batchApprovalEvidenceId === item.id} onClick={() => reviewFactBatch(item, "fact")}>{batchApprovalEvidenceId === item.id ? "Approving…" : "Approve all extracted facts"}</button> : null}{item.extraction.facts.some((fact) => fact.factStatus === "approved") ? <button className="rounded border border-rule px-2 py-1 text-[11px] text-ink-2 hover:bg-rule disabled:opacity-50" type="button" disabled={batchApprovalEvidenceId === item.id} onClick={() => reviewFactBatch(item, "treatment")}>{batchApprovalEvidenceId === item.id ? "Approving…" : "Approve all proposed treatments"}</button> : null}</div> : null}
                        {item.extraction?.facts.length ? (
                          <div className="mt-2 grid gap-1.5 text-[13px] text-ink-2">
                            {item.extraction.facts.map((fact, factIndex) => (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1" key={fact.factId ?? `${item.id}-fact-${factIndex}`}>
                                <span>{fact.label} <span className={cn("font-medium", fact.confidence >= 0.8 ? "text-ink" : "text-ink-2")}>{fact.value}</span>{fact.currency ? <span className="text-pencil"> · {fact.currency}</span> : null}{fact.sourceLocation ? <span className="text-pencil"> · {fact.sourceLocation}</span> : null}{fact.accountingRole ? <span className="text-pencil"> · {fact.accountingRole.replace(/_/g, " ")}</span> : null}</span>
                                {fact.factId && <span className="flex flex-wrap items-center gap-1">{item.identityStatus !== "approved" ? <span className="text-[11px] text-pencil">Document confirmation required</span> : fact.factStatus === "treatment_approved" ? <span className="text-[11px] text-ink">Treatment approved · {fact.accountingRole?.replace(/_/g, " ") ?? "unknown"}</span> : fact.factStatus === "approved" ? <><select aria-label={`Accounting treatment for ${fact.label}`} className="rounded border border-rule bg-background px-1.5 py-0.5 text-[11px] text-ink-2" value={treatmentDrafts[fact.factId] ?? fact.accountingRole ?? "unknown"} onChange={(event) => setTreatmentDrafts((current) => ({ ...current, [fact.factId!]: event.target.value }))}>{accountingRoleOptions.map((role) => <option value={role} key={role}>{role.replace(/_/g, " ")}</option>)}</select><button className="rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-rule" type="button" onClick={() => reviewFact(item.id, fact.factId!, "approved", "treatment", treatmentDrafts[fact.factId!] ?? fact.accountingRole ?? "unknown")}>Approve treatment</button></> : <><button className="rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-rule" type="button" onClick={() => reviewFact(item.id, fact.factId!, "approved", "fact")}>Approve fact</button><button className="rounded border border-rule px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-rule" type="button" onClick={() => reviewFact(item.id, fact.factId!, "rejected", "fact")}>Reject fact</button></>}</span>}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <span className="flex gap-1">
                        <button className={actionButton} type="button" aria-label="Confirm document identity" title="Confirm document" onClick={() => reviewItem(item.id, "approved")}><Check /></button>
                        <button className={actionButton} type="button" aria-label="Reject extracted evidence" title="Delete" onClick={() => reviewItem(item.id, "rejected")}><Trash2 /></button>
                        <button className={actionButton} type="button" aria-label="Edit extracted evidence" title="Edit" onClick={() => editItem(item)}><Pencil /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {draftItems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2"><span>Interpreted items · confirm before they enter the forecast</span>{draftItems.length > 1 && <button type="button" className="normal-case tracking-normal text-ink-2 underline-offset-2 hover:text-ink hover:underline" onClick={() => reviewProposedItems(draftItems.map((item) => item.id), "confirmed")}>Confirm all {draftItems.length}</button>}</div>
                  {draftItems.map((item) => (
                    <div className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-rule py-3.5" key={`item-${item.id}`}>
                      <div className="min-w-0">
                        <div>{item.label}{item.counterpartyName || item.counterparty ? <span className="text-ink-2"> · {item.counterpartyName ?? item.counterparty}</span> : null}</div>
                        <div className="mt-0.5 text-[13px] text-ink-2">
                          <span className="font-medium text-ink">{item.direction === "spend" ? "−" : "+"}{money(item.amount ?? 0)}</span>
                          {` ${item.cadence ?? "once"}`}{item.effectiveFrom ? ` from ${monthLabel(item.effectiveFrom)}` : ""}{item.effectiveTo ? ` to ${monthLabel(item.effectiveTo)}` : ""}
                          {item.category ? ` · ${item.category.replace(/_/g, " ")}` : ""}{item.accountingTreatment !== "cash" ? ` · ${item.accountingTreatment}` : ""}{item.basis === "assumed" ? " · assumption" : ""}
                          {item.confidence !== null && item.confidence !== undefined && item.confidence < 0.8 ? <span className="text-pencil"> · {Math.round(item.confidence * 100)}% confident</span> : null}
                        </div>
                        {item.rationale && <div className="mt-0.5 truncate text-[13px] text-pencil">{item.rationale}</div>}
                        {item.sourceName && <div className="text-[12px] text-pencil">From {item.sourceName}</div>}
                        <ForecastConsequenceLine request={{ kind: "confirm_item", itemId: item.id }} revision={runway?.revision} />
                      </div>
                      <span className="flex gap-1">
                        <button className={actionButton} type="button" aria-label="Confirm interpreted item" title="Confirm" onClick={() => reviewProposedItems([item.id], "confirmed")}><Check /></button>
                        <button className={actionButton} type="button" aria-label="Reject interpreted item" title="Reject" onClick={() => reviewProposedItems([item.id], "rejected")}><Trash2 /></button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {proposed.length > 0 && (
                <div>
                  <div className="border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2">Proposed treatments · apply, reject, or discuss</div>
                  {proposed.map((decision) => (
                    <div className="grid grid-cols-[1fr_auto] items-start gap-4 border-b border-rule py-3.5" key={`decision-${decision.id}`}>
                      <div className="min-w-0">
                        <div>{decision.question}</div>
                        <div className="mt-0.5 text-[13px] text-ink-2">Proposed answer: {decision.answer}</div>
                        {decision.effectSummary && <div className="mt-0.5 text-[13px] text-pencil">If applied: {decision.effectSummary}</div>}
                        <ForecastConsequenceLine request={{ kind: "apply_decision", decisionId: decision.id }} revision={runway?.revision} />
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

        {reconciliation.length > 0 && (() => {
          const row = reconciliation.find((entry) => entry.month === periodEndMonth) ?? reconciliation.at(-1)!;
          return <section className="grid gap-3.5" aria-label="Reconciliation">
            <div className="flex items-baseline justify-between gap-4"><h2 className="display text-[22px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 22' }}>Reconciliation</h2><span className={cn("text-[13px]", row.status === "reconciled" ? "text-ink" : "text-red-ink")}>{row.status === "reconciled" ? "Reconciled" : `${row.exceptions.length} exception${row.exceptions.length === 1 ? "" : "s"}`}</span></div>
            <div className="grid gap-3 border-t border-rule pt-3">
              <div className="grid grid-cols-2 gap-4 text-[13px] sm:grid-cols-4"><div><span className="block text-ink-2">Opening</span><span className="mt-1 block text-ink">{row.opening === undefined ? "Not found" : money(row.opening)}</span></div><div><span className="block text-ink-2">Detailed activity</span><span className="mt-1 block text-ink">{money(row.net)}</span></div><div><span className="block text-ink-2">Calculated ending</span><span className="mt-1 block text-ink">{row.expectedEnding === undefined ? "—" : money(row.expectedEnding)}</span></div><div><span className="block text-ink-2">Statement ending</span><span className="mt-1 block text-ink">{row.ending === undefined ? "Not found" : money(row.ending)}</span></div></div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule pt-3 text-[12px] text-ink-2"><span>{row.transactionCount} approved transactions</span>{row.stagedTransactionCount ? <span>{row.stagedTransactionCount} staged for approval</span> : null}<span>{row.sourceNames.length} source{row.sourceNames.length === 1 ? "" : "s"}</span><span>{row.duplicateCount} duplicate match{row.duplicateCount === 1 ? "" : "es"}</span>{row.difference !== undefined && <span>Difference {money(row.difference)}</span>}</div>
              {reconciliationLedger && <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2"><span>{reconciliationLedger.byKind.unmatched ?? 0} unmatched</span><span>{reconciliationLedger.byKind.transfer ?? 0} transfer counterparts</span><span>{reconciliationLedger.byKind.book_match ?? 0} bank-to-books matched</span><span>{reconciliationLedger.byKind.duplicate ?? 0} duplicate-linked</span><span>{reconciliationLedger.byKind.currency_pending ?? 0} awaiting conversion</span></div>}
              {row.revenueComparison && <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2"><span>P&amp;L revenue {money(row.revenueComparison.reported)}</span><span>cash receipts {money(row.revenueComparison.cashReceived)}</span><span>from {row.revenueComparison.sources.join(" · ")}</span></div>}
              {row.bookBalanceComparison && <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2"><span>Statement ending cash {money(row.bookBalanceComparison.statementBalance)}</span><span>Books cash {money(row.bookBalanceComparison.bookBalance)}</span><span className={Math.abs(row.bookBalanceComparison.difference) > 0.01 ? "text-red-ink" : "text-ink"}>Difference {money(row.bookBalanceComparison.difference)}</span></div>}
              {row.duplicateGroups?.length ? <details className="border-t border-rule pt-3 text-[13px]"><summary className="cursor-pointer text-ink-2">Cross-source matches ({row.duplicateGroups.length})</summary><div className="mt-2 grid gap-2">{row.duplicateGroups.map((group) => <div className="grid gap-1 border-b border-rule pb-2" key={group.key}><span className="text-ink">{group.date ?? row.month} · {money(group.amount)} {group.direction}</span><span className="text-ink-2">{group.sources.join(" · ")}</span><span className="text-pencil">{group.descriptions.join(" / ")}</span></div>)}</div></details> : null}
              {row.transferGroups?.length ? <details className="border-t border-rule pt-3 text-[13px]"><summary className="cursor-pointer text-ink-2">Matched internal transfers ({row.transferGroups.length})</summary><div className="mt-2 grid gap-2">{row.transferGroups.map((group) => <div className="grid gap-1 border-b border-rule pb-2" key={group.key}><span className="text-ink">{group.date ?? row.month} · {money(group.amount)} transfer</span><span className="text-ink-2">{group.sources.join(" · ")}</span><span className="text-pencil">{group.descriptions.join(" / ")}</span></div>)}</div></details> : null}
              {row.bookMatchGroups?.length ? <details className="border-t border-rule pt-3 text-[13px]"><summary className="cursor-pointer text-ink-2">Bank-to-books matches ({row.bookMatchGroups.length})</summary><div className="mt-2 grid gap-2">{row.bookMatchGroups.map((group) => <div className="grid gap-1 border-b border-rule pb-2" key={group.key}><span className="text-ink">{group.date ?? row.month} · {money(group.amount)} {group.direction}</span><span className="text-ink-2">{group.sources.join(" · ")}</span><span className="text-pencil">{group.descriptions.join(" / ")}</span></div>)}</div></details> : null}
              {row.reviewQuestions?.length ? <details className="border-t border-rule pt-3 text-[13px]"><summary className="cursor-pointer text-ink-2">Grouped review questions ({row.reviewQuestions.length})</summary><div className="mt-2 grid gap-3">{row.reviewQuestions.map((review) => <div className="grid gap-1 rounded-lg bg-highlight/50 p-3" key={`${review.kind}-${review.question}`}><span className="text-ink">{review.question}</span><span className="text-[12px] text-ink-2">Evidence: {review.evidence.join(" · ")}</span></div>)}</div></details> : null}
              {row.exceptions.length > 0 && <div className="grid gap-1 border-t border-rule pt-3 text-[13px] text-red-ink">{row.exceptions.map((exception) => <div key={exception}>{exception}</div>)}</div>}
              <details className="border-t border-rule pt-3 text-[13px]"><summary className="cursor-pointer text-ink-2">Sources and coverage</summary><div className="mt-2 grid gap-1 text-ink">{row.sourceNames.map((source) => <span key={source}>{source}</span>)}{row.stagedSourceNames?.map((source) => <span className="text-pencil" key={`staged-${source}`}>Staged transaction source: {source}</span>)}{row.pendingSources.map((source) => <span className="text-red-ink" key={`pending-${source}`}>Pending: {source}</span>)}</div></details>
              {(row.stagedTransactions?.length ?? 0) > 0 && <details className="border-t border-rule pt-3 text-[13px]"><summary className="cursor-pointer text-ink-2">Staged transaction detail ({row.stagedTransactions!.length})</summary><p className="mt-2 text-[12px] text-pencil">These parsed rows are available for review and matching, but are excluded from balances and statements until their accounting treatment is approved.</p><div className="mt-2 grid gap-1.5">{row.stagedTransactions!.map((transaction) => <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] gap-2" key={`staged-transaction-${transaction.id}`}><span className="text-ink-2">{transaction.date ?? row.month}</span><span className="truncate">{transaction.description}<span className="block text-[11px] text-pencil">{transaction.sourceName}{transaction.sourceLocation ? ` · ${transaction.sourceLocation}` : ""}</span></span><span>{transaction.direction === "spend" ? "−" : "+"}{money(transaction.amount)}</span></div>)}</div></details>}
              <details className="border-t border-rule pt-3 text-[13px]"><summary className="cursor-pointer text-ink-2">Transaction detail ({row.transactions.length})</summary><div className="mt-2 grid max-h-64 gap-1 overflow-auto">{row.transactions.map((transaction) => <div className="grid min-w-max grid-cols-[100px_minmax(220px,1fr)_auto] gap-3 border-b border-rule py-1.5 text-[12px]" key={transaction.id}><span className="text-ink-2">{transaction.date ?? row.month}</span><span><span className="block text-ink">{transaction.description}</span><span className="text-pencil">{transaction.category} · {transaction.sourceName}{transaction.sourceLocation ? ` · ${transaction.sourceLocation}` : ""}</span></span><span className="text-right text-ink">{transaction.direction === "spend" ? "−" : "+"}{money(transaction.amount)}</span></div>)}</div></details>
            </div>
          </section>;
        })()}

        {!hasFinancialOutput ? (
          evidence.length === 0 ? (
            <section className="grid gap-5 border-y border-rule py-6" aria-labelledby="getting-started-title">
              <div className="grid gap-2">
                <span className="text-[12px] uppercase tracking-[0.12em] text-ink-2">Start here</span>
                <h2 id="getting-started-title" className="display text-[28px] leading-[1.15]" style={{ fontVariationSettings: '"opsz" 28' }}>Build your first financial picture</h2>
                <p className="max-w-[58ch] text-[15px] leading-[1.5] text-ink-2">Start with the sources that establish cash and activity. Extraction, verification, and reconciliation are automated.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1 border-t border-rule pt-3 text-[13px]"><span className="text-[11px] uppercase tracking-[0.12em] text-pencil">1 · Cash</span><span className="text-ink">Upload a recent bank or brokerage statement.</span><span className="text-ink-2">Establishes balances and cash movements.</span><Button type="button" variant="outline" className="cursor-pointer mt-2" onClick={() => chooseFiles()}><FileText className="size-4" aria-hidden="true" /> Upload your records</Button></div>
                <div className="grid gap-1 border-t border-rule pt-3 text-[13px]"><span className="text-[11px] uppercase tracking-[0.12em] text-pencil">2 · Books</span><span className="text-ink">Add your general ledger or transaction detail.</span><span className="text-ink-2">Maps activity to accounting treatment.</span><Button type="button" variant="outline" className="cursor-pointer mt-2" onClick={() => chooseFiles("reference_model")}>Upload a financial model</Button></div>
                <div className="grid gap-1 border-t border-rule pt-3 text-[13px]"><span className="text-[11px] uppercase tracking-[0.12em] text-pencil">3 · Drivers</span><span className="text-ink">Add contracts, invoices, payroll, or obligations.</span><span className="text-ink-2">Actions outside accounting help create a grounded forecast.</span><Button type="button" variant="outline" className="cursor-pointer mt-2" onClick={() => composerInput.current?.focus()}>Start with a chat</Button></div>
              </div>
              <p className="text-[12px] text-pencil">PDF, CSV, Excel, QBO, OFX, and text files are supported. Reference models use `.xlsx`.</p>
            </section>
          ) : null
        ) : (
        <section className="grid gap-3.5">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <h2 className="display min-w-0 text-[22px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 22' }}>
              {selectedMonth ? periodLabel : "Company position"}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2 md:justify-end">
              {entityStructure.legalEntities.length > 0 && (
                <Select value={selectedEntity} onValueChange={setSelectedEntity}>
                  <SelectTrigger size="sm" className="h-7 rounded-md border-rule px-2 text-[13px] shadow-none dark:bg-transparent" aria-label="Entity view">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-rule">
                    <SelectItem value="consolidated">Consolidated</SelectItem>
                    {entityStructure.legalEntities.map((entity) => <SelectItem key={entity.id} value={entity.id}>{entity.name}{entity.consolidated ? "" : " (standalone)"}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {forecast.length > 0 && (
                <>
                  <Select value={periodPreset} onValueChange={selectPeriodPreset}>
                    <SelectTrigger size="sm" className="h-7 rounded-md border-rule px-2 text-[13px] shadow-none dark:bg-transparent" aria-label="Reporting period">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-rule">
                      <SelectItem value="month">Month to date</SelectItem>
                      <SelectItem value="quarter">Quarter to date</SelectItem>
                      <SelectItem value="ytd">Year to date</SelectItem>
                      <SelectItem value="last12">Last 12 months</SelectItem>
                      <SelectItem value="year">Calendar year</SelectItem>
                      <SelectItem value="custom">Custom range</SelectItem>
                    </SelectContent>
                  </Select>
                  {periodPreset !== "custom" && <label className="flex items-center gap-1.5 text-[12px] text-ink-2">Ending
                    <Input aria-label="Reporting period ending date" type="date" value={rangeEnd} onChange={(event) => { setRangeEnd(event.target.value); setSelectedMonth(event.target.value.slice(0, 7)); }} className="h-7 w-[148px] border-rule bg-background px-2 text-[13px] shadow-none" />
                  </label>}
                  <Select value={statementCadence} onValueChange={(value) => setStatementCadence(value as StatementCadence)}>
                    <SelectTrigger size="sm" className="h-7 rounded-md border-rule px-2 text-[13px] shadow-none dark:bg-transparent" aria-label="Statement aggregation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-rule">
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          </div>
          {periodPreset === "custom" && (
            <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-rule bg-rule/30 px-3 py-2.5">
              <label className="grid gap-1 text-[12px] text-ink-2">From
                <Input aria-label="Custom period start" type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} className="h-8 w-[164px] border-rule bg-background px-2 text-[13px] shadow-none" />
              </label>
              <label className="grid gap-1 text-[12px] text-ink-2">To
                <Input aria-label="Custom period end" type="date" value={customEnd} min={customStart || undefined} onChange={(event) => { setCustomEnd(event.target.value); setSelectedMonth(event.target.value.slice(0, 7)); }} className="h-8 w-[164px] border-rule bg-background px-2 text-[13px] shadow-none" />
              </label>
              <span className={cn("pb-1 text-[12px]", customRangeIsValid ? "text-pencil" : "text-red-ink")}>{customRangeIsValid ? "Inclusive dates; charts and statements are shown by the months they cover." : "End date must be on or after the start date."}</span>
            </div>
          )}
          {closeSummary?.month === selectedMonth && (
            <p className="text-[13px] text-ink-2">Closed with actual net {money(closeSummary.actualNet)} and variance {money(closeSummary.variance)}.</p>
          )}
          <p className={cn("text-[12px]", calculationBasis === "persisted" ? "text-ink-2" : "text-pencil")}>{calculationBasis === "persisted" ? "Reported from the current deterministic calculation run." : "Live preview — a current calculation run has not been persisted yet."}</p>
          {endingCashCalculation && <details className={cn("text-[12px]", endingCashCalculation.verification.status === "verified" ? "text-ink-2" : endingCashCalculation.verification.status === "exception" ? "text-red-ink" : "text-pencil")}>
            <summary className="cursor-pointer">Deterministic calculation · ending cash is {endingCashCalculation.verification.status}{endingCashCalculation.verification.reasons[0] ? `: ${endingCashCalculation.verification.reasons[0]}` : "."}</summary>
            <div className="mt-1 grid gap-0.5 pl-4 text-ink-2">
              <span>Formula: {endingCashCalculation.formula}</span>
              <span>{endingCashCalculation.inputNodeIds.length} calculation inputs · {endingCashCalculation.lineIds.length} source rows</span>
              {endingCashCalculation.verification.reasons.slice(1).map((reason) => <span key={reason}>{reason}</span>)}
              {calculationChecks.map((check) => <span key={check.id}>{check.label}: {check.verification.status}{check.verification.reasons[0] ? ` — ${check.verification.reasons[0]}` : ""}</span>)}
              <button type="button" className="w-fit underline underline-offset-2" onClick={() => setCalculationTraceOpen(true)}>Open calculation trace</button>
            </div>
          </details>}

          <div className="grid grid-cols-2 gap-6 border-y border-rule py-5 sm:grid-cols-5">
            <Figure
              label="Cash"
              value={currentForecast && currentForecast.hasCashBalance !== false ? money(currentForecast.endingCash) : "—"}
              note={currentForecast ? (currentForecast.hasCashBalance === false ? "No opening balance for this month" : showActuals ? "Ending cash" : "Projected ending cash") : "Awaiting opening balance"}
              pencil={Boolean(currentForecast) && !showActuals}
              negative={Boolean(currentForecast && currentForecast.endingCash < 0)}
            />
            <Figure
              label="Cash in"
              value={currentForecast ? money(showActuals ? currentForecast.actualReceipts : currentForecast.receipts) : "—"}
              note={currentForecast ? (showActuals ? "Posted actual cash" : "Projected journal entries") : "No posted entries yet"}
              pencil={Boolean(currentForecast) && !showActuals}
            />
            <Figure
              label="Cash out"
              value={currentForecast ? money(showActuals ? currentForecast.actualSpending : currentForecast.spending) : "—"}
              note={currentForecast ? (showActuals ? "Posted actual cash" : "Projected journal entries") : "No posted entries yet"}
              pencil={Boolean(currentForecast) && !showActuals}
            />
            <Figure
              label="Net"
              value={currentForecast ? money(showActuals ? currentForecast.actualReceipts - currentForecast.actualSpending : currentForecast.receipts - currentForecast.spending) : "—"}
              note={
                currentForecast
                  ? showActuals ? "Posted cash movement" : `${company.currency}, deterministic entry graph${assumedNote}`
                  : `${company.currency}, deterministic`
              }
              pencil={Boolean(currentForecast) && !showActuals}
              negative={Boolean(currentForecast && (showActuals ? currentForecast.actualReceipts - currentForecast.actualSpending : currentForecast.receipts - currentForecast.spending) < 0)}
            />
            <Figure
              label="Runway"
              value={runway ? (runway.runwayMonths === null ? `> ${runway.horizonMonths} mo` : `${runway.runwayMonths} mo`) : "—"}
              note={runway ? `${runway.cashOutMonth ? `Cash-out ${monthLabel(runway.cashOutMonth)}` : "No cash-out in horizon"}${BigInt(runway.trailingBurn3mMinor) > 0n ? ` · burn ${money(Number(runway.trailingBurn3mMinor) / 100)}/mo` : ""}${runway.cashOverTrailingBurn && Number(runway.cashOverTrailingBurn) !== 0 ? ` · ${runway.cashOverTrailingBurn}× burn` : ""}${runway.stale ? " · updating" : ""}` : "Forecast not calculated yet"}
              pencil
              negative={Boolean(runway?.runwayMonths !== null && runway?.runwayMonths !== undefined && runway.runwayMonths < 6)}
            />
          </div>
          {runway && <ForecastWhatChanged refreshKey={runway.revision} />}

          {bars.length ? (
            <div className="grid gap-2.5">
              <div className="flex gap-4 text-[13px] text-ink-2">
                <span><i className="mr-1.5 inline-block size-2.5 rounded-[2px] bg-ink align-[-1px]" />Actual</span>
                <span><i className="mr-1.5 inline-block size-2.5 rounded-[2px] bg-pencil-2 align-[-1px]" />Forecast</span>
              </div>
              <svg viewBox="0 0 720 170" preserveAspectRatio="none" className="block aspect-[720/170] h-auto w-full" role="img" aria-label={`Net cash flow by ${statementCadence}. Closed periods in ink, forecast periods in pencil.`}>
                <line x1="0" y1={zeroY} x2="720" y2={zeroY} className="stroke-rule" strokeWidth="1" />
                {bars.map((bar, index) => {
                  const slot = 720 / bars.length;
                  const width = Math.min(28, slot * 0.5);
                  const x = index * slot + (slot - width) / 2;
                  const height = Math.max(2, (Math.abs(bar.net) / maxAbs) * 65);
                  const negative = bar.net < 0;
                  const selected = bar.endMonth === selectedMonth;
                  return (
                    <g key={bar.month} className="cursor-pointer" onClick={() => { setSelectedMonth(bar.endMonth); setRangeEnd(lastDayOfMonth(bar.endMonth)); }}>
                      <title>{`${cadenceLabel(bar.month, statementCadence)}: ${money(bar.net)} ${bar.actual ? "actual" : "forecast"}`}</title>
                      <rect x={x} y={negative ? zeroY : zeroY - height} width={width} height={height} className={cn(negative ? "fill-red-ink" : bar.actual ? "fill-ink" : "fill-pencil-2")} opacity={negative && !bar.actual ? 0.35 : 1} />
                      <text x={x + width / 2} y="162" textAnchor="middle" fontSize="11" className={cn("font-sans", selected ? "fill-ink" : "fill-pencil")}>{statementCadence === "monthly" ? monthLabel(bar.month, shortMonthFormatter) : cadenceLabel(bar.month, statementCadence)}</text>
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
              <div className="flex items-center justify-between gap-3"><h3 className="text-[13px] uppercase tracking-[0.12em] text-ink-2">Financial statements</h3>{selectedMonth && <div className="flex items-center gap-1">{statementTab === "cash" && <FinancialInspector period={selectedMonth} section="cash_to_bank" label="Bank tie" view="actual" />}<FinancialInspector period={selectedMonth} section={statementTab === "income" ? "income_statement" : statementTab === "cash" ? "cash_flow" : "balance_sheet"} label="Inspect" view={selectedMonth <= new Date().toISOString().slice(0, 7) ? "actual" : "projected"} /></div>}</div>
              <div className="flex min-h-9 w-full flex-wrap border-b border-rule" role="tablist" aria-label="Financial statements">
                {([['income', 'Income statement'], ['cash', 'Cash flow statement'], ['balance', 'Balance sheet']] as const).map(([value, label]) => <button key={value} id={`financial-statement-tab-${value}`} type="button" role="tab" aria-selected={statementTab === value} aria-controls={`financial-statement-panel-${value}`} className={cn("shrink-0 border-b-2 px-3 py-2 text-[13px] text-ink-2", statementTab === value ? "border-ink text-ink" : "border-transparent hover:text-ink")} onClick={() => setStatementTab(value)}>{label}</button>)}
              </div>
              <div className="min-h-[220px] w-full rounded-lg border border-rule p-4">
                {statementTab === "income" && <div id="financial-statement-panel-income" role="tabpanel" aria-labelledby="financial-statement-tab-income">
                  <div className="text-[13px] text-ink-2">Income statement</div>
                  <div className="mt-2 grid gap-1 text-[13px]">
                    <span>Revenue <span className="float-right">{money(currentPnl?.revenue ?? 0)}</span></span>
                    <span>Expenses <span className="float-right">{money(currentPnl?.expenses ?? 0)}</span></span>
                    <span className="border-t border-rule pt-1 font-medium">Operating income <span className="float-right">{money(currentPnl?.operatingIncome ?? 0)}</span></span>
                  </div>
                  {currentPnl && <div className="mt-3 grid gap-1 border-t border-rule pt-2 text-[12px] text-ink-2"><span className="text-[11px] uppercase tracking-wide text-pencil">Revenue breakdown</span>{Object.entries(currentPnl.revenueByCategory).filter(([, amount]) => amount > 0).map(([category, amount]) => <span key={`revenue-${category}`} className="capitalize">{category.replace(/_/g, " ")} <span className="float-right">{money(amount)}</span></span>)}<span className="mt-1 text-[11px] uppercase tracking-wide text-pencil">Expense breakdown</span>{Object.entries(currentPnl.byCategory).filter(([, amount]) => amount !== 0).map(([category, amount]) => <span key={category} className="capitalize">{category.replace(/_/g, " ")} <span className="float-right">{money(amount)}</span></span>)}{currentPnl.allocatedOut ? <span>Allocated to other entities <span className="float-right">−{money(currentPnl.allocatedOut)}</span></span> : null}{currentPnl.uncategorized ? <span className="text-pencil">Uncategorized, shown in other <span className="float-right">{money(currentPnl.uncategorized)}</span></span> : null}</div>}
                  {currentPnl?.trace?.length ? <details className="mt-3 min-w-0 border-t border-rule pt-2 text-[12px]"><summary className="cursor-pointer text-ink-2">Transaction detail ({currentPnl.trace.length})</summary><div className="mt-2 grid max-h-40 min-w-0 gap-1 overflow-x-auto overflow-y-auto">{currentPnl.trace.map((line, index) => <span key={`${line.description}-${index}`} className="flex min-w-max justify-between gap-4 whitespace-nowrap"><span>{line.description ?? line.category}</span><span className="shrink-0">{line.direction === "spend" ? "−" : "+"}{money(line.amount)}</span></span>)}</div></details> : null}
                  {displayedPnlRows.length > 1 && <div className="mt-4 overflow-x-auto border-t border-rule pt-3"><table className="w-full text-[12px]"><thead><tr className="text-left text-ink-2"><th className="pb-2 font-normal">Period</th><th className="pb-2 text-right font-normal">Revenue</th><th className="pb-2 text-right font-normal">Expenses</th><th className="pb-2 text-right font-normal">Operating income</th></tr></thead><tbody>{displayedPnlRows.map((row) => <tr key={row.month} className="border-t border-rule"><td className="py-2">{cadenceLabel(row.month, statementCadence)}</td><td className="py-2 text-right">{money(row.revenue)}</td><td className="py-2 text-right">{money(row.expenses)}</td><td className="py-2 text-right">{money(row.operatingIncome)}</td></tr>)}</tbody></table></div>}
                </div>}
                {statementTab === "cash" && <div id="financial-statement-panel-cash" role="tabpanel" aria-labelledby="financial-statement-tab-cash">
                  <div className="text-[13px] text-ink-2">Cash flow statement{periodCashFlow && !periodCashFlow.ties ? <span className="text-red-ink"> · does not tie</span> : null}</div>
                  <div className="mt-2 grid gap-1 text-[13px]">
                    <span>Beginning period cash <span className="float-right">{money(periodCashFlow?.openingCash ?? currentForecast.openingCash ?? 0)}</span></span>
                    <span>Cash from operations <span className="float-right">{money(periodCashFlow?.operating ?? currentForecast.receipts - currentForecast.spending)}</span></span>
                    <span>Cash from investing <span className="float-right">{money(periodCashFlow?.investing ?? 0)}</span></span>
                    <span>Cash from financing <span className="float-right">{money(periodCashFlow?.financing ?? 0)}</span></span>
                    {periodCashFlow?.adjustments ? <span className="text-ink-2">Opening position adjustments <span className="float-right">{money(periodCashFlow.adjustments)}</span></span> : null}
                    <span className="border-t border-rule pt-1 font-medium">Ending cash <span className="float-right">{money(periodCashFlow?.endingCash ?? currentForecast.endingCash)}</span></span>
                  </div>
                  {periodCashFlow && <div className="mt-3 grid gap-1 border-t border-rule pt-2 text-[12px] text-ink-2"><span className="text-[11px] uppercase tracking-wide text-pencil">Operating reconciliation</span><span>Net income <span className="float-right">{money(periodCashFlow.netIncome)}</span></span>{periodCashFlow.eliminations ? <span>Intercompany eliminations <span className="float-right">{money(periodCashFlow.eliminations)}</span></span> : null}{Object.entries(periodCashFlow.changes).filter(([, amount]) => amount !== 0).map(([key, amount]) => { const asset = ["accountsReceivable", "prepaidExpenses", "dueFromAffiliates"].includes(key); return <span key={key}>{amount > 0 ? "Increase" : "Decrease"} in {key.replace(/([A-Z])/g, " $1").toLowerCase()} <span className="float-right">{money(asset ? -amount : amount)}</span></span>; })}<span className="border-t border-rule pt-1">Cash from operations <span className="float-right">{money(periodCashFlow.operatingIndirect)}</span></span>{periodCashFlow.transfers ? <span className="text-pencil">Transfers between own accounts <span className="float-right">{money(periodCashFlow.transfers)}</span></span> : null}</div>}
                  {currentForecast.trace && <div className="mt-3 grid max-h-36 min-w-0 gap-1 overflow-x-auto overflow-y-auto border-t border-rule pt-2 text-[12px] text-ink-2">{currentForecast.trace.filter((entry) => entry.amount).map((entry, index) => <span key={`${entry.description}-${index}`} className="flex min-w-max justify-between gap-4 whitespace-nowrap"><span>{entry.description}</span><span className="shrink-0">{entry.kind === "spend" ? "−" : "+"}{money(entry.amount ?? 0)}</span></span>)}</div>}
                  {displayedForecastRows.length > 1 && <div className="mt-4 overflow-x-auto border-t border-rule pt-3"><table className="w-full text-[12px]"><thead><tr className="text-left text-ink-2"><th className="pb-2 font-normal">Period</th><th className="pb-2 text-right font-normal">Beginning</th><th className="pb-2 text-right font-normal">Net change</th><th className="pb-2 text-right font-normal">Ending</th></tr></thead><tbody>{displayedForecastRows.map((row) => <tr key={row.month} className="border-t border-rule"><td className="py-2">{cadenceLabel(row.month, statementCadence)}</td><td className="py-2 text-right">{money(row.openingCash ?? 0)}</td><td className="py-2 text-right">{money(row.actualReceipts - row.actualSpending)}</td><td className="py-2 text-right">{money(row.endingCash)}</td></tr>)}</tbody></table></div>}
                </div>}
                {statementTab === "balance" && <div id="financial-statement-panel-balance" role="tabpanel" aria-labelledby="financial-statement-tab-balance">
                  <div className="flex items-baseline justify-between gap-3 text-[13px] text-ink-2"><span>Balance sheet{periodJournalStatement && !periodJournalStatement.balanceSheet.balanced ? <span className="text-red-ink"> · out of balance by {journalMoney(periodJournalStatement.balanceSheet.differenceMinor)}</span> : null}</span><span>As of {periodPreset === "custom" ? dateLabel(periodEnd) : monthLabel(currentForecast.month)}</span></div>
                  {periodJournalStatement ? (
                    <div className="mt-3 grid gap-1 text-[13px]">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-pencil">Assets</span>
                      {periodJournalStatement.balanceSheet.assets.map((line) => <span key={`asset-${line.key}`}>{line.label} <span className="float-right">{journalMoney(line.amountMinor)}</span></span>)}
                      <span className="border-t border-rule pt-1 font-medium">Total assets <span className="float-right">{journalMoney(periodJournalStatement.balanceSheet.totalAssetsMinor)}</span></span>
                      <span className="mt-2 text-[11px] font-medium uppercase tracking-wide text-pencil">Liabilities</span>
                      {periodJournalStatement.balanceSheet.liabilities.map((line) => <span key={`liability-${line.key}`}>{line.label} <span className="float-right">{journalMoney(line.amountMinor)}</span></span>)}
                      <span className="mt-2 text-[11px] font-medium uppercase tracking-wide text-pencil">Equity</span>
                      {periodJournalStatement.balanceSheet.equity.map((line) => <span key={`equity-${line.key}`}>{line.label} <span className="float-right">{journalMoney(line.amountMinor)}</span></span>)}
                      <span>Retained earnings <span className="float-right">{journalMoney(periodJournalStatement.balanceSheet.retainedEarningsMinor)}</span></span>
                      <span className="border-t border-rule pt-1 font-medium">Total liabilities and equity <span className="float-right">{journalMoney(periodJournalStatement.balanceSheet.totalLiabilitiesAndEquityMinor)}</span></span>
                    </div>
                  ) : (
                    <p className="mt-2 text-[13px] text-ink-2">No posted journal balance sheet is available for this period.</p>
                  )}
                  {approvedBalanceSheet && (
                    <div className={cn("mt-3 border-t border-rule pt-2 text-[12px]", totalAssets !== undefined && periodJournalAssets !== undefined && Math.abs(totalAssets - periodJournalAssets) > 0.01 ? "text-red-ink" : "text-ink-2")}>
                      Reported by {shortFileName(approvedBalanceSheet.sourceName)}: total assets {totalAssets === undefined ? "not approved" : money(totalAssets)}, liabilities {totalLiabilities === undefined ? "not approved" : money(totalLiabilities)}, equity {shareholdersEquity === undefined ? "not approved" : money(shareholdersEquity)}{totalAssets !== undefined && periodJournalAssets !== undefined ? ` · differs from the posted journal sheet by ${money(totalAssets - periodJournalAssets)}` : ""}.
                    </div>
                  )}
                  {periodForecastRows.length > 1 && <div className="mt-4 overflow-x-auto border-t border-rule pt-3"><table className="w-full text-[12px]"><thead><tr className="text-left text-ink-2"><th className="pb-2 font-normal">Period</th><th className="pb-2 text-right font-normal">Cash</th><th className="pb-2 text-right font-normal">Total assets</th><th className="pb-2 text-right font-normal">Liabilities</th><th className="pb-2 text-right font-normal">Equity</th></tr></thead><tbody>{periodForecastRows.map((row) => <tr key={row.month} className="border-t border-rule"><td className="py-2">{monthLabel(row.month)}</td><td className="py-2 text-right">{money(row.endingCash)}</td><td className="py-2 text-right">{money(row.balanceSheet?.assets ?? row.endingCash)}</td><td className="py-2 text-right">{money(row.balanceSheet?.liabilities ?? 0)}</td><td className="py-2 text-right">{money(row.balanceSheet?.equity ?? row.endingCash)}</td></tr>)}</tbody></table></div>}
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
        )}
      </main>

      <UsageModal open={usageOpen} onOpenChange={setUsageOpen} companyName={company.name} />
      <AccountingModal open={accountingOpen} onOpenChange={setAccountingOpen} initialPeriod={selectedMonth} />

      <Dialog open={calculationTraceOpen} onOpenChange={setCalculationTraceOpen}>
        <DialogContent className="max-h-[84vh] gap-0 overflow-hidden rounded-xl border-rule bg-[#f7f7f8] p-0 dark:bg-[#1b1c20] sm:max-w-[900px]">
          <DialogHeader className="border-b border-rule px-6 py-6 pr-14 text-left">
            <DialogTitle className="display text-[26px] font-medium" style={{ fontVariationSettings: '"opsz" 26' }}>Calculation trace</DialogTitle>
            <DialogDescription>{calculationRun ? `${monthLabel(calculationRun.horizonStart, shortMonthFormatter)} through ${monthLabel(calculationRun.horizonEnd, shortMonthFormatter)} · engine ${calculationRun.engineVersion} · ${calculationRun.verificationStatus}` : "Loading the latest persisted deterministic run…"}</DialogDescription>
            {calculationRun && (!calculationRun.isCurrentFormula || !calculationRun.isCurrentState) && <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-pencil"><span>{!calculationRun.isCurrentFormula ? "This run uses an earlier formula version." : "Financial state changed after this run."}</span><button type="button" className="underline underline-offset-2 disabled:opacity-50" disabled={isRecalculating} onClick={recalculateBaseCase}>{isRecalculating ? "Recalculating…" : "Recalculate current base case"}</button></div>}
          </DialogHeader>
          {calculationRunHistory.length > 1 && <div className="flex gap-2 overflow-x-auto border-b border-rule px-6 py-3 text-[12px]">{calculationRunHistory.map((run) => <button type="button" key={run.id} onClick={() => loadCalculationTrace(run.id)} className={cn("shrink-0 rounded-md border px-2.5 py-1.5 text-left", calculationRun?.id === run.id ? "border-ink bg-ink text-paper" : "border-rule bg-background text-ink-2")}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(run.createdAt))}</button>)}</div>}
          <ScrollArea className="max-h-[66vh] px-6 py-4">
            {!calculationRun ? <p className="text-[14px] text-ink-2">No persisted calculation run yet. The next approved financial change will create one.</p> : <div className="grid gap-3">{calculationNodes.filter((node) => node.kind !== "source_line").map((node) => <details className="rounded-lg border border-rule bg-background px-4 py-3" key={node.id}>
              <summary className="cursor-pointer text-[14px] text-ink"><span>{node.label}</span><span className={cn("ml-2 text-[12px]", node.verificationStatus === "exception" ? "text-red-ink" : node.verificationStatus === "verified" ? "text-ink-2" : "text-pencil")}>{node.verificationStatus}</span></summary>
              <div className="mt-2 grid gap-1 text-[12px] text-ink-2"><span>Formula: {node.formula}</span><span>Result: {typeof node.value === "number" ? money(node.value) : String(node.value)}</span><span>{node.inputNodeIds.length} inputs · {node.lineIds.length} source rows</span>{node.provenance.length ? <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span>Sources:</span>{[...new Map(node.provenance.map((source) => [source.evidenceId ?? source.sourceName ?? "recorded source", source])).values()].map((source) => <span className="inline-flex gap-1" key={source.evidenceId ?? source.sourceName ?? "recorded-source"}>{source.evidenceId ? <button type="button" className="underline underline-offset-2" onClick={() => { setCalculationTraceOpen(false); setSelectedEvidenceId(source.evidenceId!); setDocumentsOpen(true); }}>{source.sourceName ?? "Open source"}</button> : <span>{source.sourceName ?? "recorded source"}</span>}{source.sourceLocation ? <span>· {source.sourceLocation}</span> : null}</span>)}</div> : null}{node.verificationReasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
            </details>)}</div>}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={documentsOpen} onOpenChange={setDocumentsOpen}>
        <DialogContent className="max-h-[84vh] gap-0 overflow-hidden rounded-xl border-rule bg-[#f7f7f8] p-0 dark:bg-[#1b1c20] sm:max-w-[1080px]">
          <DialogHeader className="border-b border-rule px-6 py-6 pr-14 text-left">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1"><DialogTitle className="display text-[26px] font-medium" style={{ fontVariationSettings: '"opsz" 26' }}>Documents</DialogTitle>
              <DialogDescription>Every loaded source, what it established, and the facts extracted from it.</DialogDescription></div>
              <Button type="button" variant="outline" className="cursor-pointer rounded-full" onClick={() => { setDocumentsOpen(false); chooseFiles("reference_model"); }}>Upload reference model</Button>
            </div>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2 border-b border-rule px-6 py-3 text-[12px] text-ink-2 sm:grid-cols-4 lg:grid-cols-8" aria-label="Review readiness">
            <span><strong className="block text-[16px] font-normal text-ink">{evidence.length}</strong>documents</span>
            <span><strong className="block text-[16px] font-normal text-ink">{evidence.reduce((total, item) => total + (item.extraction?.facts.length ?? 0), 0)}</strong>facts</span>
            <span><strong className="block text-[16px] font-normal text-ink">{new Set(evidence.map((item) => item.sourceName)).size}</strong>sources</span>
            <span><strong className="block text-[16px] font-normal text-ink">{reconciliation.reduce((total, row) => total + row.duplicateCount, 0)}</strong>matches</span>
            <span><strong className="block text-[16px] font-normal text-ink">{reconciliation.reduce((total, row) => total + row.exceptions.length, 0)}</strong>exceptions</span>
            <span><strong className="block text-[16px] font-normal text-ink">{reviewQuestions.length + reconciliation.reduce((total, row) => total + (row.reviewQuestions?.length ?? 0), 0)}</strong>questions</span>
            <span><strong className="block text-[16px] font-normal text-ink">{pendingEvidence.length}</strong>awaiting approval</span>
            <span><strong className="block text-[16px] font-normal text-ink">{processingEvidence.length}</strong>processing</span>
          </div>
          <section className="grid gap-2 border-b border-rule px-6 py-3" aria-label="Evidence coverage">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[11px] uppercase tracking-[0.12em] text-ink-2">Evidence coverage</h3><span className="text-[12px] text-ink-2">{coveredMonths.length ? coveredMonths.map((month) => monthLabel(month, shortMonthFormatter)).join(" · ") : "No dated periods found"}</span></div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">{discoveredAccounts.length ? discoveredAccounts.map((account) => <span key={`${account.holder ?? ""}-${account.identifier ?? ""}`}>{account.holder ?? "Account"}{account.identifier ? ` · ${account.identifier}` : ""}{account.currency ? ` · ${account.currency}` : ""}</span>) : <span>No account identifiers extracted yet.</span>}</div>
          </section>
          {reviewQuestions.some((question) => question.reviewKey?.startsWith("onboarding:")) && <section className="grid gap-2 border-b border-rule px-6 py-3" aria-label="Onboarding queue">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[11px] uppercase tracking-[0.12em] text-ink-2">Onboarding queue</h3><span className="text-[12px] text-ink-2">Only company specifics the evidence cannot establish</span></div>
            <div className="grid gap-2 text-[13px]">{reviewQuestions.filter((question) => question.reviewKey?.startsWith("onboarding:")).map((question) => <div className="flex items-start justify-between gap-3 border-t border-rule pt-2" key={question.id}><span className="text-ink-2">{question.question}</span><button type="button" className="shrink-0 underline underline-offset-2" onClick={() => { setDocumentsOpen(false); answerInChat(question); }}>Answer</button></div>)}</div>
          </section>}
          {reconciliation.length > 0 && <section className="grid gap-2 border-b border-rule px-6 py-3" aria-label="Initial review report">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[11px] uppercase tracking-[0.12em] text-ink-2">Initial review report</h3><span className="flex items-center gap-3 text-[12px] text-ink-2">Review before relying on financial state <button className="underline underline-offset-2 disabled:opacity-50" type="button" onClick={() => refreshReconciliation(true)} disabled={isReconciling}>{isReconciling ? "Reviewing…" : "Run review again"}</button></span></div>
            <div className="grid gap-1.5 text-[12px]">
              {reconciliation.map((row) => <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-t border-rule pt-1.5" key={`report-${row.month}`}>
                <span className="text-ink">{monthLabel(row.month, shortMonthFormatter)}</span>
                <span className="min-w-0 truncate text-ink-2">{row.opening === undefined ? "Opening missing" : `Opening ${money(row.opening)}`} · {row.ending === undefined ? "ending missing" : `ending ${money(row.ending)}`} · {row.transactionCount} transactions · {row.duplicateCount} matches</span>
                <span className={cn("whitespace-nowrap", row.status === "reconciled" ? "text-ink" : "text-red-ink")}>{row.status === "reconciled" ? "Ready" : `${row.exceptions.length} exception${row.exceptions.length === 1 ? "" : "s"}`}</span>
              </div>)}
            </div>
          </section>}
          {evidence.some((item) => item.ingestionRuns?.length) && <section className="grid gap-2 border-b border-rule px-6 py-3" aria-label="Recent processing activity">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[11px] uppercase tracking-[0.12em] text-ink-2">Recent processing activity</h3><span className="text-[12px] text-ink-2">Last 8 stages</span></div>
            <div className="grid gap-1.5 text-[12px]">
              {evidence.flatMap((item) => (item.ingestionRuns ?? []).map((run) => ({ ...run, sourceName: item.sourceName }))).sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 8).map((run) => <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-rule pt-1.5" key={`activity-${run.id}`}><span className="min-w-0 truncate text-ink" title={run.sourceName}>{shortFileName(run.sourceName)}</span><span className="capitalize text-ink-2">{run.stage.replace(/_/g, " ")}</span><span className={cn("whitespace-nowrap", (run.status === "failed" || run.status === "interrupted") ? "text-red-ink" : "text-ink-2")}>{processingStatusLabel(run.status)}</span></div>)}
            </div>
          </section>}
          <div className="grid min-h-0 md:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.5fr)]">
            <ScrollArea className="max-h-[64vh] border-b border-rule md:border-b-0 md:border-r">
              <div className="grid p-3">
                {evidence.length === 0 ? (
                  <Empty className="border-0 py-16"><EmptyHeader><EmptyMedia variant="icon"><FileText aria-hidden="true" /></EmptyMedia><EmptyTitle>No documents loaded</EmptyTitle><EmptyDescription>Uploaded statements and other evidence will appear here.</EmptyDescription></EmptyHeader></Empty>
                ) : evidence.map((item) => (
                  <button key={item.id} type="button" onClick={() => setSelectedEvidenceId(item.id)} className={cn("grid gap-1 rounded-lg px-3 py-3 text-left transition-colors hover:bg-background", selectedEvidenceId === item.id && "bg-background shadow-sm")}>
                    <span className="line-clamp-2 text-[14px] text-ink">{item.sourceName}</span>
                    {(item.sourceMetadata?.sourceRole === "reference_model" || item.sourceMetadata?.classification?.kind === "financial_model") && <span className="w-fit rounded-sm bg-rule px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-2">Reference model</span>}
                    <span className="text-[12px] text-ink-2">{item.ingestionStatus ?? item.status} · {item.extraction?.facts.length ?? 0} facts · {item.extraction?.questions.length ?? 0} source questions</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <ScrollArea className="max-h-[64vh]">
              {(() => {
                const item = evidence.find((entry) => entry.id === selectedEvidenceId) ?? evidence[0];
                if (!item) return <Empty className="border-0 py-16"><EmptyHeader><EmptyTitle>Select a document</EmptyTitle></EmptyHeader></Empty>;
                const changes = processingChanges(item.ingestionRuns);
                const timeline = processingTimeline(item);
                const isReferenceModel = item.sourceMetadata?.sourceRole === "reference_model" || item.sourceMetadata?.classification?.kind === "financial_model";
                const workbook = item.sourceMetadata?.workbook;
                const formulaCount = workbook?.worksheets.reduce((total, sheet) => total + sheet.formulas, 0) ?? 0;
                const workbookReview = item.sourceMetadata?.workbookReview ?? {};
                const workbookProposal = item.sourceMetadata?.workbookProposal;
                const reviewedWorksheetCount = Object.keys(workbookReview).length;
                return <div className="grid gap-5 p-6">
                  <div className="grid min-w-0 gap-1 overflow-hidden"><div className="break-words text-[17px] text-ink [overflow-wrap:anywhere]">{item.extraction?.summary ?? item.sourceName}</div><div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2"><span className="max-w-full break-words [overflow-wrap:anywhere]">{item.sourceName}{item.sourceSize ? ` · ${Math.round(Number(item.sourceSize) / 1024)} KB` : ""} · {item.ingestionStatus ?? item.status}</span>{item.ingestionError ? <span className="max-w-full break-words text-red-ink [overflow-wrap:anywhere]" title={item.ingestionError}>{readableProcessingError(item.ingestionError)}</span> : null}{item.storageReference ? <><span className="text-ink">Original stored</span><a className="underline underline-offset-2" href={`/api/evidence/${item.id}/file`}>Download original</a><button type="button" className="underline underline-offset-2 disabled:opacity-50" onClick={() => reprocessEvidence(item)} disabled={reprocessingEvidenceId === item.id}>{reprocessingEvidenceId === item.id ? "Reprocessing…" : "Reprocess original"}</button></> : <span className="text-red-ink">Original not stored</span>}</div>{item.sourceMetadata?.pdfQuality?.status !== "good" && item.sourceMetadata?.pdfQuality?.warnings?.length ? <div className="mt-2 max-w-full break-words rounded-lg border border-red-ink/30 bg-red-ink/5 p-3 text-[13px] text-red-ink [overflow-wrap:anywhere]"><span className="font-medium">PDF extraction needs review.</span> {item.sourceMetadata.pdfQuality.warnings.join(" ")}</div> : null}</div>
                  {isReferenceModel && <section className="grid gap-4 rounded-lg border border-rule bg-rule/30 p-4" aria-label="Reference-model review">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1"><span className="text-[11px] uppercase tracking-[0.12em] text-ink-2">Reference financial model</span><h3 className="text-[16px] font-medium text-ink">Workbook review</h3><p className="max-w-[62ch] text-[13px] leading-5 text-ink-2">This file is onboarding context: it can teach Nevermodel the company&apos;s structure, periods, and drivers. Its formulas and outputs are never posted as actuals or treated as verified financial results.</p></div>
                      <Button type="button" variant="outline" className="cursor-pointer rounded-full" onClick={() => reviewReferenceModel(item)}>Review in chat</Button>
                    </div>
                    {workbook ? <>
                      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-ink-2"><div className="flex flex-wrap gap-x-4 gap-y-1"><span><strong className="font-medium text-ink">{workbook.worksheetCount}</strong> worksheets</span><span><strong className="font-medium text-ink">{formulaCount.toLocaleString()}</strong> formulas</span><span><strong className="font-medium text-ink">{workbook.definedNames.length}</strong> named ranges</span></div><Button type="button" variant="ghost" className="cursor-pointer px-0 text-[12px] underline underline-offset-2" disabled={savingWorkbookReviewId === item.id} onClick={() => saveWorkbookReview(item, Object.fromEntries(workbook.worksheets.map((sheet) => [sheet.name, suggestedWorkbookSheetRole(sheet.name, sheet.sampleLabels)])))}>{savingWorkbookReviewId === item.id ? "Saving…" : "Use suggested roles"}</Button></div>
                      <div className="overflow-x-auto border-y border-rule"><table className="w-full min-w-[670px] text-left text-[12px]"><thead className="text-ink-2"><tr><th className="py-2 pr-3 font-normal">Worksheet</th><th className="py-2 pr-3 text-right font-normal">Size</th><th className="py-2 pr-3 text-right font-normal">Formulas</th><th className="py-2 pr-3 font-normal">Example labels</th><th className="py-2 font-normal">Use as</th></tr></thead><tbody>{workbook.worksheets.map((sheet) => { const savedRole = item.sourceMetadata?.workbookReview?.[sheet.name]; const suggestedRole = suggestedWorkbookSheetRole(sheet.name, sheet.sampleLabels); return <tr className="border-t border-rule" key={sheet.name}><td className="py-2 pr-3 font-medium text-ink">{sheet.name}</td><td className="py-2 pr-3 text-right text-ink-2">{sheet.rows.toLocaleString()} × {sheet.columns.toLocaleString()}</td><td className="py-2 pr-3 text-right text-ink-2">{sheet.formulas.toLocaleString()}</td><td className="max-w-[210px] py-2 pr-3 text-ink-2">{sheet.sampleLabels.length ? sheet.sampleLabels.join(" · ") : "No labels sampled"}</td><td className="py-2"><div className="grid gap-0.5"><Select value={savedRole ?? suggestedRole} onValueChange={(value) => saveWorkbookReview(item, { [sheet.name]: value as WorkbookSheetRole })} disabled={savingWorkbookReviewId === item.id}><SelectTrigger size="sm" className="h-7 min-w-[156px] border-rule bg-background text-[12px]"><SelectValue /></SelectTrigger><SelectContent className="border-rule">{(Object.keys(workbookSheetRoleLabels) as WorkbookSheetRole[]).map((role) => <SelectItem key={role} value={role}>{workbookSheetRoleLabels[role]}</SelectItem>)}</SelectContent></Select>{!savedRole && <span className="text-[10px] text-pencil">Suggested</span>}</div></td></tr>; })}</tbody></table></div>
                      {workbook.definedNames.length > 0 && <div className="text-[12px] text-ink-2"><span className="font-medium text-ink">Named ranges:</span> {workbook.definedNames.slice(0, 12).join(" · ")}{workbook.definedNames.length > 12 ? ` · +${workbook.definedNames.length - 12} more` : ""}</div>}
                      <section className="grid gap-3 border-t border-rule pt-3" aria-label="Workbook onboarding proposals"><div className="flex flex-wrap items-baseline justify-between gap-3"><div><h4 className="text-[12px] font-medium text-ink">Onboarding proposals</h4><p className="mt-0.5 text-[12px] text-ink-2">Draft a review brief from the selected worksheet roles. Suggestions never create accounts, history, drivers, or entries.</p></div><Button type="button" variant="outline" className="cursor-pointer rounded-full" disabled={reviewedWorksheetCount === 0 || draftingWorkbookProposalId === item.id} onClick={() => draftWorkbookProposal(item)}>{draftingWorkbookProposalId === item.id ? "Drafting…" : workbookProposal ? "Refresh proposals" : "Draft proposals"}</Button></div>
                        {reviewedWorksheetCount === 0 ? <p className="text-[12px] text-pencil">Save at least one worksheet role to draft proposals.</p> : workbookProposal ? <div className="grid gap-3 text-[12px] text-ink-2"><div className="flex flex-wrap gap-x-4 gap-y-1"><span><strong className="font-medium text-ink">{workbookProposal.chartAccountMappings.length}</strong> account suggestions</span><span><strong className="font-medium text-ink">{workbookProposal.historicalCoverage.length}</strong> historical coverage items</span><span><strong className="font-medium text-ink">{workbookProposal.forecastDrivers.length}</strong> forecast drivers</span><span><strong className="font-medium text-ink">{workbookProposal.questions.length}</strong> questions</span></div>{workbookProposal.chartAccountMappings.length > 0 && <details><summary className="cursor-pointer text-ink">Suggested account semantics</summary><div className="mt-2 grid gap-1.5">{workbookProposal.chartAccountMappings.map((proposal, index) => { const proposalId = `account-${index + 1}`; const summary = `${proposal.suggestedAccountName} is suggested as ${proposal.accountType}/${proposal.statementSection} from ${proposal.worksheet}: ${proposal.reason}`; const approved = item.sourceMetadata?.workbookProposalReview?.[proposalId] === "approved"; const applied = item.sourceMetadata?.workbookProposalApplication?.[proposalId]; const applying = applyingWorkbookProposalKey === `${item.id}:${proposalId}`; return <div className="flex items-start justify-between gap-3 border-t border-rule pt-1.5" key={`${proposal.worksheet}-${proposal.sourceLabel}-${index}`}><p><span className="text-ink">{proposal.suggestedAccountName}</span> · {proposal.accountType} / {proposal.statementSection} · {proposal.worksheet} · {proposal.reason}</p><div className="flex shrink-0 items-center gap-2">{workbookProposalActions(item, proposalId, summary)}{applied ? <span className="text-[11px] text-ink-2">Draft created</span> : approved ? <button type="button" className="cursor-pointer text-[11px] underline underline-offset-2 disabled:opacity-50" disabled={applying} onClick={() => applyWorkbookAccountProposal(item, proposalId)}>{applying ? "Creating…" : "Create draft account"}</button> : null}</div></div>; })}</div></details>}{workbookProposal.historicalCoverage.length > 0 && <details><summary className="cursor-pointer text-ink">Historical coverage</summary><div className="mt-2 grid gap-1.5">{workbookProposal.historicalCoverage.map((coverage, index) => { const summary = `${coverage.period} ${coverage.statement} coverage from ${coverage.worksheet}: ${coverage.reason}`; return <div className="flex items-start justify-between gap-3 border-t border-rule pt-1.5" key={`${coverage.worksheet}-${coverage.period}-${index}`}><p><span className="text-ink">{coverage.period}</span> · {coverage.statement} · {coverage.worksheet} · {coverage.reason}</p>{workbookProposalActions(item, `history-${index + 1}`, summary)}</div>; })}</div></details>}{workbookProposal.forecastDrivers.length > 0 && <details><summary className="cursor-pointer text-ink">Forecast drivers</summary><div className="mt-2 grid gap-1.5">{workbookProposal.forecastDrivers.map((driver, index) => { const summary = `${driver.driver} (${driver.unit}) from ${driver.worksheet}: ${driver.rationale}`; return <div className="flex items-start justify-between gap-3 border-t border-rule pt-1.5" key={`${driver.worksheet}-${driver.driver}-${index}`}><p><span className="text-ink">{driver.driver}</span> · {driver.unit} · {driver.worksheet} · {driver.rationale}</p>{workbookProposalActions(item, `driver-${index + 1}`, summary)}</div>; })}</div></details>}{workbookProposal.questions.length > 0 && <details><summary className="cursor-pointer text-ink">Questions to resolve</summary><div className="mt-2 grid gap-1.5">{workbookProposal.questions.map((question, index) => <div className="flex items-start justify-between gap-3 border-t border-rule pt-1.5" key={`${question}-${index}`}><p>{question}</p>{workbookProposalActions(item, `question-${index + 1}`, question)}</div>)}</div></details>}</div> : null}
                      </section>
                    </> : <p className="text-[13px] text-ink-2">Workbook structure will appear once spreadsheet inspection is complete. The original file remains safely separated from posted financial records.</p>}
                    <p className="border-t border-rule pt-3 text-[12px] text-pencil">Selected structural roles are saved as sourced accounting or forecast knowledge. Next: review the resulting chart, history, and driver mappings in chat.</p>
                  </section>}
                  {item.sourceExcerpt && !repeatsSummary(item.sourceExcerpt, item.extraction?.summary) && <div className="rounded-lg bg-background p-3 text-[13px] leading-5 text-ink-2">“{item.sourceExcerpt.replace(/\s+/g, " ").trim()}”</div>}
                  <section className="grid gap-2"><h3 className="text-[12px] uppercase tracking-[0.12em] text-ink-2">Known facts</h3>{item.extraction?.facts.length ? <div className="grid gap-2">{item.extraction.facts.map((fact, factIndex) => <div key={fact.factId ?? `${item.id}-known-fact-${factIndex}`} className="grid gap-0.5 border-t border-rule pt-2 text-[13px]"><span className="text-ink">{fact.label}</span><span className="text-ink-2">{fact.value} <span className="text-pencil">({Math.round(fact.confidence * 100)}% confidence{fact.accountingRole ? ` · ${fact.accountingRole.replace(/_/g, " ")}` : ""})</span></span></div>)}</div> : <p className="text-[13px] text-ink-2">No facts were extracted.</p>}</section>
                  <section className="grid gap-2 border-t border-rule pt-4"><h3 className="text-[12px] uppercase tracking-[0.12em] text-ink-2">Unknowns and questions</h3>{item.extraction?.questions.length ? <div className="grid gap-2">{item.extraction.questions.map((question, questionIndex) => <div key={`${item.id}-question-${questionIndex}`} className="mark text-[13px]">{question}</div>)}</div> : <p className="text-[13px] text-ink-2">No unresolved questions attached to this document.</p>}</section>
                  <section className="grid gap-2 border-t border-rule pt-4" aria-label="Processing timeline"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[12px] uppercase tracking-[0.12em] text-ink-2">Processing timeline</h3><span className="text-[12px] text-pencil">{ingestionStatusLabel(item)}</span></div><div className="grid gap-0.5">{timeline.map((stage, index) => <div className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2 text-[13px]" key={stage.key}><span className={cn("mt-1.5 size-2 rounded-full", stage.status === "succeeded" ? "bg-ink" : (stage.status === "failed" || stage.status === "interrupted") ? "bg-red-ink" : stage.status === "running" ? "bg-ink-2" : "bg-rule ring-1 ring-ink-2/30")} aria-hidden="true" /> <span className={cn(index < timeline.length - 1 && "border-b border-rule pb-2", (stage.status === "failed" || stage.status === "interrupted") ? "text-red-ink" : "text-ink")}>{stage.label}{stage.detail ? <span className="block text-[12px] text-ink-2">{stage.detail}</span> : null}</span><span className={cn("text-[12px]", (stage.status === "failed" || stage.status === "interrupted") ? "text-red-ink" : "text-ink-2")}>{processingStatusLabel(stage.status)}</span></div>)}</div></section>
                  <section className="grid gap-2 border-t border-rule pt-4" aria-label="Live processing results"><h3 className="text-[12px] uppercase tracking-[0.12em] text-ink-2">Live results</h3><div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2"><span>{item.extraction?.facts.length ?? 0} facts extracted</span><span>{item.extraction?.questions.length ?? 0} source questions</span>{item.statementPeriodStart || item.statementPeriodEnd ? <span>{item.statementPeriodStart ?? "Unknown start"} → {item.statementPeriodEnd ?? "Unknown end"}</span> : null}{item.accountIdentifier ? <span>Account · ••••{item.accountIdentifier.replace(/[^0-9A-Za-z]/g, "").slice(-4)}</span> : null}</div></section>
                  <section className="grid gap-2 border-t border-rule pt-4" aria-label="Approval history"><h3 className="text-[12px] uppercase tracking-[0.12em] text-ink-2">Approval history</h3>{item.approvals?.length ? <div className="grid gap-1.5">{item.approvals.map((approval) => <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]" key={approval.id}><span className="text-ink"><span className="capitalize">{approval.layer}</span> · {approval.action.replace(/_/g, " ")}</span><span className="text-ink-2">{approval.userName ?? approval.userEmail ?? "CFO"} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(approval.createdAt))}</span></div>)}</div> : <p className="text-[13px] text-ink-2">No approvals recorded yet.</p>}</section>
                  {changes?.changes && (changes.changes.added.length || changes.changes.removed.length || changes.changes.changed.length) ? <section className="grid gap-2 border-t border-rule pt-4"><h3 className="text-[12px] uppercase tracking-[0.12em] text-ink-2">What changed</h3><div className="grid gap-1 text-[13px] text-ink-2"><span>{changes.changes.added.length} added · {changes.changes.removed.length} removed · {changes.changes.changed.length} changed</span>{changes.changes.changed.map((change) => <span key={`changed-${change.label}`}><span className="text-ink">{change.label}:</span> {change.before} → {change.after}</span>)}{changes.changes.added.map((fact) => <span key={`added-${fact.label}`}><span className="text-ink">Added {fact.label}:</span> {fact.value}</span>)}{changes.changes.removed.map((fact) => <span key={`removed-${fact.label}`}><span className="text-ink">Removed {fact.label}:</span> {fact.value}</span>)}</div><span className="text-[12px] text-pencil">Reconciliation and forecast impact: pending refresh.</span></section> : null}
                </div>;
              })()}
            </ScrollArea>
          </div>
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
