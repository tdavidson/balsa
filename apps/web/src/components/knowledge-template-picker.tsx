"use client";

import { ArrowLeft, Check, Eye, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type TemplateDocument = { slug: string; title: string; content: string };
type TemplateSummary = { id: string; title: string; industry: string; description: string; version: string; documents: TemplateDocument[] };

export function KnowledgeTemplatePicker({ templates, appliedTemplateIds }: { templates: TemplateSummary[]; appliedTemplateIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateSummary | null>(null);

  async function toggleTemplate(template: TemplateSummary) {
    const isApplied = appliedTemplateIds.includes(template.id);
    if (isApplied && !window.confirm(`Unapply ${template.title}? Any edits to this template's files will also be removed.`)) return;
    setApplying(template.id);
    setMessage(null);
    try {
      const response = await fetch("/api/knowledge", { method: isApplied ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: template.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Unable to ${isApplied ? "unapply" : "add"} template`);
      const skipped = payload.skipped?.length ?? 0;
      setMessage(isApplied ? `${template.title} unapplied.` : skipped ? `${template.title} added; ${skipped} edited file${skipped === 1 ? " was" : "s were"} left unchanged.` : `${template.title} added to knowledge.`);
      window.setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to ${isApplied ? "unapply" : "add"} template`);
    } finally {
      setApplying(null);
    }
  }

  function closePicker() {
    setOpen(false);
    setPreviewTemplate(null);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setPreviewTemplate(null); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start border-rule bg-background">
          <Sparkles aria-hidden="true" /> Add industry knowledge
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-[1100px] flex-col gap-0 overflow-hidden border-rule bg-background p-0">
        {previewTemplate ? (
          <>
            <DialogHeader className="border-b border-rule px-6 py-5">
              <Button type="button" variant="ghost" size="sm" className="mb-2 w-fit px-2 text-ink-2" onClick={() => setPreviewTemplate(null)}>
                <ArrowLeft aria-hidden="true" /> Back to industry knowledge
              </Button>
              <DialogTitle className="display text-[28px]" style={{ fontVariationSettings: '"opsz" 28' }}>{previewTemplate.title}</DialogTitle>
              <DialogDescription>{previewTemplate.description} This content will be added as editable knowledge files.</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
              <Accordion type="multiple" defaultValue={previewTemplate.documents[0]?.slug ? [previewTemplate.documents[0].slug] : []}>
                {previewTemplate.documents.map((document) => (
                  <AccordionItem value={document.slug} key={document.slug}>
                    <AccordionTrigger>{document.title}</AccordionTrigger>
                    <AccordionContent><pre className="whitespace-pre-wrap rounded-lg bg-rule/25 p-4 font-mono text-[12px] leading-[1.55] text-ink-2">{document.content}</pre></AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
            <div className="flex justify-end border-t border-rule px-6 py-4">
              <Button type="button" onClick={() => { closePicker(); void toggleTemplate(previewTemplate); }} disabled={applying !== null}>
                {appliedTemplateIds.includes(previewTemplate.id) ? <><X aria-hidden="true" /> Unapply</> : <><Plus aria-hidden="true" /> Add to knowledge</>}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="border-b border-rule px-6 py-5">
              <DialogTitle className="display text-[28px]" style={{ fontVariationSettings: '"opsz" 28' }}>Add industry knowledge</DialogTitle>
              <DialogDescription>A company can have more than one revenue model. Preview each knowledge pack, add the ones that apply, and unapply one later if it was added by mistake.</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {templates.map((template) => {
                  const isApplied = appliedTemplateIds.includes(template.id);
                  return (
                    <div className="grid gap-3 rounded-xl border border-rule bg-rule/25 p-4" key={template.id}>
                      <div>
                        <h3 className="font-medium text-ink">{template.title}</h3>
                        <p className="mt-0.5 text-[12px] text-ink-2">{template.industry} · v{template.version}</p>
                      </div>
                      <p className="text-[13px] leading-[1.45] text-ink-2">{template.description}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" className="border-rule bg-background" onClick={() => setPreviewTemplate(template)}>
                          <Eye aria-hidden="true" /> View content
                        </Button>
                        <Button type="button" variant={isApplied ? "secondary" : "outline"} size="sm" className="border-rule" disabled={applying !== null} onClick={() => toggleTemplate(template)}>
                          {applying === template.id ? "Saving…" : isApplied ? <><X aria-hidden="true" /> Unapply</> : <><Plus aria-hidden="true" /> Add to knowledge</>}
                        </Button>
                      </div>
                      {isApplied && <p className="flex items-center gap-1 text-[12px] text-ink-2"><Check className="size-3.5" aria-hidden="true" /> Added to this company</p>}
                    </div>
                  );
                })}
              </div>
              {message && <p className="mt-4 text-[13px] text-ink-2" role="status">{message}</p>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
