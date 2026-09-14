import type { AccountBalanceReconciliation } from "./account-reconciliation";
import type { LedgerReconciliation } from "./ledger-reconciliation";
import type { TrialBalance, TrialBalanceLine } from "./ledger";
import type { JournalStatements, StatementAccountLine } from "./statements";
import type { AllocationAnalysis } from "./allocation-analysis";

/** Increment when the journal-derived graph semantics change. */
export const journalCalculationFormulaVersion = "journal-ledger-2026-09-13.1";

export type JournalGraphVerificationStatus = "verified" | "unverified" | "exception";
export type JournalCalculationNode = {
  id: string;
  kind: "journal_line" | "account_balance" | "statement_line" | "statement_total" | "allocation" | "control" | "fx_rate" | "translation_reserve";
  month: string;
  label: string;
  formula: string;
  formulaVersion: string;
  value: string | boolean;
  inputNodeIds: string[];
  lineIds: string[];
  provenance: TrialBalanceLine["provenance"];
  verification: { status: JournalGraphVerificationStatus; reasons: string[] };
};

export type JournalCalculationGraph = {
  formulaVersion: string;
  period: string;
  nodes: JournalCalculationNode[];
  verificationStatus: JournalGraphVerificationStatus;
};

const safeKey = (value: string) => encodeURIComponent(value).replace(/%/g, "_");
const unique = <T,>(values: T[]) => [...new Set(values)];

function sourceVerification(line: TrialBalanceLine) {
  const sourced = line.provenance.length > 0 && line.provenance.every((entry) => entry.sourceId || entry.factId || entry.decisionId || entry.approvalEventId);
  return sourced
    ? { status: "verified" as const, reasons: [] }
    : { status: "unverified" as const, reasons: ["One or more posted journal lines lack source, fact, decision, or approval lineage."] };
}

function combine(nodes: JournalCalculationNode[], exceptionReasons: string[] = [], unverifiedReasons: string[] = []) {
  const reasons = unique([...nodes.flatMap((node) => node.verification.reasons), ...exceptionReasons, ...unverifiedReasons]);
  if (exceptionReasons.length || nodes.some((node) => node.verification.status === "exception")) return { status: "exception" as const, reasons };
  if (unverifiedReasons.length) return { status: "unverified" as const, reasons };
  if (nodes.some((node) => node.verification.status === "unverified")) return { status: "unverified" as const, reasons };
  return { status: "verified" as const, reasons };
}

function accountNodeId(line: TrialBalanceLine) {
  return `account_balance:${line.currency}:${safeKey(line.accountId)}:${safeKey(line.entityId ?? "consolidated")}`;
}

function statementNodeId(currency: string, section: string, line: StatementAccountLine) {
  return `statement_line:${currency}:${section}:${safeKey(line.key)}`;
}

/**
 * Builds an immutable, journal-native calculation graph. The graph consumes
 * only posted journals and explicit reconciliation reports: it never asks a
 * model to derive a figure or infer a match.
 */
export function buildJournalCalculationGraph(input: {
  period: string;
  trialBalance: TrialBalance;
  statements: JournalStatements;
  /** Actual views use these source controls; projected views deliberately do not pretend they reconcile to bank evidence yet. */
  ledgerReconciliation?: LedgerReconciliation;
  accountBalances?: AccountBalanceReconciliation[];
  view?: "actual" | "projected" | "scenario";
  asOfPeriod?: string;
  /** A sourced presentation-currency overlay, separate from functional books. */
  fxTranslation?: { presentationCurrency: string; status: "ready" | "blocked"; reasons: string[]; ctaMinor?: string; selections: Array<{ lineId: string; rateId: string; rateType: string }> };
  /** Approved allocation analysis is visible in the graph but never changes statements until posted as a balanced journal entry. */
  allocationAnalysis?: AllocationAnalysis;
}): JournalCalculationGraph {
  const nodes: JournalCalculationNode[] = [];
  const sourceNodeIds = new Map<string, string>();
  for (const line of input.trialBalance.lines) {
    const accountId = accountNodeId(line);
    for (const lineId of line.lineIds) {
      const id = `journal_line:${lineId}`;
      sourceNodeIds.set(lineId, id);
      nodes.push({ id, kind: "journal_line", month: input.period, label: `${line.accountCode} ${line.accountName}`, formula: "Posted journal line", formulaVersion: journalCalculationFormulaVersion, value: lineId, inputNodeIds: [], lineIds: [lineId], provenance: line.provenance, verification: sourceVerification(line) });
    }
    const inputs = line.lineIds.map((lineId) => sourceNodeIds.get(lineId)!).filter(Boolean);
    nodes.push({ id: accountId, kind: "account_balance", month: input.period, label: line.accountName, formula: "sum(posted_debits) − sum(posted_credits)", formulaVersion: journalCalculationFormulaVersion, value: line.netMinor, inputNodeIds: inputs, lineIds: line.lineIds, provenance: line.provenance, verification: combine(nodes.filter((node) => inputs.includes(node.id))) });
  }

  for (const statement of input.statements.byCurrency) {
    const sections: [string, StatementAccountLine[]][] = [
      ["revenue", statement.incomeStatement.revenue], ["expenses", statement.incomeStatement.expenses],
      ["assets", statement.balanceSheet.assets], ["liabilities", statement.balanceSheet.liabilities], ["equity", statement.balanceSheet.equity],
    ];
    for (const [section, lines] of sections) {
      for (const line of lines) {
        const inputNodeIds = input.trialBalance.lines.filter((trial) => trial.currency === statement.currency && line.accountIds.includes(trial.accountId)).map(accountNodeId);
        const dependencies = nodes.filter((node) => inputNodeIds.includes(node.id));
        nodes.push({ id: statementNodeId(statement.currency, section, line), kind: "statement_line", month: input.period, label: line.label, formula: "sum(mapped account balances with presentation sign)", formulaVersion: journalCalculationFormulaVersion, value: line.amountMinor, inputNodeIds, lineIds: line.lineIds, provenance: line.provenance, verification: combine(dependencies) });
      }
    }
    const total = (id: string, label: string, formula: string, value: string, inputNodeIds: string[], exceptionReasons: string[] = [], unverifiedReasons: string[] = []) => {
      const dependencies = nodes.filter((node) => inputNodeIds.includes(node.id));
      nodes.push({ id, kind: "statement_total", month: input.period, label, formula, formulaVersion: journalCalculationFormulaVersion, value, inputNodeIds, lineIds: unique(dependencies.flatMap((node) => node.lineIds)), provenance: dependencies.flatMap((node) => node.provenance), verification: combine(dependencies, exceptionReasons, unverifiedReasons) });
    };
    const ids = (section: string) => nodes.filter((node) => node.kind === "statement_line" && node.id.startsWith(`statement_line:${statement.currency}:${section}:`)).map((node) => node.id);
    total(`income_statement:net_income:${statement.currency}`, "Net income", "revenue − expenses", statement.incomeStatement.netIncomeMinor, [...ids("revenue"), ...ids("expenses")]);
    total(`balance_sheet:retained_earnings:${statement.currency}`, "Retained earnings", "cumulative revenue − cumulative expenses", statement.balanceSheet.retainedEarningsMinor, [...ids("revenue"), ...ids("expenses")]);
    total(`balance_sheet:assets:${statement.currency}`, "Total assets", "sum(asset statement lines)", statement.balanceSheet.totalAssetsMinor, ids("assets"));
    total(`balance_sheet:liabilities_and_equity:${statement.currency}`, "Total liabilities and equity", "liabilities + equity + retained earnings", statement.balanceSheet.totalLiabilitiesAndEquityMinor, [...ids("liabilities"), ...ids("equity")]);
    for (const workingCapital of statement.workingCapital ?? []) {
      const inputNodeIds = input.trialBalance.lines.filter((line) => line.currency === statement.currency && workingCapital.accountIds.includes(line.accountId)).map(accountNodeId);
      total(`working_capital:${statement.currency}:${safeKey(workingCapital.category)}`, `${workingCapital.category.replace(/_/g, " ")} roll-forward`, "closing working-capital balance − opening working-capital balance", workingCapital.changeMinor, inputNodeIds);
    }
    if (statement.cashFlow) {
      const cashInputs = (category: "operating" | "investing" | "financing") => statement.cashFlow!.entries.filter((entry) => entry.category === category).flatMap((entry) => entry.cashLineIds).map((lineId) => sourceNodeIds.get(lineId)).filter((id): id is string => Boolean(id));
      const inferredReasons = (category?: "operating" | "investing" | "financing") => statement.cashFlow!.entries.filter((entry) => entry.classification === "inferred" && (!category || entry.category === category)).map((entry) => `Cash-flow category for journal entry ${entry.entryId} is inferred; approve a chart-account cash-flow category to verify it.`);
      total(`cash_flow:operating:${statement.currency}`, "Cash from operating activities", "sum(cash journal entries with operating counterparts)", statement.cashFlow.operatingMinor, cashInputs("operating"), [], inferredReasons("operating"));
      total(`cash_flow:investing:${statement.currency}`, "Cash from investing activities", "sum(cash journal entries with investing counterparts)", statement.cashFlow.investingMinor, cashInputs("investing"), [], inferredReasons("investing"));
      total(`cash_flow:financing:${statement.currency}`, "Cash from financing activities", "sum(cash journal entries with financing counterparts)", statement.cashFlow.financingMinor, cashInputs("financing"), [], inferredReasons("financing"));
      total(`cash_flow:net_change:${statement.currency}`, "Net change in cash", "operating + investing + financing cash flow", statement.cashFlow.netChangeMinor, [`cash_flow:operating:${statement.currency}`, `cash_flow:investing:${statement.currency}`, `cash_flow:financing:${statement.currency}`], statement.cashFlow.unclassifiedEntryIds.length ? [`${statement.cashFlow.unclassifiedEntryIds.length} cash journal entr${statement.cashFlow.unclassifiedEntryIds.length === 1 ? "y is" : "ies are"} not classified for cash flow.`] : [], inferredReasons());
      nodes.push({ id: `control:cash_flow_tie:${statement.currency}`, kind: "control", month: input.period, label: `${statement.currency} cash-flow tie`, formula: "cash from operating + investing + financing − posted cash movement = 0", formulaVersion: journalCalculationFormulaVersion, value: (BigInt(statement.cashFlow.netChangeMinor) - BigInt(statement.cashFlow.cashMovementMinor)).toString(), inputNodeIds: [`cash_flow:net_change:${statement.currency}`, ...statement.cashFlow.entries.flatMap((entry) => entry.cashLineIds.map((lineId) => sourceNodeIds.get(lineId))).filter((id): id is string => Boolean(id))], lineIds: statement.cashFlow.entries.flatMap((entry) => entry.cashLineIds), provenance: [], verification: statement.cashFlow.ties ? { status: "verified", reasons: [] } : { status: "exception", reasons: [`${statement.currency} cash-flow sections do not equal posted cash movement.`] } });
    }
    nodes.push({ id: `control:balance_sheet:${statement.currency}`, kind: "control", month: input.period, label: `${statement.currency} balance-sheet equality`, formula: "total_assets − total_liabilities_and_equity = 0", formulaVersion: journalCalculationFormulaVersion, value: statement.balanceSheet.differenceMinor, inputNodeIds: [`balance_sheet:assets:${statement.currency}`, `balance_sheet:liabilities_and_equity:${statement.currency}`], lineIds: [], provenance: [], verification: statement.balanceSheet.balanced ? { status: "verified", reasons: [] } : { status: "exception", reasons: [`${statement.currency} assets do not equal liabilities plus equity.`] } });
  }
  for (const [currency, totals] of Object.entries(input.trialBalance.totals)) {
    nodes.push({ id: `control:trial_balance:${currency}`, kind: "control", month: input.period, label: `${currency} trial-balance equality`, formula: "total_debits − total_credits = 0", formulaVersion: journalCalculationFormulaVersion, value: totals.differenceMinor, inputNodeIds: input.trialBalance.lines.filter((line) => line.currency === currency).map(accountNodeId), lineIds: [], provenance: [], verification: totals.differenceMinor === "0" ? { status: "verified", reasons: [] } : { status: "exception", reasons: [`${currency} trial balance is not balanced.`] } });
  }
  if (input.ledgerReconciliation && input.accountBalances) {
    const accountExceptions = input.accountBalances.filter((account) => account.status !== "reconciled");
    nodes.push({ id: "control:account_reconciliation", kind: "control", month: input.period, label: "Account-balance reconciliation", formula: "every approved statement balance maps exactly to a ledger account", formulaVersion: journalCalculationFormulaVersion, value: accountExceptions.length === 0, inputNodeIds: input.accountBalances.flatMap((account) => account.accountIds).flatMap((accountId) => input.trialBalance.lines.filter((line) => line.accountId === accountId).map(accountNodeId)), lineIds: accountExceptions.flatMap((account) => account.sourceRowIds), provenance: [], verification: accountExceptions.length ? { status: "exception", reasons: [`${accountExceptions.length} account-balance reconciliation exception${accountExceptions.length === 1 ? " remains" : "s remain"}.`] } : { status: "verified", reasons: [] } });
    nodes.push({ id: "control:source_ledger_reconciliation", kind: "control", month: input.period, label: "Source-to-ledger reconciliation", formula: "approved source rows reconcile through actual cash into posted journal lines", formulaVersion: journalCalculationFormulaVersion, value: input.ledgerReconciliation.verificationStatus === "verified", inputNodeIds: input.ledgerReconciliation.sourceRows.flatMap((row) => row.journalLineIds.map((lineId) => sourceNodeIds.get(lineId))).filter((id): id is string => Boolean(id)), lineIds: input.ledgerReconciliation.sourceRows.flatMap((row) => row.journalLineIds), provenance: [], verification: input.ledgerReconciliation.verificationStatus === "verified" ? { status: "verified", reasons: [] } : { status: "exception", reasons: input.ledgerReconciliation.controls.reasons } });
    for (const cashTie of input.ledgerReconciliation.controls.cashToStatement) {
      const cashAccountInputs = input.trialBalance.lines
        .filter((line) => line.currency === cashTie.currency && /\bcash\b/i.test(`${line.statementLine ?? ""} ${line.accountName}`))
        .map(accountNodeId);
      const status = cashTie.status === "tied" ? "verified" as const : cashTie.status === "missing_statement" ? "unverified" as const : "exception" as const;
      const reason = cashTie.status === "tied"
        ? []
        : cashTie.status === "missing_statement"
          ? [`No approved bank statement ending balance is available to tie ${cashTie.currency} journal cash.`]
          : cashTie.status === "invalid_statement_amount"
            ? [`An approved bank statement ending balance for ${cashTie.currency} is not a valid amount.`]
            : [`${cashTie.currency} journal cash does not equal the approved bank statement ending balance.`];
      nodes.push({ id: `control:cash_to_statement:${cashTie.currency}`, kind: "control", month: input.period, label: `${cashTie.currency} cash-to-bank tie`, formula: "journal ending cash − approved bank-statement ending cash = 0", formulaVersion: journalCalculationFormulaVersion, value: cashTie.differenceMinor, inputNodeIds: cashAccountInputs, lineIds: [], provenance: [], verification: { status, reasons: reason } });
    }
  } else {
    const label = input.view === "scenario" ? "Scenario overlay" : "Forecast projection";
    nodes.push({ id: "control:projected_basis", kind: "control", month: input.period, label, formula: "actual entries through as-of period + approved projected entry overlays", formulaVersion: journalCalculationFormulaVersion, value: input.asOfPeriod ?? input.period, inputNodeIds: nodes.filter((node) => node.kind === "journal_line").map((node) => node.id), lineIds: nodes.filter((node) => node.kind === "journal_line").flatMap((node) => node.lineIds), provenance: [], verification: { status: "unverified", reasons: [`${label} uses approved assumptions and entries; it is not a bank-reconciled actual result.`] } });
  }
  if (input.fxTranslation) {
    const rateNodes: JournalCalculationNode[] = [];
    for (const selection of input.fxTranslation.selections) {
      const translatedLine = `journal_line:translation:${selection.lineId}`;
      const originalLine = `journal_line:${selection.lineId}`;
      const inputNodeIds = nodes.some((node) => node.id === translatedLine) ? [translatedLine] : nodes.some((node) => node.id === originalLine) ? [originalLine] : [];
      const node: JournalCalculationNode = { id: `fx_rate:${safeKey(selection.lineId)}:${safeKey(selection.rateId)}`, kind: "fx_rate", month: input.period, label: `${selection.rateType} FX rate ${selection.rateId}`, formula: "approved direct FX quote selected by currency, rate type, and effective date", formulaVersion: journalCalculationFormulaVersion, value: selection.rateId, inputNodeIds, lineIds: [selection.lineId], provenance: [], verification: input.fxTranslation.status === "ready" ? { status: "verified", reasons: [] } : { status: "exception", reasons: input.fxTranslation.reasons } };
      nodes.push(node); rateNodes.push(node);
    }
    if (input.fxTranslation.ctaMinor !== undefined) nodes.push({ id: `translation_reserve:cta:${input.fxTranslation.presentationCurrency}`, kind: "translation_reserve", month: input.period, label: "Cumulative translation adjustment", formula: "translated assets − translated liabilities and equity before CTA", formulaVersion: journalCalculationFormulaVersion, value: input.fxTranslation.ctaMinor, inputNodeIds: rateNodes.map((node) => node.id), lineIds: [], provenance: [], verification: combine(rateNodes, input.fxTranslation.status === "blocked" ? input.fxTranslation.reasons : []) });
    nodes.push({ id: `control:presentation_translation:${input.fxTranslation.presentationCurrency}`, kind: "control", month: input.period, label: `${input.fxTranslation.presentationCurrency} presentation translation`, formula: "all translated lines have an approved rate and CTA balances the presentation statement", formulaVersion: journalCalculationFormulaVersion, value: input.fxTranslation.status === "ready", inputNodeIds: rateNodes.map((node) => node.id), lineIds: input.fxTranslation.selections.map((selection) => selection.lineId), provenance: [], verification: input.fxTranslation.status === "ready" ? { status: "verified", reasons: [] } : { status: "exception", reasons: input.fxTranslation.reasons } });
  }
  if (input.allocationAnalysis) {
    for (const allocation of input.allocationAnalysis.lines) {
      nodes.push({ id: `allocation:${safeKey(allocation.allocationId)}`, kind: "allocation", month: allocation.period, label: `Allocation to ${allocation.bearerEntityId}`, formula: "approved allocation amount or originating spend × approved percentage", formulaVersion: journalCalculationFormulaVersion, value: allocation.amountMinor, inputNodeIds: [], lineIds: [], provenance: [{ ...(allocation.sourceId ? { sourceId: allocation.sourceId } : {}), ...(allocation.sourceLocation ? { sourceLocation: allocation.sourceLocation } : {}) }], verification: allocation.status === "ready" ? { status: "verified", reasons: [] } : { status: "exception", reasons: allocation.reasons } });
    }
    for (const control of input.allocationAnalysis.controls) {
      const inputs = input.allocationAnalysis.lines.filter((line) => line.eventId === control.eventId).map((line) => `allocation:${safeKey(line.allocationId)}`);
      nodes.push({ id: `control:allocation_total:${safeKey(control.eventId)}`, kind: "control", month: control.period, label: "Allocation-to-spend control", formula: "sum(approved allocation shares) ≤ originating spend", formulaVersion: journalCalculationFormulaVersion, value: control.unallocatedMinor, inputNodeIds: inputs, lineIds: [], provenance: [], verification: control.status === "reconciled" ? { status: "verified", reasons: [] } : { status: "exception", reasons: control.reasons } });
    }
  }
  const statuses = nodes.map((node) => node.verification.status);
  return { formulaVersion: journalCalculationFormulaVersion, period: input.period, nodes, verificationStatus: statuses.includes("exception") ? "exception" : statuses.includes("unverified") ? "unverified" : "verified" };
}
