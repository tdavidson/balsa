import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLog, bankConnections, getDatabase, recordAudit, withCompanyTransaction } from "@finance/database";
import { tellerConfig, validWebhook } from "@/lib/teller";
export const runtime = "nodejs";
export async function POST(request: Request) {
  // Verify the exact bounded raw body before any database access. Never trust payload transaction data.
  const reader = request.body?.getReader(); if (!reader) return new NextResponse(null, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 1_000_000) { await reader.cancel(); return new NextResponse(null, { status: 413 }); } chunks.push(next.value); }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!validWebhook(body, request.headers.get("teller-signature"))) return new NextResponse(null, { status: 401 });
  try {
    const event = z.object({ id: z.string().max(128), type: z.string().max(100), payload: z.object({ enrollment_id: z.string().max(128).optional() }) }).parse(JSON.parse(body));
    if (!["transactions.processed", "enrollment.disconnected"].includes(event.type)) return NextResponse.json({ received: true });
    if (!event.payload.enrollment_id) return new NextResponse(null, { status: 400 });
    const config = tellerConfig();
    // Verified provider identifier resolves the tenant; no caller-supplied company ID.
    const [connection] = await getDatabase().select({ id: bankConnections.id, companyId: bankConnections.companyId }).from(bankConnections).where(and(eq(bankConnections.enrollmentId, event.payload.enrollment_id), eq(bankConnections.applicationId, config.applicationId), eq(bankConnections.environment, config.environment), eq(bankConnections.status, "active")));
    if (connection) await withCompanyTransaction(getDatabase(), connection.companyId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7410, hashtext(${connection.companyId}))`);
      const [seen] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.companyId, connection.companyId), eq(auditLog.requestId, event.id), eq(auditLog.action, "bank.webhook")));
      if (seen) return;
      await tx.update(bankConnections).set({ nextSyncAt: new Date(), ...(event.type === "enrollment.disconnected" ? { status: "reconnect", error: "Reconnect this bank to resume automatic sync." } : {}), updatedAt: new Date() }).where(and(eq(bankConnections.companyId, connection.companyId), eq(bankConnections.id, connection.id), eq(bankConnections.status, "active")));
      await recordAudit(tx, { companyId: connection.companyId, actorUserId: null, via: "worker", action: "bank.webhook", entityType: "bank_connection", entityId: connection.id, summary: event.type === "enrollment.disconnected" ? "Teller reported a disconnected enrollment." : "Teller queued a bank sync.", requestId: event.id });
    });
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ error: "Unable to process bank webhook." }, { status: 503 }); }
}
