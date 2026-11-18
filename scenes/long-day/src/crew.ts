// The crew: the driver playing the current stop's chores, and the dock worker (who waves trucks
// into a bay, takes the other end of a team lift and drives the forklift), with the hand tools,
// the forklift and the cargo they move (loads.ts), animals walking alongside, and the load
// riding in the bed.
// Everything is a function of the journey's dwell clock, so a restored journey picks up mid-chore.
// The crew also drives the truck's moving parts (cab door, roll-up door, ramp, lift gate,
// trailer doors) so they open and close exactly when the driver works them.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { CURB_H, KERB } from "./grid.ts";
import { loadFields, saveFields } from "./snap.ts";
import { ease, Truck, truckLayout } from "./truck.ts";
import type { DoorGeom, TruckLayout, TruckModel } from "./truck.ts";
import { END_ON_HALF } from "./city.ts";
import type { KerbDoor } from "./city.ts";
import { CARGO_MODELS } from "./cargomodels.ts";
import { DOCK_PLATFORM } from "./facilities.ts";
import { CARGO_BY_ID } from "./cargo.ts";
import { ROAD_PARK, bedUnits, DOOR_OPEN, DOOR_REACH, DOOR_STAND, RAMP_HOLD, STRAP_PULL, strapPulls, STYLE, toolStore, tripCount, tripUnits } from "./chores.ts";
import type { Chore, ItemKind, ToolRest } from "./chores.ts";
import { Journey, siteKey } from "./journey.ts";
import type { Aboard, DwellNow, Stop } from "./journey.ts";
import { swapWalkPoint } from "./director.ts";
import { BedLoad, buildCarried, Herd } from "./loads.ts";
import type { CarriedLoad } from "./loads.ts";
import { blendPose, carryArms, Character, CHARACTER_HIP_Y, DRIVER_LOOK, gesturePose, HIP_Y, idlePose, liftArms, lowArms, pushArms, restPose, seatedPose, walkPose, WORKER_LOOK } from "./character.ts";
import type { BodyPose } from "./character.ts";

const STRIDE = 1.2;   // metres per walk cycle (two steps)

type CrewSave = { f: Record<string, unknown>; gag: THREE.Vector3; gagOn: boolean };   // (the vector kept when there is no gag)
export class Crew {
  readonly driver: Character;
  readonly helper: Character;
  private tools: { handTruck: THREE.Group; palletJack: THREE.Group };
  private forklift: THREE.Group;
  private forks: THREE.Group;              // the carriage, raised along the mast
  private loads = new Map<string, CarriedLoad>();
  private load: CarriedLoad | null = null;    // the current stop's cargo, as carried
  private herd: Herd | null = null;
  private bed: BedLoad;
  private duckGeo: THREE.BufferGeometry;
  private ducks: THREE.Mesh[] = [];           // spilled rubber ducks, until the stop ends
  private duckMarks = new Set<string>();
  private scene: THREE.Scene; private material: THREE.Material;
  // Where a humorous load is right now (for the camera's gag insert), or null.
  gagPoint: THREE.Vector3 | null = null;
  private gagV = new THREE.Vector3();
  private pose = restPose(); private tmpPose = restPose();
  private yaw = 0; private yawV = 0;
  private plan: Chore[] = [];           // the journey's chores for this stop
  private walkPhase = 0;
  private m4 = new THREE.Matrix4(); private v = new THREE.Vector3(); private v2 = new THREE.Vector3();
  private time = 0;
  private qa = new THREE.Quaternion(); private eu = new THREE.Euler();
  private toolHeld: "handTruck" | "palletJack" | null = null;

  constructor(scene: THREE.Scene, material: THREE.Material) {
    this.driver = new Character(material, DRIVER_LOOK);
    this.helper = new Character(material, WORKER_LOOK, true);
    this.helper.root.visible = false;
    scene.add(this.driver.root, this.helper.root);
    this.scene = scene; this.material = material;
    this.bed = new BedLoad(material);
    const build = (f: (b: Batch) => void) => { const g = new THREE.Group(); const b = new Batch(); f(b); g.add(b.build(material)!); g.visible = false; scene.add(g); return g; };
    const STEEL = 0x8d9296, BLACK = 0x1c1c1c;
    this.tools = {
      // Hand truck in its own frame: axle at the origin, frame rising along +y, nose plate at +x.
      handTruck: build((b) => {
        for (const z of [-0.2, 0.2]) { b.cyl(0, 0.13, z, 0.13, 0.06, BLACK, 8, Math.PI / 2); b.box(0.02, 0.7, z, 0.04, 1.3, 0.04, 0xc0392b); }
        b.box(0.02, 1.32, 0, 0.04, 0.04, 0.44, 0xc0392b);
        b.box(0.14, 0.03, 0, 0.24, 0.03, 0.4, STEEL);
      }),
      // Pallet jack: handle at the origin, forks running forward along +x.
      palletJack: build((b) => {
        b.box(0, 0.12, 0, 0.18, 0.24, 0.3, 0xe0a020);
        b.box(-0.18, 0.62, 0, 0.04, 1.0, 0.04, 0x222222);
        for (const z of [-0.25, 0.25]) b.box(0.75, 0.05, z, 1.2, 0.07, 0.16, 0xe0a020);
      }),
    };
    // Forklift in its own frame: origin on the ground under the fork heels, forks along +x.
    {
      const YEL = 0xe8a317, DARK = 0x2a2b2e, b = new Batch();
      b.box(-1.25, 0.55, 0, 1.7, 0.7, 1.1, YEL);
      b.box(-2.0, 0.8, 0, 0.45, 1.05, 1.16, DARK);   // (counterweight a little wider than the body: no shared faces)
      b.box(-1.2, 1.0, 0, 0.5, 0.12, 0.55, BLACK); b.box(-1.42, 1.3, 0, 0.1, 0.55, 0.49, BLACK);   // seat
      b.cyl(-0.85, 1.25, -0.1, 0.03, 0.5, BLACK, 6, 0, -0.5);
      for (const x of [-0.55, -1.75]) for (const z of [-0.48, 0.48]) b.box(x, 1.55, z, 0.06, 1.3, 0.06, BLACK);
      b.box(-1.15, 2.2, 0, 1.3, 0.06, 1.08, BLACK);   // (overhangs the posts)
      for (const z of [-0.33, 0.33]) b.box(-0.25, 1.15, z, 0.09, 2.1, 0.09, 0x3a3c40);
      for (const [x, r] of [[-0.6, 0.32], [-1.85, 0.25]] as const) for (const z of [-0.5, 0.5]) b.cyl(x, r, z, r, 0.22, BLACK, 10, Math.PI / 2);
      this.forklift = new THREE.Group(); this.forklift.add(b.build(material)!);
      const f = new Batch();
      f.box(-0.12, 0.5, 0, 0.06, 0.9, 0.9, 0x3a3c40);
      for (const z of [-0.25, 0.25]) f.box(0.55, 0.025, z, 1.15, 0.05, 0.12, 0x3a3c40);
      this.forks = new THREE.Group(); this.forks.add(f.build(material)!);
      this.forklift.add(this.forks);
      this.forklift.visible = false; scene.add(this.forklift);
      // A second one, parked by a stack while the first works elsewhere (yardProps; shared geometry).
      this.parkedForklift = this.forklift.clone(); this.parkedForks = this.parkedForklift.children[1] as THREE.Group;
      scene.add(this.parkedForklift);
    }
    const db = new Batch();
    db.box(0, 0.08, 0, 0.2, 0.16, 0.16, 0xf2c200); db.box(0.08, 0.2, 0, 0.12, 0.12, 0.12, 0xf2c200); db.box(0.16, 0.19, 0, 0.07, 0.03, 0.08, 0xe67e22);
    this.duckGeo = db.build(material)!.geometry;
  }

  // ---- per frame ------------------------------------------------------------------------------
  private feetY = 0; private helperFeetY = 0;   // the driver's feet on a walk, and a point a load's length behind (work)
  private drv: [number, number, number, number] = [0, 0, 0, 0];   // the driver this frame: truck-frame x, y, z, yaw
  // The second carrier of a team lift (the facility's worker): truck-frame pose this frame, and
  // whether they are holding their end of the load (on a carry and the reach either side of it).
  private mate = { x: 0, y: 0, z: 0, yaw: 0, attached: false };
  private teamPlan: Chore[] | null = null;
  private teamRuns: { i0: number; i1: number; pre: number; post: number; pts: [number, number][]; cum: number[] }[] = [];
  private teamStart: number[] = [];
  private doorNow = 0;   // the roll-up door's opening during a door chore (work sets it with the pose)   // a team lift's two carriers, truck frame (work)
  get workerRoot() { return this.helper.root; }   // the dock worker / team-lift carrier, for FrontDoorFx
  forkDoor = 0;   // how far the facility's front door is open for the forklift at a flatbed (FrontDoorFx)
  private fp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];   // its path out of the door
  inSeat = true;   // the driver is sitting in the cab (seat() this frame); main turns the driver spotlight on otherwise
  // The springs and per-stop state that carry over between frames (main.ts: preview snapshots and
  // part-ticks); everything else follows from the journey each frame.
  private static SAVED = ["yaw", "yawV", "walkPhase", "time", "feetY", "helperFeetY", "drv", "mate", "doorNow", "toolHeld", "inSeat", "pose", "tmpPose", "yard"] as const;
  // (`into`: an earlier save, filled again in place.)
  saveState(into?: CrewSave): CrewSave {
    const s = into ?? { f: {}, gag: new THREE.Vector3(), gagOn: false };
    s.f = saveFields(this, Crew.SAVED, [], s.f);
    s.gagOn = !!this.gagPoint; if (s.gagOn) s.gag.copy(this.gagV);
    return s;
  }
  loadState(s: CrewSave) { loadFields(this, s.f); this.gagPoint = s.gagOn ? this.gagV.copy(s.gag) : null; }
  update(dt: number, j: Journey, truck: Truck, other: Truck | null, cam: THREE.Camera) {
    this.inSeat = false;
    this.time = j.st.simTime + j.frac;   // journey time: idle motion is the same after a scrub
    const st = j.st, d = this.driver;
    const controls = { cab: 0, otherCab: 0, rear: 0, ramp: 0, gate: 0, drop: 0, doors: 0 };
    this.helper.root.visible = false;
    if (this.load) { this.load.group.visible = false; this.load.group.scale.set(1, 1, 1); }
    this.herd?.hide();
    this.tools.handTruck.visible = this.tools.palletJack.visible = false;
    this.forklift.visible = false; this.stackWorking = false;
    this.forkDoor = 0;
    this.gagPoint = null;
    d.root.visible = true;
    d.vestOn = false;   // (on for a dock stop, below: set on every update, so a scrub back takes it off)
    const stop = st.stops[0];
    this.bed.update(truck, st.mode === "dwell" && stop && stop.kind !== "swap" ? this.bedView(j, truck, stop) : st.aboard);
    this.prepareCargo(st.mode === "dwell" && stop && stop.kind !== "swap" ? stop : null, j);
    this.worker(j, truck, stop);
    this.yardProps(j, truck);

    this.toolHeld = null;
    // The country truck stop: out of the old truck, along to the spare, up into it.
    const road = j.country, cstop = road && j.countryU >= 0 ? road.stoppedAt(j.countryU) : null;
    if (cstop && cstop.kind === "truckstop" && road!.swapU >= 0) {
      this.truckStopSwap(j.countryU - cstop.arrive, road!.swapU - cstop.arrive, truck, other, controls);
      this.applyTruck(truck, other, controls);
      this.firstPerson(cam);
      return;
    }
    if (st.mode !== "dwell") {
      this.seat(truck, seatedPose(this.pose, truck.steer));
      this.applyTruck(truck, other, controls);
      this.firstPerson(cam);
      return;
    }
    const ph = j.dwellPhase();
    this.plan = j.chores;
    const idx = ph.chore ? j.chores.indexOf(ph.chore) : -1;
    // Door, ramp and gate state: the end effect of every finished chore, then the current one.
    for (let i = 0; i <= idx; i++) this.choreControls(j.chores[i], i < idx ? 1 : ph.ct / j.chores[i].len, controls, stop.kind === "swap");
    const docked = j.isDockStop(stop);
    d.vestOn = docked;
    // At a dock the trailer's swing doors open as it settles (out of sight against the seal)
    // and close while the driver climbs back in.
    if (docked && truckLayout(truck.model).trailer)
      controls.doors = ph.phase === "park" ? ease(ph.t / ph.len) : ph.phase === "enter" ? 1 - ease(ph.t / ph.len) : ph.phase === "startup" ? 0 : 1;

    if (!ph.chore) {
      // Park and startup: in the seat (of the new truck after a swap's hand-over).
      this.seat(truck, seatedPose(this.pose, 0));
    } else {
      const c = ph.chore, u = THREE.MathUtils.clamp(ph.ct / c.len, 0, 1);
      const swap = stop.kind === "swap";
      if (c.kind === "climbDown") this.climb(truck, ph.ct, c.len, false);
      else if (c.kind === "climbUp") this.climb(swap && other ? other : truck, ph.ct, c.len, true);
      else if (swap && c.kind === "walk" && other) this.swapWalk(j, truck, other, ph.ct, c.len, dt);
      else this.work(c, ph.ct, u, truck, dt, stop);
    }
    if (ph.chore && (ph.chore.kind === "doorOpen" || ph.chore.kind === "doorClose")) controls.rear = this.doorNow;
    // A hand truck or pallet jack not in hand rides in the bed, against the front wall.
    if (stop.kind !== "swap" && stop.cargo) {
      const tool = STYLE[CARGO_BY_ID.get(stop.cargo)!.handling].tool;
      const L = truckLayout(truck.model);
      if (tool && !L.trailer && !L.flatbed && !(ph.chore && this.toolHeld)) {
        const r = this.toolRest(j, ph, L, tool), h = this.tools[tool];
        truck.root.updateMatrixWorld();
        h.visible = true;
        h.position.set(r.at[0], r.at[1], r.at[2]).applyMatrix4(truck.root.matrixWorld);
        h.rotation.set(0, truck.heading + r.yaw, 0);
      }
    }
    this.foldAtDoor(j);
    this.applyTruck(truck, other, controls);
    this.firstPerson(cam);
  }

  // A load too big for the facility's front door squashes to fit as it goes through, whoever
  // carries it (the driver, a team lift, the forklift), and springs back out, wobbling, once it's
  // clear: folded flat while it overlaps the doorway, its full size again a metre or two out. It
  // depends only on where the load is, so a scrub shows the same thing.
  private foldAtDoor(j: Journey) {
    const load = this.load, d = j.kerbDoor;
    if (!load || !d || !load.group.visible) return;
    const g = load.group, [l, h, w] = load.size;
    g.updateMatrixWorld();
    const e = g.matrixWorld.elements, ax = [e[0], e[2]], az = [e[8], e[10]];   // the load's own x and z, level
    const tx = -d.nz, tz = d.nx;
    const along = (vx: number, vz: number) => Math.abs(ax[0] * vx + ax[1] * vz) * l + Math.abs(az[0] * vx + az[1] * vz) * w;
    const across = along(tx, tz), deep = along(d.nx, d.nz) / 2;
    const ox = g.position.x - d.x, oz = g.position.z - d.z;
    if (Math.abs(ox * tx + oz * tz) > d.half + across / 2 + 1) return;   // not in front of the door
    // How it must shrink: under the head of the doorway (from where it rides), and between the jambs.
    const bottom = g.position.y - (load.round ? h / 2 : 0), top = CURB_H + d.h - 0.05;
    let fy = Math.min(1, Math.max(0.15, (top - bottom) / h)), fw = Math.min(1, (d.half * 2 - 0.1) / across);
    if (fy >= 1 && fw >= 1) return;
    // More than it needs, and always enough to see (a load only just too big still gets squeezed).
    fy = fy < 1 ? Math.min(fy * 0.9, 0.62) : 1; fw = fw < 1 ? Math.min(fw * 0.9, 0.62) : 1;
    // Clear of the doorway by `out` metres: a damped spring back to full size, overshooting, with
    // squash and stretch (taller while it's narrower, and the other way).
    const out = Math.max(0, ox * d.nx + oz * d.nz - deep - 0.15) / 1.2;
    const k = out <= 0 ? 0 : 1 - Math.exp(-2.5 * out) * Math.cos(8 * out);
    const wob = out <= 0 ? 0 : 0.22 * Math.exp(-2.5 * out) * Math.sin(8 * out);
    const sy = fy + (1 - fy) * k, sw = fw + (1 - fw) * k;
    g.scale.set(sw * (1 - wob), sy * (1 + wob), sw * (1 - wob));
  }

  // The trip under way: `i` of `trips` (one per stow). A pickup's trip runs up to and through
  // its stow; a drop's from its stow on.
  private tripNow(j: Journey, stop: Stop): { i: number; trips: number } {
    const ph = j.dwellPhase(), ch = j.chores;
    let trips = 0, before = 0;
    const idx = ph.chore ? ch.indexOf(ph.chore) : ph.phase === "startup" ? ch.length : -1;
    // A trip is a stow (by hand) or a forklift wait.
    const isTrip = (c: Chore | null | undefined) => !!c && (c.kind === "stow" || (c.kind === "wait" && !!c.forklift));
    for (let k = 0; k < ch.length; k++) if (isTrip(ch[k])) { trips++; if (k < idx) before++; }
    const i = isTrip(ph.chore) || stop.kind === "pickup" ? before : before - 1;
    return { i: THREE.MathUtils.clamp(i, 0, Math.max(0, trips - 1)), trips };
  }

  // Where the tool rests in the bed right now: where it was taken from until the driver takes
  // it, where it was put back afterwards.
  private toolRest(j: Journey, ph: DwellNow, L: TruckLayout, tool: "handTruck" | "palletJack"): ToolRest {
    const get = j.chores.find((c) => c.kind === "toolGet"), put = j.chores.find((c) => c.kind === "toolPut");
    const idx = ph.chore ? j.chores.indexOf(ph.chore) : ph.phase === "startup" ? j.chores.length : -1;
    const r = get && idx <= j.chores.indexOf(get) ? get.rest : put && idx >= j.chores.indexOf(put) ? put.rest : get?.rest;
    return r ?? toolStore(L, tool);
  }

  // ---- team lifts ------------------------------------------------------------------------------
  // The worker carries the far end. On each carry (a run of walks with the load) they follow the
  // driver's path a load's length behind; between carries they walk (by the ramp, in after the
  // driver, round to the far side) to where the next carry starts. They come out of the facility
  // door and go back in (at a dock: from and to where they stand with the clipboard).
  private teamMate(c: Chore, t: number, truck: Truck, stop: Stop) {
    const plan = this.plan, L = truckLayout(truck.model), hp = this.helper, load = this.load;
    if (!load || !plan.length) return;
    if (this.teamPlan !== plan) this.buildTeamRuns(plan);
    const runs = this.teamRuns, start = this.teamStart;
    if (!runs.length) return;
    const dock = !plan.some((q) => q.kind === "rampOut" || q.kind === "gateOut");
    const back = this.teamBack(load);
    const idx = plan.indexOf(c), tc = start[idx] + t, end = (k: number) => start[k] + plan[k].len;
    const span = (r: typeof runs[number]) => [start[r.pre >= 0 ? r.pre : r.i0], end(r.post >= 0 ? r.post : r.i1)];
    const terrain = (x: number, z: number) => {
      if (x >= L.bedRear - 0.02 && Math.abs(z) < L.hw) return L.floor;
      if (dock) return DOCK_PLATFORM;
      const foot = L.bedRear - L.rampRun;
      if (L.loader === "ramp" && Math.abs(z) < 0.55 && x > foot) return ((x - foot) / L.rampRun) * (L.floor - 0.12);
      return 0;
    };
    // A point on a carry's path at distance D (before its start: back along its first leg).
    const along = (r: typeof runs[number], D: number): [number, number, number] => {
      const p = r.pts, n = p.length;
      let k = 0;
      while (k < n - 2 && (D > r.cum[k + 1] || r.cum[k + 1] - r.cum[k] < 1e-3)) k++;
      let j = k;
      while (j < n - 2 && r.cum[j + 1] - r.cum[j] < 1e-3) j++;   // a lift-gate ride has no length: take the next leg's heading
      const dx = p[j + 1][0] - p[j][0], dz = p[j + 1][1] - p[j][1], m = Math.hypot(dx, dz) || 1;
      const s = D - r.cum[k];
      return [p[k][0] + (dx / m) * s, p[k][1] + (dz / m) * s, Math.atan2(-dz, dx)];
    };
    const fetch = plan.find((q) => q.kind === "fetch");
    let entry: [number, number];
    if (dock) entry = [L.rear - 1.1, L.hw + 1.2];
    else if (fetch) { const s = this.spotFor(fetch), f = fetch.face ?? 0; entry = [s[0] + Math.cos(f) * 0.9, s[2] - Math.sin(f) * 0.9]; }
    else entry = [L.bedRear - 2, L.hw + 3];
    const place = (x: number, z: number, yaw: number, pose: BodyPose, attached: boolean) => {
      const y = terrain(x, z);
      this.mate.x = x; this.mate.y = y; this.mate.z = z; this.mate.yaw = yaw; this.mate.attached = attached;
      hp.root.visible = true;
      this.placeChar(hp, truck, x, y, z, yaw);
      hp.apply(pose);
    };
    const armsOn = (P: BodyPose) => { P.shLP = P.shRP = TEAM_BACK_ARM[0]; P.elL = P.elR = TEAM_BACK_ARM[1]; P.shLR = P.shRR = 0.12; return P; };
    // On a carry, or at the fetch or stow either side of it: holding the far end.
    for (const r of runs) {
      const [t0, t1] = span(r);
      if (tc < t0 || tc >= t1) continue;
      let D = -back, moving = false;
      if (idx >= r.i0 && idx <= r.i1) {
        const a = c.a!, b = c.b!, seg = Math.hypot(b[0] - a[0], b[2] - a[2]);
        D = r.cum[idx - r.i0] + seg * THREE.MathUtils.clamp(t / c.len, 0, 1) - back; moving = c.kind === "walk";
      } else if (idx > r.i1) D = r.cum[r.cum.length - 1] - back;
      const [x, z, yaw] = along(r, D);
      const P = moving ? walkPose((D + back) / STRIDE + 0.5, idlePose(this.time, this.tmpPose), false) : idlePose(this.time, this.tmpPose);
      place(x, z, yaw, armsOn(P), true);
      return;
    }
    // Between carries: from where the last one ended to where the next begins, arriving just in time.
    let prev: typeof runs[number] | null = null, next: typeof runs[number] | null = null;
    for (const r of runs) { const [t0, t1] = span(r); if (t1 <= tc) prev = r; else if (!next && t0 > tc) next = r; }
    const A: [number, number] = prev ? along(prev, prev.cum[prev.cum.length - 1] - back).slice(0, 2) as [number, number] : entry;
    const B: [number, number] = next ? along(next, -back).slice(0, 2) as [number, number] : entry;
    const tA = prev ? span(prev)[1] : 0, tB = next ? span(next)[0] : end(plan.length - 1);
    const route = this.teamRoute(L, dock, A, B);
    const legs: number[] = [];
    let len = 0;
    for (let k = 1; k < route.length; k++) { legs.push(Math.hypot(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1])); len += legs[k - 1]; }
    // Distance along the route at time tc. Out of the bed: straight away (ahead of the driver).
    // Into it: up to the ramp's foot first, then in only once the driver is inside, arriving as
    // the lift starts. Otherwise: arriving just in time.
    const inBed = (p: [number, number]) => p[0] >= L.bedRear - 0.05 && Math.abs(p[1]) < L.hw;
    const V = 1.7;
    const leg = (T: number, s0: number, s1: number, t0: number, t1: number) => s0 + (s1 - s0) * THREE.MathUtils.clamp((T - t0) / Math.max(0.01, t1 - t0), 0, 1);
    let sAt: (T: number) => number, done: boolean, begun: boolean;
    if (inBed(A) || !next) {
      const dur = Math.min(len / V, Math.max(0.01, tB - tA));
      sAt = (T) => leg(T, 0, len, tA, tA + dur); begun = tc > tA; done = tc >= tA + dur;
    } else if (inBed(B)) {
      let outLen = 0, j = 0;
      while (j < legs.length && !inBed(route[j + 1])) outLen += legs[j++];   // to where the route enters the bed
      let tIn = tB;
      for (let q = 0; q < plan.length && start[q] < tB; q++) { const b = plan[q].b; if (b && b[0] >= L.bedRear - 0.05 && Math.abs(b[2]) < L.hw && end(q) > tA) { tIn = end(q); break; } }
      const inLen = len - outLen;
      const t2 = Math.max(tIn, tB - inLen / V), t1 = Math.min(t2, tIn), t0 = Math.max(tA, t1 - outLen / V);
      sAt = (T) => T < t2 ? leg(T, 0, outLen, t0, t1) : leg(T, outLen, len, t2, tB); begun = tc > t0; done = tc >= tB;
    } else {
      const dur = Math.min(len / V, Math.max(0.01, tB - tA)), ts = Math.max(tA, tB - dur);
      sAt = (T) => leg(T, 0, len, ts, tB); begun = tc > ts; done = tc >= tB;
    }
    const sTot = sAt(tc);
    let s = sTot;
    if (!dock && ((!prev && !begun) || (!next && done))) { hp.root.visible = false; return; }   // indoors
    let i = 0;
    while (i < legs.length - 1 && s > legs[i]) { s -= legs[i]; i++; }
    const p0 = route[i], p1 = route[i + 1] ?? route[i], f = legs[i] ? Math.min(1, s / legs[i]) : 1;
    const x = p0[0] + (p1[0] - p0[0]) * f, z = p0[1] + (p1[1] - p0[1]) * f;
    const walking = Math.abs(sTot - sAt(tc - 0.1)) > 1e-3;   // not while waiting at the ramp's foot
    const yaw = walking ? Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]) : Math.atan2(-(this.drv[2] - z), this.drv[0] - x);   // waiting: watching the driver
    place(x, z, yaw, walking ? walkPose(sTot / STRIDE, idlePose(this.time, this.tmpPose)) : idlePose(this.time, this.tmpPose), false);
  }

  // How far behind the driver the worker walks on a carry: the load's length plus the two pairs
  // of hands (the driver's just behind, the worker's ahead).
  private teamBack(load: CarriedLoad) { return load.size[0] + teamHand(TEAM_BACK_ARM)[0] - teamHand(TEAM_FRONT_ARM)[0]; }
  private buildTeamRuns(plan: Chore[]) {
    this.teamPlan = plan; this.teamRuns = []; this.teamStart = [];
    let t = 0;
    for (const q of plan) { this.teamStart.push(t); t += q.len; }
    const carry = (q?: Chore) => !!q && (q.kind === "walk" || q.kind === "gateRide") && !!q.item && !!q.helper;
    const ends = (q?: Chore) => !!q && (q.kind === "fetch" || q.kind === "stow");
    for (let i = 0; i < plan.length; i++) {
      if (!carry(plan[i]) || carry(plan[i - 1])) continue;
      let i1 = i;
      while (carry(plan[i1 + 1])) i1++;
      const pts: [number, number][] = [[plan[i].a![0], plan[i].a![2]]], cum = [0];
      for (let k = i; k <= i1; k++) { const b = plan[k].b!, p = pts[pts.length - 1]; cum.push(cum[cum.length - 1] + Math.hypot(b[0] - p[0], b[2] - p[1])); pts.push([b[0], b[2]]); }
      this.teamRuns.push({ i0: i, i1, pre: ends(plan[i - 1]) ? i - 1 : -1, post: ends(plan[i1 + 1]) ? i1 + 1 : -1, pts, cum });
    }
  }
  // The worker's way between two points: by the walk ramp between the street and the bed, and
  // past the driver on the left inside it.
  private teamRoute(L: TruckLayout, dock: boolean, A: [number, number], B: [number, number]): [number, number][] {
    const inBed = (p: [number, number]) => p[0] >= L.bedRear - 0.05 && Math.abs(p[1]) < L.hw;
    const sill: [number, number] = [L.bedRear + 0.4, 0], foot: [number, number] = [L.bedRear - L.rampRun - 0.4, 0];
    const side = (p: [number, number]): [number, number] => [(sill[0] + p[0]) / 2, -0.75];
    const a = inBed(A), b = inBed(B);
    if (a === b) return a && Math.abs(A[0] - B[0]) > 1 ? [A, side(A[0] > B[0] ? A : B), B] : [A, B];
    if (dock) return b ? [A, sill, side(B), B] : [A, side(A), sill, B];
    return b ? [A, foot, sill, side(B), B] : [A, side(A), sill, foot, B];
  }
  // The load between the two carriers' hands: centred between them, tilted from one to the other.
  private teamLoad(truck: Truck, load: CarriedLoad) {
    const d = this.drv, m = this.mate;
    const fh = teamHand(TEAM_FRONT_ARM), bh = teamHand(TEAM_BACK_ARM);
    const hx = d[0] + Math.cos(d[3]) * fh[0], hz = d[2] - Math.sin(d[3]) * fh[0], hy = d[1] + fh[1];   // the driver's hands
    const gx = m.x + Math.cos(m.yaw) * bh[0], gz = m.z - Math.sin(m.yaw) * bh[0], gy = m.y + bh[1];     // the worker's hands
    const dx = hx - gx, dz = hz - gz, dy = hy - gy, flat = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(-dz, dx), pitch = Math.atan2(dy, flat);
    const grip = Math.min(load.size[1] / 2, 0.65);   // the hands this far up the load's ends
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const cx = (hx + gx) / 2 + fx * Math.sin(pitch) * grip, cz = (hz + gz) / 2 + fz * Math.sin(pitch) * grip, cy = (hy + gy) / 2 - Math.cos(pitch) * grip;
    truck.root.updateMatrixWorld();
    load.group.visible = true;
    load.group.position.set(cx, cy, cz).applyMatrix4(truck.root.matrixWorld);
    load.group.rotation.set(0, truck.heading + yaw, pitch, "YXZ");
  }

  // Seated at the wheel of `truck`.
  private seat(truck: Truck, pose: BodyPose) {
    const L = truckLayout(truck.model);
    this.inSeat = true;
    this.driver.apply(pose);
    this.place(truck, L.seat.x, L.seat.y - CHARACTER_HIP_Y, L.seat.z, 0);
    this.yaw = 0; this.yawV = 0;
  }

  // Climbing down from (or, reversed, up into) the cab: turn to the door, step onto the sill,
  // turn to face the cab, down the step, onto the ground.
  private climb(truck: Truck, t: number, len: number, up: boolean) {
    const L = truckLayout(truck.model);
    const k = (up ? len - t : t) / len;   // 0 seated .. 1 on the ground
    type Key = [number, number, number, number, number, BodyPose];   // k, x, y, z, yaw, pose
    const stand = restPose(), seated = seatedPose(restPose()), climbP = gesturePose("climb", 0, restPose());
    const sill = L.cabFloor;
    const keys: Key[] = [
      [0, L.seat.x, L.seat.y - CHARACTER_HIP_Y, L.seat.z, 0, seated],
      [0.25, L.doorX + 0.15, sill, -(L.cabHW - 0.3), Math.PI / 2, stand],
      [0.45, L.doorX + 0.15, sill, -(L.cabHW - 0.25), -Math.PI / 2, stand],
      [0.72, L.doorX + 0.05, 0.5, -(L.cabHW + 0.3), -Math.PI / 2, climbP],
      [0.9, L.doorX, 0, L.doorZ, -Math.PI / 2, stand],
      [1, L.doorX, 0, L.doorZ, -Math.PI / 2, stand],
    ];
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1][0] <= k) i++;
    const [k0, x0, y0, z0, w0, p0] = keys[i], [k1, x1, y1, z1, w1, p1] = keys[i + 1];
    const f = THREE.MathUtils.smoothstep(k, k0, k1);
    this.driver.apply(blendPose(p0, p1, f, this.pose));
    const yaw = w0 + wrapYaw(w1 - w0) * f;
    this.place(truck, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f, yaw);
    this.yaw = yaw; this.yawV = 0;
  }

  // The truck change at a country truck stop, `t` seconds into the stop; the journey hands over
  // to the spare at `half`. Before it, `truck` is the old one and `other` the spare; after it,
  // `truck` is the new one.
  private truckStopSwap(t: number, half: number, truck: Truck, other: Truck | null, k: { cab: number; otherCab: number }) {
    const CL = 2.6, swing = (x: number) => THREE.MathUtils.smoothstep(x, 0, 0.2) * (1 - THREE.MathUtils.smoothstep(x, 0.85, 1));
    if (t < CL) { this.climb(truck, t, CL, false); k.cab = swing(t / CL); return; }
    if (t < half) {
      if (!other) { this.climb(truck, CL, CL, false); return; }
      const a = truck.anchors.cabDoorGround.getWorldPosition(this.v), b = other.anchors.cabDoorGround.getWorldPosition(this.v2);
      const walkLen = Math.max(0.5, half - CL - 0.6), u = THREE.MathUtils.clamp((t - CL) / walkLen, 0, 1);
      const p = a.lerp(b, u * u * (3 - 2 * u)), walking = u < 1;
      this.driver.apply(walking ? walkPose((t - CL) * 1.4 / STRIDE, idlePose(this.time, this.pose)) : idlePose(this.time, this.pose));
      this.yaw = truck.heading; this.yawV = 0;
      this.driver.root.position.copy(p);
      this.driver.root.rotation.set(0, this.yaw, 0);
      return;
    }
    if (t < half + CL) { this.climb(truck, t - half, CL, true); k.cab = swing(1 - (t - half) / CL); return; }
    this.seat(truck, seatedPose(this.pose, 0));
  }

  // Walking from the old truck's door to the new one's (world space; the camera follows the
  // same point, see swapWalkPoint).
  private swapWalk(j: Journey, oldT: Truck, newT: Truck, t: number, len: number, dt: number) {
    const p = swapWalkPoint(j, oldT, newT, this.v);
    const walking = t < len - 1.5;
    const dist = t * WALK_SPEED_SWAP;
    this.driver.apply(walking ? walkPose(dist / STRIDE, idlePose(this.time, this.pose)) : gesturePose("clipboard", t, this.pose));
    // Face along the street towards the new truck, then turn to look it over.
    const target = walking ? oldT.heading : oldT.heading - Math.PI / 2 * 0.6;
    this.turnTo(target, dt);
    this.driver.root.position.copy(p);
    this.driver.root.rotation.set(0, this.yaw, 0);
  }

  // Chores on foot around the parked truck.
  private work(c: Chore, t: number, u: number, truck: Truck, dt: number, stop: Stop) {
    const d = this.driver, L = truckLayout(truck.model), P = this.pose;
    let x: number, y: number, z: number, yaw: number;
    if (c.kind === "walk" || c.kind === "gateRide") {
      const a = c.a!, b = c.b!;
      // Height under the feet at progress v of this walk (the ramp, stairs, a lift-gate ride).
      const yAt = (v: number) => c.kind === "gateRide" ? this.gateY(L, c.dir === "up" ? 1 - ease(u) : ease(u))
        : c.linear ? a[1] + (b[1] - a[1]) * v : this.groundY(L, a[0] + (b[0] - a[0]) * v, 0, a, b, v);
      x = a[0] + (b[0] - a[0]) * u; z = a[2] + (b[2] - a[2]) * u;
      y = yAt(u);
      // A team lift's back carrier walks the same line a load's length behind: on the ramp's
      // slope (or still up in the bed, or still on the street) while the driver is ahead.
      const span = Math.hypot(b[0] - a[0], b[2] - a[2]), back = 0.6 + (this.load?.size[0] ?? 1);
      this.feetY = y;
      this.helperFeetY = span > 0.01 ? yAt(Math.max(0, u - back / span)) : y;
      yaw = c.kind === "gateRide" ? Math.PI : Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
      const moving = c.kind === "walk";
      const dist = Math.hypot(b[0] - a[0], b[2] - a[2]) * u;
      this.walkPhase = dist / STRIDE;
      if (moving) walkPose(this.walkPhase, idlePose(this.time, P), !c.item && !c.tool);
      else idlePose(this.time, P);
      if (c.tool === "handTruck" && c.item) pushArms(P);
      else if (c.tool) pushArms(P);
      else if (c.item === "drum") lowArms(P);
      else if (c.item === "crate") pushArms(P);
      else if (c.item === "long") { liftArms(P); if (c.helper) { P.shLP = P.shRP = TEAM_FRONT_ARM[0]; P.elL = P.elR = TEAM_FRONT_ARM[1]; P.shLR = P.shRR = 0.12; } }   // leading, hands back on the load
      else if (c.item === "animal") {
        P.shRP = -0.5; P.elR = 0.3;                                   // leading by a rope behind
        if (this.firstAnimalWalk(c)) P.headY = 1.1 * Math.sin(THREE.MathUtils.clamp((u - 0.05) / 0.25, 0, 1) * Math.PI);  // double take
      }
      else if (c.item && stop.cargo === "trophy") { P.shLP = P.shRP = 2.9; P.elL = P.elR = 0.2; }   // proudly
      else if (c.item) carryArms(P);
      this.turnTo(yaw, dt, moving ? 0.12 : 0.25);
    } else if (c.kind === "rampOut" || c.kind === "rampIn") {
      // Holding the ramp's end, a step behind it: walking back as it slides out, bending as it is
      // set down (rampIn: lifting it and walking it back in).
      const r = rampControl(c.kind, u), tip = rampTip(L, r);
      x = tip[0] - RAMP_HOLD; y = 0; z = 0; yaw = 0;
      this.yaw = 0;
      const slid = Math.abs(tip[0] - L.bedRear);
      walkPose(slid / STRIDE, idlePose(this.time, P), false, r > 0.01 && r < 0.64 ? 0.6 : 0);
      handLevelPose(tip[1], P);
    } else if (c.kind === "doorOpen" || c.kind === "doorClose") {
      // At the door: the handle starts this far above the feet (low from the top of the ramp or
      // the platform, waist high from the street).
      const at = this.spotFor(c);
      x = at[0]; y = at[1]; z = at[2];
      yaw = 0;
      this.turnTo(yaw, dt, 0.25);
      // The hands hold the door's bottom edge, or its strap while that is out of reach: the
      // door's opening follows the hands, and the arms are solved to reach it.
      const g = truck.doorGeom();
      if (g) {
        // A step up to the middle of the door first, and back at the end.
        const T = u * c.len, w = ease(T / DOOR_STEP) * (1 - ease((T - c.len + DOOR_STEP) / DOOR_STEP));
        const sx = g.x - DOOR_STAND - x, sz = -z;
        x += sx * w; z += sz * w;
        this.doorNow = doorMotion(c.kind, T, c.len, x, y, g, idlePose(this.time, P));
        const far = Math.hypot(sx, sz);
        if (far > 0.05 && w > 0 && w < 1) {   // the legs take the step
          const step = T < c.len / 2 ? w : 2 - w, legs = walkPose(step / 2, { ...P }, false, Math.min(1, far / 0.35));
          P.hipL += legs.hipL; P.hipR += legs.hipR; P.knL += legs.knL; P.knR += legs.knR;
        }
      } else { idlePose(this.time, P); this.doorNow = doorControl(c.kind, u); }
    } else {
      // Stationary at one spot: where the previous walk ended.
      const at = this.spotFor(c);
      x = at[0]; y = at[1]; z = at[2];
      yaw = c.face ?? this.yaw;
      this.turnTo(yaw, dt, 0.25);
      const g = c.kind === "stow" || c.kind === "toolGet" || c.kind === "toolPut" ? "stow"
        : c.kind === "gateOut" || c.kind === "gateIn" || c.kind === "doorsOpen" || c.kind === "doorsClose" ? "reach"
        : c.kind === "fetch" ? "reach" : c.gesture ?? "clipboard";
      gesturePose(g, t, P);
    }
    d.apply(P);
    this.place(truck, x, y, z, this.yaw);
    this.drv[0] = x; this.drv[1] = y; this.drv[2] = z; this.drv[3] = this.yaw;
    this.mate.attached = false;
    if (CARGO_BY_ID.get(stop.cargo)?.handling === "teamLift") this.teamMate(c, t, truck, stop);
    this.props(c, t, u, truck, stop);
  }

  // ---- the dock worker and the forklift ---------------------------------------------------------
  // At a dock the worker waves the truck back from the platform, then stands by the door with a
  // clipboard (box trucks; props() borrows them for team lifts) or drives the forklift
  // (tractor-trailers). At a kerb stop with a flatbed or a tractor-trailer the worker forklifts
  // the load across from the facility side. Positions are in the truck's frame once it is
  // parked, and in the bay's frame while it reverses.
  private worker(j: Journey, truck: Truck, stop: Stop | undefined) {
    const st = j.st, hp = this.helper;
    if (!stop || stop.kind === "swap" || stop.kind === "depart") return;
    const L = truckLayout(truck.model), P = DOCK_PLATFORM;
    const dock = j.dockPlan(stop);
    const marshal: [number, number, number] = [L.rear - 0.7, P, L.hw + 1.3];
    if (st.mode === "reverse" && dock) {
      // On the platform beside the bay, waving the truck back.
      const ox = Math.cos(dock.H), oz = -Math.sin(dock.H), rx = Math.sin(dock.H), rz = Math.cos(dock.H);
      const ax = marshal[0] - L.rear, az = marshal[2];
      hp.root.visible = true;
      hp.root.position.set(dock.edge.x + ox * ax + rx * az, P, dock.edge.z + oz * ax + rz * az);
      hp.root.rotation.set(0, dock.H, 0);
      hp.apply(gesturePose("wave", this.time, this.tmpPose));
      return;
    }
    if (st.mode !== "dwell") return;
    const ph = j.dwellPhase();
    const fork = this.forkTrip(L, dock !== null, stop, truck.model, this.tripNow(j, stop));
    if (fork && !dock && j.stackMode && j.kerbDoor) { this.stackTrip(j, truck, stop, L, j.kerbDoor, ph, j.stackMode); return; }
    if (!fork) {
      if (!dock) return;
      // Box truck at a dock: by the door with a clipboard (team lifts move them in props()).
      hp.root.visible = true;
      this.placeChar(hp, truck, marshal[0] - 0.4, P, marshal[2] - 0.1, Math.PI / 2 + 0.4);
      hp.apply(gesturePose("clipboard", this.time, this.tmpPose));
      return;
    }
    // Forklift: parked at A, one trip to B and back per forklift wait.
    const c = ph.chore, u = c?.forklift ? THREE.MathUtils.clamp(ph.ct / c.len, 0, 1) : 0;
    const pickup = stop.kind === "pickup";
    const k = c?.forklift ? (u < 0.4 ? ease(u / 0.4) : u < 0.5 ? 1 : u < 0.9 ? 1 - ease((u - 0.5) / 0.4) : 0) : 0;
    const [A, B, yaw, lift, travel, reach] = [fork.A, fork.B, fork.yaw, fork.lift, fork.travel, fork.reach];
    this.forks.scale.x = reach > 0.6 ? (reach + 0.4) / 1.13 : 1;   // long tines to reach across a flatbed's deck
    // At a flatbed with a front door, the forklift lives inside: out through the door (forks
    // first, load and all) and round to the deck's side, and back in; hidden while parked inside.
    const kd = !dock && L.flatbed ? j.kerbDoor : null;
    if (kd && k < 0.004) return;
    let fy = travel + (lift - travel) * THREE.MathUtils.smoothstep(k, kd ? 0.8 : 0.55, 1);
    if (c?.forklift && u >= 0.4 && u < 0.5) fy += (pickup ? -1 : 1) * 0.06 * ((u - 0.4) / 0.1);   // set down / pick up
    else if (c?.forklift && u >= 0.5 && u < 0.9 && !pickup) fy += 0.06;
    truck.root.updateMatrixWorld();
    const fl = this.forklift;
    fl.visible = true;
    if (kd) {
      // A cubic from inside the doorway (deep enough to hide the load: it rides ahead of the
      // forks), straight out of the door, to the deck's side, arriving square to the truck.
      const along = this.load ? (fork.across ? this.load.size[2] : this.load.size[0]) : 1.2;
      const [p0, p1, p2, p3] = this.fp, out = reach + along / 2 + 0.3;
      p3.set(B[0], 0, B[2]).applyMatrix4(truck.root.matrixWorld);
      p2.set(p3.x + Math.sin(truck.heading) * 2.5, 0, p3.z + Math.cos(truck.heading) * 2.5);
      p0.set(kd.x - kd.nx * out, 0, kd.z - kd.nz * out);
      p1.set(kd.x + kd.nx * 1.5, 0, kd.z + kd.nz * 1.5);
      const m = 1 - k, b0 = m * m * m, b1 = 3 * m * m * k, b2 = 3 * m * k * k, b3 = k * k * k;
      fl.position.set(p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3, 0, p0.z * b0 + p1.z * b1 + p2.z * b2 + p3.z * b3);
      const t0 = 3 * m * m, t1 = 6 * m * k, t2 = 3 * k * k;
      const dx = (p1.x - p0.x) * t0 + (p2.x - p1.x) * t1 + (p3.x - p2.x) * t2, dz = (p1.z - p0.z) * t0 + (p2.z - p1.z) * t1 + (p3.z - p2.z) * t2;
      fl.rotation.set(0, Math.atan2(-dz, dx), 0);   // forks along the way it goes out
      this.forkDoor = c?.forklift ? THREE.MathUtils.smoothstep(u, 0, 0.06) * (1 - THREE.MathUtils.smoothstep(u, 0.86, 0.9)) : 0;
    } else {
      const x = A[0] + (B[0] - A[0]) * k, y = A[1], z = A[2] + (B[2] - A[2]) * k;
      this.v.set(x, y, z).applyMatrix4(truck.root.matrixWorld);
      fl.position.copy(this.v); fl.rotation.set(0, truck.heading + yaw, 0);
    }
    this.forks.position.y = fy;
    // At a dock the worker walks from where they waved the truck in to the forklift first.
    const walkIn = dock && ph.phase === "park";
    hp.root.visible = true;
    if (walkIn) {
      const w = THREE.MathUtils.clamp(ph.t / (ph.len * 0.85), 0, 1);
      const sx = marshal[0] + (A[0] - 1.2 - marshal[0]) * w, sz = marshal[2] + (A[2] + 0.9 - marshal[2]) * w;
      this.placeChar(hp, truck, sx, P, sz, Math.atan2(-(A[2] + 0.9 - marshal[2]), A[0] - 1.2 - marshal[0]));
      hp.apply(w < 1 ? walkPose(w * 6 / STRIDE, idlePose(this.time, this.tmpPose)) : idlePose(this.time, this.tmpPose));
    } else {
      fl.updateMatrixWorld();
      this.v.set(-1.2, 1.06 - CHARACTER_HIP_Y, 0).applyMatrix4(fl.matrixWorld);
      hp.root.position.copy(this.v); hp.root.rotation.set(0, fl.rotation.y, 0);
      hp.apply(seatedPose(this.tmpPose, 0));
    }
    // The load on the forks: to the truck on a pickup, back from it on a drop.
    const carrying = c?.forklift ? (pickup ? u < 0.5 : u >= 0.5 && u < 0.95) : false;
    const load = this.load;
    if (carrying && load) {
      fl.updateMatrixWorld();
      load.group.visible = true;
      // On blocks, the bundle's underside rests on the tines (5 cm thick) between them.
      const dn = CARGO_MODELS[stop.cargo]?.dunnage, ly = dn ? fy + 0.05 - dn : fy + 0.06;
      load.group.position.set(reach, ly, 0).applyMatrix4(fl.matrixWorld);
      load.group.rotation.set(0, fl.rotation.y - (fork.across ? Math.PI / 2 : 0), 0);
      load.animate?.(this.time);
      if (CARGO_BY_ID.get(stop.cargo)!.tier === "humorous") this.gagPoint = this.gagV.copy(load.group.position).setY(load.group.position.y + load.size[1] * 0.6);
    }
  }

  // ---- the bundle stack ---------------------------------------------------------------------
  // Bundles (lumber, pipe) ride across the forks, too wide for a door, so at the kerb they go to
  // and from a stack (journey.ts stackMode): in the yard beside an industrial facility's end-on
  // container, one column, the forklift backing off the deck, turning round and driving up to it
  // (yardLegs); or on the pavement just behind the truck, the forklift unloading it from the road
  // side and coming round its back (roadLegs: traffic waits, life.ts). One bundle a trip. The
  // stack and its forklift, parked, stay when the truck leaves (`yard`: world space, saved), and
  // are there before it arrives.
  private yard: { city: number; x: number; y: number; z: number; h: number; sx: number; sz: number; count: number; n: number; cargo: string;
    fx: number; fy: number; fz: number; fyaw: number; fork: number } | null = null;
  private stack: THREE.Mesh | null = null; private stackKey = "";
  private parkedForklift!: THREE.Group; private parkedForks!: THREE.Group;
  private stackWorking = false;   // this frame, the forklift is working the stack (stackTrip)
  private aheadPath: object | null = null;   // the drive whose stop's stack is already placed (yardProps)

  // A stop's stack in the truck's frame (parked at x, z, h), from the door: the building's front,
  // the kerb, the column (sx) and its depth (sz), and per trip the bed unit it moves and the layer
  // it goes to or comes from. The trips are the chores' (chores.ts tripCount, tripUnits: one
  // bundle each): drops take the bed's last unit first, onto the stack; pickups fill the bed in
  // order, from the top of a stack that starts full.
  private stackPlan(L: TruckLayout, model: TruckModel, stop: Stop, door: KerbDoor, x: number, z: number, h: number, mode: "yard" | "road") {
    const fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    const px = door.x - x, pz = door.z - z, dx = px * fx + pz * fz, front = px * rx + pz * rz;
    // The yard's column: opposite the bed's middle (the truck stops clear of the container:
    // journey.ts YARD_PULL), but never beside the container.
    const mid = (L.bedRear + L.bedFront) / 2, s = Math.sign(mid - dx) || 1, clear = dx + s * (END_ON_HALF + 0.4 + CARGO_MODELS[stop.cargo].size[0] / 2);
    const sx = mode === "road" ? L.rear - 2.4 : s > 0 ? Math.max(mid, clear) : Math.min(mid, clear);
    const units = bedUnits(L, model, stop.cargo, stop.units, stop.slot ?? 0), pickup = stop.kind === "pickup";
    const n = units.length ? tripCount(L, stop.cargo, stop.units) : 0;
    const trips = Array.from({ length: n }, (_, i) => ({ u: Math.min(units.length - 1, tripUnits(stop, n, i)[0]), layer: pickup ? n - 1 - i : i }));
    return { mode, s, front, kerb: front - KERB, sx, sz: mode === "yard" ? front + 4.5 : front - 0.55, units, trips };
  }
  private stackLegs(L: TruckLayout, P: ReturnType<Crew["stackPlan"]>, i: number, mh: number, pickup: boolean) {
    const T = P.trips[i], unit = P.units[T.u], sy = CURB_H + T.layer * (mh + 0.005);
    return P.mode === "yard" ? yardLegs(L, P, unit[0], unit[1], sy, pickup)
      : roadLegs(L, P, unit[0], unit[1], sy, pickup, i === 0, i === P.trips.length - 1);
  }

  private stackTrip(j: Journey, truck: Truck, stop: Stop, L: TruckLayout, door: KerbDoor, ph: DwellNow, mode: "yard" | "road") {
    const pickup = stop.kind === "pickup", m = CARGO_MODELS[stop.cargo], mh = m.size[1], tp = truck.root.position;
    const P = this.stackPlan(L, truck.model, stop, door, tp.x, tp.z, truck.heading, mode), n = P.trips.length;
    if (!n) return;
    // Which trip, and how far into it (between trips: where the last one ended).
    const waits = j.chores.filter((q) => q.kind === "wait" && !!q.forklift), c = ph.chore;
    const idx = c ? j.chores.indexOf(c) : ph.phase === "close" || ph.phase === "enter" || ph.phase === "startup" ? j.chores.length : -1;
    const i = waits.filter((q) => j.chores.indexOf(q) < idx).length, inTrip = !!c?.forklift;
    const ti = Math.min(n - 1, inTrip ? i : Math.max(0, i - 1)), t = inTrip ? THREE.MathUtils.clamp(ph.ct, 0, c!.len) : i === 0 ? 0 : Infinity;
    const p = legsAt(this.stackLegs(L, P, ti, mh, pickup), t);
    // The stack now: whole trips done, and this one's bundle once it's taken (pickup) or given (drop).
    const done = Math.min(i, n) + (inTrip && i < n && (pickup ? p.took : p.gave) ? 1 : 0);
    // The forklift, in the truck's frame (up the kerb when on it), into the world.
    truck.root.updateMatrixWorld();
    const fl = this.forklift, ry = CURB_H * THREE.MathUtils.smoothstep(p.cz, P.kerb - 0.5, P.kerb + 0.5);
    this.v.set(p.x, ry, p.z).applyMatrix4(truck.root.matrixWorld);
    fl.visible = true; fl.position.copy(this.v); fl.rotation.set(0, truck.heading + p.yaw, 0);
    this.forks.position.y = p.fy; this.forks.scale.x = LONG_TINES;
    this.stackWorking = true;
    this.yard = { city: j.st.city, x: tp.x, y: tp.y, z: tp.z, h: truck.heading, sx: P.sx, sz: P.sz, count: pickup ? n - done : done, n, cargo: stop.cargo,
      fx: fl.position.x, fy: fl.position.y, fz: fl.position.z, fyaw: fl.rotation.y, fork: p.fy };
    // The worker in the seat, and the bundle on the forks.
    const hp = this.helper;
    fl.updateMatrixWorld();
    this.v.set(-1.2, 1.06 - CHARACTER_HIP_Y, 0).applyMatrix4(fl.matrixWorld);
    hp.root.visible = true; hp.root.position.copy(this.v); hp.root.rotation.set(0, fl.rotation.y, 0);
    hp.apply(seatedPose(this.tmpPose, 0));
    const load = this.load;
    if (inTrip && p.took && !p.gave && load) {
      load.group.visible = true;
      load.group.position.set(L.hw + 0.15, p.fy + 0.05 - (m.dunnage ?? 0), 0).applyMatrix4(fl.matrixWorld);
      load.group.rotation.set(0, fl.rotation.y - Math.PI / 2, 0);
    }
  }

  // The stack and its parked forklift, wherever the last stacking stop left them (or, ahead of
  // one, where they will be: placed once per drive), while the truck is in the same city and near.
  private yardProps(j: Journey, truck: Truck) {
    const st = j.st;
    if ((st.mode !== "dwell" || !j.stackMode) && j.path && j.path !== this.aheadPath) {
      const ahead = j.stackAhead();
      if (ahead) {
        this.aheadPath = j.path;
        const stop = st.stops[0], L = truckLayout(st.truck), pickup = stop.kind === "pickup", ap = ahead.pose;
        const P = this.stackPlan(L, st.truck, stop, ahead.door, ap.x, ap.z, ap.h, ahead.mode), n = P.trips.length;
        if (n) {
          const p = legsAt(this.stackLegs(L, P, 0, CARGO_MODELS[stop.cargo].size[1], pickup), 0), h = ap.h;
          const ry = CURB_H * THREE.MathUtils.smoothstep(p.cz, P.kerb - 0.5, P.kerb + 0.5);
          this.yard = { city: st.city, x: ap.x, y: ahead.y, z: ap.z, h, sx: P.sx, sz: P.sz, count: pickup ? n : 0, n, cargo: stop.cargo,
            fx: ap.x + Math.cos(h) * p.x + Math.sin(h) * p.z, fy: ahead.y + ry, fz: ap.z - Math.sin(h) * p.x + Math.cos(h) * p.z, fyaw: h + p.yaw, fork: p.fy };
        }
      }
    }
    if (this.yard && (this.yard.city !== st.city || Math.hypot(truck.root.position.x - this.yard.x, truck.root.position.z - this.yard.z) > 250)) this.yard = null;
    const Y = this.yard;
    // (Rebuilt when its bundles change; placed every frame.)
    const key = Y ? `${Y.cargo}|${Y.n}|${Y.count}|${Y.sx}|${Y.sz}` : "";
    if (key !== this.stackKey) {
      this.stackKey = key;
      if (this.stack) { this.stack.removeFromParent(); this.stack.geometry.dispose(); this.stack = null; }
      if (Y && Y.count > 0) {
        const m = CARGO_MODELS[Y.cargo], b = new Batch();
        // (Layer k holds the stop's unit n - 1 - k, either way: stackPlan; coloured as in the bed.)
        for (let k = 0; k < Y.count; k++) m.build(b, Y.sx, CURB_H + k * (m.size[1] + 0.005), Y.sz, Y.n - 1 - k);
        const mesh = b.build(this.material);
        if (mesh) { this.scene.add(mesh); this.stack = mesh; }
      }
    }
    if (this.stack && Y) { this.stack.position.set(Y.x, Y.y, Y.z); this.stack.rotation.set(0, Y.h, 0); }
    // Parked by the stack unless it's the one working it this frame (the other may be busy elsewhere).
    const pf = this.parkedForklift;
    pf.visible = !!Y && !this.stackWorking;
    if (Y && pf.visible) {
      pf.position.set(Y.fx, Y.fy, Y.fz); pf.rotation.set(0, Y.fyaw, 0);
      this.parkedForks.position.y = Y.fork; this.parkedForks.scale.x = LONG_TINES;
    }
  }
  // When in a stop's stacking trip i the bundle leaves or reaches the truck's deck (bedView): the
  // end of its leg at the truck.
  private stackTruckAt(j: Journey, truck: Truck, stop: Stop, i: number) {
    const L = truckLayout(truck.model), tp = truck.root.position;
    const P = this.stackPlan(L, truck.model, stop, j.kerbDoor!, tp.x, tp.z, truck.heading, j.stackMode!);
    if (!P.trips.length) return 0;
    let t = 0;
    for (const g of this.stackLegs(L, P, Math.min(i, P.trips.length - 1), CARGO_MODELS[stop.cargo].size[1], stop.kind === "pickup")) { t += g.d; if (g.truck) return t; }
    return t;
  }

  // Where the forklift works for this stop (truck frame), or null when it isn't needed.
  // `reach`: from the fork heels to the load's middle along the forks; `across`: the load lies
  // across the forks (a flatbed's bundles, along the truck), not along them.
  private forkTrip(L: TruckLayout, docked: boolean, stop: Stop, model: TruckModel, trip: { i: number; trips: number }) {
    const P = DOCK_PLATFORM;
    if (docked && L.trailer)   // into the trailer across the platform from inside the building
      return { A: [L.rear - 8.5, P, 0] as const, B: [L.rear + 2.6, P, 0] as const, yaw: 0, lift: 0.1, travel: 0.12, reach: 0.6, across: false };
    if (docked) return null;
    if (L.flatbed) {
      // Square to the deck's side, at this trip's unit (chores.ts bedUnits), forks under it and
      // reaching across to its middle; on blocks, the forks go in between them.
      const [u0, u1] = tripUnits(stop, Math.max(1, trip.trips), trip.i);
      const ps = bedUnits(L, model, stop.cargo, stop.units, stop.slot ?? 0).slice(u0, Math.max(u0 + 1, u1));
      const x = ps.length ? ps.reduce((a, p) => a + p[0], 0) / ps.length : (L.bedRear + L.bedFront) / 2;
      const y = ps.length ? Math.min(...ps.map((p) => p[1])) : L.floor, z = ps.length ? ps[0][2] : 0;
      const heel = L.hw + 0.15, dn = CARGO_MODELS[stop.cargo]?.dunnage;
      return { A: [x, 0, L.hw + 5.2] as const, B: [x, 0, heel] as const, yaw: Math.PI / 2, lift: dn ? y + 0.05 : L.floor + 0.05, travel: 0.15,
        reach: heel - z, across: true };
    }
    if (L.trailer)             // from behind, up to the trailer's floor at its open doors
      return { A: [L.rear - 7, 0, 0] as const, B: [L.rear - 0.25, 0, 0] as const, yaw: 0, lift: L.floor + 0.05, travel: 0.15, reach: 0.6, across: false };
    return null;
  }

  private placeChar(ch: Character, truck: Truck, x: number, y: number, z: number, yaw: number) {
    truck.root.updateMatrixWorld();
    this.v.set(x, y, z).applyMatrix4(truck.root.matrixWorld);
    ch.root.position.copy(this.v);
    ch.root.rotation.set(0, truck.heading + yaw, 0);
  }

  // What the bed shows during a stop: the ledger, with this stop's units appearing (pickup) or
  // leaving (drop) trip by trip as the driver stows them, rather than all at once when the
  // ledger changes halfway through.
  private bedView(j: Journey, truck: Truck, stop: Stop): Aboard[] {
    const ph = j.dwellPhase();
    const steps = j.chores.filter((c) => c.kind === "stow" || (c.kind === "wait" && !!c.forklift));
    let done = 0;
    if (ph.phase === "close" || ph.phase === "enter" || ph.phase === "startup") done = steps.length;
    else if (ph.chore) {
      const idx = j.chores.indexOf(ph.chore);
      // A load lands in the bed when it is set down (pickup) and leaves it as it is lifted (drop):
      // late in a stow, early in a drop's; halfway through a forklift trip, as it lets go or lifts (worker).
      const pickup = stop.kind === "pickup";
      const stacking = !!j.stackMode && !!j.kerbDoor;
      const at = (c: Chore) => c.kind === "wait" ? (stacking ? this.stackTruckAt(j, truck, stop, steps.indexOf(c)) : c.len * 0.5) : pickup ? c.len * 0.97 : c.len * 0.03;
      for (const c of steps) { const k = j.chores.indexOf(c); if (k < idx || (k === idx && ph.ct > at(c))) done++; }
    }
    // Trip by trip, exactly what each trip carries (chores.ts tripUnits).
    const moved = steps.length ? Math.min(stop.units, done * Math.ceil(stop.units / steps.length)) : stop.units;
    const key = siteKey(stop.site!);
    const c = CARGO_BY_ID.get(stop.cargo)!;
    if (stop.kind === "pickup") {
      const base = j.st.aboard.filter((a) => a.job !== stop.job);
      const units = moved;
      return units > 0 ? [...base, { job: stop.job, cargo: c.id, units, slotsPerUnit: c.slots, dest: "", slot: stop.slot ?? 0 }] : base;
    }
    const base = j.st.aboard.filter((a) => !(a.job === stop.job && a.dest === key));
    const units = stop.units - moved;
    return units > 0 ? [...base, { job: stop.job, cargo: c.id, units, slotsPerUnit: c.slots, dest: key, slot: stop.slot ?? 0 }] : base;
  }

  // Build the current stop's carried load (and herd) when the cargo changes; clear spilled
  // ducks when the stop ends.
  private prepareCargo(stop: Stop | null, j: Journey) {
    const id = stop?.cargo ?? "";
    if (!stop) { for (const dk of this.ducks) dk.removeFromParent(); this.ducks.length = 0; this.duckMarks.clear(); }
    if (!id) { this.load = null; return; }
    // Built for the units on the current trip (a stack's height follows them).
    const trip = this.tripNow(j, stop!), [u0, u1] = tripUnits(stop!, Math.max(1, trip.trips), trip.i);
    // (Each unit coloured as it is in the bed: chores.ts bedUnits, loads.ts BedLoad.)
    const key = `${id}|${Math.max(1, u1 - u0)}|${u0}`;
    let load = this.loads.get(key);
    if (!load) {
      load = buildCarried(id, this.material, Math.max(1, u1 - u0), u0); load.group.visible = false; this.scene.add(load.group);
      // Keep the last few loads built (a stop's trips reuse them); older ones give back their geometry.
      for (const [k, old] of this.loads) {
        if (this.loads.size < 8) break;
        if (old === this.load) continue;
        old.group.removeFromParent();
        old.group.traverse((o: any) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
        this.loads.delete(k);
      }
      this.loads.set(key, load);
    }
    this.load = load;
    const c = CARGO_BY_ID.get(id)!;
    if (c.handling === "walkOn" && this.herd?.id !== id) {
      this.herd?.dispose();
      this.herd = new Herd(id, id === "goats" ? Math.min(5, Math.max(3, stop!.units)) : 1, this.material, this.scene);
    }
  }

  private firstAnimalWalk(c: Chore) { return this.plan.find((p) => p.kind === "walk" && p.item === "animal") === c; }

  // Where a stationary chore happens: the end of the walk before it in the plan.
  private spotFor(c: Chore): [number, number, number] {
    const i = this.plan.indexOf(c);
    for (let k = i - 1; k >= 0; k--) { const p = this.plan[k]; if (p.b) return p.b; }
    return [0, 0, 0];
  }

  // Tools and loads in the driver's hands (placed in the driver's frame).
  private props(c: Chore, t: number, u: number, truck: Truck, stop: Stop) {
    const r = this.driver.root;
    r.updateMatrixWorld();
    let item = c.item ?? null;
    // Stowing: the load stays in view the whole time, moving between the hands (or the hand
    // truck) and its spot on the bed floor; `stowK` is how far it is from the hands to the floor.
    let stowK = -1;
    if (c.kind === "stow") {
      const i = this.plan.indexOf(c), prev = this.plan[i - 1], next = this.plan[i + 1];
      item = prev?.item ?? next?.item ?? null;
      const k = THREE.MathUtils.smoothstep(t / c.len, 0.15, 0.85);
      if (item) stowK = prev?.item ? k : 1 - k;
    }
    const cargo = CARGO_BY_ID.get(stop.cargo)!, load = this.load;
    const humorous = cargo.tier === "humorous";
    // At the facility door the load simply appears in the driver's hands halfway through the reach
    // (a pickup), or is handed over and gone (a delivery); the driver stays in view throughout.
    if (c.kind === "fetch" && cargo.handling !== "walkOn") {
      const i = this.plan.indexOf(c), prev = this.plan[i - 1], next = this.plan[i + 1];
      if (next?.item && t > c.len * 0.5) item = next.item;
      else if (prev?.item && t < c.len * 0.5) item = prev.item;
    }
    // Place the load group in the driver's frame (x forward, z right), with an extra yaw/roll.
    const put = (x: number, y: number, z: number, yaw = 0, roll = 0) => {
      if (!load) return;
      load.group.visible = true;
      load.group.position.set(x, y, z).applyMatrix4(r.matrixWorld);
      load.group.rotation.set(0, r.rotation.y + yaw, roll, "YXZ");
      load.animate?.(this.time);
    };
    // The tool in hand: the chore's, or the one being taken from (or put back in) the bed.
    const stopTool = STYLE[cargo.handling].tool ?? null;
    const transfer = c.kind === "toolGet" || c.kind === "toolPut";
    const held = c.tool ?? (transfer ? stopTool : null);
    this.toolHeld = held;
    if (held === "handTruck") {
      const h = this.tools.handTruck; h.visible = true;
      h.position.set(0.95, 0, 0).applyMatrix4(r.matrixWorld); h.rotation.set(0, r.rotation.y, 0.42);
      if (item && load) {
        load.group.visible = true; load.group.position.copy(h.position); load.group.rotation.copy(h.rotation);
        load.group.translateX(0.06 + load.size[0] / 2); load.group.translateY(0.05);
      }
    } else if (held === "palletJack") {
      const h = this.tools.palletJack; h.visible = true;
      h.position.set(0.55, 0, 0).applyMatrix4(r.matrixWorld); h.rotation.set(0, r.rotation.y, 0);
      if (item && load) {
        load.group.visible = true; load.group.position.copy(h.position); load.group.rotation.copy(h.rotation);
        load.group.translateX(0.8); load.group.translateY(0.08);
        if (stop.cargo === "ducks" && c.kind === "walk") this.spillDucks(c, u, load.group);
      }
    } else if (item && load) {
      const [l, hh, w] = load.size;
      switch (cargo.handling) {
        case "roll": {
          const rad = hh / 2, dist = this.walkPhase * STRIDE;
          put(0.35 + l / 2, 0, 0, 0, -dist / rad);
          if (load.group.children[0]) load.group.children[0].position.y = -rad;
          load.group.position.y += rad;
          break;
        }
        case "push": put(0.4 + l / 2, 0, 0); break;
        case "teamLift":
          if (this.mate.attached) this.teamLoad(truck, load);   // between the two carriers' hands
          else put(0.3 + l / 2, 0.5, 0);
          break;
        case "walkOn": this.walkHerd(c, u, truck); break;
        case "flatbed": case "tow": break;
        default:
          if (stop.cargo === "trophy") put(0.1, 1.95, 0);
          else if (stop.cargo === "envelope") put(0.45, 1.0, 0.1);
          else if (l > 0.6) put(0.22 + w / 2, Math.max(0.15, 1.1 - hh / 2), 0, Math.PI / 2);   // long side across the body
          else put(0.22 + l / 2, Math.max(0.15, 1.1 - hh / 2), 0);
      }
    }
    // Taking the tool from the bed or putting it back: it moves between its stowed spot and the
    // driver's hands through the reach.
    if (transfer && held) {
      const h = this.tools[held], r = c.rest ?? toolStore(truckLayout(truck.model), held), at = r.at;
      truck.root.updateMatrixWorld();
      this.v.set(at[0], at[1], at[2]).applyMatrix4(truck.root.matrixWorld);
      this.qa.setFromEuler(this.eu.set(0, truck.heading + r.yaw, 0));
      const k = c.kind === "toolGet" ? THREE.MathUtils.smoothstep(t / c.len, 0.3, 0.75) : 1 - THREE.MathUtils.smoothstep(t / c.len, 0.25, 0.7);
      h.position.lerpVectors(this.v, h.position, k);
      h.quaternion.slerpQuaternions(this.qa, h.quaternion.clone(), k);
    }
    // Setting the load down exactly where the bed shows it (or lifting it from there): the trip's
    // units in the bed (chores.ts bedUnits), so nothing jumps when the bed takes over. The bed
    // shows them from late in a pickup's stow (early in a drop's), and the carried copy goes then.
    if (stowK >= 0 && load && load.group.visible && cargo.handling !== "walkOn" && cargo.handling !== "flatbed" && cargo.handling !== "tow") {
      const L = truckLayout(truck.model), trips = this.plan.filter((q) => q.kind === "stow").length;
      const ti = this.plan.filter((q, k) => q.kind === "stow" && k < this.plan.indexOf(c)).length;
      const [u0, u1] = tripUnits(stop, Math.max(1, trips), ti);
      const ps = bedUnits(L, truck.model, stop.cargo, stop.units, stop.slot ?? 0).slice(u0, u1);
      if (ps.length) {
        const n = ps.length;
        truck.root.updateMatrixWorld();
        this.v.set(ps.reduce((a, p) => a + p[0], 0) / n, Math.min(...ps.map((p) => p[1])) + (cargo.handling === "roll" ? load.size[1] / 2 : 0), ps.reduce((a, p) => a + p[2], 0) / n).applyMatrix4(truck.root.matrixWorld);   // a rolled load's group sits at its axle
        this.qa.setFromEuler(this.eu.set(0, truck.heading, 0, "YXZ"));
        load.group.position.lerp(this.v, stowK);
        load.group.quaternion.slerp(this.qa, stowK);
      }
      if (stop.kind === "pickup" ? t > c.len * 0.97 : t < c.len * 0.03) load.group.visible = false;
    }
    if (humorous && load?.group.visible) this.gagPoint = this.gagV.copy(load.group.position).setY(load.group.position.y + load.size[1] * 0.6);
  }

  // Walk-on cargo follows the driver in a line; on the first walk with goats, the last goat
  // breaks away for a lap round the driver before falling back in.
  private walkHerd(c: Chore, u: number, truck: Truck) {
    const herd = this.herd;
    if (!herd) return;
    const r = this.driver.root, n = herd.animals.length;
    const yaw = r.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const walking = c.kind === "walk";
    for (let i = 0; i < n; i++) {
      const back = 1.3 + herd.animals[i].size[0] / 2 + i * 1.05;
      let x = r.position.x - fx * back, z = r.position.z - fz * back, ay = yaw;
      if (herd.id === "goats" && i === n - 1 && n > 2 && this.firstAnimalWalk(c) && u > 0.15 && u < 0.85) {
        const k = (u - 0.15) / 0.7, a = k * Math.PI * 2, rad = 2.6 * Math.sin(k * Math.PI);
        x += Math.cos(yaw + a + Math.PI / 2) * rad; z -= Math.sin(yaw + a + Math.PI / 2) * rad;
        ay = yaw + a;
      }
      herd.pose(i, x, r.position.y, z, ay, this.walkPhase * 1.4 + i * 0.3, walking);
    }
    void truck;
    const lead = herd.animals[0].root;
    this.gagPoint = this.gagV.copy(lead.position).setY(lead.position.y + herd.animals[0].size[1] * 0.85);
  }

  // Rubber ducks drop off the crate along the way and stay where they land.
  private spillDucks(c: Chore, u: number, crate: THREE.Object3D) {
    const i = this.plan.indexOf(c);
    for (const mark of [0.3, 0.55, 0.8]) {
      const key = `${i}:${mark}`;
      if (u < mark || this.duckMarks.has(key)) continue;
      this.duckMarks.add(key);
      const dk = new THREE.Mesh(this.duckGeo, this.material);
      const a = (i * 7 + mark * 13) % 6.28;
      dk.position.set(crate.position.x + Math.cos(a) * 0.9, crate.position.y - 0.08, crate.position.z + Math.sin(a) * 0.9);
      dk.rotation.y = a * 2;
      this.scene.add(dk); this.ducks.push(dk);
    }
  }

  private stowItem(c: Chore, t: number): ItemKind | null {
    // Pickup: the load is in hand until it is set down halfway; drop: picked up halfway.
    const i = this.plan.indexOf(c), prev = this.plan[i - 1], next = this.plan[i + 1];
    if (prev?.item) return t < c.len / 2 ? prev.item : null;
    if (next?.item) return t > c.len / 2 ? next.item : null;
    return null;
  }

  // Ground height under the driver: on the walk ramp between its foot and the bed.
  private groundY(L: TruckLayout, x: number, _z: number, a: number[], b: number[], u: number) {
    if (a[1] === b[1]) return a[1];
    if (L.loader !== "ramp") return a[1] + (b[1] - a[1]) * u;
    const foot = L.bedRear - L.rampRun;
    if (x <= foot) return 0;
    if (x >= L.bedRear) return L.floor;
    return ((x - foot) / L.rampRun) * (L.floor - 0.12);
  }
  // Lift-gate platform height for a lowered amount (0 at bed level, 1 on the ground), matching Truck.
  private gateY(L: TruckLayout, lowered: number) { return L.floor + (0.06 - L.floor) * ease(lowered); }

  // How a chore moves the truck's parts, at progress u (1 = done).
  private choreControls(c: Chore, u: number, k: { cab: number; otherCab: number; rear: number; ramp: number; gate: number; drop: number; doors: number }, swap: boolean) {
    const swing = (x: number) => THREE.MathUtils.smoothstep(x, 0, 0.2) * (1 - THREE.MathUtils.smoothstep(x, 0.85, 1));
    switch (c.kind) {
      case "climbDown": k.cab = u < 1 ? swing(u) : 0; break;
      case "climbUp": if (swap) k.otherCab = u < 1 ? swing(1 - u) : 0; else k.cab = u < 1 ? swing(1 - u) : 0; break;
      case "doorOpen": case "doorClose": k.rear = doorControl(c.kind, u); break;
      case "rampOut": case "rampIn": k.ramp = rampControl(c.kind, u); break;
      case "gateOut": k.gate = Math.min(1, u * 2); k.drop = Math.max(0, u * 2 - 1); break;
      case "gateIn": k.drop = 1 - Math.min(1, u * 2); k.gate = 1 - Math.max(0, u * 2 - 1); break;
      case "gateRide": k.drop = c.dir === "up" ? 1 - ease(u) : ease(u); break;
      case "doorsOpen": k.doors = u; break;
      case "doorsClose": k.doors = 1 - u; break;
    }
  }

  private applyTruck(truck: Truck, other: Truck | null, k: { cab: number; otherCab: number; rear: number; ramp: number; gate: number; drop: number; doors: number }) {
    truck.cabDoor = k.cab; truck.rearDoor = k.rear; truck.ramp = k.ramp;
    truck.liftgate = k.gate; truck.liftgateDrop = k.drop; truck.trailerDoors = k.doors;
    if (other) other.cabDoor = k.otherCab;
  }

  private turnTo(target: number, dt: number, lag = 0.2) {
    const tgt = this.yaw + wrapYaw(target - this.yaw);
    [this.yaw, this.yawV] = springStepCrew(this.yaw, this.yawV, tgt, 1 / lag, dt);
  }

  // Place the driver in a truck's frame (x forward, y up, z right).
  private place(truck: Truck, x: number, y: number, z: number, yaw: number) {
    truck.root.updateMatrixWorld();
    this.v.set(x, y, z).applyMatrix4(truck.root.matrixWorld);
    this.driver.root.position.copy(this.v);
    this.driver.root.rotation.set(0, truck.heading + yaw, 0);
  }

  // Hide the driver's head when the camera is looking out through their eyes. (main.ts calls this
  // again just before drawing, with the camera where this frame has it: update runs before the
  // camera moves, so on its own it would go by wherever the last frame left the camera.)
  firstPerson(cam: THREE.Camera) {
    this.driver.root.updateWorldMatrix(true, false);   // (with its parents': the truck it sits in has moved since the last frame)
    this.v2.set(0, CHARACTER_HIP_Y + 0.74, 0).applyMatrix4(this.driver.root.matrixWorld);
    this.driver.headVisible = cam.position.distanceTo(this.v2) > 0.45;
  }
}

const WALK_SPEED_SWAP = 1.35;
const wrapYaw = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function springStepCrew(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const c1 = x - target, c2 = v + omega * c1, e = Math.exp(-omega * dt);
  return [target + (c1 + c2 * dt) * e, (c2 - omega * (c1 + c2 * dt)) * e];
}

// ---- opening and closing up -------------------------------------------------------------------
// The walk ramp's travel (Truck.ramp: 0 stowed, 0.65 slid out, 1 set down) over a rampOut chore:
// grab, slide it out, lower its end to the ground, let go. rampIn plays the same backwards.
function rampControl(kind: "rampOut" | "rampIn", u: number) {
  const v = kind === "rampOut" ? u : 1 - u;
  if (v < 0.12) return 0;
  if (v < 0.72) return 0.65 * THREE.MathUtils.smoothstep(v, 0.12, 0.72);
  return 0.65 + 0.35 * THREE.MathUtils.smoothstep(v, 0.72, 0.95);
}
// Where the ramp's end is for a ramp value (truck frame x, y), as Truck lays the ramp out.
function rampTip(L: TruckLayout, r: number): [number, number] {
  const len = L.floor > 1 ? 3.6 : 3.0, pivotY = L.floor - 0.16;
  const a = THREE.MathUtils.clamp(r / 0.65, 0, 1), b = THREE.MathUtils.clamp((r - 0.65) / 0.35, 0, 1);
  const th = Math.asin(Math.min(1, (pivotY - 0.02) / len)) * ease(b), hinge = L.bedRear + len * (1 - ease(a));
  return [hinge - len * Math.cos(th), pivotY - len * Math.sin(th) + 0.03];
}
// Both hands on something in front at height h (metres above the feet): from a waist-high grip
// (arms angled down) to a deep crouch at the ground.
function handLevelPose(h: number, P: BodyPose): BodyPose {
  const k = THREE.MathUtils.clamp((1.0 - h) / 0.9, 0, 1);
  P.bend = -0.12 - 0.62 * k; P.drop += 0.3 * k;   // legs: a crouch on top of whatever they are doing
  P.hipL += 0.85 * k; P.hipR += 0.85 * k; P.knL -= 1.15 * k; P.knR -= 1.15 * k;
  P.shLP = P.shRP = 0.65 + 0.35 * k; P.elL = P.elR = 0.3 - 0.15 * k; P.shLR = P.shRR = 0.12;
  P.headP = 0.25 * k;
  return P;
}
// The roll-up door's opening (Truck.rearDoor) over doorOpen: bend to the handle, lift it to the
// chest, push it up overhead. doorClose: reach up, pull it down to the chest, bend and push it shut.
function doorControl(kind: "doorOpen" | "doorClose", u: number) {
  if (kind === "doorOpen") return u < 0.22 ? 0 : u < 0.55 ? 0.3 * THREE.MathUtils.smoothstep(u, 0.22, 0.55) : 0.3 + 0.7 * THREE.MathUtils.smoothstep(u, 0.55, 0.85);
  return u < 0.15 ? 1 : u < 0.55 ? 1 - 0.7 * THREE.MathUtils.smoothstep(u, 0.15, 0.55) : 0.3 * (1 - THREE.MathUtils.smoothstep(u, 0.55, 0.85));
}
// Arm lengths of the Character rig (shoulder to elbow, elbow to the hand), and its shoulder
// height above the hips.
const ARM_UPPER = 0.29, ARM_FORE = 0.32, SHOULDER_UP = 0.5;
// Both hands at a point `dx` ahead of the feet and `h` above them: crouching and leaning for
// low points, then the two arm segments solved to reach it (as far as they go). Options: `hR`
// puts the right hand at its own height (hand over hand), `crouch` bends the knees that much
// more (metres), and `narrow` (0..1) brings the hands in from shoulder width to meet in the middle.
function reachPose(dx: number, h: number, P: BodyPose, o: { hR?: number; crouch?: number; narrow?: number } = {}): BodyPose {
  const hR = o.hR ?? h, crouch = o.crouch ?? 0, narrow = o.narrow ?? 0, hm = (h + hR) / 2;
  const k = THREE.MathUtils.clamp((1.1 - hm) / 0.85, 0, 1), up = THREE.MathUtils.clamp((Math.max(h, hR) - 1.6) / 0.4, 0, 1);
  const b = -0.1 - 0.8 * k + 0.12 * up;
  P.bend = b; P.drop = 0.45 * k + crouch;
  P.hipL = P.hipR = 1.0 * k + 2.2 * crouch; P.knL = P.knR = -1.4 * k - 3.1 * crouch;
  const sx = -SHOULDER_UP * Math.sin(b), sy = HIP_Y - P.drop + SHOULDER_UP * Math.cos(b), vx = dx - sx;
  // One arm: rolled in about the shoulder (towards the middle, the way the hand points: up or
  // down), then its two segments solved in that rolled plane for the height that roll leaves.
  const arm = (hh: number): [number, number, number] => {
    const vy = hh - sy;
    const inward = Math.sign(vy) * Math.min(0.6, Math.atan2(0.2, Math.max(Math.abs(vy), 0.01)));
    const roll = 0.1 * (1 - narrow) + inward * narrow, vr = vy / Math.cos(roll);
    const d = THREE.MathUtils.clamp(Math.hypot(vx, vr), 0.05, (ARM_UPPER + ARM_FORE) * 0.995);
    const at = Math.atan2(vx, -vr);
    const el = Math.PI - Math.acos(THREE.MathUtils.clamp((ARM_UPPER ** 2 + ARM_FORE ** 2 - d * d) / (2 * ARM_UPPER * ARM_FORE), -1, 1));
    const a1 = at - Math.acos(THREE.MathUtils.clamp((ARM_UPPER ** 2 + d * d - ARM_FORE ** 2) / (2 * ARM_UPPER * d), -1, 1));
    return [a1 - b, el, roll];
  };
  [P.shLP, P.elL, P.shLR] = arm(h);
  [P.shRP, P.elR, P.shRR] = arm(hR);
  P.headP = THREE.MathUtils.clamp(0.6 * Math.atan2(hm - sy, Math.max(0.2, vx)), -0.5, 0.6);
  return P;
}
// Stepping up to the roll-up door (and back) takes this long.
const DOOR_STEP = 0.35;
// One door chore `t` seconds in (of `len`), the driver's feet at (fx, fy) in the truck frame: sets
// the pose and returns the door's opening.
// Opening: reach down to the handle, lift it to the chest, push it up overhead, brace, and give it
// one last shove: it leaves the hands at their speed and coasts up to its stop.
// Closing: reach up for the strap hanging from the door, pull it down hand over hand until the
// door's edge is in reach, take that and pull it down to the chest, bend and push it shut.
function doorMotion(kind: "doorOpen" | "doorClose", t: number, len: number, fx: number, fy: number, g: DoorGeom, P: BodyPose): number {
  const rest = { ...P };
  const dx = g.x - fx - 0.06;                                   // hands just in front of the slats
  const low = Math.max(0.05, g.floor - fy), chest = 1.25;       // hand heights above the feet
  const edgeTop = g.floor + Math.min(g.open, g.lv) - fy;        // the edge, fully open
  const top = Math.min(DOOR_REACH, edgeTop);
  const fOf = (edge: number) => THREE.MathUtils.clamp((edge + fy - g.floor) / g.open, 0, 1);
  const seg = (v: number, v0: number, v1: number) => ease((v - v0) / (v1 - v0));
  const reachTo = (h: number, w: number, o?: Parameters<typeof reachPose>[3]) => blendPose(rest, reachPose(dx, h, { ...rest }, o), w, P);
  if (kind === "doorOpen") {
    const s = t * DOOR_OPEN / len;                              // on the nominal timeline
    const push = Math.max(chest, top - 0.2), brace = push - 0.06, dip = 0.07;
    if (s < 0.45) { reachTo(low, seg(s, 0, 0.45)); return 0; }
    if (s < 1.9) {
      const h = s < 1.3 ? low + (chest - low) * seg(s, 0.45, 1.3) : chest + (push - chest) * seg(s, 1.3, 1.9);
      reachTo(h, 1); return fOf(h);
    }
    if (s < 2.15) { const k = seg(s, 1.9, 2.15), h = push - 0.06 * k; reachTo(h, 1, { crouch: dip * k }); return fOf(h); }
    const SHOVE = 0.18;
    if (s < 2.15 + SHOVE) {                                     // accelerating all the way: the hands drive it
      const q = (s - 2.15) / SHOVE, h = brace + (top - brace) * q * q;
      reachTo(h, 1, { crouch: dip * (1 - q) }); return fOf(h);
    }
    // Let go at the top of the shove, moving at v: the arms follow through and drop, the door
    // runs on up, slowing, to its stop (or simply stops, if the hands took it all the way).
    const v = 2 * (top - brace) / SHOVE, D = edgeTop - top, s0 = 2.15 + SHOVE;
    reachTo(top, 1 - seg(s, s0 + 0.1, s0 + 0.65));
    if (D < 0.01) return fOf(top);
    const tc = THREE.MathUtils.clamp(1.5 * D / v, 0.45, 0.9), q = Math.min(1, (s - s0) / tc);
    const m0 = Math.min(v * tc, 2.5 * D), q2 = q * q, q3 = q2 * q;
    return fOf(top + m0 * (q3 - 2 * q2 + q) + D * (3 * q2 - 2 * q3));
  }
  const pulls = strapPulls(edgeTop, g.floor - fy), n = pulls.n, hi = Math.max(pulls.hi, edgeTop - g.strap), sp = pulls.each;
  const reach = pulls.reach, t0 = 0.5, tS = t0 + n * STRAP_PULL, tE = tS + 0.3, tC = tE + 0.6, tL = tC + 0.5;
  if (n && t < t0) { reachTo(hi, seg(t, 0, t0), { narrow: 1 }); return 1; }
  if (n && t < tS) {
    // Pull i: one hand draws the strap down from overhead while the other slides up it to take
    // the next pull (the first pull with both hands starting together up top).
    const i = Math.min(n - 1, Math.floor((t - t0) / STRAP_PULL)), q = seg(t - t0 - i * STRAP_PULL, 0, STRAP_PULL);
    const pull = hi - sp * q, free = i === 0 ? hi : hi - sp * (1 - q);
    const [hL, hR] = i % 2 ? [pull, free] : [free, pull];
    reachTo(hL, 1, { hR, narrow: 1, crouch: 0.04 * Math.sin(Math.PI * q) });
    return fOf(edgeTop - sp * (i + q));
  }
  if (t < tE) {
    // Off the strap and onto the door's edge, now in reach (straight there when it always was).
    const k = seg(t, tS, tE);
    if (!n) { reachTo(reach, seg(t, 0, tE)); return 1; }
    const last = n - 1, [l0, r0] = last % 2 ? [hi - sp, hi] : [hi, hi - sp];
    reachTo(l0 + (reach - l0) * k, 1, { hR: r0 + (reach - r0) * k, narrow: 1 - k });
    return fOf(reach);
  }
  if (t < tC) { const h = reach + (chest - reach) * seg(t, tE, tC); reachTo(h, 1); return fOf(h); }
  if (t < tL) { const h = chest + (low - chest) * seg(t, tC, tL); reachTo(h, 1); return fOf(h); }
  reachTo(low, 1 - seg(t, tL, tL + 0.4)); return 0;
}

// Team lift arms (shoulder pitch, elbow): the leading driver's hands just behind, on the load;
// the worker's reaching forward to the other end.
const TEAM_FRONT_ARM: [number, number] = [-0.25, 0.1], TEAM_BACK_ARM: [number, number] = [0.35, 0.2];
// Where those hands are, ahead of and above the feet, standing upright.
function teamHand(arm: [number, number]): [number, number] {
  const sy = HIP_Y + SHOULDER_UP, a1 = arm[0], a2 = arm[0] + arm[1];
  return [ARM_UPPER * Math.sin(a1) + ARM_FORE * Math.sin(a2), sy - ARM_UPPER * Math.cos(a1) - ARM_FORE * Math.cos(a2)];
}

// ---- a stacking trip's legs ----------------------------------------------------------------------
// In the truck's frame: the forklift's heel (the forks' root, on the ground) and the forks' yaw
// (forks along (cos yaw, -sin yaw): towards the truck at PI/2). Its middle is 1.15 m behind the heel.
interface YPose { x: number; z: number; yaw: number }
interface YLeg { d: number; kind: "line" | "s" | "curve" | "spin" | "turn" | "hold"; a: YPose; b: YPose; f0: number; f1: number; ev?: "take" | "give"; rev?: boolean; truck?: boolean }
const FL_MID = 1.15;
const LONG_TINES = (1.27 + 0.55) / 1.13;   // tines long enough to reach a flatbed's middle from its side
const fvec = (yaw: number): [number, number] => [Math.cos(yaw), -Math.sin(yaw)];
function spinTo(a: YPose, d: number): YPose {
  const [fx, fz] = fvec(a.yaw), cx = a.x - fx * FL_MID, cz = a.z - fz * FL_MID, yaw = a.yaw + d, [gx, gz] = fvec(yaw);
  return { x: cx + gx * FL_MID, z: cz + gz * FL_MID, yaw };
}
const leg = (d: number, kind: YLeg["kind"], a: YPose, b: YPose, f0: number, f1: number, o: Partial<YLeg> = {}): YLeg => ({ d, kind, a, b, f0, f1, ...o });
// The yard: off the deck, round on the pavement (the load swinging away from the container), and
// up the yard to the stack; a pickup the other way. Starting and ending parked by the stack. Fork
// heights are the forks' own (over the ground under the forklift).
function yardLegs(L: TruckLayout, F: { s: number; sx: number; sz: number }, ux: number, uy: number, sy: number, pickup: boolean): YLeg[] {
  const reach = L.hw + 0.15, travel = 0.15, up = 0.06;
  const B: YPose = { x: ux, z: reach, yaw: Math.PI / 2 }, R: YPose = { x: ux, z: L.hw + 2.55, yaw: Math.PI / 2 };
  const turn = F.s > 0 ? -Math.PI : Math.PI, Rp = spinTo(R, turn);
  const P2: YPose = { x: F.sx, z: F.sz - reach, yaw: Rp.yaw }, Pk: YPose = { ...P2, z: P2.z - 0.8 };
  const tl = uy + 0.05, sl = sy - CURB_H + 0.05;
  return pickup ? [
    leg(0.8, "line", Pk, P2, travel, sl),
    leg(0.4, "hold", P2, P2, sl, sl, { ev: "take" }),
    leg(0.4, "hold", P2, P2, sl, sl + up),
    leg(2.0, "s", P2, Rp, sl + up, travel, { rev: true }),
    leg(1.4, "spin", Rp, R, travel, tl + up),
    leg(1.0, "line", R, B, tl + up, tl + up),
    leg(0.5, "hold", B, B, tl + up, tl, { ev: "give", truck: true }),
    leg(1.0, "line", B, R, tl, tl),
    leg(1.4, "spin", R, Rp, tl, travel),
    leg(2.0, "s", Rp, Pk, travel, travel),
  ] : [
    leg(2.0, "s", Pk, Rp, travel, travel, { rev: true }),
    leg(1.4, "spin", Rp, R, travel, tl),
    leg(1.0, "line", R, B, tl, tl),
    leg(0.4, "hold", B, B, tl, tl, { ev: "take", truck: true }),
    leg(0.4, "hold", B, B, tl, tl + up),
    leg(1.0, "line", B, R, tl + up, tl + up),
    leg(1.4, "spin", R, Rp, tl + up, travel),
    leg(2.0, "s", Rp, P2, travel, sl + up),
    leg(0.5, "hold", P2, P2, sl + up, sl, { ev: "give" }),
    leg(0.8, "line", P2, Pk, sl, travel),
  ];
}
// The road side: the forklift parks on the pavement beyond the stack (H), and works through the
// inner lane: out to C (facing along the truck, behind it), round into the truck's side (B) or up
// onto the pavement to the stack (P2), and back to C in reverse. Its first trip starts by turning
// out of where it's parked; its last ends turning back in. Loads ride high alongside the truck.
function roadLegs(L: TruckLayout, F: { front: number; sx: number; sz: number }, ux: number, uy: number, sy: number, pickup: boolean, first: boolean, last: boolean): YLeg[] {
  const reach = L.hw + 0.15, travel = 0.15, up = 0.06, high = 1.6, tl = uy + 0.05, sl = sy - CURB_H + 0.05;
  const B: YPose = { x: ux, z: -reach, yaw: -Math.PI / 2 }, C: YPose = { x: F.sx - 2, z: -3, yaw: 0 };
  const P2: YPose = { x: F.sx, z: F.sz - reach, yaw: -Math.PI / 2 }, H: YPose = { x: F.sx - 4.2, z: F.front - 1.6, yaw: Math.PI };
  const out = first ? [leg(ROAD_PARK, "turn", H, C, travel, travel)] : [];
  out.push(...(pickup ? [
    leg(2.4, "curve", C, P2, travel, sl),
    leg(0.4, "hold", P2, P2, sl, sl, { ev: "take" }),
    leg(0.4, "hold", P2, P2, sl, sl + up),
    leg(2.4, "curve", P2, C, sl + up, high, { rev: true }),
    leg(3.0, "curve", C, B, high, tl + up),
    leg(0.5, "hold", B, B, tl + up, tl, { ev: "give", truck: true }),
    leg(3.0, "curve", B, C, tl, travel, { rev: true }),
  ] : [
    leg(3.0, "curve", C, B, travel, tl),
    leg(0.4, "hold", B, B, tl, tl, { ev: "take", truck: true }),
    leg(0.4, "hold", B, B, tl, tl + up),
    leg(3.0, "curve", B, C, tl + up, high, { rev: true }),
    leg(2.4, "curve", C, P2, high, sl + up),
    leg(0.6, "hold", P2, P2, sl + up, sl, { ev: "give" }),
    leg(2.4, "curve", P2, C, sl, travel, { rev: true }),
  ]));
  if (last) out.push(leg(ROAD_PARK, "turn", C, H, travel, travel));
  return out;
}
// The forklift at time t into a trip: heel, yaw, fork height, its middle's z, and whether the
// bundle has been taken and given yet.
function legsAt(legs: YLeg[], t: number) {
  let t0 = 0, took = false, gave = false;
  for (const g of legs) {
    if (t >= t0 + g.d) { t0 += g.d; if (g.ev === "take") took = true; if (g.ev === "give") gave = true; continue; }
    const u = THREE.MathUtils.clamp((t - t0) / g.d, 0, 1), e = ease(u), fy = g.f0 + (g.f1 - g.f0) * THREE.MathUtils.smoothstep(u, 0, 1);
    let x = g.a.x, z = g.a.z, yaw = g.a.yaw;
    if (g.kind === "line") { x = g.a.x + (g.b.x - g.a.x) * e; z = g.a.z + (g.b.z - g.a.z) * e; }
    else if (g.kind === "spin" || g.kind === "turn") {
      // Round its middle (a turn also moves its middle along, from a's to b's).
      const [ax, az] = fvec(g.a.yaw), [bx, bz] = fvec(g.b.yaw);
      const c0x = g.a.x - ax * FL_MID, c0z = g.a.z - az * FL_MID, c1x = g.b.x - bx * FL_MID, c1z = g.b.z - bz * FL_MID;
      const cx = g.kind === "turn" ? c0x + (c1x - c0x) * e : c0x, cz = g.kind === "turn" ? c0z + (c1z - c0z) * e : c0z;
      yaw = g.a.yaw + (g.b.yaw - g.a.yaw) * e; const [gx, gz] = fvec(yaw); x = cx + gx * FL_MID; z = cz + gz * FL_MID;
    } else if (g.kind === "curve") {
      // A cubic from a to b leaving and arriving along each one's heading (the way it moves:
      // backwards, reversing), forks along its tangent or against it.
      const sg = g.rev ? -1 : 1, [ax, az] = fvec(g.a.yaw), [bx, bz] = fvec(g.b.yaw);
      const k = THREE.MathUtils.clamp(0.45 * Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z), 0.5, 2.2), w = 1 - e;
      const p1x = g.a.x + sg * ax * k, p1z = g.a.z + sg * az * k, p2x = g.b.x - sg * bx * k, p2z = g.b.z - sg * bz * k;
      x = w * w * w * g.a.x + 3 * w * w * e * p1x + 3 * w * e * e * p2x + e * e * e * g.b.x;
      z = w * w * w * g.a.z + 3 * w * w * e * p1z + 3 * w * e * e * p2z + e * e * e * g.b.z;
      const dx = 3 * w * w * (p1x - g.a.x) + 6 * w * e * (p2x - p1x) + 3 * e * e * (g.b.x - p2x);
      const dz = 3 * w * w * (p1z - g.a.z) + 6 * w * e * (p2z - p1z) + 3 * e * e * (g.b.z - p2z);
      yaw = Math.hypot(dx, dz) < 1e-6 ? g.a.yaw : g.rev ? Math.atan2(dz, -dx) : Math.atan2(-dz, dx);
    } else if (g.kind === "s") {
      // A cubic from a to b leaving and arriving along z, forks along its tangent (or against it, reversing).
      const k = Math.abs(g.b.z - g.a.z) * 0.5, m = Math.sign(g.b.z - g.a.z) || 1;
      const p1x = g.a.x, p1z = g.a.z + m * k, p2x = g.b.x, p2z = g.b.z - m * k, w = 1 - e;
      x = w * w * w * g.a.x + 3 * w * w * e * p1x + 3 * w * e * e * p2x + e * e * e * g.b.x;
      z = w * w * w * g.a.z + 3 * w * w * e * p1z + 3 * w * e * e * p2z + e * e * e * g.b.z;
      const dx = 3 * w * w * (p1x - g.a.x) + 6 * w * e * (p2x - p1x) + 3 * e * e * (g.b.x - p2x);
      const dz = 3 * w * w * (p1z - g.a.z) + 6 * w * e * (p2z - p1z) + 3 * e * e * (g.b.z - p2z);
      yaw = Math.hypot(dx, dz) < 1e-6 ? g.a.yaw : g.rev ? Math.atan2(dz, -dx) : Math.atan2(-dz, dx);
    }
    return { x, z, yaw, fy, cz: z - fvec(yaw)[1] * FL_MID, took, gave };
  }
  const g = legs[legs.length - 1], last = g.b;
  return { x: last.x, z: last.z, yaw: last.yaw, fy: g.f1, cz: last.z - fvec(last.yaw)[1] * FL_MID, took, gave };
}
