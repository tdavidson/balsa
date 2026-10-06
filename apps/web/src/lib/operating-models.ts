import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { evidence, getDatabase, operatingExperiments, recordAudit, setCompanyScopeSql } from "@finance/database";
import { addMonths, evaluateCashGoal, evaluateOperatingModel, stableJson, validateOperatingModel, type OperatingModel } from "@balsa/finance-engine";
import { captureOutlook, GoalReviewError, goalsWith, previewToken } from "./goal-reviews";
import { runSimulation, type ScenarioChange } from "./scenario-changes";
import { createScenarioWith } from "./scenarios";
import { lockScenarioName } from "./scenario-name-lock";
import { operatingCommand, operatingDraftSchema } from "./operating-model-contract";
import type { DbExecutor } from "./db-executor";
import { getModelProvider } from "./models";
import { recordLlmRun } from "./llm-telemetry";
import { analyzeOperatingDecision } from "./operating-decision-analysis";
import { z } from "zod";

const hash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
const assumptionNotice = "This is an incremental, assumption-based model. Confirm that its receipts and costs are not already in the base forecast. Cases are alternatives, not probabilities. Unit labels are descriptive; dimensional consistency needs review. Cash schedules end at the operating-model horizon; continuing obligations beyond it are not extrapolated.";
export function operatingChanges(model: OperatingModel, caseId: string) {
  let operating;
  try { operating = evaluateOperatingModel(model, caseId); } catch (error) { throw new GoalReviewError(error instanceof Error ? error.message.slice(0, 300) : "Invalid operating model.", 422); }
  const changes: ScenarioChange[] = operating.cash.map((row) => ({ kind: "add_driver", label: row.label, direction: row.direction, amount: Number(row.amountMinor) / 100, cadence: "once", effectiveFrom: row.month, category: row.category }));
  return { operating, changes };
}
async function sourcesWith(db: DbExecutor, companyId: string, model: OperatingModel) {
  const ids = [...new Set(model.nodes.flatMap((node) => node.evidenceIds))];
  const documents = ids.length ? await db.select({ id: evidence.id, name: evidence.sourceName, status: evidence.status }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids))) : [];
  if (documents.length !== ids.length) throw new GoalReviewError("A referenced source is not available in this company.", 404);
  return documents;
}
async function previewWith(db: DbExecutor, companyId: string, model: OperatingModel, now: Date) {
  try { validateOperatingModel(model); } catch (error) { throw new GoalReviewError(error instanceof Error ? error.message.slice(0, 300) : "Invalid operating model.", 422); }
  const base = await captureOutlook(db, companyId, now);
  if (model.startMonth < base.output.horizon.start || addMonths(model.startMonth, model.months - 1) > base.output.horizon.end) throw new GoalReviewError("Choose an operating horizon wholly inside the current forecast horizon.", 422);
  if (model.outputs.some((output) => model.nodes.find((node) => node.id === output.nodeId)?.unit !== base.input.currency)) throw new GoalReviewError(`Cash output units must be ${base.input.currency}, expressed in major currency units.`, 422);
  const documents = await sourcesWith(db, companyId, model);
  const goals = (await goalsWith(db, companyId)).filter((goal) => goal.status === "active");
  const limitations = [assumptionNotice, ...model.limitations, ...base.limitations, ...documents.filter((doc) => doc.status !== "approved").map((doc) => `${doc.name}: source is ${doc.status}; it does not establish an approved fact.`)];
  const paths = ["base", ...model.cases.map((c) => c.id)].map((caseId) => {
    const { operating, changes } = operatingChanges(model, caseId);
    const { run } = runSimulation(base.input, changes);
    return { caseId, name: caseId === "base" ? "Draft assumptions" : model.cases.find((c) => c.id === caseId)!.name, operating, changes, forecast: run, goals: goals.map((goal) => ({ id: goal.id, before: evaluateCashGoal(goal.definition, base.output, limitations), after: evaluateCashGoal(goal.definition, run, limitations) })) };
  });
  let decisionAnalysis = null;
  if (model.decision) {
    try { decisionAnalysis = analyzeOperatingDecision(base.input, model); }
    catch (cause) { throw new GoalReviewError(cause instanceof Error ? cause.message.slice(0,300) : "Decision analysis could not be calculated.", 422); }
  }
  const token = hash({ model, base: previewToken(base), goals, documents });
  return { base, preview: { companyId, model, previewToken: token, currency: base.input.currency, baseMonths: base.output.months, paths, limitations, documents, decisionAnalysis } };
}
export type OperatingPreview = Awaited<ReturnType<typeof previewWith>>["preview"];
export async function loadOperatingWorkspace(companyId: string, now = new Date()) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    const base = await captureOutlook(tx, companyId, now);
    const saved = await tx.select({ id: operatingExperiments.id, name: operatingExperiments.name, scenarioId: operatingExperiments.scenarioId, createdAt: operatingExperiments.createdAt }).from(operatingExperiments).where(eq(operatingExperiments.companyId, companyId)).orderBy(desc(operatingExperiments.createdAt)).limit(30);
    return { companyId, currency: base.input.currency, horizon: base.output.horizon, saved: saved.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  }, { isolationLevel: "repeatable read" });
}
export async function loadOperatingExperiment(companyId: string, id: string) {
  const [row] = await getDatabase().select().from(operatingExperiments).where(and(eq(operatingExperiments.companyId, companyId), eq(operatingExperiments.id, id)));
  if (!row) throw new GoalReviewError("Operating experiment not found.", 404);
  return { companyId, id: row.id, name: row.name, scenarioId: row.scenarioId, snapshot: row.snapshot, createdAt: row.createdAt.toISOString() };
}
export async function executeOperatingCommand(companyId: string, raw: unknown, actorUserId: string, now = new Date()) {
  const parsed = operatingCommand.safeParse(raw);
  if (!parsed.success) throw new GoalReviewError("Invalid operating-model request. Check the variables, cases and required fields.");
  const command = parsed.data;
  if (command.action === "draft") {
    const workspace = await loadOperatingWorkspace(companyId, now); const provider = getModelProvider();
    try {
      const generated = await provider.generateStructured({ name: "operating_model", schema: operatingDraftSchema, jsonSchema: z.toJSONSchema(operatingDraftSchema), instructions: `Draft an auditable operating model from the user's decision question. Return only the schema. You propose assumptions, never approve facts or decisions. Currency ${workspace.currency}; horizon ${workspace.horizon.start} to ${workspace.horizon.end}. Default to six months beginning at horizon start. Do not invent source IDs: use empty evidenceIds unless provided in the prior model. Each node has a rationale stating supplied fact, user assumption, or illustrative assumption requiring confirmation. List missing information and omitted mechanisms in limitations. Use at most 60 nodes and 3 cases. Cases are named input overrides, never probabilities. The model adds INCREMENTAL cash flows to the existing forecast; explain overlap risk. Nodes operate on decimal strings (six places), not code. input has zero args and explicit starting dated values; all other nodes have empty values. add/subtract/multiply/divide/min/max/gt/gte/eq have two args naming nodes; comparisons yield 1 or 0. if has [condition,trueNode,falseNode]. lag has one arg and explicit initial decimal, taking that node's PRIOR MONTH value; all other initial fields are null. Other same-month cycles are prohibited. Use lag for evolving backlog, balances, cohorts or delayed payments. Preserve existing node IDs when refining the same metric; change identity if its unit, scope or meaning changes. For interacting stores, teams, customers or cohorts, use clearly scoped node labels, shared min/max capacity constraints and explicit cross-entity dependencies; explain cannibalization, price response and feedback as assumptions. Entity membership and uniform sampling ranges are reviewed separately in Decision studies. Never imply that named cases are structural model alternatives or empirical distributions. Treat monetary nodes as major currency units. Cash outputs must have unit ${workspace.currency}, be nonnegative and incremental, with at most four output mappings. Each mapped node emits cash in every month; gate one-time receipts to exactly one month rather than emitting a cumulative balance repeatedly. Initial conditions are explicit. Unit labels are descriptive, not automatic conversion. No arbitrary code, random sampling, external tools, or invented calibrated relationships. Follow the user's requested scope and clearly mark unsupported assumptions.`, messages: [{ role: "user", content: JSON.stringify({ request: command.prompt, previousModel: command.previous }) }] });
      const model: OperatingModel = { ...generated, ...(command.previous?.decision ? { decision: command.previous.decision } : {}), nodes: generated.nodes.map((node) => ({ ...node, basis: "ai_suggestion" })) };
      validateOperatingModel(model); await sourcesWith(getDatabase(), companyId, model);
      // Every proposed case must execute before it can be returned for review.
      for (const id of ["base", ...model.cases.map((c) => c.id)]) evaluateOperatingModel(model, id);
      await recordLlmRun({ db: getDatabase(), provider, companyId, userId: actorUserId, operation: "operating_model_draft", request: { prompt: command.prompt }, status: "succeeded" });
      return { companyId, model };
    } catch {
      await recordLlmRun({ db: getDatabase(), provider, companyId, userId: actorUserId, operation: "operating_model_draft", request: {}, status: "failed", error: "Operating draft generation or validation failed." });
      throw new GoalReviewError("The model draft could not be generated or validated. Simplify the request or retry; your existing draft is unchanged.", 422);
    }
  }
  return getDatabase().transaction(async (tx) => {
    await tx.execute(setCompanyScopeSql(companyId));
    if (command.action === "save") {
      await tx.execute(sql`select pg_advisory_xact_lock(7411, hashtext(${companyId}))`);
      const [prior] = await tx.select().from(operatingExperiments).where(and(eq(operatingExperiments.companyId, companyId), eq(operatingExperiments.requestKey, command.requestKey)));
      if (prior) { if (prior.requestHash !== hash(command)) throw new GoalReviewError("Request key already used for another experiment.", 409); return { companyId, saved: { id: prior.id, scenarioId: prior.scenarioId, name: prior.name } }; }
    }
    const { base, preview } = await previewWith(tx, companyId, command.model, now);
    if (command.action === "preview") return { companyId, preview };
    if (preview.previewToken !== command.previewToken) throw new GoalReviewError("The operating model, goals or base outlook changed. Preview again before saving.", 409);
    const path = preview.paths.find((item) => item.caseId === command.caseId);
    if (!path) throw new GoalReviewError("Choose a case from the current preview.");
    if (path.forecast.exceptions.length || !path.changes.length) throw new GoalReviewError("Resolve forecast exceptions or choose a case with cash activity before saving.", 422);
    const name = `${command.model.name.slice(0, 65)} · ${path.name.slice(0, 40)}`;
    await lockScenarioName(tx, companyId, name);
    const scenario = await createScenarioWith(tx, companyId, { name, description: `Operating experiment. Frozen cash schedule for ${path.name}; underlying rules and inputs are retained in Operating models. Re-preview before approval.`, changes: path.changes }, actorUserId, now);
    const [saved] = await tx.insert(operatingExperiments).values({ companyId, scenarioId: scenario.id, name, requestKey: command.requestKey, requestHash: hash(command), actorUserId, snapshot: { schemaVersion: 1, model: command.model, path, base, goals: path.goals, decisionAnalysis: preview.decisionAnalysis, documents: preview.documents, limitations: preview.limitations } }).returning({ id: operatingExperiments.id, scenarioId: operatingExperiments.scenarioId, name: operatingExperiments.name });
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "operating_experiment.saved", entityType: "operating_experiment", entityId: saved!.id, summary: "Preserved operating assumptions and created an unapproved scenario.", after: { scenarioId: scenario.id, caseId: command.caseId, formulaVersion: path.operating.formulaVersion } });
    return { companyId, saved: saved! };
  }, { isolationLevel: "repeatable read" });
}
