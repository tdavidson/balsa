import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { decisions, economicItems, entities, evidence, getDatabase, knowledgeDocuments, policies, reviewItems } from "@finance/database";
import { summarizeMonths, traceValue, isCategory, isValidMonth, type Category } from "@nevermodel/finance-engine";
import { getModelProvider, modelRequestSchema, resolveModelOverrides } from "@/lib/models";
import { requireCompanyAccess } from "@/lib/auth";
import { recordConversation, recordLlmRun } from "@/lib/llm-telemetry";
import { relevantEvidenceContext } from "@/lib/evidence-context";
import { computeFinancials, type FinancialContext } from "@/lib/financials";
import { uniqueReviewQuestions } from "@/lib/review-questions";
import { applyDecisionIfEffective, describeEffect, effectFromFlat, flatEffectJsonSchema, flatEffectSchema, simulationOptions, type DecisionEffect } from "@/lib/decision-effects";
import { parseEntityAttributes } from "@/lib/interpretation";

const conversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(20_000),
});

const evidenceContextSchema = z.object({
  id: z.string().uuid().optional(),
  sourceName: z.string().trim().min(1).max(255),
  summary: z.string().max(20_000).optional(),
  facts: z.array(z.object({ label: z.string(), value: z.string(), confidence: z.number() })).max(200).default([]),
  questions: z.array(z.string()).max(50).default([]),
});

const inputSchema = modelRequestSchema.extend({
  message: z.string().trim().min(1).max(20_000),
  month: z.string().regex(/^20\d{2}-\d{2}$/).optional(),
  history: z.array(conversationMessageSchema).max(20).default([]),
  evidence: z.array(evidenceContextSchema).max(20).default([]),
  attachments: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
  reviewQuestionId: z.string().uuid().optional(),
  decisionId: z.string().uuid().optional(),
});

const toolNames = ["get_financials", "trace_value", "get_obligations", "get_allocations", "simulate", "read_policies", "read_company_state", "read_evidence"] as const;

const outputSchema = z.object({
  answer: z.string(),
  questions: z.array(z.string()),
  resolvedQuestions: z.array(z.object({ id: z.string().uuid(), answer: z.string().trim().min(1) })).default([]),
  resolvedDecisions: z.array(z.object({ id: z.string().uuid(), status: z.enum(["applied", "rejected"]), answer: z.string().trim().min(1) })).default([]),
  proposedDecisions: z.array(z.object({ question: z.string(), answer: z.string(), effect: flatEffectSchema.nullable() })),
  forecastExplanation: z.string(),
  toolCalls: z.array(z.object({ tool: z.enum(toolNames), input: z.string() })).default([]),
});

const outputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    resolvedQuestions: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, answer: { type: "string" } }, required: ["id", "answer"] } },
    resolvedDecisions: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, status: { type: "string", enum: ["applied", "rejected"] }, answer: { type: "string" } }, required: ["id", "status", "answer"] } },
    proposedDecisions: { type: "array", items: { type: "object", additionalProperties: false, properties: { question: { type: "string" }, answer: { type: "string" }, effect: flatEffectJsonSchema }, required: ["question", "answer", "effect"] } },
    forecastExplanation: { type: "string" },
    toolCalls: { type: "array", items: { type: "object", additionalProperties: false, properties: { tool: { type: "string", enum: [...toolNames] }, input: { type: "string" } }, required: ["tool", "input"] } },
  },
  required: ["answer", "questions", "resolvedQuestions", "resolvedDecisions", "proposedDecisions", "forecastExplanation", "toolCalls"],
};

function parseToolInput(input: string): Record<string, unknown> {
  try { const parsed = JSON.parse(input) as unknown; return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}; } catch { return { query: input }; }
}

async function runTool(tool: (typeof toolNames)[number], rawInput: string, context: { companyId: string; financials: FinancialContext; policies: unknown; items: unknown; entities: { id: string; name: string; type: string; category: Category | null }[]; evidenceDocuments: Parameters<typeof relevantEvidenceContext>[0] }) {
  const input = parseToolInput(rawInput);
  const { financials } = context;
  const asOf = financials.input.asOfMonth;
  switch (tool) {
    case "get_financials": {
      const start = typeof input.start === "string" && isValidMonth(input.start) ? input.start : typeof input.month === "string" && isValidMonth(input.month) ? input.month : asOf;
      const end = typeof input.end === "string" && isValidMonth(input.end) ? input.end : typeof input.month === "string" && isValidMonth(input.month) ? input.month : financials.input.horizon.end;
      return summarizeMonths(financials.output, start, end).map((month) => ({ ...month, pnl: financials.output.months.find((entry) => entry.month === month.month)?.pnl }));
    }
    case "trace_value": {
      const month = typeof input.month === "string" && isValidMonth(input.month) ? input.month : asOf;
      const category = isCategory(input.category) ? input.category : undefined;
      const label = typeof input.label === "string" ? input.label : typeof input.query === "string" ? input.query : undefined;
      const direction = input.direction === "receipt" || input.direction === "spend" ? input.direction : undefined;
      return { month, lines: traceValue(financials.output, { month, ...(category ? { category } : {}), ...(label ? { label } : {}), ...(direction ? { direction } : {}) }).map((line) => ({ kind: line.kind, description: line.description, amount: line.amount, direction: line.direction, category: line.category ?? null, basis: line.basis ?? null, cash: line.cash, recognized: line.recognized, itemId: line.itemId ?? null, eventId: line.eventId ?? null, settledBy: line.settledBy ?? [], settles: line.settles ?? null, bearer: line.bearerName ?? null, evidenceId: line.provenance.evidenceId ?? null, sourceName: line.provenance.sourceName ?? null, decisionId: line.provenance.decisionId ?? null, policyId: line.provenance.policyId ?? null })) };
    }
    case "get_obligations": {
      const latest = financials.output.months.find((month) => month.month === asOf) ?? financials.output.months.at(-1);
      return { asOfMonth: asOf, outstanding: latest?.outstanding ?? { receivables: [], payables: [] }, items: [...financials.itemRows.values()].map((row) => ({ id: row.id, type: row.type, label: row.label, counterparty: row.counterparty, amount: Number(row.amount ?? 0), cadence: row.cadence, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, category: row.category, basis: row.basis, settledOccurrences: financials.output.expected.filter((event) => event.itemId === row.id && event.settledBy.length).length, unsettledPastOccurrences: financials.output.expected.filter((event) => event.itemId === row.id && !event.settledBy.length && event.month <= asOf).length })) };
    }
    case "get_allocations": {
      const latest = financials.output.months.at(-1);
      return { rules: financials.input.allocations ?? [], intercompany: latest?.intercompany ?? [], allocationLines: financials.output.months.flatMap((month) => month.lines.filter((line) => line.kind === "allocation").map((line) => ({ month: month.month, description: line.description, amount: line.amount, bearer: line.bearerName ?? line.bearerEntityId }))) };
    }
    case "simulate": {
      const rawEffects = Array.isArray(input.effects) ? input.effects : [];
      const effects = rawEffects.map((effect) => effectFromFlat(flatEffectSchema.safeParse(effect).success ? (flatEffectSchema.parse(effect)) : null)).filter((effect): effect is DecisionEffect => Boolean(effect));
      if (!effects.length) return { error: "simulate needs effects: [{ kind: add_item | end_item | change_amount, ... }] using the flat effect shape" };
      const simulated = await computeFinancials(context.companyId, simulationOptions(effects));
      const base = summarizeMonths(financials.output, asOf);
      const alt = summarizeMonths(simulated.output, asOf);
      return { effects: effects.map(describeEffect), months: base.map((month, index) => ({ month: month.month, baseEndingCash: month.endingCash, simulatedEndingCash: alt[index]?.endingCash, deltaEndingCash: (alt[index]?.endingCash ?? 0) - (month.endingCash ?? 0), baseOperatingIncome: month.operatingIncome, simulatedOperatingIncome: alt[index]?.operatingIncome, baseReceipts: month.receipts, simulatedReceipts: alt[index]?.receipts, baseSpending: month.spending, simulatedSpending: alt[index]?.spending })) };
    }
    case "read_policies": return context.policies;
    case "read_company_state": return { items: context.items, entities: context.entities, openingCash: financials.input.openingCash ?? null, closedMonths: financials.input.closedMonths, horizon: financials.input.horizon };
    case "read_evidence": return relevantEvidenceContext(context.evidenceDocuments, typeof input.query === "string" ? input.query : rawInput);
  }
}

export async function POST(request: Request) {
  await auth.protect();
  const body = inputSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "A message is required" }, { status: 400 });
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [financials, itemRows, docs, activePolicies, priorDecisions, proposedDecisionRows, openReviews, evidenceDocuments, entityRows] = await Promise.all([
    computeFinancials(context.company.id),
    db.select({ id: economicItems.id, type: economicItems.type, label: economicItems.label, counterparty: economicItems.counterparty, amount: economicItems.amount, direction: economicItems.direction, cadence: economicItems.cadence, effectiveFrom: economicItems.effectiveFrom, effectiveTo: economicItems.effectiveTo, category: economicItems.category, basis: economicItems.basis, status: economicItems.status, confidence: economicItems.confidence }).from(economicItems).where(eq(economicItems.companyId, context.company.id)).orderBy(desc(economicItems.createdAt)).limit(150),
    db.select({ slug: knowledgeDocuments.slug, content: knowledgeDocuments.content }).from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, context.company.id)),
    db.select({ name: policies.name, rule: policies.rule }).from(policies).where(and(eq(policies.companyId, context.company.id), eq(policies.active, "Y"))),
    db.select({ question: decisions.question, answer: decisions.answer }).from(decisions).where(and(eq(decisions.companyId, context.company.id), eq(decisions.status, "applied"))).orderBy(desc(decisions.createdAt)).limit(20),
    db.select({ id: decisions.id, question: decisions.question, answer: decisions.answer, effect: decisions.effect }).from(decisions).where(and(eq(decisions.companyId, context.company.id), eq(decisions.status, "proposed"))).orderBy(desc(decisions.createdAt)).limit(50),
    db.select({ id: reviewItems.id, question: reviewItems.question, evidenceId: reviewItems.evidenceId }).from(reviewItems).where(and(eq(reviewItems.companyId, context.company.id), eq(reviewItems.status, "open"))).orderBy(desc(reviewItems.createdAt)).limit(50),
    db.select({ id: evidence.id, sourceName: evidence.sourceName, rawText: evidence.rawText, extractedJson: evidence.extractedJson }).from(evidence).where(eq(evidence.companyId, context.company.id)).orderBy(desc(evidence.createdAt)).limit(20),
    db.select({ id: entities.id, name: entities.name, type: entities.type, attributes: entities.attributes }).from(entities).where(eq(entities.companyId, context.company.id)),
  ]);
  const consolidatedOpenReviews = uniqueReviewQuestions(openReviews);
  const asOf = financials.input.asOfMonth;
  const calculated = summarizeMonths(financials.output, asOf);
  const asOfMonth = financials.output.months.find((month) => month.month === asOf);
  const recentActuals = financials.input.actuals.filter((actual) => actual.month <= asOf).sort((a, b) => (b.date ?? b.month).localeCompare(a.date ?? a.month)).slice(0, 80).map((actual) => ({ id: actual.id, date: actual.date ?? actual.month, description: actual.description, amount: actual.amount, direction: actual.direction, activity: actual.activity, category: actual.category ?? null, settlesItemId: actual.settlesItemId ?? null }));
  const confirmedItems = itemRows.filter((item) => item.status === "confirmed").map((item) => ({ ...item, amount: Number(item.amount ?? 0) }));
  const draftItems = itemRows.filter((item) => item.status === "draft").map((item) => ({ id: item.id, label: item.label, amount: Number(item.amount ?? 0), direction: item.direction, cadence: item.cadence, effectiveFrom: item.effectiveFrom, category: item.category, confidence: item.confidence ? Number(item.confidence) : null }));
  const knownEntities = entityRows.map((entity) => ({ id: entity.id, name: entity.name, type: entity.type, category: parseEntityAttributes(entity.attributes).category ?? null }));
  const provider = getModelProvider(resolveModelOverrides(body.data));
  const conversation = [...body.data.history, { role: "user" as const, content: body.data.message }];
  const focusedReview = body.data.reviewQuestionId ? consolidatedOpenReviews.find((review) => review.id === body.data.reviewQuestionId) : undefined;
  const focusedDecision = body.data.decisionId ? proposedDecisionRows.find((decision) => decision.id === body.data.decisionId) : undefined;
  const evidenceQuery = [...conversation.map((message) => message.content), focusedReview?.question ?? ""].join("\n");
  const sourceEvidence = relevantEvidenceContext(evidenceDocuments, evidenceQuery, focusedReview?.evidenceId);

  const baseInstructions = `You are the controlled finance agent for the company, in a continuing conversation with its CFO. The numbers come from a deterministic engine; you explain them, you never compute them yourself. Never invent amounts, dates, or identities.

How the engine works: confirmed items (agreements and obligations) expand into expected cash on their own calendar; imported actuals settle the expectations they match; months before ${asOf} are history and move cash on actuals only; open months project actuals plus unsettled expectations; each line carries its source. "contractual" lines are backed by evidence, "assumed" lines by CFO or agent assumptions. Draft items are interpretations waiting for CFO confirmation and are not in the forecast yet.

Tools (request at most one per turn as toolCalls; results come back on the next turn; input is a JSON string):
- get_financials {"start":"YYYY-MM","end":"YYYY-MM"}: cash, P&L, outstanding items, intercompany balances per month.
- trace_value {"month":"YYYY-MM","category":"professional_services","label":"Smith"}: the lines behind a figure with their source, item, settlement, decision, and policy. Use it for every "why is this number" question.
- get_obligations {}: what is due, settled, and unpaid.
- get_allocations {}: allocation rules, allocated lines, amounts due from other entities.
- simulate {"effects":[...]}: run the engine with hypothetical effects and compare to the base case. Use it for every "what if" question. Effects use the flat shape: {"kind":"add_item","item":{"label","counterparty","direction","amount","cadence","effectiveFrom","effectiveTo","category","accountingTreatment","recognitionStart","recognitionEnd"},...} or {"kind":"end_item","itemId","effectiveTo"} or {"kind":"change_amount","itemId","amount","effectiveFrom"} with unused fields null.
- read_policies {}, read_company_state {}, read_evidence {"query":"..."}.

When the CFO states an assumption or asks you to change the forecast ("assume we hire a contractor in January at $6k"), respond with a proposedDecision whose effect encodes it exactly (add_item with basis assumed, end_item, change_amount, or set_category for a counterparty). Proposals are suggestions only; they apply when the CFO accepts them. Do not claim a proposal was applied. Use the same effect shape as simulate; set effect to null for decisions with no structured change.

Apply the universal accounting rules in the Accounting knowledge document first, then company Policies and approved decisions. Ask one grouped CFO-friendly question only for material or ambiguous exceptions, in both your answer and the questions field. Review every open clarification question and proposed decision against the latest CFO answer; when the latest message clearly answers one, include its exact id in resolvedQuestions or resolvedDecisions (status applied when accepted, rejected when declined). Do not resolve an item unless the answer is clear. Consolidate related questions.

Focused clarification: ${JSON.stringify(focusedReview ?? null)}
Focused proposed decision: ${JSON.stringify(focusedDecision ?? null)}
Policies: ${JSON.stringify(activePolicies)}
Prior decisions: ${JSON.stringify(priorDecisions)}
Proposed decisions awaiting the CFO: ${JSON.stringify(proposedDecisionRows.map((decision) => ({ id: decision.id, question: decision.question, answer: decision.answer })))}
Open clarification questions: ${JSON.stringify(consolidatedOpenReviews)}
Opening cash: ${JSON.stringify(financials.input.openingCash ?? null)}; closed months: ${JSON.stringify(financials.input.closedMonths)}
Engine summary from ${asOf} (twelve months): ${JSON.stringify(calculated)}
Outstanding as of ${asOf}: ${JSON.stringify(asOfMonth?.outstanding ?? null)}
Confirmed items: ${JSON.stringify(confirmedItems)}
Draft items awaiting confirmation: ${JSON.stringify(draftItems)}
Known counterparties: ${JSON.stringify(knownEntities)}
Recent actual transactions (newest first, up to 80): ${JSON.stringify(recentActuals)}
Knowledge: ${JSON.stringify(docs)}
Uploaded source evidence excerpts: ${JSON.stringify(sourceEvidence)}
New evidence uploaded with this turn: ${JSON.stringify(body.data.evidence)}`;

  let result;
  try {
    result = await provider.generateStructured({ name: "finance_agent_response", schema: outputSchema, jsonSchema: outputJsonSchema, instructions: baseInstructions, messages: conversation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model returned an invalid response.";
    return NextResponse.json({ error: `The model response could not be read. ${message}` }, { status: 502 });
  }
  const runIds: string[] = [];
  const firstRun = await recordLlmRun({ db, provider, companyId: context.company.id, userId: context.user.id, operation: "agent", request: { message: body.data.message, history: body.data.history, evidence: body.data.evidence, reviewQuestionId: body.data.reviewQuestionId, month: body.data.month }, response: JSON.stringify(result) });
  if (firstRun) runIds.push(firstRun);
  const toolContext = { companyId: context.company.id, financials, policies: activePolicies, items: confirmedItems, entities: knownEntities, evidenceDocuments };
  const toolTranscript: Array<{ tool: string; input: string; result: unknown }> = [];
  for (let turn = 0; turn < 2 && result.toolCalls.length; turn += 1) {
    const call = result.toolCalls[0]!;
    let toolResult: unknown;
    try { toolResult = await runTool(call.tool, call.input, toolContext); } catch (error) { toolResult = { error: error instanceof Error ? error.message : "Tool failed" }; }
    toolTranscript.push({ tool: call.tool, input: call.input, result: toolResult });
    try {
      result = await provider.generateStructured({ name: "finance_agent_response", schema: outputSchema, jsonSchema: outputJsonSchema, instructions: `${baseInstructions}\n\nControlled tool results (answer from these; request another tool only if still needed): ${JSON.stringify(toolTranscript)}`, messages: conversation });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The model returned an invalid response.";
      return NextResponse.json({ error: `The model follow-up could not be read. ${message}` }, { status: 502 });
    }
    const followupRun = await recordLlmRun({ db, provider, companyId: context.company.id, userId: context.user.id, operation: "agent_tool_followup", request: { message: body.data.message, history: body.data.history, evidence: body.data.evidence, reviewQuestionId: body.data.reviewQuestionId, toolResults: toolTranscript }, response: JSON.stringify(result) });
    if (followupRun) runIds.push(followupRun);
  }

  const openReviewById = new Map(consolidatedOpenReviews.map((review) => [review.id, review]));
  let resolvedQuestionCount = 0;
  for (const resolution of result.resolvedQuestions) {
    const review = openReviewById.get(resolution.id);
    if (!review) continue;
    const [resolved] = await db.update(reviewItems).set({ answer: resolution.answer, status: "resolved", updatedAt: new Date() }).where(and(eq(reviewItems.id, resolution.id), eq(reviewItems.companyId, context.company.id), eq(reviewItems.status, "open"))).returning({ id: reviewItems.id });
    if (!resolved) continue;
    resolvedQuestionCount += 1;
    await db.insert(decisions).values({ companyId: context.company.id, question: review.question, answer: resolution.answer, status: "applied" });
  }
  const resolvedDecisionIds: string[] = [];
  const appliedEffects: string[] = [];
  for (const resolution of result.resolvedDecisions) {
    const proposal = proposedDecisionRows.find((decision) => decision.id === resolution.id);
    if (!proposal) continue;
    const [updated] = await db.update(decisions).set({ status: resolution.status, updatedAt: new Date() }).where(and(eq(decisions.id, resolution.id), eq(decisions.companyId, context.company.id), eq(decisions.status, "proposed"))).returning({ id: decisions.id });
    if (!updated) continue;
    resolvedDecisionIds.push(updated.id);
    if (resolution.status === "applied") {
      try { const applied = await applyDecisionIfEffective(context.company.id, updated.id); if (applied?.applied) appliedEffects.push(applied.applied); } catch (error) { appliedEffects.push(`failed: ${error instanceof Error ? error.message : "unknown error"}`); }
    }
  }

  const normalizeQuestion = (question: string) => question.trim().toLowerCase().replace(/\s+/g, " ");
  const existingQuestions = [...consolidatedOpenReviews.map((review) => ({ question: review.question }))];
  const newQuestions = result.questions.map((question) => question.trim()).filter((question) => {
    const normalized = normalizeQuestion(question);
    if (!question || existingQuestions.some((existing) => normalizeQuestion(existing.question) === normalized || uniqueReviewQuestions([existing, { question }]).length === 1)) return false;
    existingQuestions.push({ question });
    return true;
  });
  if (newQuestions.length) await db.insert(reviewItems).values(newQuestions.map((question) => ({ companyId: context.company.id, evidenceId: focusedReview?.evidenceId, question })));
  if (result.proposedDecisions.length) {
    await db.insert(decisions).values(result.proposedDecisions.map((proposal) => { const effect = effectFromFlat(proposal.effect); return { companyId: context.company.id, question: proposal.question, answer: proposal.answer, status: "proposed", ...(effect ? { effect: JSON.stringify(effect) } : {}) }; }));
  }
  const responseText = JSON.stringify({ answer: result.answer, questions: result.questions, forecastExplanation: result.forecastExplanation });
  await recordConversation(db, { companyId: context.company.id, userId: context.user.id, runId: runIds.at(-1), runIds, question: body.data.message, response: responseText, model: provider.model, attachments: body.data.attachments });
  return NextResponse.json({ ...result, proposedDecisions: result.proposedDecisions.map((proposal) => ({ question: proposal.question, answer: proposal.answer, effectSummary: describeEffect(effectFromFlat(proposal.effect)) })), resolvedQuestionCount, resolvedDecisionIds, appliedEffects, toolsUsed: toolTranscript.map((entry) => entry.tool) });
}
