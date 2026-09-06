import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { factRecords, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const updateSchema = z.object({ id: z.string().uuid(), status: z.enum(["pending", "approved", "rejected"]), label: z.string().trim().min(1).optional(), value: z.string().trim().min(1).optional(), confidence: z.number().min(0).max(1).optional() });

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select().from(factRecords).where(eq(factRecords.companyId, context.company.id)).orderBy(desc(factRecords.createdAt));
  return NextResponse.json({ facts: rows });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const body = updateSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid fact update" }, { status: 400 });
  const context = await requireCompanyAccess();
  const [row] = await getDatabase().update(factRecords).set({ status: body.data.status, ...(body.data.label ? { label: body.data.label } : {}), ...(body.data.value ? { value: body.data.value } : {}), ...(body.data.confidence !== undefined ? { confidence: String(body.data.confidence) } : {}), updatedAt: new Date() }).where(and(eq(factRecords.id, body.data.id), eq(factRecords.companyId, context.company.id))).returning();
  if (!row) return NextResponse.json({ error: "Fact not found" }, { status: 404 });
  return NextResponse.json({ fact: row });
}
