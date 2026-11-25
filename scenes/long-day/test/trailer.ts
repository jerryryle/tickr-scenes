// Test: a tractor-trailer at the kerb. Its swing doors are worked one leaf at a time with the
// driver never in the leaf's way or in the trailer (chores.ts leafAt), and the kerb side's only
// pulled open part way past a street tree in its way round (leafBlocked); the load is handed over
// with the forklift at the doors and moved in the trailer on the pallet jack (trailerJackPlan),
// for a pickup or a drop of a full range of pallets, the driver never walking through a load lying
// in it nor, on the road, through the truck; climbing in and out (crew.ts bedClimb) nothing of the
// driver goes through the trailer's floor or its underride guard, nor do the forklift's tines or
// load as it comes to the doors and goes; and the journey pulls up at the kerb with the trailer
// straight behind the tractor (journey.ts hitchStep), so the chores, worked out round a straight
// one, keep out of it.
// Args (all optional): seed minutes, for the journey part (seed 5 has tractor kerb stops early on).
import { readConfig } from "../src/env.ts";
import { Journey, setDoorProbe, setPavementProbe, setParkedProbe } from "../src/journey.ts";
import { kerbDoors, parkedObstacles, pavementObstacles } from "../src/city.ts";
import { bedRearX, leafAt, leafBlocked, toolStore, trailerJackPlan } from "../src/chores.ts";
import { LEAF_OPEN, truckLayout } from "../src/truck.ts";
import { makeStage, stageSpec } from "../src/stage.ts";
import * as THREE from "three@0.187.0";
import { Truck, TruckKit, UNDERRIDE_Y } from "../src/truck.ts";
import { Crew } from "../src/crew.ts";
import { DWELL } from "../src/journey.ts";

const proc = (globalThis as any).process;
const errs: string[] = [];
const L = truckLayout("tractor");

// The doors: the driver's middle a body's width off the leaf (as a segment from its hinge to its
// free edge) and outside the trailer, all the way round, opening and closing.
for (const side of [-1, 1]) for (const open of [true, false]) {
  let near = Infinity, inside = false;
  for (let i = 0; i <= 400; i++) {
    const q = leafAt(L, side, open, i / 400), hx = L.bedRear - 0.02, hz = side * (L.hw - 0.02), w = L.hw - 0.04;
    const ex = hx - Math.sin(q.th) * w, ez = hz - side * Math.cos(q.th) * w;
    const dx = ex - hx, dz = ez - hz, t = Math.max(0, Math.min(1, ((q.x - hx) * dx + (q.z - hz) * dz) / (dx * dx + dz * dz)));
    near = Math.min(near, Math.hypot(q.x - (hx + dx * t), q.z - (hz + dz * t)));
    if (q.x > L.bedRear - 0.25 && q.x < L.front && Math.abs(q.z) < L.hw + 0.25) inside = true;
    if (q.th < -1e-6 || q.th > LEAF_OPEN + 1e-6) errs.push(`leaf ${side} ${open ? "opening" : "closing"}: turned ${q.th.toFixed(2)} rad, past its stops`);
  }
  if (near < 0.3) errs.push(`leaf ${side} ${open ? "opening" : "closing"}: the driver comes within ${near.toFixed(2)} m of it (their body's in it)`);
  if (inside) errs.push(`leaf ${side} ${open ? "opening" : "closing"}: the driver walks into the trailer`);
}

// A street tree by the trailer's kerb-side corner: that leaf only pulled open part way, the driver
// and the leaf both clear of the trunk; none for the street side's, or with nothing there.
{
  const tree = { x: L.bedRear + 0.6, z: L.hw + 1.1, r: 0.35 };
  if (!leafBlocked(L, 1, [tree]) || leafBlocked(L, -1, [tree]) || leafBlocked(L, 1, [])) errs.push("leafBlocked: wrong about a tree by the kerb-side corner");
  const S = makeStage(stageSpec(["tractor", "pallets", "drop", `tree=${tree.x},${tree.z - (L.hw + 0.45)}`]));
  const leaves = ((S as any).journey.chores as any[]).filter((c) => c.kind === "leafOpen" && c.leaf === 1);
  if (!leaves.length || !leaves.every((c) => c.leafPart)) errs.push("a tree by the kerb-side corner: that leaf still walked all the way round");
  for (let i = 0; i <= 100; i++) {
    const q = leafAt(L, 1, true, i / 100, true), ex = L.bedRear - 0.02 - Math.sin(q.th) * (L.hw - 0.04), ez = L.hw - 0.02 - Math.cos(q.th) * (L.hw - 0.04);
    if (Math.hypot(q.x - tree.x, q.z - tree.z) < tree.r + 0.3 || Math.hypot(ex - tree.x, ez - tree.z) < tree.r) { errs.push("a tree by the kerb-side corner: the part-way leaf or its driver goes into it"); break; }
  }
}

// The jack: planned for every load a tractor carries at a kerb stop, as staged, and the chores
// walk in the trailer (on its floor) only, not through what lies in it.
for (const kind of ["pickup", "drop"] as const) for (const units of [8, 12, 16, 20]) {
  const stop: any = { kind, cargo: "pallets", units, slot: 0 };
  const own = [{ slot: 0, slotsPerUnit: 1, units }];
  const plan = trailerJackPlan(L, "tractor", stop, 0, [], toolStore(L, "palletJack", bedRearX(L, "tractor", kind === "pickup" ? [] : own)));
  if (!plan) { errs.push(`${kind} of ${units} pallets: no jack plan in an empty trailer`); continue; }
  const S = makeStage({ ...stageSpec(["tractor", "pallets", kind]), units });
  const ch = (S as any).journey.chores as any[];
  if (!ch.some((c) => c.kind === "bedUp") || !ch.some((c) => c.kind === "bedDown")) errs.push(`${kind} of ${units} pallets: the driver doesn't climb in and out`);
  if (!ch.some((c) => c.handoff)) errs.push(`${kind} of ${units} pallets: no hand-over with the forklift`);
  // (On the road round the truck: never through the trailer or the cab.)
  for (const c of ch) {
    if (c.kind !== "walk" || !c.a || c.a[1] !== 0 || c.b[1] !== 0) continue;
    for (let i = 1; i < 40; i++) {
      const x = c.a[0] + (c.b[0] - c.a[0]) * i / 40, z = c.a[2] + (c.b[2] - c.a[2]) * i / 40;
      const hw = x < L.bedFront ? L.hw : L.cabHW;
      if (x > L.rear && x < L.front && Math.abs(z) < hw + 0.2) { errs.push(`${kind} of ${units} pallets: a walk on the road goes through the truck at x ${x.toFixed(2)} z ${z.toFixed(2)}`); break; }
    }
  }
  for (const c of ch) {
    if (c.kind !== "walk" || !c.lay || !c.a || c.a[1] < L.floor - 0.01) continue;
    // (On foot past the load lying there: their middle a body's width off its footprint.)
    const [lx, , lz] = c.lay;
    for (let i = 0; i <= 20; i++) {
      const x = c.a[0] + (c.b[0] - c.a[0]) * i / 20, z = c.a[2] + (c.b[2] - c.a[2]) * i / 20;
      if (!c.tool && Math.abs(x - lx) < 0.6 + 0.25 && Math.abs(z - lz) < 0.5 + 0.25) { errs.push(`${kind} of ${units} pallets: the driver walks through the load lying in the trailer at x ${x.toFixed(2)}`); break; }
    }
  }
}

// Climbing up into the trailer and down out of it: no part of the driver goes through its floor
// at the back (the floor plate, its top at the floor and 0.12 m thick) or the underride guard's bar
// under it: points along every edge of
// the body's parts, every 0.05 s through the climbs.
{
  const kit = new TruckKit(new Proxy({}, { get: () => ({ width: 1, height: 1 }) }) as any);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  const truck = new Truck(kit, "tractor", null); scene.add(truck.root); truck.follow(0, 0, 0, 0, 0);
  const crew = new Crew(scene, new THREE.MeshLambertMaterial());
  const S = makeStage(stageSpec(["tractor", "pallets", "drop"]));
  const ch = (S as any).journey.chores as any[], starts = (S as any).journey.choreStart as number[];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), inv = new THREE.Matrix4();
  let worst = 0, at = "";
  for (let i = 0; i < ch.length; i++) {
    if (ch[i].kind !== "bedUp" && ch[i].kind !== "bedDown") continue;
    for (let k = 0; k * 0.05 < ch[i].len - 1e-6; k++) {
      const t = k * 0.05;   // (within the climb: its end is the next chore's start)
      S.setTime(DWELL.park + starts[i] + t);
      crew.update(0.05, S.journey, truck, null, cam);
      scene.updateMatrixWorld(true);
      inv.copy(truck.root.matrixWorld).invert();
      crew.driver.root.traverse((o: any) => {
        const pos = o.geometry?.attributes?.position;
        if (!pos || !o.visible) return;
        const idx = o.geometry.index, n = idx ? idx.count : pos.count;
        for (let k = 0; k < n; k += 3) for (let e = 0; e < 3; e++) {
          const i0 = idx ? idx.getX(k + e) : k + e, i1 = idx ? idx.getX(k + (e + 1) % 3) : k + (e + 1) % 3;
          a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
          b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
          for (let f = 0; f <= 4; f++) {
            p.lerpVectors(a, b, f / 4);
            if (p.x <= L.bedRear - 0.27 || Math.abs(p.z) > L.hw - 0.05) continue;
            const into = Math.max(Math.min(p.x - L.bedRear, L.floor - 0.02 - p.y, p.y - (L.floor - 0.12)),
              // (Nor through the underride guard's bar, behind the doors under the floor.)
              Math.min(p.x - (L.bedRear - 0.27), L.bedRear - 0.13 - p.x, p.y - (UNDERRIDE_Y - 0.13), UNDERRIDE_Y - 0.01 - p.y, L.hw - 0.14 - Math.abs(p.z)));
            if (into > worst) { worst = into; at = `${ch[i].kind} at ${t.toFixed(2)} s (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`; }
          }
        }
      });
    }
  }
  if (worst > 0.01) errs.push(`climbing in or out, the driver goes ${(worst * 100).toFixed(0)} cm into the trailer's floor: ${at}`);
}

// The forklift at the trailer's back, a pickup's and a drop's hand-over: the tines and what's on
// them up at the floor (or above it) before they reach its back, and clear of the guard's bar.
for (const kind of ["pickup", "drop"]) {
  const kit = new TruckKit(new Proxy({}, { get: () => ({ width: 1, height: 1 }) }) as any);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  const truck = new Truck(kit, "tractor", null); scene.add(truck.root); truck.follow(0, 0, 0, 0, 0);
  const crew = new Crew(scene, new THREE.MeshLambertMaterial()), C = crew as any;
  const S = makeStage(stageSpec(["tractor", "pallets", kind]));
  const ch = (S as any).journey.chores as any[], starts = (S as any).journey.choreStart as number[];
  const i = ch.findIndex((c) => c.handoff);
  if (i < 0) { errs.push(`${kind}: no hand-over with the forklift to check`); continue; }
  const box = new THREE.Box3(), inv = new THREE.Matrix4();
  let bad = "";
  for (let k = 0; k * 0.05 < ch[i].len && !bad; k++) {
    S.setTime(DWELL.park + starts[i] + k * 0.05);
    crew.update(0.05, S.journey, truck, null, cam);
    scene.updateMatrixWorld(true);
    inv.copy(truck.root.matrixWorld).invert();
    for (const [what, o] of [["the forks", C.forks], ["the load", C.load?.group]] as [string, THREE.Object3D | undefined][]) {
      if (!o || !o.visible || !C.forklift.visible) continue;
      box.setFromObject(o).applyMatrix4(inv);
      const past = box.max.x > L.bedRear + 0.02 && box.min.y < L.floor - 0.005;
      const guard = box.max.x > L.bedRear - 0.27 && box.min.x < L.bedRear - 0.13 && box.min.y < UNDERRIDE_Y && box.max.y > UNDERRIDE_Y - 0.13;
      if (past || guard) bad = `${kind}: ${what} ${past ? "into the trailer's back below its floor" : "through the underride guard"} ${(k * 0.05).toFixed(2)} s into the hand-over (bottom at ${box.min.y.toFixed(2)} m, front at ${(box.max.x - L.bedRear).toFixed(2)} m past its back)`;
    }
  }
  if (bad) errs.push(bad);
}

// The journey: at each tractor kerb stop the trailer stands straight behind the tractor.
setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
const seed = Number(proc.argv[2] ?? 5), minutes = Number(proc.argv[3] ?? 17);
const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
let prev = j.st.mode, kerb = 0;
while (j.st.simTime < minutes * 60) {
  j.step();
  const st = j.st, stop = st.stops[0];
  if (st.mode === "dwell" && prev !== "dwell" && st.truck === "tractor" && stop && !j.isDockStop(stop)) {
    kerb++;
    if (Math.abs(j.hitchYaw) > 0.005) errs.push(`seed ${seed} t${st.simTime.toFixed(0)}: pulled up at the kerb with the trailer ${(j.hitchYaw * 180 / Math.PI).toFixed(1)} degrees off straight`);
  }
  prev = st.mode;
}
if (!kerb) errs.push(`seed ${seed}: no tractor kerb stop in ${minutes} minutes to check`);

if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
console.log(`trailer: doors, jack plans for 8 loads, ${kerb} kerb stop(s) straight`);
