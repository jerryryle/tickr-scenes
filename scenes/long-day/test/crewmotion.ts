// Test: the driver and the dock worker never moonwalk, and the pallet jack never sinks into the
// floor, goes through a wall or is swung round. Steps journeys with the crew animating every stop
// (crew.ts, as main.ts drives it) and watches each figure's feet: walking, the foot on the ground should stay about where it is put
// down while the body passes over it. A walk cycle run the wrong way for the direction of travel
// (legs striding forwards while the body goes backwards, or the reverse) slides that foot along
// with the body instead, faster than it. Fails on any stretch of 0.5 s or more where it does.
// And while the pallet jack is out, the undersides of its forks along their length are never
// below the ground under them (the bed's floor, the walk ramp, the pavement), as at the ramp's
// top edge; at a front door, it goes through the doorway, never through the wall beside it; and
// it never slides sideways faster than a slip (it is steered, turning about its middle, not
// swung round), nor passes through the truck's sides.
// Args (all optional): seed:minutes ... With none, a few journeys with hand trucks, pallet jacks,
// rolled tires, ramps and docks.
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT, setDoorProbe, setParkedProbe, setPavementProbe } from "../src/journey.ts";
import type { Pose } from "../src/route.ts";
import { kerbDoors, parkedObstacles, pavementObstacles } from "../src/city.ts";
import { Truck, TruckKit, truckLayout } from "../src/truck.ts";
import type { TruckModel } from "../src/truck.ts";
import { Crew } from "../src/crew.ts";
import { Character } from "../src/character.ts";

const proc = (globalThis as any).process;
setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
// (13, 6, 3 and 4: pallet jacks up and down a walk ramp and through front doors, 6's beside the
// truck; 15: at docks; 0, 2, 7 and 12: hand trucks, kegs and tires.)
const runs: string[] = proc.argv.length > 2 ? proc.argv.slice(2) : ["0:40", "2:40", "7:40", "12:45", "13:80", "6:80", "3:90", "4:30", "15:30"];
const errs: string[] = [];
let problems = 0, walked = 0, jackFrames = 0, worstJack = 0, worstWall = 0, worstSlip = 0;
const fail = (m: string) => { problems++; if (errs.length < 20) errs.push(m); };

const kit = new TruckKit(new Proxy({}, { get: () => ({ width: 1, height: 1 }) }) as any);
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();

// A figure's soles, world space.
const SOLE = new THREE.Vector3(0.045, -0.495, 0);
const soles = (ch: Character): [THREE.Vector3, THREE.Vector3] => {
  ch.root.updateMatrixWorld(true);
  const a = ch as any;
  return [SOLE.clone().applyMatrix4(a.knL.matrixWorld), SOLE.clone().applyMatrix4(a.knR.matrixWorld)];
};
// One figure's feet over time: stretches where the planted foot is carried along with the body.
class Feet {
  private prev: [THREE.Vector3, THREE.Vector3] | null = null; private knee = [0, 0]; private yaw = 0; private root = new THREE.Vector3();
  private run = 0; private sum = 0; private reported = false;
  constructor(readonly who: string) {}
  reset() { this.prev = null; this.run = 0; this.sum = 0; this.reported = false; }
  see(ch: Character, what: () => string) {
    if (!ch.root.visible) { this.reset(); return; }
    const f = soles(ch), r = ch.root.getWorldPosition(new THREE.Vector3());
    if (this.prev) {
      const bx = r.x - this.root.x, bz = r.z - this.root.z, b = Math.hypot(bx, bz);
      // (The planted foot: the one on the straighter leg, now and before.)
      const a = ch as any, kn = [Math.abs(a.knL.rotation.z), Math.abs(a.knR.rotation.z)];
      const k = kn[0] < kn[1] ? 0 : 1, kp = this.knee[0] < this.knee[1] ? 0 : 1;
      // (Not turning quickly: a turn swings the feet round with the body.)
      const yaw = new THREE.Euler().setFromQuaternion(ch.root.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y, turn = Math.abs(Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw))) / SIM_DT;
      this.yaw = yaw;
      if (b / SIM_DT > 0.3 && turn < 1 && k === kp && Math.abs(kn[0] - kn[1]) > 0.05 && Math.abs(this.knee[0] - this.knee[1]) > 0.05) {
        walked++;
        const slip = ((f[k].x - this.prev[k].x) * bx + (f[k].z - this.prev[k].z) * bz) / (b * b);
        this.run++; this.sum += slip;
        const fw = new THREE.Vector3(1, 0, 0).applyQuaternion(ch.root.getWorldQuaternion(new THREE.Quaternion()));
        const along = (fw.x * bx + fw.z * bz) / b;
        // (Side-stepping, round a pallet jack, the legs still swing fore and aft: not a moonwalk,
        // which strides against the way the body goes.)
        if (Math.abs(along) < 0.5) { this.run = 0; this.sum = 0; }
        if (this.run * SIM_DT >= 0.5 && this.sum / this.run > 1.3 && !this.reported) {
          this.reported = true;
          fail(`${what()}: the ${this.who}'s planted foot slides along with the body (${(this.sum / this.run).toFixed(2)}x its speed), going ${along > 0.5 ? "forwards" : along < -0.5 ? "backwards" : "sideways"}: moonwalking`);
        }
      } else { this.run = 0; this.sum = 0; if (b / SIM_DT <= 0.3) this.reported = false; }
    }
    this.prev = f; this.root.copy(r); const a = ch as any; this.knee = [Math.abs(a.knL.rotation.z), Math.abs(a.knR.rotation.z)];
  }
}

for (const run of runs) {
  const [seed, minutes] = run.split(":").map(Number);
  const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
  const crew = new Crew(scene, new THREE.MeshLambertMaterial()), C = crew as any;
  const trucks = new Map<TruckModel, Truck>();
  const truckFor = (m: TruckModel) => { let t = trucks.get(m); if (!t) { t = new Truck(kit, m, null); scene.add(t.root); trucks.set(m, t); } return t; };
  const pose = {} as Pose, feet = [new Feet("driver"), new Feet("worker")];
  const jack = C.tools.palletJack as THREE.Object3D;
  let jackBad = false, wallBad = false, slipBad = false, sideBad = false, prevR: THREE.Vector3 | null = null;
  for (let i = 0, n = Math.round(minutes * 60 / SIM_DT); i < n; i++) {
    j.step();
    const st = j.st, truck = truckFor(st.truck);
    if (st.mode !== "dwell") { for (const f of feet) f.reset(); jackBad = wallBad = slipBad = sideBad = false; prevR = null; continue; }
    const p = j.renderPose(pose);
    truck.follow(p.x, p.z, p.h, p.k, 0);
    let other: Truck | null = null;
    const om = st.spare ?? st.parked?.model ?? null;
    if (om) { other = om === st.truck ? new Truck(kit, om, null) : truckFor(om); if (st.spare) j.sparePose(pose); else if (st.parked) { pose.x = st.parked.x; pose.z = st.parked.z; pose.h = st.parked.h; } other.follow(pose.x, pose.z, pose.h, 0, 0); }
    crew.update(SIM_DT, j, truck, other, cam);
    const stop = st.stops[0], ph = j.dwellPhase();
    const what = () => `seed ${seed} t${st.simTime.toFixed(1)} ${st.truck} ${stop?.kind ?? ""} ${stop?.cargo ?? ""} at ${stop?.site?.name ?? "?"} (${ph.chore ? ph.chore.kind + (ph.chore.item ? " " + ph.chore.item : "") + (ph.chore.tool ? " " + ph.chore.tool : "") : ph.phase})`;
    feet[0].see(crew.driver, what);
    feet[1].see(crew.helper, what);
    // The jack's forks: their undersides, every 10 cm along, above the ground there.
    if (jack.visible) {
      jackFrames++;
      const L = truckLayout(truck.model), inv = truck.root.matrixWorld.clone().invert();
      jack.updateMatrixWorld(true);
      let low = 0, at = 0, where = "";
      for (const z of [-0.25, 0.25]) for (let x = 0.2; x <= 1.36; x += 0.1) {
        const q = new THREE.Vector3(x, 0.015, z).applyMatrix4(jack.matrixWorld).applyMatrix4(inv), g = C.ground(L, q.x, q.z);
        if (g - q.y > low) { low = g - q.y; at = x; where = `${q.x.toFixed(2)}, ${q.z.toFixed(2)} (the bed's back edge at ${L.bedRear.toFixed(2)}), ground ${g.toFixed(2)}`; }
      }
      worstJack = Math.max(worstJack, low);
      if (low > 0.03 && !jackBad) { jackBad = true; fail(`${what()}: the pallet jack's forks are ${(low * 100).toFixed(0)} cm into the ground ${at.toFixed(1)} m along them, at ${where}`); }
      else if (low <= 0.03) jackBad = false;
      // Into the building only through its doorway (world space: the facade is the line through
      // the door's foot across its outward normal).
      const kd = j.kerbDoor;
      if (kd && !j.isDockStop(stop)) {
        let deep = 0;
        for (const z of [-0.3, 0.3]) for (let x = -0.1; x <= 1.4; x += 0.1) {
          const q = new THREE.Vector3(x, 0.1, z).applyMatrix4(jack.matrixWorld), dx = q.x - kd.x, dz = q.z - kd.z;
          const inside = -(dx * kd.nx + dz * kd.nz), across = Math.abs(-dx * kd.nz + dz * kd.nx);
          if (across > kd.half - 0.05) deep = Math.max(deep, inside);
        }
        worstWall = Math.max(worstWall, deep);
        if (deep > 0.05 && !wallBad) { wallBad = true; fail(`${what()}: the pallet jack is ${(deep * 100).toFixed(0)} cm into the building's wall beside its door`); }
        else if (deep <= 0.05) wallBad = false;
      }
      // Nor through the truck's sides (into its bed only over the back, by the ramp or the gate).
      {
        let through = false;
        for (const z of [-0.3, 0.3]) {
          let prev: THREE.Vector3 | null = null;
          for (let x = -0.1; x <= 1.4; x += 0.1) {
            const q = new THREE.Vector3(x, 0.1, z).applyMatrix4(jack.matrixWorld).applyMatrix4(inv);
            if (prev && Math.max(prev.x, q.x) > L.bedRear + 0.15 && Math.min(prev.x, q.x) < L.bedFront && (Math.abs(prev.z) - L.hw) * (Math.abs(q.z) - L.hw) < 0) through = true;
            prev = q;
          }
        }
        if (through && !sideBad) { sideBad = true; fail(`${what()}: the pallet jack goes through the side of the truck`); }
        else if (!through) sideBad = false;
      }
      // Its middle, which it turns about: along it, not sideways (beyond a slip). (Not while it is
      // taken from its rest or put back, which lifts it.)
      const r = new THREE.Vector3(0.68, 0, 0).applyMatrix4(jack.matrixWorld), ax = new THREE.Vector3(1, 0, 0).transformDirection(jack.matrixWorld);
      const transfer = ph.chore?.kind === "toolGet" || ph.chore?.kind === "toolPut";
      if (prevR && !transfer) {
        const vx = (r.x - prevR.x) / SIM_DT, vz = (r.z - prevR.z) / SIM_DT, side = Math.abs(vx * -ax.z + vz * ax.x) / Math.hypot(ax.x, ax.z);
        worstSlip = Math.max(worstSlip, side);
        if (side > 0.35 && !slipBad) { slipBad = true; fail(`${what()}: the pallet jack slides sideways at ${side.toFixed(2)} m/s, the driver at ${C.drv.slice(0, 3).map((v: number) => v.toFixed(2)).join(", ")} in the truck's frame: swung round, not steered`); }
        else if (side <= 0.35) slipBad = false;
      }
      prevR = transfer ? null : r;
    } else { jackBad = wallBad = slipBad = sideBad = false; prevR = null; }
  }
}
console.log(`crew motion: ${(walked * SIM_DT).toFixed(0)} s walking watched; pallet jack out ${(jackFrames * SIM_DT).toFixed(0)} s, at worst ${(worstJack * 100).toFixed(1)} cm into the ground, ${(worstWall * 100).toFixed(1)} cm into a wall, sliding sideways at ${worstSlip.toFixed(2)} m/s`);
if (errs.length) { for (const e of errs) console.error(e); console.error(`${problems} problems`); proc.exit(1); }
