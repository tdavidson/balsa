/**
 * Test-only. A company whose Payroll item takes its amount from the model:
 * headcount[team] × salary[team] → payroll, payroll × 0.0765 → tax, item formula sum(payroll) + sum(tax).
 * Eng 3 × $10,000 and Sales 2 × $8,000 give $49,519 a month against a $1,000,000 receipt in the
 * first forecast month, so the seeded base runway is 20 months. Imports lazily so DB-less runs never connect.
 */
export async function seedModelCompany(name: string) {
  const { chartAccounts, companies, economicItems, forecastEntryTemplates, getDatabase } = await import("@finance/database");
  const { addMonths } = await import("@balsa/finance-engine");
  const { forecastAsOfMonth } = await import("./forecast-inputs");
  const { createDimension, createVariable } = await import("./forecast-model-store");
  const { refreshCurrentCalculationRun } = await import("./refresh-calculation-run");
  const db = getDatabase();
  const [company] = await db.insert(companies).values({ name: `${name} ${Date.now()}` }).returning({ id: companies.id });
  const companyId = company!.id;
  const [cash, payroll, revenue] = await db.insert(chartAccounts).values([
    { companyId, code: "1000", name: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
    { companyId, code: "6000", name: "Payroll", accountType: "expense", normalBalance: "debit" },
    { companyId, code: "4000", name: "Revenue", accountType: "revenue", normalBalance: "credit" },
  ]).returning({ id: chartAccounts.id });
  await db.insert(forecastEntryTemplates).values([
    { companyId, name: "Spend", itemType: "obligation", direction: "spend", debitAccountId: payroll!.id, creditAccountId: cash!.id },
    { companyId, name: "Receipts", itemType: "agreement", direction: "receipt", debitAccountId: cash!.id, creditAccountId: revenue!.id },
  ]);
  const asOfMonth = await forecastAsOfMonth(companyId, new Date());
  const firstMonth = addMonths(asOfMonth, 1);
  const byTeam = (eng: string, sales: string) => [{ coords: { team: "Eng" }, from: firstMonth, value: eng }, { coords: { team: "Sales" }, from: firstMonth, value: sales }];
  const team = await createDimension(companyId, { name: "team", items: ["Eng", "Sales"] });
  const headcount = await createVariable(companyId, { name: "headcount", kind: "number", dims: ["team"], formula: null, inputs: byTeam("3", "2") });
  const salary = await createVariable(companyId, { name: "salary", kind: "money", dims: ["team"], formula: null, inputs: byTeam("10000", "8000") });
  const payrollVariable = await createVariable(companyId, { name: "payroll", kind: "money", dims: ["team"], formula: "headcount * salary", inputs: [] });
  const tax = await createVariable(companyId, { name: "tax", kind: "money", dims: ["team"], formula: "payroll * 0.0765", inputs: [] });
  const [seed, payrollItem] = await db.insert(economicItems).values([
    { companyId, type: "agreement", direction: "receipt", label: "Seed round", amount: "1000000", cadence: "once", effectiveFrom: firstMonth, status: "confirmed" },
    { companyId, type: "obligation", direction: "spend", label: "Payroll", amountFormula: "sum(payroll) + sum(tax)", cadence: "monthly", effectiveFrom: firstMonth, category: "salary", status: "confirmed" },
  ]).returning({ id: economicItems.id });
  await refreshCurrentCalculationRun(companyId, { cause: { kind: "entity_changed", subjectType: "company", subjectId: companyId, actorUserId: null, via: "worker" } });
  return { companyId, asOfMonth, firstMonth, dimensionId: team.id, variableIds: { headcount: headcount.id, salary: salary.id, payroll: payrollVariable.id, tax: tax.id }, seedItemId: seed!.id, payrollItemId: payrollItem!.id, byTeam };
}
