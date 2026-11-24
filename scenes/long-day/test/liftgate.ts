// Test: the reefer's lift gate chores (chores.ts planChores), for each of its cargoes, picked up
// and dropped, with no door (at each of the pavement's spots) and with a front door on either
// side. The driver works the gate from beside it, never standing on it as it comes out or goes
// in; each walk or ride starts where the driver last was (no jumps); and on each ride the driver
// stands on the platform with what they hold on it too: up it, facing the truck, the load short
// of the body's back; down it, facing out, the hand truck's wheels on the platform.
import { CARGO, CARGO_BY_ID } from "../src/cargo.ts";
import { CARGO_MODELS } from "../src/cargomodels.ts";
import { HT_LEAD, planChores, pushGap, STYLE } from "../src/chores.ts";
import type { Chore } from "../src/chores.ts";
import { GATE_LEN, truckLayout } from "../src/truck.ts";

const L = truckLayout("reefer"), rear = L.bedRear, outer = rear - GATE_LEN;
const errs: string[] = [];
let rides = 0, plans = 0;
// How far ahead of the driver's feet what they hold reaches (m), generously.
const reach = (cargo: string) => {
  const c = CARGO_BY_ID.get(cargo)!, [l, h] = CARGO_MODELS[cargo]?.size ?? [0.5, 0.5];
  const tool = STYLE[c.handling].tool;
  return tool === "handTruck" ? HT_LEAD + 0.04 + l : c.handling === "push" ? pushGap(h) + l : 0.35 + l;
};
const doors: ({ x: number; z: number; yaw: number } | null)[] = [null, { x: rear + 2, z: L.hw + 3, yaw: Math.PI / 2 }, { x: rear + 2, z: -L.hw - 3, yaw: -Math.PI / 2 }];
for (const cargo of CARGO.filter((c) => c.truck === "reefer").map((c) => c.id)) {
  const c = CARGO_BY_ID.get(cargo)!, units = Math.max(1, Math.min(8, c.units[1]));
  for (const kind of ["pickup", "drop"] as const) for (const door of doors) for (const pave of door ? [0] : [0, 1, 2]) {
    const what = `${kind} ${cargo}${door ? ` door at z ${door.z.toFixed(1)}` : ` (no door, pavement spot ${pave})`}`;
    const plan: Chore[] = planChores("reefer", { kind, site: null, job: 0, cargo, units, slot: 0 }, null, 0, null, null, door, [], [], null, [], true, pave);
    plans++;
    let at: number[] | null = null;
    for (const q of plan) {
      if (q.a && at && Math.hypot(q.a[0] - at[0], q.a[2] - at[2]) > 0.05) errs.push(`${what}: ${q.kind} starts at ${q.a[0].toFixed(2)},${q.a[2].toFixed(2)}, the driver at ${at[0].toFixed(2)},${at[2].toFixed(2)}`);
      if ((q.kind === "gateOut" || q.kind === "gateIn") && at && at[0] > outer - 0.3 && at[0] < rear && Math.abs(at[2]) < L.hw - 0.15 + 0.3)
        errs.push(`${what}: ${q.kind} worked from ${at[0].toFixed(2)},${at[2].toFixed(2)}, on the gate`);
      if (q.kind === "gateRide") {
        rides++;
        const x = q.a![0], held = q.item || q.tool ? reach(cargo) : 0.3;
        if (x < outer + 0.15 || x > rear - 0.15 || Math.abs(q.a![2]) > 0.3) errs.push(`${what}: rides ${q.dir} at ${x.toFixed(2)}, off the platform (${outer.toFixed(2)}..${rear.toFixed(2)})`);
        if (q.dir === "up" && x + held > rear - 0.05) errs.push(`${what}: rides up with what's held reaching ${(x + held).toFixed(2)}, into the body's back at ${rear.toFixed(2)}`);
        if (q.dir === "down" && q.tool === "handTruck" && x - HT_LEAD < outer + 0.05) errs.push(`${what}: rides down with the hand truck's wheels at ${(x - HT_LEAD).toFixed(2)}, off the platform's end at ${outer.toFixed(2)}`);
      }
      if (q.b) at = q.b;
    }
  }
}
if (!rides) errs.push("no lift gate rides planned");
console.log(`lift gate: ${plans} plans, ${rides} rides`);
if (errs.length) { for (const e of errs.slice(0, 20)) console.log("FAIL " + e); (globalThis as any).process.exit(1); }
