// Camera director (concept doc, "Camera behaviors"). The journey's state decides the beat:
//   drive    overhead follow: high chase, side-scroller, top-down map; lead cam around some turns
//   arrive   dashboard zoom: dive through the windshield, passenger seat, tablet close-up, mirror
//   curb     across-the-street view of a kerb stop's last metres and parking
//   backup   front fly-out while reversing to a dock: straight, arc, low hero
//   load     side view (a cut): classic, slow dolly, rear three-quarter (the
//            box's near wall hidden); signature orbit; gag
//            insert for humour
//   swap     follow the driver from the old cab to the new one: shoulder, low, crane, push-in
//   depart   crane up to the chase: rising crane, whip pan, hold and catch up, top-down reveal
//   country  drone drift, side-scroller and high chase in rotation
// Each stop picks its variants from a hash of the stop count, never repeating the previous
// stop's variant for the same beat. Shots give a target position and a look target (or an
// explicit yaw and pitch); the camera follows with critically damped springs on position and on
// yaw/pitch (angles, so a 180-degree swing turns smoothly instead of sweeping through the lens).
// A shot can ask for a cut. Shots that phase 6 animates (the driver) use the same anchors and
// walk path the driver will.
import * as THREE from "three@0.187.0";
import { hash2, hash3 } from "./rng.ts";
import { OCCLUSION } from "./occlusion.ts";
import type { OccluderBox } from "./occlusion.ts";
import { loadFields, saveFields } from "./snap.ts";
import { Truck, truckExtents, truckLayout } from "./truck.ts";
import { CARGO_BY_ID } from "./cargo.ts";
import type { Pose } from "./route.ts";
import { CountryRoad } from "./country.ts";
import { DWELL, Journey } from "./journey.ts";
import type { DockPlan } from "./journey.ts";

type Beat = "drive" | "arrive" | "curb" | "backup" | "load" | "swap" | "depart" | "country" | "roadside";

// `attach`: how the camera rides with the truck before the springs act. A spring chasing a moving
// target lags by 2v/omega (metres at driving speed), so shots framed on the truck carry the
// camera along with it: "move" follows its translation (the chase keeps its own lagged yaw),
// "rigid" also turns with it (cab and side shots). World-fixed shots use "none".
type Attach = "none" | "move" | "rigid";
interface Shot {
  pos: THREE.Vector3; look?: THREE.Vector3; yaw?: number; pitch?: number;
  omega: number; lookOmega?: number; cut?: boolean; cutaway?: boolean; attach?: Attach;
}

interface DirectorInput {
  journey: Journey;
  truck: Truck;              // the truck the journey drives
  other: Truck | null;       // the spare (before a swap's hand-over) or the parked old truck
  gag?: THREE.Vector3 | null; // where a humorous load is right now (Crew.gagPoint)
  driver?: THREE.Vector3 | null;   // the driver's chest while out of the seat
  dt: number;
}

const ARRIVE_DIST = 45, CURB_DIST = 13, DEPART_LEN = 12;
const LOAD_VARIANTS = ["classic", "dolly", "rear"] as const;
// Other angles on the work, for when the usual ones look through too much (occlusion.ts), with how
// much less they are liked: high over the street side, from ahead of the cab, over the top, and the
// truck's other side.
const LOAD_EXTRA: [string, number][] = [["high", 0.08], ["front", 0.1], ["right", 0.12], ["over", 0.16]];
const ARRIVE_VARIANTS = ["dive", "passenger", "tablet"] as const;
const BACKUP_VARIANTS = ["straight", "arc", "low"] as const;
const DEPART_VARIANTS = ["crane", "whip", "hold", "reveal"] as const;
const SWAP_VARIANTS = ["shoulder", "low", "crane", "pushin"] as const;
const DRIVE_VARIANTS = ["high", "side", "top"] as const;

// Exact critically damped spring step (stable for any dt).
function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const c1 = x - target, c2 = v + omega * c1, e = Math.exp(-omega * dt);
  return [target + (c1 + c2 * dt) * e, (c2 - omega * (c1 + c2 * dt)) * e];
}
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Where the driver is during a swap's exit, walk and enter phases: stepping down at the old
// cab door, walking forward along the street side to the new truck's door, pausing to look it
// over, climbing in. Shared with the driver animation (phase 6).
export function swapWalkPoint(journey: Journey, oldTruck: Truck, newTruck: Truck, out: THREE.Vector3): THREE.Vector3 {
  const a = oldTruck.anchors.cabDoorGround.getWorldPosition(new THREE.Vector3());
  const b = newTruck.anchors.cabDoorGround.getWorldPosition(new THREE.Vector3());
  const ph = journey.dwellPhase();
  if (ph.phase === "park" || ph.phase === "exit") return out.copy(a);
  if (ph.phase !== "walk") return out.copy(b);
  const u = THREE.MathUtils.clamp(ph.t / Math.max(0.1, ph.len - 1.5), 0, 1);
  return out.copy(a).lerp(b, u * u * (3 - 2 * u));
}

export class Director {
  readonly cam: THREE.PerspectiveCamera;
  beat: Beat = "drive";
  beatTime = 0;
  private beatStart = 0;
  variant = "high";
  interior = false;
  cutaway = true;
  private pos = new THREE.Vector3(); private vel = new THREE.Vector3();
  private yaw = 0; private yawV = 0; private pitch = -0.7; private pitchV = 0;
  private started = false;
  private lastDriveVariant = "";   // to cut when the drive angle changes
  avoidBuildings: ((pos: THREE.Vector3, truck: THREE.Vector3, rise: boolean) => boolean) | null = null;   // main: keeps the target out of buildings
  private chaseYaw = 0;          // lagged truck heading, for corner swing
  private topYaw = 0;
  private driveVariant: (typeof DRIVE_VARIANTS)[number] = "high";
  private anchorPos = new THREE.Vector3(); private anchorLook = new THREE.Vector3(); private anchorH = 0;
  private signature = false; private gag = false; private gagStart = -1;
  private time = 0;
  private feature: ReturnType<CountryRoad["featureShot"]> = null; private featureKey = -1;
  private cutNext = false; private atDock = false; private lastBeat: Beat = "drive";
  // The world moved by (dx, dz) under the camera (main.ts: the next city takes over out on the
  // road): move with it, so nothing on screen changes.
  rebase(dx: number, dz: number) {
    for (const v of [this.pos, this.prevT, this.anchorPos, this.anchorLook]) { v.x += dx; v.z += dz; }
  }
  private holdSlot = -1;
  private topSlot = -1; private topOk = false;
  private easeSlow = false;   // the last eased change was to or from the top-down view
  private easeStart = -1e9;   // when the angle last changed without a cut   // keep the drive angle through a change between town and country beats until this slot ends
  // The director's whole state and the camera's (main.ts: preview snapshots and part-ticks).
  save() { const c = this.cam; return { f: saveFields(this, null, ["cam", "avoidBuildings", "seed"]), p: c.position.clone(), q: c.quaternion.clone(), fov: c.fov }; }
  load(s: ReturnType<Director["save"]>) {
    loadFields(this, s.f);
    this.cam.position.copy(s.p); this.cam.quaternion.copy(s.q);
    if (this.cam.fov !== s.fov) { this.cam.fov = s.fov; this.cam.updateProjectionMatrix(); }
    this.cam.updateMatrixWorld();
  }
  // After a seek: cut straight to a fresh shot.
  reset() {
    this.started = false; this.havePrev = false;
    this.beat = "drive"; this.beatTime = 0; this.featureKey = -1; this.cutNext = false; this.gag = false; this.gagStart = -1;
  }
  // scratch
  private T = new THREE.Vector3(); private F = new THREE.Vector3(); private R = new THREE.Vector3();
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3(); private v3 = new THREE.Vector3();
  private eye = new THREE.Vector3(); private peye = new THREE.Vector3(); private tab = new THREE.Vector3();
  private pose: Pose = { x: 0, z: 0, h: 0, k: 0 };
  private prevT = new THREE.Vector3(); private prevH = 0; private havePrev = false;
  private up = new THREE.Vector3(0, 1, 0);

  constructor(cam: THREE.PerspectiveCamera, private seed: number) { this.cam = cam; }

  // A variant for stop `stop`, never the same as the one the previous stop would get. A pure
  // function of the stop (no memory), so a scrubbed journey frames every moment the same way.
  private pick<T extends string>(beat: Beat, list: readonly T[], stop: number, salt = 0): T {
    const at = (k: number) => Math.floor(hash3(k, salt, beat.length * 31 + beat.charCodeAt(0), this.seed, 0xca7) * list.length);
    let i = at(stop);
    if (list.length > 1 && list[i] === list[at(stop - 1)]) i = (i + 1) % list.length;
    return list[i];
  }
  // Seconds since the truck pulled away from its last stop (the depart beat), from the journey.
  private departed(j: Journey) {
    const st = j.st;
    return st.mode === "drive" && st.stopsDone > st.city * 1000 && st.modeTime < DEPART_LEN ? st.modeTime : 1e9;
  }
  // How far into `beat` the journey is, worked out from its state (after a seek lands mid-beat).
  private elapsedIn(beat: Beat, j: Journey) {
    const st = j.st;
    switch (beat) {
      case "load": case "swap": return Math.max(0, st.modeTime - DWELL.park);
      case "backup": return st.modeTime;
      case "depart": return this.departed(j) < 1e8 ? this.departed(j) : 0;
      case "arrive": return j.path ? Math.max(0, (ARRIVE_DIST - (st.stopS - st.s)) / Math.max(st.v, 2)) : 0;
      case "curb": return st.mode === "dwell" ? 5 + st.modeTime : j.path ? Math.max(0, (CURB_DIST - (st.stopS - st.s)) / Math.max(st.v, 1.5)) : 0;
      default: return 0;
    }
  }

  // ---- beat selection -------------------------------------------------------------------------
  private chooseBeat(inp: DirectorInput): Beat {
    const j = inp.journey, st = j.st, stop = st.stops[0];
    if (st.mode === "country" || st.mode === "inbound") {
      const road = j.country, f = road && j.countryU >= 0 ? road.featureShot(j.countryS) : null;
      if (f) { if (this.beat !== "roadside" || f.key !== this.featureKey) { this.feature = f; return "roadside"; } return "roadside"; }
      return "country";
    }
    if (st.mode === "reverse") return "backup";
    if (st.mode === "dwell") {
      // Parking: still the shot that brought the truck in (backing into a dock, or the kerb).
      if (j.dwellPhase().phase === "park" && stop?.site) return j.isDockStop(stop) ? "backup" : "curb";
      return stop?.kind === "swap" ? "swap" : "load";
    }
    if (this.departed(j) < DEPART_LEN) return "depart";
    if (stop && stop.kind !== "depart" && j.path) {
      const d = st.stopS - st.s;
      if (!j.isDockStop(stop) && d < CURB_DIST) return "curb";
      if (d < ARRIVE_DIST) return "arrive";
    }
    return "drive";
  }

  private enterBeat(beat: Beat, inp: DirectorInput) {
    const j = inp.journey, st = j.st, stop = st.stops[0];
    const n = st.stopsDone;
    // (Normally a beat starts now; after a seek it may already be under way.)
    this.beat = beat; this.beatTime = this.started ? 0 : this.elapsedIn(beat, j); this.beatStart = this.time - this.beatTime;
    this.easeSlow = this.variant === "top" || this.variant === "reveal"; this.easeStart = this.time;
    this.anchorPos.copy(this.started ? this.pos : this.cam.position);
    this.anchorH = inp.truck.heading;
    switch (beat) {
      case "arrive": {
        const list: string[] = [...ARRIVE_VARIANTS];
        if (stop && j.isDockStop(stop)) list.push("mirror");
        this.variant = this.pick("arrive", list, n);
        break;
      }
      case "backup": this.variant = this.pick("backup", BACKUP_VARIANTS, n); break;
      case "load": {
        // Backed into a dock, the truck's rear is at the building: side views only.
        this.atDock = !!stop && j.isDockStop(stop);
        this.variant = this.pickLoadAngle(inp, this.pick("load", this.atDock ? LOAD_VARIANTS.filter((v) => v !== "rear") : LOAD_VARIANTS, n));
        this.signature = hash3(n, 7, 7, this.seed, 0x51) < 1 / 8;
        this.gag = !!stop && CARGO_BY_ID.get(stop.cargo)?.tier === "humorous";
        // The gag insert comes when the load first appears: the first chore that carries it.
        let gt = 0; this.gagStart = -1;
        for (const c of j.chores) { if (c.item || c.forklift) { this.gagStart = gt; break; } gt += c.len; }
        break;
      }
      case "swap": this.variant = this.pick("swap", SWAP_VARIANTS, n); break;
      case "depart": {
        // A swap departs with the rising crane, leaving the old truck parked in frame.
        this.variant = inp.other && st.parked ? "crane" : this.pick("depart", DEPART_VARIANTS, n);
        this.anchorLook.set(j.pose.x, 1.5, j.pose.z);
        break;
      }
      case "curb": {
        // World-fixed across the street from where the truck will stop.
        const p = j.path!.eval(st.stopS, this.pose);
        const h = p.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
        const c = truckExtents(st.truck).center;
        // In the far lane (street trees line the far sidewalk), slightly ahead of centre.
        this.anchorPos.set(p.x + fx * (c + 2) - rx * 9.5, 4.2, p.z + fz * (c + 2) - rz * 9.5);
        this.anchorLook.set(p.x + fx * c, 1.5, p.z + fz * c);
        break;
      }
      case "drive":
      case "country":
        if (this.lastBeat === "roadside") this.cutNext = beat === "country";
        // In or out of town the angle carries on (no cut) until its slot is over.
        else if ((this.lastBeat === "drive" || this.lastBeat === "country") && this.lastDriveVariant) this.holdSlot = Math.floor((this.time + 7.5) / 15);
        break;
      case "roadside": {
        // World-fixed beside the road, framing the truck with the set piece.
        const road = j.country!, f = this.feature!;
        this.featureKey = f.key;
        road.point(f.cam[0], f.cam[1], this.pose); this.anchorPos.set(this.pose.x, f.cam[2], this.pose.z);
        road.point(f.look[0], f.look[1], this.pose); this.anchorLook.set(this.pose.x, f.look[2], this.pose.z);
        this.cutNext = true;
        break;
      }
    }
    this.lastBeat = beat;
  }

  // ---- per frame ------------------------------------------------------------------------------
  update(inp: DirectorInput) {
    const { journey: j, truck, dt } = inp;
    this.time = j.st.simTime + j.frac;   // journey time: shots follow the journey, not the frame count
    truck.root.updateMatrixWorld(true);
    inp.other?.root.updateMatrixWorld(true);
    const beat = this.chooseBeat(inp);
    if (beat !== this.beat || !this.started || (beat === "roadside" && this.feature && this.feature.key !== this.featureKey)) this.enterBeat(beat, inp);
    this.beatTime = Math.max(0, this.time - this.beatStart);   // journey time, so a scrub lands on the same frame
    // Corner swing: the chase direction lags the truck's heading.
    const dh = wrapAngle(truck.heading - this.chaseYaw);
    this.chaseYaw += this.started ? dh * (1 - Math.exp(-dt / 2.6)) : dh;   // slow, so corners are a gentle drift

    const shot = this.shot(inp);
    if (this.cutNext) { shot.cut = true; this.cutNext = false; }
    if (this.beat !== "drive" && this.beat !== "country") this.lastDriveVariant = "";
    // In town the chase target stays out of the buildings; the springs then ease the camera there.
    if (this.beat === "drive" && this.avoidBuildings && this.avoidBuildings(shot.pos, truck.root.position, this.variant !== "side")) {
      shot.look = this.v2.set(truck.root.position.x, truck.root.position.y + 1.5, truck.root.position.z); shot.yaw = undefined;
    }
    this.keepInView(shot, inp);
    // Just after the angle changes (without a cut) the camera eases into the new one rather than
    // swinging round to it.
    if (!shot.cut && (this.beat === "drive" || this.beat === "country" || this.beat === "depart" || (this.easeSlow && this.beat === "arrive"))) {
      const e = this.time - this.easeStart;
      if (this.easeSlow && e < 10) { shot.omega = Math.min(shot.omega, 0.2 + 0.1 * e); shot.lookOmega = Math.min(shot.lookOmega ?? shot.omega, 0.3 + 0.13 * e); }
      else if (e < 4) { shot.omega = Math.min(shot.omega, 0.7 + 0.35 * e); shot.lookOmega = Math.min(shot.lookOmega ?? shot.omega, 1.0 + 0.5 * e); }
    }
    this.apply(shot, dt, truck);
    truck.cutaway = false;
  }

  private truckFrame(t: Truck) {
    this.T.copy(t.root.position);
    const h = t.heading;
    this.F.set(Math.cos(h), 0, -Math.sin(h));
    this.R.set(Math.sin(h), 0, Math.cos(h));
  }
  // T + F*x + up*y + R*z for the current truck frame.
  private at(out: THREE.Vector3, x: number, y: number, z: number) {
    return out.copy(this.T).addScaledVector(this.F, x).addScaledVector(this.R, z).setY(this.T.y + y);
  }

  private chase(out: Shot, back = 10, side = 19, height = 28, ahead = 16, yaw = this.chaseYaw) {
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    out.pos.set(this.T.x - fx * back + rx * side, height, this.T.z - fz * back + rz * side);
    out.look = this.v2.set(this.T.x + fx * ahead, 0, this.T.z + fz * ahead);
    out.cutaway = true; out.attach = "move";
    return out;
  }

  private shot(inp: DirectorInput): Shot {
    const j = inp.journey, st = j.st, truck = inp.truck;
    const s: Shot = { pos: this.v1, omega: 2.2, lookOmega: 3, cutaway: true, attach: "move" };
    this.truckFrame(truck);
    const ex = truckExtents(truck.model);
    truck.anchors.driverEye.getWorldPosition(this.eye);
    truck.anchors.passengerEye.getWorldPosition(this.peye);
    truck.anchors.tablet.getWorldPosition(this.tab);
    const t = this.beatTime;
    const F = this.F, R = this.R;

    switch (this.beat) {
      case "drive":
      case "country": {
        // The shot changes on a fixed beat of journey time (never the same twice in a row).
        {
          const len = 15, slot = Math.floor((this.time + 7.5) / len);   // (offset: a slot never ends at a city's hand-over)
          // Whether the top view may be chosen is settled when a slot starts, so it never ends early
          // because a turn came into view; only pulling in to a stop ends it.
          if (slot !== this.topSlot) { this.topSlot = slot; this.topOk = this.topAllowed(j); }
          if (j.st.stopS - j.st.s < 40) this.topOk = false;
          const topOk = this.topOk || (this.lastDriveVariant === "top" && j.st.stopS - j.st.s >= 40);
          const list = this.beat === "country" ? ["drone", "side", "high"] : topOk ? ["high", "high", "side", "top"] : ["high", "high", "side"];
          const at = (k: number) => list[Math.floor(hash3(k, 3, this.beat === "country" ? 1 : 0, this.seed, 0xd1) * list.length)];
          const base = (k: number) => { let x = at(k); if (x === at(k - 1) && list.length > 1) x = list[(list.indexOf(x) + 1) % list.length]; return x; };
          let v = base(slot);
          // The top-down view holds for two slots, so the long crane up is worth it.
          const p1 = base(slot - 1), p2 = base(slot - 2);
          if (p1 === "top" && p2 !== "top") v = "top";
          else if (v === "top" && (p1 === "top" || p2 === "top")) v = list[0];
          if (slot === this.holdSlot && this.lastDriveVariant) v = this.lastDriveVariant;
          // A slow crane to or from a high view finishes before the next angle.
          if (this.easeSlow && this.time - this.easeStart < 12 && this.lastDriveVariant) v = this.lastDriveVariant;
          this.driveVariant = v as typeof this.driveVariant;
        }
        this.variant = this.driveVariant;
        // A new angle is a cut, never a flight across the street to it.
        // A new angle is a cut, never a flight across the street to it; except up to (or down from)
        // the top-down view, which is above everything: that is a slow crane.
        if (this.variant !== this.lastDriveVariant) {
          if (this.lastDriveVariant && this.variant !== "top" && this.lastDriveVariant !== "top") { s.cut = true; this.chaseYaw = truck.heading; }
          else if (this.lastDriveVariant) { this.easeStart = this.time; this.easeSlow = this.variant === "top" || this.lastDriveVariant === "top"; }
          else if (this.variant === "top") this.easeSlow = true;   // (first angle after a beat change: that change set the ease)
          this.lastDriveVariant = this.variant;
        }
        const v = this.variant;
        if (v === "side" && this.beat === "drive") {
          // Low chase down the street: behind and a little to the left, the camera stays over the
          // road (a street is too narrow for a true side-on view of the whole truck).
          const yaw = this.chaseYaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
          s.pos.set(this.T.x - fx * 13 - rx * 3, 8, this.T.z - fz * 13 - rz * 3);
          s.look = this.v2.set(this.T.x + fx * 8, 1.2, this.T.z + fz * 8);
          s.omega = 1.6; s.lookOmega = 2.5;
        } else if (v === "side") {
          const yaw = this.chaseYaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
          s.pos.set(this.T.x - fx * 2 - rx * 24, 12, this.T.z - fz * 2 - rz * 24);
          s.look = this.v2.set(this.T.x + fx * 4, 1.5, this.T.z + fz * 4);
          s.omega = 1.5; s.lookOmega = 4;   // the look keeps up, so the truck stays in frame on curves
        } else if (v === "top") {
          // Straight down, the grid axis nearest the truck's heading running across the strip.
          const axis = Math.round(this.chaseYaw / (Math.PI / 2)) * (Math.PI / 2);
          this.topYaw += wrapAngle(axis - this.topYaw) * (1 - Math.exp(-inp.dt / 2));
          s.pos.set(this.T.x + F.x * 8, 80, this.T.z + F.z * 8);
          s.yaw = this.topYaw; s.pitch = -Math.PI / 2 + 0.001;
          s.omega = 1.2; s.lookOmega = 1.6;
        } else if (v === "drone") {
          const yaw = this.chaseYaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
          const lat = 12 * Math.sin(this.time * 0.11), alt = 26 + 7 * Math.sin(this.time * 0.07);
          s.pos.set(this.T.x - fx * 22 + rx * lat, alt, this.T.z - fz * 22 + rz * lat);
          s.look = this.v2.set(this.T.x + fx * 18, 0, this.T.z + fz * 18);
          s.omega = 1.2;
        } else {
          // (On the road the framing follows the angle's slot, not the stop count, which changes at the hand-over.)
          const key = this.beat === "country" ? Math.floor((this.time + 7.5) / 15) + 77777 : st.stopsDone;
          const k = hash2(key, 9, this.seed);
          // Camera behind and to the right, so the truck sits in the left third with the road
          // ahead filling the wide frame.
          this.chase(s, 8 + 6 * k, 17 + 6 * hash2(key, 10, this.seed), 26 + 6 * hash2(key, 11, this.seed), 16);
        }
        if (this.topYaw === 0 && v !== "top") this.topYaw = this.chaseYaw;
        return s;
      }

      case "roadside": {
        // Look between the truck and the piece, leaning to the truck as it comes close.
        const d = Math.hypot(this.T.x - this.anchorPos.x, this.T.z - this.anchorPos.z);
        const f = this.feature, ahead = f ? j.countryS - f.cam[0] : 0;
        const k = f?.fixed ? (ahead < 8 ? 1 : THREE.MathUtils.clamp(0.9 - (ahead - 8) / 120, 0.5, 0.9)) : THREE.MathUtils.clamp((d - 15) / 80, 0.15, 0.4);
        s.pos.copy(this.anchorPos);
        s.look = this.v2.set(this.T.x + (this.anchorLook.x - this.T.x) * k, 1.6 + (this.anchorLook.y - 1.6) * k, this.T.z + (this.anchorLook.z - this.T.z) * k);
        s.lookOmega = 4; s.attach = "none"; s.cutaway = false;
        this.variant = "roadside";
        return s;
      }

      case "arrive": {
        // Stage A: above the hood looking ahead (or outside the passenger window); then inside.
        const v = this.variant;
        const stageA = t < 2.2;
        if (v === "passenger") {
          if (stageA) s.pos.copy(this.peye).addScaledVector(R, 2.8).addScaledVector(F, 0.5).setY(this.peye.y + 0.4);
          else s.pos.copy(this.peye).addScaledVector(F, -0.15).setY(this.peye.y + 0.05);
          s.look = this.v2.copy(this.eye).addScaledVector(F, 3).setY(this.eye.y - 0.2);
        } else if ((v === "tablet" || v === "mirror") && !stageA && t < 5.2) {
          if (v === "tablet") { s.pos.copy(this.tab).addScaledVector(F, -0.45).addScaledVector(R, 0.12).setY(this.tab.y + 0.1); s.look = this.v2.copy(this.tab); }
          else { s.pos.copy(this.eye).addScaledVector(F, 0.4).addScaledVector(R, -1.7).setY(this.eye.y - 0.15); s.look = this.at(this.v2, -14, 1.2, -1.4); }
        } else {
          // Settles at the driver's eye, looking out over the dash past the tablet (phase 6 puts
          // the driver's shoulder in the foreground).
          if (stageA) s.pos.copy(this.eye).addScaledVector(F, 2.3).setY(this.eye.y + 0.6);   // just over the hood, which stays in frame (and beyond the interior range)
          else s.pos.copy(this.eye).addScaledVector(F, -0.15).setY(this.eye.y + 0.05);
          if (stageA) s.look = this.v2.copy(this.eye).addScaledVector(F, 20).setY(1.5);
          else s.look = this.v2.copy(this.tab).addScaledVector(F, 2.5).setY(this.tab.y - 0.15);
        }
        s.omega = stageA ? 2.0 : 2.8; s.lookOmega = 3.2; s.attach = "rigid";
        return s;
      }

      case "curb": {
        s.pos.copy(this.anchorPos); s.look = this.v2.copy(this.anchorLook);
        s.cut = true; s.omega = 2; s.cutaway = false; s.attach = "none";
        return s;
      }

      case "backup": {
        // Framed on where the truck started reversing: out through the windshield, then turn
        // round to face the cab as it backs away from the camera.
        // At a dock, frame on the truck's final docked pose instead: the camera waits in the yard
        // mouth ahead of the bay and watches the truck swing round and back in towards it.
        const dk = j.dock;
        const p = dk ? this.dockedPose(dk) : j.path!.eval(st.stopS, this.pose);
        const fx = Math.cos(p.h), fz = -Math.sin(p.h), rx = Math.sin(p.h), rz = Math.cos(p.h);
        const v = this.variant;
        const out = (x: number, y: number, z: number) => s.pos.set(p.x + fx * x + rx * z, y, p.z + fz * x + rz * z);
        // At a dock these sit over the street the truck backs in from, so they stay clear of
        // traffic: the low shot on the sidewalk to one side, the others above vehicle height.
        if (v === "arc") out(ex.front + 7, dk ? 4.2 : 2.6, -6.5);
        else if (v === "low") out(ex.front + (dk ? 4 : 3), dk ? 1.0 : 0.85, dk ? -7 : -0.4);
        else out(ex.front + 9, dk ? 4.6 : 2.4, 0);
        if (t < 1.0) s.look = this.v2.copy(this.pos).addScaledVector(F, 10);   // keep looking ahead while exiting
        else s.look = v === "low" ? this.at(this.v2, ex.front - 0.5, 1.1, 0) : this.v2.copy(this.eye);
        s.omega = 1.7; s.lookOmega = 2.0; s.cutaway = false; s.attach = "none";
        return s;
      }

      case "load": {
        const ph = j.dwellPhase();
        // Gag insert for humorous cargo: the first time the load (or the animal) comes into
        // view, cut to a close-up on it for a couple of seconds, then cut back.
        if (this.gag && inp.gag && this.gagStart < 0) this.gagStart = t;
        if (this.gagStart >= 0 && t - this.gagStart < 2.2 && inp.gag) {
          const g = inp.gag;
          s.pos.copy(g).addScaledVector(R, -4.2).addScaledVector(F, 1.4).setY(g.y + 1.3);   // high enough to clear street trees
          if (this.atDock) {   // never behind the truck's rear there: that's inside the building
            const along = (s.pos.x - this.T.x) * F.x + (s.pos.z - this.T.z) * F.z, min = truckLayout(truck.model).bedRear + 1.5;
            if (along < min) s.pos.addScaledVector(F, min - along);
          }
          s.look = this.v2.copy(g);
          s.cut = t - this.gagStart < 0.05; s.omega = 4; s.cutaway = false; s.attach = "none";
          return s;
        }
        const backFromGag = this.gagStart >= 0 && t - this.gagStart >= 2.2 && t - this.gagStart < 2.25;
        // Signature orbit (about one stop in eight): a slow half-orbit before the side view.
        if (this.signature && t < 9) {
          // From the left side round the rear; at a dock (rear against the building), from the front
          // quarter round to the side instead.
          const c = ex.center, a = this.atDock ? -0.12 * Math.PI - (t / 9) * Math.PI * 0.38 : -Math.PI / 2 - (t / 9) * Math.PI * 0.9;
          this.at(s.pos, c + Math.cos(a) * 17, 4.5, Math.sin(a) * 17);
          s.look = this.at(this.v2, c, 1.6, 0);
          s.cut = t < 0.05; s.omega = 3; s.cutaway = false;
          return s;
        }
        this.loadCam(this.variant, t, truck, s.pos, this.v2); s.look = this.v2;
        s.cut = this.beatTime < 0.05 || backFromGag;
        s.omega = 3; s.cutaway = false; s.attach = "none";
        return s;
      }

      case "swap": {
        const ph = j.dwellPhase();
        const handed = ph.phase === "startup";
        const oldT = handed ? inp.other : truck, newT = handed ? truck : inp.other;
        if (!oldT || !newT) return this.chase(s);
        if (ph.phase === "enter" || handed) {
          // Settle behind the new cab as it starts up.
          this.truckFrame(newT);
          const ne = truckExtents(newT.model);
          this.at(s.pos, ne.doorX - 7, 3.6, -3.5); s.look = this.at(this.v2, ne.doorX + 2, 2, 0);
          s.omega = 1.6; s.cutaway = false; s.attach = handed ? "rigid" : "none";
          return s;
        }
        const D = swapWalkPoint(j, oldT, newT, this.v3);
        const v = this.variant;
        if (v === "low") { s.pos.copy(D).addScaledVector(R, -2.2).addScaledVector(F, -0.8).setY(0.55); s.look = this.v2.copy(D).addScaledVector(F, 2.5).setY(0.6); }
        else if (v === "crane") { s.pos.copy(D).addScaledVector(R, -8).addScaledVector(F, -4).setY(10); s.look = this.v2.copy(D).setY(1); }
        else if (v === "pushin" && ph.phase === "walk" && ph.t > ph.len - 1.5) {
          newT.anchors.driverEye.getWorldPosition(this.v2);
          s.pos.copy(D).addScaledVector(R, -2.2).addScaledVector(F, -1.5).setY(1.8); s.look = this.v2;
        } else { s.pos.copy(D).addScaledVector(R, -3.2).addScaledVector(F, -1).setY(1.7); s.look = this.v2.copy(D).addScaledVector(F, 3).setY(1.3); }
        s.cut = this.beatTime < 0.05; s.omega = 2.4; s.cutaway = false; s.attach = "none";
        return s;
      }

      case "depart": {
        const v = this.variant;
        const chase = (omega: number) => { this.chase(s); s.omega = omega; s.lookOmega = 2.5; return s; };
        if (v === "crane") {
          if (t < 2.2) { s.pos.copy(this.anchorPos); s.look = this.at(this.v2, ex.center, 1.5, 0); s.lookOmega = 2.5; s.cutaway = false; s.attach = "none"; return s; }
          return chase(1.3);
        }
        if (v === "whip") {
          if (t < 1.6) { s.pos.copy(this.anchorPos); s.look = this.at(this.v2, ex.center, 1.5, 0); s.lookOmega = 3; s.cutaway = false; s.attach = "none"; return s; }
          return chase(1.4);
        }
        if (v === "hold") {
          if (t < 1.2) { s.pos.copy(this.anchorPos); s.look = this.v2.copy(this.anchorLook); s.cutaway = false; s.attach = "none"; return s; }
          return chase(1.8);
        }
        if (t < 9) {  // top-down reveal over the stop (held a while: it's a long way up), drifting after the truck
          const k = THREE.MathUtils.smoothstep(t, 3, 9) * 0.6;
          s.pos.set(this.anchorLook.x + (this.T.x - this.anchorLook.x) * k, 110, this.anchorLook.z + (this.T.z - this.anchorLook.z) * k);
          s.yaw = this.anchorH; s.pitch = -Math.PI / 2 + 0.001; s.omega = 1.4; s.lookOmega = 2; s.attach = "none";
          return s;
        }
        { const e = t - 9, c = chase(Math.min(0.8, 0.15 + 0.08 * e)); c.lookOmega = Math.min(1.0, 0.25 + 0.1 * e); return c; }
      }
    }
  }

  // A load angle's camera and look at time t into the beat (truck frame set).
  private loadCam(v: string, t: number, truck: Truck, pos: THREE.Vector3, look: THREE.Vector3) {
    // The work happens at the back: frame the bed's end with room behind it for the walk to the
    // facility (a trailer is long, so its frame sits further forward on the trailer).
    const lay = truckLayout(truck.model), ex = truckExtents(truck.model), back = lay.trailer ? lay.bedRear + 3 : lay.bedRear - 3.5;
    if (v === "rear") { this.at(pos, lay.bedRear - 6, 2.0, -5.5); this.at(look, lay.bedRear + 0.5, 1.5, -0.3); return; }
    if (v === "high") { this.at(pos, back + 3, 10, -12); this.at(look, back - 0.5, 0.8, 0); return; }
    if (v === "front") { this.at(pos, ex.front + 7, 3.6, -7); this.at(look, back + 1, 1.2, -0.5); return; }
    if (v === "right") { this.at(pos, back + 1.5 + (this.atDock ? 5 : 0), this.atDock ? 4.2 : 3.6, 15); this.at(look, back + (this.atDock ? 5 : 0), 1.5, 0); return; }
    if (v === "over") { this.at(pos, back - 5, 17, -5); this.at(look, back + 1.5, 0, 0); return; }
    // (At a dock the frame leans towards the cab, so the building doesn't fill half of it.)
    // (A little above eye height, so kerbside clutter near the camera stays low in the frame.)
    const drift = (v === "dolly" ? Math.min(t * 0.3, 8) : 0) + (this.atDock ? 5 : 0);   // slow dolly towards the cab
    this.at(pos, back + 1.5 + drift, this.atDock ? 4.2 : 3.3, -15);
    this.at(look, back + drift, 1.5, 0);
  }

  // The truck (and the other one) as boxes that hide whatever is behind them.
  private truckBoxes(inp: DirectorInput): OccluderBox[] {
    const out: OccluderBox[] = [];
    for (const t of [inp.truck, inp.other]) if (t) { const e = truckExtents(t.model); out.push({ x: t.root.position.x, z: t.root.position.z, h: t.heading, ax0: e.rear, ax1: e.front, hw: 1.3, top: 3.8 }); }
    return out;
  }

  // The load angle that sees the work best: where the driver gets out, walks down the side, works
  // at the back and goes to the door, scored by how much stands in the way. The usual angles are
  // kept (in their usual rotation) unless something blocks them; then a clearer one is used.
  private pickLoadAngle(inp: DirectorInput, usual: string): string {
    const j = inp.journey, truck = inp.truck;
    this.truckFrame(truck);
    const lay = truckLayout(truck.model), ex = truckExtents(truck.model);
    // Where the driver will be (the stop's chores, in the truck's frame), weighted by how long.
    const pts: THREE.Vector3[] = [], wts: number[] = [];
    for (const c of j.chores) for (const q of [c.a, c.b]) if (q) { pts.push(this.at(new THREE.Vector3(), q[0], q[1] + 1.2, q[2])); wts.push(Math.max(0.5, c.len) / (c.a && c.b ? 2 : 1)); }
    if (!pts.length) { pts.push(this.at(new THREE.Vector3(), lay.bedRear + 0.8, 1.2, -0.3)); wts.push(1); }
    void ex;
    const boxes = this.truckBoxes(inp), cam = new THREE.Vector3(), look = new THREE.Vector3();
    const score = (v: string) => {
      let sum = 0;
      let wsum = 0;
      for (const tt of v === "dolly" ? [0, 20] : [0]) { this.loadCam(v, tt, truck, cam, look); pts.forEach((p, i) => { sum += OCCLUSION.blocked(cam, p, boxes) * wts[i]; wsum += wts[i]; }); }
      return sum / wsum;
    };
    const usuals = (this.atDock ? LOAD_VARIANTS.filter((v) => v !== "rear") : [...LOAD_VARIANTS]) as string[];
    const order: [string, number][] = [[usual, 0], ...usuals.filter((v) => v !== usual).map((v) => [v, 0.02] as [string, number]), ...LOAD_EXTRA.filter(([v]) => !(this.atDock && v === "over"))];
    const scored = order.map(([v, pen]) => [v, score(v) + pen] as const);
    const best = Math.min(...scored.map((x) => x[1]));
    this.loadScores = scored.map(([v, sc]) => `${v[0]}${sc.toFixed(2)}`).join(" ");
    return scored.find((x) => x[1] <= best + 0.04)![0];
  }

  // Keep what is filmed in view without the see-through spotlight: when the line from the camera
  // to the driver (out of the seat) or to the truck (driving) has been blocked for a moment, the
  // camera rises gently until it sees over; it settles back down once lower is clear again.
  private lift = 0; private liftTarget = 0; private occT = 0; private clearT = 0; private probeT = 0; private probeCur = 0; private probeLow = 0;
  private keepInView(s: Shot, inp: DirectorInput) {
    const dt = inp.dt, b = this.beat;
    let target: THREE.Vector3 | null = null, maxLift = 0;
    if ((b === "load" || b === "swap") && inp.driver && this.variant !== "over") { target = inp.driver; maxLift = 9; }
    else if ((b === "drive" || b === "country") && this.variant !== "top") { target = this.v3.copy(inp.truck.root.position).setY(2); maxLift = 16; }
    if (!target || s.cut || !this.started) { this.liftTarget = 0; this.occT = this.clearT = 0; }
    else {
      this.probeT -= dt;
      if (this.probeT <= 0) {
        this.probeT = 0.3;
        const boxes = b === "load" || b === "swap" ? this.truckBoxes(inp) : [];
        const c = this.v1b.copy(s.pos); c.y += this.lift;
        this.probeCur = OCCLUSION.blocked(c, target, boxes);
        c.y -= Math.min(3, this.lift);
        this.probeLow = this.lift > 0.5 ? OCCLUSION.blocked(c, target, boxes) : this.probeCur;
      }
      if (this.probeCur > 0.2) { this.occT += dt; this.clearT = 0; } else { this.clearT += dt; this.occT = 0; }
      if (this.occT > 0.7) this.liftTarget = Math.min(maxLift, this.liftTarget + dt * 2.5);
      else if (this.clearT > 2.5 && this.probeLow <= 0.2) this.liftTarget = Math.max(0, this.liftTarget - dt * 1.2);
    }
    if (s.cut || !this.started) this.lift = this.liftTarget;
    else this.lift += (this.liftTarget - this.lift) * (1 - Math.exp(-dt / 1.3));
    s.pos.y += this.lift;
  }
  private v1b = new THREE.Vector3();
  loadScores = "";

  // Where the truck's rear axle will be once docked, facing out of the bay.
  private dockedPose(dk: DockPlan): Pose {
    const g = dk.geom;
    this.pose.x = g.x + Math.cos(g.H) * dk.trail; this.pose.z = g.z - Math.sin(g.H) * dk.trail;
    this.pose.h = g.H; this.pose.k = 0;
    return this.pose;
  }

  // Debug: the camera in the truck's frame (x forward, y up, z right) and yaw relative to it.
  debugLine(truck: Truck): string {
    this.truckFrame(truck);
    const d = this.v3.copy(this.cam.position).sub(this.T);
    return `cam x${d.dot(this.F).toFixed(1)} y${d.y.toFixed(1)} z${d.dot(this.R).toFixed(1)} yaw${(wrapAngle(this.yaw - truck.heading + Math.PI / 2) * 57.3).toFixed(0)} pitch${(this.pitch * 57.3).toFixed(0)} ${this.interior ? "in" : ""} L${this.lift.toFixed(1)} ${this.loadScores}`;
  }

  private topAllowed(j: Journey) {
    if (!j.path || j.st.v < 4) return false;
    for (const tn of j.path.turns) { const d = tn.s - j.st.s; if (d > -10 && d < 110) return false; }
    return j.st.stopS - j.st.s > 420;   // room for two slots up there and the crane down
  }

  // Follow the shot with the springs (or cut), then set the camera.
  private apply(s: Shot, dt: number, truck: Truck) {
    // Carry the camera with the truck's motion since the last frame (see Attach).
    const T = truck.root.position, h = truck.heading;
    const jumped = this.prevT.distanceToSquared(T) > 25;   // a swap hand-over changes the truck
    if (this.havePrev && this.started && !jumped && s.attach && s.attach !== "none") {
      const dh = s.attach === "rigid" ? wrapAngle(h - this.prevH) : 0;
      const c = Math.cos(dh), sn = Math.sin(dh);
      const rx = this.pos.x - this.prevT.x, rz = this.pos.z - this.prevT.z;
      // Heading turns about +y with forward (cos h, -sin h): rotate offsets the same way.
      this.pos.x = T.x + rx * c + rz * sn; this.pos.z = T.z - rx * sn + rz * c;
      const vx = this.vel.x, vz = this.vel.z;
      this.vel.x = vx * c + vz * sn; this.vel.z = -vx * sn + vz * c;
      this.yaw += dh;
    }
    this.prevT.copy(T); this.prevH = h; this.havePrev = true;
    let tyaw: number, tpitch: number;
    if (s.look) {
      const dx = s.look.x - s.pos.x, dy = s.look.y - s.pos.y, dz = s.look.z - s.pos.z;
      tyaw = Math.atan2(-dx, -dz); tpitch = Math.atan2(dy, Math.hypot(dx, dz));
    } else { tyaw = s.yaw ?? this.yaw; tpitch = s.pitch ?? this.pitch; }
    if (!this.started || s.cut) {
      this.pos.copy(s.pos); this.vel.set(0, 0, 0);
      this.yaw = tyaw; this.pitch = tpitch; this.yawV = this.pitchV = 0;
      this.started = true;
    } else {
      const o = s.omega;
      [this.pos.x, this.vel.x] = springStep(this.pos.x, this.vel.x, s.pos.x, o, dt);
      [this.pos.y, this.vel.y] = springStep(this.pos.y, this.vel.y, s.pos.y, o, dt);
      [this.pos.z, this.vel.z] = springStep(this.pos.z, this.vel.z, s.pos.z, o, dt);
      const lo = s.lookOmega ?? o;
      const ty = this.yaw + wrapAngle(tyaw - this.yaw);
      [this.yaw, this.yawV] = springStep(this.yaw, this.yawV, ty, lo, dt);
      [this.pitch, this.pitchV] = springStep(this.pitch, this.pitchV, tpitch, lo, dt);
    }
    this.cam.position.copy(this.pos);
    this.cam.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.cam.updateMatrixWorld();
    this.cutaway = s.cutaway ?? true;
    // Inside the cab: the near plane comes in so the dash isn't clipped, the glass thins out so
    // the view reads, and nothing is cut away.
    this.interior = this.cam.position.distanceTo(this.eye) < 2.0;
    if (this.interior) this.cutaway = false;
    const near = this.interior ? 0.12 : 0.5;
    if (this.cam.near !== near) { this.cam.near = near; this.cam.updateProjectionMatrix(); }
  }
}
