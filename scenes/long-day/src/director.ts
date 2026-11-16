// Camera director (concept doc, "Camera behaviors"). The journey's state decides the beat:
//   drive    on the road in town: follow car, high follow, lead car, side tracking, pass-by,
//            overhead; a new setup every 6-11 s, chosen to suit the road ahead
//   country  the same coverage out of town, with a rising aerial reveal for the landscape
//   roadside a set piece by the road, filmed from a spot beside it (country.ts)
//   arrive   into the cab: push back through the windshield, the passenger seat, the tablet, the mirror
//   curb     across the street, panning with the truck as it pulls in to the kerb
//   backup   from beside the bay, panning with the truck as it backs in
//   load     coverage of the work, cut to its phases: the cab door, a master on the back of the
//            truck (with an alternate angle on long loads), closing up, back to the cab door,
//            then a wide for the start-up; a signature orbit (one stop in eight) and a gag insert
//   swap     follow the driver from the old cab to the new one: shoulder, low, crane, push-in
//   depart   from the start-up wide: hold and let the truck go, crane up into the follow, or
//            cut to the lead car
//
// Every shot is authored: a camera position and what it frames, worked out exactly from the
// truck, its route or a fixed spot each frame, so a shot is either locked off, panning with its
// subject, or making one deliberate move (eased in and out over a set time). Nothing chases a
// target on springs, so the camera never drifts on its own. The only springs are an operator's pan
// (a fixed camera following the driver) and the smoothed heading that truck-relative rigs turn
// with. Shots that ride along the road are placed on the route itself (Path, CountryRoad), so they
// stay over the street and round its corners like a camera car.
//
// Every frame is composed: the subject's screen position (`sx`, `sy`) and the lens (`fov`) are part
// of the shot, so the truck is big in the 3:1 frame, with room ahead of it. The coverage keeps to the
// truck's left (street) side, so its direction of travel reads the same from cut to cut.
//
// Variants for a stop's beats come from a hash of the stop count (never the previous stop's for the
// same beat); the road coverage from a hash of a running shot count. All of it is state the preview
// snapshots (save/load), so a scrubbed journey frames every moment the same way.
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

interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;             // what is framed...
  sx?: number; sy?: number;        // ...and where on screen (-1..1, right and up), for lead room
  yaw?: number; pitch?: number;    // an explicit orientation instead (straight down)
  fov?: number;                    // vertical lens, degrees
  cut?: boolean; cutaway?: boolean;
  pan?: number;                    // an operator's pan towards the framing (spring omega); 0: exact
}

interface DirectorInput {
  journey: Journey;
  truck: Truck;              // the truck the journey drives
  other: Truck | null;       // the spare (before a swap's hand-over) or the parked old truck
  gag?: THREE.Vector3 | null; // where a humorous load is right now (Crew.gagPoint)
  driver?: THREE.Vector3 | null;   // the driver's chest while out of the seat
  dt: number;
}

const FOV = 38;
const ARRIVE_DIST = 45, CURB_DIST = 13, DEPART_LEN = 12;
const LOAD_VARIANTS = ["side", "rear"] as const;
const DOCK_VARIANTS = ["dock", "side"] as const;   // backed into a dock: the bay from the yard, or the truck's street side
// Other masters on the work, for when the usual ones look through too much (occlusion.ts), with how
// much less they are liked: high over the street side, from ahead of the cab, the truck's other side.
const LOAD_EXTRA: [string, number][] = [["high", 0.08], ["front", 0.1], ["right", 0.12]];
// A load angle's camera keeps this far from anything mapped as tall (occlusion.ts): the near clip
// (cutaway.ts, 3 m) and a margin.
const LOAD_CLEARANCE = 3.5;
const ARRIVE_VARIANTS = ["dive", "passenger", "tablet"] as const;
const DEPART_VARIANTS = ["hold", "crane", "lead"] as const;
const SWAP_VARIANTS = ["shoulder", "low", "crane", "pushin"] as const;
// The road coverage, and how long each setup runs (seconds, min and max). "passby" runs until the
// truck is nearly past.
type RoadShot = "chase" | "high" | "lead" | "track" | "passby" | "top" | "aerial";
const ROAD_LEN: Record<RoadShot, [number, number]> = {
  chase: [8, 11], high: [7, 10], lead: [6, 8], track: [6, 8], passby: [14, 14], top: [6, 7], aerial: [10, 10],
};
// Shot sizes, so consecutive setups differ by more than a nudge (no jump cuts).
const ROAD_SIZE: Record<RoadShot, number> = { chase: 1, lead: 1, track: 2, passby: 2, high: 3, top: 3, aerial: 3 };

const smoother = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

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
  variant = "chase";
  interior = false;
  cutaway = true;
  private pos = new THREE.Vector3();
  private yaw = 0; private yawV = 0; private pitch = -0.4; private pitchV = 0;
  private started = false;
  avoidBuildings: ((pos: THREE.Vector3, truck: THREE.Vector3, rise: boolean) => boolean) | null = null;   // main: keeps a camera out of buildings
  // The truck's heading, smoothed, for rigs that turn with the truck (a corner is a turn, not a jolt).
  private refYaw = 0; private refYawV = 0;
  private anchorPos = new THREE.Vector3(); private anchorLook = new THREE.Vector3(); private anchorH = 0;
  private signature = false; private gag = false; private gagStart = -1;
  private time = 0;
  private feature: ReturnType<CountryRoad["featureShot"]> = null; private featureKey = -1;
  private atDock = false; private lastBeat: Beat = "drive";
  // The road coverage: the running setup, when it started, how long it runs, how many there have
  // been, whether it rides the route (else the smoothed heading), its fixed spot (pass-by) or
  // orientation (overhead), and an opening move from where the camera was (depart's crane).
  private road: RoadShot | "" = ""; private roadRecent: string[] = [];
  private roadStart = 0; private roadLen = 0; private roadCount = 0; private roadOnRoute = false;
  private roadSpot = new THREE.Vector3(); private roadYaw = 0;
  private blendLen = 0; private blendPos = new THREE.Vector3(); private blendLook = new THREE.Vector3();
  // The load coverage's current setup and its spot (a cut when it changes).
  private loadShot = ""; private loadPos = new THREE.Vector3(); private loadLook = new THREE.Vector3();
  private loadAlt = ""; private loadMaster = "side"; private loadThird = "";
  private loadSeg = 0; private loadSegAt = 0; private loadSegChore = -1;
  private backSpot = new THREE.Vector3();
  // The world moved by (dx, dz) under the camera (main.ts: the next city takes over out on the
  // road): move with it, so nothing on screen changes.
  rebase(dx: number, dz: number) {
    for (const v of [this.pos, this.anchorPos, this.anchorLook, this.roadSpot, this.blendPos, this.blendLook, this.loadPos, this.loadLook, this.backSpot]) { v.x += dx; v.z += dz; }
  }
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
    this.started = false;
    this.beat = "drive"; this.beatTime = 0; this.featureKey = -1; this.gag = false; this.gagStart = -1;
    this.road = ""; this.loadShot = "";
  }
  // scratch
  private T = new THREE.Vector3(); private F = new THREE.Vector3(); private R = new THREE.Vector3();
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3(); private v3 = new THREE.Vector3(); private v4 = new THREE.Vector3();
  private eye = new THREE.Vector3(); private peye = new THREE.Vector3(); private tab = new THREE.Vector3();
  private pose: Pose = { x: 0, z: 0, h: 0, k: 0 };

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
      if (f) { if (this.beat !== "roadside" || f.key !== this.featureKey) this.feature = f; return "roadside"; }
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
    this.anchorPos.copy(this.started ? this.pos : this.cam.position);
    this.anchorH = inp.truck.heading;
    switch (beat) {
      case "arrive": {
        const list: string[] = [...ARRIVE_VARIANTS];
        if (stop && j.isDockStop(stop)) list.push("mirror");
        this.variant = this.pick("arrive", list, n);
        break;
      }
      case "backup": this.variant = "bay"; this.backSpot.copy(this.backupSpot(inp)); break;
      case "load": {
        // Backed into a dock, the truck's rear is at the building: side views only.
        this.atDock = !!stop && j.isDockStop(stop);
        this.loadMaster = this.pickLoadAngle(inp, this.pick("load", this.atDock ? DOCK_VARIANTS : LOAD_VARIANTS, n));
        const others = (this.atDock ? ["dock", "side", "high", "front"] : ["side", "rear", "high", "front"]).filter((v) => v !== this.loadMaster);
        this.loadAlt = others[0]; this.loadThird = others[2];
        this.loadSegChore = -1;
        this.variant = this.loadMaster;
        this.signature = hash3(n, 7, 7, this.seed, 0x51) < 1 / 8;
        this.gag = !!stop && CARGO_BY_ID.get(stop.cargo)?.tier === "humorous";
        this.gagStart = -1; this.loadShot = "";
        break;
      }
      case "swap": this.variant = this.pick("swap", SWAP_VARIANTS, n); this.atDock = false; this.loadShot = ""; break;
      case "depart": {
        // A swap departs with the crane, leaving the old truck parked in frame; a dock has its
        // building behind the truck, so no crane up from behind there.
        const dock = this.atDock;
        const list = DEPART_VARIANTS.filter((v) => !(dock && v === "crane"));
        this.variant = inp.other && st.parked ? "crane" : this.pick("depart", list, n);
        this.road = "";
        break;
      }
      case "curb": {
        // Fixed across the street from where the truck will stop.
        const p = j.path!.eval(st.stopS, this.pose);
        const h = p.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
        const c = truckExtents(st.truck).center;
        // On the far side of the street (street trees line the far sidewalk), a little ahead of centre.
        this.anchorPos.set(p.x + fx * (c + 4) - rx * 10.5, 2.6, p.z + fz * (c + 4) - rz * 10.5);
        this.anchorLook.set(p.x + fx * c, 1.5, p.z + fz * c);
        break;
      }
      case "drive":
      case "country":
        // Out of a depart the road coverage carries on; in or out of town, or after anything else,
        // it starts afresh with a cut (leaving town opens on the landscape).
        if (!(beat === "drive" && this.lastBeat === "depart")) this.road = "";
        break;
      case "roadside": {
        // Fixed beside the road, framing the truck with the set piece.
        const road = j.country!, f = this.feature!;
        this.featureKey = f.key;
        road.point(f.cam[0], f.cam[1], this.pose); this.anchorPos.set(this.pose.x, f.cam[2], this.pose.z);
        road.point(f.look[0], f.look[1], this.pose); this.anchorLook.set(this.pose.x, f.look[2], this.pose.z);
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
    // The rigs' heading: the truck's, smoothed (about half a second behind through a corner).
    if (!this.started) { this.refYaw = truck.heading; this.refYawV = 0; }
    else {
      const target = this.refYaw + wrapAngle(truck.heading - this.refYaw);
      [this.refYaw, this.refYawV] = springStep(this.refYaw, this.refYawV, target, 3.5, dt);
    }
    const beat = this.chooseBeat(inp);
    const beatChanged = beat !== this.beat || !this.started || (beat === "roadside" && !!this.feature && this.feature.key !== this.featureKey);
    if (beatChanged) this.enterBeat(beat, inp);
    this.beatTime = Math.max(0, this.time - this.beatStart);   // journey time, so a scrub lands on the same frame

    const shot = this.shot(inp);
    // A new beat is a new shot, except where one carries on into the next by design.
    if (beatChanged && beat !== "drive" && beat !== "country" && beat !== "depart") shot.cut = true;
    this.keepInView(shot, inp);
    this.apply(shot, dt);
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
  // The same in the smoothed heading's frame, about the truck's centre.
  private atRef(out: THREE.Vector3, cx: number, x: number, y: number, z: number) {
    const h = this.refYaw, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    const c = this.at(this.v4, cx, 0, 0);
    return out.set(c.x + fx * x + rx * z, this.T.y + y, c.z + fz * x + rz * z);
  }

  // A point on the truck's route `ds` metres along from its rear axle (negative: behind), `lat`
  // metres to the right of the truck's line, at height y: on the city path or the country road.
  // Before the route's start (a kerb stop's departure) it carries straight on backwards; false
  // where there is no route there.
  private onRoute(j: Journey, ds: number, lat: number, y: number, out: THREE.Vector3, backOk = true): boolean {
    const st = j.st, p = this.pose;
    let h: number;
    if (st.mode === "drive" && j.path) {
      // (Where the truck is drawn, between the journey's last two steps, not where it stepped to.)
      const s = st.s - (1 - j.alpha) * j.lastStep + ds, L = j.path.length;
      if (s > L) return false;
      if (s < 0) {
        if (!backOk) return false;
        j.path.eval(0, p); h = p.h;
        p.x += Math.cos(h) * s; p.z -= Math.sin(h) * s;
      } else { j.path.eval(s, p); h = p.h; }
      j.path.eval(st.s, this.pose2);   // (leave the path's cursor where the journey keeps it)
    } else if ((st.mode === "country" || st.mode === "inbound") && j.country) {
      const r = j.country, s = r.sAt(Math.max(0, j.countryU + j.frac)) + ds;
      if (s < 0 || s > r.length) return false;
      r.point(s, r.laneAt(s), p); h = p.h;
    } else return false;
    out.set(p.x + Math.sin(h) * lat, y, p.z + Math.cos(h) * lat);
    return true;
  }
  private pose2: Pose = { x: 0, z: 0, h: 0, k: 0 };

  // Turns on the city path between ds0 and ds1 metres from the truck.
  private turnWithin(j: Journey, ds0: number, ds1: number) {
    if (!j.path || j.st.mode !== "drive") return false;
    for (const tn of j.path.turns) { const d = tn.s - j.st.s; if (d > ds0 && d < ds1) return true; }
    return false;
  }

  private shot(inp: DirectorInput): Shot {
    const j = inp.journey, st = j.st, truck = inp.truck;
    const s: Shot = { pos: this.v1, look: this.v2, cutaway: true };
    this.truckFrame(truck);
    const ex = truckExtents(truck.model);
    truck.anchors.driverEye.getWorldPosition(this.eye);
    truck.anchors.passengerEye.getWorldPosition(this.peye);
    truck.anchors.tablet.getWorldPosition(this.tab);
    const t = this.beatTime;
    const F = this.F, R = this.R;

    switch (this.beat) {
      case "drive":
      case "country":
        return this.roadCoverage(inp, s);

      case "roadside": {
        // Locked off; the pan leans from the set piece towards the truck as it comes close.
        const d = Math.hypot(this.T.x - this.anchorPos.x, this.T.z - this.anchorPos.z);
        const f = this.feature, ahead = f ? j.countryS - f.cam[0] : 0;
        const k = f?.fixed ? (ahead < 8 ? 1 : THREE.MathUtils.clamp(0.9 - (ahead - 8) / 120, 0.5, 0.9)) : THREE.MathUtils.clamp((d - 15) / 80, 0.15, 0.4);
        s.pos.copy(this.anchorPos);
        s.look.set(this.T.x + (this.anchorLook.x - this.T.x) * k, 1.6 + (this.anchorLook.y - 1.6) * k, this.T.z + (this.anchorLook.z - this.T.z) * k);
        s.pan = 3; s.cutaway = false; s.fov = 34;
        this.variant = "roadside";
        return s;
      }

      case "arrive": {
        // Rigid with the truck: these are cab and hood angles. Each is cut in, then holds or makes
        // one move.
        const v = this.variant;
        const pov = () => { s.pos.copy(this.eye).addScaledVector(F, -0.15).setY(this.eye.y + 0.05); s.look.copy(this.tab).addScaledVector(F, 2.5).setY(this.tab.y - 0.15); };
        s.fov = 40; s.cutaway = false;
        if (v === "dive") {
          // Over the hood looking down the street for the destination, then a push back through
          // the windshield into the driver's seat, settling on the dash and the tablet.
          const u = smoother((t - 1.6) / 1.6);
          const hood = this.v3.copy(this.eye).addScaledVector(F, 2.4).setY(this.eye.y + 0.55);
          pov();
          s.pos.lerpVectors(hood, this.v4.copy(s.pos), u);
          const far = this.v4.copy(this.eye).addScaledVector(F, 22).setY(1.4);
          s.look.lerpVectors(far, this.v3.copy(s.look), u);
          s.cut = t < 0.05;
        } else if (v === "passenger") {
          // From the passenger seat: the driver in profile against the street ahead, then a slow pan
          // round to the windshield as the destination comes up.
          const u = smoother((t - 2.5) / 2.5);
          s.pos.copy(this.peye).addScaledVector(F, -0.25).setY(this.peye.y + 0.05);
          s.look.copy(this.eye).addScaledVector(F, 0.8 + 3.2 * u).setY(this.eye.y - 0.1 - 0.15 * u);
          s.cut = t < 0.05;
        } else if (v === "tablet" && t >= 2.2 && t < 5.2) {
          // Insert: the tablet's next stop.
          s.pos.copy(this.tab).addScaledVector(F, -0.45).addScaledVector(R, 0.12).setY(this.tab.y + 0.1); s.look.copy(this.tab); s.fov = 34;
          s.cut = t - 2.2 < 0.05;
        } else if (v === "mirror" && t >= 2.2 && t < 5.2) {
          // Insert: the mirror, the dock coming up behind.
          s.pos.copy(this.eye).addScaledVector(F, 0.4).addScaledVector(R, -1.7).setY(this.eye.y - 0.15); s.look.copy(this.at(this.v3, -16, 1.0, -4.8));
          s.cut = t - 2.2 < 0.05;
        } else {
          pov();
          s.cut = t < 0.05 || (t >= 5.2 && t < 5.25);
        }
        return s;
      }

      case "curb": {
        // Locked off across the street; the operator pans with the truck as it pulls in and stops.
        s.pos.copy(this.anchorPos);
        this.at(s.look, ex.center, 1.5, 0);
        if (st.mode === "dwell") s.look.copy(this.anchorLook);
        s.pan = 2.6; s.cutaway = false; s.fov = 32;
        return s;
      }

      case "backup": {
        // From beside the bay, clear of everything the truck sweeps through: pan with the truck as
        // it swings round and backs in.
        s.pos.copy(this.backSpot);
        this.at(s.look, ex.center, 1.6, 0);
        s.pan = 2.2; s.cutaway = false; s.fov = 34;
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
          s.look.copy(g); s.fov = 32;
          s.cut = t - this.gagStart < 0.05; s.cutaway = false;
          this.loadShot = "gag";
          return s;
        }
        // Signature orbit (about one stop in eight): one slow, eased half-orbit while the driver
        // climbs down and walks back.
        if (this.signature && t < 9) {
          // From the street side round the rear; at a dock (rear against the building), from the
          // front quarter round to the side instead.
          const u = smoother(t / 9);
          const c = ex.center, a = this.atDock ? -0.12 * Math.PI - u * Math.PI * 0.38 : -Math.PI / 2 - u * Math.PI * 0.9;
          this.at(s.pos, c + Math.cos(a) * 14, 3.6, Math.sin(a) * 14);
          this.at(s.look, c, 1.5, 0);
          s.cut = this.loadShot !== "orbit"; s.cutaway = false; s.fov = 36;
          this.loadShot = "orbit";
          return s;
        }
        return this.loadCoverage(inp, ph, s);
      }

      case "swap": {
        const ph = j.dwellPhase();
        const handed = ph.phase === "startup";
        const oldT = handed ? inp.other : truck, newT = handed ? truck : inp.other;
        if (!oldT || !newT) { this.at(s.pos, ex.front + 8, 4, -9); this.at(s.look, ex.center, 1.5, 0); return s; }
        s.cutaway = false;
        if (ph.phase === "enter" || handed) {
          // Behind the new cab, locked off, as the driver climbs in and it starts up.
          this.truckFrame(newT);
          const ne = truckExtents(newT.model);
          this.at(s.pos, ne.doorX - 7, 3.2, -4); this.at(s.look, ne.doorX + 2, 1.8, 0);
          s.cut = this.loadShot !== "swapEnter"; this.loadShot = "swapEnter";
          return s;
        }
        // Walking with the driver.
        const D = swapWalkPoint(j, oldT, newT, this.v3);
        const v = this.variant;
        if (v === "low") { s.pos.copy(D).addScaledVector(R, -2.4).addScaledVector(F, -1).setY(0.6); s.look.copy(D).addScaledVector(F, 2.5).setY(0.9); s.fov = 40; }
        else if (v === "crane") { s.pos.copy(D).addScaledVector(R, -7).addScaledVector(F, -3.5).setY(7); s.look.copy(D).setY(1); }
        else if (v === "pushin" && ph.phase === "walk" && ph.t > ph.len - 1.5) {
          newT.anchors.driverEye.getWorldPosition(s.look);
          s.pos.copy(D).addScaledVector(R, -2.2).addScaledVector(F, -1.5).setY(1.8);
        } else { s.pos.copy(D).addScaledVector(R, -3.2).addScaledVector(F, -1).setY(1.7); s.look.copy(D).addScaledVector(F, 3).setY(1.3); s.fov = 36; }
        const key = "swap/" + v + (v === "pushin" && ph.phase === "walk" && ph.t > ph.len - 1.5 ? "2" : "");
        s.cut = this.loadShot !== key; this.loadShot = key;
        return s;
      }

      case "depart": {
        const v = this.variant;
        if (!this.road) {
          // Opening: from the start-up wide (where the camera is), by variant.
          if (v === "hold" && (t < 3.5 || !this.routeFollowOk(j, ex, 14)) && t < 7) {
            // Locked off; the operator pans as the truck pulls out, then cut to the follow.
            s.pos.copy(this.anchorPos); this.at(s.look, ex.center, 1.5, 0);
            s.pan = 2.4; s.cutaway = false; s.fov = 36;
            return s;
          }
          if (v === "crane") this.startRoad(inp, "high", 4);
          else if (v === "lead") this.startRoad(inp, "lead");
          else this.startRoad(inp, this.routeFollowOk(j, ex, 14) ? "chase" : "lead");
          if (v !== "crane") return this.roadCoverage(inp, s, true);
        }
        return this.roadCoverage(inp, s);
      }
    }
  }

  // Whether a follow `back` metres behind the truck's centre can ride its route.
  private routeFollowOk(j: Journey, ex: ReturnType<typeof truckExtents>, back: number) {
    if (j.st.mode !== "drive" || !j.path) return false;
    const s = j.st.s + ex.center - back;
    return s >= 0 || !this.atDock;
  }

  // ---- road coverage --------------------------------------------------------------------------
  // The setups that can be used from here, with the truck where it is and the road ahead as it is.
  private roadOptions(inp: DirectorInput): RoadShot[] {
    const j = inp.journey, st = j.st, ex = truckExtents(inp.truck.model);
    const town = st.mode === "drive" && !!j.path;
    const out: RoadShot[] = ["chase", "high"];
    const toStop = town ? st.stopS - st.s : 1e9;
    if (town) {
      const v = Math.max(st.v, 4);
      const lead = ex.front + 10;
      if (st.s + lead + 6 < j.path!.length) out.push("lead");
      // Side tracking and overhead want a straight run; the pass-by a straight to stand on and a
      // truck that will get there before the stop.
      if (!this.turnWithin(j, -8, v * 8 + 20) && toStop > v * 8 + ARRIVE_DIST && st.v > 3) out.push("track");
      if (!this.turnWithin(j, -8, v * 7 + 25) && toStop > v * 7 + ARRIVE_DIST && st.v > 4) out.push("top");
      const pa = this.passbyAhead(j);
      if (!this.turnWithin(j, -8, pa + 6) && toStop > pa + 6 + ARRIVE_DIST && st.v > 4) out.push("passby");
    } else if (j.country) {
      const r = j.country, s0 = j.countryS;
      out.push("lead", "track", "aerial");
      const pa = this.passbyAhead(j);
      if (s0 + pa + 10 < r.length - 80 && st.v > 6 && r.clearAt(s0 + pa, -(r.laneAt(s0 + pa) + 9)) && !r.featureShot(s0 + pa)) out.push("passby");
    }
    return out;
  }

  // Start a road setup (`kind`, or the next in the rotation), with an opening move of `blend`
  // seconds from where the camera is now.
  private startRoad(inp: DirectorInput, kind: RoadShot | null, blend = 0) {
    const j = inp.journey, st = j.st, ex = truckExtents(inp.truck.model);
    // How long before the next beat takes over (the stop's arrival, a set piece by the road): a
    // setup that needs time to pay off (a reveal, a pass-by) is only started with time for it.
    let horizon = 1e9;
    const v = Math.max(st.v, 3);
    if (st.mode === "drive" && j.path && st.stops[0]) horizon = (st.stopS - st.s - ARRIVE_DIST) / v;
    else if (j.country) for (let k = 1; k <= 12; k++) if (j.country.featureShot(j.countryS + v * k)) { horizon = k; break; }
    let opts = this.roadOptions(inp).filter((o) => horizon >= (o === "aerial" || o === "passby" ? 9 : o === "chase" || o === "high" ? 0 : 5));
    if (!opts.length) opts = ["chase", "high"];
    const prev = this.road;
    this.roadCount++;
    if (!kind) {
      // Weighted rotation: the follow most often; never the same setup or the same size twice.
      const W: Record<RoadShot, number> = { chase: 3, high: 2, lead: 2, track: 2, passby: 1.5, top: 1, aerial: 2 };
      // (A pass-by or an overhead is punctuation: not again within three setups.)
      let pool = opts.filter((o) => o !== prev && (!prev || ROAD_SIZE[o] !== ROAD_SIZE[prev]) && !((o === "passby" || o === "top") && this.roadRecent.includes(o)));
      if (!pool.length) pool = opts.filter((o) => o !== prev);
      if (!pool.length) pool = opts;
      let sum = 0; for (const o of pool) sum += W[o];
      let r = hash3(this.roadCount, 5, st.city, this.seed, 0x7d1) * sum;
      kind = pool[pool.length - 1];
      for (const o of pool) { r -= W[o]; if (r < 0) { kind = o; break; } }
    }
    this.roadRecent = [kind, ...this.roadRecent].slice(0, 3);
    this.road = kind;
    this.roadStart = this.time;
    const [a, b] = ROAD_LEN[kind];
    this.roadLen = a + (b - a) * hash2(this.roadCount, 11, this.seed);
    // Ride the route when the whole rig can (it stays over the street round corners); else turn
    // with the truck's smoothed heading.
    const town = st.mode === "drive" && !!j.path;
    const back = kind === "high" ? 11 + (ex.front - ex.rear) * 0.5 : kind === "aerial" ? 14 : 8 + (ex.front - ex.rear) * 0.5;
    this.roadOnRoute = kind === "lead" || kind === "track" || kind === "passby" ? true
      : town ? this.routeFollowOk(j, ex, back) : (j.country ? j.countryS + ex.center - back - 20 > 0 : false);
    if (kind === "passby") {
      const ahead = this.passbyAhead(j);
      // (Up at 3.5 m, so the oncoming lane's cars pass under the line to the truck.)
      if (town) this.onRoute(j, ahead, -(4.5 + 6.6), 3.5, this.roadSpot);
      else { const r = j.country!, s1 = j.countryS + ahead; this.onRoute(j, ahead, -(r.laneAt(s1) + 9), 2.5, this.roadSpot); }
    }
    if (kind === "top") this.roadYaw = Math.round(this.refYaw / (Math.PI / 2)) * (Math.PI / 2) + Math.PI;   // (travelling right to left)
    this.blendLen = blend;
    if (blend > 0) {
      this.blendPos.copy(this.pos);
      this.cam.getWorldDirection(this.blendLook).multiplyScalar(12).add(this.pos);
    }
  }

  private roadCoverage(inp: DirectorInput, s: Shot, forceCut = false): Shot {
    const j = inp.journey, st = j.st, truck = inp.truck, ex = truckExtents(truck.model);
    const L = ex.front - ex.rear;
    // Time for a new setup? (Its length is up; a pass-by once the truck is nearly past; the
    // straight-road setups as a turn comes up.)
    let cut = forceCut;
    if (!this.road) { this.startRoad(inp, this.beat === "country" && this.lastBeatWasTown() ? "aerial" : null); cut = true; }
    else {
      const e = this.time - this.roadStart;
      let done = e >= this.roadLen;
      if (this.road === "passby") {
        const along = (this.roadSpot.x - this.T.x) * this.F.x + (this.roadSpot.z - this.T.z) * this.F.z;
        done = along < ex.front + 1 || e > 16 || (st.v < 0.5 && e > 5);
      }
      if ((this.road === "track" || this.road === "top") && this.turnWithin(j, -4, Math.max(st.v, 3) * 2.5 + 8)) done = e > 2.5 || done;
      if (this.road === "lead" && st.mode === "drive" && j.path && st.s + ex.front + 10 > j.path.length - 2) done = true;
      if (done) { this.startRoad(inp, null); cut = true; }
    }
    this.variant = this.road;
    const e = this.time - this.roadStart, u = this.roadLen > 0 ? e / this.roadLen : 0;
    const C = this.at(this.v3, ex.center, 1.5, 0);
    switch (this.road as RoadShot) {
      case "chase": {
        // Follow car: low behind and a little left, the truck in the lower middle, the road ahead
        // above it; a slow push in over the shot.
        const back = 8 + L * 0.5 - 1.5 * smoother(u);
        this.rig(j, back, -1.4, 4.0, s.pos, ex);
        this.at(s.look, ex.center + 3, 1.6, 0); s.sy = -0.12; s.fov = 34;
        break;
      }
      case "high": {
        const back = 11 + L * 0.5;
        this.rig(j, back, -3.5, 13, s.pos, ex);
        this.at(s.look, ex.center + 5, 0.8, 0); s.sy = -0.2; s.fov = 36;
        break;
      }
      case "lead": {
        // Lead car: ahead and a little left, looking back at the cab coming on.
        const ahead = ex.front + 10;
        const ll = st.mode === "drive" ? -1.6 : -3.2, lh = st.mode === "drive" ? 2.6 : 3.2;
        if (!this.onRoute(j, ahead, ll, lh, s.pos, false)) this.atRef(s.pos, ex.center, ahead - ex.center, lh, ll);
        this.at(s.look, ex.center + L * 0.15, 1.7, 0); s.sy = -0.05; s.fov = 32;
        break;
      }
      case "track": {
        // Side tracking from the left, level with the truck, which travels right to left with
        // room ahead of it.
        const town = st.mode === "drive";
        const lat = town ? -11.5 : -(j.country ? j.country.laneAt(j.countryS) : 1.85) - 11;
        if (!this.onRoute(j, ex.center + 1.5, lat, 2.0, s.pos)) this.atRef(s.pos, ex.center, 1.5, 2.0, -12);
        s.look.copy(C).setY(1.7); s.sx = 0.22; s.fov = 38;
        break;
      }
      case "passby": {
        // Planted on the far kerb ahead: the truck comes down the road, the camera panning with
        // it, until it is about to pass.
        s.pos.copy(this.roadSpot); s.look.copy(C).setY(1.6);
        s.fov = 24; s.cutaway = false;
        break;
      }
      case "top": {
        // Straight down, the truck running across the wide frame.
        this.at(s.pos, ex.center + 4, 22, 0);
        s.yaw = this.roadYaw; s.pitch = -Math.PI / 2 + 0.001; s.fov = 38;
        break;
      }
      case "aerial": {
        // A rising reveal of the land: one eased move up and out to the left over the shot.
        const k = smoother(u);
        const back = 14 + 18 * k, lat = -6 - 16 * k, h = 4.5 + 22 * k;
        if (!(this.roadOnRoute && this.onRoute(j, ex.center - back, lat, h, s.pos))) this.atRef(s.pos, ex.center, -back, h, lat);
        this.at(s.look, ex.center + 4 + 10 * k, 1.2, 0); s.sy = -0.1 - 0.15 * k; s.fov = 40;
        break;
      }
    }
    // In town a truck-relative rig can swing over a block at a corner: keep it out of buildings.
    if (!this.roadOnRoute && st.mode === "drive" && this.avoidBuildings && this.road !== "top" && this.road !== "passby") this.avoidBuildings(s.pos, truck.root.position, true);
    // An opening move (depart's crane): from where the camera was into the setup, eased.
    if (this.blendLen > 0 && e < this.blendLen) {
      const k = smoother(e / this.blendLen);
      s.pos.lerpVectors(this.blendPos, this.v4.copy(s.pos), k);
      s.look.lerpVectors(this.blendLook, this.v4.copy(s.look), k);
      s.sx = (s.sx ?? 0) * k; s.sy = (s.sy ?? 0) * k;
    } else if (cut) s.cut = true;
    return s;
  }
  private lastBeatWasTown() { return this.prevRoadTown; }
  private prevRoadTown = false;

  // How far ahead a pass-by camera stands: about four seconds of driving.
  private passbyAhead(j: Journey) { return THREE.MathUtils.clamp(j.st.v * 5.5, 40, 110); }

  // A follow rig `back` metres behind the truck's centre, `lat` to its right, at height y: on the
  // route when the setup rides it, else in the smoothed heading's frame.
  private rig(j: Journey, back: number, lat: number, y: number, out: THREE.Vector3, ex: ReturnType<typeof truckExtents>) {
    if (this.roadOnRoute && this.onRoute(j, ex.center - back, lat, y, out)) return out;
    return this.atRef(out, ex.center, -back, y, lat);
  }

  // ---- load coverage --------------------------------------------------------------------------
  // The work, cut to its phases. Each setup is locked off and the operator pans with the driver.
  private loadCoverage(inp: DirectorInput, ph: ReturnType<Journey["dwellPhase"]>, s: Shot): Shot {
    const truck = inp.truck, ex = truckExtents(truck.model);
    let key: string;
    if (ph.phase === "exit" || ph.phase === "enter") key = "door";
    else if (ph.phase === "startup") key = "start";
    else if (ph.phase === "close") key = this.atDock || this.loadMaster === "rear" ? this.loadMaster : "rear";
    else {
      // A long load cuts between setups as the driver sets off on a trip (cutting on the action),
      // at most every 6 s and not in its last 4: the master, a second angle, the master, a third.
      const ci = ph.chore ? inp.journey.chores.indexOf(ph.chore) : -1;
      if (ph.t < 0.05 || this.loadSegChore < 0) { this.loadSeg = 0; this.loadSegAt = this.time; }
      else if (ci !== this.loadSegChore && (ph.chore?.kind === "walk" || ph.chore?.kind === "fetch") && this.time - this.loadSegAt >= 6 && ph.len - ph.t > 4) { this.loadSeg++; this.loadSegAt = this.time; }
      this.loadSegChore = ci;
      const rot = [this.loadMaster, this.loadAlt, this.loadMaster, this.loadThird];
      key = rot[this.loadSeg % 4] || this.loadMaster;
    }
    if (key !== this.loadShot) {
      this.loadCam(key, truck, this.loadPos, this.loadLook);
      s.cut = true;
      this.loadShot = key;
    }
    s.pos.copy(this.loadPos);
    // Frame between the setup's centre of interest and the driver, panning with the driver.
    s.look.copy(this.loadLook);
    if (inp.driver && key !== "start") s.look.lerp(inp.driver, key === "door" ? 0.6 : 0.5);
    if (key === "start") this.at(s.look, ex.center + 1, 1.5, 0);
    s.pan = 2.4; s.cutaway = false;
    s.fov = key === "door" || key === "rear" ? 34 : key === "start" ? 38 : 36;
    this.variant = key;
    return s;
  }

  // A load setup's camera and look (truck frame set). In a tight spot (a dock yard between
  // buildings, a canopy overhead) the camera moves, level, to the nearest place clear of anything
  // tall and not too close to what it films: closer than the near clip (cutaway.ts) to a wall, it
  // would see a round hole cut in it.
  private loadCam(v: string, truck: Truck, pos: THREE.Vector3, look: THREE.Vector3) {
    this.truckFrame(truck);
    this.loadCamRaw(v, truck, pos, look);
    if (OCCLUSION.clearance(pos, LOAD_CLEARANCE) >= LOAD_CLEARANCE) return;
    const x0 = pos.x, z0 = pos.z;
    let bx = x0, bz = z0, bestC = OCCLUSION.clearance(pos, LOAD_CLEARANCE);
    for (let d = 0.5; d <= 8; d += 0.5) {
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        pos.x = x0 + Math.cos(a) * d; pos.z = z0 + Math.sin(a) * d;
        if (Math.hypot(pos.x - look.x, pos.z - look.z) < 4) continue;   // still a view, not a close-up
        const c = OCCLUSION.clearance(pos, LOAD_CLEARANCE);
        if (c >= LOAD_CLEARANCE) return;
        if (c > bestC) { bestC = c; bx = pos.x; bz = pos.z; }
      }
    }
    pos.x = bx; pos.z = bz;   // nowhere clear: the clearest
  }
  private loadCamRaw(v: string, truck: Truck, pos: THREE.Vector3, look: THREE.Vector3) {
    // The work happens at the back: frame the bed's end with room behind it for the walk to the
    // facility (a trailer is long, so its frame sits further forward on the trailer). At a dock
    // the frame leans towards the cab, so the building doesn't fill half of it.
    const lay = truckLayout(truck.model), ex = truckExtents(truck.model), back = lay.trailer ? lay.bedRear + 3 : lay.bedRear - 3.5;
    const dock = this.atDock ? 5 : 0;
    switch (v) {
      case "door": this.at(pos, ex.doorX + 5, 1.9, ex.doorZ - 4.5); this.at(look, ex.doorX - 1, 1.3, ex.doorZ * 0.6); return;
      case "start": this.at(pos, ex.front + 7, 5, -9); this.at(look, ex.center + 1, 1.5, 0); return;
      case "rear": this.at(pos, lay.bedRear - 5.5, 1.8, -4.6); this.at(look, lay.bedRear + 0.6, 1.3, -0.2); return;
      case "high": this.at(pos, back + 3 + dock, 8, -10); this.at(look, back - 0.5 + dock, 0.8, 0); return;
      case "front": this.at(pos, ex.front + 6, 2.8, -6.5); this.at(look, back + 1, 1.2, -0.5); return;
      case "right": this.at(pos, back + 1.5 + dock, 3.2, 11); this.at(look, back + dock, 1.4, 0); return;
      // The bay from the yard: a three-quarter view of the dock face, the stairs and the truck's end.
      case "dock": this.at(pos, lay.bedRear + 9, 3.2, -8.5); this.at(look, lay.bedRear - 0.5, 1.8, -1.5); return;
    }
    // The master, "side": abeam of the bed's end from the street side.
    this.at(pos, back + 1.5 + dock, this.atDock ? 3.6 : 2.6, -10.5);
    this.at(look, back + dock - 0.5, 1.3, 0);
  }

  // The truck (and the other one) as boxes that hide whatever is behind them.
  private truckBoxes(inp: DirectorInput): OccluderBox[] {
    const out: OccluderBox[] = [];
    for (const t of [inp.truck, inp.other]) if (t) { const e = truckExtents(t.model); out.push({ x: t.root.position.x, z: t.root.position.z, h: t.heading, ax0: e.rear, ax1: e.front, hw: 1.3, top: 3.8 }); }
    return out;
  }

  // The load master that sees the work best: where the driver walks down the side, works at the
  // back and goes to the door, scored by how much stands in the way. The usual angle is kept
  // unless something blocks it; then a clearer one is used.
  private pickLoadAngle(inp: DirectorInput, usual: string): string {
    const j = inp.journey, truck = inp.truck;
    this.truckFrame(truck);
    const lay = truckLayout(truck.model);
    const pts: THREE.Vector3[] = [], wts: number[] = [];
    for (const c of j.chores) if (c.group === "load") for (const q of [c.a, c.b]) if (q) { pts.push(this.at(new THREE.Vector3(), q[0], q[1] + 1.2, q[2])); wts.push(Math.max(0.5, c.len) / (c.a && c.b ? 2 : 1)); }
    if (!pts.length) { pts.push(this.at(new THREE.Vector3(), lay.bedRear + 0.8, 1.2, -0.3)); wts.push(1); }
    const boxes = this.truckBoxes(inp), cam = new THREE.Vector3(), look = new THREE.Vector3();
    const score = (v: string) => {
      let sum = 0, wsum = 0;
      this.loadCam(v, truck, cam, look);
      pts.forEach((p, i) => { sum += OCCLUSION.blocked(cam, p, boxes) * wts[i]; wsum += wts[i]; });
      // Too close to a building: the near clip would cut a hole in it.
      return sum / wsum + (OCCLUSION.clearance(cam, LOAD_CLEARANCE) < LOAD_CLEARANCE ? 1 : 0);
    };
    const usuals = (this.atDock ? [...DOCK_VARIANTS] : [...LOAD_VARIANTS]) as string[];
    const order: [string, number][] = [[usual, 0], ...usuals.filter((v) => v !== usual).map((v) => [v, 0.02] as [string, number]), ...LOAD_EXTRA];
    const scored = order.map(([v, pen]) => [v, score(v) + pen] as const);
    const best = Math.min(...scored.map((x) => x[1]));
    this.loadScores = scored.map(([v, sc]) => `${v[0]}${sc.toFixed(2)}`).join(" ");
    return scored.find((x) => x[1] <= best + 0.04)![0];
  }

  // Where to film a reverse into a dock bay from: beside the bay mouth, clear of the whole sweep
  // of the truck along the bay path and of anything tall, seeing the truck's street side.
  private backupSpot(inp: DirectorInput): THREE.Vector3 {
    const j = inp.journey, dk = j.dock, ex = truckExtents(inp.truck.model);
    const p = dk ? this.dockedPose(dk) : j.path!.eval(j.st.stopS, this.pose);
    const fx = Math.cos(p.h), fz = -Math.sin(p.h), rx = Math.sin(p.h), rz = Math.cos(p.h);
    const px = p.x, pz = p.z;
    // The sweep: the truck's centre line at points along the bay path.
    const sweep: [number, number, number, number][] = [];
    if (j.path) for (let s = 0; s <= j.path.length; s += 1) {
      const q = j.path.eval(s, this.pose2);
      const qx = Math.cos(q.h), qz = -Math.sin(q.h);
      sweep.push([q.x + qx * ex.rear, q.z + qz * ex.rear, q.x + qx * ex.front, q.z + qz * ex.front]);
    }
    j.path?.eval(j.st.s, this.pose2);
    const segDist = (x: number, z: number, a: [number, number, number, number]) => {
      const dx = a[2] - a[0], dz = a[3] - a[1], l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? THREE.MathUtils.clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1) : 0;
      return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    };
    let best = -1e9;
    const out = new THREE.Vector3();
    // A grid of spots in front of the bay: well clear of the sweep (the truck never fills the frame
    // or brushes the lens), 12-20 m from the docked truck, on the street side if possible.
    const cxd = ex.center;
    for (let x = ex.front + 2; x <= ex.front + 26; x += 2) for (let z = -20; z <= 20; z += 2) {
      const cx = px + fx * x + rx * z, cz = pz + fz * x + rz * z;
      let near = 1e9; for (const a of sweep) near = Math.min(near, segDist(cx, cz, a));
      if (near < 6) continue;
      this.v4.set(cx, 3, cz);
      const clear = OCCLUSION.clearance(this.v4, LOAD_CLEARANCE);
      const d = Math.hypot(x - cxd, z);
      // It has to see the truck once it is in the bay (not from round a corner of the building).
      this.v3.set(px + fx * cxd, 1.8, pz + fz * cxd);
      const hidden = OCCLUSION.blocked(this.v4, this.v3, []);
      const sc = -hidden * 6 + Math.min(near, 10) * 0.3 - Math.max(0, Math.abs(d - 16) - 3) * 0.4 + (z < 0 ? 0.8 : 0) - (clear < LOAD_CLEARANCE ? 5 : 0);
      if (sc > best) { best = sc; out.set(cx, 3.0, cz); }
    }
    if (best === -1e9) out.set(px + fx * (ex.front + 12) - rx * 8, 3.5, pz + fz * (ex.front + 12) - rz * 8);
    return out;
  }

  // Keep what is filmed in view: when the line from a load or swap camera to the driver has been
  // blocked for a moment, the camera rises until it sees over, and settles back once lower is clear.
  private lift = 0; private liftTarget = 0; private occT = 0; private clearT = 0; private probeT = 0; private probeCur = 0; private probeLow = 0; private probeHigh = 0;
  private keepInView(s: Shot, inp: DirectorInput) {
    const dt = inp.dt, b = this.beat;
    let target: THREE.Vector3 | null = null;
    const maxLift = 4;
    if ((b === "load" || b === "swap") && inp.driver) target = inp.driver;
    if (!target || s.cut || !this.started) { this.liftTarget = 0; this.occT = this.clearT = 0; if (s.cut || !target) this.lift = 0; }
    else {
      this.probeT -= dt;
      if (this.probeT <= 0) {
        this.probeT = 0.3;
        const boxes = this.truckBoxes(inp);
        const c = this.v1b.copy(s.pos); c.y += this.lift;
        this.probeCur = OCCLUSION.blocked(c, target, boxes);
        c.y -= Math.min(2, this.lift);
        this.probeLow = this.lift > 0.5 ? OCCLUSION.blocked(c, target, boxes) : this.probeCur;
        c.y = s.pos.y + maxLift;
        this.probeHigh = OCCLUSION.blocked(c, target, boxes);
      }
      if (this.probeCur > 0.2) { this.occT += dt; this.clearT = 0; } else { this.clearT += dt; this.occT = 0; }
      // (Only when rising would see the driver: not when the driver is inside a building.)
      if (this.occT > 0.8 && this.probeHigh <= 0.2) this.liftTarget = maxLift;
      else if (this.clearT > 3 && this.probeLow <= 0.2) this.liftTarget = 0;
    }
    // One eased move up (or down), not a creep.
    this.lift += (this.liftTarget - this.lift) * (1 - Math.exp(-dt / 0.6));
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
    return `cam x${d.dot(this.F).toFixed(1)} y${d.y.toFixed(1)} z${d.dot(this.R).toFixed(1)} yaw${(wrapAngle(this.yaw - truck.heading + Math.PI / 2) * 57.3).toFixed(0)} pitch${(this.pitch * 57.3).toFixed(0)} fov${this.cam.fov.toFixed(0)} ${this.interior ? "in" : ""} L${this.lift.toFixed(1)} ${this.road ? (this.time - this.roadStart).toFixed(1) + "/" + this.roadLen.toFixed(1) : ""} ${this.loadScores}`;
  }

  // Set the camera to the shot: exactly, or panning towards it.
  private apply(s: Shot, dt: number) {
    const fov = s.fov ?? FOV;
    let tyaw: number, tpitch: number;
    if (s.yaw !== undefined) { tyaw = s.yaw; tpitch = s.pitch ?? this.pitch; }
    else {
      const dx = s.look.x - s.pos.x, dy = s.look.y - s.pos.y, dz = s.look.z - s.pos.z;
      tyaw = Math.atan2(-dx, -dz); tpitch = Math.atan2(dy, Math.hypot(dx, dz));
      // Put the subject where the composition wants it on screen.
      const tv = Math.tan(fov * Math.PI / 360), th = tv * this.cam.aspect;
      tyaw += Math.atan((s.sx ?? 0) * th);
      tpitch -= Math.atan((s.sy ?? 0) * tv);
    }
    this.pos.copy(s.pos);
    if (!this.started || s.cut || !s.pan) {
      this.yaw = this.started && !s.cut ? this.yaw + wrapAngle(tyaw - this.yaw) : tyaw;
      this.pitch = tpitch; this.yawV = this.pitchV = 0;
      this.started = true;
    } else {
      const ty = this.yaw + wrapAngle(tyaw - this.yaw);
      [this.yaw, this.yawV] = springStep(this.yaw, this.yawV, ty, s.pan, dt);
      [this.pitch, this.pitchV] = springStep(this.pitch, this.pitchV, tpitch, s.pan, dt);
    }
    if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
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
    if (this.beat === "drive") this.prevRoadTown = true;
    else if (this.beat === "country") this.prevRoadTown = false;
  }
}
