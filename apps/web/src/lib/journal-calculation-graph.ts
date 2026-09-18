import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { calculationNodes, calculationRuns, getDatabase } from "@finance/database";
import { journalCalculationFormulaVersion, stableJson, type JournalCalculationGraph } from "@nevermodel/finance-engine";

/** Persist journal math separately from the legacy schedule/cash calculation engine. */
export async function persistJournalCalculationGraph(input: {
  companyId: string;
  financialStateRevision: string;
  graph: JournalCalculationGraph;
  input: unknown;
}) {
  const db = getDatabase();
  const inputJson = stableJson(input.input);
  const inputHash = createHash("sha256").update(inputJson).digest("hex");
  const verificationStatus = input.graph.verificationStatus;
  const inserted = await db.insert(calculationRuns).values({
    companyId: input.companyId,
    engineVersion: journalCalculationFormulaVersion,
    inputHash,
    financialStateRevision: input.financialStateRevision,
    asOfMonth: input.graph.period,
    horizonStart: input.graph.period,
    horizonEnd: input.graph.period,
    inputJson,
    outputJson: stableJson(input.graph),
    verificationStatus,
  }).onConflictDoNothing().returning({ id: calculationRuns.id, createdAt: calculationRuns.createdAt });
  const run = inserted[0] ?? (await db.select({ id: calculationRuns.id, createdAt: calculationRuns.createdAt }).from(calculationRuns).where(and(
    eq(calculationRuns.companyId, input.companyId),
    eq(calculationRuns.financialStateRevision, input.financialStateRevision),
    eq(calculationRuns.engineVersion, journalCalculationFormulaVersion),
    eq(calculationRuns.inputHash, inputHash),
  )).limit(1))[0];
  if (!run) throw new Error("Unable to create or locate journal calculation run");
  if (inserted[0]) await db.insert(calculationNodes).values(input.graph.nodes.map((node) => ({
    calculationRunId: run.id,
    nodeKey: node.id,
    kind: node.kind,
    month: node.month,
    label: node.label,
    formula: node.formula,
    formulaVersion: node.formulaVersion,
    valueJson: stableJson(node.value),
    inputNodeIds: stableJson(node.inputNodeIds),
    lineIds: stableJson(node.lineIds),
    provenance: stableJson(node.provenance),
    verificationStatus: node.verification.status,
    verificationReasons: stableJson(node.verification.reasons),
  })));
  return { id: run.id, createdAt: run.createdAt, inputHash, engineVersion: journalCalculationFormulaVersion, verificationStatus, reused: !inserted[0] };
}
