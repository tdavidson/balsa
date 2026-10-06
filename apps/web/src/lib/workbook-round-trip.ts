import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { decisions, economicItems, forecastMetrics, forecastVariables, recordAudit, seasonalityProfiles } from "@finance/database";
import type { DbExecutor } from "@/lib/db-executor";
import { describePattern, validatePattern } from "@balsa/finance-engine";
import { exportPattern, patternFromExport, type WorkbookEdits } from "@balsa/model-export";
import { decisionEffectSchema, type DecisionEffect } from "@/lib/decision-effects";
import { mergeWorkbookInput } from "./workbook-model-inputs";
import { parseStoredPattern } from "@/lib/driver-pattern-schema";

export type ProposedEdit = { id: string; question: string; answer: string };
export type WorkbookProposal = { proposed: ProposedEdit[]; notes: string[] };

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const withoutWindow = <T extends { startsIn: string; endsIn: string | null }>(pattern: T) => { const { startsIn: _start, endsIn: _end, ...rest } = pattern; void _start; void _end; return rest; };

/**
 * Turn the edits read from a returned Balsa export into proposed decisions,
 * each citing the uploaded workbook. Nothing is applied: a person reviews and
 * applies them like any other decision. An edit Balsa cannot express as a
 * decision becomes a note instead, and so does anything the file asks of an
 * item that no longer exists here.
 */
export async function proposeWorkbookEditsWith(db: DbExecutor, input: { companyId: string; actorUserId: string | null; evidenceId: string; edits: WorkbookEdits }): Promise<WorkbookProposal> {
  const { companyId, actorUserId, evidenceId } = input;
  const notes = [...input.edits.notes];
  const drafts: { question: string; answer: string; effect: DecisionEffect }[] = [];
  const itemIds = input.edits.edits.flatMap((edit) => (edit.kind === "driver_pattern" || edit.kind === "formula_window") && edit.scenarioId === null && !edit.id.startsWith("decision:") ? [edit.id] : []);
  const metricNames = input.edits.edits.flatMap((edit) => edit.kind === "metric_pattern" ? [edit.name] : []);
  const variableNames = input.edits.edits.flatMap((edit) => edit.kind === "model_input" ? [edit.variable] : []);
  const [items, metrics, variables, profiles] = await Promise.all([
    itemIds.length ? db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, itemIds))) : [],
    metricNames.length ? db.select().from(forecastMetrics).where(and(eq(forecastMetrics.companyId, companyId), inArray(forecastMetrics.name, metricNames))) : [],
    variableNames.length ? db.select().from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), eq(forecastVariables.active, "Y"), inArray(forecastVariables.name, variableNames))) : [],
    db.select({ id: seasonalityProfiles.id, name: seasonalityProfiles.name }).from(seasonalityProfiles).where(eq(seasonalityProfiles.companyId, companyId)),
  ]);
  const profileId = (name: string) => profiles.find((profile) => profile.name === name)?.id ?? null;
  const profileName = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? null;

  const modelDrafts = new Map<string, { original: typeof variables[number]; inputs: typeof variables[number]["inputs"]; descriptions: string[]; conflict: boolean }>();
  for (const edit of input.edits.edits) {
    if (edit.kind === "driver_pattern" || edit.kind === "formula_window") {
      if (edit.scenarioId) { notes.push(`${edit.label}: edits to a scenario's row are not proposed. Change the scenario in Balsa.`); continue; }
      if (edit.id.startsWith("decision:")) { notes.push(`${edit.label}: this driver comes from a decision; change that decision in Balsa.`); continue; }
      const item = items.find((candidate) => candidate.id === edit.id);
      if (!item) { notes.push(`${edit.label}: not proposed, because the driver no longer exists in Balsa.`); continue; }
      if (edit.after.startsIn !== edit.before.startsIn) notes.push(`${edit.label}: a new start month is not proposed; change the start in Balsa.`);
      if (edit.after.endsIn !== edit.before.endsIn) {
        if (edit.after.endsIn) drafts.push({ question: `End ${edit.label} after ${edit.after.endsIn}, as edited in the returned workbook?`, answer: `The workbook ends ${edit.label} after ${edit.after.endsIn}${edit.before.endsIn ? ` instead of ${edit.before.endsIn}` : ""}.`, effect: { kind: "end_item", itemId: item.id, effectiveTo: edit.after.endsIn } });
        else notes.push(`${edit.label}: removing its end month is not proposed; change it in Balsa.`);
      }
      if (edit.kind === "formula_window") { if (edit.after.repeatsEvery !== edit.before.repeatsEvery) notes.push(`${edit.label}: a new repeat for a formula driver is not proposed; change its cadence in Balsa.`); continue; }
      if (same(withoutWindow(edit.after), withoutWindow(edit.before))) continue;
      const converted = patternFromExport(edit.after, profileId);
      if ("problem" in converted) { notes.push(`${edit.label}: not proposed, because ${converted.problem}.`); continue; }
      const problem = validatePattern(converted.pattern);
      if (problem) { notes.push(`${edit.label}: not proposed. ${problem}`); continue; }
      const stored = parseStoredPattern(item.pattern);
      const drifted = stored && !same(withoutWindow(exportPattern(stored, { effectiveFrom: item.effectiveFrom ?? edit.before.startsIn, effectiveTo: item.effectiveTo }, profileName)), withoutWindow(edit.before));
      drafts.push({ question: `Change ${edit.label} to "${describePattern(converted.pattern, undefined, { money: true })}", as edited in the returned workbook?`, answer: `The workbook changes ${edit.label} to ${describePattern(converted.pattern, undefined, { money: true })}.${drifted ? " Its pattern in Balsa has changed since the workbook was exported; compare before applying." : ""}`, effect: { kind: "set_item_pattern", itemId: item.id, pattern: converted.pattern } });
      continue;
    }
    if (edit.kind === "metric_pattern") {
      const metric = metrics.find((candidate) => candidate.name === edit.name);
      if (!metric) { notes.push(`${edit.label}: not proposed, because the metric no longer exists in Balsa.`); continue; }
      const stored = parseStoredPattern(metric.pattern);
      // With actuals, the file shows the pattern restarting at the last actual; its start and starting value come from the actuals, not the pattern.
      const restarted = edit.before.startsIn !== metric.effectiveFrom || (stored && Number(stored.initialValue) !== edit.before.initialValue);
      if (restarted && (edit.after.initialValue !== edit.before.initialValue || edit.after.startsIn !== edit.before.startsIn)) { notes.push(`${edit.label}: its starting value comes from its last actual; record actuals in Balsa instead of editing the start.`); continue; }
      const converted = patternFromExport(restarted && stored ? { ...edit.after, initialValue: Number(stored.initialValue) } : edit.after, profileId);
      if ("problem" in converted) { notes.push(`${edit.label}: not proposed, because ${converted.problem}.`); continue; }
      const problem = validatePattern(converted.pattern);
      if (problem) { notes.push(`${edit.label}: not proposed. ${problem}`); continue; }
      drafts.push({ question: `Change the metric ${edit.label} to "${describePattern(converted.pattern)}", as edited in the returned workbook?`, answer: `The workbook changes ${edit.label} to ${describePattern(converted.pattern)}.`, effect: { kind: "set_metric", metric: { name: metric.name, label: metric.label, unit: metric.unit, effectiveFrom: restarted ? metric.effectiveFrom : edit.after.startsIn, effectiveTo: restarted ? metric.effectiveTo : edit.after.endsIn, pattern: converted.pattern } } as DecisionEffect });
      continue;
    }
    const variable = variables.find((candidate) => candidate.name === edit.variable);
    if (!variable || variable.formula) { notes.push(`${edit.variable}: not proposed, because it is no longer an input variable in Balsa.`); continue; }
    const draft = modelDrafts.get(variable.name) ?? { original: variable, inputs: variable.inputs, descriptions: [], conflict: false };
    modelDrafts.set(variable.name, draft);
    try { draft.inputs = mergeWorkbookInput(draft.inputs, edit); }
    catch { draft.conflict = true; notes.push(`${edit.variable}: inputs changed in Balsa after export. Export a fresh workbook before proposing this change.`); continue; }
    const where = Object.entries(edit.coords).map(([dim, item]) => `${dim}=${item}`).join(", ");
    const changed = edit.months.filter((_, index) => edit.after[index] !== edit.before[index]);
    draft.descriptions.push(`${where || "all"}: ${changed.map((month) => `${edit.after[edit.months.indexOf(month)]} in ${month}`).slice(0, 6).join(", ")}${changed.length > 6 ? ", …" : ""}`);
  }
  for (const [name, draft] of modelDrafts) {
    if (draft.conflict) continue;
    const { kind, dims, formula, inputs } = draft.original;
    const expectedVariable = { name, kind, dims, formula, inputs };
    const summary = draft.descriptions.join("; ");
    const boundedSummary = summary.length > 16_000 ? `${summary.slice(0, 16_000)}… (Review the complete input changes before applying.)` : summary;
    drafts.push({ question: `Change model input ${name}, as edited in the returned workbook?`, answer: `The workbook changes ${name}: ${boundedSummary}. Unedited months are preserved.`, effect: { kind: "set_variable", expectedVariable, variable: { ...expectedVariable, inputs: draft.inputs } } });
  }

  const proposed: ProposedEdit[] = [];
  for (const draft of drafts) {
    const effect = decisionEffectSchema.safeParse(draft.effect);
    if (!effect.success) { notes.push(`${draft.question} Not proposed: ${effect.error.issues[0]?.message ?? "the change is not valid"}.`); continue; }
    const [decision] = await db.insert(decisions).values({ companyId, question: draft.question, answer: draft.answer, status: "proposed", createdByUserId: actorUserId, effect: JSON.stringify(effect.data), evidenceId }).returning({ id: decisions.id });
    await recordAudit(db, { companyId, actorUserId, via: "ui", action: "decision.proposed", entityType: "decision", entityId: decision!.id, summary: draft.question, after: { answer: draft.answer, effect: effect.data, evidenceId } });
    proposed.push({ id: decision!.id, question: draft.question, answer: draft.answer });
  }
  return { proposed, notes };
}
