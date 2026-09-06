import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { companies, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can change company settings" }, { status: 403 });
  const body = (await request.json()) as { name?: unknown; baseCurrency?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const baseCurrency = typeof body.baseCurrency === "string" ? body.baseCurrency.trim().toUpperCase() : "";
  if (!name || name.length > 160) return NextResponse.json({ error: "Company name is required and must be 160 characters or fewer" }, { status: 400 });
  if (!/^[A-Z]{3}$/.test(baseCurrency)) return NextResponse.json({ error: "Base currency must be a three-letter code" }, { status: 400 });
  const [company] = await getDatabase().update(companies).set({ name, baseCurrency, updatedAt: new Date() }).where(eq(companies.id, context.company.id)).returning({ id: companies.id, name: companies.name, baseCurrency: companies.baseCurrency });
  return company ? NextResponse.json({ company }) : NextResponse.json({ error: "Company not found" }, { status: 404 });
}
