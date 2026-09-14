import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { postingProposals, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  const [proposal] = await getDatabase().update(postingProposals).set({ status: "rejected", updatedAt: new Date() }).where(and(eq(postingProposals.id, id), eq(postingProposals.companyId, context.company.id), eq(postingProposals.status, "draft"))).returning();
  if (!proposal) return NextResponse.json({ error: "Only an open proposal can be rejected." }, { status: 409 });
  return NextResponse.json({ proposal });
}
