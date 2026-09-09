import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cashEvents, evidence, getDatabase, ingestionRuns, reportingPeriods, sources, observations } from "@finance/database";
import { and, eq, inArray, desc, ne } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { requireCompanyAccess } from "@/lib/auth";
import { normalizeTransactions, parseCsvRows, parseOfx, transactionExternalKey } from "@nevermodel/ingestion";
import { classifyCashActivity } from "@/lib/financial-events";
import { storeSourceBlob } from "@/lib/blob-store";

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !/\.(csv|xlsx|xls|qbo|ofx)$/i.test(file.name)) return NextResponse.json({ error: "Upload a bank CSV, Excel workbook, or QuickBooks/OFX file" }, { status: 400 });
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const sourceHash = createHash("sha256").update(sourceBuffer).digest("hex");
  const rawText = /\.(csv|qbo|ofx)$/i.test(file.name) ? sourceBuffer.toString("utf8") : (() => {
    const workbook = XLSX.read(sourceBuffer, { type: "buffer" });
    return workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      return sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
    }).filter(Boolean).join("\n");
  })();
  const [duplicate] = await getDatabase().select({ id: evidence.id }).from(evidence).where(and(eq(evidence.companyId, context.company.id), eq(evidence.sourceHash, sourceHash)));
  if (duplicate) return NextResponse.json({ imported: 0, duplicate: true, sourceName: file.name });
  const storageReference = await storeSourceBlob(context.company.id, sourceHash, sourceBuffer);
  const [canonicalSource] = await getDatabase().insert(sources).values({ companyId: context.company.id, type: "file", filename: file.name, mimeType: file.type || "text/csv", hash: sourceHash, storageReference, byteSize: sourceBuffer.byteLength.toString(), ingestionStatus: "extracting", metadata: JSON.stringify({}) }).returning({ id: sources.id });
  const [placeholder] = await getDatabase().insert(evidence).values({ companyId: context.company.id, sourceId: canonicalSource?.id, createdByUserId: context.user.id, sourceName: file.name, sourceMime: file.type || "text/csv", sourceSize: String(sourceBuffer.byteLength), sourceHash, rawText, status: "pending" }).returning({ id: evidence.id });
  if (canonicalSource?.id) await getDatabase().insert(ingestionRuns).values({ companyId: context.company.id, sourceId: canonicalSource.id, stage: "storage", status: "succeeded", metadata: JSON.stringify({ storageReference, sourceHash }) });
  const failImport = async (message: string, status = 400) => {
    if (canonicalSource?.id) {
      await getDatabase().update(sources).set({ ingestionStatus: "failed", ingestionError: message, processedAt: new Date() }).where(eq(sources.id, canonicalSource.id));
      await getDatabase().insert(ingestionRuns).values({ companyId: context.company.id, sourceId: canonicalSource.id, stage: "classification", status: "failed", error: message, completedAt: new Date(), metadata: "{}" });
    }
    return NextResponse.json({ error: message }, { status });
  };
  const ofxTransactions = /\.(qbo|ofx)$/i.test(file.name) ? parseOfx(rawText) : null;
  const rows = ofxTransactions ? [] : parseCsvRows(rawText);
  const parsedTransactions = ofxTransactions ?? normalizeTransactions(rows, new Date().toISOString().slice(0, 7));
  if (!parsedTransactions.length) return failImport("File has no transactions");
  const headers = rows[0]?.map((header) => header.toLowerCase()) ?? [];
  const amountIndex = ofxTransactions ? 0 : headers.findIndex((header) => /amount|total|value/.test(header));
  const debitIndex = headers.findIndex((header) => /debit|withdrawal|outflow/.test(header));
  const creditIndex = headers.findIndex((header) => /credit|deposit|inflow/.test(header));
  if (!ofxTransactions && amountIndex < 0 && debitIndex < 0 && creditIndex < 0) return failImport("CSV needs an amount, debit, or credit column");
  const events = parsedTransactions.map((transaction) => {
    const externalKey = transactionExternalKey(transaction);
    const description = transaction.description || file.name;
    return { companyId: context.company.id, month: transaction.date, postedDate: transaction.postedDate, description, amount: String(transaction.amount), direction: transaction.direction, category: classifyCashActivity(description, transaction.direction), isActual: "Y" as const, externalKey };
  });
  const months = [...new Set(events.map((event) => event.month))];
  let importedCount = 0;
  let evidenceId: string | undefined;
  let reprocessEvidenceIds: string[] = [];
  if (months.length) {
    const closed = await getDatabase().select({ month: reportingPeriods.month }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, context.company.id), inArray(reportingPeriods.month, months), eq(reportingPeriods.status, "closed")));
    if (closed.length) return failImport(`Closed reporting month: ${closed[0]!.month}`, 409);
    evidenceId = placeholder?.id;
    const inserted = await getDatabase().insert(cashEvents).values(events.map(({ postedDate, ...event }) => ({ ...event, transactionDate: postedDate, evidenceId: placeholder!.id, sourceId: canonicalSource?.id }))).onConflictDoNothing({ target: [cashEvents.companyId, cashEvents.externalKey] }).returning({ id: cashEvents.id });
    if (canonicalSource?.id) {
      const keys = events.map((event) => event.externalKey).filter((key): key is string => Boolean(key));
      const canonicalEvents = await getDatabase().select({ id: cashEvents.id, externalKey: cashEvents.externalKey }).from(cashEvents).where(and(eq(cashEvents.companyId, context.company.id), inArray(cashEvents.externalKey, keys)));
      const eventByKey = new Map(canonicalEvents.map((event) => [event.externalKey, event.id]));
      await getDatabase().insert(observations).values(events.map((event) => ({ companyId: context.company.id, sourceId: canonicalSource.id, eventId: eventByKey.get(event.externalKey), type: "bank_transaction", effectiveDate: new Date(`${event.postedDate ?? `${event.month}-01`}T00:00:00Z`), amount: event.amount, counterpartyText: event.description, attributes: JSON.stringify({ direction: event.direction, externalKey: event.externalKey, postedDate: event.postedDate }), confidence: "high" })));
    }
    await getDatabase().update(evidence).set({ extractedJson: JSON.stringify({ summary: `${events.length} actual transactions imported`, facts: [{ label: "Transactions", value: String(events.length), confidence: 1 }], questions: [] }), status: "approved", updatedAt: new Date() }).where(eq(evidence.id, placeholder!.id));
    await getDatabase().update(sources).set({ ingestionStatus: "review", processedAt: new Date(), metadata: JSON.stringify({ importedTransactions: events.length }) }).where(eq(sources.id, canonicalSource!.id));
    await getDatabase().insert(ingestionRuns).values([
      { companyId: context.company.id, sourceId: canonicalSource!.id, stage: "classification", status: "succeeded", metadata: JSON.stringify({ transactions: events.length }) },
      { companyId: context.company.id, sourceId: canonicalSource!.id, stage: "reconciliation", status: "waiting", metadata: JSON.stringify({ months }) },
    ]);
    const related = await getDatabase().select({ id: evidence.id, sourceId: evidence.sourceId }).from(evidence).where(and(eq(evidence.companyId, context.company.id), ne(evidence.id, placeholder!.id), inArray(evidence.reportingMonth, months), eq(evidence.status, "approved")));
    reprocessEvidenceIds = related.flatMap((item) => item.sourceId ? [item.id] : []);
    await Promise.all(related.flatMap((item) => item.sourceId ? [
      getDatabase().update(sources).set({ ingestionStatus: "review", ingestionError: null, processedAt: new Date() }).where(eq(sources.id, item.sourceId)),
      getDatabase().insert(ingestionRuns).values({ companyId: context.company.id, sourceId: item.sourceId, stage: "reconciliation", status: "waiting", metadata: JSON.stringify({ triggeredByEvidenceId: placeholder!.id, months }) }),
    ] : []));
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
  return NextResponse.json({ id: evidenceId, imported: importedCount, skipped: events.length - importedCount, sourceName: file.name, extraction, reprocessEvidenceIds });
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
