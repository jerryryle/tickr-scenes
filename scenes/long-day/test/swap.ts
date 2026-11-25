// Test: a truck swap at a Ryder lot plays smoothly. At the hand-over the new truck is drawn where
// it stands from the first frame (not blended over a step from where the old one stood, which slid
// it out of the old truck: journey.ts doStop), with its trailer, if any, straight; and the driver's
// facing never snaps round from the climb down, through the walk, into the climb up (crew.ts
// walkBetween ends facing where the climb in starts), nor stops short of the new door on the
// walk, its start and end ramps apart (director.ts swapWalkU). Seed 0 swaps about 4279 s in, for a
// flatbed; seed 16 about 597 s in, for a tractor (whose trailer is the one to stand straight).
// Args (all optional): seed:minutes ...
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT, SWAP_RAMP } from "../src/journey.ts";
import type { Pose } from "../src/route.ts";
import { Truck, TruckKit } from "../src/truck.ts";
import type { TruckModel } from "../src/truck.ts";
import { Crew } from "../src/crew.ts";

const proc = (globalThis as any).process;
const runs: string[] = proc.argv.length > 2 ? proc.argv.slice(2) : ["0:72", "16:11"];
const errs: string[] = [];
const fail = (m: string) => { if (errs.length < 20) errs.push(m); };
const TURN = 0.3;   // rad in a step (0.1 s): a snap round, not a turn on foot
const STROLL = 0.5;   // m/s: slower than this on the walk, away from its ends, is standing about
const kit = new TruckKit(new Proxy({}, { get: () => ({ width: 1, height: 1 }) }) as any);
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
const turnBy = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
let handovers = 0, walked = 0, intoTractor = 0;

for (const run of runs) {
  const [seed, minutes] = run.split(":").map(Number);
  const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
  const crew = new Crew(scene, new THREE.MeshLambertMaterial());
  const trucks = new Map<TruckModel, Truck>(), trucks2 = new Map<TruckModel, Truck>();
  const truckFor = (m: TruckModel, map = trucks) => { let t = map.get(m); if (!t) { t = new Truck(kit, m, null); scene.add(t.root); map.set(m, t); } return t; };
  const pose = {} as Pose, rp = {} as Pose;
  let lastYaw: number | null = null, lastKind = "", lastAt: THREE.Vector3 | null = null, runHandovers = 0;
  for (let i = 0, n = Math.round(minutes * 60 / SIM_DT); i < n; i++) {
    const before = j.st.truck;
    j.step();
    const st = j.st;
    // The hand-over: half a step on, the new truck is drawn where it stands, its trailer straight.
    if (st.truck !== before && st.mode === "dwell") {
      handovers++; runHandovers++; if (st.truck === "tractor") intoTractor++;
      const frac = j.frac;
      j.frac = -SIM_DT / 2;
      j.renderPose(rp);
      const off = Math.hypot(rp.x - j.pose.x, rp.z - j.pose.z), hitch = j.renderHitchYaw();
      j.frac = frac;
      if (off > 1e-6) fail(`seed ${seed} t${st.simTime.toFixed(1)} ${before}->${st.truck}: drawn ${off.toFixed(2)} m from where it stands half a step after the hand-over`);
      if (Math.abs(hitch) > 1e-6) fail(`seed ${seed} t${st.simTime.toFixed(1)} ${before}->${st.truck}: trailer drawn at ${hitch.toFixed(3)} rad off straight after the hand-over`);
    }
    const stop = st.stops[0];
    if (st.mode !== "dwell" || stop?.kind !== "swap") { lastYaw = null; lastKind = ""; lastAt = null; continue; }
    // The driver through the stop, as main.ts animates it (the spare ahead, then the old truck parked).
    const truck = truckFor(st.truck), p = j.renderPose(pose);
    truck.follow(p.x, p.z, p.h, p.k, 0);
    const om = st.spare ?? st.parked?.model ?? null;
    let other: Truck | null = null;
    if (om) { other = om === st.truck ? truckFor(om, trucks2) : truckFor(om); if (st.spare) j.sparePose(pose); else if (st.parked) { pose.x = st.parked.x; pose.z = st.parked.z; pose.h = st.parked.h; } other.follow(pose.x, pose.z, pose.h, 0, 0); }
    crew.update(SIM_DT, j, truck, other, cam);
    const ph = j.dwellPhase();
    if (!ph.chore) { lastYaw = null; lastKind = ""; lastAt = null; continue; }   // (in the seat)
    // On the walk, going at a walk but for getting going and slowing to a stop at the new door.
    const at = crew.driver.root.getWorldPosition(new THREE.Vector3());
    if (ph.chore.kind === "walk") {
      walked++;
      const v = lastAt && lastKind === "walk" ? Math.hypot(at.x - lastAt.x, at.z - lastAt.z) / SIM_DT : Infinity;
      if (ph.ct > SWAP_RAMP + SIM_DT && ph.ct < ph.chore.len - SWAP_RAMP && v < STROLL)
        fail(`seed ${seed} t${st.simTime.toFixed(1)} walk (${ph.ct.toFixed(2)}/${ph.chore.len.toFixed(2)} s): the driver stands about (${v.toFixed(2)} m/s) short of the new truck`);
    }
    lastAt = at;
    // (The walk, and its joins with the climbs: the climbs' own turns are their keys'.)
    const yaw = new THREE.Euler().setFromQuaternion(crew.driver.root.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y;
    if (lastYaw !== null && (ph.chore.kind === "walk" || lastKind === "walk") && Math.abs(turnBy(yaw - lastYaw)) > TURN)
      fail(`seed ${seed} t${st.simTime.toFixed(1)} ${lastKind}->${ph.chore.kind} (${ph.phase} ${ph.t.toFixed(2)}/${ph.len.toFixed(2)} s): the driver turns ${turnBy(yaw - lastYaw).toFixed(2)} rad in a step`);
    lastYaw = yaw; lastKind = ph.chore.kind;
  }
  // (Each run is here for its swap: if the journey changes and one moves out of its minutes, find it again.)
  if (!runHandovers) fail(`seed ${seed}: no swap hand-over in ${minutes} min: find it again (test/journey.ts with JTLOG lists them) and move the run`);
}
console.log(`swap: ${handovers} hand-overs, ${(walked * SIM_DT).toFixed(0)} s of walks between trucks watched`);
if (!proc.argv[2] && !intoTractor) fail("no swap into a tractor in the runs (its trailer straight at the hand-over): find one again (test/journey.ts with JTLOG lists them) and move the run");
if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
