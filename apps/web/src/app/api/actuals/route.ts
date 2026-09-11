import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cashEvents, decisions, entities, evidence, factRecords, getDatabase, ingestionRuns, reportingPeriods, policies, reviewItems, sources, observations } from "@finance/database";
import { and, eq, inArray, desc, ne } from "drizzle-orm";
import { createHash } from "node:crypto";
import { requireCompanyAccess } from "@/lib/auth";
import { classifySource, detectSourceCurrencies, normalizeTransactions, parseCsvRows, parseOfx, transactionExternalKey } from "@nevermodel/ingestion";
import { classifyCashActivity } from "@/lib/financial-events";
import { storeSourceBlob } from "@/lib/blob-store";
import { classifyWithCompanyPolicy } from "@/lib/company-policy-engine";
import { assertExtractedTextSize, assertUploadSize } from "@/lib/ingestion-guardrails";
import { extractSpreadsheetText } from "@/lib/spreadsheet-extraction";
import { takeRateLimit } from "@/lib/request-rate-limit";
import { categorizeTransactions, resolveCounterparty, type KnownEntity } from "@/lib/interpretation";
import { getModelProvider, modelRequestSchema, resolveModelOverrides } from "@/lib/models";
import { recordLlmRun } from "@/lib/llm-telemetry";
import { loadEntityStructure, resolveImportAccount } from "@/lib/entity-structure";

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const quota = takeRateLimit(`actuals:${context.company.id}:${context.user.id}`, 20, 60 * 60 * 1_000);
  if (!quota.allowed) return NextResponse.json({ error: "Upload limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !/\.(csv|xlsx|xls|qbo|ofx)$/i.test(file.name)) return NextResponse.json({ error: "Upload a bank CSV, Excel workbook, or QuickBooks/OFX file" }, { status: 400 });
  if (file.name.length > 255) return NextResponse.json({ error: "File names must be 255 characters or fewer" }, { status: 400 });
  try { assertUploadSize(file.size); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "File is too large" }, { status: 413 }); }
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const sourceHash = createHash("sha256").update(sourceBuffer).digest("hex");
  const rawText = /\.(csv|qbo|ofx)$/i.test(file.name) ? sourceBuffer.toString("utf8") : await extractSpreadsheetText(sourceBuffer);
  try { assertExtractedTextSize(rawText); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Extracted text is too large" }, { status: 413 }); }
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
  const sourceClassification = classifySource({ filename: file.name, mimeType: file.type || "text/csv", text: rawText });
  const detectedCurrencies = detectSourceCurrencies(rawText);
  const sourceCurrency = detectedCurrencies.length === 1 ? detectedCurrencies[0] : undefined;
  const activePolicies = await getDatabase().select({ id: policies.id, name: policies.name, rule: policies.rule, scope: policies.scope, effectiveFrom: policies.effectiveFrom }).from(policies).where(and(eq(policies.companyId, context.company.id), eq(policies.active, "Y")));
  if (!parsedTransactions.length) return failImport("File has no transactions");
  const headers = rows[0]?.map((header) => header.toLowerCase()) ?? [];
  const amountIndex = ofxTransactions ? 0 : headers.findIndex((header) => /amount|total|value/.test(header));
  const debitIndex = headers.findIndex((header) => /debit|withdrawal|outflow/.test(header));
  const creditIndex = headers.findIndex((header) => /credit|deposit|inflow/.test(header));
  if (!ofxTransactions && amountIndex < 0 && debitIndex < 0 && creditIndex < 0) return failImport("CSV needs an amount, debit, or credit column");
  // Which company account the file belongs to: an explicit choice, the note typed
  // with the upload, the file name, or the only account the company has.
  const structure = await loadEntityStructure(context.company.id);
  const importNote = String(form.get("instructions") || "").trim() || undefined;
  const account = resolveImportAccount(structure, { accountId: String(form.get("account") || "") || undefined, note: importNote, fileName: file.name });
  const accountEntityId = account?.id;
  const entityId = structure.entityOfAccount(accountEntityId);
  const events = parsedTransactions.map((transaction) => {
    const externalKey = transactionExternalKey(transaction);
    const description = transaction.description || file.name;
    const policyClassification = classifyWithCompanyPolicy(description, activePolicies, { effectiveDate: transaction.postedDate ?? transaction.date, sourceKind: sourceClassification.kind, sourceName: file.name });
    // Parsed rows are retained for matching and review, but they must not become
    // financial actuals until the source's accounting treatment is approved.
    return { companyId: context.company.id, month: transaction.date, postedDate: transaction.postedDate, sourceLocation: transaction.sourceLocation, description, amount: String(transaction.amount), ...(sourceCurrency ? { currency: sourceCurrency } : {}), direction: transaction.direction, category: policyClassification?.category ?? classifyCashActivity(description, transaction.direction), ...(policyClassification ? { policyId: policyClassification.policyId } : {}), accountingTreatment: "pending", isActual: "N" as const, externalKey, accountEntityId, entityId };
  });
  const months = [...new Set(events.map((event) => event.month))];
  let importedCount = 0;
  let evidenceId: string | undefined;
  let reprocessEvidenceIds: string[] = [];
  if (months.length) {
    const closed = await getDatabase().select({ month: reportingPeriods.month }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, context.company.id), inArray(reportingPeriods.month, months), eq(reportingPeriods.status, "closed")));
    if (closed.length) return failImport(`Closed reporting month: ${closed[0]!.month}`, 409);
    evidenceId = placeholder?.id;
    const inserted = await getDatabase().insert(cashEvents).values(events.map(({ postedDate, ...event }) => ({ ...event, transactionDate: postedDate, evidenceId: placeholder!.id, sourceId: canonicalSource?.id }))).onConflictDoNothing({ target: [cashEvents.companyId, cashEvents.externalKey] }).returning({ id: cashEvents.id, externalKey: cashEvents.externalKey });
    // Categorize the staged rows for the income statement while they wait for
    // treatment approval: known counterparties resolve locally, the rest go to
    // the model in batches. The activity class set above (and any policy
    // classification) is kept unless the model finds a transfer, investment,
    // or financing movement in an unclassified row.
    const insertedKeys = new Set(inserted.map((row) => row.externalKey));
    const toCategorize = events.map((event, index) => ({ index, date: event.postedDate, description: event.description, amount: Number(event.amount), direction: event.direction, externalKey: event.externalKey, category: event.category, policyId: event.policyId })).filter((event) => insertedKeys.has(event.externalKey));
    if (toCategorize.length) {
      const db = getDatabase();
      const [entityRows, decisionRows] = await Promise.all([
        db.select({ id: entities.id, name: entities.name, type: entities.type, attributes: entities.attributes }).from(entities).where(eq(entities.companyId, context.company.id)),
        db.select({ question: decisions.question, answer: decisions.answer }).from(decisions).where(and(eq(decisions.companyId, context.company.id), eq(decisions.status, "applied"))),
      ]);
      const candidates: KnownEntity[] = entityRows.filter((entity) => entity.type !== "legal_entity" && entity.type !== "account");
      const choice = modelRequestSchema.safeParse({ model: String(form.get("model") || "") || undefined, effort: String(form.get("effort") || "") || undefined });
      const provider = getModelProvider(resolveModelOverrides(choice.success ? choice.data : {}));
      const categorized = await categorizeTransactions({ provider, transactions: toCategorize, entities: candidates, policies: activePolicies.map((policy) => ({ name: policy.name, rule: policy.rule })), decisions: decisionRows, activityOf: classifyCashActivity });
      const modelResults = categorized.filter((entry) => entry.source === "model");
      if (modelResults.length) await recordLlmRun({ db, provider, companyId: context.company.id, userId: context.user.id, operation: "transaction_categorization", request: { sourceName: file.name, transactions: toCategorize.length, sentToModel: modelResults.length }, response: JSON.stringify(modelResults.slice(0, 200)) });
      const byIndex = new Map(toCategorize.map((event) => [event.index, event]));
      for (const entry of categorized) {
        const event = byIndex.get(entry.index);
        if (!event) continue;
        const entity = entry.counterparty && entry.activity === "operating" ? await resolveCounterparty(db, context.company.id, { name: entry.counterparty, alias: event.description, category: entry.category, direction: event.direction, candidates }) : undefined;
        const activityOverride = !event.policyId && entry.activity !== "operating" ? entry.activity : !event.policyId && event.category === "unclassified" && entry.category ? (entry.category === "management_fee" || entry.category === "other_revenue" ? "revenue" : "expense") : undefined;
        await db.update(cashEvents).set({ ...(activityOverride ? { category: activityOverride } : {}), financialCategory: entry.category ?? undefined, counterpartyEntityId: entity?.id, updatedAt: new Date() }).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.externalKey, event.externalKey)));
      }
      const uncertain = categorized.filter((entry) => entry.activity === "operating" && (!entry.category || entry.confidence < 0.6));
      if (uncertain.length) {
        const names = [...new Set(uncertain.map((entry) => entry.counterparty ?? byIndex.get(entry.index)?.description ?? "").filter(Boolean))].slice(0, 8);
        await db.insert(reviewItems).values({ companyId: context.company.id, evidenceId: placeholder!.id, reviewKey: `categorization:${placeholder!.id}`, question: `${uncertain.length} imported transaction${uncertain.length === 1 ? "" : "s"} from ${file.name} could not be categorized with confidence (${names.join(", ")}${uncertain.length > names.length ? ", …" : ""}). Which income statement line should each counterparty use?` });
      }
      if (!account && structure.accounts.length > 1) await db.insert(reviewItems).values({ companyId: context.company.id, evidenceId: placeholder!.id, reviewKey: `account:${placeholder!.id}`, question: `Which account do the ${events.length} transactions in ${file.name} belong to? (${structure.accounts.map((entry) => entry.name).join(", ")})` });
    }
    if (canonicalSource?.id) {
      const keys = events.map((event) => event.externalKey).filter((key): key is string => Boolean(key));
      const canonicalEvents = await getDatabase().select({ id: cashEvents.id, externalKey: cashEvents.externalKey }).from(cashEvents).where(and(eq(cashEvents.companyId, context.company.id), inArray(cashEvents.externalKey, keys)));
      const eventByKey = new Map(canonicalEvents.map((event) => [event.externalKey, event.id]));
      await getDatabase().insert(observations).values(events.map((event) => ({ companyId: context.company.id, sourceId: canonicalSource.id, eventId: eventByKey.get(event.externalKey), type: "bank_transaction", effectiveDate: new Date(`${event.postedDate ?? `${event.month}-01`}T00:00:00Z`), amount: event.amount, ...(sourceCurrency ? { currency: sourceCurrency } : {}), counterpartyText: event.description, attributes: JSON.stringify({ direction: event.direction, externalKey: event.externalKey, postedDate: event.postedDate, sourceLocation: event.sourceLocation }), confidence: "high" })));
    }
    const importedFact = { label: "Imported transaction set", value: `${events.length} transactions parsed from ${file.name}; approve the source and treatment to post them as actual cash activity.`, accountingRole: "transaction", confidence: 1 };
    await getDatabase().update(evidence).set({ extractedJson: JSON.stringify({ summary: `${events.length} transactions parsed and staged for review${account ? ` (${account.name})` : ""}`, facts: [importedFact], questions: [] }), ...(sourceCurrency ? { currency: sourceCurrency } : {}), accountEntityId, status: "pending", updatedAt: new Date() }).where(eq(evidence.id, placeholder!.id));
    await getDatabase().insert(factRecords).values({ companyId: context.company.id, evidenceId: placeholder!.id, ...importedFact, sourceLocation: "transaction file", ...(sourceCurrency ? { currency: sourceCurrency } : {}), confidence: String(importedFact.confidence), status: "pending" });
    await getDatabase().update(sources).set({ ingestionStatus: "review", processedAt: new Date(), metadata: JSON.stringify({ importedTransactions: events.length, classification: sourceClassification, currencies: detectedCurrencies }) }).where(eq(sources.id, canonicalSource!.id));
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
    summary: `${events.length} transactions staged with statement dates, amounts, and descriptions or notes; approve their accounting treatment to post actuals`,
    facts: events.slice(0, 200).map((event) => ({
      label: `Transaction ${event.postedDate ?? event.month} (${event.sourceLocation ?? "source row unavailable"})`,
      value: `${event.direction === "spend" ? "−" : "+"}$${Number(event.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — ${event.description}`,
      confidence: 1,
    })),
    questions: [] as string[],
  };
  return NextResponse.json({ id: evidenceId, imported: importedCount, skipped: events.length - importedCount, sourceName: file.name, account: account ? { id: account.id, name: account.name } : null, extraction, reprocessEvidenceIds });
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
