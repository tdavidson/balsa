import {
  evaluateOperatingModel,
  type OperatingModel,
  type OperatingRun,
} from "./operating-model";
import {
  parseDecimal,
  formatDecimal,
  modelScale,
  multiplyDecimal,
  divideDecimal,
  decimalToMinorUnits,
} from "./forecast-model";
export const operatingSimulationVersion = "operating-simulation-2026-10-05.1";
export type OperatingUncertainty = {
  nodeId: string;
  from: string;
  low: string;
  high: string;
  group: string;
  inverse: boolean;
  rationale: string;
};
export type OperatingEntity = {
  id: string;
  name: string;
  cohort: string;
  nodeIds: string[];
};
export type OperatingValuation = {
  nodeId: string;
  annualDiscount: string;
  terminalMultiple: string;
  priceMinor: string;
  basis: string;
};
/** Seeded uniform ranks; shared groups couple assumptions within each world.
 * This is an assumed joint distribution, never a fitted empirical probability. */
export function sampleOperatingWorlds(
  model: OperatingModel,
  caseId: string,
  settings: {
    seed: number;
    count: number;
    parameters: OperatingUncertainty[];
    entities: OperatingEntity[];
  },
) {
  const initial = evaluateOperatingModel(model, caseId);
  if (
    !Number.isInteger(settings.seed) ||
    settings.seed < 0 ||
    settings.seed > 4294967295 ||
    !Number.isInteger(settings.count) ||
    settings.count < 16 ||
    settings.count > 64 ||
    settings.parameters.length < 1 ||
    settings.parameters.length > 8 ||
    new Set(settings.parameters.map((p) => p.nodeId)).size !==
      settings.parameters.length ||
    settings.entities.length > 12
  )
    throw new Error(
      "Use 16–64 paths, a 32-bit seed, and one to eight distinct uncertain inputs.",
    );
  for (const p of settings.parameters) {
    const low = parseDecimal(p.low),
      high = parseDecimal(p.high);
    if (
      model.nodes.find((n) => n.id === p.nodeId)?.op !== "input" ||
      !initial.months.includes(p.from) ||
      low === null ||
      high === null ||
      low > high ||
      !p.rationale.trim() ||
      p.group.length > 64
    )
      throw new Error(
        "Uncertainty requires existing inputs, ordered exact bounds and a stated basis.",
      );
  }
  const membership = new Set<string>();
  if (
    new Set(settings.entities.map((e) => e.id)).size !==
    settings.entities.length
  )
    throw new Error("Entity identities must be distinct.");
  for (const e of settings.entities) {
    if (!e.id || !e.name || !e.cohort || !e.nodeIds.length)
      throw new Error(
        "Entities need explicit identity, cohort and node membership.",
      );
    for (const id of e.nodeIds) {
      if (!model.nodes.some((n) => n.id === id) || membership.has(id))
        throw new Error(
          "Entity membership must be unambiguous and reference existing nodes.",
        );
      membership.add(id);
    }
  }
  let state = settings.seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return (n ^ (n >>> 14)) >>> 0;
  };
  const selected = model.cases.find((c) => c.id === caseId);
  const base: OperatingModel = {
    ...model,
    cases: [],
    nodes: model.nodes.map((n) => ({
      ...n,
      values:
        selected?.overrides.find((o) => o.nodeId === n.id)?.values ?? n.values,
    })),
  };
  const paths = Array.from({ length: settings.count }, (_, index) => {
    const groups = new Map<string, number>();
    const draws = settings.parameters.map((p) => {
      const key = p.group ? `shared:${p.group}` : `input:${p.nodeId}`;
      if (!groups.has(key)) groups.set(key, random());
      const rank = BigInt(
        p.inverse ? 4294967295 - groups.get(key)! : groups.get(key)!,
      );
      const value =
        parseDecimal(p.low)! +
        ((parseDecimal(p.high)! - parseDecimal(p.low)!) * rank) / 4294967295n;
      return {
        nodeId: p.nodeId,
        from: p.from,
        value: formatDecimal(value),
        rank: String(rank),
      };
    });
    const sampled: OperatingModel = {
      ...base,
      nodes: base.nodes.map((n) => {
        const draw = draws.find((d) => d.nodeId === n.id);
        return draw
          ? {
              ...n,
              basis: "user_assumption",
              values: [
                ...n.values.filter((v) => v.month < draw.from),
                { month: draw.from, value: draw.value },
              ],
            }
          : n;
      }),
    };
    try {
      const operating = evaluateOperatingModel(sampled);
      const entities = settings.entities.map((e) => ({
        ...e,
        cash: operating.months.map((month) => ({
          month,
          netMinor: String(
            operating.cash
              .filter((c) => c.month === month && e.nodeIds.includes(c.nodeId))
              .reduce(
                (sum, c) =>
                  sum +
                  (c.direction === "receipt" ? 1n : -1n) *
                    BigInt(c.amountMinor),
                0n,
              ),
          ),
        })),
      }));
      return {
        index,
        draws,
        model: sampled,
        status: "available" as const,
        operating,
        entities,
      };
    } catch (error) {
      return {
        index,
        draws,
        model: sampled,
        status: "unavailable" as const,
        reason:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Unsupported operating path",
      };
    }
  });
  return {
    formulaVersion: operatingSimulationVersion,
    settings,
    paths,
    notice:
      "Uniform ranges and shared rank groups are user assumptions. Shared groups have perfect positive or inverse rank coupling; no empirical correlation or likelihood is claimed. Each draw holds its input constant from the specified month.",
  };
}
export function valueOperatingPath(
  run: OperatingRun,
  valuation: OperatingValuation,
) {
  const annual = parseDecimal(valuation.annualDiscount),
    multiple = parseDecimal(valuation.terminalMultiple);
  if (
    annual === null ||
    annual < 0n ||
    annual > 5n * modelScale ||
    multiple === null ||
    multiple < 0n ||
    multiple > 100n * modelScale ||
    !run.values[valuation.nodeId] ||
    !valuation.basis.trim() ||
    !/^\d{1,18}$/.test(valuation.priceMinor)
  )
    throw new Error(
      "Valuation requires a cash-flow node, 0–500% annual discount, 0–100 terminal multiple and explicit cash-flow basis.",
    );
  const monthly = annual / 12n;
  let discount = modelScale,
    pv = 0n;
  const trace = run.months.map((month, i) => {
    discount = multiplyDecimal(discount, modelScale + monthly);
    const flow = parseDecimal(run.values[valuation.nodeId]![i]!)!;
    const terminal =
      i === run.months.length - 1 ? multiplyDecimal(flow * 12n, multiple) : 0n;
    const discounted = divideDecimal(flow + terminal, discount)!;
    pv += discounted;
    return {
      month,
      flow: formatDecimal(flow),
      terminal: formatDecimal(terminal),
      discountFactor: formatDecimal(discount),
      presentValue: formatDecimal(discounted),
    };
  });
  return {
    assumptions: valuation,
    valuationDate: `${run.months[0]}-01`,
    trace,
    presentValueMinor: String(decimalToMinorUnits(pv)),
    distanceFromPriceMinor: String(
      decimalToMinorUnits(pv) - BigInt(valuation.priceMinor),
    ),
    notice: `Valuation date ${run.months[0]}-01. End-of-month cash flows; nominal annual discount divided by 12; terminal value is final monthly cash flow × 12 × terminal multiple. Price matching does not identify unique beliefs.`,
  };
}
export function summarizeSampledAmounts(
  rows: { index: number; amountMinor: string }[],
  attempted: number,
  floorMinor: string,
) {
  const ordered = [...rows].sort((a, b) =>
    BigInt(a.amountMinor) < BigInt(b.amountMinor)
      ? -1
      : BigInt(a.amountMinor) > BigInt(b.amountMinor)
        ? 1
        : a.index - b.index,
  );
  const quantile = (data: typeof rows, p: number) =>
    data.length ? data[Math.floor((data.length - 1) * p)]! : null;
  const firstHalf = rows
    .filter((r) => r.index < Math.floor(attempted / 2))
    .sort((a, b) => (BigInt(a.amountMinor) < BigInt(b.amountMinor) ? -1 : 1));
  return {
    attempted,
    valid: rows.length,
    failed: attempted - rows.length,
    p05: quantile(ordered, 0.05),
    p50: quantile(ordered, 0.5),
    p95: quantile(ordered, 0.95),
    firstHalfMedian: quantile(firstHalf, 0.5),
    belowFloor: rows.filter((r) => BigInt(r.amountMinor) < BigInt(floorMinor))
      .length,
    groups: [
      {
        name: "Lower quarter",
        paths: ordered
          .slice(0, Math.ceil(ordered.length / 4))
          .map((r) => r.index),
      },
      {
        name: "Middle half",
        paths: ordered
          .slice(
            Math.ceil(ordered.length / 4),
            Math.ceil((ordered.length * 3) / 4),
          )
          .map((r) => r.index),
      },
      {
        name: "Upper quarter",
        paths: ordered
          .slice(Math.ceil((ordered.length * 3) / 4))
          .map((r) => r.index),
      },
    ],
    notice:
      rows.length !== attempted
        ? "Some paths failed. Quantiles summarize only supported paths; do not interpret their proportions as unconditional probabilities."
        : "Sample frequencies depend entirely on the stated assumptions. Quantile groups describe outcome bands, not discovered business regimes.",
  };
}
/** Spearman rank association with average ranks for ties. Diagnostic, not cause. */
export function operatingRankAssociation(
  points: { input: string; outputMinor: string }[],
) {
  if (points.length < 8) return null;
  const ranks = (values: bigint[]) =>
    values.map((v) => {
      const below = values.filter((x) => x < v).length,
        equal = values.filter((x) => x === v).length;
      return below + (equal - 1) / 2;
    });
  const x = ranks(points.map((p) => parseDecimal(p.input)!)),
    y = ranks(points.map((p) => BigInt(p.outputMinor))),
    mean = (points.length - 1) / 2;
  const xx = x.reduce((s, v) => s + (v - mean) ** 2, 0),
    yy = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  if (!xx || !yy) return null;
  return Number(
    (
      x.reduce((s, v, i) => s + (v - mean) * (y[i]! - mean), 0) /
      Math.sqrt(xx * yy)
    ).toFixed(4),
  );
}
