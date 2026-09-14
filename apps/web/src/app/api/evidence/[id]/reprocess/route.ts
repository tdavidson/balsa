import { auth } from "@/lib/auth";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { cashEvents, companies, economicItems, entities, evidence, factRecords, getDatabase, ingestionRuns, observations, policies, reviewItems, sources } from "@finance/database";
import { classifySource, detectSourceCurrencies, extractPdfDocument, extractStructuredStatementFacts, mergeStatementFacts, type PdfExtractionQuality } from "@nevermodel/ingestion";
import { requireCompanyAccess } from "@/lib/auth";
import { getModelProvider, modelRequestSchema, resolveModelOverrides } from "@/lib/models";
import { recordLlmRun } from "@/lib/llm-telemetry";
import { readSourceBlob } from "@/lib/blob-store";
import { uniqueReviewQuestions } from "@/lib/review-questions";
import { matchStatementAccount } from "@/lib/account-matching";
import { parseFinancialAmount } from "@/lib/financial-events";
import { compareEvidenceFacts, type EvidenceFact } from "@/lib/evidence-diff";
import { policyAppliesInContext } from "@/lib/company-policy-engine";
import { z } from "zod";
import { assertExtractedTextSize, assertUploadSize } from "@/lib/ingestion-guardrails";
import { inspectSpreadsheet, type WorkbookStructure } from "@/lib/spreadsheet-extraction";
import { takeRateLimit } from "@/lib/request-rate-limit";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";
import { hasScheduledJobAuthorization } from "@/lib/cron-auth";
import { optionalStatementDateSchema } from "@/lib/statement-date";
import { validQuestionsForSource } from "@/lib/source-review-questions";

const extractionSchema = z.object({
  summary: z.string(),
  statementMetadata: z.object({ accountHolder: z.string().optional(), accountIdentifier: z.string().optional(), statementPeriodStart: optionalStatementDateSchema, statementPeriodEnd: optionalStatementDateSchema, openingBalance: z.string().optional(), endingBalance: z.string().optional() }).optional(),
  facts: z.array(z.object({ label: z.string(), value: z.string(), accountingRole: z.enum(["transaction", "opening_balance", "ending_balance", "transfer", "investment_movement", "revenue", "expense", "financing", "summary", "agreement", "unknown"]).default("unknown"), confidence: z.number().min(0).max(1) })),
  questions: z.array(z.string()),
});

function sourceLocationForFact(rawText: string, fact: { label: string }) {
  const location = rawText.toLowerCase().indexOf(fact.label.trim().toLowerCase());
  if (location < 0) return "source text";
  const sections = [...rawText.slice(0, location).matchAll(/^---\s*(?:page\s+)?(.+?)\s*---\s*$/gim)];
  return sections.at(-1)?.[1]?.trim() ?? "source text";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = getDatabase();
  const { id } = await params;
  const requestedCompanyId = new URL(request.url).searchParams.get("companyId");
  const workerSecret = process.env.CRON_SECRET;
  const isWorkerRequest = Boolean(requestedCompanyId && hasScheduledJobAuthorization(request.headers.get("authorization"), workerSecret));
  let context: Awaited<ReturnType<typeof requireCompanyAccess>> | { company: typeof companies.$inferSelect; user: { id: string } };
  if (isWorkerRequest) {
    const [company] = await db.select().from(companies).where(eq(companies.id, requestedCompanyId!));
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    const [document] = await db.select({ createdByUserId: evidence.createdByUserId }).from(evidence).where(and(eq(evidence.id, id), eq(evidence.companyId, company.id)));
    if (!document) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
    context = { company, user: { id: document.createdByUserId } };
  } else {
    await auth.protect();
    context = await requireCompanyAccess();
    const quota = takeRateLimit(`reprocess:${context.company.id}:${context.user.id}`, 20, 60 * 60 * 1_000);
    if (!quota.allowed) return NextResponse.json({ error: "Reprocessing limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(quota.retryAfterSeconds) } });
  }
  const choice = modelRequestSchema.safeParse(await request.json().catch(() => ({})));
  const [source] = await getDatabase().select({ evidenceId: evidence.id, sourceId: evidence.sourceId, sourceName: evidence.sourceName, sourceMime: evidence.sourceMime, sourceHash: sources.hash, storageReference: sources.storageReference, sourceMetadata: sources.metadata, reportingMonth: evidence.reportingMonth, accountIdentifier: evidence.accountIdentifier, previousExtractedJson: evidence.extractedJson }).from(evidence).innerJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.id, id), eq(evidence.companyId, context.company.id)));
  if (!source?.storageReference) return NextResponse.json({ error: "This source has no retained original file" }, { status: 404 });
  await db.update(sources).set({ ingestionStatus: "extracting", ingestionError: null, processedAt: null }).where(and(eq(sources.id, source.sourceId!), eq(sources.companyId, context.company.id)));
  await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "extraction", status: "running", metadata: JSON.stringify({ reprocess: true }) });
  const finishExtractionRuns = async (status: "succeeded" | "failed", metadata: Record<string, unknown>, error?: string) => {
    const completedAt = new Date();
    await db.update(ingestionRuns).set({ status, ...(error ? { error } : {}), completedAt, metadata: JSON.stringify(metadata), updatedAt: completedAt }).where(and(
      eq(ingestionRuns.companyId, context.company.id),
      eq(ingestionRuns.sourceId, source.sourceId!),
      eq(ingestionRuns.stage, "extraction"),
      or(eq(ingestionRuns.status, "waiting"), eq(ingestionRuns.status, "running")),
    ));
  };
  let bytes: Buffer;
  try { bytes = await readSourceBlob(source.storageReference); } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read retained source";
    await db.update(sources).set({ ingestionStatus: "failed", ingestionError: message, processedAt: new Date() }).where(eq(sources.id, source.sourceId!));
    await finishExtractionRuns("failed", { reprocess: true, failure: "storage_read" }, message);
    await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "extraction", status: "failed", error: message, completedAt: new Date(), metadata: JSON.stringify({ reprocess: true }) });
    return NextResponse.json({ error: message }, { status: 404 });
  }
  try { assertUploadSize(bytes.byteLength); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Stored source is too large" }, { status: 413 }); }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (source.sourceHash && actualHash !== source.sourceHash) {
    await db.update(sources).set({ ingestionStatus: "failed", ingestionError: "The retained original failed its integrity check", processedAt: new Date() }).where(eq(sources.id, source.sourceId!));
    await finishExtractionRuns("failed", { reprocess: true, failure: "integrity_check" }, "The retained original failed its integrity check");
    await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "storage", status: "failed", error: "The retained original failed its integrity check", completedAt: new Date(), metadata: JSON.stringify({ reprocess: true }) });
    return NextResponse.json({ error: "The retained original failed its integrity check" }, { status: 409 });
  }
  const provider = getModelProvider(resolveModelOverrides(choice.success ? choice.data : {}));
  let content: string;
  let pdfQuality: PdfExtractionQuality | undefined;
  let workbookStructure: WorkbookStructure | undefined;
  const sourceRole = (() => { try { return (JSON.parse(source.sourceMetadata ?? "{}") as { sourceRole?: string }).sourceRole === "reference_model" ? "reference_model" as const : undefined; } catch { return undefined; } })();
  let extracted: z.infer<typeof extractionSchema>;
  try {
    if (source.sourceMime?.includes("pdf") || /\.pdf$/i.test(source.sourceName)) {
      const pdf = await extractPdfDocument(bytes);
      content = pdf.text;
      pdfQuality = pdf.quality;
    } else if (/\.(xlsx|xls)$/i.test(source.sourceName)) {
      const workbook = await inspectSpreadsheet(bytes);
      content = workbook.text;
      workbookStructure = workbook.structure;
    } else content = bytes.toString("utf8");
    assertExtractedTextSize(content);
    const sourceClassification = classifySource({ filename: source.sourceName, mimeType: source.sourceMime, text: content, sourceRole });
    const activePolicies = (await getDatabase().select({ name: policies.name, rule: policies.rule, scope: policies.scope, effectiveFrom: policies.effectiveFrom }).from(policies).where(and(eq(policies.companyId, context.company.id), eq(policies.active, "Y")))).filter((policy) => policyAppliesInContext({ id: "reprocess", ...policy }, "", { ...(source.reportingMonth ? { effectiveDate: `${source.reportingMonth}-01` } : {}), sourceKind: sourceClassification.kind, sourceName: source.sourceName, ...(source.accountIdentifier ? { accountIdentifier: source.accountIdentifier } : {}) }));
    extracted = await provider.generateStructured({
      name: "financial_evidence_reprocess",
      schema: extractionSchema,
      jsonSchema: { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, statementMetadata: { type: "object", additionalProperties: false, properties: { accountHolder: { type: "string" }, accountIdentifier: { type: "string" }, statementPeriodStart: { type: "string", pattern: "^20\\d{2}-\\d{2}-\\d{2}$" }, statementPeriodEnd: { type: "string", pattern: "^20\\d{2}-\\d{2}-\\d{2}$" }, openingBalance: { type: "string" }, endingBalance: { type: "string" } } }, facts: { type: "array", items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, value: { type: "string" }, accountingRole: { type: "string", enum: ["transaction", "opening_balance", "ending_balance", "transfer", "investment_movement", "revenue", "expense", "financing", "summary", "agreement", "unknown"] }, confidence: { type: "number" } }, required: ["label", "value", "accountingRole", "confidence"] } }, questions: { type: "array", items: { type: "string" } } }, required: ["summary", "facts", "questions"] },
      instructions: `Re-extract only explicit facts from this retained source. Preserve full dates, amounts, account identifiers, counterparties, descriptions, notes, and statement metadata. Do not invent details. ${sourceRole === "reference_model" ? "This is a reference financial model. Describe its structure, schedules, periods, and explicit drivers, but do not treat spreadsheet formulas or model outputs as actual transactions, approved balances, or accounting facts. Use unknown for treatment unless independently evidenced." : ""} Combine duplicative questions.${pdfQuality && pdfQuality.status !== "good" ? ` This is a PDF with ${pdfQuality.status} text extraction quality. Ask for a searchable or OCR-processed copy instead of inferring missing values.` : ""} Apply these company policies: ${JSON.stringify(activePolicies)}`,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source extraction failed";
    await db.update(sources).set({ ingestionStatus: "failed", ingestionError: message, processedAt: new Date() }).where(eq(sources.id, source.sourceId!));
    await finishExtractionRuns("failed", { reprocess: true, failure: "extraction" }, message);
    await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "extraction", status: "failed", error: message, completedAt: new Date(), metadata: JSON.stringify({ reprocess: true }) });
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const sourceClassification = classifySource({ filename: source.sourceName, mimeType: source.sourceMime, text: content, sourceRole });
  const detectedCurrencies = detectSourceCurrencies(content);
  const sourceCurrency = detectedCurrencies.length === 1 ? detectedCurrencies[0] : undefined;
  const extraction = { ...extracted, facts: mergeStatementFacts(extracted.facts, extractStructuredStatementFacts(content, sourceClassification.kind)), questions: validQuestionsForSource(extracted.questions, { isPdf: source.sourceMime?.includes("pdf") === true || /\.pdf$/i.test(source.sourceName) }) };
  const previousFacts = (() => { try { const parsed = source.previousExtractedJson ? JSON.parse(source.previousExtractedJson) as { facts?: EvidenceFact[] } : {}; return parsed.facts ?? []; } catch { return []; } })();
  const changes = compareEvidenceFacts(previousFacts, extraction.facts);
  const statementMetadata = extraction.statementMetadata;
  let accountEntityId: string | null | undefined;
  let accountQuestion: string | undefined;
  if (statementMetadata && (statementMetadata.accountHolder || statementMetadata.accountIdentifier)) {
    const accountCandidates = await getDatabase().select({ id: entities.id, name: entities.name, attributes: entities.attributes }).from(entities).where(and(eq(entities.companyId, context.company.id), eq(entities.type, "account")));
    const matchedAccount = matchStatementAccount(statementMetadata, accountCandidates);
    if (matchedAccount) accountEntityId = matchedAccount.id;
    else {
      const holder = statementMetadata.accountHolder ? ` for ${statementMetadata.accountHolder}` : "";
      const identifier = statementMetadata.accountIdentifier ? ` ending ${statementMetadata.accountIdentifier.replace(/[^0-9A-Za-z]/g, "")}` : "";
      accountQuestion = `Does this statement${holder}${identifier} belong to a company account? If so, identify the account; otherwise exclude it from company reporting.`;
    }
  }
  await recordLlmRun({ db: getDatabase(), provider, companyId: context.company.id, userId: context.user.id, operation: "evidence_reprocess", request: { evidenceId: id, sourceName: source.sourceName, sourceHash: source.sourceHash }, response: JSON.stringify(extraction) });
  await db.update(evidence).set({ rawText: content, extractedJson: JSON.stringify(extraction), ...(sourceCurrency ? { currency: sourceCurrency } : {}), identityStatus: "pending", status: "pending", publishedAt: null, ...(statementMetadata ? {
    accountHolder: statementMetadata.accountHolder,
    accountIdentifier: statementMetadata.accountIdentifier,
    statementPeriodStart: statementMetadata.statementPeriodStart,
    statementPeriodEnd: statementMetadata.statementPeriodEnd,
    openingBalance: statementMetadata.openingBalance ? String(parseFinancialAmount(statementMetadata.openingBalance) ?? "") : undefined,
    endingBalance: statementMetadata.endingBalance ? String(parseFinancialAmount(statementMetadata.endingBalance) ?? "") : undefined,
    accountEntityId,
  } : {}), updatedAt: new Date() }).where(and(eq(evidence.id, id), eq(evidence.companyId, context.company.id)));
  if (source.sourceId) await db.update(sources).set({ ingestionStatus: "review", ingestionError: null, processedAt: new Date(), metadata: JSON.stringify({ sourceRole, classification: sourceClassification, statementMetadata, currencies: detectedCurrencies, pdfQuality, workbook: workbookStructure }) }).where(eq(sources.id, source.sourceId));
  await db.delete(cashEvents).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.evidenceId, id)));
  await db.delete(economicItems).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.evidenceId, id)));
  if (source.sourceId) await db.delete(observations).where(and(eq(observations.companyId, context.company.id), eq(observations.sourceId, source.sourceId)));
  await db.delete(factRecords).where(and(eq(factRecords.companyId, context.company.id), eq(factRecords.evidenceId, id)));
  await db.delete(reviewItems).where(and(eq(reviewItems.companyId, context.company.id), eq(reviewItems.evidenceId, id)));
  const questions = uniqueReviewQuestions([...extraction.questions, ...(accountQuestion ? [accountQuestion] : [])].filter((question) => question.trim()).map((question, index) => ({ id: `${id}-${index}`, evidenceId: id, question: question.trim() })));
  if (extraction.facts.length) await db.insert(factRecords).values(extraction.facts.map((fact) => ({ companyId: context.company.id, evidenceId: id, label: fact.label, value: fact.value, accountingRole: fact.accountingRole, sourceLocation: sourceLocationForFact(content, fact), ...(sourceCurrency ? { currency: sourceCurrency } : {}), confidence: String(fact.confidence) })));
  if (source.sourceId && extraction.facts.length) await db.insert(observations).values(extraction.facts.map((fact) => ({ companyId: context.company.id, sourceId: source.sourceId!, type: "financial_fact", amount: parseFinancialAmount(fact.value)?.toString(), attributes: JSON.stringify({ label: fact.label, value: fact.value, accountingRole: fact.accountingRole, sourceLocation: sourceLocationForFact(content, fact) }), confidence: String(fact.confidence) })));
  if (questions.length) await db.insert(reviewItems).values(questions.map((question) => ({ companyId: context.company.id, evidenceId: id, question: question.question })));
  await finishExtractionRuns("succeeded", { reprocess: true, facts: extraction.facts.length, questions: questions.length, changes, pdfQuality });
  await db.insert(ingestionRuns).values([
    { companyId: context.company.id, sourceId: source.sourceId!, stage: "review", status: "waiting", completedAt: new Date(), metadata: JSON.stringify({ reprocess: true, facts: extraction.facts.length, questions: questions.length, changes, pdfQuality, reconciliation: "pending", forecast: "pending" }) },
    { companyId: context.company.id, sourceId: source.sourceId!, stage: "reconciliation", status: "waiting", metadata: JSON.stringify({ trigger: "reprocess", evidenceId: id }) },
  ]);
  const calculationRun = await refreshCurrentCalculationRun(context.company.id);
  return NextResponse.json({ id, status: "pending", extraction, calculationRun });
}
