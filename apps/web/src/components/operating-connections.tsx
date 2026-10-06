"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { OperatingSourceSuggestions } from "./operating-source-suggestions";
import Link from "next/link";
import type { OperatingModel } from "@balsa/finance-engine";
import type {
  loadOperatingConnections,
  OperatingUpdatePreview,
} from "@/lib/operating-connections";
import type { OperatingBinding } from "@/lib/operating-connections-contract";
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
import { Checkbox } from "@/components/ui/checkbox";
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

type Workspace = Awaited<ReturnType<typeof loadOperatingConnections>>;
export function OperatingConnections({
  companyId,
  experiments,
}: {
  companyId: string;
  experiments: { id: string; name: string }[];
}) {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [model, setModel] = useState<OperatingModel | null>(null);
  const [bindings, setBindings] = useState<OperatingBinding[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<OperatingUpdatePreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState("");
  const requestKey = useRef<string | null>(null);
  const read = useCallback(
    async <T,>(url: string, body?: object): Promise<T> => {
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
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Unable to load connected models.");
      if (result.companyId !== companyId)
        throw new Error("Company selection changed. Reload this page.");
      return result;
    },
    [companyId],
  );
  const refresh = useCallback(async () => {
    setData(await read<Workspace>("/api/operating-connections"));
  }, [read]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const result = await read<Workspace>("/api/operating-connections");
        if (active) {
          setData(result);
          setError("");
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not check connected sources.",
          );
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [read]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to update this model.",
      );
    } finally {
      setBusy(false);
    }
  }
  const update = (binding: OperatingBinding) => {
    setBindings((old) => [
      ...old.filter((b) => b.nodeId !== binding.nodeId),
      binding,
    ]);
    setConfirmed(false);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Models connected to evidence</CardTitle>
        <CardDescription>
          Link saved assumptions to approved numeric facts. Source changes are
          checked when this page opens and every 30 seconds while visible.
          Calculate a proposed replacement, inspect the differences, then
          approve it in Decisions & outcomes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Connection needs attention</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && <p role="status">{notice}</p>}
        <details>
          <summary className="cursor-pointer font-medium">
            Connect a saved experiment
          </summary>
          <FieldGroup className="mt-4">
            <Field>
              <FieldLabel>Saved experiment</FieldLabel>
              <Select
                disabled={busy}
                value={selected}
                onValueChange={(id) => {
                  setSelected(id);
                  setModel(null);
                  setBindings([]);
                  setConfirmed(false);
                  void act(async () => {
                    const saved = await read<{
                      companyId: string;
                      snapshot: { model: OperatingModel };
                    }>(`/api/operating-models?id=${id}`);
                    setModel(saved.snapshot.model);
                  });
                }}
              >
                <SelectTrigger aria-label="Experiment to connect">
                  <SelectValue placeholder="Choose an experiment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {experiments.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {model && selected && (
              <OperatingSourceSuggestions
                key={selected}
                companyId={companyId}
                experimentId={selected}
                connectionId={null}
                onUse={(binding) => update(binding)}
              />
            )}
            {model?.nodes
              .filter((n) => n.op === "input")
              .map((node) => {
                const binding = bindings.find((b) => b.nodeId === node.id);
                return (
                  <FieldGroup key={node.id} className="rounded-md border p-4">
                    <Field>
                      <FieldLabel>
                        {node.label} · {node.unit}
                      </FieldLabel>
                      <Select
                        disabled={busy}
                        value={binding?.factId ?? "manual"}
                        onValueChange={(factId) => {
                          if (factId === "manual") {
                            setBindings((old) =>
                              old.filter((b) => b.nodeId !== node.id),
                            );
                            setConfirmed(false);
                          } else
                            update({
                              nodeId: node.id,
                              factId,
                              from: binding?.from ?? model.startMonth,
                              unit: node.unit,
                            });
                        }}
                      >
                        <SelectTrigger aria-label={`Source for ${node.label}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="manual">
                              Keep the saved assumption
                            </SelectItem>
                            {data?.facts
                              .filter(
                                (f) => !f.currency || f.currency === node.unit,
                              )
                              .map((fact) => (
                                <SelectItem key={fact.id} value={fact.id}>
                                  {fact.label}: {fact.value} · {fact.sourceName}
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {binding && (
                      <Field>
                        <FieldLabel htmlFor={`binding-${node.id}`}>
                          Effective from
                        </FieldLabel>
                        <Input
                          id={`binding-${node.id}`}
                          type="month"
                          disabled={busy}
                          value={binding.from}
                          onChange={(e) =>
                            update({ ...binding, from: e.target.value })
                          }
                        />
                        <p className="text-sm text-muted-foreground">
                          Replaces this month’s input. Later saved input steps
                          still apply. The fact’s numeric value must be
                          expressed in {node.unit}.
                        </p>
                      </Field>
                    )}
                  </FieldGroup>
                );
              })}
            <p className="text-sm text-muted-foreground">
              Only approved documents with approved plain numeric facts are
              listed (up to 500 recent facts). No unit conversion is performed.
              AI can suggest mappings for review. Source replacements are preserved
              in update revisions; structural model changes need a new experiment.
            </p>
            <Field orientation="horizontal">
              <Checkbox
                id="confirm-operating-units"
                checked={confirmed}
                disabled={busy}
                onCheckedChange={(v) => setConfirmed(v === true)}
              />
              <FieldLabel htmlFor="confirm-operating-units">
                I verified the source meanings, units and effective dates.
              </FieldLabel>
            </Field>
            <Button
              disabled={busy || !selected || !bindings.length || !confirmed}
              onClick={() =>
                act(async () => {
                  await read("/api/operating-connections", {
                    action: "connect",
                    experimentId: selected,
                    bindings,
                    acknowledgeUnits: true,
                  });
                  setNotice(
                    "Connections preserved. Calculate the first connected update below; the forecast is unchanged.",
                  );
                  setConfirmed(false);
                  await refresh();
                })
              }
            >
              Connect approved sources
            </Button>
          </FieldGroup>
        </details>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Updates remain proposals until approved. Rejecting one keeps the
            current forecast.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => act(refresh)}
          >
            Check sources now
          </Button>
        </div>
        {data?.connected.map((item) => (
          <section
            key={item.id}
            className="flex flex-col gap-3 rounded-lg border p-4"
          >
            <h3 className="font-semibold">{item.name}</h3>
            <p>{item.message}</p>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy || item.status === "blocked"}
                onClick={() =>
                  act(async () => {
                    setPreview(null);
                    setReviewed(false);
                    requestKey.current = null;
                    const result = await read<{
                      companyId: string;
                      preview: OperatingUpdatePreview;
                    }>("/api/operating-connections", {
                      action: "preview_update",
                      connectionId: item.id,
                    });
                    setPreview(result.preview);
                  })
                }
              >
                Calculate update
              </Button>
              <Link
                className="self-center text-sm underline"
                href="/goal-decisions"
              >
                Review decisions and outcomes
              </Link>
            </div>
            <OperatingSourceSuggestions
              companyId={companyId}
              experimentId={null}
              connectionId={item.id}
              onUse={async (binding) => {
                setPreview(null);
                setReviewed(false);
                requestKey.current = null;
                const bindings = [
                  ...item.bindings.filter((b) => b.nodeId !== binding.nodeId),
                  binding,
                ];
                const result = await read<{
                  companyId: string;
                  preview: OperatingUpdatePreview;
                }>("/api/operating-connections", {
                  action: "preview_update",
                  connectionId: item.id,
                  bindings,
                });
                setPreview(result.preview);
              }}
            />
            <details>
              <summary className="cursor-pointer text-sm">
                Preserved versions ({item.history.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {item.history.map((version) => (
                  <li key={version.id}>
                    <a
                      className="underline"
                      href={`/api/operating-models?id=${version.id}`}
                      download
                    >
                      {version.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                      {version.applied
                        ? "Current applied version"
                        : "Preserved experiment"}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
            {item.status === "awaiting_approval" && (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`reject-${item.id}`}>
                    Reason to reject this proposed update
                  </FieldLabel>
                  <Input
                    id={`reject-${item.id}`}
                    disabled={busy}
                    value={reason}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Button
                  variant="outline"
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    act(async () => {
                      await read("/api/operating-connections", {
                        action: "reject_update",
                        connectionId: item.id,
                        experimentId: item.latestExperimentId,
                        reason,
                      });
                      setPreview(null);
                      setReason("");
                      await refresh();
                      setNotice(
                        "Update rejected. The approved forecast and preserved history are unchanged.",
                      );
                    })
                  }
                >
                  Reject proposed update
                </Button>
              </FieldGroup>
            )}
          </section>
        ))}
        {data && !data.connected.length && (
          <p className="text-sm text-muted-foreground">
            No connected models yet. Save an experiment above, then connect its
            inputs here.
          </p>
        )}
        {preview && (
          <section
            className="flex flex-col gap-5"
            aria-label="Operating update review"
          >
            <h3 className="text-xl font-semibold">
              What changes: {preview.name}
            </h3>
            <p>
              Replaces {preview.replaces} future items from this model’s prior
              approved version. Historical financial results remain unchanged.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="mb-2 text-left">
                  Connected assumptions and their evidence
                </caption>
                <thead>
                  <tr>
                    {[
                      "Input / unit",
                      "Effective",
                      "Prior model value",
                      "Proposed source value",
                      "Source",
                    ].map((label) => (
                      <th className="p-2 text-left" scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.assumptions.map((a) => (
                    <tr key={`${a.nodeId}:${a.from}`} className="border-t">
                      <th scope="row" className="p-2 text-left">
                        {
                          preview.model.nodes.find((n) => n.id === a.nodeId)
                            ?.label
                        }{" "}
                        · {a.unit}
                      </th>
                      <td className="p-2">{a.from}</td>
                      <td className="p-2">{a.before ?? "Not modeled"}</td>
                      <td className="p-2">{a.value}</td>
                      <td className="p-2">
                        <a
                          className="underline"
                          href={`/api/evidence/${a.evidenceId}/file`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {a.sourceName}
                        </a>
                        <p>
                          {a.label} {a.sourceLocation}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="mb-2 text-left">
                  Effect on ending cash
                </caption>
                <thead>
                  <tr>
                    {[
                      "Month",
                      "Current forecast",
                      "With update",
                      "Difference",
                    ].map((label) => (
                      <th scope="col" className="p-2 text-left" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.monthlyChanges.map((m) => (
                    <tr key={m.month} className="border-t">
                      <th scope="row" className="p-2 text-left">
                        {m.month}
                      </th>
                      {[m.beforeMinor, m.afterMinor, m.deltaMinor].map(
                        (v, i) => (
                          <td key={i} className="p-2 tabular-nums">
                            {money(v, preview.currency)}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary className="cursor-pointer">
                Operating calculations and goal effects
              </summary>
              <div className="overflow-x-auto">
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="p-2 text-left">
                        Variable
                      </th>
                      {preview.path.operating.months.map((m) => (
                        <th scope="col" className="p-2" key={m}>
                          {m}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.model.nodes.map((n) => (
                      <tr key={n.id} className="border-t">
                        <th scope="row" className="p-2 text-left">
                          {n.label} · {n.unit}
                          <p className="font-normal">
                            {n.op}({n.args.join(", ")})
                          </p>
                        </th>
                        {preview.path.operating.values[n.id]?.map((v, i) => (
                          <td className="p-2 text-right" key={i}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="mt-3 list-disc pl-5">
                {preview.path.goals.map((g) => (
                  <li key={g.id}>
                    {g.after.goal.name}: {g.before.outcome} → {g.after.outcome}
                  </li>
                ))}
              </ul>
            </details>
            <Alert>
              <AlertTitle>Review before applying</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {preview.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                  {preview.path.forecast.exceptions.map((e, i) => (
                    <li key={`e-${i}`}>{e.reason}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
            <FieldGroup>
              <Field orientation="horizontal">
                <Checkbox
                  id="review-operating-update"
                  checked={reviewed}
                  disabled={busy}
                  onCheckedChange={(v) => setReviewed(v === true)}
                />
                <FieldLabel htmlFor="review-operating-update">
                  I reviewed source changes, operating effects and the
                  replacement cash schedule.
                </FieldLabel>
              </Field>
              <Button
                disabled={
                  busy ||
                  !reviewed ||
                  !!preview.path.forecast.exceptions.length ||
                  !preview.path.changes.length
                }
                onClick={() =>
                  act(async () => {
                    requestKey.current ??= crypto.randomUUID();
                    await read("/api/operating-connections", {
                      action: "save_update",
                      bindings: preview.live.bindings,
                      connectionId: preview.connectionId,
                      previewToken: preview.previewToken,
                      requestKey: requestKey.current,
                      acknowledgeAssumptions: true,
                    });
                    setReviewed(false);
                    setPreview(null);
                    await refresh();
                    setNotice(
                      "Update saved for approval in Decisions & outcomes. The current forecast is unchanged.",
                    );
                  })
                }
              >
                Save replacement for approval
              </Button>
            </FieldGroup>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
