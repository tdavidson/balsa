import { z } from "zod";
import { addMonths, decimalToMinorUnits, parseDecimal, type OperatingModel, type OperatingNode } from "@balsa/finance-engine";
const amount = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a nonnegative amount with up to two decimal places.");
export const hiringInputSchema = z.object({
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  hires: z.number().int().min(1).max(1000), annualSalary: amount.refine(v => Number(v) > 0, "Enter annual compensation."),
  benefitsPercent: amount.refine(v => Number(v) <= 100, "Use a percentage from 0 to 100."), recruitingPerHire: amount,
  minimumCash: amount,
});
export function buildHiringDecision(raw: unknown, horizon: { start: string; end: string }, currency: string): OperatingModel {
  const v = hiringInputSchema.parse(raw);
  if (v.startMonth < horizon.start || v.startMonth > horizon.end) throw new Error("Choose a hiring date inside the forecast horizon.");
  const monthsBetween = (a: string, b: string) => (Number(b.slice(0,4)) - Number(a.slice(0,4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));
  const months = Math.min(12, monthsBetween(v.startMonth, horizon.end) + 1);
  const input = (id: string, label: string, unit: string, value: string): OperatingNode => ({ id, label, unit, op: "input", args: [], values: [{ month: v.startMonth, value }], initial: null, basis: "user_assumption", evidenceIds: [], rationale: "Entered for this decision; confirm against compensation plans and source documents before approval." });
  const calc = (id: string, label: string, unit: string, op: OperatingNode["op"], args: string[], rationale: string, initial: string | null = null): OperatingNode => ({ id, label, unit, op, args, values: [], initial, evidenceIds: [], rationale });
  const delayed = addMonths(v.startMonth, 3);
  return {
    name: `Hire ${v.hires} people`, description: `Can we afford ${v.hires} new hires from ${v.startMonth}, while preserving our minimum cash?`, startMonth: v.startMonth, months,
    decision: { question: `Can we afford ${v.hires} new hires from ${v.startMonth}?`, deadline: null, constraints: ["Maintain the minimum cash balance", "Exclude costs already in the approved forecast"], caseId: "base", compareCaseId: "__unchanged__", metric: "minimum_cash", cashFloorMinor: String(decimalToMinorUnits(parseDecimal(v.minimumCash)!)), ranges: [] },
    nodes: [
      input("hires", "Additional headcount", "people", String(v.hires)), input("annual_salary", "Annual salary per hire", currency, v.annualSalary), input("benefits_percent", "Benefits and payroll burden", "percent", v.benefitsPercent), input("recruiting_per_hire", "Recruiting and setup per hire", currency, v.recruitingPerHire),
      { ...input("months_per_year", "Months per year", "months", "12"), rationale: "Calendar conversion: twelve months per year." },
      { ...input("percent_scale", "Percentage denominator", "number", "100"), rationale: "Percentage conversion: divide by one hundred." },
      calc("monthly_salary", "Monthly salary per hire", currency, "divide", ["annual_salary", "months_per_year"], "Annual compensation divided by twelve."),
      calc("payroll", "Additional salaries", currency, "multiply", ["hires", "monthly_salary"], "Additional headcount multiplied by monthly salary."),
      calc("benefit_rate", "Benefits rate", "number", "divide", ["benefits_percent", "percent_scale"], "Convert the percentage to a rate."),
      calc("benefits", "Additional benefits", currency, "multiply", ["payroll", "benefit_rate"], "Apply benefits and payroll burden to salaries."),
      calc("loaded_payroll", "Salaries and benefits", currency, "add", ["payroll", "benefits"], "Recurring incremental compensation paid monthly."),
      calc("prior_hires", "Prior month headcount", "people", "lag", ["hires"], "Start with no additional hires before this decision.", "0"),
      calc("new_hires", "Hires starting this month", "people", "subtract", ["hires", "prior_hires"], "Recruiting costs occur once per new hire."),
      calc("recruiting", "Recruiting and setup", currency, "multiply", ["new_hires", "recruiting_per_hire"], "New hires multiplied by recruiting and setup cost per hire."),
    ],
    outputs: [{ nodeId: "loaded_payroll", label: "Additional salaries and benefits", direction: "spend", category: "salary" }, { nodeId: "recruiting", label: "Recruiting and setup", direction: "spend", category: "other" }],
    cases: [
      ...(months > 3 ? [{ id: "delay", name: "Hire three months later", rationale: "Keep the same compensation assumptions but postpone the start.", overrides: [{ nodeId: "hires", values: [{ month: v.startMonth, value: "0" }, { month: delayed, value: String(v.hires) }] }] }] : []),
      { id: "no_hire", name: "Do not hire", rationale: "No additional compensation or recruiting spend.", overrides: [{ nodeId: "hires", values: [{ month: v.startMonth, value: "0" }] }] },
    ],
    limitations: ["User assumptions, not approved compensation facts. Attach and review supporting evidence.", "Full-month salaries and benefits; no proration, raises, bonuses, attrition, severance, or contribution to revenue is assumed.", "Recruiting and setup are paid in the start month. Adjust the relationships if payment timing differs.", "Only incremental costs belong here. Check for overlap with existing payroll and planned hires.", "Costs continue in reality beyond this model's horizon. This scenario includes only the displayed months."],
  };
}
