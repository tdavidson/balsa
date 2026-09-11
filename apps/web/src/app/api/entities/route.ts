import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { entities, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { loadEntityStructure } from "@/lib/entity-structure";
import { parseEntityAttributes } from "@/lib/interpretation";

/** The company's legal entities and accounts, the structure consolidated statements are built on. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const structure = await loadEntityStructure(context.company.id);
  return NextResponse.json({ legalEntities: structure.legalEntities, accounts: structure.accounts.map((account) => ({ id: account.id, name: account.name, ownerEntityId: account.ownerEntityId, accountIdentifier: parseEntityAttributes(account.attributes).accountIdentifier ?? null, accountHolder: parseEntityAttributes(account.attributes).accountHolder ?? null })), defaultEntityId: structure.defaultEntityId ?? null });
}

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("legal_entity"), name: z.string().trim().min(1).max(200), consolidated: z.boolean().default(true) }),
  z.object({ kind: z.literal("account"), name: z.string().trim().min(1).max(200), ownerEntityId: z.string().uuid().optional(), ownerName: z.string().trim().min(1).optional(), accountIdentifier: z.string().trim().max(40).optional(), accountHolder: z.string().trim().max(200).optional() }),
]);

export async function POST(request: Request) {
  await auth.protect();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid entity", details: body.error.flatten() }, { status: 400 });
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const structure = await loadEntityStructure(context.company.id);
  if (body.data.kind === "legal_entity") {
    const existing = structure.resolveEntityName(body.data.name);
    if (existing) {
      const [row] = await db.update(entities).set({ consolidated: body.data.consolidated ? "Y" : "N", updatedAt: new Date() }).where(and(eq(entities.id, existing), eq(entities.companyId, context.company.id))).returning({ id: entities.id, name: entities.name });
      return NextResponse.json({ entity: row, created: false });
    }
    const [row] = await db.insert(entities).values({ companyId: context.company.id, type: "legal_entity", name: body.data.name, consolidated: body.data.consolidated ? "Y" : "N", attributes: "{}" }).returning({ id: entities.id, name: entities.name });
    return NextResponse.json({ entity: row, created: true });
  }
  const ownerEntityId = body.data.ownerEntityId ?? structure.resolveEntityName(body.data.ownerName) ?? structure.defaultEntityId;
  if (body.data.ownerName && !ownerEntityId) return NextResponse.json({ error: `No legal entity named ${body.data.ownerName}. Create it first with "entity: ${body.data.ownerName}".` }, { status: 404 });
  const attributes = { ...(body.data.accountIdentifier ? { accountIdentifier: body.data.accountIdentifier } : {}), ...(body.data.accountHolder ? { accountHolder: body.data.accountHolder } : {}) };
  const existing = structure.accounts.find((account) => account.name.toLowerCase() === body.data.name.toLowerCase());
  if (existing) {
    const [row] = await db.update(entities).set({ ownerEntityId, attributes: JSON.stringify({ ...parseEntityAttributes(existing.attributes), ...attributes }), updatedAt: new Date() }).where(and(eq(entities.id, existing.id), eq(entities.companyId, context.company.id))).returning({ id: entities.id, name: entities.name, ownerEntityId: entities.ownerEntityId });
    return NextResponse.json({ account: row, created: false });
  }
  const [row] = await db.insert(entities).values({ companyId: context.company.id, type: "account", name: body.data.name, ownerEntityId, attributes: JSON.stringify(attributes) }).returning({ id: entities.id, name: entities.name, ownerEntityId: entities.ownerEntityId });
  return NextResponse.json({ account: row, created: true });
}

const patchSchema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(200).optional(), consolidated: z.boolean().optional(), ownerEntityId: z.string().uuid().nullable().optional() });

export async function PATCH(request: Request) {
  await auth.protect();
  const body = patchSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid entity update" }, { status: 400 });
  const context = await requireCompanyAccess();
  const [row] = await getDatabase().update(entities).set({ ...(body.data.name ? { name: body.data.name } : {}), ...(body.data.consolidated !== undefined ? { consolidated: body.data.consolidated ? "Y" : "N" } : {}), ...(body.data.ownerEntityId !== undefined ? { ownerEntityId: body.data.ownerEntityId } : {}), updatedAt: new Date() }).where(and(eq(entities.id, body.data.id), eq(entities.companyId, context.company.id))).returning({ id: entities.id, name: entities.name, type: entities.type, consolidated: entities.consolidated, ownerEntityId: entities.ownerEntityId });
  if (!row) return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  return NextResponse.json({ entity: row });
}
