// Test: single stops staged on their own (src/stage.ts), the crew stepped through each, every
// tenth of a second, for how the driver and what they hold move: quick (a few seconds), where
// crewmotion.ts drives whole journeys. Fails on:
//  - a jump: the driver, or the hand truck's wheels, further in a step than a run;
//  - the driver standing in the truck (in its box but not its bed's aisle, or up at the floor's
//    height out of it) or in the building (past its front, but through the doorway while out of
//    sight there);
//  - the hand truck's wheels sliding sideways (not rolled, nor turned on the spot);
//  - the driver in the pallet jack's body, or its handle through their middle;
//  - the driver in the front doorway while the door is shut;
//  - the driver's head in what they hold (a warning only: a tall glass cake case, a museum crate
//    drawn on its jack, known);
//  - a team lift's worker jumping, or in the building out of its doorway, or in sight past it.
// Args (all optional): model:cargo:kind[:nodoor | :door=x][:tree=x,out ...] ... (src/stage.ts
// stageSpec). With none, a set across the truck models, tools and loads.
import * as THREE from "three@0.187.0";
import { Crew } from "../src/crew.ts";
import { Truck, TruckKit, truckLayout } from "../src/truck.ts";
import type { TruckModel } from "../src/truck.ts";
import { makeStage, stageSpec } from "../src/stage.ts";
import { RAMP_HW } from "../src/chores.ts";

const proc = (globalThis as any).process;
// (IN_JACK: turning it on the spot in the bed, the driver steps in beside its pump, jackplan.ts
// JK_PUMP: that far is let be.)
const DT = 0.1, JUMP = 0.6, SLIDE = 0.35, IN_JACK = 0.16, IN_HANDLE = 0.05;
const CASES = proc.argv.length > 2 ? proc.argv.slice(2) : [
  "box26:boxes:pickup", "box26:boxes:drop", "box26:kegs:drop", "box26:appliances:drop",
  "box26:bagged:pickup", "box26:bagged:drop", "box26:pumpkins:drop:nodoor",
  "box16:boxes:drop", "reefer:frozen:drop", "reefer:frozen:pickup", "reefer:penguin:pickup", "reefer:cake:pickup",
  "reefer:frozen:drop:door=0.2", "box26:boxes:drop:door=1", "box26:bagged:drop:door=1",
  "reefer:frozen:drop:door=0.2:tree=-1.6,0.7",
  "box26:sofa:drop", "box26:sofa:pickup", "box26:mattresses:drop", "box26:mattresses:pickup:door=3", "box26:canoes:pickup", "box26:canoes:drop",
  "box26:hotTub:pickup", "box26:hotTub:drop", "box26:museumCrate:pickup",
];
const kit = new TruckKit(new Proxy({}, { get: () => ({ width: 1, height: 1 }) }) as any);
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
let failed = 0;
for (const cs of CASES) {
  const spec = stageSpec(cs.split(":")), S = makeStage(spec), model = spec.model;
  const L = truckLayout(model), truck = new Truck(kit, model, null); scene.add(truck.root);
  const before = new Set(scene.children);
  truck.follow(0, 0, 0, 0, 0);
  const crew = new Crew(scene, new THREE.MeshLambertMaterial()), C = crew as any;
  const tally = new Map<string, { n: number; worst: number; at: string }>();
  const bad = (what: string, v: number, at: string) => { const t = tally.get(what) ?? { n: 0, worst: 0, at: "" }; t.n++; if (v > t.worst) { t.worst = v; t.at = at; } tally.set(what, t); };
  let pD: THREE.Vector3 | null = null, pW: THREE.Vector3 | null = null, pM: THREE.Vector3 | null = null, slid = 0;
  for (let t = 0; t <= S.length; t += DT) {
    S.setTime(t);
    crew.update(DT, S.journey, truck, null, cam);
    const ph = S.journey.dwellPhase(), c = ph.chore;
    const at = `t${t.toFixed(1)} ${c ? c.kind + (c.item ? " " + c.item : "") + (c.tool ? " " + c.tool : "") + (c.flip ? " (turned round inside)" : "") + (c.a && c.b ? ` ${c.a.map((v) => v.toFixed(2))}>${c.b.map((v) => v.toFixed(2))}${c.over ? " over" : ""}${c.linear ? " linear" : ""}` : "") : ph.phase}`;
    // The worker (a team lift's other carrier).
    const m = crew.helper.root;
    if (m.visible) {
      m.updateMatrixWorld(true);
      const M = m.getWorldPosition(new THREE.Vector3());
      if (pM && Math.hypot(M.x - pM.x, M.z - pM.z) > JUMP) bad("the worker jumps", Math.hypot(M.x - pM.x, M.z - pM.z), `${at} at ${M.x.toFixed(2)}, ${M.z.toFixed(2)}`);
      if (pM && C.mate.attached && Math.abs(M.y - pM.y) > 0.2) bad("the worker steps up or down off something, carrying", Math.abs(M.y - pM.y), `${at} at ${M.x.toFixed(2)}, ${M.y.toFixed(2)}, ${M.z.toFixed(2)}`);
      const inDoorway = S.kerbDoor && Math.abs(M.x - S.kerbDoor.x) < S.kerbDoor.half - 0.15;
      if (M.z > S.wallZ + 0.05 && !inDoorway) bad("the worker goes through the building's wall", M.z - S.wallZ, at);
      if (M.z > S.wallZ + 0.6) bad("the worker is in sight inside the building", M.z - S.wallZ, at);
      pM = M;
    } else pM = null;
    const d = crew.driver.root;
    if (!d.visible || !c || c.kind === "climbDown" || c.kind === "climbUp") { pD = null; pW = null; continue; }
    d.updateMatrixWorld(true);
    const D = d.getWorldPosition(new THREE.Vector3());   // (the truck at the origin heading +x: world is its frame)
    if (pD && Math.hypot(D.x - pD.x, D.z - pD.z) > JUMP) bad("the driver jumps", Math.hypot(D.x - pD.x, D.z - pD.z), at);
    pD = D;
    // In the truck, out of its bed's aisle; or up off the ground beside it.
    const inBox = D.x > L.rear + 0.05 && D.x < L.front - 0.05 && Math.abs(D.z) < L.hw - 0.02;
    const inAisle = D.x > L.rear - 0.05 && D.x < L.bedFront && Math.abs(D.z) < L.hw - 0.12;   // (from the box's back: over the sill)
    if (inBox && !inAisle) bad("the driver stands in the truck", L.hw - Math.abs(D.z), `${at} at ${D.x.toFixed(2)}, ${D.y.toFixed(2)}, ${D.z.toFixed(2)}`);
    // Up at the floor's height on a walk along the ground (cut across the truck's corner, say).
    // (On the walk ramp the driver is at its height. A run of walks with the hand truck is rolled
    // as one movement timed by distance, so the driver can still be on the ramp after the walk from
    // its foot has begun.)
    const onRamp = L.loader === "ramp" && Math.abs(D.z) < RAMP_HW && D.x < L.bedRear && D.x > L.bedRear - 3.7;
    if (c.kind === "walk" && c.a && c.b && c.a[1] < 0.3 && c.b[1] < 0.3 && !c.linear && !c.over && D.y > 0.5 && !onRamp) bad("the driver pops up to the floor on a walk on the ground", D.y, `${at} at ${D.x.toFixed(2)}, ${D.z.toFixed(2)}`);
    // Through a street tree's trunk.
    for (const o of S.obstacles) if (Math.hypot(D.x - o.x, D.z - o.z) < o.r + 0.1 && c.kind === "walk") bad("the driver walks through a tree", o.r + 0.1 - Math.hypot(D.x - o.x, D.z - o.z), `${at} at ${D.x.toFixed(2)}, ${D.z.toFixed(2)}, walking ${c.a?.map((v) => v.toFixed(2))} to ${c.b?.map((v) => v.toFixed(2))}`);
    // In the building: past its front, bar its doorway.
    if (D.z > S.wallZ + 0.05 && !(S.kerbDoor && Math.abs(D.x - S.kerbDoor.x) < S.kerbDoor.half - 0.15)) bad("the driver goes through the building's wall", D.z - S.wallZ, at);
    // Nor through its front door while it's shut (or no more than half open).
    if (S.kerbDoor && D.z > S.wallZ - 0.3 && Math.abs(D.x - S.kerbDoor.x) < S.kerbDoor.half + 0.2 && S.journey.frontDoorOpen < 0.5) bad("the driver walks through the shut front door", 0.5 - S.journey.frontDoorOpen, at);
    // The driver's head out of what they hold (as crew.ts keeps it), bar going into or out of its
    // place or a doorway.
    if (C.load?.group.visible && c.kind !== "stow" && c.kind !== "fetch" && C.headInLoad(C.load)) bad("(warning) the driver's head is in the load", 1, `${at} at ${D.x.toFixed(2)}, ${D.y.toFixed(2)}, ${D.z.toFixed(2)}`);
    // The hand truck: its wheels rolled or turned, not slid.
    const ht = C.tools.handTruck as THREE.Object3D;
    if (ht.visible && c.kind !== "toolGet" && c.kind !== "toolPut") {
      ht.updateMatrixWorld(true);
      const W = new THREE.Vector3().setFromMatrixPosition(ht.matrixWorld), ax = new THREE.Vector3(1, 0, 0).transformDirection(ht.matrixWorld);
      if (pW) {
        const vx = (W.x - pW.x) / DT, vz = (W.z - pW.z) / DT, m = Math.hypot(ax.x, ax.z) || 1, side = Math.abs(vx * -ax.z + vz * ax.x) / m;
        // (Sustained: a tick's blip, a few centimetres, is let be.)
        slid = side > SLIDE ? slid + 1 : 0;
        if (slid >= 2) bad("the hand truck's wheels slide sideways", side, at);
        if (Math.hypot(W.x - pW.x, W.z - pW.z) > JUMP) bad("the hand truck jumps", Math.hypot(W.x - pW.x, W.z - pW.z), at);
        if (W.y > 0.6 && c.tool === "handTruck" && c.kind === "walk" && c.a && c.b && c.a[1] < 0.3 && c.b[1] < 0.3 && !c.linear) bad("the hand truck pops up to the floor on a walk on the ground", W.y, `${at} at ${W.x.toFixed(2)}, ${W.z.toFixed(2)}`);
      }
      pW = W;
    } else pW = null;
    // The pallet jack: the driver out of its body (from behind the pump to the forks' ends), its
    // handle not through their middle.
    const jack = C.tools.palletJack as THREE.Object3D;
    if (jack.visible && c.kind !== "toolGet" && c.kind !== "toolPut") {
      jack.updateMatrixWorld(true);
      const q = D.clone().applyMatrix4(jack.matrixWorld.clone().invert());
      if (q.y < 0.35 && !c.over) {   // (not climbing out over a load left on it)
        const dist = Math.hypot(Math.max(-0.1 - q.x, 0, q.x - 1.37), Math.max(Math.abs(q.z) - 0.3, 0));
        if (0.2 - dist > IN_JACK) bad("the driver stands in the pallet jack", 0.2 - dist, at);
      }
      const hdl = C.jackHandle as THREE.Object3D; hdl.updateMatrixWorld(true);
      let worst = 0;
      for (let y = 0.1; y <= 0.95; y += 0.05) {
        const w = new THREE.Vector3(0, y, 0).applyMatrix4(hdl.matrixWorld);
        if (w.y > D.y + 0.75 && w.y < D.y + 1.45) worst = Math.max(worst, 0.15 - Math.hypot(w.x - D.x, w.z - D.z));
      }
      if (worst > IN_HANDLE) bad("the pallet jack's handle goes through the driver", worst, at);
    }
  }
  for (const o of [...scene.children]) if (!before.has(o) || o === truck.root) scene.remove(o);   // (this stop's truck and crew)
  const out = [...tally.entries()].map(([k, v]) => `    ${k}: ${v.n} steps, at worst ${v.worst.toFixed(2)} (${v.at})`);
  const fails = out.filter((o) => !o.includes("(warning)")).length;
  console.log(`${fails ? "FAIL" : "ok  "} ${cs} (${S.length.toFixed(0)} s, ${S.chores.length} chores)`);
  for (const o of out) console.log(o);
  if (fails) failed++;
}
if (failed) { console.log(`${failed} of ${CASES.length} stops failed`); proc.exit(1); }
