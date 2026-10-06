import { addMonths, patternAfterAmountChange, type DriverPattern, type ForecastDriver, type ForecastRunInput } from "@balsa/finance-engine";
import type { DecisionEffect } from "@/lib/decision-effects";
import { amountToMinor } from "@/lib/forecast-drivers";
import { emptyModel, withDimension, withVariable } from "@/lib/forecast-model-rows";

/** Pure, immutable projection shared by previews and scenario compatibility callers. */
export function projectDecisionEffect(input: ForecastRunInput, effect: DecisionEffect, decisionId: string): ForecastRunInput {
  if (effect.kind === "set_dimension") return { ...input, model: withDimension(input.model ?? emptyModel(), effect.dimension) };
  if (effect.kind === "set_variable") return { ...input, model: withVariable(input.model ?? emptyModel(), effect.variable) };
  if (effect.kind === "set_item_formula") return { ...input, drivers: input.drivers.map((driver) => driver.id === effect.itemId ? { ...driver, amountFormula: effect.amountFormula, decisionId } : driver) };
  if (effect.kind === "set_item_pattern") return { ...input, drivers: input.drivers.map((driver) => { if (driver.id !== effect.itemId) return driver; const { pattern: _previous, ...rest } = driver; void _previous; return effect.pattern ? { ...rest, pattern: effect.pattern as DriverPattern, decisionId } : { ...rest, decisionId }; }) };
  if (effect.kind === "set_metric") {
    const metrics = input.patterns?.metrics ?? [];
    const existing = metrics.find((metric) => metric.name === effect.metric.name);
    const next = { name: effect.metric.name, label: effect.metric.label, effectiveFrom: effect.metric.effectiveFrom, ...(effect.metric.effectiveTo ? { effectiveTo: effect.metric.effectiveTo } : {}), pattern: effect.metric.pattern as DriverPattern, ...(existing?.actuals ? { actuals: existing.actuals } : {}) };
    return { ...input, patterns: { ...input.patterns, metrics: [...metrics.filter((metric) => metric.name !== effect.metric.name), next].sort((left, right) => left.name.localeCompare(right.name)) } };
  }
  if (effect.kind === "set_metric_actuals") {
    const metrics = (input.patterns?.metrics ?? []).map((metric) => metric.name === effect.actuals.name ? { ...metric, actuals: { ...metric.actuals, ...Object.fromEntries(effect.actuals.values.map((value) => [value.month, value.value])) } } : metric);
    return { ...input, patterns: { ...input.patterns, metrics } };
  }
  if (effect.kind === "add_item" && !effect.scenario && effect.item.accountId && effect.item.cashAccountId) {
    // Mirrors ensurePostingTemplate: the decision approves a template for these accounts.
    const receipt = effect.item.direction === "receipt";
    const template = { id: `decision-template:${decisionId}`, itemType: receipt ? "agreement" as const : "obligation" as const, direction: effect.item.direction, category: `account:${effect.item.accountId}`, debitAccountId: receipt ? effect.item.cashAccountId : effect.item.accountId, creditAccountId: receipt ? effect.item.accountId : effect.item.cashAccountId, decisionId };
    const existing = input.templates.find((candidate) => candidate.itemType === template.itemType && candidate.direction === template.direction && candidate.debitAccountId === template.debitAccountId && candidate.creditAccountId === template.creditAccountId);
    const projected = projectDecisionEffectOnDrivers(input.drivers, effect, decisionId).map((driver) => driver.id === `decision:${decisionId}` ? { ...driver, templateId: existing?.id ?? template.id } : driver);
    return { ...input, templates: existing ? input.templates : [...input.templates, template], drivers: projected };
  }
  return { ...input, drivers: projectDecisionEffectOnDrivers(input.drivers, effect, decisionId) };
}

/**
 * What applying a decision would do to the base forecast's drivers, in memory.
 * Mirrors `applyDecisionEffect` in decision-effects.ts; the DB-backed parity
 * test in forecast-preview.test.ts fails if the two ever disagree.
 */
export function projectDecisionEffectOnDrivers(drivers: ForecastDriver[], effect: DecisionEffect, decisionId: string): ForecastDriver[] {
  if (effect.kind === "add_item") {
    if (effect.scenario) return drivers;
    const { item } = effect;
    return [...drivers, { id: `decision:${decisionId}`, label: item.label, itemType: item.direction === "spend" ? "obligation" : "agreement", direction: item.direction, category: item.category, ...(item.accountingTreatment !== "cash" ? { accountingTreatment: item.accountingTreatment } : {}), ...(item.recognitionStart ? { recognitionStart: item.recognitionStart } : {}), ...(item.recognitionEnd ? { recognitionEnd: item.recognitionEnd } : {}), amountMinor: amountToMinor(String(item.amount)), ...(item.amountFormula ? { amountFormula: item.amountFormula } : {}), cadence: item.cadence, effectiveFrom: item.effectiveFrom, ...(item.effectiveTo ? { effectiveTo: item.effectiveTo } : {}), ...(item.pattern ? { pattern: item.pattern as DriverPattern } : {}), decisionId }];
  }
  if (effect.kind === "end_item") return drivers.map((driver) => (driver.id === effect.itemId ? { ...driver, effectiveTo: effect.effectiveTo, decisionId } : driver));
  if (effect.kind === "change_amount") {
    const original = drivers.find((driver) => driver.id === effect.itemId);
    if (!original) return drivers;
    const { effectiveTo: _previousEnd, pattern: _previousPattern, ...copy } = original;
    void _previousEnd; void _previousPattern;
    const pattern = patternAfterAmountChange(original.pattern, effect.amount);
    return [...drivers.map((driver) => (driver.id === original.id ? { ...driver, effectiveTo: addMonths(effect.effectiveFrom, -1) } : driver)), { ...copy, id: `decision:${decisionId}`, amountMinor: amountToMinor(String(effect.amount)), ...(pattern ? { pattern } : {}), effectiveFrom: effect.effectiveFrom, decisionId }];
  }
  if (effect.kind === "set_category") return drivers.map((driver) => (driver.counterpartyEntityId === effect.entityId ? { ...driver, category: effect.category } : driver));
  if (effect.kind === "set_item_formula") return drivers.map((driver) => driver.id === effect.itemId ? { ...driver, amountFormula: effect.amountFormula, decisionId } : driver);
  return drivers;
}
