import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { companies, getDatabase, recordAudit } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { minimumConfidenceThreshold, parseConfidenceThreshold } from "@/lib/review-assessment";

function storageError(error: unknown) {
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
  if (code === "42P01" || code === "42703") return NextResponse.json({ error: "Review storage is not current. Run pnpm db:migrate and retry." }, { status: 503 });
  return NextResponse.json({ error: "Unable to read the review policy. Please try again." }, { status: 500 });
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  try {
    const [company] = await getDatabase().select({ reviewConfidenceThreshold: companies.reviewConfidenceThreshold }).from(companies).where(eq(companies.id, context.company.id)).limit(1);
    return NextResponse.json({ confidenceThreshold: parseConfidenceThreshold(company?.reviewConfidenceThreshold), canChange: context.company.role === "owner" });
  } catch (error) { return storageError(error); }
}

const bodySchema = z.object({ confidenceThreshold: z.number().min(minimumConfidenceThreshold).max(1).nullable() });

/**
 * The confidence Balsa needs before it proceeds without asking. Raising or
 * clearing it never revokes earlier assumptions; each remains reversible in
 * review. Only the owner sets it, and every change is audited.
 */
export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (request.headers.get("x-company-id") !== context.company.id) return NextResponse.json({ error: "Company selection changed. Reload before continuing." }, { status: 409 });
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can change when Balsa asks for review" }, { status: 403 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: `Choose a confidence level from ${minimumConfidenceThreshold * 100}% to 100%, or always ask.` }, { status: 400 });
  const next = body.data.confidenceThreshold === null ? null : String(Math.round(body.data.confidenceThreshold * 100) / 100);
  try {
    const db = getDatabase();
    const previous = await db.transaction(async (tx) => {
      const [current] = await tx.select({ reviewConfidenceThreshold: companies.reviewConfidenceThreshold }).from(companies).where(eq(companies.id, context.company.id)).limit(1);
      if ((current?.reviewConfidenceThreshold ?? null) === next) return current?.reviewConfidenceThreshold ?? null;
      await tx.update(companies).set({ reviewConfidenceThreshold: next, updatedAt: new Date() }).where(eq(companies.id, context.company.id));
      await recordAudit(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "company.review_confidence_changed", entityType: "company", entityId: context.company.id, summary: next === null ? "Set Balsa to ask about every extracted fact" : `Set Balsa to proceed without asking at ${Math.round(Number(next) * 100)}% confidence or higher`, before: { confidenceThreshold: parseConfidenceThreshold(current?.reviewConfidenceThreshold) }, after: { confidenceThreshold: parseConfidenceThreshold(next) } });
      return current?.reviewConfidenceThreshold ?? null;
    });
    return NextResponse.json({ confidenceThreshold: parseConfidenceThreshold(next), previous: parseConfidenceThreshold(previous), canChange: true });
  } catch (error) { return storageError(error); }
}
