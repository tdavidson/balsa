import "server-only";
import { asc, eq } from "drizzle-orm";
import { knowledgeDocuments, type Database } from "@finance/database";
import { defaultKnowledgeDocuments } from "@/lib/knowledge-templates";
import { knowledgeDestinationForFact, type ReviewedKnowledgeFact } from "@/lib/knowledge-routing";
import { onboardingKnowledgeDestination } from "@/lib/onboarding-review";

/** Ensures every company has the durable knowledge files without overwriting learned content. */
export async function ensureCompanyKnowledgeDocuments(db: Database, companyId: string) {
  let documents = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, companyId)).orderBy(asc(knowledgeDocuments.slug));
  const existingSlugs = new Set(documents.map((document) => document.slug));
  const missing = defaultKnowledgeDocuments.filter((document) => !existingSlugs.has(document.slug));
  if (missing.length) {
    await db.insert(knowledgeDocuments).values(missing.map(({ slug, title, content }) => ({ companyId, slug, title, content }))).onConflictDoNothing({ target: [knowledgeDocuments.companyId, knowledgeDocuments.slug] });
    documents = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, companyId)).orderBy(asc(knowledgeDocuments.slug));
  }
  return documents;
}

/** Records approved, durable source findings in their relevant company knowledge file. */
export async function recordReviewedKnowledge(db: Database, companyId: string, evidenceId: string, facts: ReviewedKnowledgeFact[]) {
  const documents = await ensureCompanyKnowledgeDocuments(db, companyId);
  const additions = new Map<string, string[]>();
  for (const fact of facts) {
    const destination = knowledgeDestinationForFact(fact);
    if (!destination) continue;
    const line = `- [source:${evidenceId}] ${fact.label}: ${fact.value}`;
    additions.set(destination, [...(additions.get(destination) ?? []), line]);
  }
  for (const [slug, lines] of additions) {
    const document = documents.find((candidate) => candidate.slug === slug);
    if (!document) continue;
    const unseen = [...new Set(lines)].filter((line) => !document.content.includes(line));
    if (!unseen.length) continue;
    await db.update(knowledgeDocuments).set({ content: `${document.content.trim()}\n\n## Reviewed evidence\n${unseen.join("\n")}\n`, updatedAt: new Date() }).where(eq(knowledgeDocuments.id, document.id));
  }
}

/** Stores a CFO-confirmed onboarding answer as company knowledge, never as an automatic policy. */
export async function recordOnboardingKnowledge(db: Database, companyId: string, review: { id: string; reviewKey?: string | null; question: string; answer: string }) {
  const destination = onboardingKnowledgeDestination(review.reviewKey);
  if (!destination) return;
  const documents = await ensureCompanyKnowledgeDocuments(db, companyId);
  const document = documents.find((candidate) => candidate.slug === destination);
  if (!document) return;
  const reference = `[onboarding-review:${review.id}]`;
  if (document.content.includes(reference)) return;
  const line = `- ${reference} Q: ${review.question}\n  A: ${review.answer}`;
  await db.update(knowledgeDocuments).set({ content: `${document.content.trim()}\n\n## CFO-confirmed onboarding\n${line}\n`, updatedAt: new Date() }).where(eq(knowledgeDocuments.id, document.id));
}
