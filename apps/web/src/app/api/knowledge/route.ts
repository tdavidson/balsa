import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, knowledgeDocuments } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const templates = [
  ["company", "Company", "# Company\n\nHow the company operates.\n"],
  ["policies", "Policies", "# Financial Policies\n\nStanding CFO judgment and recognition policies.\n"],
  ["allocations", "Allocations", "# Allocations\n\nRecurring cost allocation treatment.\n"],
  ["accounting", "Accounting", "# Accounting\n\nRecognition and accounting context.\n"],
  ["forecast", "Forecast", "# Forecast\n\nForecast assumptions and scenarios.\n"],
] as const;

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  let documents = await getDatabase().select().from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, context.company.id)).orderBy(asc(knowledgeDocuments.slug));
  if (!documents.length) {
    await getDatabase().insert(knowledgeDocuments).values(templates.map(([slug, title, content]) => ({ companyId: context.company.id, slug, title, content })));
    documents = await getDatabase().select().from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, context.company.id)).orderBy(asc(knowledgeDocuments.slug));
  }
  return NextResponse.json({ documents });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = (await request.json()) as { slug?: string; content?: string };
  if (!body.slug || typeof body.content !== "string") return NextResponse.json({ error: "slug and content are required" }, { status: 400 });
  const [document] = await getDatabase().update(knowledgeDocuments).set({ content: body.content, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, body.slug))).returning();
  return document ? NextResponse.json({ document }) : NextResponse.json({ error: "Knowledge document not found" }, { status: 404 });
}
