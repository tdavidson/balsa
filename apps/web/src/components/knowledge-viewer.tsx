"use client";

import { Check, Clipboard, FileText, Save, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";

type KnowledgeDocument = {
  slug: string;
  title: string;
  content: string;
  updatedAt: string;
  readOnly?: boolean;
  templateId?: string;
  templateTitle?: string;
};
type CompanyPolicy = { name: string; rule: string; scope: string; effectiveFrom: string; confidence: string; decisionId: string | null; sourceId: string | null };
type PolicyCandidate = { key: string; name: string; rule: string; decisionIds: string[] };
type PolicyImpact = { executable: boolean; matched: number; changed: number; affectedEventIds: string[]; events: { id: string; month: string; description: string; amount: string; direction: string; category: string; nextCategory: string; sourceName?: string | null }[] };

export function KnowledgeViewer({ documents, policies = [], policyCandidates = [], industryKnowledgeAction }: { documents: KnowledgeDocument[]; policies?: CompanyPolicy[]; policyCandidates?: PolicyCandidate[]; industryKnowledgeAction?: ReactNode }) {
  const [documentList, setDocumentList] = useState(documents);
  const [selectedSlug, setSelectedSlug] = useState(documents[0]?.slug ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [policyName, setPolicyName] = useState("");
  const [policyRule, setPolicyRule] = useState("");
  const [policyScope, setPolicyScope] = useState("company");
  const [policyEffectiveFrom, setPolicyEffectiveFrom] = useState("");
  const [policyPreview, setPolicyPreview] = useState<PolicyImpact | null>(null);
  const [policyWorking, setPolicyWorking] = useState<"preview" | "apply" | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const selected = documentList.find((document) => document.slug === selectedSlug) ?? documentList[0];
  const content = selected ? drafts[selected.slug] ?? selected.content : "";
  const isDirty = Boolean(selected && Object.prototype.hasOwnProperty.call(drafts, selected.slug) && drafts[selected.slug] !== selected.content);

  async function copyContent() {
    if (!selected) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function saveContent() {
    if (!selected || !isDirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/knowledge", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: selected.slug, content }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save Markdown");
      const saved = payload.document as { content: string; updatedAt: string };
      setDocumentList((current) => current.map((document) => document.slug === selected.slug ? { ...document, content: saved.content, updatedAt: saved.updatedAt } : document));
      setDrafts((current) => { const next = { ...current }; delete next[selected.slug]; return next; });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save Markdown");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplateFile() {
    if (!selected?.templateId || !window.confirm(`Delete ${selected.title}? This removes only this knowledge file, not the rest of the template.`)) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/knowledge", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: selected.slug }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to delete knowledge file");
      window.location.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to delete knowledge file");
    } finally {
      setDeleting(false);
    }
  }

  async function submitPolicy(action: "preview" | "apply") {
    if (!policyName.trim() || !policyRule.trim()) return;
    setPolicyWorking(action);
    setPolicyError(null);
    try {
      const response = await fetch("/api/policies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, name: policyName.trim(), rule: policyRule.trim(), scope: policyScope.trim() || "company", ...(policyEffectiveFrom ? { effectiveFrom: new Date(`${policyEffectiveFrom}T00:00:00`).toISOString() } : {}) }) });
      const payload = await response.json() as { impact?: PolicyImpact; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to review this policy");
      if (payload.impact) setPolicyPreview(payload.impact);
      if (action === "apply") window.location.reload();
    } catch (error) {
      setPolicyError(error instanceof Error ? error.message : "Unable to review this policy");
    } finally {
      setPolicyWorking(null);
    }
  }

  if (!selected) return <p className="border-y border-rule py-5 text-ink-2">No knowledge documents have been created yet.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:items-start">
      <nav aria-label="Knowledge documents" className="grid content-start gap-1 border-b border-rule pb-4 lg:border-r lg:border-b-0 lg:pr-5">
        {documentList.filter((document) => document.readOnly).length > 0 && <><div className="px-3 pb-1 text-[11px] uppercase tracking-[0.12em] text-ink-2">Built in</div>{documentList.filter((document) => document.readOnly).map((document) => (
          <button className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${document.slug === selected.slug ? "bg-rule text-ink" : "text-ink-2 hover:bg-rule/60 hover:text-ink"}`} key={document.slug} type="button" onClick={() => { setSelectedSlug(document.slug); setCopied(false); setSaveError(null); }} aria-current={document.slug === selected.slug ? "page" : undefined}>
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />{document.title}
          </button>
        ))}</>}
        <div className="mt-4 border-t border-rule px-3 pt-4 pb-1 text-[11px] uppercase tracking-[0.12em] text-ink-2">Company files</div>
        {documentList.filter((document) => !document.templateId && !document.readOnly).map((document) => (
          <button className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${document.slug === selected.slug ? "bg-rule text-ink" : "text-ink-2 hover:bg-rule/60 hover:text-ink"}`} key={document.slug} type="button" onClick={() => { setSelectedSlug(document.slug); setCopied(false); setSaveError(null); }} aria-current={document.slug === selected.slug ? "page" : undefined}>
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />{document.title}
          </button>
        ))}
        <div className="mt-4 border-t border-rule pt-4">
          <div className="px-3 pb-2 text-[11px] uppercase tracking-[0.12em] text-ink-2">Industry knowledge</div>
          {industryKnowledgeAction}
          {[...new Map(documentList.filter((document) => document.templateId).map((document) => [document.templateId, document.templateTitle ?? document.title])).entries()].map(([templateId, title]) => (
            <div key={templateId} className="mt-4">
              <div className="px-3 pb-1 text-[13px] font-medium text-ink">{title}</div>
              {documentList.filter((document) => document.templateId === templateId).map((document) => (
                <button className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${document.slug === selected.slug ? "bg-rule text-ink" : "text-ink-2 hover:bg-rule/60 hover:text-ink"}`} key={document.slug} type="button" onClick={() => { setSelectedSlug(document.slug); setCopied(false); setSaveError(null); }} aria-current={document.slug === selected.slug ? "page" : undefined}>
                  <FileText className="size-3.5 shrink-0" aria-hidden="true" />{document.title.replace(`${title} · `, "")}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>

      <article className="min-w-0 overflow-hidden rounded-xl border border-rule bg-rule/25">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <div className="min-w-0">
            <h2 className="display text-[24px] leading-[1.2]" style={{ fontVariationSettings: '"opsz" 24' }}>{selected.title}</h2>
            <p className="mt-1 text-[12px] text-ink-2">{selected.slug}.md · updated {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selected.updatedAt))}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="border-rule bg-background" onClick={copyContent}>
              {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
              {copied ? "Copied" : "Copy Markdown"}
            </Button>
            {!selected.readOnly && <Button type="button" size="sm" className="rounded-md" onClick={saveContent} disabled={!isDirty || saving}>
              <Save aria-hidden="true" />
              {saving ? "Saving…" : "Save Markdown"}
            </Button>}
            {selected.templateId && <Button type="button" variant="outline" size="sm" className="border-rule bg-background" onClick={deleteTemplateFile} disabled={deleting}>
              <Trash2 aria-hidden="true" />
              {deleting ? "Deleting…" : "Delete file"}
            </Button>}
          </div>
        </header>
        {selected.readOnly && <p className="border-b border-rule bg-background px-5 py-3 text-[13px] text-ink-2">This is platform-managed accounting guidance. Company-specific rules belong in the editable Company, Policies, Allocations, Accounting, and Forecast files.</p>}
        <textarea
          aria-label={`${selected.title} Markdown`}
          value={content}
          onChange={(event) => { if (!selected.readOnly) { setDrafts((current) => ({ ...current, [selected.slug]: event.target.value })); setSaveError(null); } }}
          readOnly={selected.readOnly}
          className="min-h-[480px] w-full resize-y overflow-auto bg-transparent p-5 font-mono text-[13px] leading-[1.65] text-ink outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          spellCheck={false}
        />
        {selected.slug === "policies" && <section className="grid gap-2 border-t border-rule px-4 py-4" aria-label="Active company policies">
          <h3 className="text-[11px] uppercase tracking-[0.12em] text-ink-2">Active company rules</h3>
          {policies.length ? policies.map((policy) => <div className="grid gap-1 border-t border-rule pt-2 text-[13px]" key={`${policy.name}-${policy.decisionId ?? policy.sourceId ?? policy.effectiveFrom}`}><span className="text-ink">{policy.name}</span><span className="text-ink-2">{policy.rule}</span><span className="text-[12px] text-pencil">Scope: {policy.scope} · Effective {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(policy.effectiveFrom))} · Confidence {Math.round(Number(policy.confidence) * 100)}%{policy.decisionId ? " · CFO decision" : ""}{policy.sourceId ? " · source-backed" : ""}</span></div>) : <p className="text-[13px] text-ink-2">No company-specific rules have been approved yet. Universal accounting rules still apply.</p>}
          {policyCandidates.length > 0 && <div className="mt-3 grid gap-2 border-t border-rule pt-3"><h4 className="text-[11px] uppercase tracking-[0.12em] text-ink-2">Potential reusable rules · not active</h4>{policyCandidates.map((candidate) => <div className="grid gap-1 text-[13px]" key={candidate.key}><span className="text-ink">{candidate.name}</span><span className="text-ink-2">{candidate.rule}</span><span className="flex flex-wrap items-center gap-2 text-[12px] text-pencil">Observed in {candidate.decisionIds.length} approved CFO decisions. <button className="underline underline-offset-2" type="button" onClick={() => { setPolicyName(candidate.name); setPolicyRule(candidate.rule); setPolicyPreview(null); setPolicyError(null); }}>Use as draft</button></span></div>)}</div>}
          <section className="mt-4 grid gap-3 border-t border-rule pt-4" aria-label="Policy authoring and impact review">
            <div><h4 className="text-[11px] uppercase tracking-[0.12em] text-ink-2">Author a company rule</h4><p className="mt-1 text-[12px] text-ink-2">Preview the exact historical transactions a rule would reclassify before activating it.</p></div>
            <div className="grid gap-2 sm:grid-cols-2"><input className="rounded-md border border-rule bg-background px-2.5 py-2 text-[13px] text-ink" placeholder="Rule name" value={policyName} onChange={(event) => { setPolicyName(event.target.value); setPolicyPreview(null); }} /><input className="rounded-md border border-rule bg-background px-2.5 py-2 text-[13px] text-ink" placeholder="Scope (for example, operating entity)" value={policyScope} onChange={(event) => { setPolicyScope(event.target.value); setPolicyPreview(null); }} /></div>
            <textarea className="min-h-20 rounded-md border border-rule bg-background px-2.5 py-2 text-[13px] text-ink" placeholder={'Use an explicit rule, for example: Classify descriptions containing "Automatic Investment" as transfer.'} value={policyRule} onChange={(event) => { setPolicyRule(event.target.value); setPolicyPreview(null); }} />
            <label className="grid w-fit gap-1 text-[12px] text-ink-2">Effective from <input className="rounded-md border border-rule bg-background px-2.5 py-1.5 text-[13px] text-ink" type="date" value={policyEffectiveFrom} onChange={(event) => { setPolicyEffectiveFrom(event.target.value); setPolicyPreview(null); }} /></label>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" className="border-rule bg-background" disabled={!policyName.trim() || !policyRule.trim() || policyWorking !== null} onClick={() => submitPolicy("preview")}>{policyWorking === "preview" ? "Previewing…" : "Preview impact"}</Button><Button type="button" size="sm" className="rounded-md" disabled={!policyPreview?.executable || policyWorking !== null} onClick={() => submitPolicy("apply")}>{policyWorking === "apply" ? "Activating…" : "Activate rule"}</Button></div>
            {policyPreview && <div className="grid gap-1 rounded-md border border-rule bg-background p-3 text-[12px] text-ink-2"><span className="text-ink">{policyPreview.matched} matched · {policyPreview.changed} transaction{policyPreview.changed === 1 ? "" : "s"} will be updated</span>{policyPreview.events.length ? <div className="mt-1 grid gap-1">{policyPreview.events.map((event) => <span key={event.id}>{event.month} · {event.description} · {event.category} → <span className="text-ink">{event.nextCategory}</span>{event.sourceName ? ` · ${event.sourceName}` : ""}</span>)}</div> : <span>No existing transactions match. The rule will be available for future evidence.</span>}</div>}
            {policyError && <p className="text-[12px] text-red-ink" role="alert">{policyError}</p>}
          </section>
        </section>}
        <div className="flex min-h-9 items-center justify-between border-t border-rule px-4 py-2 text-[12px] text-ink-2">
          <span>{selected.readOnly ? "Platform-managed" : isDirty ? "Unsaved changes" : "Saved"}</span>
          {saveError && <span className="text-red-ink" role="alert">{saveError}</span>}
        </div>
      </article>
    </div>
  );
}
