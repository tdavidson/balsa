import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { allocations, entities, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { z } from "zod";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [rows, entityRows] = await Promise.all([
    db.select().from(allocations).where(eq(allocations.companyId, context.company.id)),
    db.select({ id: entities.id, name: entities.name, type: entities.type }).from(entities).where(eq(entities.companyId, context.company.id)),
  ]);
  const names = new Map(entityRows.map((entity) => [entity.id, entity.name]));
  const dueByBearer = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "approved" || !row.bearerEntityId) continue;
    const amount = Number(row.amount ?? 0);
    if (Number.isFinite(amount)) dueByBearer.set(row.bearerEntityId, (dueByBearer.get(row.bearerEntityId) ?? 0) + amount);
  }
  return NextResponse.json({ allocations: rows, dueFromFunds: [...dueByBearer.entries()].map(([entityId, amount]) => ({ entityId, entityName: names.get(entityId) ?? "Unknown entity", amount })) });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = z.object({ id: z.string().uuid(), status: z.enum(["proposed", "approved", "rejected"]) }).safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid allocation update" }, { status: 400 });
  const [allocation] = await getDatabase().update(allocations).set({ status: body.data.status, updatedAt: new Date() }).where(and(eq(allocations.id, body.data.id), eq(allocations.companyId, context.company.id))).returning();
  if (!allocation) return NextResponse.json({ error: "Allocation not found" }, { status: 404 });
  const calculationRun = await refreshCurrentCalculationRun(context.company.id, { cause: { kind: "allocation_changed", subjectType: "allocation", subjectId: allocation.id, actorUserId: context.user.id, via: "ui" } });
  return NextResponse.json({ allocation, calculationRun });
}
