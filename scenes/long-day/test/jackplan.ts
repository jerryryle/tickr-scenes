// Test: the pallet jack's planner (jackplan.ts) on fixed layouts. Every move it plans is clear of
// the world it was planned in (the truck, its walk ramp, the building's front, what stands on the
// pavement, the loads in the bed), the driver never leaps, and each move takes at least as long as
// rolling it, turning it or walking round it does. And where there is no way, it says so.
import { truckLayout } from "../src/truck.ts";
import { fetchSpots, planChores, RAMP_HW, tripCount } from "../src/chores.ts";
import { jackArc, jackBedJoin, jackDoorWays, jackDriverAt, jackJoin, jackMoveClear, jackMoveLen, jackPivot, jackPoseAt, jackReverse } from "../src/jackplan.ts";
import type { JackWorld, JMove, JPose } from "../src/jackplan.ts";
import { readConfig } from "../src/env.ts";
import { Journey, setDoorProbe, setParkedProbe, setPavementProbe } from "../src/journey.ts";
import { kerbDoors, parkedObstacles, pavementObstacles } from "../src/city.ts";
import { CARGO_MODELS } from "../src/cargomodels.ts";

const proc = (globalThis as any).process;
const errs: string[] = [];
const L = truckLayout("box26");
const PUMPKINS = [1.0, 0.95, 1.0], HOT_TUB = [2.1, 0.9, 2.1];
const world = (o: Partial<JackWorld>): JackWorld => ({ L, rampHW: RAMP_HW, free: L.bedFront, bed: [], door: null, load: null, ...o });
const box = (x0: number, x1: number, z0: number, z1: number) => ({ x0, x1, z0, z1 });
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const same = (p: JPose, q: JPose) => near(p.x, q.x, 1e-3) && near(p.z, q.z, 1e-3) && near(Math.atan2(Math.sin(p.h - q.h), Math.cos(p.h - q.h)), 0, 1e-3);
let moves = 0;
// A plan from a to b: there, each move clear, joined end to end, each timed at least as it must be.
function check(name: string, w: JackWorld, ms: JMove[] | null, a: JPose, b: JPose) {
  if (!ms) { errs.push(`${name}: no plan`); return; }
  if (!ms.length) { if (!same(a, b)) errs.push(`${name}: an empty plan between different poses`); return; }
  if (!same(ms[0].p0, a)) errs.push(`${name}: starts at ${JSON.stringify(ms[0].p0)}, not ${JSON.stringify(a)}`);
  if (!same(ms[ms.length - 1].p1, b)) errs.push(`${name}: ends at ${JSON.stringify(ms[ms.length - 1].p1)}, not ${JSON.stringify(b)}`);
  ms.forEach((m, i) => {
    moves++;
    if (i && !same(ms[i - 1].p1, m.p0)) errs.push(`${name}: move ${i} starts where move ${i - 1} didn't end`);
    if (!jackMoveClear(w, { ...m })) errs.push(`${name}: move ${i} (${m.kind}) is blocked`);
    const len = jackMoveLen(m, 1.25, 1.0, 1.6), d = Math.hypot(m.p1.x - m.p0.x, m.p1.z - m.p0.z);
    if (m.kind === "roll" && len < d / 1.25) errs.push(`${name}: move ${i} rolls ${d.toFixed(2)} m in ${len.toFixed(2)} s`);
    if (m.kind === "pivot" && len < Math.abs(Math.atan2(Math.sin(m.p1.h - m.p0.h), Math.cos(m.p1.h - m.p0.h)))) errs.push(`${name}: move ${i} turns too fast`);
    let px = NaN, pz = NaN;
    for (let k = 0; k <= 40; k++) {
      const [x, z] = jackDriverAt(m, k / 40);
      if (Math.hypot(x - px, z - pz) > 0.6) errs.push(`${name}: move ${i}'s driver leaps`);
      px = x; pz = z;
    }
  });
}

// In an empty bed: up from the ramp's top, forks to the street, turned round to set a load down
// against the front wall.
{
  const w = world({ load: PUMPKINS }), a = { x: -1.96, z: 0, h: Math.PI }, b = { x: 3.0, z: 0, h: 0 };
  check("empty bed, turned", w, jackBedJoin(w, a, b, a.x), a, b);
}
// In the bed, a pallet beside the next (two columns): back out from the spot just left, and turned
// to go down the ramp, between the loads and the bed's back.
{
  const w = world({ bed: [box(2.36, 3.36, -1.07, -0.07), box(3.51, 4.51, 0.07, 1.07), box(3.51, 4.51, -1.07, -0.07)] });
  const a = { x: 1.6, z: 0.575, h: 0 }, b = { x: -1.96, z: 0, h: Math.PI };
  check("two columns, out", w, jackBedJoin(w, a, b, b.x), a, b);
}
// No room to turn a hot tub in the bed: none.
{
  const w = world({ load: HOT_TUB });
  if (jackPivot(w, { x: 1, z: 0, h: 0 }, Math.PI / 2)) errs.push("a hot tub turned across the bed");
}
// A shop door beside the truck, a narrow pavement: the hot tub out through it, turning as it comes.
{
  const w = world({ load: HOT_TUB, door: { x: 0.22, z: 4.9, nx: 0, nz: -1, half: 1.2 } }), a = { x: 0.22, z: 6.08, h: -Math.PI / 2 };
  const ways = jackDoorWays(w, a, 4);
  if (!ways.length) errs.push("hot tub: no way out of a wide door beside the truck");
  for (const [i, ms] of ways.entries()) check(`hot tub door way ${i}`, w, ms, a, ms[ms.length - 1].p1);
}
// A house door beside the truck: out of it, then along the pavement to behind the truck's ramp.
{
  const w = world({ load: PUMPKINS, door: { x: 4.28, z: 4.9, nx: 0, nz: -1, half: 1.2 } });
  const a = { x: 4.28, z: 6.08, h: -Math.PI / 2 }, ways = jackDoorWays(w, a, 4);
  if (!ways.length) errs.push("house door: no way out of it");
  const to = { x: L.bedRear - L.rampRun - 0.88 - 0.35, z: 0, h: Math.PI };
  let plan: JMove[] | null = null;
  for (const way of ways) {
    const rest = jackJoin(w, way[way.length - 1].p1, [[-9, 3.1]], to);
    if (rest) { plan = [...way, ...rest]; break; }
  }
  check("house door, out to the ramp", w, plan, a, to);
}
// Nothing goes through a wall: straight back from a door into the building's front beside it.
{
  const w = world({ door: { x: 0, z: 4.9, nx: 0, nz: -1, half: 0.6 } });
  if (jackMoveClear(w, { kind: "roll", p0: { x: 1.5, z: 3.5, h: -Math.PI / 2 }, p1: { x: 1.5, z: 5.5, h: -Math.PI / 2 } })) errs.push("a roll through the wall beside the door was clear");
}
// Arcs: a quarter turn drawn back round a 2 m curve ends 2 m back and 2 m over; played backwards,
// the same way.
{
  const m = jackArc({ x: 0, z: 0, h: 0 }, -Math.PI, Math.PI / 2);
  if (!same(m.p1, { x: -2, z: 2, h: Math.PI / 2 })) errs.push(`arc ends at ${JSON.stringify(m.p1)}`);
  const r = jackReverse([m])[0];
  for (const u of [0.25, 0.5, 0.75]) if (!same(jackPoseAt(r, u), jackPoseAt(m, 1 - u))) errs.push(`arc reversed differs at ${u}`);
}

// A doorless drop of several pallets: each trip's set down on its own spot on the pavement, side
// by side, as far apart as the load is across its corners (so one turned to be set down clears
// the next).
{
  const stop = { kind: "drop" as const, site: null, job: 0, cargo: "pumpkins", units: 4, slot: 0 }, trips = tripCount(L, stop.cargo, stop.units);
  const spots = fetchSpots(planChores("box26", stop)), sz = CARGO_MODELS[stop.cargo].size, gap = Math.hypot(sz[0], sz[2]);
  if (trips < 2) errs.push(`doorless drop: ${trips} trip(s), wanted several`);
  if (spots.length !== trips || spots.some((s) => !s)) errs.push(`doorless drop: ${spots.length} fetch spots for ${trips} trips`);
  for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) {
    const p = spots[a], q = spots[b];
    if (p && q && Math.hypot(p.spot[0] - q.spot[0], p.spot[2] - q.spot[2]) < gap) errs.push(`doorless drop: trips ${a} and ${b} set down ${Math.hypot(p.spot[0] - q.spot[0], p.spot[2] - q.spot[2]).toFixed(2)} m apart`);
  }
}

// Whole stops (chores.ts jackLegs): a pallet jack's walks all planned or none, and on the walk
// ramp the forks downhill (the driver above them), unless the load can't be turned in the bed.
// (Seed 6's first 40 minutes: a shop door beside the truck.)
let stops = 0, planned = 0;
{
  setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
  const j = new Journey(readConfig({ seed: 6 } as any), 0, "autumn");
  let last: unknown = null;
  while (j.st.simTime < 40 * 60) {
    j.step();
    const plan = j.chores;
    if (!plan.length || plan === last) continue;
    last = plan;
    const walks = plan.filter((c) => c.kind === "walk" && c.tool === "palletJack");
    if (!walks.length) continue;
    stops++;
    const done = walks.filter((c) => c.jack).length;
    if (done) planned++;
    if (done && done < walks.length) errs.push(`t${j.st.simTime.toFixed(0)}: ${done} of ${walks.length} pallet jack walks planned`);
    const foot = L.bedRear - L.rampRun;
    for (const c of walks) {
      const m = c.jack;
      if (!m || m.kind !== "roll" || Math.abs(m.p0.z) > 0.1 || Math.min(m.p0.x, m.p1.x) > foot + 0.5 || Math.max(m.p0.x, m.p1.x) < L.bedRear - 0.5) continue;
      // (A load that can't be turned in the bed goes up forks first.)
      const sz = c.item ? CARGO_MODELS[j.st.stops[0]?.cargo ?? ""]?.size : null;
      if (sz && !jackPivot(world({ load: sz }), { x: 1.3, z: 0, h: Math.PI }, 0)) continue;
      if (Math.abs(m.p0.x - m.p1.x) > 2 && Math.cos(m.p0.h) > 0)
        errs.push(`t${j.st.simTime.toFixed(0)}: forks uphill on the ramp`);
    }
  }
  if (!planned) errs.push("seed 6: no pallet jack stop planned");
}

console.log(`jack plan: ${moves} planned moves checked; ${planned} of ${stops} pallet jack stops planned whole`);
for (const e of errs.slice(0, 20)) console.log("  " + e);
if (errs.length) proc.exit(1);
