import { addMonths } from "./periods";
import { divideHalfAwayFromZero, evaluateModel, modelScale, modelValueCap, multiplyDecimal, parseDecimal, roundDecimal, type ForecastModel } from "./forecast-model";
import { matchingForecastTemplates, type ForecastDriver, type ForecastEntryTemplate } from "./forecast-projections";

/**
 * The Standard Financial Model's forecasting drivers, as structured fields on a
 * Balsa driver. A pattern expands to `amountByMonth`, the same field formula
 * drivers fill, so projection, settlement, statements and scenarios are
 * unchanged. Arithmetic is in the model's scaled decimals and every money
 * period is rounded to cents, half away from zero, as a spreadsheet's ROUND does.
 */
export const driverPatternVersion = "driver-patterns-2026-10-06.1";

/** What a `pct_of` or `per_unit` driver multiplies. */
export type DriverRef =
  | { kind: "driver"; driverId: string }
  /** An operating metric, or a forecast model variable summed over its dimensions. */
  | { kind: "metric"; name: string }
  /** Every driver whose income or expense account is mapped to this Standard line, such as "revenue". */
  | { kind: "report_line"; line: string };

export type DriverChange =
  | { basis: "pct_change" | "abs_change" | "log_change"; everyMonths: number; by: string }
  | { basis: "pct_of" | "per_unit"; ref: DriverRef };

export type EscalationRule = { rate: string; everyMonths: number; anchor: "driver_start" | { calendarMonth: number } };

export type DriverPattern = {
  /** Money in major units; for `pct_of` the rate (0.04 is 4%), for `per_unit` the amount per unit. */
  initialValue: string;
  /** 1 every month, 3 quarterly, 12 annually; 0 once. */
  repeatsEveryMonths: number;
  change?: DriverChange;
  /** Stop after this many months from the start; absent or 0 means no limit beyond `effectiveTo`. */
  maxMonths?: number;
  /** Cap on any one period's amount, in major units. */
  maxValue?: string;
  seasonalityProfileId?: string;
  escalation?: "company" | EscalationRule;
  /** Set by a loader when a stored pattern could not be read, so the driver becomes an exception instead of silently changing. */
  unreadable?: true;
};

/** Twelve calendar-month deviations from an average month (January first); they sum to zero, so a year's total is unchanged. */
export type SeasonalityProfile = { id: string; name: string; deviations: string[] };
/** A forecast series that never posts: customers, headcount, units. Drivers reference it by name. */
export type OperatingMetric = { name: string; label?: string; effectiveFrom: string; effectiveTo?: string; pattern: DriverPattern };
export type PatternContext = { metrics?: OperatingMetric[]; seasonality?: SeasonalityProfile[]; escalation?: EscalationRule | null };
export type PatternException = { driverId: string; reason: string };

const maxPatternMonths = 600;
const zero = 0n;
const monthIndex = (month: string) => { const [year, number] = month.split("-").map(Number) as [number, number]; return year * 12 + number - 1; };
const toScaled = (minor: string) => BigInt(minor) * 10_000n;
const toMinor = (scaled: bigint) => divideHalfAwayFromZero(scaled, 10_000n);

/** Plain-language summary of a pattern, for editors and the agent. */
export function describePattern(pattern: DriverPattern, refLabel?: string, options: { money?: boolean } = {}): string {
  const amount = (text: string) => options.money ? `$${Number(text).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : text;
  const every = (months: number) => months === 1 ? "every month" : months === 12 ? "every year" : `every ${months} months`;
  const repeat = pattern.repeatsEveryMonths === 0 ? "once" : every(pattern.repeatsEveryMonths);
  const change = pattern.change;
  if (change?.basis === "pct_of") return `${Number(pattern.initialValue) * 100}% of ${refLabel ?? describeRef(change.ref)}, ${repeat}`;
  if (change?.basis === "per_unit") return `${amount(pattern.initialValue)} × ${(refLabel ?? describeRef(change.ref)).toLowerCase()}, ${repeat}`;
  const base = `${amount(pattern.initialValue)} ${repeat}`;
  if (change?.basis === "pct_change") return `${base}, changing ${Number(change.by) * 100}% ${every(change.everyMonths)}`;
  if (change?.basis === "abs_change") return `${base}, changing by ${amount(change.by)} ${every(change.everyMonths)}`;
  if (change?.basis === "log_change") return `${base}, growing logarithmically (exponent ${change.by}) ${every(change.everyMonths)}`;
  return base;
}
export const describeRef = (ref: DriverRef) => ref.kind === "driver" ? "another driver" : ref.kind === "metric" ? ref.name : `total ${ref.line.replace(/_/g, " ")}`;

/**
 * The pattern a driver keeps when a decision or scenario changes its amount
 * from some month: a growing amount restarts from the new amount; a "% of" or
 * "per unit" driver becomes the stated fixed amount, since a money amount is
 * not a rate. Undefined means the successor is a plain fixed-amount driver.
 */
export function patternAfterAmountChange(pattern: DriverPattern | undefined, amount: number): DriverPattern | undefined {
  if (!pattern || pattern.change?.basis === "pct_of" || pattern.change?.basis === "per_unit") return undefined;
  return { ...pattern, initialValue: amount.toFixed(2) };
}

/** Structural checks; the reason is shown on the driver. */
export function validatePattern(pattern: DriverPattern, context: PatternContext = {}): string | null {
  if (pattern.unreadable) return "The stored pattern could not be read; set the pattern again.";
  const whole = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;
  if (parseDecimal(pattern.initialValue) === null) return "The initial value must be a number with up to six decimal places.";
  if (!whole(pattern.repeatsEveryMonths, 0, 120)) return "Repeats every N months must be a whole number from 0 to 120.";
  if (pattern.maxMonths !== undefined && !whole(pattern.maxMonths, 0, maxPatternMonths)) return `For a maximum of N months must be a whole number from 0 to ${maxPatternMonths}.`;
  if (pattern.maxValue !== undefined && (parseDecimal(pattern.maxValue) ?? -1n) < 0n) return "The maximum value must be zero or more.";
  const change = pattern.change;
  if (change && (change.basis === "pct_change" || change.basis === "abs_change" || change.basis === "log_change")) {
    if (!whole(change.everyMonths, 1, 120)) return "Changes every N months must be a whole number from 1 to 120.";
    if (parseDecimal(change.by) === null) return "The change must be a number with up to six decimal places.";
    if (change.basis === "pct_change" && parseDecimal(change.by)! <= -modelScale) return "A percentage change must be above -100%.";
  }
  if (pattern.seasonalityProfileId && !(context.seasonality ?? []).some((profile) => profile.id === pattern.seasonalityProfileId)) return "The seasonality profile no longer exists.";
  const escalation = pattern.escalation === "company" ? context.escalation ?? null : pattern.escalation ?? null;
  if (pattern.escalation === "company" && !context.escalation) return "The driver uses the company escalation, but none is set.";
  if (escalation) { const error = validateEscalation(escalation); if (error) return error; }
  return null;
}

export function validateEscalation(rule: EscalationRule): string | null {
  if (parseDecimal(rule.rate) === null || parseDecimal(rule.rate)! <= -modelScale) return "The escalation rate must be a number above -100%.";
  if (!Number.isInteger(rule.everyMonths) || rule.everyMonths < 1 || rule.everyMonths > 120) return "The escalation cycle must be a whole number of months from 1 to 120.";
  if (rule.anchor !== "driver_start" && !(Number.isInteger(rule.anchor.calendarMonth) && rule.anchor.calendarMonth >= 1 && rule.anchor.calendarMonth <= 12)) return "The escalation anchor month must be from 1 to 12.";
  return null;
}

export function validateSeasonality(profile: SeasonalityProfile): string | null {
  if (profile.deviations.length !== 12) return "A seasonality profile needs twelve monthly values.";
  const values = profile.deviations.map(parseDecimal);
  if (values.some((value) => value === null || value <= -modelScale)) return "Each month must be a number above -100%.";
  const total = values.reduce<bigint>((sum, value) => sum + value!, zero);
  if (total !== zero) return `The twelve months must sum to zero so the year's total is unchanged; they sum to ${Number(total) / Number(modelScale) * 100}%.`;
  return null;
}

/** How many escalation steps have passed by `month` for a series that starts in `start`. */
export function escalationSteps(rule: EscalationRule, start: string, month: string) {
  if (rule.anchor === "driver_start") return Math.floor((monthIndex(month) - monthIndex(start)) / rule.everyMonths);
  // Boundaries fall on the anchor month and every cycle from it; count those after the start, up to the month.
  const base = Number(start.slice(0, 4)) * 12 + rule.anchor.calendarMonth - 1;
  const cycles = (index: number) => Math.floor((index - base) / rule.everyMonths);
  return Math.max(0, cycles(monthIndex(month)) - cycles(monthIndex(start)));
}

const power = (base: bigint, steps: number) => { let result = modelScale; for (let index = 0; index < steps; index += 1) result = multiplyDecimal(result, base); return result; };
/** n^p for a whole n ≥ 1 and a decimal exponent, rounded to the model's six places. */
function wholePower(n: number, exponent: bigint) {
  const value = Math.pow(n, Number(exponent) / Number(modelScale));
  if (!Number.isFinite(value) || value > Number(modelValueCap / modelScale)) throw new RangeError("log change grew past the model's value limit");
  return BigInt(Math.round(value * 1_000_000));
}

type Series = Map<string, bigint>;

/**
 * Values of one pattern for each month in `months`, in scaled decimals.
 * `reference` supplies the referenced series for `pct_of` and `per_unit`.
 * `money` rounds each period to cents.
 */
function expandPattern(pattern: DriverPattern, window: { effectiveFrom: string; effectiveTo?: string }, months: string[], context: PatternContext, money: boolean, reference?: Series): Series {
  const out: Series = new Map();
  const last = months.at(-1)!;
  if (window.effectiveFrom > last) { for (const month of months) out.set(month, zero); return out; }
  const span = monthIndex(last) - monthIndex(window.effectiveFrom);
  if (span > maxPatternMonths) throw new RangeError(`A pattern can run at most ${maxPatternMonths} months.`);
  const K = parseDecimal(pattern.initialValue)!;
  const M = pattern.repeatsEveryMonths;
  const change = pattern.change;
  const round = (value: bigint) => money ? roundDecimal(value, 2) : value;
  const cap = pattern.maxValue !== undefined ? parseDecimal(pattern.maxValue)! : null;
  const profile = pattern.seasonalityProfileId ? context.seasonality?.find((candidate) => candidate.id === pattern.seasonalityProfileId) : undefined;
  const escalation = pattern.escalation === "company" ? context.escalation ?? null : pattern.escalation ?? null;
  const rate = escalation ? modelScale + parseDecimal(escalation.rate)! : null;
  const base: bigint[] = [];
  for (let offset = 0; offset <= span; offset += 1) {
    const month = addMonths(window.effectiveFrom, offset);
    let value: bigint;
    if (change?.basis === "pct_of" || change?.basis === "per_unit") {
      const occurs = offset === 0 || (M > 0 && offset % M === 0);
      value = occurs ? multiplyDecimal(K, reference?.get(month) ?? zero) : zero;
    } else if (offset === 0) value = K;
    else if (change?.basis === "log_change") {
      const step = offset < change.everyMonths ? 1 : Number(divideHalfAwayFromZero(BigInt(offset) * modelScale + BigInt(change.everyMonths) * modelScale, BigInt(change.everyMonths) * modelScale));
      value = multiplyDecimal(K, wholePower(step, parseDecimal(change.by)!));
    } else {
      // Each occurrence carries the previous occurrence forward, changed on change months.
      const occurs = M > 0 && offset % M === 0;
      const previous = occurs ? base[offset - M]! : zero;
      const stepped = change && (change.basis === "pct_change" || change.basis === "abs_change") ? change : undefined;
      const changes = occurs && stepped !== undefined && offset % stepped.everyMonths === 0;
      value = !changes || !stepped ? previous
        : stepped.basis === "pct_change" ? multiplyDecimal(previous, modelScale + parseDecimal(stepped.by)!)
        : previous + parseDecimal(stepped.by)!;
    }
    value = round(value);
    base.push(value);
    let shaped = value;
    if (profile) shaped = multiplyDecimal(shaped, modelScale + parseDecimal(profile.deviations[Number(month.slice(5, 7)) - 1]!)!);
    if (escalation && rate !== null) shaped = multiplyDecimal(shaped, power(rate, escalationSteps(escalation, window.effectiveFrom, month)));
    shaped = round(shaped);
    if (cap !== null && shaped > cap) shaped = cap;
    if (pattern.maxMonths && offset >= pattern.maxMonths) shaped = zero;
    if (window.effectiveTo && month > window.effectiveTo) shaped = zero;
    if (shaped > modelValueCap || shaped < -modelValueCap) throw new RangeError("The pattern grew past the model's value limit.");
    out.set(month, shaped);
  }
  for (const month of months) if (!out.has(month)) out.set(month, zero);
  return out;
}

/** Fixed or formula driver amounts as a series, on the months its cadence emits. */
function plainSeries(driver: ForecastDriver, months: string[]): Series {
  const step = { once: 0, monthly: 1, quarterly: 3, annual: 12 }[driver.cadence];
  const out: Series = new Map();
  for (const month of months) {
    const offset = monthIndex(month) - monthIndex(driver.effectiveFrom);
    const emits = offset >= 0 && (!driver.effectiveTo || month <= driver.effectiveTo) && (offset === 0 || (step > 0 && offset % step === 0));
    const minor = driver.amountByMonth ? driver.amountByMonth[month] : driver.amountMinor;
    out.set(month, emits && minor && /^\d+$/.test(minor) ? toScaled(minor) : zero);
  }
  return out;
}

/** Any driver's amount per month in minor units: a resolved pattern or formula as resolved, a fixed amount on its cadence. */
export function driverAmountsByMonth(driver: ForecastDriver, months: string[]): Record<string, string> {
  if (driver.pattern && driver.amountByMonth) return Object.fromEntries(months.map((month) => [month, driver.amountByMonth![month] ?? "0"]));
  return Object.fromEntries([...plainSeries(driver, months).entries()].map(([month, value]) => [month, toMinor(value).toString()]));
}

/** The Standard line a driver posts to, through its template's income or expense account. */
function driverLine(driver: ForecastDriver, templates: ForecastEntryTemplate[], accountLines: Map<string, string>) {
  const matches = matchingForecastTemplates(driver, templates);
  if (matches.length !== 1) return undefined;
  const template = matches[0]!;
  return accountLines.get(driver.direction === "receipt" ? template.creditAccountId : template.debitAccountId);
}

/**
 * Resolve every patterned driver into `amountByMonth` over `months`, in
 * dependency order. Operating metrics resolve first as needed; a reference
 * that cannot be resolved, or a cycle, is an exception on the driver, which
 * then produces nothing. Drivers without a pattern pass through unchanged.
 */
export function resolvePatternDrivers(drivers: ForecastDriver[], input: { months: string[]; templates: ForecastEntryTemplate[]; accountLines?: Map<string, string>; model?: ForecastModel; context?: PatternContext; /** Also resolve metrics no driver references, for display. */ allMetrics?: boolean }): { drivers: ForecastDriver[]; exceptions: PatternException[]; metrics: Record<string, Record<string, string>>; metricExceptions: Record<string, string> } {
  const patterned = drivers.filter((driver) => driver.pattern);
  if (!patterned.length && !(input.allMetrics && input.context?.metrics?.length)) return { drivers, exceptions: [], metrics: {}, metricExceptions: {} };
  const months = input.months; const context = input.context ?? {};
  const byId = new Map(drivers.map((driver) => [driver.id, driver]));
  const metricByName = new Map((context.metrics ?? []).map((metric) => [metric.name, metric]));
  const accountLines = input.accountLines ?? new Map<string, string>();
  const exceptions: PatternException[] = [];
  const done = new Map<string, Series | Error>();
  const visiting = new Set<string>();
  let modelCubes: ReturnType<typeof evaluateModel> | null = null;

  const fail = (reason: string) => new Error(reason);
  const resolveKey = (key: string, describe: string): Series | Error => {
    const known = done.get(key); if (known) return known;
    if (visiting.has(key)) return fail(`It refers back to itself through ${describe}.`);
    visiting.add(key);
    let result: Series | Error;
    try { result = compute(key); } catch (error) { result = fail(error instanceof Error ? error.message : String(error)); }
    visiting.delete(key); done.set(key, result);
    return result;
  };
  const referenceSeries = (ref: DriverRef): Series | Error => {
    if (ref.kind === "driver") return byId.has(ref.driverId) ? resolveKey(`driver:${ref.driverId}`, "another driver") : fail("The referenced driver no longer exists.");
    if (ref.kind === "metric") return resolveKey(`metric:${ref.name}`, ref.name);
    return resolveKey(`line:${ref.line}`, `total ${ref.line.replace(/_/g, " ")}`);
  };
  const compute = (key: string): Series | Error => {
    const [kind, ...rest] = key.split(":"); const name = rest.join(":");
    if (kind === "driver") {
      const driver = byId.get(name)!;
      if (!driver.pattern) return plainSeries(driver, months);
      if (driver.amountFormula !== undefined) return fail("A driver can have a pattern or a formula, not both.");
      const invalid = validatePattern(driver.pattern, context); if (invalid) return fail(invalid);
      let reference: Series | undefined;
      const change = driver.pattern.change;
      if (change?.basis === "pct_of" || change?.basis === "per_unit") { const resolved = referenceSeries(change.ref); if (resolved instanceof Error) return fail(`Its reference could not be resolved: ${resolved.message}`); reference = resolved; }
      const series = expandPattern(driver.pattern, driver, months, context, true, reference);
      if ([...series.values()].some((value) => value < zero)) return fail("The pattern produces a negative amount in some month; use the other direction instead.");
      return series;
    }
    if (kind === "metric") {
      const metric = metricByName.get(name);
      if (metric) {
        const invalid = validatePattern(metric.pattern, context); if (invalid) return fail(`Metric ${name}: ${invalid}`);
        let reference: Series | undefined;
        const change = metric.pattern.change;
        if (change?.basis === "pct_of" || change?.basis === "per_unit") { const resolved = referenceSeries(change.ref); if (resolved instanceof Error) return fail(`Metric ${name}: ${resolved.message}`); reference = resolved; }
        return expandPattern(metric.pattern, metric, months, context, false, reference);
      }
      const variable = input.model?.variables.find((candidate) => candidate.name === name);
      if (!variable) return fail(`No operating metric or model variable is named ${name}.`);
      modelCubes ??= evaluateModel(input.model!, months);
      if (!modelCubes.ok) return fail(`The forecast model is invalid: ${modelCubes.errors[0]?.message ?? "unknown error"}`);
      const cube = modelCubes.cubes.get(name)!;
      return new Map(months.map((month, index) => { let total = zero; for (const row of cube.cells.values()) total += row[index] ?? zero; return [month, total]; }));
    }
    // A report line: the sum of every driver posting to it.
    const members = drivers.filter((driver) => driverLine(driver, input.templates, accountLines) === name);
    const total: Series = new Map(months.map((month) => [month, zero]));
    for (const member of members) {
      const series = resolveKey(`driver:${member.id}`, member.label);
      if (series instanceof Error) return fail(`${member.label}: ${series.message}`);
      for (const month of months) total.set(month, total.get(month)! + series.get(month)!);
    }
    return total;
  };

  const resolved = drivers.map((driver): ForecastDriver => {
    if (!driver.pattern) return driver;
    const series = resolveKey(`driver:${driver.id}`, driver.label);
    if (series instanceof Error) { exceptions.push({ driverId: driver.id, reason: series.message }); return driver; }
    // The pattern decides which months carry an amount, so every month may emit.
    return { ...driver, cadence: "monthly", amountByMonth: Object.fromEntries(months.map((month) => [month, toMinor(series.get(month)!).toString()])) };
  });
  const metricExceptions: Record<string, string> = {};
  if (input.allMetrics) for (const metric of context.metrics ?? []) { const series = resolveKey(`metric:${metric.name}`, metric.name); if (series instanceof Error) metricExceptions[metric.name] = series.message; }
  const metrics = Object.fromEntries([...done.entries()].filter(([key, value]) => key.startsWith("metric:") && !(value instanceof Error)).map(([key, value]) => [key.slice(7), Object.fromEntries([...(value as Series).entries()].map(([month, amount]) => [month, (Number(amount) / Number(modelScale)).toString()]))]));
  return { drivers: resolved, exceptions, metrics, metricExceptions };
}

