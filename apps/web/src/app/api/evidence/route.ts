import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { getDatabase, cashEvents, economicItems, evidence, factRecords, knowledgeDocuments, observations, policies, reportingPeriods, reviewItems, sources } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { recordLlmRun } from "@/lib/llm-telemetry";
import { getModelProvider, modelRequestSchema, resolveModelOverrides } from "@/lib/models";
import { expandFinancialFactDates, extractPdfText } from "@nevermodel/ingestion";

const inputSchema = modelRequestSchema.extend({
  text: z.string().trim().min(3).max(100_000),
  sourceName: z.string().trim().min(1).max(255).default("conversation"),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});
const reviewSchema = z.object({ id: z.string().uuid(), status: z.enum(["pending", "approved", "rejected"]).optional(), extractedJson: z.string().optional() });

function normalizeCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return text;
  const headers = lines[0]!.split(",").map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function monthFromFact(value: string) {
  const exactDate = dateFromFact(value);
  if (exactDate) return exactDate.slice(0, 7);
  const yearMonth = value.match(/\b(20\d{2}-\d{2})\b/)?.[1];
  if (yearMonth) return yearMonth;
  return new Date().toISOString().slice(0, 7);
}

function dateFromFact(value: string) {
  const raw = value.match(/\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/20\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+20\d{2}\b/i)?.[0];
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

const extractionSchema = z.object({
  summary: z.string(),
  facts: z.array(z.object({ label: z.string(), value: z.string(), confidence: z.number().min(0).max(1) })),
  questions: z.array(z.string()),
});

export async function POST(request: Request) {
  await auth.protect();
  const contentType = request.headers.get("content-type") ?? "";
  let rawText: string;
  let sourceName: string;
  let sourceMime: string | undefined;
  let sourceSize: number | undefined;
  let sourceHash: string | undefined;
  let reportingMonth: string | undefined;
  let userInstructions: string | undefined;
  let modelChoice: z.infer<typeof modelRequestSchema> = {};
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "A file is required" }, { status: 400 });
    sourceName = file.name;
    reportingMonth = String(form.get("month") || "") || undefined;
    userInstructions = String(form.get("instructions") || "").trim().slice(0, 20_000) || undefined;
    const choice = modelRequestSchema.safeParse({ model: String(form.get("model") || "") || undefined, effort: String(form.get("effort") || "") || undefined });
    if (choice.success) modelChoice = choice.data;
    const buffer = Buffer.from(await file.arrayBuffer());
    sourceMime = file.type || undefined;
    sourceSize = buffer.byteLength;
    sourceHash = createHash("sha256").update(buffer).digest("hex");
    if (/\.pdf$/i.test(file.name)) {
      rawText = await extractPdfText(buffer);
    } else if (/\.(xlsx|xls)$/i.test(file.name)) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      rawText = workbook.SheetNames.map((name) => `--- ${name} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name]!)}`).join("\n\n");
    } else {
      rawText = await file.text();
    }
  } else {
    const body = inputSchema.safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: "Evidence text is required" }, { status: 400 });
    rawText = body.data.text;
    sourceName = body.data.sourceName;
    reportingMonth = body.data.month;
    modelChoice = { model: body.data.model, effort: body.data.effort };
    sourceMime = "text/plain";
    sourceSize = Buffer.byteLength(rawText, "utf8");
    sourceHash = createHash("sha256").update(rawText).digest("hex");
  }

  const context = await requireCompanyAccess();
  const activePolicies = await getDatabase().select({ name: policies.name, rule: policies.rule }).from(policies).where(and(eq(policies.companyId, context.company.id), eq(policies.active, "Y")));
  if (sourceHash) {
    const [duplicate] = await getDatabase().select({ id: evidence.id, extractedJson: evidence.extractedJson }).from(evidence).where(and(eq(evidence.companyId, context.company.id), eq(evidence.sourceHash, sourceHash)));
    if (duplicate) return NextResponse.json({ id: duplicate.id, duplicate: true, extraction: duplicate.extractedJson ? JSON.parse(duplicate.extractedJson) : null });
  }
  if (reportingMonth) {
    const [period] = await getDatabase().select({ status: reportingPeriods.status }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, context.company.id), eq(reportingPeriods.month, reportingMonth)));
    if (period?.status === "closed") return NextResponse.json({ error: "This reporting month is closed" }, { status: 409 });
  }
  const csv = /\.csv$/i.test(sourceName) ? normalizeCsv(rawText) : rawText;
  const provider = getModelProvider(resolveModelOverrides(modelChoice));
  const extracted = await provider.generateStructured({
    name: "financial_evidence_extraction",
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
    instructions: `Extract only explicit financial facts. Do not invent numbers. Use questions for ambiguity or missing context. Apply these standing CFO policies when relevant:\n${activePolicies.map((policy) => `- ${policy.name}: ${policy.rule}`).join("\n") || "- No standing policies have been recorded."}${userInstructions ? `\n\nThe user supplied these instructions with the file. Follow them when they are consistent with extracting explicit evidence:\n${userInstructions}` : ""}`,
    messages: [{ role: "user", content: typeof csv === "string" ? csv : JSON.stringify(csv) }],
  });
  const sourceDate = sourceName.match(/(?:^|[-_])dt-(20\d{2}-\d{2}-\d{2})(?:[-_.]|$)/i)?.[1] ?? (reportingMonth ? `${reportingMonth}-01` : undefined);
  const extraction = { ...extracted, facts: expandFinancialFactDates(extracted.facts, sourceDate) };
  await recordLlmRun({ db: getDatabase(), provider, companyId: context.company.id, userId: context.user.id, operation: "evidence_extraction", request: { sourceName, sourceMime, reportingMonth, content: csv }, response: JSON.stringify(extraction) });

  const [source] = await getDatabase().insert(sources).values({ companyId: context.company.id, type: sourceMime?.includes("pdf") ? "file" : sourceName === "conversation context" ? "conversation" : "file", filename: sourceName, mimeType: sourceMime, hash: sourceHash, metadata: JSON.stringify({ reportingMonth, sourceSize }) }).returning({ id: sources.id });
  const [row] = await getDatabase().insert(evidence).values({
    companyId: context.company.id,
    sourceId: source?.id,
    createdByUserId: context.user.id,
    sourceName,
    reportingMonth,
    sourceMime,
    sourceSize: sourceSize ? String(sourceSize) : undefined,
    sourceHash,
    rawText,
    extractedJson: JSON.stringify(extraction),
  }).returning({ id: evidence.id, createdAt: evidence.createdAt });

  const questions = extraction.questions.filter((question) => question.trim().length > 0);
  if (row?.id && questions.length) {
    await getDatabase().insert(reviewItems).values(questions.map((question) => ({ companyId: context.company.id, evidenceId: row.id, question: question.trim() })));
  }
  if (row?.id && extraction.facts.length) {
    await getDatabase().insert(factRecords).values(extraction.facts.map((fact) => ({ companyId: context.company.id, evidenceId: row.id, label: fact.label, value: fact.value, confidence: String(fact.confidence) })));
    if (source?.id) await getDatabase().insert(observations).values(extraction.facts.map((fact) => ({ companyId: context.company.id, sourceId: source.id, type: "financial_fact", amount: fact.value.match(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)/i)?.[1]?.replace(/,/g, ""), attributes: JSON.stringify({ label: fact.label, value: fact.value }), confidence: String(fact.confidence) })));
  }

  return NextResponse.json({ id: row?.id, extraction });
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select({
    id: evidence.id,
    sourceName: evidence.sourceName,
    sourceMime: evidence.sourceMime,
    sourceSize: evidence.sourceSize,
    sourceHash: evidence.sourceHash,
    rawText: evidence.rawText,
    extractedJson: evidence.extractedJson,
    status: evidence.status,
    createdAt: evidence.createdAt,
  }).from(evidence).where(eq(evidence.companyId, context.company.id)).orderBy(desc(evidence.createdAt)).limit(20);
  const openReviews = await getDatabase().select({ id: reviewItems.id, evidenceId: reviewItems.evidenceId, question: reviewItems.question, answer: reviewItems.answer, status: reviewItems.status }).from(reviewItems).where(and(eq(reviewItems.companyId, context.company.id), eq(reviewItems.status, "open"))).orderBy(desc(reviewItems.createdAt));
  const facts = await getDatabase().select({ id: factRecords.id, evidenceId: factRecords.evidenceId, label: factRecords.label, value: factRecords.value, confidence: factRecords.confidence, status: factRecords.status }).from(factRecords).where(eq(factRecords.companyId, context.company.id)).orderBy(desc(factRecords.createdAt));

  return NextResponse.json({
    evidence: rows.map((row) => ({ ...row, sourceExcerpt: row.rawText.slice(0, 280), rawText: undefined, extraction: row.extractedJson ? JSON.parse(row.extractedJson) : null })),
    reviewItems: openReviews,
    factRecords: facts,
  });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const body = reviewSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid evidence update" }, { status: 400 });
  const context = await requireCompanyAccess();
  const [row] = await getDatabase().update(evidence).set({ ...(body.data.status ? { status: body.data.status } : {}), ...(body.data.extractedJson ? { extractedJson: body.data.extractedJson } : {}), updatedAt: new Date() })
    .where(and(eq(evidence.id, body.data.id), eq(evidence.companyId, context.company.id))).returning({ id: evidence.id, status: evidence.status, extractedJson: evidence.extractedJson });
  if (!row) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  if (body.data.status) {
    await getDatabase().update(factRecords).set({ status: body.data.status === "approved" ? "approved" : body.data.status === "rejected" ? "rejected" : "pending", updatedAt: new Date() }).where(and(eq(factRecords.companyId, context.company.id), eq(factRecords.evidenceId, body.data.id)));
  }
  if (body.data.extractedJson) {
    const edited = JSON.parse(body.data.extractedJson) as { facts?: { label: string; value: string; confidence: number }[]; questions?: string[] };
    await getDatabase().delete(factRecords).where(and(eq(factRecords.companyId, context.company.id), eq(factRecords.evidenceId, body.data.id)));
    if (edited.facts?.length) await getDatabase().insert(factRecords).values(edited.facts.map((fact) => ({ companyId: context.company.id, evidenceId: body.data.id, label: fact.label, value: fact.value, confidence: String(fact.confidence), status: row.status === "approved" ? "approved" : "pending" })));
    await getDatabase().delete(reviewItems).where(and(eq(reviewItems.companyId, context.company.id), eq(reviewItems.evidenceId, body.data.id)));
    const questions = (edited.questions ?? []).filter((question) => question.trim().length > 0);
    if (questions.length) await getDatabase().insert(reviewItems).values(questions.map((question) => ({ companyId: context.company.id, evidenceId: body.data.id, question: question.trim() })));
  }
  const rebuildApproved = Boolean(row.extractedJson && (body.data.status === "approved" || (body.data.extractedJson && row.status === "approved")));
  if (rebuildApproved && row.extractedJson) {
    const extraction = JSON.parse(row.extractedJson) as { facts?: { label: string; value: string }[] };
    const facts = extraction.facts ?? [];
    const isOpening = (fact: { label: string; value: string }) => /opening|beginning|starting\s+cash|cash\s+balance/i.test(`${fact.label} ${fact.value}`);
    const openingFacts = facts.filter(isOpening);
    for (const fact of openingFacts) {
      const amount = fact.value.match(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)/i)?.[1]?.replace(/,/g, "");
      if (amount) {
        const month = monthFromFact(fact.value);
        const [period] = await getDatabase().select({ status: reportingPeriods.status }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, context.company.id), eq(reportingPeriods.month, month)));
        if (period?.status === "closed") {
          await getDatabase().update(evidence).set({ status: "pending", updatedAt: new Date() }).where(eq(evidence.id, body.data.id));
          return NextResponse.json({ error: `Evidence references closed reporting month: ${month}` }, { status: 409 });
        }
        await getDatabase().insert(reportingPeriods).values({ companyId: context.company.id, month, openingCash: amount }).onConflictDoUpdate({ target: [reportingPeriods.companyId, reportingPeriods.month], set: { openingCash: amount, updatedAt: new Date() } });
      }
    }
    const financialFacts = facts.filter((fact) => !isOpening(fact));
    const policyRows = await getDatabase().select({ id: policies.id, name: policies.name, rule: policies.rule }).from(policies).where(and(eq(policies.companyId, context.company.id), eq(policies.active, "Y")));
    const policyFor = (fact: { label: string; value: string }) => {
      const words = `${fact.label} ${fact.value}`.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4);
      return policyRows.find((policy) => words.some((word) => `${policy.name} ${policy.rule}`.toLowerCase().includes(word)))?.id;
    };
    const [forecastDocument] = await getDatabase().select({ content: knowledgeDocuments.content }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "forecast")));
    if (financialFacts.length && !forecastDocument?.content.includes(`source:${body.data.id}`)) {
      const additions = financialFacts.map((fact) => `- [source:${body.data.id}] ${fact.label}: ${fact.value}`).join("\n");
      const content = `${forecastDocument?.content.trim() ?? "# Forecast\n\nForecast assumptions and scenarios."}\n\n## Reviewed evidence\n${additions}\n`;
      if (forecastDocument) await getDatabase().update(knowledgeDocuments).set({ content, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "forecast")));
      else await getDatabase().insert(knowledgeDocuments).values({ companyId: context.company.id, slug: "forecast", title: "Forecast", content });
    }
    const items = financialFacts.map((fact) => {
      const amount = fact.value.match(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)/i)?.[1]?.replace(/,/g, "");
      const spend = /pay|spend|cost|expense|owe|vendor|bill/i.test(`${fact.label} ${fact.value}`);
      return { companyId: context.company.id, evidenceId: body.data.id, type: spend ? "obligation" as const : "agreement" as const, direction: spend ? "spend" as const : "receipt" as const, label: fact.label, amount, cadence: /month|quarter|annual|year|weekly/i.exec(fact.value)?.[0], policyId: policyFor(fact), status: "confirmed" as const };
    });
    const events = financialFacts.flatMap((fact) => {
      const match = fact.value.match(/(?:\$|USD\s*)([\d,]+(?:\.\d+)?)/i);
      if (!match) return [];
      return [{ companyId: context.company.id, evidenceId: body.data.id, month: monthFromFact(fact.value), transactionDate: dateFromFact(fact.value), description: `${fact.label}: ${fact.value}`, amount: match[1]!.replace(/,/g, ""), direction: /pay|spend|cost|expense/i.test(fact.value) ? "spend" as const : "receipt" as const, policyId: policyFor(fact) }];
    });
    const eventMonths = [...new Set(events.map((event) => event.month))];
    if (eventMonths.length) {
      const closed = await getDatabase().select({ month: reportingPeriods.month }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, context.company.id), inArray(reportingPeriods.month, eventMonths), eq(reportingPeriods.status, "closed")));
      if (closed.length) {
        await getDatabase().update(evidence).set({ status: "pending", updatedAt: new Date() }).where(eq(evidence.id, body.data.id));
        return NextResponse.json({ error: `Evidence references closed reporting month: ${closed[0]!.month}` }, { status: 409 });
      }
    }
    if (body.data.extractedJson && row.status === "approved") {
      await getDatabase().delete(cashEvents).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.evidenceId, body.data.id)));
      await getDatabase().delete(economicItems).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.evidenceId, body.data.id)));
    }
    const existingItems = await getDatabase().select({ id: economicItems.id }).from(economicItems).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.evidenceId, body.data.id)));
    if (!existingItems.length && items.length) await getDatabase().insert(economicItems).values(items);
    const existingEvents = await getDatabase().select({ id: cashEvents.id }).from(cashEvents).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.evidenceId, body.data.id)));
    if (!existingEvents.length && events.length) await getDatabase().insert(cashEvents).values(events);
  }
  return NextResponse.json(row);
}
