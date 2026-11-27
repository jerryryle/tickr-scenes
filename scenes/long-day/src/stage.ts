// A single stop staged on its own, for working on the crew's chores without a journey around them
// (tools/stage.ts renders it; test/stage.ts checks it): the truck parked at the kerb heading +x at
// the origin, the pavement and a building's front along +z with its door by the truck's back (or
// none), and a stand-in for the Journey that plays the stop's chores (chores.ts planChores) on a
// clock of its own, as the journey's dwell does. Nothing in the scene imports this.
import { CARGO_BY_ID, TRUCK_SLOTS } from "./cargo.ts";
import { bedRearX, planChores } from "./chores.ts";
import type { Chore } from "./chores.ts";
import { CARGO_MODELS } from "./cargomodels.ts";
import { KERB } from "./grid.ts";
import { DWELL, Journey } from "./journey.ts";
import type { Aboard, DwellNow, Stop } from "./journey.ts";
import type { KerbDoor } from "./city.ts";
import { truckLayout } from "./truck.ts";
import type { TruckModel } from "./truck.ts";

export interface StageSpec {
  model: TruckModel;
  cargo: string;
  kind: "pickup" | "drop";
  units?: number;              // (default: the most one stop moves of it, at most 8)
  door?: boolean;              // a front door (default), or none (loads staged on the pavement)
  doorAt?: number;             // the door's middle along the truck (truck x; default: 2 m behind its back)
  victorian?: boolean;         // in the Victorian city (tools/stage.ts "vic")
  doorHalf?: number;           // half the doorway's width (default: wide enough for a pallet)
  wider?: number;              // metres more pavement between the kerb and the building (default 0)
}
export interface Stage {
  spec: StageSpec; stop: Stop; chores: Chore[]; kerbDoor: KerbDoor | null;
  kerbZ: number; wallZ: number;   // the kerb's edge and the building's front (world z)
  journey: Journey;               // the stand-in: set `time` (seconds into the dwell) and pass it to Crew.update
  length: number;                 // the dwell's length (s)
  setTime(t: number): void;
}

// A stage from its words: model cargo kind, then any of "nodoor", "door=x" (the door's middle
// along the truck), "half=x" (half the doorway's width) and "wider=x" (that much more pavement).
export function stageSpec(words: string[]): StageSpec {
  const [model, cargo, kind, ...rest] = words as [TruckModel, string, "pickup" | "drop", ...string[]];
  const bad = (why: string) => { throw new Error(`stage "${words.join(" ")}": ${why} (model cargo pickup|drop [nodoor | door=x] [half=x] [wider=x])`); };
  if (!model || !cargo || (kind !== "pickup" && kind !== "drop")) bad("needs a model, a cargo and pickup or drop");
  if (!(model in TRUCK_SLOTS)) bad(`no truck model "${model}"`);
  if (!CARGO_BY_ID.has(cargo)) bad(`no cargo "${cargo}"`);
  for (const w of rest) {
    const nums = w.startsWith("door=") || w.startsWith("half=") ? [w.slice(5)] : w.startsWith("wider=") ? [w.slice(6)] : w === "nodoor" ? [] : null;
    if (!nums || nums.some((n) => n === "" || !Number.isFinite(Number(n)))) bad(`can't read "${w}"`);
  }
  const at = rest.find((w) => w.startsWith("door=")), half = rest.find((w) => w.startsWith("half=")), wider = rest.find((w) => w.startsWith("wider="));
  return { model, cargo, kind, door: !rest.includes("nodoor"), doorAt: at ? Number(at.slice(5)) : undefined, doorHalf: half ? Number(half.slice(5)) : undefined, wider: wider ? Number(wider.slice(6)) : undefined };
}
export function makeStage(spec: StageSpec): Stage {
  const L = truckLayout(spec.model), c = CARGO_BY_ID.get(spec.cargo)!;
  const units = spec.units ?? Math.min(8, c.units[1]);
  const stop: Stop = { kind: spec.kind, site: { bx: 0, bz: 0, name: "Stage" } as any, job: 1, cargo: spec.cargo, units, slot: 0 };
  // The kerb a little out from the truck's side, the building's front KERB beyond it, the door
  // in it facing the street (-z).
  // (With no door, an open lot: the building well back, the loads staged on the pavement.)
  const door = spec.door ?? true, kerbZ = L.hw + 0.45, wallZ = kerbZ + KERB + (spec.wider ?? 0) + (door ? 0 : 9);
  // (Wide enough for a pallet, and for one on the pallet jack to go through flat, as the journey's
  // doors are: journey.ts doorTakes.)
  const pallet = c.handling === "palletJack" ? CARGO_MODELS[c.id]?.size[2] ?? 0 : 0;
  const dx = spec.doorAt ?? L.bedRear - 2, half = spec.doorHalf ?? Math.max(0.8, pallet / 2 + 0.1);
  const kerbDoor: KerbDoor | null = door ? { side: 0, a: 0, n: 0, x: dx, z: wallZ, nx: 0, nz: -1, frame: 0xf2efe8, panel: 0x23365e, half, h: 2.3, plain: false, wide: half > 0.7 } : null;
  // The bed: this stop's loads aboard for a drop, nothing else.
  const aboard: Aboard[] = spec.kind === "drop" ? [{ job: 1, cargo: c.id, units, slotsPerUnit: c.slots, dest: "0,0", slot: 0 }] : [];
  const own = [{ slot: 0, slotsPerUnit: c.slots, units }];
  const before = bedRearX(L, spec.model, spec.kind === "pickup" ? [] : own), after = bedRearX(L, spec.model, spec.kind === "pickup" ? own : []);
  // (In the truck's frame, half a metre out from the door, facing it: as the journey has it.)
  const doorFrame = kerbDoor ? { x: kerbDoor.x, z: kerbDoor.z - 0.5, yaw: -Math.PI / 2, half } : null;
  const chores = planChores(spec.model, stop, null, 0, before, after, doorFrame, [], null, [], true, 0, null);
  const choreStart: number[] = [];
  let s = 0;
  for (const q of chores) { choreStart.push(s); s += q.len; }
  const length = DWELL.park + s + DWELL.startup;
  const st: any = { mode: "dwell", modeTime: 0, simTime: 0, stops: [stop], aboard, truck: spec.model, city: 0, spare: null, parked: null, s: 0 };
  const j: any = {
    // (The city's clock, for the crew's idle motion: the dwell's time.)
    get clockTime() { return st.simTime; },
    st, frac: 0, country: null, countryU: -1, chores, choreStart, path: null, kerbDoor, stackMode: null, kerbSide: kerbZ,
    plan: { style: { victorian: !!spec.victorian } },   // (the city's style, which the crew dresses for: crew.ts)
    isDockStop: () => false, dockPlan: () => null, doorlessAhead: () => null, stackAhead: () => null,
    // (The front door as the journey has it: FrontDoorFx.)
    get frontDoorOpen() { return Object.getOwnPropertyDescriptor(Journey.prototype, "frontDoorOpen")!.get!.call(this); },
    dwellPhase(): DwellNow {
      const t = st.modeTime;
      if (t < DWELL.park || !chores.length) return { phase: "park", t, len: DWELL.park, chore: null, ct: 0 };
      const tc = t - DWELL.park, n = chores.length, end = choreStart[n - 1] + chores[n - 1].len;
      if (tc >= end) return { phase: "startup", t: tc - end, len: DWELL.startup, chore: null, ct: 0 };
      let i = 0;
      while (i < n - 1 && choreStart[i + 1] <= tc) i++;
      const q = chores[i];
      let g0 = i, g1 = i;
      while (g0 > 0 && chores[g0 - 1].group === q.group) g0--;
      while (g1 < n - 1 && chores[g1 + 1].group === q.group) g1++;
      return { phase: q.group, t: tc - choreStart[g0], len: choreStart[g1] + chores[g1].len - choreStart[g0], chore: q, ct: tc - choreStart[i] };
    },
  };
  return { spec, stop, chores, kerbDoor, kerbZ, wallZ, journey: j as Journey, length, setTime(t: number) { st.modeTime = t; st.simTime = t; } };
}
