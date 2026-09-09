import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { cashEvents, economicItems, entities, evidence, factRecords, getDatabase, ingestionRuns, policies, reviewItems, sources } from "@finance/database";
import { extractPdfText } from "@nevermodel/ingestion";
import { requireCompanyAccess } from "@/lib/auth";
import { getModelProvider, modelRequestSchema, resolveModelOverrides } from "@/lib/models";
import { recordLlmRun } from "@/lib/llm-telemetry";
import { readSourceBlob } from "@/lib/blob-store";
import { uniqueReviewQuestions } from "@/lib/review-questions";
import { matchStatementAccount } from "@/lib/account-matching";
import { parseFinancialAmount } from "@/lib/financial-events";
import { z } from "zod";

const extractionSchema = z.object({
  summary: z.string(),
  statementMetadata: z.object({ accountHolder: z.string().optional(), accountIdentifier: z.string().optional(), statementPeriodStart: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).optional(), statementPeriodEnd: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).optional(), openingBalance: z.string().optional(), endingBalance: z.string().optional() }).optional(),
  facts: z.array(z.object({ label: z.string(), value: z.string(), confidence: z.number().min(0).max(1) })),
  questions: z.array(z.string()),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  const choice = modelRequestSchema.safeParse(await request.json().catch(() => ({})));
  const [source] = await getDatabase().select({ evidenceId: evidence.id, sourceId: evidence.sourceId, sourceName: evidence.sourceName, sourceMime: evidence.sourceMime, sourceHash: sources.hash, storageReference: sources.storageReference }).from(evidence).innerJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.id, id), eq(evidence.companyId, context.company.id)));
  if (!source?.storageReference) return NextResponse.json({ error: "This source has no retained original file" }, { status: 404 });
  const db = getDatabase();
  await db.update(sources).set({ ingestionStatus: "extracting", ingestionError: null, processedAt: null }).where(and(eq(sources.id, source.sourceId!), eq(sources.companyId, context.company.id)));
  await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "extraction", status: "running", metadata: JSON.stringify({ reprocess: true }) });
  let bytes: Buffer;
  try { bytes = await readSourceBlob(source.storageReference); } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read retained source";
    await db.update(sources).set({ ingestionStatus: "failed", ingestionError: message, processedAt: new Date() }).where(eq(sources.id, source.sourceId!));
    await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "extraction", status: "failed", error: message, completedAt: new Date(), metadata: JSON.stringify({ reprocess: true }) });
    return NextResponse.json({ error: message }, { status: 404 });
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (source.sourceHash && actualHash !== source.sourceHash) {
    await db.update(sources).set({ ingestionStatus: "failed", ingestionError: "The retained original failed its integrity check", processedAt: new Date() }).where(eq(sources.id, source.sourceId!));
    await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "storage", status: "failed", error: "The retained original failed its integrity check", completedAt: new Date(), metadata: JSON.stringify({ reprocess: true }) });
    return NextResponse.json({ error: "The retained original failed its integrity check" }, { status: 409 });
  }
  const activePolicies = await getDatabase().select({ name: policies.name, rule: policies.rule }).from(policies).where(and(eq(policies.companyId, context.company.id), eq(policies.active, "Y")));
  const provider = getModelProvider(resolveModelOverrides(choice.success ? choice.data : {}));
  let content: string;
  let extracted: z.infer<typeof extractionSchema>;
  try {
    content = source.sourceMime?.includes("pdf") || /\.pdf$/i.test(source.sourceName) ? await extractPdfText(bytes) : /\.(xlsx|xls)$/i.test(source.sourceName) ? (() => { const workbook = XLSX.read(bytes, { type: "buffer" }); return workbook.SheetNames.map((name) => XLSX.utils.sheet_to_csv(workbook.Sheets[name]!)).join("\n\n"); })() : bytes.toString("utf8");
    extracted = await provider.generateStructured({
      name: "financial_evidence_reprocess",
      schema: extractionSchema,
      jsonSchema: { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, statementMetadata: { type: "object", additionalProperties: false, properties: { accountHolder: { type: "string" }, accountIdentifier: { type: "string" }, statementPeriodStart: { type: "string" }, statementPeriodEnd: { type: "string" }, openingBalance: { type: "string" }, endingBalance: { type: "string" } } }, facts: { type: "array", items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, value: { type: "string" }, confidence: { type: "number" } }, required: ["label", "value", "confidence"] } }, questions: { type: "array", items: { type: "string" } } }, required: ["summary", "facts", "questions"] },
      instructions: `Re-extract only explicit facts from this retained source. Preserve full dates, amounts, account identifiers, counterparties, descriptions, notes, and statement metadata. Do not invent details. Combine duplicative questions. Apply these company policies: ${JSON.stringify(activePolicies)}`,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source extraction failed";
    await db.update(sources).set({ ingestionStatus: "failed", ingestionError: message, processedAt: new Date() }).where(eq(sources.id, source.sourceId!));
    await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "extraction", status: "failed", error: message, completedAt: new Date(), metadata: JSON.stringify({ reprocess: true }) });
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const extraction = { ...extracted, facts: extracted.facts };
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
  await db.update(evidence).set({ rawText: content, extractedJson: JSON.stringify(extraction), status: "pending", ...(statementMetadata ? {
    accountHolder: statementMetadata.accountHolder,
    accountIdentifier: statementMetadata.accountIdentifier,
    statementPeriodStart: statementMetadata.statementPeriodStart,
    statementPeriodEnd: statementMetadata.statementPeriodEnd,
    openingBalance: statementMetadata.openingBalance ? String(parseFinancialAmount(statementMetadata.openingBalance) ?? "") : undefined,
    endingBalance: statementMetadata.endingBalance ? String(parseFinancialAmount(statementMetadata.endingBalance) ?? "") : undefined,
    accountEntityId,
  } : {}), updatedAt: new Date() }).where(and(eq(evidence.id, id), eq(evidence.companyId, context.company.id)));
  if (source.sourceId) await db.update(sources).set({ ingestionStatus: "review", ingestionError: null, processedAt: new Date(), metadata: JSON.stringify({ statementMetadata }) }).where(eq(sources.id, source.sourceId));
  await db.delete(cashEvents).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.evidenceId, id)));
  await db.delete(economicItems).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.evidenceId, id)));
  await db.delete(factRecords).where(and(eq(factRecords.companyId, context.company.id), eq(factRecords.evidenceId, id)));
  await db.delete(reviewItems).where(and(eq(reviewItems.companyId, context.company.id), eq(reviewItems.evidenceId, id)));
  const questions = uniqueReviewQuestions([...extraction.questions, ...(accountQuestion ? [accountQuestion] : [])].filter((question) => question.trim()).map((question, index) => ({ id: `${id}-${index}`, evidenceId: id, question: question.trim() })));
  if (extraction.facts.length) await db.insert(factRecords).values(extraction.facts.map((fact) => ({ companyId: context.company.id, evidenceId: id, label: fact.label, value: fact.value, confidence: String(fact.confidence) })));
  if (questions.length) await db.insert(reviewItems).values(questions.map((question) => ({ companyId: context.company.id, evidenceId: id, question: question.question })));
  await db.insert(ingestionRuns).values({ companyId: context.company.id, sourceId: source.sourceId!, stage: "review", status: "waiting", completedAt: new Date(), metadata: JSON.stringify({ reprocess: true, facts: extraction.facts.length, questions: questions.length }) });
  return NextResponse.json({ id, status: "pending", extraction });
}
