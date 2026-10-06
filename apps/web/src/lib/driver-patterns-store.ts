import "server-only";
import { and, eq } from "drizzle-orm";
import { companies, economicItems, evidence, factRecords, forecastMetricActuals, forecastMetrics, forecastVariables, recordAudit, seasonalityProfiles } from "@finance/database";
import { describePattern, validateEscalation, validatePattern, validateSeasonality, type DriverPattern, type EscalationRule } from "@balsa/finance-engine";
import type { DbTransaction } from "@/lib/db-executor";
import { loadPatternContext } from "@/lib/forecast-inputs";

export class PatternInvalid extends Error {}
export class PatternNotFound extends Error {}

type Actor = { companyId: string; actorUserId: string | null; via: "ui" | "agent" };

/** References must name something in this company: a confirmed item, an operating metric or a model variable. */
async function assertReferences(tx: DbTransaction, companyId: string, pattern: DriverPattern, selfId?: string) {
  const change = pattern.change;
  if (!change || (change.basis !== "pct_of" && change.basis !== "per_unit")) return;
  const ref = change.ref;
  if (ref.kind === "driver") {
    if (ref.driverId === selfId) throw new PatternInvalid("A driver cannot be a percentage of itself.");
    const [item] = await tx.select({ id: economicItems.id }).from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.id, ref.driverId))).limit(1);
    if (!item) throw new PatternInvalid("The referenced driver is not in this company.");
  }
  if (ref.kind === "metric") {
    const [metric] = await tx.select({ id: forecastMetrics.id }).from(forecastMetrics).where(and(eq(forecastMetrics.companyId, companyId), eq(forecastMetrics.name, ref.name))).limit(1);
    const [variable] = metric ? [metric] : await tx.select({ id: forecastVariables.id }).from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), eq(forecastVariables.name, ref.name))).limit(1);
    if (!variable) throw new PatternInvalid(`No operating metric or model variable is named ${ref.name}.`);
  }
}

async function assertValid(tx: DbTransaction, companyId: string, pattern: DriverPattern, selfId?: string) {
  const context = (await loadPatternContext(companyId, tx)) ?? {};
  const error = validatePattern(pattern, context);
  if (error) throw new PatternInvalid(error);
  await assertReferences(tx, companyId, pattern, selfId);
}

/** Set or clear the pattern on an economic item. A pattern and a formula are exclusive. */
export async function setItemPatternWith(tx: DbTransaction, actor: Actor, itemId: string, pattern: DriverPattern | null) {
  const [item] = await tx.select().from(economicItems).where(and(eq(economicItems.companyId, actor.companyId), eq(economicItems.id, itemId))).limit(1);
  if (!item) throw new PatternNotFound("Economic item not found");
  if (pattern && item.amountFormula) throw new PatternInvalid("This driver has a formula. Clear the formula before giving it a pattern.");
  if (pattern) await assertValid(tx, actor.companyId, pattern, itemId);
  // A money pattern's starting value is also the item's displayed amount; a rate is not an amount.
  const money = pattern && pattern.change?.basis !== "pct_of" && pattern.change?.basis !== "per_unit";
  const [updated] = await tx.update(economicItems).set({ pattern, ...(money ? { amount: pattern!.initialValue } : {}), updatedAt: new Date() }).where(and(eq(economicItems.companyId, actor.companyId), eq(economicItems.id, itemId))).returning();
  await recordAudit(tx, { companyId: actor.companyId, actorUserId: actor.actorUserId, via: actor.via, action: "item.pattern_changed", entityType: "economic_item", entityId: itemId, summary: pattern ? `${item.label}: ${describePattern(pattern, undefined, { money: true })}` : `${item.label}: pattern removed`, before: { pattern: item.pattern }, after: { pattern } });
  return updated!;
}

export type MetricInput = { name: string; label: string; unit?: string | null | undefined; effectiveFrom: string; effectiveTo?: string | null | undefined; pattern: DriverPattern };

export async function saveMetricWith(tx: DbTransaction, actor: Actor, input: MetricInput, metricId?: string) {
  const existing = metricId ? (await tx.select().from(forecastMetrics).where(and(eq(forecastMetrics.companyId, actor.companyId), eq(forecastMetrics.id, metricId))).limit(1))[0] : undefined;
  if (metricId && !existing) throw new PatternNotFound("Operating metric not found");
  if (existing && existing.name !== input.name) throw new PatternInvalid("A metric's name is how drivers refer to it, so it cannot change. Change its label instead.");
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new PatternInvalid("The end month must come after the start month.");
  await assertValid(tx, actor.companyId, input.pattern);
  const [variable] = await tx.select({ id: forecastVariables.id }).from(forecastVariables).where(and(eq(forecastVariables.companyId, actor.companyId), eq(forecastVariables.name, input.name))).limit(1);
  if (variable) throw new PatternInvalid(`The forecast model already has a variable named ${input.name}.`);
  const values = { label: input.label, unit: input.unit ?? null, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, pattern: input.pattern, updatedAt: new Date() };
  try {
    const [row] = existing
      ? await tx.update(forecastMetrics).set(values).where(and(eq(forecastMetrics.companyId, actor.companyId), eq(forecastMetrics.id, existing.id))).returning()
      : await tx.insert(forecastMetrics).values({ companyId: actor.companyId, name: input.name, ...values }).returning();
    await recordAudit(tx, { companyId: actor.companyId, actorUserId: actor.actorUserId, via: actor.via, action: existing ? "metric.changed" : "metric.created", entityType: "forecast_metric", entityId: row!.id, summary: `${input.label} (${input.name}): ${describePattern(input.pattern)}`, before: existing ?? null, after: values });
    return row!;
  } catch (error) {
    if (error instanceof PatternInvalid) throw error;
    throw new PatternInvalid(`A metric named ${input.name} already exists.`);
  }
}

/** Remove a metric only when no driver or metric refers to it, so nothing loses its basis silently. */
export async function deleteMetricWith(tx: DbTransaction, actor: Actor, metricId: string) {
  const [metric] = await tx.select().from(forecastMetrics).where(and(eq(forecastMetrics.companyId, actor.companyId), eq(forecastMetrics.id, metricId))).limit(1);
  if (!metric) throw new PatternNotFound("Operating metric not found");
  const refers = (pattern: unknown) => { const change = (pattern as DriverPattern | null)?.change; return Boolean(change && (change.basis === "pct_of" || change.basis === "per_unit") && change.ref.kind === "metric" && change.ref.name === metric.name); };
  const items = (await tx.select({ label: economicItems.label, pattern: economicItems.pattern }).from(economicItems).where(eq(economicItems.companyId, actor.companyId))).filter((item) => refers(item.pattern));
  const metrics = (await tx.select({ label: forecastMetrics.label, pattern: forecastMetrics.pattern }).from(forecastMetrics).where(eq(forecastMetrics.companyId, actor.companyId))).filter((other) => refers(other.pattern));
  const users = [...items, ...metrics].map((row) => row.label);
  if (users.length) throw new PatternInvalid(`${metric.label} is used by ${users.slice(0, 3).join(", ")}${users.length > 3 ? ` and ${users.length - 3} more` : ""}. Change those first.`);
  await tx.delete(forecastMetrics).where(and(eq(forecastMetrics.companyId, actor.companyId), eq(forecastMetrics.id, metricId)));
  await recordAudit(tx, { companyId: actor.companyId, actorUserId: actor.actorUserId, via: actor.via, action: "metric.deleted", entityType: "forecast_metric", entityId: metricId, summary: `Removed the ${metric.label} metric`, before: metric });
}

export type MetricActualInput = { month: string; value: string | null; evidenceId?: string | null | undefined; factId?: string | null | undefined };

/**
 * Record, change or remove a metric's actual values. A value may cite an
 * evidence document or an approved fact in this company; a null value
 * removes that month. The forecast continues from the latest actual.
 */
export async function setMetricActualsWith(tx: DbTransaction, actor: Actor, metricRef: { id: string } | { name: string }, values: MetricActualInput[], decisionId?: string) {
  const [metric] = await tx.select().from(forecastMetrics).where(and(eq(forecastMetrics.companyId, actor.companyId), "id" in metricRef ? eq(forecastMetrics.id, metricRef.id) : eq(forecastMetrics.name, metricRef.name))).limit(1);
  if (!metric) throw new PatternNotFound("Operating metric not found");
  for (const value of values) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)) throw new PatternInvalid("Each actual needs a YYYY-MM month.");
    if (value.value !== null && !/^-?\d+(\.\d{1,6})?$/.test(value.value)) throw new PatternInvalid(`${value.month}: the value must be a number with up to six decimal places.`);
    if (value.evidenceId) { const [row] = await tx.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.companyId, actor.companyId), eq(evidence.id, value.evidenceId))).limit(1); if (!row) throw new PatternInvalid("The cited evidence is not in this company."); }
    if (value.factId) { const [row] = await tx.select({ id: factRecords.id, status: factRecords.status }).from(factRecords).where(and(eq(factRecords.companyId, actor.companyId), eq(factRecords.id, value.factId))).limit(1); if (!row) throw new PatternInvalid("The cited fact is not in this company."); if (row.status !== "approved") throw new PatternInvalid("Only an approved fact can supply an actual value; approve it first."); }
  }
  const before = await tx.select({ month: forecastMetricActuals.month, value: forecastMetricActuals.value }).from(forecastMetricActuals).where(eq(forecastMetricActuals.metricId, metric.id));
  for (const value of values) {
    if (value.value === null) { await tx.delete(forecastMetricActuals).where(and(eq(forecastMetricActuals.metricId, metric.id), eq(forecastMetricActuals.month, value.month))); continue; }
    const row = { value: value.value, evidenceId: value.evidenceId ?? null, factId: value.factId ?? null, decisionId: decisionId ?? null, createdByUserId: actor.actorUserId, updatedAt: new Date() };
    await tx.insert(forecastMetricActuals).values({ companyId: actor.companyId, metricId: metric.id, month: value.month, ...row }).onConflictDoUpdate({ target: [forecastMetricActuals.metricId, forecastMetricActuals.month], set: row });
  }
  const months = values.map((value) => value.month).sort();
  await recordAudit(tx, { companyId: actor.companyId, actorUserId: actor.actorUserId, via: actor.via, action: "metric.actuals_changed", entityType: "forecast_metric", entityId: metric.id, summary: `${metric.label}: ${values.length} actual value${values.length === 1 ? "" : "s"} recorded for ${months[0]}${months.length > 1 ? ` to ${months.at(-1)}` : ""}`, before: { actuals: before.filter((row) => months.includes(row.month)) }, after: { actuals: values, ...(decisionId ? { decisionId } : {}) } });
  return metric;
}

export async function saveSeasonalityWith(tx: DbTransaction, actor: Actor, input: { name: string; deviations: string[] }, profileId?: string) {
  const error = validateSeasonality({ id: profileId ?? "new", name: input.name, deviations: input.deviations });
  if (error) throw new PatternInvalid(error);
  const existing = profileId ? (await tx.select().from(seasonalityProfiles).where(and(eq(seasonalityProfiles.companyId, actor.companyId), eq(seasonalityProfiles.id, profileId))).limit(1))[0] : undefined;
  if (profileId && !existing) throw new PatternNotFound("Seasonality profile not found");
  try {
    const [row] = existing
      ? await tx.update(seasonalityProfiles).set({ name: input.name, deviations: input.deviations, updatedAt: new Date() }).where(and(eq(seasonalityProfiles.companyId, actor.companyId), eq(seasonalityProfiles.id, existing.id))).returning()
      : await tx.insert(seasonalityProfiles).values({ companyId: actor.companyId, name: input.name, deviations: input.deviations }).returning();
    await recordAudit(tx, { companyId: actor.companyId, actorUserId: actor.actorUserId, via: actor.via, action: existing ? "seasonality.changed" : "seasonality.created", entityType: "seasonality_profile", entityId: row!.id, summary: `${existing ? "Changed" : "Added"} the ${input.name} seasonality profile`, before: existing ?? null, after: input });
    return row!;
  } catch { throw new PatternInvalid(`A seasonality profile named ${input.name} already exists.`); }
}

export async function deleteSeasonalityWith(tx: DbTransaction, actor: Actor, profileId: string) {
  const [profile] = await tx.select().from(seasonalityProfiles).where(and(eq(seasonalityProfiles.companyId, actor.companyId), eq(seasonalityProfiles.id, profileId))).limit(1);
  if (!profile) throw new PatternNotFound("Seasonality profile not found");
  const uses = (pattern: unknown) => (pattern as DriverPattern | null)?.seasonalityProfileId === profileId;
  const users = [
    ...(await tx.select({ label: economicItems.label, pattern: economicItems.pattern }).from(economicItems).where(eq(economicItems.companyId, actor.companyId))),
    ...(await tx.select({ label: forecastMetrics.label, pattern: forecastMetrics.pattern }).from(forecastMetrics).where(eq(forecastMetrics.companyId, actor.companyId))),
  ].filter((row) => uses(row.pattern)).map((row) => row.label);
  if (users.length) throw new PatternInvalid(`${profile.name} is used by ${users.slice(0, 3).join(", ")}${users.length > 3 ? ` and ${users.length - 3} more` : ""}. Change those first.`);
  await tx.delete(seasonalityProfiles).where(and(eq(seasonalityProfiles.companyId, actor.companyId), eq(seasonalityProfiles.id, profileId)));
  await recordAudit(tx, { companyId: actor.companyId, actorUserId: actor.actorUserId, via: actor.via, action: "seasonality.deleted", entityType: "seasonality_profile", entityId: profileId, summary: `Removed the ${profile.name} seasonality profile`, before: profile });
}

export async function setDefaultEscalationWith(tx: DbTransaction, actor: Actor, rule: EscalationRule | null) {
  if (rule) { const error = validateEscalation(rule); if (error) throw new PatternInvalid(error); }
  const [company] = await tx.select({ escalation: companies.defaultEscalation }).from(companies).where(eq(companies.id, actor.companyId)).limit(1);
  await tx.update(companies).set({ defaultEscalation: rule, updatedAt: new Date() }).where(eq(companies.id, actor.companyId));
  const anchor = rule ? (rule.anchor === "driver_start" ? "from each driver's start" : `from month ${rule.anchor.calendarMonth}`) : "";
  await recordAudit(tx, { companyId: actor.companyId, actorUserId: actor.actorUserId, via: actor.via, action: "company.escalation_changed", entityType: "company", entityId: actor.companyId, summary: rule ? `Default escalation ${Number(rule.rate) * 100}% every ${rule.everyMonths} months ${anchor}` : "Removed the default escalation", before: { escalation: company?.escalation ?? null }, after: { escalation: rule } });
}
