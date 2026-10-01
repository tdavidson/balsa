import { config } from "dotenv";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { cashEvents, evidence, factRecords, getDatabase, observations, policies, reviewItems } from "@finance/database";
import { createModelProvider } from "@finance/model-providers";
import { expandFinancialFactDates, normalizeTransactions, parseCsvRows, parseOfx, transactionExternalKey, type TransactionRow } from "@balsa/ingestion";
import { recordLlmRun } from "@/lib/llm-telemetry";

config({ path: "../../.env.local" });
config({ path: "../../.env" });

const apply = process.argv.includes("--apply");
const verify = process.argv.includes("--verify");
const normalizeDates = process.argv.includes("--normalize-dates");
const checkSchema = process.argv.includes("--check-schema");
const extractionSchema = z.object({
  summary: z.string(),
  facts: z.array(z.object({ label: z.string(), value: z.string(), confidence: z.number().min(0).max(1) })),
  questions: z.array(z.string()),
});

function transactionExtraction(transactions: TransactionRow[]) {
  return {
    summary: `${transactions.length} actual transactions imported with statement dates, amounts, and descriptions or notes`,
    facts: transactions.slice(0, 200).map((transaction) => ({
      label: `Transaction ${transaction.postedDate ?? transaction.date}`,
      value: `${transaction.direction === "spend" ? "−" : "+"}$${transaction.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — ${transaction.description}`,
      confidence: 1,
    })),
    questions: [] as string[],
  };
}

function parseTransactions(sourceName: string, rawText: string) {
  if (/\.(qbo|ofx)$/i.test(sourceName)) return parseOfx(rawText);
  if (!/\.(csv|xlsx|xls)$/i.test(sourceName)) return [];
  return normalizeTransactions(parseCsvRows(rawText), new Date().toISOString().slice(0, 7));
}

async function main() {
const db = getDatabase();
if (checkSchema) {
  const result = await db.execute(sql`select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cash_events' and column_name = 'transaction_date') as present`);
  console.log(`cash_events.transaction_date present: ${String(result[0]?.present === true)}`);
  return;
}
const rows = await db.select().from(evidence).orderBy(asc(evidence.createdAt));
const candidates = rows.filter((row) => /bank|statement|transaction|\.(csv|xlsx|xls|qbo|ofx)$/i.test(row.sourceName));
console.log(`${apply ? "Reparsing" : "Would reparse"} ${candidates.length} of ${rows.length} retained evidence sources.`);

if (normalizeDates) {
  for (const row of candidates) {
    if (!row.extractedJson) continue;
    const parsed = extractionSchema.safeParse(JSON.parse(row.extractedJson));
    if (!parsed.success) continue;
    const sourceDate = row.sourceName.match(/(?:^|[-_])dt-(20\d{2}-\d{2}-\d{2})(?:[-_.]|$)/i)?.[1] ?? (row.reportingMonth ? `${row.reportingMonth}-01` : undefined);
    const extraction = { ...parsed.data, facts: expandFinancialFactDates(parsed.data.facts, sourceDate) };
    await db.update(evidence).set({ extractedJson: JSON.stringify(extraction), updatedAt: new Date() }).where(eq(evidence.id, row.id));
    await db.delete(factRecords).where(and(eq(factRecords.companyId, row.companyId), eq(factRecords.evidenceId, row.id)));
    if (extraction.facts.length) await db.insert(factRecords).values(extraction.facts.map((fact) => ({ companyId: row.companyId, evidenceId: row.id, label: fact.label, value: fact.value, confidence: String(fact.confidence), status: row.status === "approved" ? "approved" : "pending" })));
    const existingEvents = await db.select().from(cashEvents).where(and(eq(cashEvents.companyId, row.companyId), eq(cashEvents.evidenceId, row.id)));
    for (const event of existingEvents) {
      const fact = extraction.facts.find((candidate) => candidate.value.includes(`$${Number(event.amount).toLocaleString("en-US")}`) || candidate.value.includes(`$${event.amount}`));
      const combined = fact ? `${fact.label}: ${fact.value}` : "";
      const transactionDate = combined.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
      if (transactionDate) await db.update(cashEvents).set({ transactionDate, description: combined, updatedAt: new Date() }).where(eq(cashEvents.id, event.id));
    }
    console.log(`Normalized retained dates: ${row.sourceName}`);
  }
  return;
}

if (verify) {
  for (const row of candidates) {
    const extraction = row.extractedJson ? extractionSchema.safeParse(JSON.parse(row.extractedJson)) : null;
    const facts = extraction?.success ? extraction.data.facts : [];
    const fullDates = facts.filter((fact) => /\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/20\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i.test(`${fact.label} ${fact.value}`)).length;
    const identified = facts.filter((fact) => /klingenstein|sender|beneficiary|description|memo|note/i.test(`${fact.label} ${fact.value}`)).length;
    console.log(`Verified ${row.sourceName}: ${facts.length} facts, ${fullDates} with full dates, ${identified} with identifying text.`);
    for (const fact of facts.filter((fact) => /klingenstein/i.test(`${fact.label} ${fact.value}`)).slice(0, 4)) console.log(`  ${fact.label}: ${fact.value}`);
    if (!fullDates) for (const fact of facts.filter((fact) => /\b\d{1,2}[/-]\d{1,2}\b/.test(`${fact.label} ${fact.value}`)).slice(0, 2)) console.log(`  Abbreviated date sample — ${fact.label}: ${fact.value}`);
  }
  return;
}

if (!apply) return;

let deterministicCount = 0;
let modelCount = 0;
for (const row of candidates) {
  const transactions = parseTransactions(row.sourceName, row.rawText);
  if (transactions.length) {
    const existingEvents = await db.select().from(cashEvents).where(and(eq(cashEvents.companyId, row.companyId), eq(cashEvents.evidenceId, row.id))).orderBy(asc(cashEvents.createdAt));
    const unmatched = [...transactions];
    for (const existing of existingEvents) {
      const matchIndex = unmatched.findIndex((transaction) => transaction.date === existing.month && String(transaction.amount) === existing.amount && transaction.direction === existing.direction && (transaction.description.includes(existing.description) || existing.description.includes(transaction.description)));
      const fallbackIndex = matchIndex >= 0 ? matchIndex : unmatched.findIndex((transaction) => transaction.date === existing.month && String(transaction.amount) === existing.amount && transaction.direction === existing.direction);
      if (fallbackIndex < 0) continue;
      const [transaction] = unmatched.splice(fallbackIndex, 1);
      if (!transaction) continue;
      await db.update(cashEvents).set({ transactionDate: transaction.postedDate, description: transaction.description, externalKey: transactionExternalKey(transaction), updatedAt: new Date() }).where(eq(cashEvents.id, existing.id));
      await db.update(observations).set({ effectiveDate: new Date(`${transaction.postedDate ?? `${transaction.date}-01`}T00:00:00Z`), counterpartyText: transaction.description, attributes: JSON.stringify({ direction: transaction.direction, externalKey: transactionExternalKey(transaction), postedDate: transaction.postedDate }), updatedAt: new Date() }).where(eq(observations.eventId, existing.id));
    }
    await db.update(evidence).set({ extractedJson: JSON.stringify(transactionExtraction(transactions)), updatedAt: new Date() }).where(eq(evidence.id, row.id));
    deterministicCount += 1;
    console.log(`Reparsed transaction source: ${row.sourceName}`);
    continue;
  }

  const activePolicies = await db.select({ name: policies.name, rule: policies.rule }).from(policies).where(and(eq(policies.companyId, row.companyId), eq(policies.active, "Y")));
  const provider = createModelProvider({ MODEL_PROVIDER: process.env.MODEL_PROVIDER, MODEL_NAME: process.env.MODEL_NAME, OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY });
  const extracted = await provider.generateStructured({
    name: "financial_evidence_reparse",
    schema: extractionSchema,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        facts: { type: "array", items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, value: { type: "string" }, confidence: { type: "number" } }, required: ["label", "value", "confidence"] } },
        questions: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "facts", "questions"],
    },
    instructions: `Re-extract only explicit financial facts from this retained source. Preserve every full transaction date, amount, sender or beneficiary name, and description, memo, or note field. Use note fields to identify counterparties, accounts, funds, and entities. Do not collapse exact dates to months. Do not ask the user for information already present in the source. Do not invent details. Active CFO policies: ${JSON.stringify(activePolicies)}`,
    messages: [{ role: "user", content: row.rawText.slice(0, 100_000) }],
  });
  const sourceDate = row.sourceName.match(/(?:^|[-_])dt-(20\d{2}-\d{2}-\d{2})(?:[-_.]|$)/i)?.[1] ?? (row.reportingMonth ? `${row.reportingMonth}-01` : undefined);
  const extraction = { ...extracted, facts: expandFinancialFactDates(extracted.facts, sourceDate) };
  await recordLlmRun({ db, provider, companyId: row.companyId, userId: row.createdByUserId, operation: "evidence_reparse", request: { evidenceId: row.id, sourceName: row.sourceName }, response: JSON.stringify(extraction) });
  await db.update(evidence).set({ extractedJson: JSON.stringify(extraction), updatedAt: new Date() }).where(eq(evidence.id, row.id));
  if (row.status !== "approved") {
    await db.delete(factRecords).where(and(eq(factRecords.companyId, row.companyId), eq(factRecords.evidenceId, row.id)));
    if (extraction.facts.length) await db.insert(factRecords).values(extraction.facts.map((fact) => ({ companyId: row.companyId, evidenceId: row.id, label: fact.label, value: fact.value, confidence: String(fact.confidence) })));
  }
  const existingReviews = await db.select({ question: reviewItems.question }).from(reviewItems).where(and(eq(reviewItems.companyId, row.companyId), eq(reviewItems.evidenceId, row.id)));
  const existingQuestions = new Set(existingReviews.map((review) => review.question.trim().toLowerCase().replace(/\s+/g, " ")));
  const newQuestions = extraction.questions.filter((question) => !existingQuestions.has(question.trim().toLowerCase().replace(/\s+/g, " ")));
  if (newQuestions.length) await db.insert(reviewItems).values(newQuestions.map((question) => ({ companyId: row.companyId, evidenceId: row.id, question })));
  modelCount += 1;
  console.log(`Reparsed document source: ${row.sourceName}`);
}

console.log(`Reparse complete: ${deterministicCount} transaction sources, ${modelCount} model-extracted documents.`);
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
