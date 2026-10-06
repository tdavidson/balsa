import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  evidence,
  getDatabase,
  operatingStudies,
  forecastSettlementAllocations,
  recordAudit,
  setCompanyScopeSql,
} from "@finance/database";
import {
  formatDecimal,
  addMonths,
  simulateConditionalOperatingPlan,
  planOperatingReplacement,
  type OperatingRun,
  operatingRankAssociation,
  calibrateOperatingMetric,
  sampleOperatingWorlds,
  summarizeSampledAmounts,
  valueOperatingPath,
  observeOperatingCash,
  type CalibrationSample,
  type KnownOperatingObservation,
} from "@balsa/finance-engine";
import {
  operatingStudyCommand,
  type OperatingStudySource,
  type OperatingStudyDefinition,
} from "./operating-studies-contract";
import { operatingHash as hash } from "./operating-connection-state";
import { captureOutlook, previewToken, GoalReviewError } from "./goal-reviews";
import { operatingObservationStateWith } from "./operating-outcomes";
import { operatingPredictionStateWith } from "./operating-plan-state";
import { runSimulation, type ScenarioChange } from "./scenario-changes";
import type { DbExecutor } from "./db-executor";
export async function operatingStudyContextWith(
  db: DbExecutor,
  companyId: string,
  source: OperatingStudySource,
  now: Date,
  historical = false,
) {
  const state =
    source.kind === "prediction"
      ? await operatingObservationStateWith(db, companyId, source.predictionId)
      : null;
  const owned =
    state && !historical
      ? await operatingPredictionStateWith(db, companyId, state.prediction, now)
      : null;
  const model =
    state?.prediction.snapshot.model ??
    (source.kind === "draft" ? source.model : null);
  if (!model) throw new GoalReviewError("Study model is unavailable.", 404);
  const base = await captureOutlook(db, companyId, now);
  if (
    source.kind === "draft" &&
    (model.startMonth < base.output.horizon.start ||
      addMonths(model.startMonth, model.months - 1) > base.output.horizon.end)
  )
    throw new GoalReviewError(
      "Draft studies must fit inside the current forecast horizon.",
      422,
    );
  const ids = [...new Set(model.nodes.flatMap((n) => n.evidenceIds))];
  const documents = ids.length
    ? await db
        .select({
          id: evidence.id,
          name: evidence.sourceName,
          status: evidence.status,
          sourceHash: evidence.sourceHash,
          updatedAt: evidence.updatedAt,
        })
        .from(evidence)
        .where(
          and(eq(evidence.companyId, companyId), inArray(evidence.id, ids)),
        )
        .orderBy(evidence.id)
    : [];
  if (documents.length !== ids.length)
    throw new GoalReviewError(
      "A study source is unavailable in this company.",
      404,
    );
  const observations: KnownOperatingObservation[] = state
    ? state.history.map((row) => {
        const d =
          row.definition as import("./operating-outcomes-contract").OperatingObservationDefinition;
        const node = model.nodes.find((n) => n.id === row.nodeId)!;
        const index = state.prediction.snapshot.operating.months.indexOf(
          row.month,
        );
        return {
          nodeId: row.nodeId,
          month: row.month,
          observationId: row.id,
          predicted:
            state.prediction.snapshot.operating.values[row.nodeId]?.[index] ??
            null,
          observed: d.withdrawn ? null : d.value,
          coverage: d.withdrawn ? "unavailable" : d.coverage,
          unit: node.unit,
          scope: d.scope,
          knownAt: row.createdAt.toISOString(),
          supersedesId: row.supersedesId,
        };
      })
    : [];
  return {
    companyId,
    source,
    model,
    caseId:
      state?.prediction.snapshot.operating.caseId ??
      (source.kind === "draft" ? source.caseId : "base"),
    base,
    documents,
    observations,
    observationEvidence: state
      ? state.history.map((r) => ({
          id: r.id,
          nodeId: r.nodeId,
          month: r.month,
          recordedAt: r.createdAt.toISOString(),
          definition:
            r.definition as import("./operating-outcomes-contract").OperatingObservationDefinition,
        }))
      : [],
    prediction: state?.prediction.snapshot ?? null,
    predictionId: state?.prediction.id ?? null,
    owned: owned
      ? {
          occurrences: owned.occurrences,
          itemsToken: owned.itemsToken,
          settlementToken: owned.settlementToken,
          documentsToken: owned.documentsToken,
        }
      : null,
    throughDate: now.toISOString().slice(0, 10),
  };
}
export type OperatingStudyContext = Awaited<
  ReturnType<typeof operatingStudyContextWith>
>;
export function operatingStudyFinancials(
  context: OperatingStudyContext,
  operating: OperatingRun,
) {
  try {
    if (
      context.model.outputs.some(
        (o) =>
          context.model.nodes.find((n) => n.id === o.nodeId)?.unit !==
          context.base.input.currency,
      )
    )
      throw new Error("Cash output units differ from the forecast currency.");
    let changes: ScenarioChange[];
    if (context.prediction) {
      const replacement = planOperatingReplacement(
        context.prediction.operating,
        operating,
        context.prediction.cashBindings,
        context.owned!.occurrences.flatMap((o) =>
          o.driverId ? [o.driverId] : [],
        ),
        context.base.output.horizon.start,
      );
      changes = [
        ...replacement.ended.map((b) => ({
          kind: "end_item" as const,
          itemId: b.driverId,
          effectiveTo: addMonths(context.base.output.horizon.start, -1),
        })),
        ...replacement.additions.map((c) => ({
          kind: "add_driver" as const,
          label: c.label,
          direction: c.direction,
          amount: Number(c.amountMinor) / 100,
          cadence: "once" as const,
          effectiveFrom: c.month,
          category: c.category,
        })),
      ];
    } else
      changes = operating.cash.map((c) => ({
        kind: "add_driver",
        label: c.label,
        direction: c.direction,
        amount: Number(c.amountMinor) / 100,
        cadence: "once",
        effectiveFrom: c.month,
        category: c.category,
      }));
    const { run } = runSimulation(context.base.input, changes);
    if (run.exceptions.length)
      throw new Error(
        "Financial calculations contain unsupported items. Inspect the current forecast before interpreting this path.",
      );
    return {
      status: "available" as const,
      run,
      changes,
      notice: context.prediction
        ? "Only owned, uncommitted future contributions are replaced in this current-outlook preview. Historical actuals and reviewed obligations are retained."
        : "Incremental hypothetical cash is added to the current outlook. Check overlap with existing forecasts. Nothing is applied.",
    };
  } catch (error) {
    return {
      status: "unavailable" as const,
      reason:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "This path cannot produce a supported financial forecast.",
    };
  }
}
async function previewWith(
  db: DbExecutor,
  companyId: string,
  definition: OperatingStudyDefinition,
  now: Date,
) {
  const context = await operatingStudyContextWith(
    db,
    companyId,
    definition.source,
    now,
    definition.kind === "calibration",
  );
  const finish = <T>(result: T) => {
    const payload = {
      schemaVersion: 1,
      companyId,
      definition,
      context,
      result,
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > 16_000_000)
      throw new GoalReviewError(
        "Study exceeds its preservation limit. Reduce paths, models or horizon before retrying.",
        422,
      );
    return {
      ...payload,
      previewToken: hash({
        ...payload,
        context: { ...context, base: previewToken(context.base) },
      }),
    };
  };
  if (definition.kind === "calibration") {
    const bindings = [
      {
        predictionId: definition.source.predictionId,
        nodeId: definition.binding.nodeId,
      },
      ...definition.binding.additionalVersions,
    ];
    if (new Set(bindings.map((b) => b.predictionId)).size !== bindings.length)
      throw new GoalReviewError(
        "Each prediction version may be bound once.",
        422,
      );
    const observationEvidence: {
      id: string;
      predictionId: string;
      month: string;
      definition: import("./operating-outcomes-contract").OperatingObservationDefinition;
    }[] = [];
    const samples: CalibrationSample[] = [],
      cashTiming: {
        predictionId: string;
        month: string;
        status: string;
        payments: { date: string; amountMinor: string; monthDelay: number }[];
      }[] = [];
    for (const binding of bindings) {
      const state = await operatingObservationStateWith(
        db,
        companyId,
        binding.predictionId,
      );
      observationEvidence.push(
        ...state.history
          .filter((r) => r.nodeId === binding.nodeId)
          .map((r) => ({
            id: r.id,
            predictionId: binding.predictionId,
            month: r.month,
            definition:
              r.definition as import("./operating-outcomes-contract").OperatingObservationDefinition,
          })),
      );
      const row = state.rows.find((r) => r.nodeId === binding.nodeId);
      if (!row || row.unit !== definition.binding.unit)
        throw new GoalReviewError(
          "Metric bindings must reference existing nodes with the same unit.",
          422,
        );
      const cash = row.cash
        ? observeOperatingCash(
            state.prediction.snapshot.cashBindings.filter(
              (b) => b.nodeId === row.nodeId,
            ),
            context.base.input.settlement!,
            context.base.input.currency,
          )
        : [];
      const allocationIds = cash.flatMap((c) =>
        c.payments.map((p) => p.allocationId),
      );
      const allocationTimes = allocationIds.length
        ? await db
            .select({
              id: forecastSettlementAllocations.id,
              createdAt: forecastSettlementAllocations.createdAt,
            })
            .from(forecastSettlementAllocations)
            .where(
              and(
                eq(forecastSettlementAllocations.companyId, companyId),
                inArray(forecastSettlementAllocations.id, allocationIds),
              ),
            )
        : [];
      for (const point of row.months) {
        const observed = state.history.find(
          (o) => o.id === point.observationId,
        );
        const paid = cash.find((c) => c.month === point.month);
        const immutableSettlement =
          paid?.occurrences.length &&
          paid.occurrences.every((o) => o.version === 1) &&
          !context.base.input.settlement?.allocations.some(
            (a) =>
              a.revoked &&
              paid.occurrences.some((o) => o.id === a.occurrenceId),
          );
        const knownCashAt =
          immutableSettlement &&
          paid?.payments.length &&
          paid.payments.every((p) =>
            allocationTimes.some((a) => a.id === p.allocationId),
          )
            ? paid.payments
                .map((p) =>
                  allocationTimes
                    .find((a) => a.id === p.allocationId)!
                    .createdAt.toISOString(),
                )
                .sort()
                .at(-1)!
            : `${context.throughDate}T23:59:59.999Z`;

        samples.push({
          predictionId: binding.predictionId,
          observationId: row.cash
            ? (paid?.payments[0]?.allocationId ?? null)
            : point.observationId,
          month: point.month,
          approvedAt: state.prediction.snapshot.approvedAt,
          predicted: point.predicted,
          observed: row.cash
            ? paid?.observedMinor
              ? formatDecimal(BigInt(paid.observedMinor) * 10000n)
              : null
            : point.observed,
          coverage: row.cash
            ? paid?.status === "settled"
              ? "complete"
              : "partial"
            : point.coverage,
          unit: row.unit,
          scope: row.cash
            ? definition.binding.scope
            : (point.definition?.scope ?? ""),
          knownAt: row.cash
            ? knownCashAt
            : (observed?.createdAt.toISOString() ?? null),
        });
        if (paid)
          cashTiming.push({
            predictionId: binding.predictionId,
            month: point.month,
            status: paid.status,
            payments: paid.payments.map((p) => ({
              ...p,
              monthDelay:
                (Number(p.date.slice(0, 4)) - Number(point.month.slice(0, 4))) *
                  12 +
                Number(p.date.slice(5, 7)) -
                Number(point.month.slice(5, 7)),
            })),
          });
      }
    }
    return finish({
      kind: "calibration" as const,
      report: calibrateOperatingMetric(
        samples,
        definition.binding,
        context.throughDate,
      ),
      cashTiming,
      observationEvidence,
      notice:
        "Metric identity, scope and aggregation are explicitly attested by this study's author; old observations do not acquire new metadata. Unrevised, unrevoked settled obligations use the last allocation's recorded time. Revised settlement histories conservatively use today's cutoff and cannot supply hindsight-free training outcomes.",
    });
  }
  if (definition.kind === "simulation") {
    const alternatives = [
      { name: "Selected model", model: context.model, caseId: context.caseId },
      ...definition.alternatives,
    ];
    const worlds = [];
    for (const alternative of alternatives) {
      if (
        alternative.model.startMonth !== context.model.startMonth ||
        alternative.model.months !== context.model.months
      )
        throw new GoalReviewError(
          "Structural alternatives must use the same modeled horizon.",
          422,
        );
      const ids = [
        ...new Set(alternative.model.nodes.flatMap((n) => n.evidenceIds)),
      ];
      if (ids.some((id) => !context.documents.some((d) => d.id === id)))
        throw new GoalReviewError(
          "Structural alternatives must reference sources already included in this study.",
          422,
        );
      let sampled;
      try {
        sampled = sampleOperatingWorlds(
          alternative.model,
          alternative.caseId,
          definition.settings,
        );
      } catch (error) {
        throw new GoalReviewError(
          error instanceof Error
            ? error.message
            : "Unsupported sampled assumptions.",
          422,
        );
      }
      const paths = sampled.paths.map((path) => {
        if (path.status !== "available") return path;
        const financial = operatingStudyFinancials(
          { ...context, model: alternative.model },
          path.operating,
        );
        let valuation = null;
        if (definition.valuation) {
          if (
            alternative.model.nodes.find(
              (n) => n.id === definition.valuation!.nodeId,
            )?.unit !== context.base.input.currency
          )
            throw new GoalReviewError(
              "The valuation cash-flow node must use the reporting currency.",
              422,
            );
          try {
            valuation = valueOperatingPath(
              path.operating,
              definition.valuation,
            );
          } catch {
            throw new GoalReviewError(
              "Check the valuation node, cash-flow basis, discount and terminal multiple.",
              422,
            );
          }
        }
        return { ...path, financial, valuation };
      });
      const amounts = paths.flatMap((path) =>
        path.status === "available" &&
        "financial" in path &&
        path.financial.status === "available"
          ? [
              {
                index: path.index,
                amountMinor: path.financial.run.months.at(-1)!.endingCashMinor,
              },
            ]
          : [],
      );
      const months = context.base.output.months.map((month) => ({
        month: month.month,
        basis: month.basis,
        summary: summarizeSampledAmounts(
          paths.flatMap((path) =>
            path.status === "available" &&
            "financial" in path &&
            path.financial.status === "available"
              ? [
                  {
                    index: path.index,
                    amountMinor: path.financial.run.months.find(
                      (m) => m.month === month.month,
                    )!.endingCashMinor,
                  },
                ]
              : [],
          ),
          definition.settings.count,
          definition.cashFloorMinor,
        ),
      }));
      const priceMatches = paths
        .flatMap((p) =>
          p.status === "available" &&
          "valuation" in p &&
          p.valuation &&
          p.financial.status === "available"
            ? [{ index: p.index, ...p.valuation }]
            : [],
        )
        .sort((a, b) => {
          const aa = BigInt(a.distanceFromPriceMinor),
            bb = BigInt(b.distanceFromPriceMinor);
          return (aa < 0n ? -aa : aa) < (bb < 0n ? -bb : bb) ? -1 : 1;
        })
        .slice(0, 5);
      const sensitivity = definition.settings.parameters.map((p) => ({
        nodeId: p.nodeId,
        rankAssociation: operatingRankAssociation(
          paths.flatMap((path) => {
            const amount = amounts.find((a) => a.index === path.index),
              draw = path.draws.find((d) => d.nodeId === p.nodeId);
            return amount && draw
              ? [{ input: draw.value, outputMinor: amount.amountMinor }]
              : [];
          }),
        ),
      }));
      worlds.push({
        sensitivity,
        name: alternative.name,
        model: alternative.model,
        caseId: alternative.caseId,
        formulaVersion: sampled.formulaVersion,
        notice: sampled.notice,
        paths,
        months,
        summary: summarizeSampledAmounts(
          amounts,
          definition.settings.count,
          definition.cashFloorMinor,
        ),
        priceMatches,
      });
    }
    return finish({ kind: "simulation" as const, worlds });
  }
  if (
    definition.mode === "observed" &&
    (!context.prediction ||
      definition.plan.startMonth <= context.prediction.approvedAt.slice(0, 7))
  )
    throw new GoalReviewError(
      "Observed comparisons require an approved prediction and decision months after its approval month.",
      422,
    );
  let operating;
  try {
    operating = simulateConditionalOperatingPlan(
      context.model,
      context.caseId,
      definition.plan,
      definition.mode,
      context.observations,
      context.throughDate,
    );
  } catch (error) {
    throw new GoalReviewError(
      error instanceof Error
        ? error.message.slice(0, 500)
        : "The conditional plan is invalid.",
      422,
    );
  }
  const financial = operatingStudyFinancials(context, operating.operating);
  return finish({ kind: "conditional" as const, operating, financial });
}
export type OperatingStudyPreview = Awaited<ReturnType<typeof previewWith>>;
export async function loadOperatingStudies(
  companyId: string,
  kind = "conditional",
) {
  const rows = await getDatabase()
    .select({
      id: operatingStudies.id,
      name: operatingStudies.name,
      predictionId: operatingStudies.predictionId,
      createdAt: operatingStudies.createdAt,
    })
    .from(operatingStudies)
    .where(
      and(
        eq(operatingStudies.companyId, companyId),
        eq(operatingStudies.kind, kind),
      ),
    )
    .orderBy(desc(operatingStudies.createdAt))
    .limit(30);
  return {
    companyId,
    studies: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}
export async function loadOperatingStudy(companyId: string, id: string) {
  const [row] = await getDatabase()
    .select()
    .from(operatingStudies)
    .where(
      and(
        eq(operatingStudies.companyId, companyId),
        eq(operatingStudies.id, id),
      ),
    );
  if (!row) throw new GoalReviewError("Operating study not found.", 404);
  return {
    companyId,
    id,
    name: row.name,
    snapshot: row.snapshot as OperatingStudyPreview,
    createdAt: row.createdAt.toISOString(),
  };
}
export async function executeOperatingStudy(
  companyId: string,
  raw: unknown,
  actorUserId: string | null,
  now = new Date(),
) {
  const parsed = operatingStudyCommand.safeParse(raw);
  if (!parsed.success)
    throw new GoalReviewError(
      "Invalid study request. Check the assumptions, bounds and confirmation.",
    );
  const command = parsed.data;
  return getDatabase().transaction(
    async (tx) => {
      await tx.execute(setCompanyScopeSql(companyId));
      if (command.action === "save") {
        await tx.execute(
          sql`select pg_advisory_xact_lock(7415,hashtext(${companyId}))`,
        );
        const [prior] = await tx
          .select()
          .from(operatingStudies)
          .where(
            and(
              eq(operatingStudies.companyId, companyId),
              eq(operatingStudies.requestKey, command.requestKey),
            ),
          );
        if (prior) {
          if (prior.requestHash !== hash(command))
            throw new GoalReviewError(
              "Request key already used for another study.",
              409,
            );
          return { companyId, id: prior.id };
        }
      }
      const preview = await previewWith(tx, companyId, command.definition, now);
      if (command.action === "preview") return { companyId, preview };
      if (command.previewToken !== preview.previewToken)
        throw new GoalReviewError(
          "Study assumptions, evidence or outlook changed. Preview again before preserving the study.",
          409,
        );
      if (Buffer.byteLength(JSON.stringify(preview)) > 16_000_000)
        throw new GoalReviewError(
          "This study exceeds its preservation limit.",
          422,
        );
      const [saved] = await tx
        .insert(operatingStudies)
        .values({
          companyId,
          kind: command.definition.kind,
          name: command.name,
          predictionId: preview.context.predictionId,
          snapshot: preview,
          requestKey: command.requestKey,
          requestHash: hash(command),
          actorUserId,
          createdAt: now,
        })
        .returning({ id: operatingStudies.id });
      await recordAudit(tx, {
        companyId,
        actorUserId,
        via: "ui",
        action: "operating_study.preserved",
        entityType: "operating_study",
        entityId: saved!.id,
        summary: `Preserved ${command.definition.kind} assumptions, evidence and calculations. No forecast changed.`,
        after: {
          predictionId: preview.context.predictionId,
          kind: command.definition.kind,
        },
      });
      return { companyId, id: saved!.id };
    },
    { isolationLevel: "repeatable read" },
  );
}
