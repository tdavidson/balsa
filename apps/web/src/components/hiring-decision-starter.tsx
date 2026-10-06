"use client";
import { useState } from "react";
import type { OperatingModel } from "@balsa/finance-engine";
import { buildHiringDecision, hiringInputSchema } from "@/lib/hiring-decision";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
export function HiringDecisionStarter({ horizon, currency, disabled, onCreate }: { horizon: { start: string; end: string }; currency: string; disabled: boolean; onCreate: (model: OperatingModel) => void }) {
  const january = `${Number(horizon.start.slice(0, 4)) + (horizon.start.slice(5) > "01" ? 1 : 0)}-01`;
  const [values, setValues] = useState({ startMonth: january <= horizon.end ? january : horizon.start, hires: "2", annualSalary: "", benefitsPercent: "", recruitingPerHire: "", minimumCash: "" });
  const [error, setError] = useState("");
  return <Card><CardHeader><CardTitle>Can we afford to hire?</CardTitle><CardDescription>Enter your assumptions to compare hiring now, delaying, and keeping the current team. No compensation figures are filled in for you.</CardDescription></CardHeader><CardContent>
    <form onSubmit={event => { event.preventDefault(); const parsed = hiringInputSchema.safeParse({ ...values, hires: Number(values.hires) }); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the inputs."); return; } try { onCreate(buildHiringDecision(parsed.data, horizon, currency)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the hiring date."); } }}>
      <FieldGroup className="md:grid md:grid-cols-2">
        {([{ key: "startMonth", label: "Start month", type: "month" }, { key: "hires", label: "Additional hires", type: "number" }, { key: "annualSalary", label: `Annual salary per hire (${currency})`, type: "text" }, { key: "benefitsPercent", label: "Benefits and payroll burden (%)", type: "text" }, { key: "recruitingPerHire", label: `Recruiting and setup per hire (${currency})`, type: "text" }, { key: "minimumCash", label: `Minimum cash to retain (${currency})`, type: "text" }] as const).map(item => <Field key={item.key}><FieldLabel htmlFor={`hiring-${item.key}`}>{item.label}</FieldLabel><Input id={`hiring-${item.key}`} type={item.type} inputMode={item.type === "text" ? "decimal" : undefined} min={item.key === "startMonth" ? horizon.start : 1} max={item.key === "startMonth" ? horizon.end : undefined} required disabled={disabled} value={values[item.key]} onChange={event => setValues({ ...values, [item.key]: event.target.value })} /></Field>)}
        {error && <Alert variant="destructive"><AlertTitle>Check the hiring assumptions</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        <Button disabled={disabled} type="submit">Build hiring decision</Button>
      </FieldGroup>
    </form>
  </CardContent></Card>;
}
