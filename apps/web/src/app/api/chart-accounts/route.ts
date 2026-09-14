import { auth } from "@/lib/auth";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, entities, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const body = z.object({ code: z.string().trim().min(1).max(32), name: z.string().trim().min(1).max(160), accountType: z.enum(["asset", "liability", "equity", "revenue", "expense", "contra"]), normalBalance: z.enum(["debit", "credit"]), statementSection: z.enum(["asset", "liability", "equity", "revenue", "expense"]).optional(), statementLine: z.string().trim().min(1).max(80).optional(), balanceTiming: z.enum(["current", "noncurrent"]).optional(), bankAccountIdentifier: z.string().trim().min(1).max(160).optional(), cashFlowCategory: z.enum(["operating", "investing", "financing", "none"]).optional(), workingCapitalCategory: z.enum(["receivables", "payables", "deferred_revenue", "prepaids", "inventory", "other"]).optional(), fxMonetary: z.enum(["Y", "N"]).optional(), entityId: z.string().uuid().optional(), activeFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), activeTo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), active: z.enum(["Y", "N"]).optional() });

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const accounts = await getDatabase().select().from(chartAccounts).where(eq(chartAccounts.companyId, context.company.id)).orderBy(asc(chartAccounts.code));
  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid chart account", details: parsed.error.flatten() }, { status: 400 });
  const value = parsed.data;
  if (value.accountType === "contra" && !value.statementSection) return NextResponse.json({ error: "A contra account requires the statement section it offsets." }, { status: 400 });
  if (value.balanceTiming && !["asset", "liability"].includes(value.statementSection ?? value.accountType)) return NextResponse.json({ error: "Current/non-current classification applies only to asset and liability accounts." }, { status: 400 });
  if (value.bankAccountIdentifier && !["asset"].includes(value.statementSection ?? value.accountType)) return NextResponse.json({ error: "A bank account identifier may be assigned only to a cash asset account." }, { status: 400 });
  if (value.fxMonetary === "Y" && !["asset", "liability"].includes(value.statementSection ?? value.accountType)) return NextResponse.json({ error: "Only asset and liability accounts may be marked monetary for FX remeasurement." }, { status: 400 });
  if (value.accountType !== "contra" && (value.accountType === "asset" || value.accountType === "expense") !== (value.normalBalance === "debit")) return NextResponse.json({ error: "Assets and expenses normally debit; liabilities, equity, and revenue normally credit. Contra accounts inherit the normal balance of the account they offset." }, { status: 400 });
  if (value.entityId && !(await getDatabase().select({ id: entities.id }).from(entities).where(and(eq(entities.id, value.entityId), eq(entities.companyId, context.company.id))).limit(1))[0]) return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  try {
    const [account] = await getDatabase().insert(chartAccounts).values(JSON.parse(JSON.stringify({ companyId: context.company.id, ...value }))).returning();
    return NextResponse.json({ account }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "An account with that code already exists." }, { status: 409 });
  }
}
