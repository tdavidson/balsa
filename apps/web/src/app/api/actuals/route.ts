import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cashEvents, evidence, getDatabase, reportingPeriods, sources, observations } from "@finance/database";
import { and, eq, inArray, desc } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { requireCompanyAccess } from "@/lib/auth";
import { normalizeTransactions, parseCsvRows, parseOfx, transactionExternalKey } from "@nevermodel/ingestion";
import { classifyCashActivity } from "@/lib/financial-events";

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !/\.(csv|xlsx|xls|qbo|ofx)$/i.test(file.name)) return NextResponse.json({ error: "Upload a bank CSV, Excel workbook, or QuickBooks/OFX file" }, { status: 400 });
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const rawText = /\.(csv|qbo|ofx)$/i.test(file.name) ? sourceBuffer.toString("utf8") : (() => {
    const workbook = XLSX.read(sourceBuffer, { type: "buffer" });
    return workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      return sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
    }).filter(Boolean).join("\n");
  })();
  const ofxTransactions = /\.(qbo|ofx)$/i.test(file.name) ? parseOfx(rawText) : null;
  const rows = ofxTransactions ? [] : parseCsvRows(rawText);
  const parsedTransactions = ofxTransactions ?? normalizeTransactions(rows, new Date().toISOString().slice(0, 7));
  if (!parsedTransactions.length) return NextResponse.json({ error: "File has no transactions" }, { status: 400 });
  const headers = rows[0]?.map((header) => header.toLowerCase()) ?? [];
  const amountIndex = ofxTransactions ? 0 : headers.findIndex((header) => /amount|total|value/.test(header));
  const debitIndex = headers.findIndex((header) => /debit|withdrawal|outflow/.test(header));
  const creditIndex = headers.findIndex((header) => /credit|deposit|inflow/.test(header));
  if (!ofxTransactions && amountIndex < 0 && debitIndex < 0 && creditIndex < 0) return NextResponse.json({ error: "CSV needs an amount, debit, or credit column" }, { status: 400 });
  const sourceHash = createHash("sha256").update(sourceBuffer).digest("hex");
  const [duplicate] = await getDatabase().select({ id: evidence.id }).from(evidence).where(and(eq(evidence.companyId, context.company.id), eq(evidence.sourceHash, sourceHash)));
  if (duplicate) return NextResponse.json({ imported: 0, duplicate: true, sourceName: file.name });
  const events = parsedTransactions.map((transaction) => {
    const externalKey = transactionExternalKey(transaction);
    const description = transaction.description || file.name;
    return { companyId: context.company.id, month: transaction.date, postedDate: transaction.postedDate, description, amount: String(transaction.amount), direction: transaction.direction, category: classifyCashActivity(description, transaction.direction), isActual: "Y" as const, externalKey };
  });
  const months = [...new Set(events.map((event) => event.month))];
  let importedCount = 0;
  let evidenceId: string | undefined;
  if (months.length) {
    const closed = await getDatabase().select({ month: reportingPeriods.month }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, context.company.id), inArray(reportingPeriods.month, months), eq(reportingPeriods.status, "closed")));
    if (closed.length) return NextResponse.json({ error: `Closed reporting month: ${closed[0]!.month}` }, { status: 409 });
    const [canonicalSource] = await getDatabase().insert(sources).values({ companyId: context.company.id, type: "file", filename: file.name, mimeType: file.type || "text/csv", hash: sourceHash, metadata: JSON.stringify({ importedTransactions: events.length }) }).returning({ id: sources.id });
    const [source] = await getDatabase().insert(evidence).values({
      companyId: context.company.id,
      sourceId: canonicalSource?.id,
      createdByUserId: context.user.id,
      sourceName: file.name,
      sourceMime: file.type || "text/csv",
      sourceSize: String(sourceBuffer.byteLength),
      sourceHash,
      rawText,
      extractedJson: JSON.stringify({ summary: `${events.length} actual transactions imported`, facts: [{ label: "Transactions", value: String(events.length), confidence: 1 }], questions: [] }),
      status: "approved",
    }).returning({ id: evidence.id });
    evidenceId = source?.id;
    const inserted = await getDatabase().insert(cashEvents).values(events.map(({ postedDate, ...event }) => ({ ...event, transactionDate: postedDate, evidenceId: source!.id, sourceId: canonicalSource?.id }))).onConflictDoNothing({ target: [cashEvents.companyId, cashEvents.externalKey] }).returning({ id: cashEvents.id });
    if (canonicalSource?.id) {
      const keys = events.map((event) => event.externalKey).filter((key): key is string => Boolean(key));
      const canonicalEvents = await getDatabase().select({ id: cashEvents.id, externalKey: cashEvents.externalKey }).from(cashEvents).where(and(eq(cashEvents.companyId, context.company.id), inArray(cashEvents.externalKey, keys)));
      const eventByKey = new Map(canonicalEvents.map((event) => [event.externalKey, event.id]));
      await getDatabase().insert(observations).values(events.map((event) => ({ companyId: context.company.id, sourceId: canonicalSource.id, eventId: eventByKey.get(event.externalKey), type: "bank_transaction", effectiveDate: new Date(`${event.postedDate ?? `${event.month}-01`}T00:00:00Z`), amount: event.amount, counterpartyText: event.description, attributes: JSON.stringify({ direction: event.direction, externalKey: event.externalKey, postedDate: event.postedDate }), confidence: "high" })));
    }
    importedCount = inserted.length;
  }
  const extraction = {
    summary: `${events.length} actual transactions imported with statement dates, amounts, and descriptions or notes`,
    facts: events.slice(0, 200).map((event) => ({
      label: `Transaction ${event.postedDate ?? event.month}`,
      value: `${event.direction === "spend" ? "−" : "+"}$${Number(event.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — ${event.description}`,
      confidence: 1,
    })),
    questions: [] as string[],
  };
  return NextResponse.json({ id: evidenceId, imported: importedCount, skipped: events.length - importedCount, sourceName: file.name, extraction });
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select({
    id: cashEvents.id,
    month: cashEvents.month,
    transactionDate: cashEvents.transactionDate,
    description: cashEvents.description,
    amount: cashEvents.amount,
    direction: cashEvents.direction,
    sourceId: cashEvents.evidenceId,
    sourceName: evidence.sourceName,
    sourceHash: evidence.sourceHash,
  }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.isActual, "Y"))).orderBy(desc(cashEvents.month), desc(cashEvents.createdAt));
  return NextResponse.json({ actuals: rows });
}
