import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadJournalReport } from "@/lib/journal-ledger";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";
import { effectiveAsOfPeriod } from "@/lib/forecast-read";

const validMonth = (value: string | null): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const sections = ["revenue", "expenses", "income_statement", "assets", "liabilities", "equity", "balance_sheet", "cash_flow", "cash_to_bank"] as const;

/** One deterministic trace payload for a displayed statement figure. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url); const period = url.searchParams.get("period"); const section = url.searchParams.get("section");
  const key = url.searchParams.get("key") ?? undefined; const view = url.searchParams.get("view") ?? "projected"; const requestedAsOfPeriod = url.searchParams.get("asOfPeriod") ?? undefined; const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  if (!validMonth(period) || !sections.includes(section as typeof sections[number])) return NextResponse.json({ error: "period and valid statement section are required" }, { status: 400 });
  if (!(["actual", "projected", "scenario"] as string[]).includes(view)) return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  if (requestedAsOfPeriod && !validMonth(requestedAsOfPeriod)) return NextResponse.json({ error: "Invalid asOfPeriod" }, { status: 400 });
  if (view === "scenario" && !scenarioId) return NextResponse.json({ error: "scenario view requires scenarioId" }, { status: 400 });
  const selectedSection = section as typeof sections[number];
  if (selectedSection === "cash_to_bank" && view !== "actual") return NextResponse.json({ error: "cash_to_bank inspection is available only for actual periods" }, { status: 400 });
  // Projected/scenario views are anchored at the latest forecast's as-of month (see
  // withDerivedForecast in journal-ledger.ts); a forecast as-of after `period` is clamped
  // instead of rejecting the request, matching the reporting and calculations routes. A
  // caller-supplied asOfPeriod with no forecast anchoring still 400s as before.
  const { asOfPeriod: forecastAsOf, forecastAnchored } = await effectiveAsOfPeriod(context.company.id, view, requestedAsOfPeriod);
  if (!forecastAnchored && forecastAsOf && forecastAsOf > period) return NextResponse.json({ error: "Invalid asOfPeriod" }, { status: 400 });
  const asOfPeriod = forecastAnchored && forecastAsOf! > period ? period : forecastAsOf;
  const actualReconciliation = view === "actual" ? await loadJournalReconciliation(context.company.id, period) : null;
  const report = actualReconciliation ?? await loadJournalReport(context.company.id, period, undefined, { view: view as "actual" | "projected" | "scenario", ...(asOfPeriod ? { asOfPeriod } : {}), ...(scenarioId ? { scenarioId } : {}) });
  const { statements, trialBalance } = actualReconciliation ?? report;
  const currency = statements.byCurrency.find((item) => item.currency === context.company.baseCurrency) ?? statements.byCurrency[0];
  if (!currency) return NextResponse.json({ period, section, key, lines: [], accounts: [], verification: "unverified_no_posted_entries", verificationReasons: ["No posted journal entries are available for this period."] });
  const cashAccounts = trialBalance.lines.filter((line) => /\bcash\b/i.test(`${line.statementLine ?? ""} ${line.accountName}`));
  const lines = selectedSection === "cash_to_bank"
    ? actualReconciliation!.report.controls.cashToStatement.flatMap((tie) => [
      { key: `${tie.currency}:journal`, label: `${tie.currency} journal ending cash`, amountMinor: tie.journalCashMinor, accountIds: cashAccounts.filter((account) => account.currency === tie.currency).map((account) => account.accountId), lineIds: cashAccounts.filter((account) => account.currency === tie.currency).flatMap((account) => account.lineIds), provenance: [] },
      { key: `${tie.currency}:bank`, label: `${tie.currency} approved bank ending cash`, amountMinor: tie.statementCashMinor, accountIds: [], lineIds: [], provenance: [] },
      { key: `${tie.currency}:difference`, label: `${tie.currency} cash-to-bank difference`, amountMinor: tie.differenceMinor, accountIds: [], lineIds: [], provenance: [] },
    ])
    : selectedSection === "cash_flow" ? [{ key: "net_change", label: "Net change in cash", amountMinor: currency.cashFlow?.netChangeMinor ?? "0", accountIds: [], lineIds: currency.cashFlow?.entries.flatMap((entry) => entry.cashLineIds) ?? [], provenance: [] }]
    : selectedSection === "income_statement" ? [...currency.incomeStatement.revenue, ...currency.incomeStatement.expenses, { key: "net_income", label: "Net income", amountMinor: currency.incomeStatement.netIncomeMinor, accountIds: [], lineIds: [], provenance: [] }]
    : selectedSection === "balance_sheet" ? [...currency.balanceSheet.assets, ...currency.balanceSheet.liabilities, ...currency.balanceSheet.equity, { key: "retained_earnings", label: "Retained earnings", amountMinor: currency.balanceSheet.retainedEarningsMinor, accountIds: [], lineIds: [], provenance: [] }, { key: "unclosed_earnings", label: "Unclosed earnings", amountMinor: currency.balanceSheet.unclosedEarningsMinor ?? "0", accountIds: [], lineIds: [], provenance: [] }]
    : selectedSection === "revenue" ? currency.incomeStatement.revenue : selectedSection === "expenses" ? currency.incomeStatement.expenses : selectedSection === "assets" ? currency.balanceSheet.assets : selectedSection === "liabilities" ? currency.balanceSheet.liabilities : currency.balanceSheet.equity;
  const selected = key ? lines.filter((line) => line.key === key) : lines;
  const accountIds = [...new Set(selected.flatMap((line) => line.accountIds))];
  const accounts = trialBalance.lines.filter((line) => accountIds.includes(line.accountId)).map((line) => ({ accountId: line.accountId, accountCode: line.accountCode, accountName: line.accountName, netMinor: line.netMinor, lineIds: line.lineIds, provenance: line.provenance }));
  const verification = view === "actual" ? actualReconciliation!.authority.eligible ? "verified" : "unverified" : "unverified_projection";
  const verificationReasons = view === "actual" ? actualReconciliation!.authority.blockers : ["Projected entries are approved assumptions and are not bank-reconciled actual results."];
  return NextResponse.json({ period, section, key: key ?? null, lines: selected, accounts, verification, verificationReasons, formula: section === "cash_to_bank" ? "journal ending cash − approved bank-statement ending cash = 0" : section === "cash_flow" ? "sum(classified posted cash movements)" : section === "income_statement" ? "revenue − expenses = net income from posted journal lines" : section === "balance_sheet" ? "assets = liabilities + equity from cumulative posted journal balances" : "sum(mapped posted journal account balances with presentation sign)" });
}
