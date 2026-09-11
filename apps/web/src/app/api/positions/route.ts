import { auth } from "@clerk/nextjs/server";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, openingPositions } from "@finance/database";
import { ledgers } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { loadEntityStructure } from "@/lib/entity-structure";

/** Opening positions: absolute ledger balances at the start of a month, per entity, and per account for cash. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select().from(openingPositions).where(eq(openingPositions.companyId, context.company.id)).orderBy(asc(openingPositions.month));
  return NextResponse.json({ positions: rows.map((row) => ({ ...row, amount: Number(row.amount) })) });
}

const inputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  entityId: z.string().uuid().optional(),
  entityName: z.string().trim().min(1).optional(),
  accountEntityId: z.string().uuid().optional(),
  accountName: z.string().trim().min(1).optional(),
  balances: z.record(z.enum(ledgers), z.number()),
});

export async function POST(request: Request) {
  await auth.protect();
  const body = inputSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid opening position", details: body.error.flatten() }, { status: 400 });
  const context = await requireCompanyAccess();
  const structure = await loadEntityStructure(context.company.id);
  const entityId = body.data.entityId ?? structure.resolveEntityName(body.data.entityName) ?? structure.defaultEntityId ?? null;
  if (body.data.entityName && !entityId) return NextResponse.json({ error: `No legal entity named ${body.data.entityName}` }, { status: 404 });
  const account = body.data.accountEntityId ? structure.accounts.find((entry) => entry.id === body.data.accountEntityId) : body.data.accountName ? structure.accounts.find((entry) => entry.name.toLowerCase() === body.data.accountName!.toLowerCase()) : undefined;
  if ((body.data.accountEntityId || body.data.accountName) && !account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const db = getDatabase();
  const written = [];
  for (const [ledger, amount] of Object.entries(body.data.balances)) {
    if (!Number.isFinite(amount)) continue;
    const accountEntityId = ledger === "cash" && account ? account.id : null;
    const existing = await db.select({ id: openingPositions.id }).from(openingPositions).where(and(eq(openingPositions.companyId, context.company.id), eq(openingPositions.month, body.data.month), eq(openingPositions.ledger, ledger), entityId ? eq(openingPositions.entityId, entityId) : undefined, accountEntityId ? eq(openingPositions.accountEntityId, accountEntityId) : undefined));
    const match = existing.find(() => true);
    if (match) written.push((await db.update(openingPositions).set({ amount: String(amount), updatedAt: new Date() }).where(eq(openingPositions.id, match.id)).returning())[0]);
    else written.push((await db.insert(openingPositions).values({ companyId: context.company.id, entityId, accountEntityId, month: body.data.month, ledger, amount: String(amount) }).returning())[0]);
  }
  return NextResponse.json({ positions: written });
}

export async function DELETE(request: Request) {
  await auth.protect();
  const body = z.object({ id: z.string().uuid() }).safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const context = await requireCompanyAccess();
  const rows = await getDatabase().delete(openingPositions).where(and(eq(openingPositions.id, body.data.id), eq(openingPositions.companyId, context.company.id))).returning({ id: openingPositions.id });
  return rows.length ? NextResponse.json({ deleted: rows[0]!.id }) : NextResponse.json({ error: "Position not found" }, { status: 404 });
}
