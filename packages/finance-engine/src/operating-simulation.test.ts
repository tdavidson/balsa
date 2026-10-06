import { describe, it, expect } from "vitest";
import {
  sampleOperatingWorlds,
  valueOperatingPath,
  operatingRankAssociation,
  summarizeSampledAmounts,
} from "./operating-simulation";
import {
  evaluateOperatingModel,
  type OperatingModel,
  type OperatingNode,
} from "./operating-model";
const input = (id: string, value: string, unit = "units"): OperatingNode => ({
  id,
  label: id,
  unit,
  op: "input",
  args: [],
  values: [{ month: "2026-01", value }],
  initial: null,
  rationale: "Synthetic assumption",
  evidenceIds: [],
});
const calc = (
  id: string,
  op: OperatingNode["op"],
  args: string[],
  unit = "units",
): OperatingNode => ({ ...input(id, "0", unit), op, args, values: [] });
const model: OperatingModel = {
  name: "Synthetic stores",
  description: "Local demand cannibalization and shared delivery capacity",
  startMonth: "2026-01",
  months: 4,
  nodes: [
    input("market", "100"),
    input("new_store", "20"),
    input("capacity", "120"),
    input("price", "10", "USD"),
    calc("old_demand", "subtract", ["market", "new_store"]),
    calc("old_delivered", "min", ["old_demand", "capacity"]),
    calc("remaining", "subtract", ["capacity", "old_delivered"]),
    calc("new_delivered", "min", ["new_store", "remaining"]),
    calc("old_cash", "multiply", ["old_delivered", "price"], "USD"),
    calc("new_cash", "multiply", ["new_delivered", "price"], "USD"),
  ],
  outputs: [
    {
      nodeId: "old_cash",
      label: "Existing store",
      direction: "receipt",
      category: "other",
    },
    {
      nodeId: "new_cash",
      label: "New store",
      direction: "receipt",
      category: "other",
    },
  ],
  cases: [],
  limitations: ["Synthetic"],
};
const settings = {
  seed: 42,
  count: 32,
  parameters: [
    {
      nodeId: "market",
      from: "2026-01",
      low: "80",
      high: "140",
      group: "local",
      inverse: false,
      rationale: "Assumed uniform demand",
    },
    {
      nodeId: "new_store",
      from: "2026-01",
      low: "10",
      high: "30",
      group: "local",
      inverse: true,
      rationale: "Inverse coupled share",
    },
  ],
  entities: [
    { id: "old", name: "Old store", cohort: "Mature", nodeIds: ["old_cash"] },
    {
      id: "new",
      name: "New store",
      cohort: "Expansion",
      nodeIds: ["new_cash"],
    },
  ],
};
describe("bounded interacting operating simulations", () => {
  it("reproduces worlds and jointly samples explicit inverse ranks", () => {
    const a = sampleOperatingWorlds(model, "base", settings);
    expect(a).toEqual(sampleOperatingWorlds(model, "base", settings));
    expect(a.paths[0]!.draws.reduce((n, d) => n + BigInt(d.rank), 0n)).toBe(
      4294967295n,
    );
    expect(a).not.toEqual(
      sampleOperatingWorlds(model, "base", { ...settings, seed: 43 }),
    );
  });
  it("reconciles entity cash, cannibalization and the shared resource limit in stores and teams", () => {
    for (const domain of [
      model,
      {
        ...model,
        name: "Synthetic teams",
        description: "Teams share demand and delivery capacity",
      },
    ])
      for (const path of sampleOperatingWorlds(domain, "base", settings)
        .paths) {
        expect(path.status).toBe("available");
        if (path.status !== "available") continue;
        expect(
          Number(path.operating.values.old_delivered![0]) +
            Number(path.operating.values.new_delivered![0]),
        ).toBeLessThanOrEqual(120);
        expect(
          path.entities.reduce((s, e) => s + BigInt(e.cash[0]!.netMinor), 0n),
        ).toBe(
          path.operating.cash
            .filter((c) => c.month === "2026-01")
            .reduce((s, c) => s + BigInt(c.amountMinor), 0n),
        );
      }
  });
  it("changes the sampled distribution when the cannibalization mechanism changes",()=>{
    const alternative:OperatingModel={...model,nodes:[...model.nodes.filter(n=>n.id!=="old_demand"),input("cannibalization_rate","0.5","ratio"),calc("lost_demand","multiply",["new_store","cannibalization_rate"]),calc("old_demand","subtract",["market","lost_demand"])]};
    const amounts=(m:OperatingModel)=>sampleOperatingWorlds(m,"base",settings).paths.flatMap(p=>p.status==="available" ? [{index:p.index,amountMinor:String(p.operating.cash.reduce((n,c)=>n+BigInt(c.amountMinor),0n))}] : []);
    const before=summarizeSampledAmounts(amounts(model),32,"0"),after=summarizeSampledAmounts(amounts(alternative),32,"0");
    expect(BigInt(after.p50!.amountMinor)).toBeGreaterThan(BigInt(before.p50!.amountMinor));
  });
  it("uses the same primitives for a services team with capacity limits and delayed collections",()=>{
    const team:OperatingModel={...model,name:"Synthetic service team",description:"Demand, shared capacity and a one-month collection delay",nodes:[input("hours_requested","100","hours"),input("hours_available","120","hours"),input("hourly_rate","100","USD/hour"),calc("delivered_hours","min",["hours_requested","hours_available"],"hours"),calc("invoice","multiply",["delivered_hours","hourly_rate"],"USD"),{...calc("collected","lag",["invoice"],"USD"),initial:"0"}],outputs:[{nodeId:"collected",label:"Client collections",direction:"receipt",category:"other"}]};
    const study=sampleOperatingWorlds(team,"base",{seed:42,count:16,parameters:[{nodeId:"hours_requested",from:"2026-01",low:"80",high:"140",group:"",inverse:false,rationale:"Synthetic demand assumption"}],entities:[{id:"delivery",name:"Delivery team",cohort:"Services",nodeIds:["delivered_hours","collected"]}]});
    for(const path of study.paths){expect(path.status).toBe("available");if(path.status!=="available")continue;expect(path.operating.values.collected![0]).toBe("0");expect(path.operating.values.collected![1]).toBe(path.operating.values.invoice![0]);expect(Number(path.operating.values.delivered_hours![0])).toBeLessThanOrEqual(120);expect(path.entities[0]!.cash[1]!.netMinor).toBe(path.operating.cash.find(c=>c.month==="2026-02")!.amountMinor);}
  });
  it("preserves failures and rejects ambiguous entities or unbounded compute", () => {
    expect(() =>
      sampleOperatingWorlds(model, "base", { ...settings, count: 65 }),
    ).toThrow();
    expect(() =>
      sampleOperatingWorlds(model, "base", {
        ...settings,
        entities: [
          ...settings.entities,
          {
            id: "duplicate",
            name: "Duplicate",
            cohort: "Other",
            nodeIds: ["old_cash"],
          },
        ],
      }),
    ).toThrow();
    const failed = sampleOperatingWorlds(model, "base", {
      ...settings,
      parameters: [{ ...settings.parameters[0]!, low: "1", high: "2" }],
    });
    expect(failed.paths.every((p) => p.status === "unavailable")).toBe(true);
    expect(summarizeSampledAmounts([], 32, "0")).toMatchObject({
      failed: 32,
      p50: null,
    });
  });
  it("uses exact explicit valuation and exposes rank sensitivity without causal claims", () => {
    const run = evaluateOperatingModel(model);
    const value = valueOperatingPath(run, {
      nodeId: "old_cash",
      annualDiscount: "0",
      terminalMultiple: "0",
      priceMinor: "320000",
      basis: "Synthetic unlevered monthly cash",
    });
    expect(value.presentValueMinor).toBe("320000");
    expect(value.distanceFromPriceMinor).toBe("0");
    expect(
      operatingRankAssociation(
        Array.from({ length: 10 }, (_, i) => ({
          input: String(i),
          outputMinor: String(i * 100),
        })),
      ),
    ).toBe(1);
    expect(
      operatingRankAssociation(
        Array.from({ length: 10 }, () => ({ input: "1", outputMinor: "100" })),
      ),
    ).toBeNull();
  });
});
