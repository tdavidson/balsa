"use client";
import { useId, useRef, useState } from "react";
import type {
  OperatingModel,
  OperatingBranch,
  OperatingUncertainty,
  OperatingEntity,
} from "@balsa/finance-engine";
import type {
  OperatingStudySource,
  OperatingStudyDefinition,
} from "@/lib/operating-studies-contract";
import type {
  OperatingStudyPreview,
  loadOperatingStudies,
  loadOperatingStudy,
} from "@/lib/operating-studies";
import { OperatingStudyResults } from "./operating-study-results";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./ui/select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./ui/empty";
function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose" />
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
}
export function OperatingStudies({
  companyId,
  model,
  source,
}: {
  companyId: string;
  model: OperatingModel;
  source: OperatingStudySource;
}) {
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<OperatingStudyDefinition["kind"]>("conditional"),
    [mode, setMode] = useState<"simulated" | "observed">("simulated"),
    [start, setStart] = useState(model.startMonth),
    [branches, setBranches] = useState<OperatingBranch[]>([]),
    [parameters, setParameters] = useState<OperatingUncertainty[]>([]),
    [entities, setEntities] = useState<OperatingEntity[]>([]),
    [seed, setSeed] = useState("42"),
    [count, setCount] = useState("32"),
    [floor, setFloor] = useState("0"),
    [valueNode, setValueNode] = useState("none"),
    [discount, setDiscount] = useState("0.1"),
    [multiple, setMultiple] = useState("0"),
    [price, setPrice] = useState("0"),
    [valuationBasis, setValuationBasis] = useState("");
  const [metric, setMetric] = useState(model.nodes[0]!.id),
    [metricId, setMetricId] = useState(""),
    [scope, setScope] = useState(""),
    [aggregation, setAggregation] = useState<
      "monthly_total" | "month_end" | "monthly_average"
    >("monthly_total"),
    [mappingReason, setMappingReason] = useState(""),
    [mappingAck, setMappingAck] = useState(false),
    [additionalVersions, setAdditionalVersions] = useState<
      { predictionId: string; nodeId: string }[]
    >([]),
    [versions, setVersions] = useState<{ id: string; label: string }[]>([]);
  const [alternatives, setAlternatives] = useState<
      { name: string; model: OperatingModel; caseId: string }[]
    >([]),
    [experiments, setExperiments] = useState<{ id: string; label: string }[]>(
      [],
    );
  const [preview, setPreview] = useState<OperatingStudyPreview | null>(null),
    [history, setHistory] = useState<
      Awaited<ReturnType<typeof loadOperatingStudies>>["studies"]
    >([]),
    [name, setName] = useState(""),
    [ack, setAck] = useState(false),
    [historical, setHistorical] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [horizonMonths, setHorizonMonths] = useState("1");
  const [studyId, setStudyId] = useState<string | null>(null);
  const request = useRef<{ body: string; key: string } | null>(null),
    ackId = useId();
  const inputs = model.nodes.filter((n) => n.op === "input"),
    nodes = model.nodes.map((n) => ({
      id: n.id,
      label: `${n.label} (${n.unit})`,
    })),
    inputOptions = inputs.map((n) => ({
      id: n.id,
      label: `${n.label} (${n.unit})`,
    })),
    optional = [{ id: "none", label: "None" }, ...inputOptions];
  function invalidate() {
    setPreview(null);
    setStudyId(null);
    setAck(false);
    setHistorical(false);
    setNotice("");
  }
  async function read<T>(url: string, body?: object): Promise<T> {
    const response = await fetch(
      url,
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
    if (!response.ok) throw new Error(data.error ?? "Study request failed.");
    if (data.companyId !== companyId)
      throw new Error("Company selection changed. Reload before continuing.");
    return data;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Study request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function refresh(k = kind) {
    const h = await read<Awaited<ReturnType<typeof loadOperatingStudies>>>(
      `/api/operating-studies?kind=${k}`,
    );
    setHistory(h.studies);
  }
  function branchChange(i: number, next: OperatingBranch) {
    invalidate();
    setBranches(branches.map((b, j) => (i === j ? next : b)));
  }
  function addBranch() {
    const n = model.nodes[0]!;
    invalidate();
    setBranches([
      ...branches,
      {
        id: crypto.randomUUID(),
        name: `Alternative ${branches.length + 1}`,
        rationale: "",
        rule: {
          kind: "threshold",
          nodeId: n.id,
          unit: n.unit,
          scope: "",
          measure: "observed",
          direction: "above",
          threshold: "0",
          tolerance: "0",
          consecutiveMonths: 2,
          reportingLagMonths: 0,
        },
        leadMonths: 1,
        minimumMonths: 2,
        inputs: [{ nodeId: inputs[0]!.id, value: inputs[0]!.values[0]!.value }],
        switchCost: null,
        limits: [],
      },
    ]);
  }
  function definition(): OperatingStudyDefinition {
    if (kind === "conditional")
      return { kind, source, mode, plan: { startMonth: start, branches } };
    if (kind === "calibration") {
      if (source.kind !== "prediction")
        throw new Error("Calibration needs an approved prediction.");
      if (!mappingAck)
        throw new Error("Review the metric identity and aggregation first.");
      return {
        kind,
        source,
        binding: {
          horizonMonths: Number(horizonMonths),
          metricId,
          nodeId: metric,
          unit: model.nodes.find((n) => n.id === metric)!.unit,
          scope,
          aggregation,
          reason: mappingReason,
          additionalVersions,
          acknowledgeComparable: true,
        },
      };
    }
    return {
      kind,
      source,
      settings: {
        seed: Number(seed),
        count: Number(count),
        parameters,
        entities,
      },
      cashFloorMinor: floor,
      alternatives,
      valuation:
        valueNode === "none"
          ? null
          : {
              nodeId: valueNode,
              annualDiscount: discount,
              terminalMultiple: multiple,
              priceMinor: price,
              basis: valuationBasis,
            },
    };
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision studies</CardTitle>
        <CardDescription>
          Compare conditional plans, inspect reliability, and explore
          interacting assumptions. Studies preserve their inputs and
          calculations; financial changes require the existing review and
          approval flow.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setOpen(!open);
              if (!open) {
                await refresh();
                const workspace = await read<{
                  companyId: string;
                  saved: { id: string; name: string }[];
                }>("/api/operating-models");
                setExperiments(
                  workspace.saved.map((s) => ({ id: s.id, label: s.name })),
                );
                if (source.kind === "prediction") {
                  const w = await read<{
                    companyId: string;
                    predictions: { id: string; name: string }[];
                  }>("/api/operating-outcomes");
                  setVersions(
                    w.predictions
                      .filter((p) => p.id !== source.predictionId)
                      .map((p) => ({ id: p.id, label: p.name })),
                  );
                }
              }
            })
          }
        >
          {open ? "Close studies" : "Explore decision studies"}
        </Button>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Study needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && <p role="status">{notice}</p>}
        {open && (
          <>
            <fieldset disabled={busy} className="flex flex-col gap-4">
              <ToggleGroup
                type="single"
                value={kind}
                onValueChange={(v) => {
                  if (v) {
                    invalidate();
                    setKind(v as typeof kind);
                    void run(() => refresh(v as typeof kind));
                  }
                }}
                aria-label="Study type"
              >
                <ToggleGroupItem value="conditional">
                  Conditional plans
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="calibration"
                  disabled={source.kind !== "prediction"}
                >
                  Reliability
                </ToggleGroupItem>
                <ToggleGroupItem value="simulation">Simulation</ToggleGroupItem>
              </ToggleGroup>
              {kind === "conditional" && (
                <FieldGroup>
                  <TextField
                    label="First decision month"
                    type="month"
                    value={start}
                    onChange={(v) => {
                      invalidate();
                      setStart(v);
                    }}
                  />
                  <ToggleGroup
                    type="single"
                    value={mode}
                    onValueChange={(v) => {
                      if (v) {
                        invalidate();
                        setMode(v as typeof mode);
                      }
                    }}
                    aria-label="Condition basis"
                  >
                    <ToggleGroupItem value="simulated">
                      Assumed model path
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="observed"
                      disabled={source.kind !== "prediction"}
                    >
                      Observed evidence
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <FieldDescription>
                    Observed decisions use only evidence recorded before that
                    month's start. Set the first decision month after the
                    prediction's approval month. Branches are checked in the
                    order shown; the first qualifying branch wins.
                  </FieldDescription>
                  {branches.map((b, i) => (
                    <Card key={b.id}>
                      <CardHeader>
                        <CardTitle>
                          Priority {i + 1}: {b.name}
                        </CardTitle>
                        <CardDescription>
                          Explicit conditions, response and commitments.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <FieldGroup>
                          <TextField
                            label="Branch name"
                            value={b.name}
                            onChange={(name) => branchChange(i, { ...b, name })}
                          />
                          <ToggleGroup
                            type="single"
                            value={b.rule.kind}
                            aria-label="Condition type"
                            onValueChange={(v) => {
                              if (v)
                                branchChange(i, {
                                  ...b,
                                  rule:
                                    v === "review_date"
                                      ? {
                                          kind: "review_date",
                                          dueDate: `${start}-01`,
                                        }
                                      : {
                                          kind: "threshold",
                                          nodeId: model.nodes[0]!.id,
                                          unit: model.nodes[0]!.unit,
                                          scope: "",
                                          measure: "observed",
                                          direction: "above",
                                          threshold: "0",
                                          tolerance: "0",
                                          consecutiveMonths: 2,
                                          reportingLagMonths: 0,
                                        },
                                });
                            }}
                          >
                            <ToggleGroupItem value="threshold">
                              Metric threshold
                            </ToggleGroupItem>
                            <ToggleGroupItem value="review_date">
                              Review date
                            </ToggleGroupItem>
                          </ToggleGroup>
                          {b.rule.kind === "review_date" ? (
                            <TextField
                              label="Review date"
                              type="date"
                              value={b.rule.dueDate}
                              onChange={(dueDate) =>
                                branchChange(i, {
                                  ...b,
                                  rule: { kind: "review_date", dueDate },
                                })
                              }
                            />
                          ) : (
                            <ThresholdFields
                              rule={b.rule}
                              nodes={nodes}
                              onChange={(rule) =>
                                branchChange(i, { ...b, rule })
                              }
                              model={model}
                            />
                          )}
                          <TextField
                            label="Lead time (months)"
                            type="number"
                            value={b.leadMonths}
                            onChange={(v) =>
                              branchChange(i, { ...b, leadMonths: Number(v) })
                            }
                          />
                          <TextField
                            label="Minimum commitment (months)"
                            type="number"
                            value={b.minimumMonths}
                            onChange={(v) =>
                              branchChange(i, {
                                ...b,
                                minimumMonths: Number(v),
                              })
                            }
                          />
                          {b.inputs.map((input, j) => (
                            <FieldGroup key={j}>
                              <Choice
                                label="Changed input"
                                value={input.nodeId}
                                options={inputOptions}
                                onChange={(nodeId) =>
                                  branchChange(i, {
                                    ...b,
                                    inputs: b.inputs.map((p, k) =>
                                      k === j ? { ...p, nodeId } : p,
                                    ),
                                  })
                                }
                              />
                              <TextField
                                label="Value from activation"
                                value={input.value}
                                onChange={(value) =>
                                  branchChange(i, {
                                    ...b,
                                    inputs: b.inputs.map((p, k) =>
                                      k === j ? { ...p, value } : p,
                                    ),
                                  })
                                }
                              />
                              <Button
                                variant="ghost"
                                disabled={b.inputs.length === 1}
                                onClick={() =>
                                  branchChange(i, {
                                    ...b,
                                    inputs: b.inputs.filter((_, k) => k !== j),
                                  })
                                }
                              >
                                Remove change
                              </Button>
                            </FieldGroup>
                          ))}
                          <Button
                            variant="outline"
                            disabled={b.inputs.length >= 12}
                            onClick={() =>
                              branchChange(i, {
                                ...b,
                                inputs: [
                                  ...b.inputs,
                                  { nodeId: inputs[0]!.id, value: "0" },
                                ],
                              })
                            }
                          >
                            Add input change
                          </Button>
                          <Choice
                            label="Switching cost input (one-period pulse when leaving another branch)"
                            value={b.switchCost?.nodeId ?? "none"}
                            options={optional}
                            onChange={(v) =>
                              branchChange(i, {
                                ...b,
                                switchCost:
                                  v === "none"
                                    ? null
                                    : { nodeId: v, value: "0" },
                              })
                            }
                          />
                          {b.switchCost && (
                            <TextField
                              label="Switching cost"
                              value={b.switchCost.value}
                              onChange={(value) =>
                                branchChange(i, {
                                  ...b,
                                  switchCost: { ...b.switchCost!, value },
                                })
                              }
                            />
                          )}
                          <Choice
                            label="Resource limit"
                            value={b.limits[0]?.nodeId ?? "none"}
                            options={[{ id: "none", label: "None" }, ...nodes]}
                            onChange={(v) =>
                              branchChange(i, {
                                ...b,
                                limits:
                                  v === "none"
                                    ? []
                                    : [{ nodeId: v, maximum: "0" }],
                              })
                            }
                          />
                          {b.limits[0] && (
                            <TextField
                              label="Maximum resource use"
                              value={b.limits[0].maximum}
                              onChange={(maximum) =>
                                branchChange(i, {
                                  ...b,
                                  limits: [{ ...b.limits[0]!, maximum }],
                                })
                              }
                            />
                          )}
                          <TextField
                            label="Why this branch and these assumptions?"
                            value={b.rationale}
                            onChange={(rationale) =>
                              branchChange(i, { ...b, rationale })
                            }
                          />
                          <Button
                            variant="outline"
                            disabled={i === 0}
                            onClick={() => {
                              invalidate();
                              const next = [...branches];
                              [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                              setBranches(next);
                            }}
                          >
                            Move earlier in priority
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              invalidate();
                              setBranches(branches.filter((_, j) => j !== i));
                            }}
                          >
                            Remove branch
                          </Button>
                        </FieldGroup>
                      </CardContent>
                    </Card>
                  ))}
                  <Button
                    variant="outline"
                    disabled={branches.length >= 6 || !inputs.length}
                    onClick={addBranch}
                  >
                    Add conditional branch
                  </Button>
                </FieldGroup>
              )}
              {kind === "calibration" && (
                <FieldGroup>
                  <Choice
                    label="Metric to evaluate"
                    value={metric}
                    options={nodes}
                    onChange={(v) => {
                      invalidate();
                      setMetric(v);
                    }}
                  />
                  <TextField
                    label="Forecast age to evaluate (months ahead, 1–24)"
                    type="number"
                    value={horizonMonths}
                    onChange={(v) => {
                      invalidate();
                      setHorizonMonths(v);
                    }}
                  />
                  <TextField
                    label="Stable metric identity"
                    value={metricId}
                    onChange={(v) => {
                      invalidate();
                      setMetricId(v);
                    }}
                  />
                  <TextField
                    label="Exact entity scope used by observations"
                    value={scope}
                    onChange={(v) => {
                      invalidate();
                      setScope(v);
                    }}
                  />
                  <Choice
                    label="Period aggregation"
                    value={aggregation}
                    options={[
                      { id: "monthly_total", label: "Monthly total" },
                      { id: "month_end", label: "Month-end balance" },
                      { id: "monthly_average", label: "Monthly average" },
                    ]}
                    onChange={(v) => {
                      invalidate();
                      setAggregation(v as typeof aggregation);
                    }}
                  />
                  <TextField
                    label="Why are these measurements comparable?"
                    value={mappingReason}
                    onChange={(v) => {
                      invalidate();
                      setMappingReason(v);
                    }}
                  />
                  {additionalVersions.map((v, i) => (
                    <FieldGroup key={i}>
                      <Choice
                        label="Additional approved forecast version"
                        value={v.predictionId}
                        options={versions}
                        onChange={(predictionId) => {
                          invalidate();
                          setAdditionalVersions(
                            additionalVersions.map((b, j) =>
                              i === j ? { ...b, predictionId } : b,
                            ),
                          );
                        }}
                      />
                      <TextField
                        label="Exact metric ID in that version (inspect its Outcomes view)"
                        value={v.nodeId}
                        onChange={(nodeId) => {
                          invalidate();
                          setAdditionalVersions(
                            additionalVersions.map((b, j) =>
                              i === j ? { ...b, nodeId } : b,
                            ),
                          );
                        }}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => {
                          invalidate();
                          setAdditionalVersions(
                            additionalVersions.filter((_, j) => j !== i),
                          );
                        }}
                      >
                        Remove version
                      </Button>
                    </FieldGroup>
                  ))}
                  <Button
                    variant="outline"
                    disabled={
                      !versions.length || additionalVersions.length >= 11
                    }
                    onClick={() => {
                      invalidate();
                      setAdditionalVersions([
                        ...additionalVersions,
                        { predictionId: versions[0]!.id, nodeId: metric },
                      ]);
                    }}
                  >
                    Include another forecast version
                  </Button>
                  <Field orientation="horizontal">
                    <Checkbox
                      id={`${ackId}-mapping`}
                      checked={mappingAck}
                      onCheckedChange={(v) => {
                        invalidate();
                        setMappingAck(v === true);
                      }}
                    />
                    <FieldLabel htmlFor={`${ackId}-mapping`}>
                      I verified the metric identity, units, scope and
                      aggregation across the selected versions.
                    </FieldLabel>
                  </Field>
                </FieldGroup>
              )}
              {kind === "simulation" && (
                <FieldGroup>
                  <TextField
                    label="Reproducible seed"
                    type="number"
                    value={seed}
                    onChange={(v) => {
                      invalidate();
                      setSeed(v);
                    }}
                  />
                  <TextField
                    label="Paths per model (16–64)"
                    type="number"
                    value={count}
                    onChange={(v) => {
                      invalidate();
                      setCount(v);
                    }}
                  />
                  <TextField
                    label="Ending-cash floor (minor currency units, e.g. 10000 = $100)"
                    value={floor}
                    onChange={(v) => {
                      invalidate();
                      setFloor(v);
                    }}
                  />
                  <FieldDescription>
                    Uniform ranges are assumptions. The same nonempty group
                    shares one sampled rank; inverse reverses it. Empty groups
                    are independent. Values replace the input from the selected
                    month onward.
                  </FieldDescription>
                  {parameters.map((p, i) => (
                    <FieldGroup key={i}>
                      <Choice
                        label="Uncertain input"
                        value={p.nodeId}
                        options={inputOptions}
                        onChange={(nodeId) => {
                          invalidate();
                          setParameters(
                            parameters.map((x, j) =>
                              i === j ? { ...x, nodeId } : x,
                            ),
                          );
                        }}
                      />
                      {(
                        [
                          ["From month", "from"],
                          ["Minimum", "low"],
                          ["Maximum", "high"],
                          ["Shared rank group (optional)", "group"],
                          ["Source or rationale", "rationale"],
                        ] as const
                      ).map(([label, key]) => (
                        <TextField
                          key={key}
                          label={label}
                          value={p[key]}
                          type={key === "from" ? "month" : "text"}
                          onChange={(value) => {
                            invalidate();
                            setParameters(
                              parameters.map((x, j) =>
                                i === j ? { ...x, [key]: value } : x,
                              ),
                            );
                          }}
                        />
                      ))}
                      <Choice
                        label="Rank direction"
                        value={p.inverse ? "inverse" : "same"}
                        options={[
                          { id: "same", label: "Same" },
                          { id: "inverse", label: "Inverse" },
                        ]}
                        onChange={(v) => {
                          invalidate();
                          setParameters(
                            parameters.map((x, j) =>
                              i === j ? { ...x, inverse: v === "inverse" } : x,
                            ),
                          );
                        }}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => {
                          invalidate();
                          setParameters(parameters.filter((_, j) => i !== j));
                        }}
                      >
                        Remove uncertain input
                      </Button>
                    </FieldGroup>
                  ))}
                  <Button
                    variant="outline"
                    disabled={parameters.length >= 8 || !inputs.length}
                    onClick={() => {
                      invalidate();
                      setParameters([
                        ...parameters,
                        {
                          nodeId: inputs[0]!.id,
                          from: model.startMonth,
                          low: inputs[0]!.values[0]!.value,
                          high: inputs[0]!.values[0]!.value,
                          group: "",
                          inverse: false,
                          rationale: "",
                        },
                      ]);
                    }}
                  >
                    Add uncertain input
                  </Button>
                  {entities.map((e, i) => (
                    <FieldGroup key={e.id}>
                      <TextField
                        label="Entity name"
                        value={e.name}
                        onChange={(name) => {
                          invalidate();
                          setEntities(
                            entities.map((x, j) =>
                              i === j ? { ...x, name } : x,
                            ),
                          );
                        }}
                      />
                      <TextField
                        label="Cohort"
                        value={e.cohort}
                        onChange={(cohort) => {
                          invalidate();
                          setEntities(
                            entities.map((x, j) =>
                              i === j ? { ...x, cohort } : x,
                            ),
                          );
                        }}
                      />
                      <Choice
                        label="Add a metric or cash output to this entity"
                        value="none"
                        options={[
                          { id: "none", label: "Choose a node" },
                          ...nodes,
                        ]}
                        onChange={(nodeId) => {
                          if (nodeId !== "none") {
                            invalidate();
                            setEntities(
                              entities.map((x, j) =>
                                i === j
                                  ? {
                                      ...x,
                                      nodeIds: [
                                        ...new Set([...x.nodeIds, nodeId]),
                                      ],
                                    }
                                  : x,
                              ),
                            );
                          }
                        }}
                      />
                      <FieldDescription>
                        {e.nodeIds.join(", ") || "No nodes selected"}. Shared
                        nodes should remain unallocated.
                      </FieldDescription>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          invalidate();
                          setEntities(entities.filter((_, j) => i !== j));
                        }}
                      >
                        Remove entity
                      </Button>
                    </FieldGroup>
                  ))}
                  <Button
                    variant="outline"
                    disabled={entities.length >= 12}
                    onClick={() => {
                      invalidate();
                      setEntities([
                        ...entities,
                        {
                          id: crypto.randomUUID(),
                          name: "",
                          cohort: "",
                          nodeIds: [],
                        },
                      ]);
                    }}
                  >
                    Add entity or cohort
                  </Button>
                  <Choice
                    label="Compare a saved structural model (same horizon, input IDs and sources)"
                    value="none"
                    options={[
                      { id: "none", label: "Choose a saved model" },
                      ...experiments,
                    ]}
                    onChange={(id) => {
                      if (id !== "none")
                        void run(async () => {
                          if (alternatives.length >= 2)
                            throw new Error(
                              "Compare at most two structural alternatives.",
                            );
                          const saved = await read<{
                            companyId: string;
                            name: string;
                            snapshot: {
                              model: OperatingModel;
                              path: { operating: { caseId: string } };
                            };
                          }>(`/api/operating-models?id=${id}`);
                          invalidate();
                          setAlternatives([
                            ...alternatives,
                            {
                              name: saved.name,
                              model: saved.snapshot.model,
                              caseId: saved.snapshot.path.operating.caseId,
                            },
                          ]);
                        });
                    }}
                  />
                  {alternatives.map((a, i) => (
                    <Button
                      variant="ghost"
                      key={i}
                      onClick={() => {
                        invalidate();
                        setAlternatives(alternatives.filter((_, j) => i !== j));
                      }}
                    >
                      Remove comparison: {a.name}
                    </Button>
                  ))}
                  <Choice
                    label="Optional valuation cash-flow node"
                    value={valueNode}
                    options={[{ id: "none", label: "No valuation" }, ...nodes]}
                    onChange={(v) => {
                      invalidate();
                      setValueNode(v);
                    }}
                  />
                  {valueNode !== "none" && (
                    <>
                      <TextField
                        label="Nominal annual discount (0.10 = 10%)"
                        value={discount}
                        onChange={(v) => {
                          invalidate();
                          setDiscount(v);
                        }}
                      />
                      <TextField
                        label="Terminal multiple of annualized final cash flow"
                        value={multiple}
                        onChange={(v) => {
                          invalidate();
                          setMultiple(v);
                        }}
                      />
                      <TextField
                        label="Entered market price (minor currency units)"
                        value={price}
                        onChange={(v) => {
                          invalidate();
                          setPrice(v);
                        }}
                      />
                      <TextField
                        label="Cash-flow basis, currency, enterprise/equity scope and omitted adjustments"
                        value={valuationBasis}
                        onChange={(v) => {
                          invalidate();
                          setValuationBasis(v);
                        }}
                      />
                    </>
                  )}
                </FieldGroup>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await read<{
                      companyId: string;
                      preview: OperatingStudyPreview;
                    }>("/api/operating-studies", {
                      action: "preview",
                      definition: definition(),
                    });
                    setPreview(result.preview);
                    setStudyId(null);
                    setAck(false);
                    setHistorical(false);
                  })
                }
              >
                {busy ? "Calculating…" : "Preview study"}
              </Button>
            </fieldset>
            {preview && (
              <>
                <details>
                  <summary>Model source references and approval status</summary>
                  <p className="text-sm">
                    Values remain assumptions unless their sources and mappings
                    have been reviewed. Source approval does not validate a
                    distribution or behavioral relationship.
                  </p>
                  {preview.context.documents.length ? (
                    preview.context.documents.map((d) => (
                      <p key={d.id} className="text-sm">
                        <a
                          className="underline"
                          href={`/api/evidence/${d.id}/file`}
                        >
                          {d.name}
                        </a>{" "}
                        · {d.status}
                        {d.status !== "approved" ? " · unverified" : ""}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm">
                      No source documents are attached; this model uses stated
                      assumptions.
                    </p>
                  )}
                </details>
                <OperatingStudyResults
                  key={preview.previewToken}
                  preview={preview}
                  studyId={studyId}
                />
                {!historical && (
                  <FieldGroup>
                    <TextField
                      label="Study name"
                      value={name}
                      onChange={setName}
                    />
                    <Field orientation="horizontal">
                      <Checkbox
                        id={ackId}
                        checked={ack}
                        onCheckedChange={(v) => setAck(v === true)}
                        disabled={busy}
                      />
                      <FieldLabel htmlFor={ackId}>
                        I reviewed these assumptions and limitations. Saving
                        preserves a study and does not approve a forecast
                        change.
                      </FieldLabel>
                    </Field>
                    <Button
                      disabled={busy || !ack || !name.trim()}
                      onClick={() =>
                        run(async () => {
                          const body = {
                              action: "save",
                              definition: preview.definition,
                              name,
                              previewToken: preview.previewToken,
                              acknowledgeAssumptions: true,
                            },
                            fingerprint = JSON.stringify(body);
                          if (request.current?.body !== fingerprint)
                            request.current = {
                              body: fingerprint,
                              key: crypto.randomUUID(),
                            };
                          const saved = await read<{
                            companyId: string;
                            id: string;
                          }>("/api/operating-studies", {
                            ...body,
                            requestKey: request.current.key,
                          });
                          setNotice(
                            `Study preserved: ${name}. No forecast changed.`,
                          );
                          setHistorical(true);
                          setStudyId(saved.id);
                          await refresh();
                          void saved;
                        })
                      }
                    >
                      Preserve study
                    </Button>
                  </FieldGroup>
                )}
              </>
            )}
            <details>
              <summary>
                Preserved {kind} studies ({history.length})
              </summary>
              {!history.length ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No preserved studies</EmptyTitle>
                    <EmptyDescription>
                      Preview and preserve an analysis to keep its assumptions
                      and exact results.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="flex flex-col gap-2">
                  {history.map((h) => (
                    <Button
                      key={h.id}
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const saved = await read<
                            Awaited<ReturnType<typeof loadOperatingStudy>>
                          >(`/api/operating-studies?id=${h.id}`);
                          setPreview(saved.snapshot);
                          setStudyId(saved.id);
                          setHistorical(true);
                          setNotice(
                            `Preserved ${saved.createdAt.slice(0, 10)} · ${saved.name}. This snapshot is read-only.`,
                          );
                        })
                      }
                    >
                      {h.name} · {h.createdAt.slice(0, 10)}
                    </Button>
                  ))}
                </div>
              )}
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
function ThresholdFields({
  rule,
  model,
  nodes,
  onChange,
}: {
  rule: Extract<OperatingBranch["rule"], { kind: "threshold" }>;
  model: OperatingModel;
  nodes: { id: string; label: string }[];
  onChange: (r: typeof rule) => void;
}) {
  return (
    <FieldGroup>
      <Choice
        label="Condition metric"
        value={rule.nodeId}
        options={nodes}
        onChange={(nodeId) =>
          onChange({
            ...rule,
            nodeId,
            unit: model.nodes.find((n) => n.id === nodeId)!.unit,
          })
        }
      />
      <TextField
        label="Exact observation scope"
        value={rule.scope}
        onChange={(scope) => onChange({ ...rule, scope })}
      />
      <Choice
        label="Measure"
        value={rule.measure}
        options={[
          { id: "observed", label: "Metric value" },
          { id: "difference", label: "Observed minus predicted" },
        ]}
        onChange={(v) =>
          onChange({ ...rule, measure: v as typeof rule.measure })
        }
      />
      <Choice
        label="Direction"
        value={rule.direction}
        options={[
          { id: "above", label: "Above" },
          { id: "below", label: "Below" },
        ]}
        onChange={(v) =>
          onChange({ ...rule, direction: v as typeof rule.direction })
        }
      />
      <TextField
        label="Threshold"
        value={rule.threshold}
        onChange={(threshold) => onChange({ ...rule, threshold })}
      />
      <TextField
        label="Tolerance"
        value={rule.tolerance}
        onChange={(tolerance) => onChange({ ...rule, tolerance })}
      />
      <TextField
        label="Consecutive complete months"
        type="number"
        value={rule.consecutiveMonths}
        onChange={(v) => onChange({ ...rule, consecutiveMonths: Number(v) })}
      />
      <TextField
        label="Reporting lag (months)"
        type="number"
        value={rule.reportingLagMonths}
        onChange={(v) => onChange({ ...rule, reportingLagMonths: Number(v) })}
      />
    </FieldGroup>
  );
}
