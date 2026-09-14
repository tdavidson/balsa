import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { companies, getDatabase, sources } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { clearActiveCompanyCookie } from "@/lib/auth/company-selection";
import { deleteSourceBlob } from "@/lib/blob-store";

const requestBody = z.object({ confirmation: z.string() });

/**
 * Deliberately destructive single-company reset for a controlled onboarding
 * retest. Deleting the company lets normal first-login provisioning create a
 * clean company and membership on the next request.
 */
export async function GET() {
  await auth.protect(); const context = await requireCompanyAccess();
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can reset this company" }, { status: 403 });
  const sourceRows = await getDatabase().select({ id: sources.id }).from(sources).where(eq(sources.companyId, context.company.id));
  return NextResponse.json({ company: { id: context.company.id, name: context.company.name }, confirmation: `RESET ${context.company.name}`, sourceCount: sourceRows.length });
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  if (context.company.role !== "owner") return NextResponse.json({ error: "Only the company owner can reset this company" }, { status: 403 });
  const parsed = requestBody.safeParse(await request.json());
  const expected = `RESET ${context.company.name}`;
  if (!parsed.success || parsed.data.confirmation !== expected) return NextResponse.json({ error: `Type exactly “${expected}” to reset this company.` }, { status: 400 });

  const db = getDatabase();
  const fileRows = await db.select({ storageReference: sources.storageReference }).from(sources).where(eq(sources.companyId, context.company.id));
  for (const file of fileRows) if (file.storageReference) await deleteSourceBlob(file.storageReference);
  // No audit row: `audit_log.company_id` cascades, so the record of the reset
  // would be deleted by the very statement it describes, and the company has no
  // other log to hold it.
  await db.delete(companies).where(eq(companies.id, context.company.id));
  // The preference now names a deleted company; clearing it lets the next
  // request fall back to an authorized company instead of a stale id.
  await clearActiveCompanyCookie();
  return NextResponse.json({ reset: true });
}
