import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cashEvents, decisions, economicItems, getDatabase, knowledgeDocuments, policies, reportingPeriods } from "@finance/database";
import { buildMonthlyCash } from "@nevermodel/finance-engine";
import { getModelProvider, modelRequestSchema, resolveModelOverrides } from "@/lib/models";
import { requireCompanyAccess } from "@/lib/auth";
import { recordConversation, recordLlmRun } from "@/lib/llm-telemetry";

const inputSchema = modelRequestSchema.extend({ message: z.string().trim().min(1).max(20_000), month: z.string().regex(/^20\d{2}-\d{2}$/).optional() });
const outputSchema = z.object({ answer: z.string(), questions: z.array(z.string()), proposedDecisions: z.array(z.object({ question: z.string(), answer: z.string() })), forecastExplanation: z.string(), toolCalls: z.array(z.object({ tool: z.enum(["read_company_state", "query_forecast", "read_policies", "trace_value", "get_obligations", "get_allocations"]), input: z.string() })).default([]) });

export async function POST(request: Request) {
  await auth.protect();
  const body = inputSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "A message is required" }, { status: 400 });
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [items, events, docs, activePolicies, priorDecisions, periods] = await Promise.all([
    db.select({ id: economicItems.id, type: economicItems.type, label: economicItems.label, amount: economicItems.amount, direction: economicItems.direction, cadence: economicItems.cadence, status: economicItems.status }).from(economicItems).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.status, "confirmed"))),
    db.select({ month: cashEvents.month, amount: cashEvents.amount, direction: cashEvents.direction, isActual: cashEvents.isActual, description: cashEvents.description, evidenceId: cashEvents.evidenceId }).from(cashEvents).where(eq(cashEvents.companyId, context.company.id)).orderBy(desc(cashEvents.month)).limit(200),
    db.select({ slug: knowledgeDocuments.slug, content: knowledgeDocuments.content }).from(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, context.company.id)),
    db.select({ name: policies.name, rule: policies.rule }).from(policies).where(and(eq(policies.companyId, context.company.id), eq(policies.active, "Y"))),
    db.select({ question: decisions.question, answer: decisions.answer }).from(decisions).where(eq(decisions.companyId, context.company.id)).orderBy(desc(decisions.createdAt)).limit(20),
    db.select({ month: reportingPeriods.month, openingCash: reportingPeriods.openingCash }).from(reportingPeriods).where(eq(reportingPeriods.companyId, context.company.id)),
  ]);
  const openingCash = Number(periods.find((period) => period.month === (body.data.month ?? new Date().toISOString().slice(0, 7)))?.openingCash ?? periods[0]?.openingCash ?? 0);
  const calculated = buildMonthlyCash(openingCash, events.map((event) => ({ month: event.month, amount: Number(event.amount), kind: event.direction, actual: event.isActual === "Y" })));
  const provider = getModelProvider(resolveModelOverrides(body.data));
  const baseInstructions = `You are the controlled finance agent for company ${context.company.id}. Explain only from the supplied state. Never invent amounts. Ask a precise CFO question when evidence is ambiguous. Proposals are suggestions only; do not claim they were applied. You may request at most one of the supplied controlled tools per turn; tool results will be returned for a subsequent turn. Policies: ${JSON.stringify(activePolicies)}. Prior decisions: ${JSON.stringify(priorDecisions)}. Knowledge: ${JSON.stringify(docs)}. Confirmed items: ${JSON.stringify(items)}. Deterministic forecast: ${JSON.stringify(calculated.slice(0, 12))}`;
  let result = await provider.generateStructured({
    name: "finance_agent_response",
    schema: outputSchema,
    jsonSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "string" }, questions: { type: "array", items: { type: "string" } }, proposedDecisions: { type: "array", items: { type: "object", additionalProperties: false, properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } }, forecastExplanation: { type: "string" }, toolCalls: { type: "array", items: { type: "object", additionalProperties: false, properties: { tool: { type: "string", enum: ["read_company_state", "query_forecast", "read_policies", "trace_value", "get_obligations", "get_allocations"] }, input: { type: "string" } }, required: ["tool", "input"] } } }, required: ["answer", "questions", "proposedDecisions", "forecastExplanation", "toolCalls"] },
    instructions: baseInstructions,
    messages: [{ role: "user", content: body.data.message }],
  });
  const runIds: string[] = [];
  const firstRun = await recordLlmRun({ db, provider, companyId: context.company.id, userId: context.user.id, operation: "agent", request: { message: body.data.message, month: body.data.month }, response: JSON.stringify(result) });
  if (firstRun) runIds.push(firstRun);
  for (let turn = 0; turn < 2 && result.toolCalls.length; turn += 1) {
    const toolResults = result.toolCalls.slice(0, 1).map((call) => call.tool === "query_forecast" ? { tool: call.tool, result: calculated.slice(0, 12) } : call.tool === "read_policies" ? { tool: call.tool, result: activePolicies } : call.tool === "trace_value" ? { tool: call.tool, result: calculated.slice(0, 12).map((month) => ({ month: month.month, trace: events.filter((event) => event.month === month.month).map((event) => ({ description: event.description, evidenceId: event.evidenceId })) })) } : call.tool === "get_obligations" ? { tool: call.tool, result: items.filter((item) => item.type === "obligation") } : call.tool === "get_allocations" ? { tool: call.tool, result: "Allocation records are available in the authorized company state." } : { tool: call.tool, result: { items, events: events.slice(0, 50), periods } });
    result = await provider.generateStructured({ name: "finance_agent_response", schema: outputSchema, jsonSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "string" }, questions: { type: "array", items: { type: "string" } }, proposedDecisions: { type: "array", items: { type: "object", additionalProperties: false, properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] } }, forecastExplanation: { type: "string" }, toolCalls: { type: "array", items: { type: "object", additionalProperties: false, properties: { tool: { type: "string", enum: ["read_company_state", "query_forecast", "read_policies", "trace_value", "get_obligations", "get_allocations"] }, input: { type: "string" } }, required: ["tool", "input"] } } }, required: ["answer", "questions", "proposedDecisions", "forecastExplanation", "toolCalls"] }, instructions: `${baseInstructions}\nControlled tool results: ${JSON.stringify(toolResults)}`, messages: [{ role: "user", content: body.data.message }] });
    const followupRun = await recordLlmRun({ db, provider, companyId: context.company.id, userId: context.user.id, operation: "agent_tool_followup", request: { message: body.data.message, toolResults }, response: JSON.stringify(result) });
    if (followupRun) runIds.push(followupRun);
  }
  if (result.proposedDecisions.length) {
    await db.insert(decisions).values(result.proposedDecisions.map((proposal) => ({ companyId: context.company.id, question: proposal.question, answer: proposal.answer, status: "proposed" })));
  }
  const responseText = JSON.stringify({ answer: result.answer, questions: result.questions, forecastExplanation: result.forecastExplanation });
  await recordConversation(db, { companyId: context.company.id, userId: context.user.id, runId: runIds.at(-1), question: body.data.message, response: responseText, model: provider.model });
  return NextResponse.json({ companyId: context.company.id, ...result, requestedMonth: body.data.month ?? null });
}
