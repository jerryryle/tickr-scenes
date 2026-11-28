// Camera director (concept doc, "Camera behaviors"). The journey's state decides the beat:
//   drive    on the road in town: follow car, high follow, lead car, side tracking; each setup
//            runs 12-40 s and the camera glides from one to the next (no cut)
//   country  the same coverage out of town, with a rising aerial reveal for the landscape; it
//            carries on through the gates without a cut
//   roadside a sign by the road, from beside the road at an angle, framed so it can be read with
//            the road running on past it, cut to as the truck is about to drive by it (a roadside
//            attraction's sign with the attraction behind it); or a
//            set piece from a spot beside it (country.ts): the level crossing from across the
//            tracks, so the train passes between camera and waiting truck. At most one every
//            ROADSIDE_GAP seconds
//   arrive   (half the dock stops) into the cab: back through the windshield, or the passenger seat
//   curb     with a name sign: from up the street, opening on the sign and the kerb where the
//            truck stops, cut to as it drives in, then zooming out with it; else across the street,
//            panning with the truck
//   backup   from the yard, panning with the truck as it backs in, settling on the bay with the
//            facility's name readable over it
//   load     the camera that filmed the truck in stays for the whole stop, easing in closer and
//            panning with the driver; if it can't see the work, one cut to the angle that can. A
//            long load cuts once more, half way. A gag insert for humorous cargo.
//   swap     one shot over the driver's shoulder from the old cab to the new one
//   jam      held up in the street a while (a gridlock: journey.ts JAM_HONK), one shot locked off
//            out ahead of the cab, up over the street, looking back at its front: its horn, held
//            till it is on its way again (or the clowns come)
//   clowns   held for good, the clowns come to carry off what holds it (clowns.ts), one shot locked off
//   depart   the stop's camera watches the truck pull away, then glides off with it into the follow
//
// So a cut means something changed: the truck reaches its stop, goes into the cab, passes a set
// piece, is stuck in a jam. Everything else is one continuous camera.
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
// truck's left (street) side, so its direction of travel reads the same throughout.
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
import type { TruckModel } from "./truck.ts";
import { CARGO_BY_ID } from "./cargo.ts";
import type { Pose } from "./route.ts";
import { CountryRoad, CUT_RUN, ONRAMP_SHOT, pieceSigns } from "./country.ts";
import { FW_OFF_D } from "./freeway.ts";
import type { RoadSign } from "./country.ts";
import { bladeSignA } from "./city.ts";
import { hasSign, siteLayout } from "./facilities.ts";
import { DWELL, JAM_SHOT, Journey, SWAP_RAMP } from "./journey.ts";
import type { DockPlan } from "./journey.ts";

type Beat = "drive" | "arrive" | "curb" | "backup" | "load" | "swap" | "depart" | "country" | "roadside" | "jam" | "clowns" | "works";

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
// Lettering is readable on the 128-row panel at about this many rows high: a shot that is there to
// show a sign keeps its frame tight enough for that.
const READ_ROWS = 20;   // (of the sign board: its letters are about half of it)
// A road sign is filmed from beside the road short of it, at an angle, framed so it reads with
// the truck's lane at the sign and the road on past it in shot: a shot of the truck going by the
// sign, never of the sign alone. The cut comes as the truck is at most SIGN_LEAD seconds from the
// sign, and the shot holds until its tail is SIGN_PAST metres beyond it.
const SIGN_LEAD = 1.8, SIGN_PAST = 14;
// (With the road in the frame too, the board may read a little smaller than READ_ROWS.)
const SIGN_READ_ROWS = 14;
// At a kerb stop with a name sign, the stop's shot opens on the sign where it reads with the kerb
// the truck stops at in frame (else the shot across the street), cut to when the truck is
// CURB_SIGN_LEAD seconds at most from driving into that frame (looked for from CURB_SIGN_DIST out),
// and holds there CURB_SIGN_HOLD before zooming out.
const CURB_SIGN_DIST = 45, CURB_SIGN_LEAD = 1.8, CURB_SIGN_HOLD = 2.8, CURB_SIGN_ZOOM = 3.4;
const LOAD_VARIANTS = ["side", "rear"] as const;
const DOCK_VARIANTS = ["dock", "side"] as const;   // backed into a dock: the bay from the yard, or the truck's street side
const LOAD_ALT_AFTER = 45;   // a load longer than this (s) gets one cut to a second angle, half way
// Other masters on the work, for when the usual ones look through too much (occlusion.ts), with how
// much less they are liked: high over the street side, from ahead of the cab, the truck's other side.
const LOAD_EXTRA: [string, number][] = [["high", 0.08], ["front", 0.1], ["right", 0.12]];
// A load angle's camera keeps this far from anything mapped as tall (occlusion.ts), so no wall,
// tree or pole close to the lens fills the frame.
const LOAD_CLEARANCE = 3.5;
const ARRIVE_VARIANTS = ["dive", "passenger"] as const;
const ARRIVE_SHARE = 1 / 2;
// The knitting works' arrival shot is taken from this far out (m along the way), and its spots lie across the
// street in the works' frame ([a, n, y], storybook-landmark-knitting-works.ts: a along its frontage, n in from the pavement); it uses
// the first clear of buildings with a clear look at the works.
const WORKS_DIST = 75, WORKS_FOV = 48;
const WORKS_SPOTS: [number, number, number][] = [[34, -20, 9], [30, -26, 14], [24, -16, 6], [40, -30, 20]];
const BREWERY_SPOTS: [number, number, number][] = [[36, -18, 8], [39, -15, 7], [32, -20, 10], [41, -13, 6]];   // (the brewery's, looking up at its height)
const ROADSIDE_GAP = 20;        // seconds between set-piece shots by the road, at least
const ROADSIDE_MIN = 6;         // ...and only one that will be on screen this long
const GLIDE = 5;                // seconds a camera move from one road setup to the next takes
const ROAD_MOVING = 2;          // m/s: below this (standing, crawling) the road coverage doesn't change setup on the clock
const DEPART_HOLD = 3;          // seconds the stop's camera watches the truck pull away before moving off with it
// A jam (journey.ts jamT): the shot of it is cut to once the truck has stood held JAM_SHOT s
// (before it honks, at JAM_HONK), set up JAM_AHEAD m on along its way from its nose, JAM_SIDE m to
// its left (the street side, as the coverage keeps to), JAM_UP m up, and held till it has gone
// JAM_OFF m on again, before it comes up to the camera; then the road coverage glides on from it.
const JAM_AHEAD = 18, JAM_SIDE = 5, JAM_UP = 6, JAM_OFF = 6;
// The clowns' rescue (clowns.ts focus): from CLOWN_AHEAD m on from what they came for, the way they
// take it off, CLOWN_CAM_SIDE m to the other side of it from their way (the street), CLOWN_UP m up,
// looking back at it and the truck's front behind it; they run into the frame past the camera, lift
// it, and carry it off out of the frame past the camera again. Held till they are well off with it.
const CLOWN_AHEAD = 12, CLOWN_CAM_SIDE = 5, CLOWN_UP = 7, CLOWN_FOV = 46;   // (up over the signals' arms, 6.2 m, and their heads)
// (Where else, should that be in or behind a building: [on along their way, aside, up], in order.)
const CLOWN_SPOTS: [number, number, number][] = [[CLOWN_AHEAD, CLOWN_CAM_SIDE, CLOWN_UP], [9, 4, 7.5], [CLOWN_AHEAD, 2, 9], [16, CLOWN_CAM_SIDE, 9], [6, 9, 8]];
const CLOWN_NEAR = 7;   // m: the truck's nose this near the camera along their way (going on, freed), what they came for up over their heads, the shot ends
// The road coverage, and how long each setup runs (seconds, min and max).
type RoadShot = "chase" | "high" | "lead" | "track" | "aerial";
const ROAD_LEN: Record<RoadShot, [number, number]> = {
  chase: [25, 40], high: [20, 30], lead: [14, 20], track: [12, 18], aerial: [16, 16],
};

const smoother = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

// Exact critically damped spring step (stable for any dt).
function springStep(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const c1 = x - target, c2 = v + omega * c1, e = Math.exp(-omega * dt);
  return [target + (c1 + c2 * dt) * e, (c2 - omega * (c1 + c2 * dt)) * e];
}
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Where the driver is during a swap's exit, walk and enter phases: stepping down at the old
// cab door, walking forward along the street side to the new truck's door, climbing in. Shared
// with the driver animation (phase 6).
export function swapWalkPoint(journey: Journey, oldTruck: Truck, newTruck: Truck, out: THREE.Vector3): THREE.Vector3 {
  const a = oldTruck.anchors.cabDoorGround.getWorldPosition(new THREE.Vector3());
  const b = newTruck.anchors.cabDoorGround.getWorldPosition(new THREE.Vector3());
  const ph = journey.dwellPhase();
  if (ph.phase === "park" || ph.phase === "exit") return out.copy(a);
  if (ph.phase !== "walk") return out.copy(b);
  const u = swapWalkU(ph.t, ph.len);
  return swapClear(out.copy(a).lerp(b, u), oldTruck, newTruck, u);
}
// How far along a truck change's walk the driver is (0..1), `t` seconds into a walk of `len`:
// speeding up to a steady walk over SWAP_RAMP seconds and slowing to a stop over the last
// SWAP_RAMP, arriving at the new door as the walk ends (the climb in starts from there).
export function swapWalkU(t: number, len: number): number {
  const R = Math.min(SWAP_RAMP, len / 2), v = 1 / Math.max(1e-3, len - R);
  t = THREE.MathUtils.clamp(t, 0, len);
  if (t < R) return v * t * t / (2 * R);
  if (t > len - R) { const r = len - t; return 1 - v * r * r / (2 * R); }
  return v * (t - R / 2);
}
// The walk's speed then, as a fraction of its steady pace (for the stride).
export function swapWalkPace(t: number, len: number): number {
  const R = Math.min(SWAP_RAMP, len / 2);
  return THREE.MathUtils.clamp(Math.min(t, len - t) / Math.max(1e-3, R), 0, 1);
}
// A walk `u` of the way from one truck's cab door to the other's (world space, `out`), pushed out
// along the street side clear of the wider truck's body (a tractor's trailer the widest),
// stepping out from the one door and back in to the other. (Also the country truck stop's, crew.ts.)
export function swapClear(out: THREE.Vector3, oldTruck: Truck, newTruck: Truck, u: number): THREE.Vector3 {
  const h = oldTruck.heading, rx = Math.sin(h), rz = Math.cos(h), p = oldTruck.root.position;
  const hw = Math.max(truckLayout(oldTruck.model).hw, truckLayout(newTruck.model).hw);
  const lat = (out.x - p.x) * rx + (out.z - p.z) * rz, clear = -(hw + 0.45), k = THREE.MathUtils.smoothstep(Math.min(u, 1 - u), 0, 0.15);
  if (lat > clear) { const d = (clear - lat) * k; out.x += rx * d; out.z += rz * d; }
  return out;
}

type DirectorSave = { f: Record<string, unknown>; p: THREE.Vector3; q: THREE.Quaternion; fov: number };
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
  confine: ((pos: THREE.Vector3) => void) | null = null;   // main: keeps the camera out of the ground, inside a tunnel's bore, under a deck
  // The truck's heading, smoothed, for rigs that turn with the truck (a corner is a turn, not a jolt).
  private refYaw = 0; private refYawV = 0;
  private anchorPos = new THREE.Vector3(); private anchorLook = new THREE.Vector3(); private anchorH = 0;
  private gag = false; private gagStart = -1;
  private skipFeature = -1; private roadsideEnd = -1e9;
  // A road sign being filmed (its piece and sign), and the lens; a kerb stop's name sign.
  private signPiece = -1; private signIdx = 0; private eventFov = FOV;
  private signPos = new THREE.Vector3(); private signLook = new THREE.Vector3(); private signFov = FOV;   // (planSign's)
  private departHold = true;   // (false when a start or a seek lands in a depart: there is no stop's camera to hold)
  private curbSign = false; private curbSignPos = new THREE.Vector3(); private curbTele = FOV;
  // (curbPlan's, for the stop `curbKey`: the camera, the settled aim, and where along the path the
  // truck's front is when it comes into the sign's frame.)
  private curbKey = -1; private curbOk = false; private curbCam = new THREE.Vector3(); private curbAim = new THREE.Vector3(); private curbEnter = 0;
  private curbOpen = new THREE.Vector3();   // (the opening frame's aim)
  private backLook = new THREE.Vector3(); private backFov = FOV; private backDocked = new THREE.Vector3();
  private time = 0;
  private feature: ReturnType<CountryRoad["featureShot"]> = null; private featureKey = -1; private pendingKey = -1;
  private atDock = false; private lastBeat: Beat = "drive";
  // The road coverage: the running setup, when it started, how long it runs and how many there
  // have been; and the glide into it from where the camera was (offsets from the truck's centre
  // in the smoothed heading's frame, so the move travels with the truck).
  private road: RoadShot | "" = "";
  private roadStart = 0; private roadLen = 0; private roadCount = 0;
  private blendLen = 0; private blendStart = 0; private blendPos = new THREE.Vector3(); private blendLook = new THREE.Vector3();
  private lastRig = new THREE.Vector3(); private haveRig = false; private blendA1 = 0;   // the rig's last target, relative to the truck
  // The load coverage's current setup and its spot (a cut when it changes).
  private loadShot = ""; private loadPos = new THREE.Vector3(); private loadLook = new THREE.Vector3();
  private loadAlt = ""; private loadMaster = "side"; private loadAltDone = false; private loadSegChore = -1;
  private holdPos = new THREE.Vector3(); private pushPos = new THREE.Vector3(); private holdFov = FOV;
  private backSpot = new THREE.Vector3();
  private jamPos = new THREE.Vector3(); private jamLook = new THREE.Vector3();   // (the jam's shot)
  private worksPos = new THREE.Vector3(); private worksLook = new THREE.Vector3();   // (these hold the knitting works' or the steam brewery's shot)
  private clownPos = new THREE.Vector3(); private clownLook = new THREE.Vector3(); private clownId = -1; private clownH = 0; private clownDone = -1;   // (the clowns' shot, and the lot it was set up on)
  // The world moved by (dx, dz) under the camera (main.ts: the next city takes over out on the
  // road): move with it, so nothing on screen changes.
  rebase(dx: number, dz: number) {
    for (const v of [this.pos, this.anchorPos, this.anchorLook, this.signPos, this.signLook, this.loadPos, this.loadLook, this.backSpot, this.holdPos, this.pushPos, this.curbSignPos, this.curbCam, this.curbAim, this.curbOpen, this.backLook, this.backDocked, this.jamPos, this.jamLook, this.clownPos, this.clownLook]) { v.x += dx; v.z += dz; }
  }
  // The director's whole state and the camera's (main.ts: preview snapshots and part-ticks).
  // (`into`: an earlier save, filled again in place.)
  save(into?: DirectorSave): DirectorSave {
    const c = this.cam, s = into ?? { f: {}, p: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 0 };
    s.f = saveFields(this, null, ["cam", "avoidBuildings", "confine", "seed"], s.f);
    s.p.copy(c.position); s.q.copy(c.quaternion); s.fov = c.fov;
    return s;
  }
  load(s: DirectorSave) {
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
  // The shots in town are chosen by the visit's job seed and index (visits.ts), so a visit is filmed
  // the same wherever in the journey it comes; the road's by the journey seed.
  private visitSeed = 0;

  // A variant for stop `stop`, never the same as the one the previous stop would get. A pure
  // function of the stop (no memory), so a scrubbed journey frames every moment the same way.
  private pick<T extends string>(beat: Beat, list: readonly T[], stop: number, salt = 0): T {
    const at = (k: number) => Math.floor(hash3(k, salt, beat.length * 31 + beat.charCodeAt(0), this.visitSeed, 0xca7) * list.length);
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
      case "jam": return Math.max(0, (st.jamT ?? 0) - JAM_SHOT);
      case "depart": return this.departed(j) < 1e8 ? this.departed(j) : 0;
      case "arrive": return j.path ? Math.max(0, (ARRIVE_DIST - (st.stopS - st.s)) / Math.max(st.v, 2)) : 0;
      case "curb": {
        if (this.curbPlan(j)) return st.mode === "dwell" ? CURB_SIGN_LEAD + 2 + st.modeTime : Math.max(0, CURB_SIGN_LEAD - this.curbLead(j));
        return st.mode === "dwell" ? CURB_DIST / 3 + st.modeTime : j.path ? Math.max(0, (CURB_DIST - (st.stopS - st.s)) / Math.max(st.v, 1.5)) : 0;
      }
      default: return 0;
    }
  }

  // ---- beat selection -------------------------------------------------------------------------
  private chooseBeat(inp: DirectorInput): Beat {
    const j = inp.journey, st = j.st, stop = st.stops[0];
    if (st.mode === "country" || st.mode === "inbound") {
      // A sign the truck is about to pass: filmed going by it, so it can be read (see planSign).
      for (const sg of j.country && j.countryU >= 0 ? this.signsAhead(j) : []) {
        const id = 500000 + sg.piece * 10 + sg.idx + 1000 * Math.round(sg.sign.s);
        if (id !== this.featureKey && id !== this.skipFeature && (this.time - this.roadsideEnd < ROADSIDE_GAP || (this.road && this.time - this.roadStart < 6))) this.skipFeature = id;
        // (A sign with nowhere to film it going by from is passed over.)
        if (id !== this.featureKey && id !== this.skipFeature && !this.planSign(j, sg.piece, sg.sign)) this.skipFeature = id;
        if (id !== this.skipFeature) { if (this.beat !== "roadside" || id !== this.featureKey) { this.feature = null; this.signPiece = sg.piece; this.signIdx = sg.idx; this.pendingKey = id; } return "roadside"; }
      }
      // (A piece with a sign is filmed only by its sign's shot, which reads; except a truck stop
      // or an open weigh station, whose set piece is the stop: its sign's shot comes first.)
      const road = j.country, f0 = road && j.countryU >= 0 ? road.featureShot(j.countryS) : null;
      const f = f0 && road && (f0.key === ONRAMP_SHOT || road.pieces[f0.key]?.kind === "truckstop" || road.pieces[f0.key]?.open || road.pieces[f0.key]?.kind === "ferry" || road.pieces[f0.key]?.kind === "cattle" || !pieceSigns(road.pieces[f0.key]).length) ? f0 : null;
      // A set piece is a cut there and a cut back, so it has to be worth it: not within
      // ROADSIDE_GAP of the last one, and not while the road setup has only just started. (A piece
      // passed over stays passed over for its whole stretch.)
      // (Pieces are numbered per road: a piece is known by its number and where its camera stands.)
      const id = f ? f.key + 1000 * Math.round(f.cam[0]) : -1;
      // (A set piece the truck stops at, a level crossing or a truck stop, is the event of the
      // drive: always filmed.)
      const stopsThere = !!f && !!road && (f.key === ONRAMP_SHOT || road.stops.some((x) => Math.abs(x.s - f.look[0]) < 160));   // (or the way onto a freeway)
      if (f && id !== this.featureKey && id !== this.skipFeature && !stopsThere) {
        if (this.time - this.roadsideEnd < ROADSIDE_GAP || (this.road && this.time - this.roadStart < 8) || this.featureSeconds(j, f.key) < ROADSIDE_MIN) this.skipFeature = id;
      }
      if (f && id !== this.skipFeature) { if (this.beat !== "roadside" || id !== this.featureKey) { this.feature = f; this.pendingKey = id; } return "roadside"; }
      return "country";
    }
    // (The clowns come for what holds it: their rescue, from setting out to well off with it. A next
    // lot coming for something near the last: the same shot, else a new one on it.)
    const cf = j.life?.rescue?.() ?? null;
    // (Not once the truck, freed, comes on up to the camera.)
    // (Then on to the road coverage: not back to the jam's shot.)
    if (this.beat === "clowns" && this.clownId >= 0 && cf?.up && Math.abs(st.v) > 0.3) {
      const nose = this.ext(st.truck).front, nx = j.pose.x + Math.cos(j.pose.h) * nose, nz = j.pose.z - Math.sin(j.pose.h) * nose;
      if ((this.clownPos.x - nx) * Math.cos(this.clownH) - (this.clownPos.z - nz) * Math.sin(this.clownH) < CLOWN_NEAR) this.clownDone = this.clownId;
    }
    if (!st.jamT && !cf) this.clownDone = -1;   // (a new jam: its own shots; not while the lot just filmed is still about, off with theirs)
    const rolling = st.mode === "drive" || st.mode === "reverse", ended = this.clownDone >= 0 && this.clownDone === this.clownId;
    // (Between one lot and the next, the truck still held in the same jam: still the clowns' shot,
    // rather than back to the jam's and on to the clowns' again.)
    if (rolling && !cf && this.beat === "clowns" && this.clownId >= 0 && !ended && (st.jamT ?? 0) > 0 && (st.jamMoved ?? 0) < JAM_OFF + 6) return "clowns";
    if (rolling && cf && cf.id !== this.clownDone) {
      if (this.beat !== "clowns" || (cf.id !== this.clownId && Math.hypot(cf.x - this.clownLook.x, cf.z - this.clownLook.z) > 10)) this.clownId = -1;
      else if (cf.id !== this.clownId) this.clownId = cf.id;   // (the same shot kept for the next lot: theirs now, so it ends on them)
      return "clowns";
    }
    // (Till it has gone JAM_OFF m in all: stopping again behind the traffic after that, the road
    // coverage holds on it, rather than cutting back to a shot of it from a step on.
    // From the journey's own state, so a seek frames it the same.)
    if (st.mode === "drive" && !ended && (st.jamT ?? 0) > JAM_SHOT && (st.jamMoved ?? 0) < JAM_OFF) return "jam";
    if (st.mode === "reverse") return "backup";
    if (st.mode === "dwell") {
      // Parking: still the shot that brought the truck in (backing into a dock, or the kerb).
      if (j.dwellPhase().phase === "park" && stop?.site) return j.isDockStop(stop) ? "backup" : "curb";
      return stop?.kind === "swap" ? "swap" : "load";
    }
    if (this.departed(j) < DEPART_LEN) return "depart";
    if (stop && stop.kind !== "depart" && j.path) {
      const d = st.stopS - st.s;
      // At the storybook city's knitting works or the Victorian city's steam brewery, the truck pulling
      // up to it is its arrival there, filmed wide across the street and held till it backs in
      // (storybook-landmark-knitting-works.ts, victorian-landmark-steam-brewery.ts).
      if (d < WORKS_DIST && j.isDockStop(stop) && stop.site && j.plan.blockOf(stop.site.bx, stop.site.bz)?.id === j.plan.worksBlock && j.plan.worksBlock >= 0) return "works";
      // (With a name sign to open on: only once the truck is about to drive into its frame.)
      if (!j.isDockStop(stop) && (d < CURB_SIGN_DIST && this.curbPlan(j) ? this.curbLead(j) <= CURB_SIGN_LEAD : d < CURB_DIST)) return "curb";
      // (Only before a dock: at the kerb the curb shot would follow within seconds.)
      if (d < ARRIVE_DIST && j.isDockStop(stop) && hash3(st.stopsDone + (j.visit.index - st.city) * 1000, 3, j.visit.index, this.visitSeed, 0xa77) < ARRIVE_SHARE) return "arrive";
    }
    return "drive";
  }

  // Roughly how long the set piece `key` will hold the screen from here, at the truck's speed (at
  // most ROADSIDE_MIN). A piece the truck stops at (a level crossing, a truck stop) holds it long.
  private featureSeconds(j: Journey, key: number) {
    const r = j.country!, v = Math.max(j.st.v, 2);
    if (r.stops.some((x) => x.s > j.countryS && x.s - j.countryS < 220)) return ROADSIDE_MIN;
    for (let k = 1; k <= ROADSIDE_MIN; k++) { const f = r.featureShot(j.countryS + v * k); if (!f || f.key !== key) return k; }
    return ROADSIDE_MIN;
  }

  private enterBeat(beat: Beat, inp: DirectorInput) {
    const j = inp.journey, st = j.st, stop = st.stops[0];
    const n = st.stopsDone + (j.visit.index - st.city) * 1000;   // (by the visit's own index: visits.ts)
    // (Normally a beat starts now; after a seek it may already be under way.)
    this.beat = beat; this.beatTime = this.started ? 0 : this.elapsedIn(beat, j); this.beatStart = this.time - this.beatTime;
    this.anchorPos.copy(this.started ? this.pos : this.cam.position);
    this.anchorH = inp.truck.heading;
    switch (beat) {
      case "arrive": this.variant = this.pick("arrive", ARRIVE_VARIANTS, n); break;
      case "jam": {
        // Out ahead along its way (over the street, round any corner it turns), to its left and up
        // over the traffic in between, looking back at its front.
        this.truckFrame(inp.truck);
        const ex = this.ext(st.truck);
        if (!this.onRoute(j, ex.front + JAM_AHEAD, -JAM_SIDE, JAM_UP, this.jamPos)) this.at(this.jamPos, ex.front + JAM_AHEAD, JAM_UP, -JAM_SIDE);
        this.at(this.jamLook, ex.front - 1, 1.8, 0);
        this.variant = "jam";
        break;
      }
      case "clowns": this.variant = "clowns"; break;
      case "works": {
        const P = j.plan, B = P.graph.blocks[P.worksBlock], an = B.anchor!;
        const at = (a: number, n: number, y: number, v: THREE.Vector3) => { const q = P.graph.facePt(an.face, a + an.delta, n); return v.set(q.x, y, q.z); };
        // (The brewery is taller, with its yard further along: the shot looks higher and a little along.)
        if (P.style.victorian) at(35, 17, 13, this.worksLook); else at(31, 16, 7.5, this.worksLook);
        // (Where none is clear, it stands over the middle of the street, which nothing tall ever fills.)
        const spots = P.style.victorian ? BREWERY_SPOTS : WORKS_SPOTS;
        at(31, -P.graph.streets[an.face >> 1].half, 8, this.worksPos);
        for (const [a, n, y] of spots) {
          const c = at(a, n, y, this.v4);
          if (OCCLUSION.clearance(c, 1.5) >= 1.5 && OCCLUSION.blocked(c, this.worksLook, [], 0.5) <= 0.2) { this.worksPos.copy(c); break; }
        }
        this.variant = "works";
        break;
      }
      case "backup": {
        this.variant = "bay"; this.backSpot.copy(this.backupSpot(inp));
        // The settled frame: the docked truck and the bay, and the name sign readable over them.
        const dk = j.dock, ex = this.ext(st.truck);
        this.backFov = 34; this.backLook.copy(this.backSpot);
        if (dk) {
          const p = this.dockedPose(dk), fx = Math.cos(p.h), fz = -Math.sin(p.h), rx = Math.sin(p.h), rz = Math.cos(p.h);
          this.backDocked.set(p.x, 0, p.z);
          const pts: THREE.Vector3[] = [];
          for (const x of [ex.rear, ex.front]) for (const z of [-1.3, 1.3]) for (const y of [0, 3.8]) pts.push(new THREE.Vector3(p.x + fx * x + rx * z, y, p.z + fz * x + rz * z));
          let sign: THREE.Vector3[] = [];
          if (dk.sign) { const g = dk.sign, ax = -g.nz, az = g.nx; sign = [-1, 1].flatMap((k) => [-1, 1].map((m) => new THREE.Vector3(g.x + ax * k * g.w / 2, g.y + m * g.h / 2, g.z + az * k * g.w / 2))); }
          this.backFov = this.frameFit(this.backSpot, [...pts, ...sign], this.backLook, dk.sign ? { at: new THREE.Vector3(dk.sign.x, dk.sign.y, dk.sign.z), h: dk.sign.h, pts: sign } : null);
        }
        break;
      }
      case "load": {
        // Backed into a dock, the truck's rear is at the building: side views only.
        this.atDock = !!stop && j.isDockStop(stop);
        // The camera that filmed the truck in stays for the work if it sees it ("hold"), easing in
        // closer; otherwise one cut to the setup that sees it best. A long load gets one cut to
        // the next best, half way.
        this.holdPos.copy(this.anchorPos); this.holdFov = this.cam.fov;
        const ranked = this.pickLoadAngle(inp, this.pick("load", this.atDock ? DOCK_VARIANTS : LOAD_VARIANTS, n), this.started);
        this.loadMaster = ranked[0]; this.loadAlt = ranked.find((v) => v !== "hold" && v !== ranked[0]) ?? "";
        this.loadAltDone = false; this.loadSegChore = -1;
        if (this.loadMaster === "hold") this.pushIn(inp);
        this.variant = this.loadMaster;
        this.gag = !!stop && CARGO_BY_ID.get(stop.cargo)?.tier === "humorous";
        this.gagStart = -1; this.loadShot = "";
        break;
      }
      case "swap": this.variant = "walk"; this.atDock = false; this.loadShot = ""; break;
      case "depart": this.variant = "hold"; this.road = ""; this.departHold = this.started; break;
      case "curb": {
        // With a name sign: from up the street on the far side, opening on the sign and the kerb.
        this.curbSign = this.curbPlan(j);
        if (this.curbSign) { this.anchorPos.copy(this.curbCam); this.anchorLook.copy(this.curbAim); break; }
        // Fixed across the street from where the truck will stop.
        const p = j.path!.eval(st.stopS, this.pose);
        const h = p.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
        const c = this.ext(st.truck).center;
        // On the far side of the street (street trees line the far sidewalk), a little ahead of centre.
        // (Up on a garage's roof, on the roof.)
        const y = j.pathY(st.stopS);
        this.anchorPos.set(p.x + fx * (c + 4) - rx * 10.5, y + 2.6, p.z + fz * (c + 4) - rz * 10.5);
        this.anchorLook.set(p.x + fx * c, y + 1.5, p.z + fz * c);
        break;
      }
      case "drive":
      case "country":
        // The road coverage carries on out of a depart and in and out of town; out of a jam it
        // glides on from the jam's camera, out ahead of the truck, into the lead car (also ahead,
        // looking back), with the truck as it gets going; after anything else it starts afresh
        // with a cut.
        if (this.lastBeat === "roadside") this.roadsideEnd = this.time;
        // (Not out of the clowns' shot: that ends with the truck coming on up to its camera, and a glide
        // from there would sit beside it as it passes, all trailer. A cut instead.)
        if (this.lastBeat === "jam" && this.started) { this.startRoad(inp, this.roadOptions(inp).includes("lead") ? "lead" : null, GLIDE); break; }
        if (!(this.lastBeat === "depart" || this.lastBeat === "drive" || this.lastBeat === "country") || !this.started) this.road = "";
        break;
      case "roadside": {
        this.featureKey = this.pendingKey;
        const road = j.country!, f = this.feature;
        if (!f) { this.anchorPos.copy(this.signPos); this.anchorLook.copy(this.signLook); this.eventFov = this.signFov; this.variant = "sign"; break; }
        // Fixed beside the road, framing the truck with the set piece.
        road.point(f.cam[0], f.cam[1], this.pose); this.anchorPos.set(this.pose.x, f.cam[2] + road.groundAt(f.cam[0], f.cam[1]), this.pose.z);
        road.point(f.look[0], f.look[1], this.pose); this.anchorLook.set(this.pose.x, f.look[2] + road.groundAt(f.look[0], f.look[1]), this.pose.z);
        break;
      }
    }
    this.lastBeat = beat;
  }

  // ---- per frame ------------------------------------------------------------------------------
  // A truck's extents as the shots frame it: a carriage's run to its team's noses (truck.ts
  // truckExtents), so a shot set up on the front of the vehicle takes in the horses.
  private carriage = false;
  private ext(m: TruckModel) { return truckExtents(m, this.carriage); }
  update(inp: DirectorInput) {
    const { journey: j, truck, dt } = inp;
    this.carriage = truck.carriage > 0.5;
    this.time = j.st.simTime + j.frac;   // journey time: shots follow the journey, not the frame count
    this.visitSeed = j.visit.jobs;
    truck.root.updateMatrixWorld(true);
    inp.other?.root.updateMatrixWorld(true);
    // The rigs' heading: the truck's, smoothed (about half a second behind through a corner).
    if (!this.started) { this.refYaw = truck.heading; this.refYawV = 0; }
    else {
      const target = this.refYaw + wrapAngle(truck.heading - this.refYaw);
      [this.refYaw, this.refYawV] = springStep(this.refYaw, this.refYawV, target, 3.5, dt);
    }
    const beat = this.chooseBeat(inp);
    const beatChanged = beat !== this.beat || !this.started || (beat === "roadside" && this.pendingKey !== this.featureKey) || (beat === "clowns" && this.clownId < 0);
    if (beatChanged) this.enterBeat(beat, inp);
    this.beatTime = Math.max(0, this.time - this.beatStart);   // journey time, so a scrub lands on the same frame

    const shot = this.shot(inp);
    // A new beat is a new shot only where the camera has to be somewhere else: into the cab, to
    // the stop's camera, to a set piece by the road, to the driver's walk. The load holds the
    // stop's camera (or cuts once, itself); depart and the road coverage carry on from it.
    if (beatChanged && (beat === "arrive" || beat === "curb" || beat === "backup" || beat === "roadside" || beat === "swap" || beat === "jam" || beat === "clowns" || beat === "works")) shot.cut = true;
    this.keepInView(shot, inp);
    // Never under the hills, nor through a tunnel's walls (main.ts knows where they are).
    if (this.confine && !this.interior) this.confine(shot.pos);
    if (this.tunnelAhead(j)) shot.cutaway = false;   // (in a bore, the spotlight would only dapple its walls)
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
    } else return false;   // (Out of town the roads curve gently: rigs turn with the truck, which stays smooth through the hand-over from one city's road to the next.)
    out.set(p.x + Math.sin(h) * lat, y + j.pathY(Math.max(0, st.s - (1 - j.alpha) * j.lastStep + ds)), p.z + Math.cos(h) * lat);   // (over a garage's ramps: above them)
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
    const ex = this.ext(truck.model);
    truck.anchors.driverEye.getWorldPosition(this.eye);
    truck.anchors.passengerEye.getWorldPosition(this.peye);
    truck.anchors.tablet.getWorldPosition(this.tab);
    const t = this.beatTime;
    const F = this.F, R = this.R;

    switch (this.beat) {
      case "drive":
      case "country":
        return this.roadCoverage(inp, s);

      case "clowns": {
        // Locked off on the rescue, set up as the lot sets out (or on the next lot, somewhere else).
        const cf = inp.journey.life?.rescue?.() ?? null;
        if (cf && this.clownId < 0) {
          this.clownId = cf.id; this.clownH = cf.h;
          const fx = Math.cos(cf.h), fz = -Math.sin(cf.h), rx = Math.sin(cf.h), rz = Math.cos(cf.h), y = this.T.y;
          this.clownLook.set(cf.x + fx * 2 + rx * cf.side * 1.5, y + 1.6, cf.z + fz * 2 + rz * cf.side * 1.5);
          // (The first of these clear of buildings, with a clear look at it (occlusion.ts); else the first.)
          for (let i = 0; i < CLOWN_SPOTS.length; i++) {
            const [a, b, u] = CLOWN_SPOTS[i], c = this.v4.set(cf.x + fx * a - rx * cf.side * b, y + u, cf.z + fz * a - rz * cf.side * b);
            if (i === 0) this.clownPos.copy(c);
            if (OCCLUSION.clearance(c, 1.5) >= 1.5 && OCCLUSION.blocked(c, this.clownLook, [], 0.5) <= 0.2) { this.clownPos.copy(c); break; }
          }
        }
        s.pos.copy(this.clownPos); s.look.copy(this.clownLook); s.fov = CLOWN_FOV;
        return s;
      }

      case "works":
        // The camera is locked off across the street on the works; the operator leans a little toward the truck.
        s.pos.copy(this.worksPos); s.look.lerpVectors(this.worksLook, this.v3.set(this.T.x, this.T.y + 1.5, this.T.z), 0.25); s.fov = WORKS_FOV; s.cutaway = false; s.pan = 2;
        return s;

      case "jam":
        // Locked off: the truck's front, and the street ahead of it that holds it up.
        s.pos.copy(this.jamPos); s.look.copy(this.jamLook); s.fov = 40;
        return s;

      case "roadside": {
        if (!this.feature) {
          // A sign: locked off, framed to read it, the truck driving by it.
          s.pos.copy(this.anchorPos); s.look.copy(this.anchorLook); s.fov = this.eventFov; s.cutaway = false;
          this.variant = "sign";
          return s;
        }
        // The level crossing: a long lens on the truck's cab, held as it waits for the train.
        if (j.country && j.country.pieces[this.feature.key]?.kind === "rail") {
          s.pos.copy(this.anchorPos); this.at(s.look, ex.front - 1.5, 2.0, 0);
          s.pan = 2; s.cutaway = false; s.fov = 20; s.sy = -0.1;
          this.variant = "crossing";
          return s;
        }
        // Locked off; the pan leans from the set piece towards the truck as it comes close.
        const d = Math.hypot(this.T.x - this.anchorPos.x, this.T.z - this.anchorPos.z);
        const f = this.feature, ahead = f ? j.countryS - f.cam[0] : 0;
        const k = f?.fixed ? (ahead < 8 ? 1 : THREE.MathUtils.clamp(0.9 - (ahead - 8) / 120, 0.5, 0.9)) : THREE.MathUtils.clamp((d - 15) / 80, 0.15, 0.4);
        s.pos.copy(this.anchorPos);
        s.look.set(this.T.x + (this.anchorLook.x - this.T.x) * k, this.T.y + 1.6 + (this.anchorLook.y - this.T.y - 1.6) * k, this.T.z + (this.anchorLook.z - this.T.z) * k);
        s.pan = 3; s.cutaway = false; s.fov = 34;
        this.variant = "roadside";
        return s;
      }

      case "arrive": {
        // Rigid with the truck: cab and hood angles, cut in, then one move.
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
        } else {
          pov();
          s.cut = t < 0.05;
        }
        return s;
      }

      case "curb": {
        // Locked off across the street; the operator pans with the truck as it pulls in and stops.
        s.pos.copy(this.anchorPos);
        this.at(s.look, ex.center, 1.5, 0);
        if (st.mode === "dwell") s.look.copy(this.anchorLook);
        s.pan = 2.6; s.cutaway = false; s.fov = 32;
        if (this.curbSign) {
          // The destination's name with the street where the truck stops, held long enough to read
          // as the truck drives into it; then one move, zooming out and panning with the truck.
          const u = smoother((t - CURB_SIGN_HOLD) / CURB_SIGN_ZOOM);
          if (u < 1) {
            s.look.lerpVectors(this.curbOpen, this.v3.copy(s.look), u); s.pan = 0;
            const t0 = Math.tan(this.curbTele * Math.PI / 360), t1 = Math.tan(32 * Math.PI / 360);
            s.fov = Math.atan(t0 * Math.pow(t1 / t0, u)) * 360 / Math.PI;   // (an even zoom: geometric in the lens)
          }
        }
        return s;
      }

      case "backup": {
        // From the yard, clear of everything the truck sweeps through: pan with the truck as it
        // swings round, then, as it backs the last stretch, settle on the bay with the
        // facility's name over it, readable.
        s.pos.copy(this.backSpot);
        this.at(s.look, ex.center, 1.6, 0);
        const w = 1 - THREE.MathUtils.smoothstep(Math.hypot(this.T.x - this.backDocked.x, this.T.z - this.backDocked.z), 5, 20);
        s.look.lerp(this.backLook, w);
        s.fov = 34 + (this.backFov - 34) * w;
        s.pan = 2.2; s.cutaway = false;
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
        return this.loadCoverage(inp, ph, s);
      }

      case "swap": {
        // One shot: over the driver's shoulder as they step down and walk to the new truck, then
        // the camera stops where it is and watches them climb in and the truck start up.
        const ph = j.dwellPhase();
        const handed = ph.phase === "startup";
        const oldT = handed ? inp.other : truck, newT = handed ? truck : inp.other;
        if (!oldT || !newT) { this.at(s.pos, ex.front + 8, 4, -9); this.at(s.look, ex.center, 1.5, 0); return s; }
        s.cutaway = false; s.fov = 36; s.pan = 2.4;
        if (ph.phase === "enter" || handed) {
          this.truckFrame(newT);
          const ne = this.ext(newT.model);
          s.pos.copy(this.loadPos);
          if (handed) this.at(s.look, ne.center, 1.6, 0); else this.at(s.look, ne.doorX, 1.8, ne.doorZ * 0.5);
          return s;
        }
        const D = swapWalkPoint(j, oldT, newT, this.v3);
        s.pos.copy(D).addScaledVector(R, -3.2).addScaledVector(F, -1.4).setY(1.8);
        s.look.copy(D).addScaledVector(F, 3).setY(1.3);
        this.loadPos.copy(s.pos);
        return s;
      }

      case "depart": {
        // The stop's camera watches the truck pull away, then moves off with it into the follow
        // (from behind on the route; from above at a dock, whose building is behind the truck).
        if (!this.road) {
          if (t < DEPART_HOLD && this.departHold) {
            s.pos.copy(this.anchorPos); this.at(s.look, ex.center, 1.5, 0);
            s.pan = 2.4; s.cutaway = false; s.fov = this.cam.fov;
            return s;
          }
          // (Started or sought into a depart: straight into the follow, not a glide from nowhere.)
          this.startRoad(inp, this.atDock ? "high" : "chase", this.departHold ? GLIDE + 1 : 0);
        }
        return this.roadCoverage(inp, s);
      }
    }
  }

  // ---- signs ----------------------------------------------------------------------------------
  // Aim from `cam` so that all of `pts` fit the 3:1 frame (with a margin), setting `look`; returns
  // the vertical lens in degrees. With `read`, never so wide that the lettering of the sign at
  // `read.at` (`read.h` high) drops under READ_ROWS rows: then the frame is centred on the sign's
  // own corners `read.pts` instead, as wide as still reads.
  private frameFit(cam: THREE.Vector3, pts: THREE.Vector3[], look: THREE.Vector3, read: { at: THREE.Vector3; h: number; pts: THREE.Vector3[] } | null, margin = 1.15): number {
    const fit = (ps: THREE.Vector3[]) => {
      const fwd = new THREE.Vector3();
      for (const p of ps) fwd.add(p);
      fwd.divideScalar(ps.length).sub(cam).normalize();
      const right = new THREE.Vector3(), up = new THREE.Vector3(), d = new THREE.Vector3();
      let hx = 0, hy = 0;
      for (let it = 0; it < 3; it++) {
        right.crossVectors(fwd, this.up).normalize(); up.crossVectors(right, fwd);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of ps) {
          d.copy(p).sub(cam); const z = Math.max(0.1, d.dot(fwd));
          const x = d.dot(right) / z, y = d.dot(up) / z;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        hx = (x1 - x0) / 2; hy = (y1 - y0) / 2;
        fwd.addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2).normalize();
      }
      return { fwd, tan: Math.max(hy, hx / this.cam.aspect) * margin };
    };
    let f = fit(pts);
    if (read) {
      const maxTan = (read.h * 128 / READ_ROWS) / 2 / cam.distanceTo(read.at);
      if (f.tan > maxTan) {
        // As wide as still reads, aimed from the middle of everything towards the sign only as
        // far as it takes to get all of the sign in.
        const sf = fit(read.pts), fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), d = new THREE.Vector3();
        const tan = Math.max(maxTan, sf.tan * 1.05);
        for (let k = 0; k <= 10; k++) {
          fwd.copy(f.fwd).lerp(sf.fwd, k / 10).normalize();
          right.crossVectors(fwd, this.up).normalize(); up.crossVectors(right, fwd);
          const inside = read.pts.every((p) => { d.copy(p).sub(cam); const z = d.dot(fwd); return z > 0 && Math.abs(d.dot(right) / z) <= tan * this.cam.aspect && Math.abs(d.dot(up) / z) <= tan; });
          if (inside || k === 10) break;
        }
        f = { fwd: fwd.clone(), tan };
      }
    }
    look.copy(cam).addScaledVector(f.fwd, 20);
    return THREE.MathUtils.clamp(Math.atan(f.tan) * 360 / Math.PI, 2.5, 50);
  }
  private up = new THREE.Vector3(0, 1, 0);

  // The road sign the truck is about to pass, if it is time for its shot: from when the truck's
  // front is SIGN_LEAD seconds short of it (no less than a second, so the shot has the truck coming
  // up to it) until its tail is SIGN_PAST metres past it. One board of a billboard row (whichever the
  // road's seed picks).
  private signsAhead(j: Journey): { piece: number; idx: number; sign: RoadSign }[] {
    const r = j.country!, s0 = j.countryS, ex = this.ext(j.st.truck), v = Math.max(j.st.v, 3);
    const inWindow = (g: RoadSign) => s0 + ex.rear < g.s + SIGN_PAST && s0 + ex.front < g.s + 2;
    // (The sign being filmed keeps the shot until the truck is past it, whatever comes up next.)
    if (this.beat === "roadside" && !this.feature && this.signPiece >= 0 && this.signPiece < r.pieces.length) {
      const g = pieceSigns(r.pieces[this.signPiece])[this.signIdx];
      if (g && s0 + ex.rear < g.s + SIGN_PAST) return [{ piece: this.signPiece, idx: this.signIdx, sign: g }];
    }
    const out: { piece: number; idx: number; sign: RoadSign }[] = [];
    for (let i = 0; i < r.pieces.length; i++) {
      const p = r.pieces[i];
      if (p.kind === "truckstop") continue;   // (its sign is up a pylon, out of any frame with the truck)
      const signs = pieceSigns(p);
      if (!signs.length) continue;
      const idx = p.kind === "billboards" ? Math.floor(hash2(i, Math.floor(p.s), r.geo.key, 0xb1b) * signs.length) : 0;
      const g = signs[idx], lead = (g.s - s0 - ex.front) / v;
      if (inWindow(g) && lead <= SIGN_LEAD && lead > 1) out.push({ piece: i, idx, sign: g });
    }
    return out;
  }
  // Plan the shot of sign `g` of piece `piece` (signPos, signLook, signFov): from beside the road
  // short of the sign, beyond it from the road or (a sign well off the road) between them, seen at
  // an angle; the frame fitted to the sign, the truck's lane at the sign and just past it
  // (and, for a roadside attraction, the attraction too if that still reads), the sign big enough
  // to read and in clear view (past its own board and posts), and so is the lane. Of the spots that work, the furthest back (the
  // truck is in the frame longest), at a moderate angle. False when there is none.
  private planSign(j: Journey, piece: number, g: RoadSign): boolean {
    const r = j.country!, p = r.pieces[piece];
    // (Heights: the camera and the lane over the road, which may be up on a flyover; the sign over the land.)
    const pt = (s: number, n: number, y: number, road = false) => { r.point(s, n, this.pose); return new THREE.Vector3(this.pose.x, y + (road ? r.truckY(s) : r.baseAt(s)), this.pose.z); };
    const lane = r.laneAt(g.s), side = g.n === 0 ? Math.sign(lane) || 1 : Math.sign(g.n);
    const sign = [-1, 1].flatMap((k) => [-1, 1].map((m) => pt(g.s, g.n + k * g.w / 2, g.y + m * g.h / 2)));
    const at = pt(g.s, g.n, g.y), h = g.h * (g.billboard ? 0.3 : 1);
    const past = g.s + 6, ln2 = r.laneAt(past);
    const road = [pt(g.s, lane, 0.2, true), pt(g.s, lane, 3.9, true), pt(past, ln2, 0.2, true), pt(past, ln2, 3.9, true)];
    const extra = p.kind === "attraction" ? [pt(p.s + 50, p.side * 40, 0.5), pt(p.s + 50, p.side * 40, 15)] : [];
    const above = g.y + r.baseAt(g.s) - r.truckY(g.s);   // (the sign's height over the road there)
    const look = new THREE.Vector3();
    for (const withExtra of extra.length ? [true, false] : [false]) {
      let best = -Infinity;
      for (const D of [56, 46, 38, 30, 24, 18, 13]) for (const k of [6, 11, 17, 0]) {
        const cs = g.s - D;
        if (cs < 1) continue;
        const lc = r.laneAt(cs);
        if (k === 0 && Math.abs(g.n - lc) < 14) continue;
        const n = k ? g.n + side * k : (g.n + lc) / 2;
        // (Clear of the truck's lane and of the oncoming one, which traffic uses.)
        if (Math.abs(n - lc) < 5.5 || Math.abs(n) < 6) continue;
        const ang = Math.atan2(Math.abs(n - g.n), D) * 180 / Math.PI;
        if (ang > 55) continue;
        const c = pt(cs, n, 0);
        c.y = Math.max(r.baseAt(cs) + 1.8, r.truckY(cs) + THREE.MathUtils.clamp(above - 1.2, 2.2, 6));
        const pts = withExtra ? [...sign, ...road, ...extra] : [...sign, ...road];
        const fov = this.frameFit(c, pts, look, null);
        if (fov > 48) continue;
        const rows = h * 128 / (2 * Math.tan(fov * Math.PI / 360) * c.distanceTo(at));
        if (rows < SIGN_READ_ROWS) continue;
        if (OCCLUSION.clearance(c, 1.5) < 1.5 || OCCLUSION.blocked(c, at, [], 1 + Math.min(g.w / 2, 4)) > 0.1 || OCCLUSION.blocked(c, road[1], [], 0.5) > 0.2) continue;
        const score = D - Math.abs(ang - 25) * 0.3;
        if (score > best) { best = score; this.signPos.copy(c); this.signLook.copy(look); this.signFov = fov; }
      }
      if (best > -Infinity) return true;
    }
    return false;
  }

  // Whether a kerb stop's facility has a name sign (city.ts: a blade sign over each sidewalk).
  private kerbSign(j: Journey, stop: { site: { bx: number; bz: number; fac: string } | null } | undefined) {
    if (!stop?.site) return false;
    const L = siteLayout(j.plan, stop.site.bx, stop.site.bz);
    return (L.kind === "kerb" || L.kind === "stand") && hasSign(stop.site.fac as never);
  }
  // A kerb stop's shot when its facility has a name sign: on the far sidewalk up the street, where
  // the sign's face can be read and nothing stands in front of it; false when there is no such spot
  // (then the usual shot from across the street).
  private curbSignSpot(j: Journey): boolean {
    const st = j.st, stop = st.stops[0];
    if (!stop?.site || !this.kerbSign(j, stop) || !j.path) return false;
    const P = j.path.eval(st.stopS, this.pose), fx = Math.cos(P.h), fz = -Math.sin(P.h), rx = Math.sin(P.h), rz = Math.cos(P.h);
    // The blade over the truck's own sidewalk, nearest where it stops.
    const G = j.plan.graph, blk = j.plan.blockOf(stop.site.bx, stop.site.bz);
    let B: THREE.Vector3 | null = null, best = 45;
    for (const [side, f] of (blk?.sides ?? []).entries()) {
      // (Where it hangs on that side: on an anchored block, a stand's moves along with the stand.)
      const a = bladeSignA(j.plan, stop.site.bx, stop.site.bz, side);
      if (a === null) continue;
      const { x, z } = G.facePt(f, a, -1.45);
      const along = (x - P.x) * fx + (z - P.z) * fz, lat = (x - P.x) * rx + (z - P.z) * rz;
      if (lat < 1 || lat > 6) continue;
      if (Math.abs(along) < best) { best = Math.abs(along); B = new THREE.Vector3(x, 4.55, z); }
    }
    if (!B) return false;
    // Up the street from it (the truck coming towards the camera), across on the far sidewalk or
    // over the far side of the street, above the street trees if it has to be.
    for (const y of [3.2, 5, 6.8]) for (const along of [22, 18, 26, 30, 15, 35]) for (const lat of [-14.5, -12, -9.5]) {
      const c = new THREE.Vector3(B.x + fx * along + rx * lat, y, B.z + fz * along + rz * lat);
      // (The last metre and a half, the sign's own post and the building behind it, don't count.)
      if (OCCLUSION.clearance(c, 1.2) < 1.2 || OCCLUSION.blocked(c, B, [], 1.5) > 0.1) continue;
      // The sign (2.1 m by 0.4 m, seen at an angle; the blade hangs out from the building line, so
      // its lettering runs across the street) and the street where the truck stops, in one frame
      // that still reads: never the sign alone.
      const blade = [-1, 1].map((k) => B.clone().add(new THREE.Vector3(rx * k * 1.05, 0.2 * k, rz * k * 1.05)));
      const ex = this.ext(st.truck), y0 = j.pathY(st.stopS);
      const at = (x: number, y: number) => new THREE.Vector3(P.x + fx * x, y0 + y, P.z + fz * x);
      const stopPts = [at(ex.center, 0.3), at(ex.center, 3.6), at(ex.front, 0.3), at(ex.front, 3.6)];
      const fov = this.frameFit(c, [...blade, ...stopPts], this.v4, null);
      if (fov > 40 || 0.4 * 128 / (2 * Math.tan(fov * Math.PI / 360) * c.distanceTo(B)) < SIGN_READ_ROWS) continue;
      if (OCCLUSION.blocked(c, at(ex.front - 1, 2.2), [], 0.5) > 0.2) continue;
      // Where the truck comes into that frame in clear view (its front, along the path).
      const fwd = this.v4.clone().sub(c).normalize(), right = new THREE.Vector3().crossVectors(fwd, this.up).normalize(), up = new THREE.Vector3().crossVectors(right, fwd);
      const tan = Math.tan(fov * Math.PI / 360), d = new THREE.Vector3(), q3 = new THREE.Vector3();
      const inFrame = (ps: number) => {
        const q = j.path!.eval(ps, this.pose);
        q3.set(q.x, j.pathY(ps) + 2, q.z); d.copy(q3).sub(c);
        const z = d.dot(fwd);
        return z > 1 && Math.abs(d.dot(right) / z) < tan * this.cam.aspect * 0.9 && Math.abs(d.dot(up) / z) < tan && OCCLUSION.blocked(c, q3, [], 0.5) <= 0.2;
      };
      let enter = -1;
      for (let fs = Math.max(0, st.stopS - CURB_SIGN_DIST) + ex.front; fs <= st.stopS + ex.front && enter < 0; fs += 0.5)
        if (inFrame(fs)) enter = fs;
      j.path.eval(st.s, this.pose2);   // (leave the path's cursor where the journey keeps it)
      if (enter < 0) continue;
      this.curbCam.copy(c); this.curbSignPos.copy(B); this.curbOpen.copy(this.v4); this.curbTele = fov; this.curbEnter = enter;
      this.curbAim.set(P.x + fx * ex.center, 1.5, P.z + fz * ex.center);
      return true;
    }
    j.path.eval(st.s, this.pose2);
    return false;
  }
  // The kerb stop's name-sign shot (curbSignSpot), worked out once per stop; false if it has none.
  private curbPlan(j: Journey): boolean {
    const st = j.st, key = st.city * 100000 + st.stopsDone;
    if (key !== this.curbKey) { this.curbKey = key; this.curbOk = this.curbSignSpot(j); }
    return this.curbOk;
  }
  // Seconds until the truck drives into the name sign's frame: at its speed, or braking evenly to
  // a stop at the kerb if that takes longer.
  private curbLead(j: Journey): number {
    const st = j.st, x = this.curbEnter - (st.s + this.ext(st.truck).front);
    if (x <= 0) return 0;
    const v = Math.max(st.v, 0.5), rem = Math.max(st.stopS - st.s, x + 0.01), a = v * v / (2 * rem);
    return Math.max(x / v, (v - Math.sqrt(Math.max(0, v * v - 2 * a * x))) / a);
  }

  // ---- road coverage --------------------------------------------------------------------------
  // The truck coming up to a freeway's on-ramp, on it or on the freeway into town, or going down
  // its off-ramp (the way into a city that has the truck take the freeway).
  private freewayPhase(j: Journey): "up" | "under" | null {
    const r = j.country, st = j.st;
    if (r && r.inp.toFreewayMerge && j.countryU >= 0) {
      const d = r.gateS - j.countryS;
      if (d > 520 && d < 760) return "under";   // (the on-ramp's way across under the freeway)
      return d < 850 && d > -FW_OFF_D - 10 ? "up" : null;
    }
    if (st.mode === "drive" && j.path?.route.garageOut?.kind) {   // (down an off-ramp, either kind)
      if (j.path.yAt(st.s) > 1.5) return "up";
      return st.s < (j.path.ramps[0]?.s1 ?? 0) + 40 ? "under" : null;   // (out at the foot of the off-ramp, under the freeway)
    }
    return null;
  }
  // A tunnel close ahead (or the truck in one): from its cutting until the truck is out the far end.
  private tunnelAhead(j: Journey) {
    const r = j.country;
    if (!r || j.countryU < 0) return false;
    const s = j.countryS;
    return !!r.tunnelAt(s + Math.max(j.st.v, 8) * 8, CUT_RUN + 20) || !!r.tunnelAt(s, 25);
  }
  // The setups that can be used from here, with the truck where it is and the road ahead as it is.
  private roadOptions(inp: DirectorInput): RoadShot[] {
    const j = inp.journey, st = j.st, ex = this.ext(inp.truck.model);
    const out: RoadShot[] = ["chase", "high"];
    if (st.mode === "drive" && j.path) {
      const v = Math.max(st.v, 4);
      if (st.s + ex.front + 10 + v * 10 < j.path.length) out.push("lead");
      // Side tracking wants a straight run.
      if (!this.turnWithin(j, -8, v * 10 + 20) && st.v > 3) out.push("track");
    } else if (j.country) out.push("lead", "track", "aerial");
    // Into a tunnel: only the rigs that ride low on the road go in with the truck.
    if (this.tunnelAhead(j)) return out.filter((o) => o === "chase" || o === "lead");
    // On and off a freeway: from above, so the ramps and the merge read; but from behind, low,
    // while the truck crosses under it.
    const fw = this.freewayPhase(j);
    if (fw === "under") return ["chase"];
    if (fw === "up") return j.country ? ["high", "aerial"] : ["high"];
    return out;
  }
  // Start a road setup (`kind`, or the next in the rotation), gliding there over `blend` seconds
  // from where the camera is now (0: a cut).
  private startRoad(inp: DirectorInput, kind: RoadShot | null, blend = 0) {
    const j = inp.journey, st = j.st, ex = this.ext(inp.truck.model);
    const prev = this.road;
    this.roadCount++;
    if (!kind) {
      // Weighted rotation, the follow most often; never the same setup twice running.
      const W: Record<RoadShot, number> = { chase: 3, high: 2, lead: 1.5, track: 1.5, aerial: 1.5 };
      let pool = this.roadOptions(inp).filter((o) => o !== prev);
      if (!pool.length) pool = ["high"];
      let sum = 0; for (const o of pool) sum += W[o];
      let r = hash3(this.roadCount, 5, st.city, this.seed, 0x7d1) * sum;
      kind = pool[pool.length - 1];
      for (const o of pool) { r -= W[o]; if (r < 0) { kind = o; break; } }
    }
    this.road = kind;
    this.roadStart = this.time;
    const [a, b] = ROAD_LEN[kind];
    this.roadLen = a + (b - a) * hash2(this.roadCount, 11, this.seed);
    // (The glide's length is settled on its first frame, once it is known how far round the truck
    // it has to swing: see roadCoverage.)
    this.blendLen = blend > 0 ? -blend : 0;
    this.blendStart = this.time; this.haveRig = false;
    if (blend > 0) this.glideFrom(ex);
  }
  // Start a glide from where the camera is now (offsets relative to the truck, see blendPos).
  private glideFrom(ex: ReturnType<typeof truckExtents>) {
    const C = this.at(this.v3, ex.center, 0, 0), h = this.refYaw;
    const fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    const rel = (p: THREE.Vector3, out: THREE.Vector3) => { const dx = p.x - C.x, dz = p.z - C.z; return out.set(dx * fx + dz * fz, p.y - this.T.y, dx * rx + dz * rz); };
    rel(this.pos, this.blendPos);
    rel(this.cam.getWorldDirection(this.v4).multiplyScalar(14).add(this.pos), this.blendLook);
    this.blendFov = this.cam.fov;
  }

  private roadCoverage(inp: DirectorInput, s: Shot): Shot {
    const j = inp.journey, st = j.st, truck = inp.truck, ex = this.ext(truck.model);
    const L = ex.front - ex.rear;
    // Time for a new setup? Its length is up, or the road no longer suits it (side tracking at a
    // turn, the lead car near the stop): glide on to the next one. (Not on the clock while the truck
    // stands or crawls, at a light or in traffic: the camera has no reason to go anywhere then, so
    // it holds the shot it has till the truck is under way again.)
    let cut = false;
    if (!this.road) { this.startRoad(inp, null); cut = true; }
    else {
      const e = this.time - this.roadStart;
      let done = e >= this.roadLen && Math.abs(st.v) > ROAD_MOVING;
      if (this.road === "track" && this.turnWithin(j, -4, Math.max(st.v, 3) * 3 + 10)) done = true;
      if (this.road !== "chase" && this.road !== "lead" && this.tunnelAhead(j)) done = true;
      const fw = this.freewayPhase(j);
      if ((fw === "up" && this.road !== "high" && this.road !== "aerial") || (fw === "under" && this.road !== "chase")) done = true;
      if (this.road === "lead" && st.mode === "drive" && j.path && st.s + ex.front + 10 > j.path.length - 2) done = true;
      if (done && !(this.blendLen !== 0 && this.time - this.blendStart < Math.abs(this.blendLen))) this.startRoad(inp, null, GLIDE);
    }
    this.variant = this.road;
    const e = this.time - this.roadStart, u = this.roadLen > 0 ? e / this.roadLen : 0;
    const C = this.at(this.v3, ex.center, 1.5, 0);
    let onRoute = true;
    switch (this.road as RoadShot) {
      case "chase": {
        // Follow car: low behind and a little left, the truck in the lower middle, the road ahead
        // above it; a slow push in over the shot.
        const back = 8 + L * 0.5 - 2 * smoother(u);
        onRoute = this.rig(j, back, -1.4, 4.0, s.pos, ex);
        this.at(s.look, ex.center + 3, 1.6, 0); s.sy = -0.12; s.fov = 34;
        break;
      }
      case "high": {
        const back = 11 + L * 0.5;
        onRoute = this.rig(j, back, -3.5, 13, s.pos, ex);
        this.at(s.look, ex.center + 5, 0.8, 0); s.sy = -0.2; s.fov = 36;
        break;
      }
      case "lead": {
        // Lead car: ahead and a little left, looking back at the cab coming on.
        const ahead = ex.front + 10;
        const ll = st.mode === "drive" ? -1.6 : -3.2, lh = st.mode === "drive" ? 2.6 : 3.2;
        if (!this.onRoute(j, ahead, ll, lh, s.pos, false)) { this.atRef(s.pos, ex.center, ahead - ex.center, lh, ll); onRoute = false; }
        this.at(s.look, ex.center + L * 0.15, 1.7, 0); s.sy = -0.05; s.fov = 32;
        break;
      }
      case "track": {
        // Side tracking from the left, level with the truck, which travels right to left with
        // room ahead of it.
        const lat = st.mode === "drive" ? -11.5 : -(j.country ? j.country.laneAt(j.countryS) : 1.85) - 11;
        if (!this.onRoute(j, ex.center + 1.5, lat, 2.0, s.pos)) { this.atRef(s.pos, ex.center, 1.5, 2.0, -12); onRoute = false; }
        s.look.copy(C).setY(this.T.y + 1.7); s.sx = 0.22; s.fov = 38;
        break;
      }
      case "aerial": {
        // A rising reveal of the land: one eased move up and out to the left over the shot, then
        // it holds there.
        const k = smoother(u * 1.25);
        const back = 14 + 18 * k, lat = -6 - 16 * k, h = 4.5 + 22 * k;
        onRoute = this.rig(j, back, lat, h, s.pos, ex);
        this.at(s.look, ex.center + 4 + 10 * k, 1.2, 0); s.sy = -0.1 - 0.15 * k; s.fov = 40;
        break;
      }
    }
    // In town a truck-relative rig can swing over a block at a corner: keep it out of buildings.
    if (!onRoute && st.mode === "drive" && this.avoidBuildings) this.avoidBuildings(s.pos, truck.root.position, true);
    // The glide in from the last setup (or the stop's camera): travelling with the truck, it
    // swings round it (angle, distance and height eased together), never through or over it, and
    // takes longer the further round it goes, so the view turns at an easy pace.
    const rel = (p: THREE.Vector3, out: THREE.Vector3) => {
      const c = this.at(this.v4, ex.center, 0, 0), h = this.refYaw, dx = p.x - c.x, dz = p.z - c.z;
      return out.set(dx * Math.cos(h) - dz * Math.sin(h), p.y - this.T.y, dx * Math.sin(h) + dz * Math.cos(h));
    };
    // (If the rig's spot jumps, as when the truck's route is replaced at a stop, glide there.)
    {
      const to = rel(s.pos, this.v1b);
      const jumped = this.haveRig && to.distanceTo(this.lastRig) > 2;
      this.lastRig.copy(to); this.haveRig = true;
      if (jumped && !cut) { this.glideFrom(ex); this.blendLen = -1.5; this.blendStart = this.time; }
    }
    const eb = this.time - this.blendStart;
    if (this.blendLen < 0) {
      // Which way round, settled now and kept (a half turn could go either way): by the truck's
      // left, the street side the coverage keeps to.
      const to = rel(s.pos, this.v1b), b = this.blendPos, a0 = Math.atan2(b.z, b.x);
      let d = wrapAngle(Math.atan2(to.z, to.x) - a0);
      if (Math.abs(d) > 0.6 * Math.PI && Math.sin(a0 + d / 2) > 0) d -= Math.sign(d) * 2 * Math.PI;
      this.blendA1 = a0 + d;
      this.blendLen = -this.blendLen + 6 * Math.abs(d) / Math.PI;   // (+6 s for a half turn)
    }
    if (this.blendLen > 0 && eb < this.blendLen) {
      const k = smoother(eb / this.blendLen), b = this.blendPos, l = this.blendLook;
      const to = rel(s.pos, this.v1b);
      // (The target's angle, kept continuous with last frame's: never a jump to the other way round.)
      const a0 = Math.atan2(b.z, b.x), a1 = this.blendA1 = this.blendA1 + wrapAngle(Math.atan2(to.z, to.x) - this.blendA1);
      const r0 = Math.hypot(b.x, b.z), r1 = Math.hypot(to.x, to.z);
      const a = a0 + (a1 - a0) * k, r = r0 + (r1 - r0) * k, y = b.y + (to.y - b.y) * k;
      this.atRef(s.pos, ex.center, Math.cos(a) * r, y, Math.sin(a) * r);
      const lt = rel(s.look, this.v1b);
      this.atRef(s.look, ex.center, l.x + (lt.x - l.x) * k, l.y + (lt.y - l.y) * k, l.z + (lt.z - l.z) * k);
      s.sx = (s.sx ?? 0) * k; s.sy = (s.sy ?? 0) * k;
      s.fov = this.blendFov + ((s.fov ?? FOV) - this.blendFov) * k;
    } else if (cut) s.cut = true;

    return s;
  }
  private blendFov = FOV;

  // A follow rig `back` metres behind the truck's centre, `lat` to its right, at height y: on the
  // route where it can be (it stays over the street round corners; true), else in the smoothed
  // heading's frame. (Leaving a dock, the route behind the truck is inside the building.)
  private rig(j: Journey, back: number, lat: number, y: number, out: THREE.Vector3, ex: ReturnType<typeof truckExtents>) {
    if (this.onRoute(j, ex.center - back, lat, y, out, !this.atDock)) return true;
    this.atRef(out, ex.center, -back, y, lat);
    return false;
  }

  // ---- load coverage --------------------------------------------------------------------------
  // The whole stop in one setup, locked off, the operator panning with the driver: the camera that
  // filmed the truck in ("hold", easing in closer as the work starts) or the one that sees the work
  // best. A long load cuts once to a second angle, as the driver sets off on a trip half way through.
  private loadCoverage(inp: DirectorInput, ph: ReturnType<Journey["dwellPhase"]>, s: Shot): Shot {
    const truck = inp.truck, ex = this.ext(truck.model);
    let key = this.loadAltDone ? this.loadAlt : this.loadMaster;
    if (ph.phase === "load" && !this.loadAltDone && this.loadAlt && ph.len > LOAD_ALT_AFTER) {
      const ci = ph.chore ? inp.journey.chores.indexOf(ph.chore) : -1;
      if (this.loadSegChore >= 0 && ci !== this.loadSegChore && (ph.chore?.kind === "walk" || ph.chore?.kind === "fetch") && ph.t > ph.len * 0.45 && ph.len - ph.t > 12) { this.loadAltDone = true; key = this.loadAlt; }
      this.loadSegChore = ci;
    }
    if (key !== this.loadShot) {
      this.loadCam(key, truck, this.loadPos, this.loadLook);
      s.cut = this.loadShot !== "" || key !== "hold";
      this.loadShot = key;
    }
    s.pos.copy(this.loadPos);
    if (key === "hold") s.pos.lerp(this.pushPos, smoother((this.beatTime - 1.5) / 7));
    // Frame between the setup's centre of interest and the driver; the truck once it starts up.
    if (ph.phase === "startup") this.at(s.look, ex.center + 1, 1.5, 0);
    else { s.look.copy(this.loadLook); if (inp.driver) s.look.lerp(inp.driver, 0.5); }
    s.pan = 2.2; s.cutaway = false;
    // (Held, the lens eases from however the arrival left it to a working width as the camera moves in.)
    s.fov = key === "hold" ? this.holdFov + (34 - this.holdFov) * smoother((this.beatTime - 1.5) / 7) : key === "rear" ? 34 : 36;
    this.anchorPos.copy(s.pos);   // (where depart starts from)
    this.variant = key;
    return s;
  }

  // The held camera's slow move in towards the work: two-thirds of the way, no nearer than 9 m,
  // and only to a spot clear of walls (else it stays put).
  private pushIn(inp: DirectorInput) {
    this.truckFrame(inp.truck);
    const lay = truckLayout(inp.truck.model);
    const work = this.at(this.v3, lay.bedRear + 0.5, 1.5, 0);
    const d = Math.hypot(work.x - this.holdPos.x, work.z - this.holdPos.z);
    const k = d > 9 ? Math.max(1 - (d - Math.max(9, d * 0.67)) / d, 0) : 1;
    this.pushPos.copy(this.holdPos);
    this.pushPos.x = work.x + (this.holdPos.x - work.x) * k; this.pushPos.z = work.z + (this.holdPos.z - work.z) * k;
    if (OCCLUSION.clearance(this.pushPos, LOAD_CLEARANCE) < LOAD_CLEARANCE) this.pushPos.copy(this.holdPos);
  }

  // A load setup's camera and look (truck frame set). In a tight spot (a dock yard between
  // buildings, a canopy overhead) the camera moves, level, to the nearest place clear of anything
  // tall (LOAD_CLEARANCE) and not too close to what it films.
  private loadCam(v: string, truck: Truck, pos: THREE.Vector3, look: THREE.Vector3) {
    this.truckFrame(truck);
    this.loadCamRaw(v, truck, pos, look);
    if (v === "hold" || OCCLUSION.clearance(pos, LOAD_CLEARANCE) >= LOAD_CLEARANCE) return;
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
    const lay = truckLayout(truck.model), ex = this.ext(truck.model), back = lay.trailer ? lay.bedRear + 3 : lay.bedRear - 3.5;
    const dock = this.atDock ? 5 : 0;
    switch (v) {
      case "hold": pos.copy(this.holdPos); this.at(look, lay.bedRear + 0.5, 1.4, 0); return;
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
    for (const t of [inp.truck, inp.other]) if (t) { const e = this.ext(t.model); out.push({ x: t.root.position.x, z: t.root.position.z, h: t.heading, ax0: e.rear, ax1: e.front, hw: 1.3, top: 3.8 }); }
    return out;
  }

  // The load master that sees the work best: where the driver walks down the side, works at the
  // back and goes to the door, scored by how much stands in the way. The usual angle is kept
  // unless something blocks it; then a clearer one is used.
  private pickLoadAngle(inp: DirectorInput, usual: string, canHold: boolean): string[] {
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
      // Too close to something tall: it would fill the frame.
      return sum / wsum + (OCCLUSION.clearance(cam, LOAD_CLEARANCE) < LOAD_CLEARANCE ? 1 : 0);
    };
    const usuals = (this.atDock ? [...DOCK_VARIANTS] : [...LOAD_VARIANTS]) as string[];
    // Holding the camera that filmed the truck in saves a cut, so it wins unless it sees clearly
    // less (or stands too far off: the driver would be a speck).
    const holdFar = Math.hypot(this.holdPos.x - this.T.x, this.holdPos.z - this.T.z) > 32 ? 0.5 : 0;
    const order: [string, number][] = [...(canHold ? [["hold", -0.12 + holdFar] as [string, number]] : []), [usual, 0], ...usuals.filter((v) => v !== usual).map((v) => [v, 0.02] as [string, number]), ...LOAD_EXTRA];
    const scored = order.map(([v, pen]) => [v, score(v) + pen] as const);
    this.loadScores = scored.map(([v, sc]) => `${v[0]}${sc.toFixed(2)}`).join(" ");
    return [...scored].sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  }

  // Where to film a reverse into a dock bay from: beside the bay mouth, clear of the whole sweep
  // of the truck along the bay path and of anything tall, seeing the truck's street side.
  private backupSpot(inp: DirectorInput): THREE.Vector3 {
    const j = inp.journey, dk = j.dock, ex = this.ext(inp.truck.model);
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
      if (near < 12) continue;
      this.v4.set(cx, 3, cz);
      const clear = OCCLUSION.clearance(this.v4, LOAD_CLEARANCE);
      const d = Math.hypot(x - cxd, z);
      // It has to see the truck once it is in the bay (not from round a corner of the building),
      // and if it can, the facility's name sign, face on enough to read.
      this.v3.set(px + fx * cxd, 1.8, pz + fz * cxd);
      const hidden = OCCLUSION.blocked(this.v4, this.v3, []);
      let signSc = 0;
      if (dk?.sign) {
        const g = dk.sign, vx = cx - g.x, vz = cz - g.z, vl = Math.hypot(vx, vz), facing = (vx * g.nx + vz * g.nz) / vl;
        this.v3.set(g.x, g.y, g.z);
        signSc = (facing > 0.55 ? 1.5 : facing > 0.3 ? 0.5 : -1) - 3 * OCCLUSION.blocked(this.v4, this.v3, [], 0.5) - Math.max(0, vl - 30) * 0.1;
      }
      const sc = signSc - hidden * 6 + Math.min(near, 14) * 0.3 - Math.max(0, Math.abs(d - 22) - 4) * 0.4 + (z < 0 ? 0.8 : 0) - (clear < LOAD_CLEARANCE ? 5 : 0);
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
  }
}
