"use client";

import { Check, Clipboard, FileText, Save, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";

type KnowledgeDocument = {
  slug: string;
  title: string;
  content: string;
  updatedAt: string;
  templateId?: string;
  templateTitle?: string;
};

export function KnowledgeViewer({ documents, industryKnowledgeAction }: { documents: KnowledgeDocument[]; industryKnowledgeAction?: ReactNode }) {
  const [documentList, setDocumentList] = useState(documents);
  const [selectedSlug, setSelectedSlug] = useState(documents[0]?.slug ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  if (!selected) return <p className="border-y border-rule py-5 text-ink-2">No knowledge documents have been created yet.</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:items-start">
      <nav aria-label="Knowledge documents" className="grid content-start gap-1 border-b border-rule pb-4 lg:border-r lg:border-b-0 lg:pr-5">
        <div className="px-3 pb-1 text-[11px] uppercase tracking-[0.12em] text-ink-2">Company files</div>
        {documentList.filter((document) => !document.templateId).map((document) => (
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
            <Button type="button" size="sm" className="rounded-md" onClick={saveContent} disabled={!isDirty || saving}>
              <Save aria-hidden="true" />
              {saving ? "Saving…" : "Save Markdown"}
            </Button>
            {selected.templateId && <Button type="button" variant="outline" size="sm" className="border-rule bg-background" onClick={deleteTemplateFile} disabled={deleting}>
              <Trash2 aria-hidden="true" />
              {deleting ? "Deleting…" : "Delete file"}
            </Button>}
          </div>
        </header>
        <textarea
          aria-label={`${selected.title} Markdown`}
          value={content}
          onChange={(event) => { setDrafts((current) => ({ ...current, [selected.slug]: event.target.value })); setSaveError(null); }}
          className="min-h-[480px] w-full resize-y overflow-auto bg-transparent p-5 font-mono text-[13px] leading-[1.65] text-ink outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          spellCheck={false}
        />
        <div className="flex min-h-9 items-center justify-between border-t border-rule px-4 py-2 text-[12px] text-ink-2">
          <span>{isDirty ? "Unsaved changes" : "Saved"}</span>
          {saveError && <span className="text-red-ink" role="alert">{saveError}</span>}
        </div>
      </article>
    </div>
  );
}
