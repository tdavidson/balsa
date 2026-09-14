import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, recordAudit, reviewItems } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const schema = z.object({ id: z.string().uuid(), answer: z.string().trim().min(1), status: z.enum(["resolved", "open"]).default("resolved") });

export async function PATCH(request: Request) {
  await auth.protect();
  const body = schema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid review update" }, { status: 400 });
  const context = await requireCompanyAccess();
  // Reopening hands the question back to the company, so the row stops naming a resolver.
  const [row] = await getDatabase().update(reviewItems).set({ answer: body.data.answer, status: body.data.status, resolvedByUserId: body.data.status === "resolved" ? context.user.id : null, updatedAt: new Date() }).where(and(eq(reviewItems.id, body.data.id), eq(reviewItems.companyId, context.company.id))).returning();
  if (!row) return NextResponse.json({ error: "Review item not found" }, { status: 404 });
  if (body.data.status === "resolved") await recordAudit(getDatabase(), { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "review.answered", entityType: "review_item", entityId: row.id, summary: `Answered review question: ${row.question.slice(0, 120)}`, after: { answer: body.data.answer } });
  return NextResponse.json({ reviewItem: row });
}
