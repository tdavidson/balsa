"use client";

import { Check, Pencil, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { confidenceThresholdOptions } from "@/lib/review-assessment";
import type { QueueItem, ReviewQueue } from "@/lib/review-queue";

const percent = (value: number) => `${Math.round(value * 100)}%`;
const roleLabel = (role: string | undefined) => (role ?? "unknown").replace(/_/g, " ");
const actionButton = "grid size-7 place-items-center rounded-md border border-rule text-ink-2 transition-colors hover:bg-rule hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50 [&_svg]:size-3.5";
const quietLink = "text-ink-2 underline-offset-2 hover:text-ink hover:underline disabled:opacity-50";
const sectionLabel = "border-b border-rule py-2.5 text-[12px] uppercase tracking-[0.12em] text-ink-2";
const initialDecisions = 5;

export type DecisionReviewProps = {
  queue: ReviewQueue;
  threshold: number | null;
  canChangeThreshold: boolean;
  roleOptions: readonly string[];
  busyKey: string | null;
  onThresholdChange: (value: number | null) => void;
  onConfirmDocument: (evidenceId: string) => void;
  onRejectDocument: (evidenceId: string) => void;
  onEditDocument: (evidenceId: string) => void;
  onOpenEvidence: (evidenceId: string) => void;
  onAcceptFact: (item: QueueItem, accountingRole: string) => void;
  onRejectFact: (item: QueueItem) => void;
  onReopenFact: (item: QueueItem) => void;
  onAcceptMinor: (evidenceId: string) => void;
};

/** The owner's confidence level, phrased as the decision it is. */
function ConfidenceControl({ threshold, canChange, onChange }: { threshold: number | null; canChange: boolean; onChange: (value: number | null) => void }) {
  const options: { value: number | null; label: string }[] = [{ value: null, label: "Always ask" }, ...confidenceThresholdOptions.map((value) => ({ value, label: percent(value) }))];
  return (
    <div className="grid gap-2 border-b border-rule py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-ink">Proceed without asking when Balsa is at least</span>
        <span className="inline-flex rounded-md border border-rule p-0.5" role="radiogroup" aria-label="Confidence needed to proceed without asking">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={threshold === option.value}
              disabled={!canChange}
              className={cn("rounded px-2 py-0.5 text-[12px] text-ink-2 transition-colors hover:text-ink disabled:cursor-not-allowed", threshold === option.value && "bg-ink text-paper hover:text-paper")}
              onClick={() => { if (threshold !== option.value) onChange(option.value); }}
            >{option.label}</button>
          ))}
        </span>
        <span className="text-ink">confident.</span>
      </div>
      <p className="text-[12px] text-ink-2">
        {threshold === null ? "Balsa asks about every extracted fact." : `Facts Balsa can check at ${percent(threshold)} or higher are accepted as assumptions and listed below, where you can reopen any of them.`}
        {" "}Confidence is the extraction&apos;s own estimate, lowered when the amount is not found in the source, is unreadable, or has no accounting role.
        {!canChange ? " Only the company owner changes this level." : ""}
      </p>
    </div>
  );
}

function FactRow({ item, roleOptions, busy, onAccept, onReject, onOpenEvidence, quiet = false }: { item: QueueItem; roleOptions: readonly string[]; busy: boolean; onAccept: (role: string) => void; onReject: () => void; onOpenEvidence: () => void; quiet?: boolean }) {
  const [role, setRole] = useState(item.fact.accountingRole ?? "unknown");
  const needsRole = role === "unknown";
  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-rule", quiet ? "py-2" : "py-3")}>
      <div className="min-w-0">
        <div className={quiet ? "text-[13px]" : undefined}>{item.fact.label} <span className="font-medium tabular-nums">{item.fact.value}</span></div>
        <div className="mt-0.5 text-[12px] text-ink-2">{item.reason}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-pencil">
          <button type="button" className="truncate underline-offset-2 hover:text-ink hover:underline" onClick={onOpenEvidence}>{item.evidence.sourceName}</button>
          <span aria-hidden="true">·</span>
          <label className="inline-flex items-center gap-1">Treat as
            <select aria-label={`Accounting treatment for ${item.fact.label}`} className={cn("rounded border bg-background px-1 py-0.5 text-[12px] text-ink-2", needsRole ? "border-ink-2" : "border-rule")} value={role} onChange={(event) => setRole(event.target.value)}>
              {roleOptions.map((option) => <option value={option} key={option}>{roleLabel(option)}</option>)}
            </select>
          </label>
        </div>
      </div>
      <span className="flex gap-1">
        <button className={actionButton} type="button" disabled={busy || needsRole} aria-label={`Accept ${item.fact.label} as ${roleLabel(role)}`} title={needsRole ? "Choose a treatment first" : "Accept"} onClick={() => onAccept(role)}><Check /></button>
        <button className={actionButton} type="button" disabled={busy} aria-label={`Reject ${item.fact.label}`} title="Reject" onClick={onReject}><Trash2 /></button>
      </span>
    </div>
  );
}

/**
 * What needs a person, ranked by amount; what can wait; and what Balsa
 * assumed under the owner's level. Settled facts are not listed again.
 */
export function DecisionReview(props: DecisionReviewProps) {
  const { queue, threshold, busyKey } = props;
  const [showAll, setShowAll] = useState(false);
  const decisions = showAll ? queue.decisions : queue.decisions.slice(0, initialDecisions);
  const minorCount = queue.minor.reduce((total, group) => total + group.items.length, 0);
  const assumedCount = queue.assumed.length + queue.assumedDocuments.length;
  const nothingOpen = !queue.documents.length && !queue.decisions.length;

  return (
    <div className="border-t border-rule">
      <ConfidenceControl threshold={threshold} canChange={props.canChangeThreshold} onChange={props.onThresholdChange} />

      {queue.documents.length > 0 && <div>
        <div className={sectionLabel}>Confirm these sources</div>
        {queue.documents.map(({ evidence, pendingFacts, reason }) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-rule py-3" key={`document-${evidence.id}`}>
            <div className="min-w-0">
              <button type="button" className="max-w-full truncate text-left underline-offset-2 hover:underline" onClick={() => props.onOpenEvidence(evidence.id)}>{evidence.sourceName}</button>
              <div className="mt-0.5 text-[12px] text-ink-2">{reason}{evidence.reportingMonth ? ` · ${evidence.reportingMonth}` : ""}{evidence.sourceMetadata?.classification?.kind ? ` · ${roleLabel(evidence.sourceMetadata.classification.kind)}` : ""}</div>
              {pendingFacts > 0 && <div className="mt-0.5 text-[12px] text-pencil">{pendingFacts} extracted fact{pendingFacts === 1 ? "" : "s"} follow{pendingFacts === 1 ? "s" : ""}{threshold === null ? "." : "; Balsa asks only about those below your level."}</div>}
            </div>
            <span className="flex gap-1">
              <button className={actionButton} type="button" disabled={busyKey === evidence.id} aria-label={`Confirm ${evidence.sourceName}`} title="Confirm source" onClick={() => props.onConfirmDocument(evidence.id)}><Check /></button>
              <button className={actionButton} type="button" disabled={busyKey === evidence.id} aria-label={`Reject ${evidence.sourceName}`} title="Reject source" onClick={() => props.onRejectDocument(evidence.id)}><Trash2 /></button>
              <button className={actionButton} type="button" aria-label={`Edit what was extracted from ${evidence.sourceName}`} title="Edit" onClick={() => props.onEditDocument(evidence.id)}><Pencil /></button>
            </span>
          </div>
        ))}
      </div>}

      {queue.decisions.length > 0 && <div>
        <div className={cn(sectionLabel, "flex items-center justify-between gap-2")}><span>Your decision · largest first</span><span className="normal-case tracking-normal">{queue.decisions.length}</span></div>
        {decisions.map((item) => <FactRow key={`decision-${item.fact.factId}`} item={item} roleOptions={props.roleOptions} busy={busyKey === item.fact.factId} onAccept={(role) => props.onAcceptFact(item, role)} onReject={() => props.onRejectFact(item)} onOpenEvidence={() => props.onOpenEvidence(item.evidence.id)} />)}
        {queue.decisions.length > initialDecisions && <button type="button" className={cn(quietLink, "py-2 text-[13px]")} onClick={() => setShowAll((current) => !current)}>{showAll ? "Show fewer" : `Show ${queue.decisions.length - initialDecisions} more`}</button>}
      </div>}

      {nothingOpen && <p className="border-b border-rule py-3 text-[13px] text-ink-2">No extracted facts need your decision.</p>}

      {minorCount > 0 && <details className="border-b border-rule py-2.5">
        <summary className="cursor-pointer text-[12px] uppercase tracking-[0.12em] text-ink-2">Less important · {minorCount} small amount{minorCount === 1 ? "" : "s"}</summary>
        <p className="mt-2 text-[12px] text-ink-2">Each is under 1% of its document&apos;s largest amount. They still need acceptance before the document affects your numbers.</p>
        {queue.minor.map((group) => (
          <div key={`minor-${group.evidence.id}`} className="mt-2">
            <div className="flex items-center justify-between gap-2 border-b border-rule py-1.5 text-[12px]">
              <span className="truncate text-ink-2">{group.evidence.sourceName}</span>
              <button type="button" className={quietLink} disabled={busyKey === `minor:${group.evidence.id}` || !group.items.some((item) => (item.fact.accountingRole ?? "unknown") !== "unknown")} onClick={() => props.onAcceptMinor(group.evidence.id)}>{busyKey === `minor:${group.evidence.id}` ? "Accepting…" : "Accept all with a treatment"}</button>
            </div>
            {group.items.map((item) => <FactRow quiet key={`minor-${item.fact.factId}`} item={item} roleOptions={props.roleOptions} busy={busyKey === item.fact.factId} onAccept={(role) => props.onAcceptFact(item, role)} onReject={() => props.onRejectFact(item)} onOpenEvidence={() => props.onOpenEvidence(item.evidence.id)} />)}
          </div>
        ))}
      </details>}

      {assumedCount > 0 && <details className="border-b border-rule py-2.5">
        <summary className="cursor-pointer text-[12px] uppercase tracking-[0.12em] text-ink-2">Assumed · {assumedCount}</summary>
        <p className="mt-2 text-[12px] text-ink-2">Accepted because Balsa&apos;s checked confidence met your level when it ran. Reopen any fact to decide it yourself; it will not be assumed again.</p>
        <div className="mt-1 grid">
          {queue.assumedDocuments.map(({ evidence, assumption }) => (
            <div key={`assumed-document-${evidence.id}`} className="flex items-center justify-between gap-3 border-b border-rule py-2 text-[13px]">
              <span className="min-w-0 truncate">Source confirmed: <button type="button" className="underline-offset-2 hover:underline" onClick={() => props.onOpenEvidence(evidence.id)}>{evidence.sourceName}</button></span>
              <span className="shrink-0 text-[12px] text-pencil tabular-nums">{percent(assumption.score)} · level {percent(assumption.threshold)}</span>
            </div>
          ))}
          {queue.assumed.map((item) => (
            <div key={`assumed-${item.fact.factId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-rule py-2 text-[13px]">
              <div className="min-w-0">
                <div className="truncate">{item.fact.label} <span className="font-medium tabular-nums">{item.fact.value}</span> <span className="text-pencil">· {roleLabel(item.fact.accountingRole)}</span></div>
                <div className="truncate text-[12px] text-pencil">{item.evidence.sourceName} · {percent(item.assumption.score)} checked confidence, level {percent(item.assumption.threshold)}</div>
              </div>
              <button type="button" className={cn(quietLink, "inline-flex items-center gap-1 text-[12px]")} disabled={busyKey === item.fact.factId} onClick={() => props.onReopenFact(item)}><Undo2 className="size-3" aria-hidden="true" />Ask me instead</button>
            </div>
          ))}
        </div>
      </details>}
    </div>
  );
}
