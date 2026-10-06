"use client";
import { useState } from "react";
import type { OperatingModel } from "@balsa/finance-engine";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export function OperatingRelationships({ model }: { model: OperatingModel }) {
  const [id, setId] = useState(
    model.outputs[0]?.nodeId ?? model.nodes[0]?.id ?? "",
  );
  const node = model.nodes.find((n) => n.id === id) ?? model.nodes[0];
  if (!node) return null;
  const parents = node.args.map(
    (key) => model.nodes.find((n) => n.id === key)!,
  );
  const children = model.nodes.filter((n) => n.args.includes(node.id));
  return (
    <section
      className="flex flex-col gap-3"
      aria-label="Explore operating relationships"
    >
      <h3 className="text-lg font-semibold">Trace how the business works</h3>
      <p className="text-sm text-muted-foreground">
        Explore the proposed dependencies. An arrow expresses a modeling
        assumption, not evidence that one variable causes another.
      </p>
      <Select value={node.id} onValueChange={setId}>
        <SelectTrigger aria-label="Variable to trace">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {model.nodes.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <h4 className="font-medium">Inputs to this calculation →</h4>
          {parents.length ? (
            parents.map((n) => (
              <Button variant="outline" key={n.id} onClick={() => setId(n.id)}>
                {n.label}
                {node.op === "lag" ? " · prior month" : ""}
              </Button>
            ))
          ) : (
            <p className="text-sm">Dated input assumption</p>
          )}
        </div>
        <div className="rounded-lg border p-4">
          <h4 className="font-semibold">
            {node.label} · {node.unit}
          </h4>
          <p className="mt-2 break-words font-mono text-sm">
            {node.op}({node.args.join(", ")})
          </p>
          <p className="mt-2 text-sm">{node.rationale}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {node.op !== "input"
              ? "Calculated relationship; validity depends on assumptions"
              : node.basis === "user_assumption"
                ? "User assumption"
                : node.basis === "ai_suggestion"
                  ? "AI suggestion"
                  : "Unclassified assumption"}
          </p>
          {node.evidenceIds.map((source) => (
            <a
              key={source}
              className="mt-2 block text-sm underline"
              href={`/api/evidence/${source}/file`}
              target="_blank"
              rel="noreferrer"
            >
              Inspect referenced evidence
            </a>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="font-medium">→ Affects these calculations</h4>
          {children.map((n) => (
            <Button variant="outline" key={n.id} onClick={() => setId(n.id)}>
              {n.label}
              {n.op === "lag" ? " · next month" : ""}
            </Button>
          ))}
          {model.outputs
            .filter((o) => o.nodeId === node.id)
            .map((o) => (
              <p className="text-sm" key={o.nodeId}>
                {o.label} → cash {o.direction === "receipt" ? "in" : "out"}
              </p>
            ))}
          {!children.length &&
            !model.outputs.some((o) => o.nodeId === node.id) && (
              <p className="text-sm">No downstream cash mapping</p>
            )}
        </div>
      </div>
    </section>
  );
}
