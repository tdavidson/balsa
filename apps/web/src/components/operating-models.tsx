"use client";
import {OperatingStudies} from "./operating-studies";
import {
  OperatingDecisionForm,
  OperatingDecisionResults,
  defaultOperatingDecision,
} from "./operating-decision";
import { OperatingRelationships } from "./operating-relationships";
import { OperatingOutcomes } from "./operating-outcomes";
import { OperatingConnections } from "./operating-connections";
import { useRef, useState } from "react";
import Link from "next/link";
import type { OperatingModel } from "@balsa/finance-engine";
import type {
  loadOperatingWorkspace,
  OperatingPreview,
} from "@/lib/operating-models";
import { operatingModelSchema } from "@/lib/operating-model-contract";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exactMoney as money } from "./opening-cash-review";
type Workspace = Awaited<ReturnType<typeof loadOperatingWorkspace>>;
const formula = (node: OperatingModel["nodes"][number]) =>
  node.op === "input"
    ? "Dated assumption"
    : node.op === "lag"
      ? `Previous month’s ${node.args[0]} (starts at ${node.initial})`
      : node.op === "if"
        ? `If ${node.args[0]}, use ${node.args[1]}; otherwise ${node.args[2]}`
        : `${node.op}(${node.args.join(", ")})`;

export function OperatingModels({
  company,
  initialData,
  initialError,
}: {
  company: { id: string; name: string; currency: string };
  initialData: Workspace | null;
  initialError: string;
}) {
  const [workspace, setWorkspace] = useState(initialData);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<OperatingModel | null>(null);
  const [preview, setPreview] = useState<OperatingPreview | null>(null);
  const [selectedCase, setSelectedCase] = useState("base");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [definition, setDefinition] = useState("");
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  async function read<T>(url: string, body?: object): Promise<T> {
    const response = await fetch(
      url,
      body
        ? {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-company-id": company.id,
            },
            body: JSON.stringify(body),
          }
        : { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Unable to complete this operation.");
    if (result.companyId !== company.id)
      throw new Error("Company selection changed. Reload this page.");
    return result;
  }
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to complete this operation.",
      );
    } finally {
      setBusy(false);
    }
  }
  function change(next: OperatingModel) {
    next = {
      ...next,
      decision: next.decision ?? defaultOperatingDecision(next),
    };
    setModel(next);
    setDefinition(JSON.stringify(next, null, 2));
    setPreview(null);
    setAcknowledged(false);
    request.current = null;
  }
  const path =
    preview?.paths.find((item) => item.caseId === selectedCase) ??
    preview?.paths[0];
  const displayedMonths =
    path?.forecast.months.filter((month) =>
      path.operating.months.includes(month.month),
    ) ?? [];
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
      <header>
        <nav className="flex flex-wrap gap-4 text-sm underline">
          <Link href="/">Workspace</Link>
          <Link href="/progress">Cash outlook</Link>
          <Link href="/goal-decisions">Decisions & outcomes</Link>
        </nav>
        <h1 className="mt-5 text-3xl font-semibold">
          Model a business decision
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Describe what you want to understand. Build and revise the operating
          relationships, explore alternatives, and trace their consequences for{" "}
          {company.name}.
        </p>
      </header>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Model needs attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      {!workspace && (
        <Button
          disabled={busy}
          onClick={() =>
            act(async () => setWorkspace(await read("/api/operating-models")))
          }
        >
          Retry loading workspace
        </Button>
      )}
      {workspace && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                {model
                  ? "Refine this model"
                  : "What decision are you considering?"}
              </CardTitle>
              <CardDescription>
                For example: “Can we take a new contract with our current team?
                Connect workload, delivery capacity, contractors and collection
                timing. Compare hiring with outsourcing.” Drafts stay outside
                your approved forecast.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="operating-prompt">
                    Your question, assumptions, or changes
                  </FieldLabel>
                  <Textarea
                    id="operating-prompt"
                    value={prompt}
                    disabled={busy}
                    maxLength={8000}
                    rows={4}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Describe the business mechanics, available evidence, and the alternatives you want to compare."
                  />
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Button
                    disabled={busy || !prompt.trim()}
                    onClick={() =>
                      act(async () => {
                        const result = await read<{
                          companyId: string;
                          model: OperatingModel;
                        }>("/api/operating-models", {
                          action: "draft",
                          prompt,
                          previous: model,
                        });
                        change(result.model);
                        setSelectedCase("base");
                        setNotice(
                          "Draft created. Review its assumptions, relationships and omissions before calculating financial effects.",
                        );
                      })
                    }
                  >
                    {busy
                      ? "Working…"
                      : model
                        ? "Revise draft with AI"
                        : "Draft model with AI"}
                  </Button>
                  {model && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setModel(null);
                        setPreview(null);
                        setDefinition("");
                        setAcknowledged(false);
                      }}
                    >
                      Start a new draft
                    </Button>
                  )}
                </div>
              </FieldGroup>
            </CardContent>
          </Card>
          {model && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{model.name}</CardTitle>
                  <CardDescription>{model.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <Alert>
                    <AlertTitle>Proposed operating assumptions</AlertTitle>
                    <AlertDescription>
                      AI can suggest relationships, but does not establish that
                      they are true. Review the starting values, units,
                      behavioral rules and source support. Include only cash
                      flows that are not already in your base forecast.
                    </AlertDescription>
                  </Alert>
                  <OperatingDecisionForm
                    currency={company.currency}
                    model={model}
                    disabled={busy}
                    onChange={change}
                  />
                  <FieldGroup className="md:grid md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="model-start">Start month</FieldLabel>
                      <Input
                        id="model-start"
                        type="month"
                        min={workspace.horizon.start}
                        max={workspace.horizon.end}
                        value={model.startMonth}
                        disabled={busy}
                        onChange={(e) =>
                          change({ ...model, startMonth: e.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="model-months">
                        Months to evaluate (1–24)
                      </FieldLabel>
                      <Input
                        id="model-months"
                        type="number"
                        min={1}
                        max={24}
                        value={model.months}
                        disabled={busy}
                        onChange={(e) =>
                          change({ ...model, months: Number(e.target.value) })
                        }
                      />
                    </Field>
                  </FieldGroup>
                  <div className="grid gap-4 md:grid-cols-2">
                    {model.nodes
                      .filter((node) => node.op === "input")
                      .map((node) => (
                        <section
                          key={node.id}
                          className="rounded-lg border p-4"
                        >
                          <h3 className="font-semibold">
                            {node.label}{" "}
                            <span className="text-sm font-normal text-muted-foreground">
                              ({node.unit})
                            </span>
                          </h3>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {node.basis === "user_assumption"
                              ? "User assumption"
                              : node.basis === "ai_suggestion"
                                ? "AI suggestion"
                                : "Unclassified assumption"}{" "}
                            · subject to review
                          </p>
                          <p className="my-2 text-sm text-muted-foreground">
                            {node.rationale}
                          </p>
                          <FieldGroup>
                            {node.values.map((step, i) => (
                              <Field key={i}>
                                <FieldLabel htmlFor={`value-${node.id}-${i}`}>
                                  From {step.month}
                                </FieldLabel>
                                <Input
                                  id={`value-${node.id}-${i}`}
                                  inputMode="decimal"
                                  value={step.value}
                                  disabled={busy}
                                  onChange={(e) =>
                                    change({
                                      ...model,
                                      nodes: model.nodes.map((n) =>
                                        n.id === node.id
                                          ? {
                                              ...n,
                                              basis: "user_assumption",
                                              values: n.values.map((v, j) =>
                                                j === i
                                                  ? {
                                                      ...v,
                                                      value: e.target.value,
                                                    }
                                                  : v,
                                              ),
                                            }
                                          : n,
                                      ),
                                    })
                                  }
                                />
                              </Field>
                            ))}
                          </FieldGroup>
                        </section>
                      ))}
                  </div>
                  <OperatingRelationships model={model} />
                  <details>
                    <summary className="cursor-pointer font-medium">
                      All relationship formulas
                    </summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {model.nodes
                        .filter((node) => node.op !== "input")
                        .map((node) => (
                          <section
                            key={node.id}
                            className="rounded-lg border p-3"
                          >
                            <h3 className="font-medium">
                              {node.label}{" "}
                              <span className="text-xs text-muted-foreground">
                                {node.id} · {node.unit}
                              </span>
                            </h3>
                            <p className="my-2 break-words font-mono text-xs">
                              {formula(node)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {node.rationale}
                            </p>
                          </section>
                        ))}
                    </div>
                  </details>
                  <section>
                    <h3 className="font-medium">
                      Where operations affect cash
                    </h3>
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {model.outputs.map((output) => (
                        <li key={output.nodeId}>
                          {output.label}: {output.nodeId} → cash{" "}
                          {output.direction === "receipt" ? "in" : "out"}, in{" "}
                          {company.currency}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3 className="font-medium">
                      Alternatives and stress cases
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Named assumptions, without probability weights.
                    </p>
                    <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-sm">
                      {model.cases.map((c) => (
                        <li key={c.id}>
                          <strong>{c.name}</strong>: {c.rationale}
                          <p className="text-muted-foreground">
                            {c.overrides
                              .map(
                                (override) =>
                                  `${override.nodeId}: ${override.values.map((v) => `${v.value} from ${v.month}`).join(", ")}`,
                              )
                              .join("; ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3 className="font-medium">
                      Missing information and limitations
                    </h3>
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {model.limitations.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Cash schedules stop at the model horizon; continuing
                      obligations beyond it must be modeled explicitly. This
                      first version supports monthly scalar variables, explicit
                      one-month lags, and up to five alternative cases.
                    </p>
                  </section>
                  <details>
                    <summary className="cursor-pointer text-sm">
                      Advanced: inspect or edit the model definition
                    </summary>
                    <FieldGroup className="mt-3">
                      <Field>
                        <FieldLabel htmlFor="model-definition">
                          Portable model definition (JSON)
                        </FieldLabel>
                        <Textarea
                          id="model-definition"
                          rows={12}
                          value={definition}
                          disabled={busy}
                          onChange={(e) => setDefinition(e.target.value)}
                        />
                      </Field>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          try {
                            const next = operatingModelSchema.safeParse(
                              JSON.parse(definition),
                            );
                            if (!next.success)
                              throw new Error("Invalid model structure.");
                            change(next.data);
                            setError("");
                          } catch {
                            setError(
                              "Invalid model definition. Check the JSON and required fields.",
                            );
                          }
                        }}
                      >
                        Use edited definition
                      </Button>
                    </FieldGroup>
                  </details>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const result = await read<{
                          companyId: string;
                          preview: OperatingPreview;
                        }>("/api/operating-models", {
                          action: "preview",
                          model,
                        });
                        setPreview(result.preview);
                        setSelectedCase(
                          result.preview.model.decision?.caseId ?? "base",
                        );
                        setAcknowledged(false);
                        setNotice(
                          "Calculated through the shared financial engine. Nothing has changed in the base forecast.",
                        );
                      })
                    }
                  >
                    Calculate and compare cases
                  </Button>
                </CardContent>
              </Card>
            </>
          )}
          {preview?.decisionAnalysis && (
            <OperatingDecisionResults
              key={preview.previewToken}
              analysis={preview.decisionAnalysis}
              currency={company.currency}
              actualMonths={preview.baseMonths
                .filter((m) => m.basis === "actual")
                .slice(-3)}
            />
          )}
          {preview && path && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Compare the consequences</CardTitle>
                  <CardDescription>
                    Amounts are {company.currency}. These outcomes depend on the
                    proposed relationships and the completeness of your base
                    forecast.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr>
                          {[
                            "Case",
                            "Ending cash",
                            "Change from base",
                            "Cash goals",
                            "Exceptions",
                          ].map((label) => (
                            <th className="p-3" key={label}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.paths.map((p) => {
                          const end = p.operating.months.at(-1)!;
                          const cash = p.forecast.months.find(
                            (month) => month.month === end,
                          )!;
                          const original = preview.baseMonths.find(
                            (month) => month.month === end,
                          )!;
                          return (
                            <tr key={p.caseId} className="border-t">
                              <th className="p-3">
                                <button
                                  className="text-left underline"
                                  onClick={() => setSelectedCase(p.caseId)}
                                >
                                  {p.name}
                                </button>
                              </th>
                              <td className="whitespace-nowrap p-3 tabular-nums">
                                {money(cash.endingCashMinor, company.currency)}
                                <span className="block text-xs text-muted-foreground">
                                  {end}
                                </span>
                              </td>
                              <td className="whitespace-nowrap p-3 tabular-nums">
                                {money(
                                  String(
                                    BigInt(cash.endingCashMinor) -
                                      BigInt(original.endingCashMinor),
                                  ),
                                  company.currency,
                                )}
                              </td>
                              <td className="p-3">
                                {p.goals.length ? (
                                  p.goals.map((goal) => (
                                    <p key={goal.id}>
                                      {goal.after.goal.name}:{" "}
                                      {goal.after.outcome.replaceAll("_", " ")}{" "}
                                      · {goal.after.assurance}
                                    </p>
                                  ))
                                ) : (
                                  <Link className="underline" href="/goals">
                                    Set a cash goal
                                  </Link>
                                )}
                              </td>
                              <td className="p-3">
                                {p.forecast.exceptions.length ||
                                  "None in calculation"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Select value={path.caseId} onValueChange={setSelectedCase}>
                    <SelectTrigger aria-label="Inspect operating case">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {preview.paths.map((p) => (
                          <SelectItem value={p.caseId} key={p.caseId}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <details open>
                    <summary className="cursor-pointer font-medium">
                      Monthly cash and operating trace
                    </summary>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <caption className="sr-only">
                          Every modeled variable and cash result for {path.name}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col" className="p-3 text-left">
                              Variable / metric
                            </th>
                            {path.operating.months.map((month) => (
                              <th
                                scope="col"
                                className="min-w-32 p-3 text-right"
                                key={month}
                              >
                                {month}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.model.nodes.map((node) => (
                            <tr className="border-t" key={node.id}>
                              <th
                                scope="row"
                                className="p-3 text-left font-normal"
                              >
                                {node.label}
                                <span className="block text-xs text-muted-foreground">
                                  {node.unit} · {formula(node)}
                                </span>
                              </th>
                              {path.operating.values[node.id]?.map(
                                (value, i) => (
                                  <td
                                    className="p-3 text-right tabular-nums"
                                    key={i}
                                  >
                                    {node.unit === company.currency
                                      ? `${company.currency} ${value}`
                                      : value}
                                  </td>
                                ),
                              )}
                            </tr>
                          ))}
                          {(
                            [
                              "openingCashMinor",
                              "receiptsMinor",
                              "spendingMinor",
                              "endingCashMinor",
                            ] as const
                          ).map((metric) => (
                            <tr className="border-t font-semibold" key={metric}>
                              <th scope="row" className="p-3 text-left">
                                {
                                  {
                                    openingCashMinor: "Opening cash",
                                    receiptsMinor: "Total cash in",
                                    spendingMinor: "Total cash out",
                                    endingCashMinor: "Ending cash",
                                  }[metric]
                                }
                              </th>
                              {displayedMonths.map((month) => (
                                <td
                                  className="whitespace-nowrap p-3 text-right"
                                  key={month.month}
                                >
                                  {money(month[metric], company.currency)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <details>
                    <summary className="cursor-pointer">
                      Sources, exceptions and calculation versions
                    </summary>
                    <ul className="my-3 list-disc pl-5 text-sm">
                      {preview.documents.map((doc) => (
                        <li key={doc.id}>
                          <a
                            className="underline"
                            href={`/api/evidence/${doc.id}/file`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {doc.name}
                          </a>{" "}
                          · {doc.status}
                        </li>
                      ))}
                      {preview.limitations.map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                      {path.forecast.exceptions.map((item, i) => (
                        <li key={`exception-${i}`}>{item.reason}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Operating model: {path.operating.formulaVersion} ·
                      Accounting forecast: {path.forecast.formulaVersion}
                    </p>
                  </details>
                  <p className="text-sm">
                    {selectedCase === "__unchanged__"
                      ? "Do nothing needs no saved scenario. Choose a modeled case above if you want to propose an action."
                      : `Scenario selected for review: ${path.name}`}
                  </p>
                  <FieldGroup>
                    <Field orientation="horizontal">
                      <input
                        type="checkbox"
                        id="review-assumptions"
                        disabled={busy}
                        checked={acknowledged}
                        onChange={(event) =>
                          setAcknowledged(event.target.checked)
                        }
                      />
                      <FieldLabel htmlFor="review-assumptions">
                        I reviewed the assumptions, horizon, missing evidence,
                        and overlap with existing receipts and costs.
                      </FieldLabel>
                    </Field>
                    <Button
                      disabled={
                        busy ||
                        !acknowledged ||
                        selectedCase === "__unchanged__" ||
                        !!path.forecast.exceptions.length ||
                        !path.changes.length
                      }
                      onClick={() =>
                        act(async () => {
                          const content = {
                            action: "save",
                            model: preview.model,
                            caseId: path.caseId,
                            previewToken: preview.previewToken,
                            acknowledgeAssumptions: true,
                          };
                          const fingerprint = JSON.stringify(content);
                          if (request.current?.fingerprint !== fingerprint)
                            request.current = {
                              fingerprint,
                              key: crypto.randomUUID(),
                            };
                          const result = await read<{
                            companyId: string;
                            saved: { id: string; name: string };
                          }>("/api/operating-models", {
                            ...content,
                            requestKey: request.current.key,
                          });
                          setWorkspace(await read("/api/operating-models"));
                          setNotice(
                            `Saved ${result.saved.name}. Its frozen cash schedule is a scenario awaiting review in Decisions & outcomes. The operating definition is preserved below.`,
                          );
                        })
                      }
                    >
                      Save this case as a scenario for review
                    </Button>
                  </FieldGroup>
                  <Link className="text-sm underline" href="/goal-decisions">
                    Open Decisions & outcomes for approval
                  </Link>
                </CardContent>
              </Card>
            </>
          )}
          {preview && <OperatingStudies key={`study-${company.id}-${preview.previewToken}`} companyId={company.id} model={preview.model} source={{kind:"draft",model:preview.model,caseId:selectedCase}}/>}
          <OperatingOutcomes key={`outcomes-${company.id}`} companyId={company.id} />
          <OperatingConnections
            key={company.id}
            companyId={company.id}
            experiments={workspace.saved}
          />
          <Card>
            <CardHeader>
              <CardTitle>Preserved experiments</CardTitle>
              <CardDescription>
                Reopen the assumptions for a new revision or download the
                original calculation. Saved scenarios contain a frozen cash
                schedule; later edits to a scenario do not rewrite this record.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {workspace.saved.length ? (
                workspace.saved.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
                  >
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.createdAt.slice(0, 10)}
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            const saved = await read<{
                              companyId: string;
                              snapshot: { model: OperatingModel };
                            }>(`/api/operating-models?id=${item.id}`);
                            change(saved.snapshot.model);
                            setNotice(
                              "Original assumptions reopened. Revise the dates and inputs, then calculate against today's forecast.",
                            );
                          })
                        }
                      >
                        Reopen assumptions
                      </Button>
                      <a
                        className="self-center text-sm underline"
                        href={`/api/operating-models?id=${item.id}`}
                        download={`operating-experiment-${item.id}.json`}
                      >
                        Download snapshot
                      </a>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No saved experiments yet. Start with a decision question
                  above.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
