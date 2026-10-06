"use client";
import { useId, useRef, useState } from "react";
import Link from "next/link";
import type { OperatingPlanInput } from "@balsa/finance-engine";
import type {
  OperatingPlanPreview,
  OperatingPlanWorkspace,
} from "@/lib/operating-plan-revisions";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./ui/select";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./ui/empty";
import { exactMoney } from "./opening-cash-review";
function ProposalTrace({ preview }: { preview: OperatingPlanPreview }) {
  const money = (n: string) => exactMoney(n, preview.currency);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Keep the current plan or review these future assumptions. Existing
        actuals and captured payment obligations are preserved.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Ending cash: current plan versus proposed revision
          </caption>
          <thead>
            <tr>
              {[
                "Month",
                "Period",
                "Keep current plan",
                "Proposed revision",
                "Difference",
              ].map((x) => (
                <th className="p-2" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.monthlyChanges.map((m) => (
              <tr key={m.month} className="border-t">
                <td className="p-2">{m.month}</td>
                <td className="p-2">{m.basis}</td>
                <td className="p-2 tabular-nums">{money(m.beforeMinor)}</td>
                <td className="p-2 tabular-nums">{money(m.afterMinor)}</td>
                <td className="p-2 tabular-nums">{money(m.deltaMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details open>
        <summary className="cursor-pointer text-sm">
          Assumptions and commitments
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {preview.inputs.map((i) => (
            <p key={`${i.nodeId}:${i.month}`}>
              {preview.model.nodes.find((n) => n.id === i.nodeId)?.label}:{" "}
              {i.value}{" "}
              {preview.model.nodes.find((n) => n.id === i.nodeId)?.unit} from{" "}
              {i.month}. {i.reason}
            </p>
          ))}
          <p>
            {preview.replacement.ended.length} uncommitted contributions
            replaced; {preview.replacement.additions.length} new contributions;{" "}
            {preview.replacement.retained.length} contributions retained.
          </p>
          {preview.commitments.map((c) => (
            <p key={c.id}>
              {c.label} · original month {c.originalMonth}, expected{" "}
              {c.expectedDate} · obligation {money(c.amountMinor)} · allocated{" "}
              {c.allocatedMinor === undefined
                ? "unavailable"
                : money(c.allocatedMinor)}{" "}
              · remaining{" "}
              {c.remainingMinor === undefined
                ? "unavailable"
                : money(c.remainingMinor)}{" "}
              · {c.state ?? c.status}. Preserved at version {c.version}.
            </p>
          ))}
          <Link className="underline" href="/reconciliation">
            Inspect payment reconciliation
          </Link>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm">
          Calculation trace and limitations
        </summary>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <p>
            {preview.replacement.formulaVersion} · operating formula{" "}
            {preview.path.operating.formulaVersion} · accounting formula{" "}
            {preview.path.forecast.formulaVersion}
          </p>
          {preview.limitations.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
          {preview.path.forecast.exceptions.map((e, i) => (
            <p key={i}>{e.reason}</p>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">
                Proposed operating calculation by metric and month
              </caption>
              <thead>
                <tr>
                  <th className="p-2">Metric / formula</th>
                  {preview.path.operating.months.map((m) => (
                    <th key={m} className="p-2">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.model.nodes.map((n) => (
                  <tr key={n.id} className="border-t">
                    <td className="p-2">
                      {n.label} ({n.unit}) ·{" "}
                      {n.op === "input"
                        ? "Dated assumption"
                        : `${n.op}(${n.args.join(", ")})`}
                    </td>
                    {preview.path.operating.values[n.id]?.map((v, i) => (
                      <td className="p-2 tabular-nums" key={i}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
export function OperatingPlanRevisions({
  companyId,
  reviewId,
  initialInputs = [],
}: {
  companyId: string;
  reviewId: string;
  initialInputs?: OperatingPlanInput[];
}) {
  const uid = useId(),
    request = useRef<{ fingerprint: string; key: string } | null>(null);
  const [workspace, setWorkspace] = useState<OperatingPlanWorkspace | null>(
      null,
    ),
    [preview, setPreview] = useState<OperatingPlanPreview | null>(null),
    [historical, setHistorical] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [inputs, setInputs] = useState<OperatingPlanInput[]>(initialInputs),
    [nodeId, setNodeId] = useState(""),
    [month, setMonth] = useState(""),
    [value, setValue] = useState(""),
    [inputReason, setInputReason] = useState(""),
    [name, setName] = useState(""),
    [reason, setReason] = useState(""),
    [ack, setAck] = useState(false);
  async function read(body?: object) {
    const response = await fetch(
      `/api/operating-plan-revisions${body ? "" : `?reviewId=${reviewId}`}`,
      body
        ? {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-company-id": companyId,
            },
            body: JSON.stringify(body),
          }
        : { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? "Unable to load plan revisions.");
    if (data.companyId !== companyId)
      throw new Error("Company selection changed. Reload this page.");
    return data;
  }
  async function run(
    action: "load" | "preview" | "save" | "reject",
    experimentId?: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "load") {
        const w: OperatingPlanWorkspace = await read();
        setWorkspace(w);
        setNodeId(w.model.nodes.find((n) => n.op === "input")?.id ?? "");
        setMonth(w.operating.months.find((m) => m >= w.forecastStart) ?? "");
        setName(`${w.model.name.slice(0, 85)} · revised plan`);
      } else if (action === "preview") {
        const data = await read({ action, reviewId, inputs });
        setPreview(data.preview);
        setHistorical(false);
        setAck(false);
      } else if (action === "save" && preview) {
        const body = {
          action,
          reviewId,
          inputs,
          name,
          reason,
          previewToken: preview.previewToken,
          acknowledgeCommitments: ack,
        };
        const fingerprint = JSON.stringify(body);
        if (request.current?.fingerprint !== fingerprint)
          request.current = { fingerprint, key: crypto.randomUUID() };
        await read({ ...body, requestKey: request.current.key });
        request.current = null;
        setHistorical(true);
        setWorkspace(await read());
        setNotice(
          "Proposal saved. Approve it in Decisions & outcomes to change the plan.",
        );
      } else if (action === "reject") {
        await read({ action, experimentId, reason });
        setWorkspace(await read());
        setNotice("Proposal rejected. The approved plan is unchanged.");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to update the proposal.",
      );
    } finally {
      setBusy(false);
    }
  }
  const field = (
    label: string,
    v: string,
    change: (v: string) => void,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <Field>
      <FieldLabel htmlFor={`${uid}-${label}`}>{label}</FieldLabel>
      <Input
        id={`${uid}-${label}`}
        value={v}
        onChange={(e) => change(e.target.value)}
        disabled={busy}
        {...props}
      />
    </Field>
  );
  const choice = (
    label: string,
    v: string,
    change: (v: string) => void,
    options: { id: string; label: string }[],
  ) => (
    <Field>
      <FieldLabel htmlFor={`${uid}-${label}`}>{label}</FieldLabel>
      <Select value={v} onValueChange={change} disabled={busy}>
        <SelectTrigger id={`${uid}-${label}`}>
          <SelectValue placeholder="Choose an option" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reconsider the plan</CardTitle>
        <CardDescription>
          Propose dated input changes from this review, compare the cash impact,
          then approve or reject the proposal.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run("load")}
        >
          {workspace ? "Refresh plan revisions" : "Propose a plan revision"}
        </Button>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Revision unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {workspace && (
          <>
            {workspace.blockedReason ? (
              <Alert>
                <AlertTitle>Proposal history only</AlertTitle>
                <AlertDescription>{workspace.blockedReason}</AlertDescription>
              </Alert>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setInputs((current) => [
                    ...current.filter(
                      (i) => i.nodeId !== nodeId || i.month !== month,
                    ),
                    { nodeId, month, value, reason: inputReason },
                  ]);
                  setPreview(null);
                  setAck(false);
                }}
              >
                <FieldGroup>
                  {choice(
                    "Input assumption",
                    nodeId,
                    setNodeId,
                    workspace.model.nodes
                      .filter((n) => n.op === "input")
                      .map((n) => ({
                        id: n.id,
                        label: `${n.label} (${n.unit})`,
                      })),
                  )}
                  {choice(
                    "Effective month",
                    month,
                    setMonth,
                    workspace.operating.months
                      .filter((m) => m >= workspace.forecastStart)
                      .map((m) => ({ id: m, label: m })),
                  )}
                  {field("Proposed value", value, setValue, {
                    required: true,
                    inputMode: "decimal",
                    pattern: "-?[0-9]{1,12}(\\.[0-9]{1,6})?",
                  })}
                  {field(
                    "Reason for this assumption",
                    inputReason,
                    setInputReason,
                    { required: true, maxLength: 240 },
                  )}
                  <FieldDescription>
                    A dated value continues until the next scheduled input.
                    Historical inputs stay unchanged; the table below shows the
                    resulting monthly calculation.
                  </FieldDescription>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={busy || !month || !nodeId || inputs.length >= 40}
                  >
                    Add input change
                  </Button>
                </FieldGroup>
              </form>
            )}
            {inputs.length > 0 && !workspace.blockedReason && (
              <>
                <ul className="flex flex-col gap-2 text-sm">
                  {inputs.map((i) => (
                    <li key={`${i.nodeId}:${i.month}`}>
                      {
                        workspace.model.nodes.find((n) => n.id === i.nodeId)
                          ?.label
                      }{" "}
                      · {i.month}: {i.value} · {i.reason}{" "}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setInputs(inputs.filter((x) => x !== i));
                          setPreview(null);
                          setAck(false);
                        }}
                      >
                        Remove change
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button disabled={busy} onClick={() => void run("preview")}>
                  Preview plan revision
                </Button>
              </>
            )}
            {preview && (
              <>
                <p className="text-sm font-medium">
                  {historical
                    ? "Preserved proposal — read only"
                    : "Proposed revision — not applied"}
                </p>
                <ProposalTrace preview={preview} />
                {!historical && !workspace.blockedReason && (
                  <FieldGroup>
                    {field("Proposal name", name, setName, { maxLength: 120 })}
                    {field("Decision rationale", reason, setReason, {
                      maxLength: 1000,
                    })}
                    <Field orientation="horizontal">
                      <Checkbox
                        id={`${uid}-confirm`}
                        checked={ack}
                        onCheckedChange={(v) => setAck(v === true)}
                        disabled={busy}
                      />
                      <FieldLabel htmlFor={`${uid}-confirm`}>
                        I reviewed the assumptions, retained commitments and
                        cash changes.
                      </FieldLabel>
                    </Field>
                    <Button
                      disabled={
                        busy ||
                        !ack ||
                        !name.trim() ||
                        !reason.trim() ||
                        !preview.path.changes.length ||
                        preview.path.forecast.exceptions.length > 0
                      }
                      onClick={() => void run("save")}
                    >
                      Save proposed revision
                    </Button>
                  </FieldGroup>
                )}
              </>
            )}
            <div className="flex flex-col gap-3">
              <p className="font-medium">Saved proposals</p>
              {workspace.proposals.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No proposals saved</EmptyTitle>
                    <EmptyDescription>
                      Preview a change to compare it with keeping the current
                      plan.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                workspace.proposals.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">
                      {p.name} ·{" "}
                      {p.status === "approved"
                        ? "Approved"
                        : p.status === "awaiting_approval"
                          ? "Awaiting approval"
                          : "Closed without approval"}
                    </span>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setPreview(p.snapshot.proposal);
                        setHistorical(true);
                        setAck(false);
                      }}
                    >
                      Inspect proposal
                    </Button>
                    {p.active === "Y" && (
                      <>
                        <Button asChild variant="outline">
                          <Link
                            href={`/goal-decisions?scenario=${p.scenarioId}`}
                          >
                            Review approval
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || !reason.trim()}
                          onClick={() => void run("reject", p.id)}
                        >
                          Reject proposal
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}
              {workspace.proposals.some((p) => p.active === "Y") &&
                field("Rejection reason", reason, setReason, {
                  maxLength: 1000,
                })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
