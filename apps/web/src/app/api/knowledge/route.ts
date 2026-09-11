import { auth } from "@clerk/nextjs/server";
import { and, eq, like } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, knowledgeDocuments } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { defaultKnowledgeDocuments, knowledgeTemplates } from "@/lib/knowledge-templates";
import { ensureCompanyKnowledgeDocuments } from "@/lib/company-knowledge";

const appliedIdsFor = (documents: { slug: string; content: string }[]) => [...new Set(documents.flatMap((document) => {
  const match = document.slug.match(/^template:([^:]+):/);
  if (match?.[1]) return [match[1]];
  const legacy = knowledgeTemplates.find((template) => document.content.includes(`Hemrock knowledge template: ${template.id} v${template.version}`));
  return legacy ? [legacy.id] : [];
}))];

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const documents = await ensureCompanyKnowledgeDocuments(getDatabase(), context.company.id);
  return NextResponse.json({ documents, appliedTemplateIds: appliedIdsFor(documents) });
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = (await request.json()) as { templateId?: string };
  const template = knowledgeTemplates.find((candidate) => candidate.id === body.templateId);
  if (!template) return NextResponse.json({ error: "Unknown knowledge template" }, { status: 400 });
  const db = getDatabase();
  const documents = await ensureCompanyKnowledgeDocuments(db, context.company.id);
  const templatePrefix = `template:${template.id}:`;
  const legacyMarker = `Hemrock knowledge template: ${template.id} v${template.version}`;
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const templateDocument of template.documents) {
    const existing = documents.find((document) => document.slug === `${templatePrefix}${templateDocument.slug}`);
    const legacy = documents.find((document) => document.slug === templateDocument.slug && document.content.includes(legacyMarker));
    if (existing || legacy) {
      if (existing && existing.content.trim() !== templateDocument.content.trim()) skipped.push(templateDocument.slug);
      if (legacy && legacy.content.trim() !== templateDocument.content.trim()) skipped.push(templateDocument.slug);
      continue;
    }
    await db.insert(knowledgeDocuments).values({ companyId: context.company.id, slug: `${templatePrefix}${templateDocument.slug}`, title: `${template.title} · ${templateDocument.title}`, content: templateDocument.content });
    applied.push(templateDocument.slug);
  }
  return NextResponse.json({ template: { id: template.id, title: template.title, version: template.version }, applied, skipped, appliedTemplateIds: appliedIdsFor([...documents, ...template.documents.map((document) => ({ slug: `${templatePrefix}${document.slug}`, content: document.content }))]) });
}

export async function DELETE(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = (await request.json()) as { templateId?: string; slug?: string };
  if (body.slug && !body.templateId) {
    const [document] = await getDatabase().select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, body.slug)));
    const template = knowledgeTemplates.find((candidate) => document?.slug.startsWith(`template:${candidate.id}:`) || document?.content.includes(`Hemrock knowledge template: ${candidate.id} v${candidate.version}`));
    if (!document || !template) return NextResponse.json({ error: "Only an industry knowledge file can be deleted here" }, { status: 400 });
    await getDatabase().delete(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, body.slug)));
    return NextResponse.json({ removed: true, slug: body.slug, templateId: template.id });
  }
  const template = knowledgeTemplates.find((candidate) => candidate.id === body.templateId);
  if (!template) return NextResponse.json({ error: "Unknown knowledge template" }, { status: 400 });
  const prefix = `template:${template.id}:`;
  const deleted = await getDatabase().delete(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), like(knowledgeDocuments.slug, `${prefix}%`))).returning({ id: knowledgeDocuments.id });
  const legacyMarker = `Hemrock knowledge template: ${template.id} v${template.version}`;
  const documents = await getDatabase().select().from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, context.company.id));
  let restoredLegacy = 0;
  for (const templateDocument of template.documents) {
    const existing = documents.find((document) => document.slug === templateDocument.slug && document.content.includes(legacyMarker));
    if (existing && existing.content.trim() === templateDocument.content.trim()) {
      const fallback = defaultKnowledgeDocuments.find((document) => document.slug === templateDocument.slug);
      if (fallback) {
        await getDatabase().update(knowledgeDocuments).set({ content: fallback.content, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, templateDocument.slug)));
        restoredLegacy += 1;
      }
    } else if (existing) {
      await getDatabase().delete(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, templateDocument.slug)));
      restoredLegacy += 1;
    }
  }
  return NextResponse.json({ template: { id: template.id, title: template.title, version: template.version }, removed: deleted.length > 0 || restoredLegacy > 0, restoredLegacy });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = (await request.json()) as { slug?: string; content?: string };
  if (!body.slug || typeof body.content !== "string") return NextResponse.json({ error: "slug and content are required" }, { status: 400 });
  if (body.slug === "core-accounting") return NextResponse.json({ error: "Core accounting is platform-managed and cannot be changed in company knowledge." }, { status: 403 });
  const [document] = await getDatabase().update(knowledgeDocuments).set({ content: body.content, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, body.slug))).returning();
  return document ? NextResponse.json({ document }) : NextResponse.json({ error: "Knowledge document not found" }, { status: 404 });
}
