import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getDatabase, knowledgeDocuments } from "@finance/database";
import { AccountMenu } from "@/components/account-menu";
import { KnowledgeTemplatePicker } from "@/components/knowledge-template-picker";
import { KnowledgeViewer } from "@/components/knowledge-viewer";
import { requireCompanyAccess } from "@/lib/auth";
import { defaultKnowledgeDocuments, knowledgeTemplates } from "@/lib/knowledge-templates";

export const dynamic = "force-dynamic";

const serif = (size: number) => ({ fontVariationSettings: `"opsz" ${size}` });
const templateForDocument = (document: { slug: string }) => {
  const slugMatch = document.slug.match(/^template:([^:]+):/);
  if (slugMatch?.[1]) return knowledgeTemplates.find((template) => template.id === slugMatch[1]);
  return undefined;
};
export default async function KnowledgePage() {
  await auth.protect({ unauthenticatedUrl: "/login" });
  const context = await requireCompanyAccess();
  const db = getDatabase();
  let documents = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, context.company.id)).orderBy(asc(knowledgeDocuments.slug));
  if (!documents.length) {
    await db.insert(knowledgeDocuments).values(defaultKnowledgeDocuments.map(({ slug, title, content }) => ({ companyId: context.company.id, slug, title, content })));
    documents = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, context.company.id)).orderBy(asc(knowledgeDocuments.slug));
  }
  for (const document of documents) {
    const legacyTemplate = knowledgeTemplates.find((template) => document.content.includes(`Hemrock knowledge template: ${template.id} v${template.version}`));
    const templateDocument = legacyTemplate?.documents.find((candidate) => candidate.slug === document.slug);
    if (!legacyTemplate || !templateDocument) continue;
    const prefixedSlug = `template:${legacyTemplate.id}:${templateDocument.slug}`;
    const alreadyMigrated = documents.some((candidate) => candidate.slug === prefixedSlug);
    if (!alreadyMigrated) {
      await db.insert(knowledgeDocuments).values({ companyId: context.company.id, slug: prefixedSlug, title: `${legacyTemplate.title} · ${templateDocument.title}`, content: document.content });
    }
    const fallback = defaultKnowledgeDocuments.find((candidate) => candidate.slug === document.slug);
    if (fallback) await db.update(knowledgeDocuments).set({ content: fallback.content, title: fallback.title, updatedAt: new Date() }).where(eq(knowledgeDocuments.id, document.id));
  }
  documents = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, context.company.id)).orderBy(asc(knowledgeDocuments.slug));
  const appliedTemplateIds = [...new Set(documents.flatMap((document) => {
    const template = templateForDocument(document);
    return template ? [template.id] : [];
  }))];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-end px-7">
        <AccountMenu company={context.company.name} baseCurrency={context.company.baseCurrency} user={{ email: context.user.email, name: context.user.name }} />
      </header>
      <main className="mx-auto grid w-full max-w-[960px] flex-1 content-start gap-10 px-7 pt-6 pb-24">
        <div className="grid gap-4">
          <Link href="/" className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to Hemrock
          </Link>
          <h1 className="display text-[40px] leading-[1.1]" style={serif(40)}>Knowledge</h1>
          <p className="max-w-[62ch] text-[17px] leading-[1.55] text-ink-2">The Markdown context the agent reads alongside your structured financial state. This is the exact content currently stored for {context.company.name}.</p>
        </div>
        <KnowledgeViewer
          industryKnowledgeAction={
            <KnowledgeTemplatePicker
              appliedTemplateIds={appliedTemplateIds}
              templates={knowledgeTemplates.map(({ id, title, industry, description, version, documents: templateDocuments }) => ({ id, title, industry, description, version, documents: templateDocuments }))}
            />
          }
          documents={documents.map((document) => {
            const template = templateForDocument(document);
            return { slug: document.slug, title: document.title, content: document.content, updatedAt: document.updatedAt.toISOString(), ...(template ? { templateId: template.id, templateTitle: template.title } : {}) };
          })}
        />
      </main>
    </div>
  );
}
