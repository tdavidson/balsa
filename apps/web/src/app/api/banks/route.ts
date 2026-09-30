import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import { bankWorkspace, disconnectBank, finishBankConnect, mapBankAccount, syncBankConnection } from "@/lib/bank-connections";
import { bankErrorResponse, bankJson } from "@/lib/bank-http";
import { BankError } from "@/lib/teller";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  try { const context = await requireOwner(); return NextResponse.json(await bankWorkspace(context.company.id)); }
  catch (error) { return bankErrorResponse(error); }
}
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), enrollment: z.unknown() }),
  z.object({ action: z.literal("sync"), id: z.uuid() }),
  z.object({ action: z.literal("disconnect"), id: z.uuid() }),
  z.object({ action: z.literal("map"), accountId: z.uuid(), chartAccountId: z.uuid().nullable() }),
]);
export async function POST(request: Request) {
  try {
    const context = await requireOwner(); const parsed = commandSchema.safeParse(await bankJson(request));
    if (!parsed.success) throw new BankError("Invalid bank action."); const command = parsed.data;
    if (command.action === "connect") return NextResponse.json(await finishBankConnect(context.company.id, context.user.id, command.enrollment));
    if (command.action === "sync") return NextResponse.json(await syncBankConnection(context.company.id, command.id, context.user.id));
    if (command.action === "disconnect") await disconnectBank(context.company.id, command.id, context.user.id);
    else await mapBankAccount(context.company.id, context.user.id, command.accountId, command.chartAccountId);
    return NextResponse.json({ ok: true });
  } catch (error) { return bankErrorResponse(error); }
}
