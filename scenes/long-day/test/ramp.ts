// Test: at kerb stops with a walk ramp, a hand truck stays on the ramp. Plans the journey's stops,
// builds the driver's path through each (crewpath.ts, with the walks' lines and the hand truck's
// hold as crew.ts gives them), and fails if the hand truck is ever half on the ramp (a wheel over
// its side) or beside it while the driver is on it: turned on the ramp, it would ride up or down
// beside it. (Wheeled along the road past it is fine; so is its toe, down at the road.)
// Args (all optional): minutes [env-json]. With none, seeds 0, 2 and 7 for 40 minutes each.
import { readConfig } from "../src/env.ts";
import { Journey, setDoorProbe, setParkedProbe, setPavementProbe } from "../src/journey.ts";
import { kerbDoors, parkedObstacles, pavementObstacles } from "../src/city.ts";
import { truckLayout } from "../src/truck.ts";
import { CARGO_BY_ID } from "../src/cargo.ts";
import { HT_LEAD, RAMP_HW, STYLE } from "../src/chores.ts";
import type { Chore } from "../src/chores.ts";
import { buildCrewPath, EMPTY_HOLD } from "../src/crewpath.ts";
import { handTruckHold, roundAt } from "../src/crew.ts";
import type { Hold, Nominal } from "../src/crewpath.ts";

const proc = (globalThis as any).process;
setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
const runs: [number, string][] = proc.argv.length > 2 ? [[Number(proc.argv[2]), proc.argv[3] ?? "{}"]] : [[40, '{"seed":0}'], [40, '{"seed":2}'], [40, '{"seed":7}']];
// The hand truck as crew.ts holds it: its wheels HT_LEAD ahead of the driver's feet, this far
// either side of its middle.
const LEAD = HT_LEAD, WHEEL_Z = 0.2;
const TOE = 0.3;        // m of the ramp's foot end low enough to roll off sideways unseen
const errs: string[] = [];
let stops = 0, samples = 0, worst = -Infinity;
for (const [minutes, envJson] of runs) {
  const j = new Journey(readConfig(JSON.parse(envJson) as SceneEnv), 0, "autumn");
  let last: Chore[] | null = null;
  while (j.st.simTime < minutes * 60) {
    j.step();
    const plan = j.chores;
    if (!plan.length || plan === last) continue;
    last = plan;
    const stop = (j as any).dwellStop ?? j.st.stops[0], L = truckLayout(j.st.truck);
    if (!stop?.site || stop.kind === "swap" || j.isDockStop(stop) || L.loader !== "ramp") continue;
    if (STYLE[CARGO_BY_ID.get(stop.cargo)!.handling].tool !== "handTruck") continue;
    stops++;
    const spot = (c: Chore) => { for (let k = plan.indexOf(c) - 1; k >= 0; k--) if (plan[k].b) return plan[k].b!; return [0, 0, 0]; };
    const nominal = (c: Chore, u: number): Nominal => {
      if (c.kind === "walk" && c.round) { const r = roundAt(L, c, u); return { x: r.x, z: r.z, yaw: r.yaw, exact: false }; }
      if (c.kind === "walk") { const a = c.a!, b = c.b!; return { x: a[0] + (b[0] - a[0]) * u, z: a[2] + (b[2] - a[2]) * u, yaw: NaN, exact: false }; }
      const at = spot(c);
      return { x: at[0], z: at[2], yaw: c.face ?? NaN, exact: c.kind === "doorOpen" || c.kind === "doorClose" };
    };
    // (What is in hand, as crew.ts crewPath's hold has it.)
    const held = (c: Chore, u: number): { tool: boolean; item: boolean } => {
      const i = plan.indexOf(c), prev = plan[i - 1], next = plan[i + 1];
      let item = !!c.item, t = !!c.tool;
      if (c.kind === "stow") { item = prev?.item ? u < 0.6 : !!next?.item && u > 0.4; t = !!(prev?.tool ?? next?.tool ?? true); }
      if (c.kind === "fetch") item = (!!next?.item && u > 0.5) || (!!prev?.item && u < 0.5);
      if (c.kind === "toolGet") t = u > 0.55;
      if (c.kind === "toolPut") t = u < 0.45;
      return { tool: t, item };
    };
    const hold = (c: Chore, u: number): Hold => {
      const h = held(c, u);
      return h.tool ? handTruckHold(h.item) : EMPTY_HOLD;
    };
    const P = buildCrewPath(plan, nominal, hold, 0);
    // While the ramp is down: from the end of its rampOut to the start of its rampIn.
    const iOut = plan.findIndex((c) => c.kind === "rampOut"), iIn = plan.findIndex((c) => c.kind === "rampIn");
    if (iOut < 0 || iIn < 0) continue;
    const t0 = P.starts[iOut] + plan[iOut].len, t1 = P.starts[iIn];
    let ci = 0, bad = 0;
    for (let s = Math.ceil(t0 * P.rate); s < Math.floor(t1 * P.rate); s++) {
      const t = s / P.rate;
      while (ci < plan.length - 1 && t >= P.starts[ci + 1]) ci++;
      const c = plan[ci];
      if (!held(c, (t - P.starts[ci]) / c.len).tool || c.kind === "toolGet" || c.kind === "toolPut") continue;
      const wx = P.x[s] + Math.cos(P.yaw[s]) * LEAD, wz = P.z[s] - Math.sin(P.yaw[s]) * LEAD;
      const over = (x: number) => x > L.bedRear - L.rampRun + TOE && x < L.bedRear;   // (over the ramp's length)
      const onRamp = over(P.x[s]) && Math.abs(P.z[s]) < RAMP_HW;
      if (!over(wx) || (!onRamp && Math.abs(wz) - WHEEL_Z >= RAMP_HW)) continue;   // (its wheels past the ramp's side, the driver too)
      samples++;
      const off = Math.abs(wz) + WHEEL_Z - RAMP_HW;
      worst = Math.max(worst, off);
      if (off > 0) bad++;
    }
    if (bad && errs.length < 10) errs.push(`t${j.st.simTime.toFixed(0)} ${stop.site.name ?? ""} (${stop.kind} ${stop.cargo}): hand truck off the ramp's side for ${(bad / P.rate).toFixed(1)} s`);
  }
}
console.log(`ramp: ${stops} kerb stops with a hand truck and a walk ramp, ${samples} samples over the ramp, worst ${worst > 0 ? `${worst.toFixed(2)} m off its side` : `${(-worst).toFixed(2)} m inside its edge`}`);
if (!stops) errs.push("no kerb stops with a hand truck and a walk ramp");
for (const e of errs) console.log("  " + e);
if (errs.length) proc.exit(1);
