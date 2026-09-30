import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { startBankConnect } from "@/lib/bank-connections";
import { BankError } from "@/lib/teller";
import { takeRateLimit } from "@/lib/request-rate-limit";
import { bankErrorResponse } from "@/lib/bank-http";
export async function POST() {
  try { const context = await requireOwner(); if (!takeRateLimit(`bank-connect:${context.user.id}`, 20, 600_000).allowed) throw new BankError("Too many bank connection attempts. Retry in a few minutes.", 429); return NextResponse.json(await startBankConnect(context.company.id, context.user.id)); }
  catch (error) { return bankErrorResponse(error); }
}
