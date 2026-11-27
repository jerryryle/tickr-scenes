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
import { ease, GATE_LEN, LEAF_OPEN, SPECS, Truck, truckLayout, UNDERRIDE_Y } from "./truck.ts";
import type { DoorGeom, TruckLayout, TruckModel } from "./truck.ts";
import type { KerbDoor } from "./city.ts";
import { CARGO_MODELS } from "./cargomodels.ts";
import { DOCK_DEPTH, DOCK_PLATFORM } from "./facilities.ts";
import { CARGO_BY_ID } from "./cargo.ts";
import { mateTurn, herdBack, herdCount, fetchSpots, leafAngle, leafAt, pavementFetch, ROAD_PARK, FL_MID, LONG_TINES, fvec, stackGeom, stackTripLegs, TEAM_CLEAR, HIGH_CARRY, teamSpan, bedUnits, DOOR_OPEN, DOOR_REACH, DOOR_STAND, HT_LEAD, JACK_LEAD, JACK_PIVOT_AT, JACK_TURN, JACK_TURN_LOADED, pushGap, flipYawIn, flipYawOut, RAMP_HOLD, RAMP_HW, STRAP_PULL, strapPulls, STYLE, stageGap, STAGE_AHEAD, toolStore, tripCount, tripUnits, dockForkTrip, DOCK_FORK_FROM, DOCK_FORK_REACH } from "./chores.ts";
import { buildCrewPath, EASE_T, EMPTY_HOLD, flipHandTruck, jackIntoDoor, samplePath } from "./crewpath.ts";
import type { CrewPath, Hold, Nominal } from "./crewpath.ts";
import type { Chore, ItemKind, StackGeom, ToolRest, YLeg } from "./chores.ts";
import { DWELL, Journey, siteKey } from "./journey.ts";
import type { Aboard, DwellNow, Stop } from "./journey.ts";
import { swapClear, swapWalkPace, swapWalkPoint, swapWalkU } from "./director.ts";
import { BedLoad, buildCarried, Herd } from "./loads.ts";
import type { CarriedLoad } from "./loads.ts";
import { ARM_F, ARM_U, blendPose, Character, CHARACTER_HIP_Y, DRIVER_LOOK, gesturePose, HIP_Y, idlePose, LEG_L, LEG_U, restPose, seatedPose, SHOULDER_Y, SIDE_STEP, sideStepPose, stoopFor, STRIDE, walkPose, WORKER_LOOK } from "./character.ts";
import type { BodyPose } from "./character.ts";


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
  private m4 = new THREE.Matrix4(); private toTruck = new THREE.Matrix4(); private v = new THREE.Vector3(); private v2 = new THREE.Vector3();
  private time = 0;
  private qa = new THREE.Quaternion(); private eu = new THREE.Euler();
  private toolHeld: "handTruck" | "palletJack" | null = null;
  private jackHandle!: THREE.Group;
  // The stop's planned way round the truck (crewpath.ts), for the plan it was worked out for.
  private path: CrewPath | null = null; private pathPlan: Chore[] | null = null; private pathKey = "";
  private ps = { x: 0, z: 0, yaw: 0, steps: 0, travel: 0, speed: 0, along: 1, pivot: 0, jx: NaN, jz: NaN, jyaw: NaN, lead: NaN as number | undefined };
  private ps1 = { x: 0, z: 0, yaw: 0, steps: 0, travel: 0, speed: 0, along: 1, jx: NaN, jz: NaN, jyaw: NaN };   // (the path at another time: the team lift's worker)
  // What the ground does this frame, in the truck's frame: the ramp and lift gate as the chores
  // have them, the platform at a dock, and the kerb (a point on its edge and the normal out into
  // the road) when the stop has a front door to place it by.
  private ctl = { ramp: 0, gate: 0, drop: 0 };
  private docked = false;
  private kerb: { x: number; z: number; nx: number; nz: number } | null = null;
  // The kerb's edge the crew step up over: the front door's kerb, or with no door, the one along
  // the truck's right where its lane leaves it (Journey.kerbSide).
  private kerbEdge: { x: number; z: number; nx: number; nz: number } | null = null;
  // Where the hands go this frame (world), and how firmly (0 free .. 1 on it).
  private gripL = new THREE.Vector3(); private gripR = new THREE.Vector3(); private wL = 0; private wR = 0;
  private gripMate: { L: THREE.Vector3; R: THREE.Vector3 } | null = null;
  private kerbM = new THREE.Matrix4(); private kerbV = new THREE.Vector3();   // (feetOnKerb)
  private v3 = new THREE.Vector3(); private v4 = new THREE.Vector3(); private v5 = new THREE.Vector3(); private v6 = new THREE.Vector3();

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
      // Hand truck in its own frame: the axle at the origin (it tips about its wheels), the frame
      // rising along +y to the handle (HT_GRIP), the nose plate forward along +x at the foot.
      handTruck: build((b) => {
        for (const z of [-0.2, 0.2]) { b.cyl(0, 0, z, HT_WHEEL, 0.06, BLACK, 8, Math.PI / 2); b.box(0.02, 0.57, z, 0.04, 1.3, 0.04, 0xc0392b); }
        b.box(0.02, HT_GRIP[1], 0, 0.04, 0.04, 0.44, 0xc0392b);
        b.box(0.14, HT_PLATE + 0.015, 0, 0.24, 0.03, 0.4, STEEL);
        b.box(0.02, 0, 0, 0.03, 0.03, 0.46, STEEL);
      }),
      // Pallet jack: the steering wheel's foot at the origin, forks running forward along +x on
      // rollers at their tips; the handle (jackHandle) pivots on the pump, tipping back for a pull.
      palletJack: build((b) => {
        b.box(0, 0.13, 0, 0.2, 0.2, 0.32, 0xe0a020);
        b.cyl(0, 0.06, 0, 0.06, 0.1, BLACK, 8, Math.PI / 2);
        for (const z of [-0.25, 0.25]) { b.box(0.77, 0.05, z, 1.2, 0.07, 0.16, 0xe0a020); b.cyl(JACK_TIP, 0.035, z, 0.035, 0.1, BLACK, 6, Math.PI / 2); }
      }),
    };
    {
      const hb = new Batch();
      hb.box(0, JACK_HANDLE / 2, 0, 0.04, JACK_HANDLE, 0.04, 0x222222);
      hb.box(0, JACK_HANDLE, 0, 0.05, 0.05, 0.3, 0x222222);
      this.jackHandle = new THREE.Group(); this.jackHandle.add(hb.build(material)!);
      this.jackHandle.position.set(JACK_PIVOT[0], JACK_PIVOT[1], 0);
      this.tools.palletJack.add(this.jackHandle);
    }
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
  private feetY = 0;   // the driver's feet this frame (work)
  private drv: [number, number, number, number] = [0, 0, 0, 0];   // the driver this frame: truck-frame x, y, z, yaw
  // The second carrier of a team lift (the facility's worker): truck-frame pose this frame, and
  // whether they are holding their end of the load (on a carry and the reach either side of it).
  private mate = { x: 0, y: 0, z: 0, yaw: 0, attached: false, walking: false };
  private teamPlan: Chore[] | null = null;
  private teamRuns: { i0: number; i1: number; pre: number; post: number; pts: [number, number][]; cum: number[] }[] = [];
  private teamStart: number[] = [];
  private doorNow = 0;   // the roll-up door's opening during a door chore (work sets it with the pose)   // a team lift's two carriers, truck frame (work)
  get workerRoot() { return this.helper.root; }   // the dock worker / team-lift carrier, for FrontDoorFx
  forkDoor = 0;   // how far the facility's front door is open for the forklift at a flatbed (FrontDoorFx)
  // The middle of the forklift while it is in a docked trailer (worker() this frame), where main
  // turns the spotlight on it: the driver stands out on the platform then, directing it.
  forkSpot: THREE.Vector3 | null = null;
  private forkSpotV = new THREE.Vector3();
  // The teammate's chest on a team lift while they are outside (teamMate() this frame), where
  // main turns a second spotlight on.
  mateSpot: THREE.Vector3 | null = null;
  private mateSpotV = new THREE.Vector3();
  private fp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];   // its path out of the door
  inSeat = true;   // the driver is sitting in the cab (seat() this frame); main turns the driver spotlight on otherwise
  indoors = false;   // the driver is in a facility's doorway or past it (work() this frame): no spotlight then (main.ts)
  // The springs and per-stop state that carry over between frames (main.ts: preview snapshots and
  // part-ticks); everything else follows from the journey each frame.
  private static SAVED = ["yaw", "yawV", "walkPhase", "time", "feetY", "drv", "mate", "doorNow", "toolHeld", "inSeat", "indoors", "pose", "tmpPose", "yard", "pave"] as const;
  // (`into`: an earlier save, filled again in place.)
  saveState(into?: CrewSave): CrewSave {
    const s = into ?? { f: {}, gag: new THREE.Vector3(), gagOn: false };
    s.f = saveFields(this, Crew.SAVED, [], s.f);
    s.gagOn = !!this.gagPoint; if (s.gagOn) s.gag.copy(this.gagV);
    return s;
  }
  loadState(s: CrewSave) { loadFields(this, s.f); this.gagPoint = s.gagOn ? this.gagV.copy(s.gag) : null; }
  update(dt: number, j: Journey, truck: Truck, other: Truck | null, cam: THREE.Camera) {
    this.inSeat = false; this.indoors = false;
    this.time = j.clockTime + j.frac;   // the city's clock: idle motion is the same after a scrub, and wherever the visit comes
    const st = j.st, d = this.driver;
    const controls = { cab: 0, otherCab: 0, rear: 0, ramp: 0, gate: 0, drop: 0, leafL: 0, leafR: 0 };
    this.helper.root.visible = false;
    if (this.load) { this.load.group.visible = false; this.load.group.scale.set(1, 1, 1); }
    for (const o of this.stagedShown) o.visible = false;
    this.stagedShown.length = 0;
    this.herd?.hide();
    this.tools.handTruck.visible = this.tools.palletJack.visible = false;
    this.forklift.visible = false; this.stackWorking = false;
    this.forkDoor = 0; this.forkSpot = null; this.mateSpot = null;
    this.gagPoint = null;
    d.root.visible = true;
    d.vestOn = false;   // (on for a dock stop, below: set on every update, so a scrub back takes it off)
    // (A tractor-trailer's door dwell before or after a dock stop, journey.ts doorDwell: the driver
    // at its doors only, the stop's loads and the dock's worker not in it.)
    const doors = j.doorDwell, stop = doors ?? st.stops[0], stopping = st.mode === "dwell" && !!stop && stop.kind !== "swap" && !doors;
    this.bed.update(truck, stopping ? this.bedView(j, truck, stop) : st.aboard);
    this.prepareCargo(stopping ? stop : null, j);
    if (!doors) this.worker(j, truck, stop);
    this.yardProps(j, truck);
    this.pavementProps(j, truck);

    this.toolHeld = null;
    // The country truck stop: out of the old truck, along to the spare, up into it.
    const road = j.country, cstop = road && j.countryU >= 0 ? road.stoppedAt(j.countryU) : null;
    if (cstop && cstop.kind === "truckstop" && road!.swapU >= 0) {
      this.truckStopSwap(j.countryU - cstop.arrive, road!.swapU - cstop.arrive, truck, other, controls);
      this.applyTruck(truck, other, controls);
      this.firstPerson(cam);
      return;
    }
    // (A trailer's swing doors open from before it backs into a dock's bay until they are closed
    // again once it has pulled out.)
    controls.leafL = controls.leafR = st.leaves ? 1 : 0;
    if (st.mode !== "dwell") {
      this.seat(truck, seatedPose(this.pose, truck.steer));
      this.applyTruck(truck, other, controls);
      this.firstPerson(cam);
      return;
    }
    const ph = j.dwellPhase();
    this.plan = j.chores;
    const idx = ph.chore ? j.chores.indexOf(ph.chore) : -1;
    // Door, ramp and gate state: the end effect of every finished chore, then the current one
    // (once they are all done, startup: every one's).
    const done = ph.phase === "startup" ? j.chores.length : idx;
    for (let i = 0; i <= Math.min(done, j.chores.length - 1); i++) this.choreControls(j.chores[i], i < done ? 1 : ph.ct / j.chores[i].len, controls, stop.kind === "swap");
    const docked = !doors && j.isDockStop(stop);   // (at its doors, before or after: out in the yard)
    d.vestOn = docked;
    this.ctl.ramp = controls.ramp; this.ctl.gate = controls.gate; this.ctl.drop = controls.drop;
    this.docked = docked;
    this.kerbLine(j, truck, stop.kind !== "swap" && !j.country);

    if (!ph.chore) {
      // Park and startup: in the seat (of the new truck after a swap's hand-over).
      this.seat(truck, seatedPose(this.pose, 0));
    } else {
      const c = ph.chore, u = THREE.MathUtils.clamp(ph.ct / c.len, 0, 1);
      const swap = stop.kind === "swap";
      if (c.kind === "climbDown") this.climb(truck, ph.ct, c.len, false);
      else if (c.kind === "climbUp") this.climb(swap && other ? other : truck, ph.ct, c.len, true);
      else if (swap && c.kind === "walk" && other) this.swapWalk(j, truck, other, ph.ct, c.len);
      else if (c.kind === "bedUp" || c.kind === "bedDown") this.bedClimb(truck, c, u);
      else this.work(c, ph.ct, u, truck, dt, stop);
    }
    if (ph.chore && (ph.chore.kind === "doorOpen" || ph.chore.kind === "doorClose")) controls.rear = this.doorNow;
    // A hand truck or pallet jack not in hand rides in the bed, against the front wall.
    if (stop.kind !== "swap" && stop.cargo) {
      const tool = STYLE[CARGO_BY_ID.get(stop.cargo)!.handling].tool;
      const L = truckLayout(truck.model);
      if (tool && (!L.trailer || j.chores.some((q) => q.kind === "toolGet")) && !L.flatbed && !(ph.chore && this.toolHeld)) {
        const r = this.toolRest(j, ph, L, tool), h = this.tools[tool];
        truck.root.updateMatrixWorld();
        h.visible = true;
        h.position.set(r.at[0], r.at[1] + (tool === "handTruck" ? HT_WHEEL : 0), r.at[2]).applyMatrix4(truck.root.matrixWorld);
        h.rotation.set(0, truck.heading + r.yaw, 0);
        if (tool === "palletJack") this.jackHandle.rotation.z = 0;
      }
    }
    if (stop.kind !== "swap" && stop.cargo && !doors) this.stagedLoads(j, truck, stop);
    // The load lying on its own on the floor (a trailer's, handed over at its doors or left by the
    // jack), when no one has it.
    // (Not once the forklift has taken a drop's: it has gone off with it.)
    const lay = ph.chore?.lay, taken = !!ph.chore?.handoff && stop.kind === "drop" && ph.ct >= ph.chore.len * 0.4;
    if (lay && !taken && this.load && !this.load.group.visible) {
      truck.root.updateMatrixWorld();
      this.load.group.visible = true;
      this.load.group.position.set(lay[0], lay[1], lay[2]).applyMatrix4(truck.root.matrixWorld);
      this.load.group.rotation.set(0, truck.heading, 0);
    }
    this.foldAtDoor(j);
    this.applyTruck(truck, other, controls);
    this.firstPerson(cam);
  }

  // A load too big for the facility's front door squashes to fit as it goes through, whoever
  // carries it (the driver, a team lift, the forklift). Going in (a drop), it eases down to its
  // squashed size over the last metre or so before the doorway; coming out (a pickup), it springs
  // back, wobbling, once it's clear. It depends only on where the load is, so a scrub shows the
  // same thing.
  private foldAtDoor(j: Journey) {
    const load = this.load, d = j.kerbDoor;
    if (!load || !d || !load.group.visible) return;
    const g = load.group, size = load.size;
    g.updateMatrixWorld();
    // The load's own axes in the world: unit vectors, its scale being 1 here (update resets it).
    const e = g.matrixWorld.elements, axes = [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
    const dot = (a: number[], vx: number, vy: number, vz: number) => Math.abs(a[0] * vx + a[1] * vy + a[2] * vz);
    const extent = (vx: number, vy: number, vz: number) => axes.reduce((s, a, i) => s + dot(a, vx, vy, vz) * size[i], 0);
    // Whoever carries it takes it through the doorway along the way they go: along its own x, or
    // the forklift's (which may carry it crosswise). So it needs the doorway as wide as it is
    // square to that, however it is turned on the way there. (Measured as it is turned instead, a
    // load walked along the wall to the door is wider than the doorway until it turns in, and
    // squashes and springs back before it gets there.)
    if (this.forklift.visible) this.forklift.updateMatrixWorld();
    const f = this.forklift.visible ? this.forklift.matrixWorld.elements : e;
    const fl = Math.hypot(f[0], f[2]) || 1, px = -f[2] / fl, pz = f[0] / fl;
    const across = extent(px, 0, pz), deep = extent(d.nx, 0, d.nz) / 2, tall = extent(0, 1, 0);
    // How far it is from the doorway (1.2 m a unit): out in front of the wall, and off to the side
    // of the jambs, together, so the squash comes and goes smoothly whichever way it approaches.
    const tx = -d.nz, tz = d.nx, ox = g.position.x - d.x, oz = g.position.z - d.z;
    const ahead = Math.max(0, ox * d.nx + oz * d.nz - deep - 0.15), aside = Math.max(0, Math.abs(ox * tx + oz * tz) - d.half);
    const out = Math.hypot(ahead, aside) / 1.2, leaving = j.st.stops[0]?.kind === "pickup";
    if (out >= (leaving ? 2.5 : 1)) return;   // clear of it: full size (the spring settled)
    // How it must shrink: under the head of the doorway (from its sill: a garage roof's is up
    // there), and between the jambs.
    const midY = load.round ? g.position.y : g.position.y + axes[1][1] * size[1] / 2;
    const bottom = midY - tall / 2, top = (d.y ?? CURB_H) + d.h - 0.05;
    let fy = Math.min(1, Math.max(0.15, (top - bottom) / tall)), fw = Math.min(1, (d.half * 2 - 0.1) / across);
    if (fy >= 1 && fw >= 1) return;
    // More than it needs, and always enough to see (a load only just too big still gets squeezed).
    fy = fy < 1 ? Math.min(fy * 0.9, 0.62) : 1; fw = fw < 1 ? Math.min(fw * 0.9, 0.62) : 1;
    // Going in: eased down to the squashed size, no overshoot. Coming out: a damped spring back to
    // full size, overshooting, with squash and stretch (taller while it's narrower, and the other
    // way).
    const u = Math.min(1, out), ease = u * u * (3 - 2 * u);
    const k = out <= 0 ? 0 : leaving ? 1 - Math.exp(-2.5 * out) * Math.cos(8 * out) : ease;
    const wob = out <= 0 || !leaving ? 0 : 0.22 * Math.exp(-2.5 * out) * Math.sin(8 * out);
    const sy = fy + (1 - fy) * k, sw = fw + (1 - fw) * k;
    // Each of its own axes takes the squash of the way it points: across the doorway, up, or
    // along the way through (which keeps its length but wobbles with the width).
    const s = axes.map((a) => {
      const up = dot(a, 0, 1, 0), side = dot(a, px, 0, pz);
      return (1 - (1 - sw) * side - (1 - sy) * up) * (1 - wob + 2 * wob * up);
    });
    g.scale.set(s[0], s[1], s[2]);
  }

  // The trip under way: `i` of `trips` (one per stow). A pickup's trip runs up to and through
  // its stow; a drop's from its stow on.
  private tripNow(j: Journey, stop: Stop): { i: number; trips: number } {
    const ph = j.dwellPhase(), ch = j.chores;
    let trips = 0, before = 0;
    const idx = ph.chore ? ch.indexOf(ph.chore) : ph.phase === "startup" ? ch.length : -1;
    // A trip is a stow (by hand) or a forklift wait.
    const isTrip = (c: Chore | null | undefined) => !!c && (c.kind === "stow" || (c.kind === "wait" && !!c.forklift && !c.handoff));
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
    const back = teamSpan(load.size[0]);
    const idx = plan.indexOf(c), tc = start[idx] + t, end = (k: number) => start[k] + plan[k].len;
    const span = (r: typeof runs[number]) => [start[r.pre >= 0 ? r.pre : r.i0], end(r.post >= 0 ? r.post : r.i1)];
    // (The driver's: the bed, ramp, kerb, platform. Off the walk ramp's side, the worker steps
    // down from it over a stride, not at its edge; and up from its top onto the floor, a little
    // above it, over its last quarter metre.)
    const terrain = (x: number, z: number) => {
      const g = this.ground(L, x, z), e = Math.abs(z) - RAMP_HW, s0 = L.bedRear - 0.25;
      if (L.loader === "ramp" && this.ctl.ramp > 0.999 && e < 0 && x > s0 && x < L.bedRear - 0.02) { const r0 = rampY(L, s0); if (r0 !== null) return r0 + (L.floor - r0) * (x - s0) / (L.bedRear - 0.02 - s0); }
      if (L.loader !== "ramp" || this.ctl.ramp <= 0.999 || e < -0.05 || e > RAMP_STEP) return g;
      const r = rampY(L, x);
      return r === null ? g : r + (g - r) * THREE.MathUtils.smoothstep(e, -0.05, RAMP_STEP);
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
    // (With no door: along the pavement from well behind the truck, by the kerb, clear of the
    // street side of the row set out there (chores.ts teamRow), and back that way.)
    else if (fetch && this.noDoor()) entry = [L.bedRear - L.rampRun - 14, this.spotFor(fetch)[2] - load.size[2] / 2 - 0.4];
    else if (fetch) { const s = this.spotFor(fetch), f = fetch.face ?? 0; entry = [s[0] + Math.cos(f) * 0.9, s[2] - Math.sin(f) * 0.9]; }
    else entry = [L.bedRear - 2, L.hw + 3];
    // (Through a doorway, past half a metre in: out of sight.)
    const flips = plan.filter((q) => q.kind === "fetch" && q.flip).map((q) => ({ s: this.spotFor(q), f: q.face ?? 0 }));
    const wall = this.kerb ? 0.5 : 0;
    // (`by`: how far past the wall. The spotlight is off from 0.3 m short of it, as the driver's is
    // (work()), so the building stays solid.)
    const indoors = (x: number, z: number, by: number) => flips.some(({ s, f }) => (x - s[0]) * Math.cos(f) - (z - s[2]) * Math.sin(f) > wall + by && Math.abs((x - s[0]) * Math.sin(f) + (z - s[2]) * Math.cos(f)) < 2);
    const place = (x: number, z: number, yaw: number, pose: BodyPose, attached: boolean, walking = false) => {
      const y = terrain(x, z);
      this.mate.x = x; this.mate.y = y; this.mate.z = z; this.mate.yaw = yaw; this.mate.attached = attached; this.mate.walking = walking;
      hp.root.visible = !indoors(x, z, 0.5);
      this.placeChar(hp, truck, x, y, z, yaw);
      hp.apply(pose);
      this.feetOnKerb(hp, truck, pose);
      this.mateSpot = indoors(x, z, -0.3) ? null : this.mateSpotV.copy(hp.root.position).setY(hp.root.position.y + 1.1);
    };
    const armsOn = (P: BodyPose) => { P.shLP = P.shRP = TEAM_BACK_ARM[0]; P.elL = P.elR = TEAM_BACK_ARM[1]; P.shLR = P.shRR = 0.12; return P; };
    // Where on a carry's path the worker stands when the driver is `Dd` along it: back along the
    // path to the load's length (and both bodies' depth) from the driver in a straight line, up
    // and down slopes too (on a bend the path between them is longer than that, and they'd close
    // up on the load). `dp`: the driver's point, when not where the driver is now.
    const mateD = (r: typeof runs[number], Dd: number, dp: [number, number, number] = [this.drv[0], this.drv[1], this.drv[2]]) => {
      const gap = (Dm: number) => {
        const q = along(r, Dm), dy = terrain(q[0], q[1]) - dp[1], d = Math.hypot(q[0] - dp[0], q[1] - dp[2]);
        const tilt = Math.max(0, Math.abs(dy) - 0.68) / Math.max(0.5, d);   // (what levelling leaves: teamLoad)
        return Math.hypot(d, dy) - back - load.size[1] * Math.min(0.8, tilt);
      };
      let lo = Dd - 3 * back, hi = Dd;
      if (gap(lo) < 0) return Dd - back;
      for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (gap(m) >= 0) lo = m; else hi = m; }
      return lo;
    };
    // The driver's point at distance D along a carry (its ends: where it starts and stops).
    const driverAt = (r: typeof runs[number], D: number): [number, number, number] => { const q = along(r, D); return [q[0], terrain(q[0], q[1]), q[1]]; };
    // Where the worker takes hold for carry r: the load's length behind the driver back along its
    // way; or, taking it up from a front door (a fetch at the kerb), inside it, the load coming out
    // through the doorway ahead of them.
    const inDoor = (r: typeof runs[number]) => r.pre >= 0 && plan[r.pre].kind === "fetch" && plan[r.pre].face !== undefined && (!!plan[r.pre].flip || (!dock && !!this.kerb));
    // (A flip fetch at either end of carry r: plan.ts flipIn.)
    const flipAt = (k: number) => k >= 0 && plan[k].kind === "fetch" && plan[k].flip ? plan[k] : null;
    // (Out of a doorway behind the driver, after a drop: this far behind them, and where that leaves them.)
    const inward = (q: Chore, d: number, from: ArrayLike<number> = this.spotFor(q)): [number, number] => [from[0] + Math.cos(q.face ?? 0) * d, from[2] - Math.sin(q.face ?? 0) * d];
    const startOf = (r: typeof runs[number]): [number, number] => {
      if (!inDoor(r)) return along(r, mateD(r, 0, driverAt(r, 0))).slice(0, 2) as [number, number];
      const f = plan[r.pre].face!, q = this.spotFor(plan[r.pre]);
      return [q[0] + Math.cos(f) * back, q[2] - Math.sin(f) * back];
    };
    // Where the worker is on carry r at time T: from where they take hold, in the driver's footsteps
    // (the driver's way round the stop, crewpath.ts: up the ramp's middle, between the bed's walls)
    // the load's length behind them, never stepping faster than MATE_V (where the carry's way
    // doubles back tighter than that, the last footstep that far away moves on as the driver does,
    // and they cut across rather than leap); and how far they have walked (back, when backing
    // away from the driver).
    const path = this.path!;
    // (On a walk with the load held rigid (Chore.mate): its end the load's length from the driver,
    // the way the plan turns it.)
    // (`from`: where the worker really is as it starts, after following the driver's footsteps,
    // which the plan only estimates: from there, out or in to the load's length as it goes.)
    const rigidAt = (k: number, T: number, from?: [number, number]): [number, number] => {
      const q = plan[k], u = THREE.MathUtils.clamp((T - start[k]) / q.len, 0, 1), d = samplePath(path, T, this.ps1), dx = d.x, dz = d.z;
      const a = q.a!, b = q.b!, [wa, wb] = q.mate!;
      let ta = Math.atan2(-(wa[1] - a[2]), wa[0] - a[0]), r0 = back;
      if (from) { const d0 = samplePath(path, start[k], this.ps1); ta = Math.atan2(-(from[1] - d0.z), from[0] - d0.x); r0 = Math.hypot(from[0] - d0.x, from[1] - d0.z); }
      const tb = Math.atan2(-(wb[1] - b[2]), wb[0] - b[0]);
      const th = ta + Math.atan2(Math.sin(tb - ta), Math.cos(tb - ta)) * u, rr = r0 + (back - r0) * u;
      return [dx + Math.cos(th) * rr, dz - Math.sin(th) * rr];
    };
    // (The worker's step (dx, dz) facing (fx, fz), as the driver's are counted (crewpath.ts gait):
    // how far through the walk cycle, in strides' worth of ground, it takes them, a stride along
    // the facing and SIDE_STEP across it, counting down only for a step clearly backwards (going
    // sideways, the cycle runs on, whichever way the little along it wavers); how much of it is
    // along the facing; and which way across it goes (right, +; counting down, the other way).)
    // (Facing the load, turned towards where they go: mateTurn. Counted against the way they then
    // face.)
    const gaitOf = (dx: number, dz: number, fx: number, fz: number) => {
      const dist = Math.hypot(dx, dz), fl = Math.hypot(fx, fz) || 1;
      if (dist < 1e-9) return { g: 0, along: 1, lat: 0 };
      const rel0 = Math.atan2((-dx * fz + dz * fx) / fl, (dx * fx + dz * fz) / fl), rel = rel0 - mateTurn(rel0);
      const al = Math.cos(rel) * dist, lt = Math.sin(rel) * dist, a = Math.min(1, Math.abs(al) / dist), sg = al < -0.5 * dist ? -1 : 1;
      return { g: sg * dist * STRIDE / (a * STRIDE + (1 - a) * SIDE_STEP), along: a, lat: sg * lt / dist };
    };
    // (How far through the walk cycle the worker's feet have gone on a carry's rigid walks by T,
    // as gaitOf counts it: towards the driver, back away from them, and side-stepping round them.)
    const rigidWalked = (r: typeof runs[number], T: number) => {
      let w = 0;
      for (let k = r.i0; k <= r.i1; k++) {
        const q = plan[k];
        if (!q.mate || start[k] > T) continue;
        const [m0, m1] = q.mate, f = Math.min(1, (T - start[k]) / q.len);
        const tx = (q.a![0] + q.b![0]) / 2 - (m0[0] + m1[0]) / 2, tz = (q.a![2] + q.b![2]) / 2 - (m0[1] + m1[1]) / 2;
        w += gaitOf(m1[0] - m0[0], m1[1] - m0[1], tx, tz).g * f;
      }
      return w;
    };
    const mateOn = (r: typeof runs[number], T: number): [number, number, number, number, number, number, number] => {   // (x, z, walked (gaitOf), speed, heading, along, lat: gaitOf's)
      // (Held rigid now, or since: from there.)
      let rk = -1, k0 = -1;
      for (let k = r.i0; k <= r.i1; k++) if (plan[k].mate && start[k] <= T) { rk = k; if (k0 < 0) k0 = k; }
      // (Stepping on from where the walk before them left the feet.)
      const lead = k0 > r.i0 ? mateOn(r, start[k0] - 1e-4) : null, base = lead ? lead[2] : 0;
      if (rk >= 0 && T < end(rk)) {
        // (The first of a run of rigid walks after following: from where the following left them.)
        const after = rk > r.i0 && !plan[rk - 1].mate ? (rk === k0 ? lead! : mateOn(r, start[rk] - 1e-4)) : null;
        const [x, z] = rigidAt(rk, T, after ? [after[0], after[1]] : undefined), d = samplePath(path, T, this.ps1), q = plan[rk], v = Math.hypot(q.mate![1][0] - q.mate![0][0], q.mate![1][1] - q.mate![0][1]) / q.len;
        const gs = gaitOf(q.mate![1][0] - q.mate![0][0], q.mate![1][1] - q.mate![0][1], d.x - x, d.z - z);
        return [x, z, base + rigidWalked(r, T), v, Math.atan2(-(d.z - z), d.x - x), gs.along, gs.lat];
      }
      const w0 = rk >= 0 ? base + rigidWalked(r, end(rk)) : 0;
      const [t0] = rk >= 0 ? [end(rk)] : span(r), s0 = rk >= 0 ? rigidAt(rk, end(rk)) : startOf(r);
      const d0 = samplePath(path, t0, this.ps1);
      let mx = s0[0], mz = s0[1], walked = w0, k = 0, step = 0, heading = NaN, along = 1, lat = 0;
      const len0 = Math.hypot(mx - d0.x, mz - d0.z), trail: number[] = [mx, mz, d0.x, d0.z];
      for (let tt = t0; tt < T - 1e-6;) {
        const t1 = Math.min(T, tt + MATE_DT), dt = t1 - tt; tt = t1;
        const d = samplePath(path, tt, this.ps1), len = len0 + (back - len0) * Math.min(1, (tt - t0) / MATE_SETTLE);
        trail.push(d.x, d.z);
        // (The last footstep at least the load's length from the driver, and the way on from it
        // to where the next is nearer: as far along that as is that far.)
        const far = (i: number) => Math.hypot(trail[2 * i] - d.x, trail[2 * i + 1] - d.z);
        const n = trail.length / 2 - 1;
        while (k < n - 1 && far(k + 1) >= len) k++;
        let gx = trail[2 * k], gz = trail[2 * k + 1];
        const f0 = far(k), f1 = far(k + 1);
        if (f0 > len && f1 < len) { const f = (f0 - len) / (f0 - f1); gx += (trail[2 * k + 2] - gx) * f; gz += (trail[2 * k + 3] - gz) * f; }
        let sx = gx - mx, sz = gz - mz;
        const st = Math.hypot(sx, sz), cap = MATE_V * dt;
        if (st > cap) { sx *= cap / st; sz *= cap / st; }
        // (Counted forwards going the way they face, towards the driver, back going away, and
        // side-stepping across it: gaitOf. The shares eased over a few steps, as crewpath.ts shares.)
        const gs = gaitOf(sx, sz, d.x - mx, d.z - mz);
        walked += gs.g; mx += sx; mz += sz;
        if (Math.hypot(sx, sz) > 1e-4) { along += (gs.along - along) * 0.3; lat += (gs.lat - lat) * 0.3; }
        step = Math.hypot(sx, sz) / dt; if (step > 1e-3) heading = Math.atan2(-(d.z - mz), d.x - mx);
      }
      return [mx, mz, walked, step, heading, along, lat];
    };
    // On a carry, or at the fetch or stow either side of it: holding the far end.
    for (const r of runs) {
      const [t0, t1] = span(r);
      if (tc < t0 || tc >= t1) continue;
      // Through a doorway, turned round in there (a flip fetch). Leaving a load: in after the
      // driver with it, out of sight, and back out behind them (to stay in after the last).
      // Taking one up: in there with its far end until it comes out, the driver backing ahead.
      const fq = flipAt(r.post), fp = flipAt(r.pre);
      if (fq && idx === r.post && t / fq.len >= FLIP_HIDE) {
        const u = t / fq.len;
        if (u <= 1 - FLIP_HIDE || r === runs[runs.length - 1]) { hp.root.visible = false; return; }
        const [x, z] = inward(fq, MATE_TRAIL, this.drv), q = this.spotFor(fq);
        place(x, z, (fq.face ?? 0) + Math.PI, walkPose(Math.hypot(this.drv[0] - q[0], this.drv[2] - q[2]) / STRIDE + 0.5, idlePose(this.time, this.tmpPose)), false);
        return;
      }
      if (fp && idx === r.pre) {
        const u = t / fp.len, q = this.spotFor(fp);
        if (u < 1 - FLIP_HIDE) { hp.root.visible = false; return; }
        const [x, z] = inward(fp, back, this.drv);
        place(x, z, (fp.face ?? 0) + Math.PI, armsOn(walkPose(-Math.hypot(this.drv[0] - q[0], this.drv[2] - q[2]) / STRIDE + 0.5, idlePose(this.time, this.tmpPose), false)), true);
        return;
      }
      const [x, z, walked, step, heading, along, lat] = mateOn(r, tc);
      // (Walking only while they step, on the carry or following the load through a doorway at
      // either end of it: waiting for the driver to come round, they stand.)
      const moving = step > 0.05 && (c.kind === "walk" || idx === r.pre || idx === r.post);   // (m/s)
      // (Facing the load, which hangs between the two: towards the driver; the driver passing
      // close by, the way they last faced it. Going across it, turned towards where they go,
      // mateTurn, by the way they go over a moment either side.)
      let yaw = Math.hypot(this.drv[0] - x, this.drv[2] - z) > 0.3 || Number.isNaN(heading) ? Math.atan2(-(this.drv[2] - z), this.drv[0] - x) : heading;
      if (moving) {
        const p0 = mateOn(r, Math.max(span(r)[0], tc - MATE_LOOK)), p1 = mateOn(r, Math.min(span(r)[1], tc + MATE_LOOK)), vx = p1[0] - p0[0], vz = p1[1] - p0[1];
        if (Math.hypot(vx, vz) > 0.05) yaw += mateTurn(Math.atan2(Math.sin(Math.atan2(-vz, vx) - yaw), Math.cos(Math.atan2(-vz, vx) - yaw)));
      }
      // (Walking, or side-stepping what's left across the way they face: as the driver does, update.)
      const P = idlePose(this.time, this.tmpPose);
      if (moving) {
        const cyc = along * STRIDE + (1 - along) * SIDE_STEP, across = Math.min(1, Math.abs(lat)), ph = walked / STRIDE + 0.5;
        walkPose(ph, P, false, cyc * along / STRIDE);
        sideStepPose(ph, P, Math.atan2(cyc * across / 4, HIP_Y), Math.sign(lat), Math.min(1, across * 1.5));
      }
      place(x, z, yaw, armsOn(P), true, moving);
      return;
    }
    // Between carries: from where the last one ended to where the next begins, arriving just in time.
    let prev: typeof runs[number] | null = null, next: typeof runs[number] | null = null;
    for (const r of runs) { const [t0, t1] = span(r); if (t1 <= tc) prev = r; else if (!next && t0 > tc) next = r; }
    // (Where each carry left and will take the worker: as on the carry itself.)
    const endOf = (r: typeof runs[number]) => flipAt(r.post) ? inward(flipAt(r.post)!, MATE_TRAIL) : mateOn(r, span(r)[1]).slice(0, 2) as [number, number];
    const A: [number, number] = prev ? endOf(prev) : entry;
    const B: [number, number] = next ? startOf(next) : entry;
    const tA = prev ? span(prev)[1] : 0, tB = next ? span(next)[0] : end(plan.length - 1);
    // (With no door, the walk in and out along the pavement past the truck's side, to a point by
    // the kerb level with the next load's far end (the ramp's foot, for one in the bed), and on.)
    const kerbWalk = this.noDoor() && !dock && (!prev || !next) && !(next && inDoor(next));
    const inBed = (p: [number, number]) => p[0] >= L.bedRear - 0.05 && Math.abs(p[1]) < L.hw;
    const byKerb = (p: [number, number]): [number, number] => [inBed(p) ? L.bedRear - L.rampRun - 1 : p[0], entry[1]];
    const route = kerbWalk && !prev ? [entry, ...this.teamRoute(L, dock, byKerb(B), B, load.size[2])]
      : kerbWalk && !next ? [...this.teamRoute(L, dock, A, byKerb(A), load.size[2]), entry]
      : this.teamRoute(L, dock, A, B, load.size[2]);
    // (In to take up the next load through the doorway it comes out of: by the spot before it.)
    if (next && inDoor(next)) { const f = plan[next.pre], q = this.spotFor(f); route.splice(route.length - 1, 0, [q[0], q[2]]); }
    const legs: number[] = [];
    let len = 0;
    for (let k = 1; k < route.length; k++) { legs.push(Math.hypot(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1])); len += legs[k - 1]; }
    // Distance along the route at time tc. Out of the bed: straight away (ahead of the driver).
    // Into it: up to the ramp's foot first, then in only once the driver is inside, arriving as
    // the lift starts. Otherwise: arriving just in time.
    // (Walking in from the street and away at the end, an easy pace, setting off in good time.)
    const V = prev && next ? 1.7 : 1.3;
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
      const t2 = Math.max(tIn, tB - inLen / V), t1 = Math.min(t2, tIn), t0 = prev && flipAt(prev.post) ? Math.min(tA, t1) : Math.max(tA, t1 - outLen / V);   // (out of a doorway: on, not waiting in it)
      // (Walking in along the kerb: setting off just after the truck stops, to wait by the kerb,
      // clear of where the ramp comes down, and on to its foot in time to follow the driver up.)
      const a = kerbWalk && !prev ? Math.min(legs[0], outLen) : 0, tK = tA + WALK_IN_AFTER + a / V, tL = Math.max(tK, t1 - (outLen - a) / V);
      sAt = (T) => a && T < tL ? leg(T, 0, a, tA + WALK_IN_AFTER, tK) : T < t2 ? leg(T, a, outLen, a ? tL : t0, t1) : leg(T, outLen, len, t2, tB);
      begun = tc > (a ? tA + WALK_IN_AFTER : t0); done = tc >= tB;
    } else {
      const dur = Math.min(len / V, Math.max(0.01, tB - tA)), ts = kerbWalk && !prev ? Math.min(tA + WALK_IN_AFTER, tB - dur) : Math.max(tA, tB - dur);
      sAt = (T) => leg(T, 0, len, ts, ts + dur); begun = tc > ts; done = tc >= tB;
    }
    const sTot = sAt(tc);
    let s = sTot;
    // (Indoors: at a kerb stop, before the first carry and after the last; at a dock, where they
    // stand on the platform, only once they've gone in with the last load.)
    const gone = !next && !!flipAt(prev!.post), before = !prev && (!begun || !!flipAt(next!.pre)), after = !next && done;
    if (gone || (!dock && (before || after))) { hp.root.visible = false; return; }
    let i = 0;
    while (i < legs.length - 1 && s > legs[i]) { s -= legs[i]; i++; }
    const p0 = route[i], p1 = route[i + 1] ?? route[i], f = legs[i] ? Math.min(1, s / legs[i]) : 1;
    const x = p0[0] + (p1[0] - p0[0]) * f, z = p0[1] + (p1[1] - p0[1]) * f;
    const walking = Math.abs(sTot - sAt(tc - 0.1)) > 1e-3;   // not while waiting at the ramp's foot
    const yaw = walking ? Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]) : Math.atan2(-(this.drv[2] - z), this.drv[0] - x);   // waiting: watching the driver
    place(x, z, yaw, walking ? walkPose(sTot / STRIDE, idlePose(this.time, this.tmpPose)) : idlePose(this.time, this.tmpPose), false);
  }

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
  // (In the bed, along the aisle on the left, clear of loads `w` wide down its middle, and across
  // only level with where they're going.)
  private teamRoute(L: TruckLayout, dock: boolean, A: [number, number], B: [number, number], w: number): [number, number][] {
    const inBed = (p: [number, number]) => p[0] >= L.bedRear - 0.05 && Math.abs(p[1]) < L.hw;
    const sill: [number, number] = [L.bedRear + 0.4, 0], foot: [number, number] = [L.bedRear - L.rampRun - 0.4, 0];
    const zA = -Math.min(L.hw - 0.35, w / 2 + 0.42), aisle = (x: number): [number, number] => [x, zA];
    const along = (p: [number, number], q: [number, number]): [number, number][] => Math.abs(p[0] - q[0]) > 1 ? [aisle(p[0]), aisle(q[0])] : [];
    const a = inBed(A), b = inBed(B);
    if (a === b) return a ? [A, ...along(A, B), B] : [A, B];
    if (dock) return b ? [A, sill, ...along(sill, B), B] : [A, ...along(A, sill), sill, B];
    return b ? [A, foot, sill, ...along(sill, B), B] : [A, sill, foot, B];
  }
  // The load between the two carriers' hands: centred between them, tilted from one to the other.
  private teamLoad(truck: Truck, load: CarriedLoad, high = false, flip = false) {
    // The load along the line from the worker to the driver, each end a body's depth (TEAM_CLEAR)
    // from its carrier, so neither stands inside it whichever way they face; its ends at the two
    // carriers' hand height, tilted from one to the other (up the ramp).
    const d = this.drv, m = this.mate, grip = Math.min(load.size[1] / 2, 0.65);
    const dx = d[0] - m.x, dz = d[2] - m.z, flat = Math.hypot(dx, dz) || 1, ax = dx / flat, az = dz / flat;
    // (On a slope the one below holds their end high and the one above low, to keep it level.)
    const lv = THREE.MathUtils.clamp((m.y - d[1]) / 2, -0.34, 0.34);
    const hands = high ? TEAM_SHOULDER : TEAM_HANDS, hy = d[1] + hands + lv, gy = m.y + hands - lv, pitch = Math.atan2(hy - gy, Math.max(0.3, flat - 2 * TEAM_CLEAR));
    const yaw = Math.atan2(-az, ax) + (flip ? Math.PI : 0), tilt = flip ? -pitch : pitch;   // (turned round: its tilt the other way in its own frame)
    // Tilted, its ends lean: the top of the lower end and the foot of the upper one come back
    // towards their carriers; centred between those so each keeps its clearance (teamMate spaces
    // the two that much further apart).
    const sp = Math.sin(pitch), lean = ((load.size[1] - grip) - grip) / 2 * Math.abs(sp) * Math.sign(-sp);
    const cx = (d[0] + m.x) / 2 + ax * (sp * grip - lean), cz = (d[2] + m.z) / 2 + az * (sp * grip - lean), cy = (hy + gy) / 2 - Math.cos(pitch) * grip;
    truck.root.updateMatrixWorld();
    load.group.visible = true;
    load.group.position.set(cx, cy, cz).applyMatrix4(truck.root.matrixWorld);
    load.group.rotation.set(0, truck.heading + yaw, tilt, "YXZ");
  }


  // Seated at the wheel of `truck`.
  private seat(truck: Truck, pose: BodyPose) {
    const L = truckLayout(truck.model);
    this.inSeat = true;
    this.driver.apply(pose);
    this.place(truck, L.seat.x, L.seat.y - CHARACTER_HIP_Y, L.seat.z, 0);
    this.yaw = 0; this.yawV = 0;
  }

  // Climbing down from the cab (or up into it), `t` seconds into a chore of `len`; returns how far
  // the cab door is open (Truck.cabDoor), which the hands work: climbDoor and the keys below agree.
  // Up: from beside the door (clear of its swing) reach for the handle and pull it open, let it
  // swing, step to the steps with a hand on each grab handle, climb them a foot at a time, duck
  // in, lean out for the door's inside handle and pull it shut as the driver sits. Down: push
  // the door open from the seat, stand and turn to face in, climb down facing the cab (three
  // points on it), step out round the door and push it shut.
  private climb(truck: Truck, t: number, len: number, up: boolean): number {
    const L = truckLayout(truck.model), g = cabGeom(truck.model), P = this.pose, d = this.driver;
    const keys = climbKeys(truck.model, up);
    const T = t * keys[keys.length - 1].t / len;
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= T) i++;
    const A = keys[i], B = keys[i + 1], f = THREE.MathUtils.clamp((T - A.t) / (B.t - A.t), 0, 1), e = ease(f);
    const door = doorBlend(A, B, f);
    const x = A.root[0] + (B.root[0] - A.root[0]) * e, y = A.root[1] + (B.root[1] - A.root[1]) * e, z = A.root[2] + (B.root[2] - A.root[2]) * e;
    const yaw = A.root[3] + wrapYaw(B.root[3] - A.root[3]) * e;
    const seat = A.seat + (B.seat - A.seat) * e;
    // The body: seated, or standing (stooped under the cab's roof, leaning out for the door),
    // stepping when the feet move on the ground.
    blendPose(idlePose(this.time, this.tmpPose), seatedPose(restPose()), seat, P);
    const lean = A.lean + (B.lean - A.lean) * e;
    P.bend += lean; P.drop += (A.duck + (B.duck - A.duck) * e) * (1 - seat); P.twist = (A.twist + (B.twist - A.twist) * e);
    const moving = Math.hypot(B.root[0] - A.root[0], B.root[2] - A.root[2]) > 0.05 && !A.lf && !B.lf && !A.rf && !B.rf && seat < 0.01;
    if (moving) { const legs = walkPose(f * Math.hypot(B.root[0] - A.root[0], B.root[2] - A.root[2]) / STRIDE * 2, { ...P }, false, 0.7); P.hipL = legs.hipL; P.hipR = legs.hipR; P.knL = legs.knL; P.knR = legs.knR; }
    d.apply(P);
    this.place(truck, x, y, z, yaw);
    this.yaw = yaw; this.yawV = 0;
    this.drv[0] = x; this.drv[1] = y; this.drv[2] = z; this.drv[3] = yaw;
    truck.root.updateMatrixWorld();
    const M = truck.root.matrixWorld;
    // Feet: where the keys put them (a step, the cab floor), lifted over the edge between; planted
    // on the ground under the hips otherwise. (Seated, the legs keep the seated pose.)
    if (seat < 0.5) for (const side of ["L", "R"] as const) {
      const fa = side === "L" ? A.lf : A.rf, fb = side === "L" ? B.lf : B.rf, lat = side === "L" ? -0.1 : 0.1;
      if (!fa && !fb) { if (!moving) { this.footUnder(truck, x, y, z, yaw, lat, this.v3); d.step(side, this.v3, P); } continue; }
      const pa = fa ?? this.footAt(x, y, z, yaw, lat), pb = fb ?? this.footAt(x, y, z, yaw, lat);
      const lift = fa && fb && (fa[0] !== fb[0] || fa[1] !== fb[1] || fa[2] !== fb[2]) ? 0.12 * Math.sin(Math.PI * e) : (fa !== fb ? 0.1 * Math.sin(Math.PI * e) : 0);
      this.v3.set(pa[0] + (pb[0] - pa[0]) * e, pa[1] + (pb[1] - pa[1]) * e + lift, pa[2] + (pb[2] - pa[2]) * e).applyMatrix4(M);
      d.step(side, this.v3, P);
    }
    // Hands: on the door's handles, the grab handles, or free; sliding from one to the next.
    for (const side of ["L", "R"] as const) {
      const ha = side === "L" ? A.lh : A.rh, hb = side === "L" ? B.lh : B.rh;
      const wa = ha ? 1 : 0, wb = hb ? 1 : 0, w = wa + (wb - wa) * e;
      if (w <= 0.001) continue;
      const pa = ha ? cabGrip(g, ha, door) : null, pb = hb ? cabGrip(g, hb, door) : null, q = pa ?? pb!, r = pb ?? pa!;
      const k = pa && pb ? e : 0;
      this.v3.set(q[0] + (r[0] - q[0]) * k, q[1] + (r[1] - q[1]) * k, q[2] + (r[2] - q[2]) * k).applyMatrix4(M);
      d.reach(side, this.v3, P, w);
    }
    return door;
  }
  // Up into a trailer at its back from the road, or down out of it (backwards, the same moves):
  // hands on the floor's edge, a foot up on the underride guard, up onto it, the other foot up
  // onto the floor, the first back out and up after it; the keys (bedClimbKeys) say where the body, the feet and the hands are.
  private bedClimb(truck: Truck, c: Chore, u: number) {
    const L = truckLayout(truck.model), P = this.pose, d = this.driver, keys = bedClimbKeys(L, c.a![2]);
    const T = c.kind === "bedUp" ? u : 1 - u;
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= T) i++;
    const A = keys[i], B = keys[i + 1], e = ease(THREE.MathUtils.clamp((T - A.t) / (B.t - A.t), 0, 1));
    const mix = (a: number, b: number) => a + (b - a) * e;
    const x = mix(A.root[0], B.root[0]), y = mix(A.root[1], B.root[1]), z = mix(A.root[2], B.root[2]), yaw = 0;
    idlePose(this.time, P);
    P.bend += mix(A.lean, B.lean); P.drop += mix(A.duck, B.duck);
    d.apply(P);
    this.place(truck, x, y, z, yaw);
    this.yaw = yaw; this.yawV = 0;
    this.drv[0] = x; this.drv[1] = y; this.drv[2] = z; this.drv[3] = yaw;
    this.feetY = y;
    truck.root.updateMatrixWorld();
    const M = truck.root.matrixWorld;
    for (const side of ["L", "R"] as const) {
      const fa = side === "L" ? A.lf : A.rf, fb = side === "L" ? B.lf : B.rf, lat = side === "L" ? -0.1 : 0.1;
      const pa = fa ?? this.footAt(x, y, z, yaw, lat), pb = fb ?? this.footAt(x, y, z, yaw, lat);
      const lift = fa !== fb ? 0.12 * Math.sin(Math.PI * e) : 0;
      this.v3.set(mix(pa[0], pb[0]), mix(pa[1], pb[1]) + lift, mix(pa[2], pb[2])).applyMatrix4(M);
      d.step(side, this.v3, P);
    }
    for (const side of ["L", "R"] as const) {
      const ha = side === "L" ? A.lh : A.rh, hb = side === "L" ? B.lh : B.rh;
      const w = mix(ha ? 1 : 0, hb ? 1 : 0);
      if (w <= 0.001) continue;
      const q = ha ?? hb!, r = hb ?? ha!;
      this.v3.set(mix(q[0], r[0]), mix(q[1], r[1]), mix(q[2], r[2])).applyMatrix4(M);
      d.reach(side, this.v3, P, w);
    }
  }
  // A foot's point under the hips (truck frame), `lat` to the side, on the ground there.
  private footAt(x: number, y: number, z: number, yaw: number, lat: number): [number, number, number] {
    return [x + Math.sin(yaw) * lat + Math.cos(yaw) * 0.02, y, z + Math.cos(yaw) * lat - Math.sin(yaw) * 0.02];
  }
  // Walking across the kerb, the body goes up or down onto the pavement as its middle crosses the
  // edge (kerbY): a foot ahead of it on the pavement while the body is still in the street is
  // lifted onto the kerb's top rather than left in it.
  private feetOnKerb(ch: Character, truck: Truck, P: BodyPose) {
    if (!this.kerbEdge) return;
    const M = truck.root.matrixWorld, inv = this.kerbM.copy(M).invert();
    for (const side of ["L", "R"] as const) {
      const q = ch.sole(side, this.kerbV).applyMatrix4(inv), g = this.kerbY(q.x, q.z);
      if (q.y < g - 0.005) { q.y = g; ch.step(side, q.applyMatrix4(M), P); }
    }
  }
  // The worker's hands on their end of a team lift (gm, world points): stooping and crouching to
  // it as the driver does (stoopFor), set down or taken up from the ground; walking, a stride
  // about that crouch; standing, the feet planted.
  private mateHands(truck: Truck, gm: { L: THREE.Vector3; R: THREE.Vector3 }) {
    const hp = this.helper, P = this.tmpPose, m = this.mate;
    truck.root.updateMatrixWorld();
    const inv = this.m4.copy(truck.root.matrixWorld).invert();
    let h = 0, ahead = 0;
    for (const g of [gm.L, gm.R]) { const q = this.v4.copy(g).applyMatrix4(inv); h += (q.y - m.y) / 2; ahead += ((q.x - m.x) * Math.cos(m.yaw) - (q.z - m.z) * Math.sin(m.yaw)) / 2; }
    const S = stoopFor({ ...P }, h, ahead);
    P.bend = S.bend; P.drop = S.drop; P.headP = S.headP;
    if (m.walking) { const [hc, kc] = crouchLegs(P.drop); P.hipL += hc; P.hipR += hc; P.knL += kc; P.knR += kc; }
    hp.apply(P);
    if (!m.walking) for (const [side, lat] of [["L", -0.1], ["R", 0.1]] as const) { this.footUnder(truck, m.x, m.y, m.z, m.yaw, lat, this.v3); hp.step(side, this.v3, P); }
    hp.reach("L", gm.L, P); hp.reach("R", gm.R, P);
  }
  private footUnder(truck: Truck, x: number, y: number, z: number, yaw: number, lat: number, out: THREE.Vector3) {
    const p = this.footAt(x, y, z, yaw, lat);
    return out.set(p[0], p[1], p[2]).applyMatrix4(truck.root.matrixWorld);
  }

  // The truck change at a country truck stop, `t` seconds into the stop; the journey hands over
  // to the spare at `half`. Before it, `truck` is the old one and `other` the spare; after it,
  // `truck` is the new one.
  private truckStopSwap(t: number, half: number, truck: Truck, other: Truck | null, k: { cab: number; otherCab: number }) {
    const CL = DWELL.exit, CU = DWELL.enter;
    if (t < CL) { k.cab = this.climb(truck, t, CL, false); return; }
    if (t < half) {
      if (!other) { this.climb(truck, CL, CL, false); return; }
      const p = truck.anchors.cabDoorGround.getWorldPosition(this.v), b = other.anchors.cabDoorGround.getWorldPosition(this.v2);
      const len = Math.max(0.5, half - CL), u = swapWalkU(t - CL, len);
      swapClear(p.lerp(b, u), truck, other, u);
      this.walkBetween(truck, other, p, t - CL, len);
      return;
    }
    if (t < half + CU) { k.cab = this.climb(truck, t - half, CU, true); return; }
    this.seat(truck, seatedPose(this.pose, 0));
  }

  // Walking from the old truck's door to the new one's (world space; the camera follows the
  // same point, see swapWalkPoint).
  private swapWalk(j: Journey, oldT: Truck, newT: Truck, t: number, len: number) {
    this.walkBetween(oldT, newT, swapWalkPoint(j, oldT, newT, this.v), t, len);
  }
  // The driver at `p` on a truck change's walk, `t` seconds into it (swapWalkU): turning from
  // where the climb down left them to face along the street, striding (the legs keeping time
  // with the ground covered, easing in and out with the pace), and turning as they slow at the
  // new door to face its handle, as the climb in starts.
  private walkBetween(oldT: Truck, newT: Truck, p: THREE.Vector3, t: number, len: number) {
    const u = swapWalkU(t, len), pace = swapWalkPace(t, len), ss = THREE.MathUtils.smoothstep;
    this.driver.apply(walkPose(this.swapWalked(oldT, newT, u) / STRIDE, idlePose(this.time, this.pose), true, pace));
    const out = climbKeys(oldT.model, false), y0 = oldT.heading + out[out.length - 1].root[3];
    const y2 = newT.heading + climbKeys(newT.model, true)[0].root[3];
    let yaw = y0 + wrapYaw(oldT.heading - y0) * ss(u, 0, 0.12);
    yaw += wrapYaw(y2 - yaw) * ss(u, 0.8, 1);
    this.yaw = yaw; this.yawV = 0;
    this.driver.root.position.copy(p);
    this.driver.root.rotation.set(0, yaw, 0);
  }

  // The ground covered `u` of the way along a truck change's walk: along swapClear's path, out
  // round the wider truck and back in (the stride keeps time with it).
  private swapWalked(oldT: Truck, newT: Truck, u: number): number {
    const a = oldT.anchors.cabDoorGround.getWorldPosition(this.v3), b = newT.anchors.cabDoorGround.getWorldPosition(this.v4);
    const N = 24, q = this.v5, r = this.v6;
    let d = 0;
    r.copy(a);
    for (let i = 1; i <= N; i++) {
      const w = Math.min(u, i / N);
      swapClear(q.copy(a).lerp(b, w), oldT, newT, w);
      d += Math.hypot(q.x - r.x, q.z - r.z);
      r.copy(q);
      if (w >= u) break;
    }
    return d;
  }

  // Chores on foot around the parked truck. The driver's place and facing come from the stop's
  // planned path (crewpath.ts) except where a chore sets them exactly (the roll-up door, the
  // ramp's end, a lift-gate ride); the body is posed for the chore, then whatever is in hand is
  // placed (on its wheels on the ground, or held) and the body stoops and the hands reach for it.
  private work(c: Chore, t: number, u: number, truck: Truck, dt: number, stop: Stop) {
    const d = this.driver, L = truckLayout(truck.model), P = this.pose;
    const path = this.crewPath(truck, stop), ps = samplePath(path, path.starts[this.plan.indexOf(c)] + t, this.ps);
    let x = ps.x, z = ps.z, y = 0, yaw = ps.yaw, walking = ps.speed > 0.04, stepping = false;   // (any drift takes steps: planted feet would skate)
    this.walkPhase = (ps.gait ?? ps.steps) / STRIDE;
    idlePose(this.time, P);
    const doorChore = c.kind === "doorOpen" || c.kind === "doorClose";
    if (c.kind === "walk" || c.kind === "gateRide") {
      const a = c.a!, b = c.b!;
      // (A walk in a run with the hand truck (crewpath.ts wheelWalk) is placed by the run, not by
      // how far through the walk it is: at the ground under the driver, the ramp or the bed's floor.)
      const run = !Number.isNaN(ps.lead ?? NaN) && !this.docked;
      y = c.kind === "gateRide" ? this.gateY(L, c.dir === "up" ? 1 - ease(u) : ease(u)) : c.linear && !run ? a[1] + (b[1] - a[1]) * u : this.ground(L, x, z, DRIVER_INSET);
      if (c.kind === "gateRide") walking = false;
      if (c.over) {
        // Over a load on hands and knees: up onto it, across its top, down off its far side.
        const k = ease(Math.min(1, u / CLIMB_UP, (1 - u) / CLIMB_UP));
        y += c.over * k;
        if (k > 0.02) { crawlPose(P, this.walkPhase, k); walking = false; }
      }
    } else if (c.kind === "rampOut" || c.kind === "rampIn") {
      // Holding the ramp's end, a step behind it: walking back as it slides out, crouching as it
      // is set down (rampIn: lifting it and walking it back in).
      const r = rampControl(c.kind, u), tip = rampTip(L, r);
      x = tip[0] - RAMP_HOLD; z = 0; yaw = 0; y = 0;
      this.walkPhase = (tip[0] - L.bedRear) / STRIDE;   // (facing the truck: backing as it slides out, the cycle running back)
      walking = r > 0.01 && r < 0.64;
    } else if (c.kind === "doorOpen" || c.kind === "doorClose") {
      // At the door: the hands hold its bottom edge, or its strap while that is out of reach; the
      // door's opening follows the hands, and the arms are solved to reach it.
      const at = this.spotFor(c);
      x = at[0]; y = at[1]; z = at[2]; yaw = 0; walking = false;
      const g = truck.doorGeom();
      if (g) {
        // A step up to the middle of the door first, and back at the end.
        const T = u * c.len, w = ease(T / DOOR_STEP) * (1 - ease((T - c.len + DOOR_STEP) / DOOR_STEP));
        const sx = g.x - DOOR_STAND - x, sz = -z;
        x += sx * w; z += sz * w;
        this.doorNow = doorMotion(c.kind, T, c.len, x, y, g, idlePose(this.time, P));
        const far = Math.hypot(sx, sz);
        if (far > 0.05 && w > 0 && w < 1) {   // the legs take the step
          stepping = true;
          const step = T < c.len / 2 ? w : 2 - w, legs = walkPose(step / 2, { ...P }, false, Math.min(1, far / 0.35));
          P.hipL += legs.hipL; P.hipR += legs.hipR; P.knL += legs.knL; P.knR += legs.knR;
        }
      } else { idlePose(this.time, P); this.doorNow = doorControl(c.kind, u); }
    } else {
      // Stationary: where the path has the driver (the spot of the chore, or a step from it).
      y = this.ground(L, x, z, DRIVER_INSET);
      if (c.kind === "wait" && !c.tool) gesturePose(c.gesture ?? "clipboard", t, P);
      // (Pumping the jack's handle: down and up, a bob in the knees with each stroke.)
      if (c.kind === "jackUp") P.drop += 0.06 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2 * 1.6)) * (1 - THREE.MathUtils.smoothstep(u, 0.85, 1));
    }
    // (Going sideways, round the hand truck's wheels say: side-stepping. A cycle covers less
    // ground the more across the facing the way goes (crewpath.ts gait); each foot swung fore and
    // aft, and out and back, by its share of that, planted through the same half of the cycle.)
    if (walking) {
      // (Turning on the spot, pivot: short steps, the feet under the hips, the knees lifting them.)
      const ramp = c.kind === "rampOut" || c.kind === "rampIn", a = ramp ? 1 : ps.along, b = ramp ? 0 : ps.lat ?? 0, pv = ramp ? 0 : ps.pivot ?? 0;
      const cyc = a * STRIDE + (1 - a) * SIDE_STEP, across = Math.min(1, Math.abs(b));
      walkPose(this.walkPhase, P, true, cyc * a / STRIDE * (1 - 0.8 * pv));
      const dirSign = ps.gait !== undefined && ps.gait < this.lastGait ? -1 : 1;
      sideStepPose(this.walkPhase, P, Math.atan2(cyc * across / 4, HIP_Y) * (1 - pv), Math.sign(b) * dirSign, Math.max(Math.min(1, across * 1.5) * (1 - pv), 0.7 * pv));
    }
    this.lastGait = ps.gait ?? 0;
    d.apply(P);
    this.place(truck, x, y, z, yaw);
    this.yaw = yaw; this.yawV = 0;
    this.drv[0] = x; this.drv[1] = y; this.drv[2] = z; this.drv[3] = yaw;
    // In through a facility's doorway (a flip fetch: not just a lean into it), from when the front
    // of the body, 0.3 m ahead, is at its wall (the dock's behind its platform, or a kerb door's,
    // KERB in from the kerb's edge): the buildings stay solid.
    if (c.kind === "fetch" && c.flip) {
      const k = this.kerb;
      const out = this.docked ? x - (L.rear - DOCK_DEPTH) : k ? (x - k.x) * k.nx + (z - k.z) * k.nz + KERB : Infinity;
      this.indoors = out < 0.3;
    }
    this.feetY = y;
    this.mate.attached = false; this.wL = this.wR = 0; this.gripMate = null; this.pushLean = 0; this.hunch = 0;
    if (CARGO_BY_ID.get(stop.cargo)?.handling === "teamLift") this.teamMate(c, t, truck, stop);
    if (c.kind === "walk" && c.round) {
      // Walking round what's held: it turns about itself where it is, whoever is how near (placed
      // as from a driver that far off it, facing it). A crate that stays put: as it was from the
      // end the driver left, then from the end they come to, and let go of on the way round.
      const r = roundAt(L, c, u), sx = this.drv[0], sz = this.drv[2], sy = this.drv[3];
      const fy = c.roundStill ? Math.atan2(-(r.cz - c.a![2]), r.cx - c.a![0]) + (u > 0.5 ? Math.PI : 0) : yaw;
      // (Blended in over the first second or so from where the driver really holds it as they set
      // off, and back out as they come round, so it is where they hold it either side of the walk
      // round: brought round to where it is turned, not jumping there.)
      const w = THREE.MathUtils.smoothstep(Math.min(1, ROUND_BLEND * Math.sin(Math.PI * u)), 0, 1);
      const vx = r.cx - Math.cos(fy) * r.r, vz = r.cz + Math.sin(fy) * r.r;
      if (c.tool === "handTruck" && !c.roundStill) {
        // (A hand truck stays on its wheels, there, the driver walking round them holding it,
        // nearer and more upright where there is no room to go wider: turned, never slid.)
        const d = Math.hypot(r.cx - sx, r.cz - sz);
        this.htLead = Math.max(0.6, d);
        if (d > 0.05) this.drv[3] = Math.atan2(-(r.cz - sz), r.cx - sx);
      } else { this.drv[0] = sx + (vx - sx) * w; this.drv[2] = sz + (vz - sz) * w; this.drv[3] = sy + Math.atan2(Math.sin(fy - sy), Math.cos(fy - sy)) * w; }
      this.props(c, t, u, truck, stop);
      this.drv[0] = sx; this.drv[2] = sz; this.drv[3] = sy; this.htLead = HT_LEAD;
      if (c.roundStill) { const k = THREE.MathUtils.clamp(Math.abs(Math.cos(Math.PI * u)) * 2 - 1, 0, 1); this.wL *= k; this.wR *= k; }
    } else {
      // (A hand truck walked with as planned, nearer and more upright turning it in a tight spot.)
      if (c.tool === "handTruck" && ps.lead !== undefined && !Number.isNaN(ps.lead)) this.htLead = ps.lead;
      this.props(c, t, u, truck, stop);
      this.htLead = HT_LEAD;
    }
    if (c.kind === "rampOut" || c.kind === "rampIn") this.rampGrips(L, truck, c.kind, u);
    if (c.kind === "leafOpen" || c.kind === "leafClose") {
      // Hands on the swing door's handles, then on its face either side of where it's held.
      const q = leafAt(L, c.leaf ?? 1, c.kind === "leafOpen", u);
      truck.root.updateMatrixWorld();
      // (The hand nearer the hinge on the hinge's side of the body: hands[1] is the nearer.)
      const [a, b] = q.hands, hingeRight = (a[0] - b[0]) * -Math.sin(yaw) + (a[2] - b[2]) * -Math.cos(yaw) > 0;
      this.gripL.set(...(hingeRight ? a : b)).applyMatrix4(truck.root.matrixWorld);
      this.gripR.set(...(hingeRight ? b : a)).applyMatrix4(truck.root.matrixWorld);
      this.wL = this.wR = q.grip;
      P.drop = Math.max(P.drop, 0.3 * q.stoop);
    }
    // The body for what the hands hold: stooping to it, leaning into a push.
    const w = Math.max(this.wL, this.wR);
    if (w > 0.001 && !doorChore) {
      truck.root.updateMatrixWorld();
      const inv = this.m4.copy(truck.root.matrixWorld).invert();
      let h = 0, ahead = 0, n = 0;
      for (const [g, wg] of [[this.gripL, this.wL], [this.gripR, this.wR]] as const) {
        if (wg <= 0) continue;
        const q = this.v4.copy(g).applyMatrix4(inv);
        h += (q.y - y) * wg; ahead += ((q.x - x) * Math.cos(yaw) - (q.z - z) * Math.sin(yaw)) * wg; n += wg;
      }
      h /= n; ahead /= n;
      const S = stoopFor({ ...P }, h, ahead, { lean: this.pushLean });
      P.bend += (S.bend - P.bend) * w; P.drop += (S.drop - P.drop) * w; P.headP += (S.headP - P.headP) * w;
      // (Hunched behind a tall load: knees bent, shoulders rounded, head down.)
      const k = this.hunch * w;
      P.drop = Math.max(P.drop, HUNCH_DROP * k); P.bend -= HUNCH_BEND * k; P.headP += HUNCH_HEAD * k;
    }
    // Legs: walking, a stride about whatever crouch the drop asks for; standing, the feet planted.
    if (walking || stepping) {
      const [hc, kc] = crouchLegs(P.drop);
      P.hipL += hc; P.hipR += hc; P.knL += kc; P.knR += kc;
    }
    d.apply(P);
    if (walking || stepping) this.feetOnKerb(d, truck, P);
    // The head never in what's held: leaning in less, and the head up, until it's clear.
    if (w > 0.001 && this.load?.group.visible) {
      for (let i = 0; i < 8 && this.headInLoad(this.load); i++) { P.bend *= 0.7; P.headP = Math.min(P.headP, 0) * 0.5 - 0.06 * (i + 1); P.twist *= 0.7; d.apply(P); }
    }
    if (!walking && !stepping) {
      for (const [side, lat] of [["L", -0.1], ["R", 0.1]] as const) { this.footUnder(truck, x, y, z, yaw, lat, this.v3); d.step(side, this.v3, P); }
    }
    if (this.wL > 0.001) d.reach("L", this.gripL, P, this.wL);
    if (this.wR > 0.001) d.reach("R", this.gripR, P, this.wR);
    const gm = this.gripMate as { L: THREE.Vector3; R: THREE.Vector3 } | null;   // (set by props)
    if (gm && this.helper.root.visible) this.mateHands(truck, gm);
    // (Inside a doorway, turning round: out of sight, the driver and all they have with them.)
    if (c.kind === "fetch" && c.flip && u > FLIP_HIDE && u < 1 - FLIP_HIDE) {
      d.root.visible = false; this.tools.handTruck.visible = this.tools.palletJack.visible = false;
      if (this.load) this.load.group.visible = false;
    }
  }
  // Whether the driver's head (points round it) is within the load's box, 2 cm in.
  private loadBox = new WeakMap<object, THREE.Box3>();
  private headInLoad(load: CarriedLoad) {
    let box = load.animate ? undefined : this.loadBox.get(load);   // (an animated one: afresh each time)
    if (!box) {
      box = new THREE.Box3();
      const g = load.group, m = new THREE.Matrix4();
      g.traverse((o: any) => {
        if (!o.geometry || o === g) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        m.identity(); for (let q: THREE.Object3D | null = o; q && q !== g; q = q.parent) { q.updateMatrix(); m.premultiply(q.matrix); }
        box!.union(o.geometry.boundingBox.clone().applyMatrix4(m));
      });
      box.expandByScalar(-0.02);
      if (!load.animate) this.loadBox.set(load, box);
    }
    load.group.updateMatrixWorld(true);
    const inv = this.m4.copy(load.group.matrixWorld).invert(), head = this.driver.headNode;
    head.updateMatrixWorld(true);
    for (const [hx, hy] of HEAD_POINTS) if (box.containsPoint(this.v.set(hx, hy, 0).applyMatrix4(head.matrixWorld).applyMatrix4(inv))) return true;
    return false;
  }
  private lastGait = 0;   // (the walk cycle's phase last time: which way it runs)
  private pushLean = 0;   // props: lean into a push this frame (added to the stoop)
  private htLead = HT_LEAD;   // props: the hand truck's wheels this far ahead of the driver this frame
  private hunch = 0;      // props: how far hunched down behind a tall load this frame (0..1)

  // The stop's planned path, worked out once per plan (crewpath.ts).
  private crewPath(truck: Truck, stop: Stop): CrewPath {
    const key = `${truck.model}|${stop.cargo}|${stop.kind}`;
    if (this.path && this.pathPlan === this.plan && this.pathKey === key) return this.path;
    const L = truckLayout(truck.model), cargo = CARGO_BY_ID.get(stop.cargo)!, plan = this.plan;
    const size = CARGO_MODELS[stop.cargo]?.size ?? [0.5, 0.5, 0.5], tool = STYLE[cargo.handling].tool ?? null;
    const exit = cabGround(truck.model, false), enter = cabGround(truck.model, true);
    // (A pallet jack pushed straight on into a doorway, or out of it: walked in, or on out, without
    // stopping at the threshold (flipDepth; crewpath.ts plays the jack's moves either side so).)
    const flowing = new Map<Chore, [boolean, boolean, number?, number?]>();
    plan.forEach((c, i) => { if (c.kind === "fetch" && c.flip && c.tool === "palletJack") flowing.set(c, [jackIntoDoor(plan[i - 1]), jackIntoDoor(plan[i + 1])]); });
    // (A hand truck wheeled on into a doorway, or on out of it, at the pace of the run of walks it
    // comes from or goes on into (crewpath.ts flipHandTruck, wheelAt: even, eased only at its far
    // end): flipDepth's slope there, so it neither slows nor surges at the threshold.)
    const wheeled = (q?: Chore) => !!q && q.kind === "walk" && q.tool === "handTruck" && !q.round && !q.noTurn && !q.backward && !q.jack;
    const runPace = (i: number, step: number) => {
      let d = 0, t = 0;
      for (let k = i; wheeled(plan[k]) && plan[k].forward === plan[i].forward; k += step) { d += Math.hypot(plan[k].b![0] - plan[k].a![0], plan[k].b![2] - plan[k].a![2]); t += plan[k].len; }
      return t > 0 ? d / (t * (1 - Math.min(1 / 3, EASE_T / t) / 2)) : 0;
    };
    const slope = (c: Chore, v: number) => THREE.MathUtils.clamp(v * FLIP_IN * c.len / Math.max(0.1, c.flip ?? 1), 0.3, 3);
    plan.forEach((c, i) => { if (flipHandTruck(c)) { const fi = wheeled(plan[i - 1]), fo = wheeled(plan[i + 1]); flowing.set(c, [fi, fo, fi ? slope(c, runPace(i - 1, -1)) : undefined, fo ? slope(c, runPace(i + 1, 1)) : undefined]); } });
    // (Anyone walking up to a doorway nearly square to it, a team lift backed straight on in too, or
    // out of it on a walk that goes on nearly straight out: in, or out, at the walk's pace, not
    // stopping on the threshold.)
    const afoot = (q?: Chore) => !!q && q.kind === "walk" && !!q.a && !!q.b && !q.tool && !q.mate && !q.round && !q.jack && Math.hypot(q.b[0] - q.a[0], q.b[2] - q.a[2]) > 0.5;
    const square = (q: Chore, f: number, sg: number) => { const dx = q.b![0] - q.a![0], dz = q.b![2] - q.a![2], l = Math.hypot(dx, dz); return sg * (dx * Math.cos(f) - dz * Math.sin(f)) / l > Math.cos(Math.PI / 4); };
    const pace = (q: Chore) => Math.hypot(q.b![0] - q.a![0], q.b![2] - q.a![2]) / q.len;
    plan.forEach((c, i) => {
      if (c.kind !== "fetch" || !c.flip || flowing.has(c)) return;
      const p = plan[i - 1], n = plan[i + 1], f = c.face ?? 0, fi = afoot(p) && square(p!, f, 1), fo = afoot(n) && square(n!, f, -1);
      if (fi || fo) flowing.set(c, [fi, fo, fi ? slope(c, pace(p!)) : undefined, fo ? slope(c, pace(n!)) : undefined]);
    });
    // (A load left on its pallet jack (a hot tub), drawn straight back out of a doorway on a walk the
    // jack's moves weren't planned for: on out at the walk's pace too.)
    plan.forEach((c, i) => {
      const fl = flowing.get(c), n = plan[i + 1];
      if (c.kind !== "fetch" || !c.flip || c.tool !== "palletJack" || fl?.[1] || n?.kind !== "walk" || n.jack || n.tool !== "palletJack" || !n.a || !n.b || !square(n, c.face ?? 0, -1)) return;
      flowing.set(c, [fl?.[0] ?? false, true, fl?.[2], slope(c, pace(n))]);
    });
    const nominal = (c: Chore, u: number): Nominal => {
      if (c.kind === "walk" && c.round) { const r = roundAt(L, c, u); return { x: r.x, z: r.z, yaw: r.yaw, exact: false }; }
      if (c.kind === "walk" || c.kind === "gateRide") {
        const a = c.a!, b = c.b!;
        return { x: a[0] + (b[0] - a[0]) * u, z: a[2] + (b[2] - a[2]) * u, yaw: c.kind === "gateRide" ? (c.dir === "up" ? 0 : Math.PI) : NaN, exact: c.kind === "gateRide" };
      }
      if (c.kind === "climbDown") return { x: exit[0], z: exit[2], yaw: exit[3], exact: true };
      if (c.kind === "bedUp" || c.kind === "bedDown") { const q = bedClimbAt(L, c, u); return { x: q.x, z: q.z, yaw: 0, exact: true }; }
      if (c.kind === "climbUp") return { x: enter[0], z: enter[2], yaw: enter[3], exact: true };
      if (c.kind === "rampOut" || c.kind === "rampIn") return { x: rampTip(L, rampControl(c.kind, u))[0] - RAMP_HOLD, z: 0, yaw: 0, exact: true };
      const at = this.spotFor(c);
      if (c.kind === "doorOpen" || c.kind === "doorClose") return { x: at[0], z: at[2], yaw: 0, exact: true };
      if (c.kind === "leafOpen" || c.kind === "leafClose") { const q = leafAt(L, c.leaf ?? 1, c.kind === "leafOpen", u); return { x: q.x, z: q.z, yaw: q.yaw, exact: true }; }
      if ((c.kind === "toolGet" || c.kind === "toolPut") && c.rest && tool) {
        const q = toolTake(c.rest, tool, at, c.kind === "toolGet" ? u : 1 - u);
        return { x: q.x, z: q.z, yaw: q.yaw, exact: false };
      }
      if (c.kind === "fetch" && this.noDoor() && this.stageable(stop.cargo) && cargo.handling !== "teamLift") {
        // No doorway: stood back from the spot, so the load is set down (or lifted) in front of it.
        // (Not a team lift's: its spot is where the driver holds its end, chores.ts teamRow.)
        // (Stepping back and forward again over the most of it, at a walk, not a leap.)
        const f = c.face ?? 0, k = this.stagedBack(stop.cargo, size) * THREE.MathUtils.smoothstep(u, 0, 0.4) * (1 - THREE.MathUtils.smoothstep(u, 0.6, 1));
        return { x: at[0] - Math.cos(f) * k, z: at[2] + Math.sin(f) * k, yaw: f, exact: false };
      }
      if (c.kind === "fetch" && c.flip) {
        // In through the doorway, out of sight, turned round in there, and back out facing out:
        // what is held ahead of the driver all the way (going in, the tool; coming out, the load).
        // (Coming out square to the doorway, or at the angle Chore.flipOff through it.)
        const f = c.face ?? 0, d = c.flip, fl = flowing.get(c), k = flipDepth(u, fl?.[0], fl?.[1], fl?.[2], fl?.[3]), g = f + (u >= 0.5 ? c.flipOff ?? 0 : 0);
        return { x: at[0] + Math.cos(g) * d * k, z: at[2] - Math.sin(g) * d * k, yaw: u >= 0.5 ? flipYawOut(c) : flipYawIn(c), exact: true, snap: true };
      }
      if (c.kind === "fetch" && this.kerbFetch(c)) {
        // Into the doorway for the load (or with it), and back out.
        const f = c.face ?? 0, k = 0.45 * THREE.MathUtils.smoothstep(u, 0.05, 0.35) * (1 - THREE.MathUtils.smoothstep(u, 0.65, 0.95));
        return { x: at[0] + Math.cos(f) * k, z: at[2] - Math.sin(f) * k, yaw: f, exact: false };
      }
      return { x: at[0], z: at[2], yaw: c.face ?? NaN, exact: false };
    };
    const hold = (c: Chore, u: number): Hold => {
      const i = plan.indexOf(c), prev = plan[i - 1], next = plan[i + 1];
      let item = c.item ?? null, t = c.tool ?? null;
      if (c.kind === "stow") { item = prev?.item ? (u < 0.6 ? prev.item : null) : next?.item && u > 0.4 ? next.item : null; t = prev?.tool ?? next?.tool ?? tool; }
      if (c.kind === "fetch") item = next?.item && u > 0.5 ? next.item : prev?.item && u < 0.5 ? prev.item : null;
      if (c.kind === "toolGet") t = u > 0.55 ? tool : null;
      if (c.kind === "toolPut") t = u < 0.45 ? tool : null;
      if (t === "handTruck") return c.kind === "toolGet" || c.kind === "toolPut" ? { ...handTruckHold(!!item), pivot: 0 } : handTruckHold(!!item);   // (taken up or set down where it rests: the driver turns, not it)
      if (t === "palletJack") return { lead: JACK_LEAD, tip: JACK_PIVOT_AT, pivot: 0.85, omega: 2.2, rate: item ? JACK_TURN_LOADED : JACK_TURN };
      if (!item) return EMPTY_HOLD;
      switch (cargo.handling) {
        case "push": return stop.cargo === "motorcycles" ? { lead: 0.3, pivot: 0.5, omega: 2.2, rate: 1.4 } : { lead: pushGap(size[1]) + size[0] / 2, pivot: 0.85, omega: 2.0, rate: 1.2 };
        case "roll": return { lead: 0.35 + size[0] / 2, pivot: 0.75, omega: 2.4, rate: 1.6 };
        case "teamLift": return { lead: 0, pivot: 0, omega: 2.4, rate: 1.4 };
        case "walkOn": return { lead: 0, pivot: 0, omega: 5, rate: 3.5 };
        default: return { lead: 0, pivot: 0, omega: 6, rate: 4.5 };
      }
    };
    // (Where the driver may stand turning a hand truck: not in the truck, bar its bed's aisle.)
    // (Nor astride the walk ramp's side: up and down it along its middle, or clear beside it. Its
    // last RAMP_LIP, a few centimetres high, is stepped across.)
    const rampSide = (x: number, z: number) => L.loader === "ramp" && x < L.bedRear && x > L.bedRear - L.rampRun + RAMP_LIP && Math.abs(z) > 0.15 && Math.abs(z) < RAMP_HW + 0.35;
    const clear = (x: number, z: number) => (!(x > L.rear - 0.25 && x < L.front + 0.25 && Math.abs(z) < L.hw + 0.25) || (x > L.bedRear + 0.1 && x < L.bedFront - 0.1 && Math.abs(z) < L.hw - 0.3))
      && !rampSide(x, z);
    this.path = buildCrewPath(plan, nominal, hold, exit[3], clear);
    // (A doorway walked on into, or out of, by a hand truck or on foot: its walk in at the pace the
    // driver really arrives at, and out at the pace they go on at, as the path has them (turns on
    // the spot, corners, catching up), and the path built again with those.)
    let measured = false;
    plan.forEach((c, i) => {
      const fl = flowing.get(c);
      if (!fl || fl[2] === undefined && fl[3] === undefined) return;
      const P = this.path!, t0 = P.starts[i], t1 = t0 + c.len, at = (t: number) => { const k = Math.max(0, Math.min(P.x.length - 1, Math.round(t * P.rate))); return [P.x[k], P.z[k]]; };
      const sp = (ta: number, tb: number) => { const [ax, az] = at(ta), [bx, bz] = at(tb); return Math.hypot(bx - ax, bz - az) / (tb - ta); };
      if (fl[2] !== undefined) fl[2] = slope(c, sp(t0 - 0.2, t0 - 0.05));
      if (fl[3] !== undefined) fl[3] = slope(c, sp(t1 + 0.05, t1 + 0.2));
      measured = true;
    });
    if (measured) this.path = buildCrewPath(plan, nominal, hold, exit[3], clear);
    this.pathPlan = plan; this.pathKey = key;
    return this.path;
  }
  // A fetch at a doorway (a front door, or the building's door at the back of a dock's platform),
  // stepped into, rather than at a spot on the pavement.
  // A kerb stop with no doorway at all: loads are staged on the pavement (props, stagedLoads).
  private noDoor() { return !this.docked && !this.kerb; }
  // Whether a cargo is staged on the pavement there: not animals, nor the forklift's, nor a team
  // lift (carried behind the driver to a worker, who has no doorway to come out of either).
  private stageable(cargo: string) { const h = CARGO_BY_ID.get(cargo)?.handling; return !!h && h !== "walkOn" && h !== "flatbed" && h !== "tow"; }
  // Where trip `k`'s load waits on the ground at fetch chore `f` (world): in front of the fetch spot
  // where it is held (on the hand truck's nose plate stood upright, on the pallet jack's forks, on
  // its dolly, on its rim, set down from the arms), trips side by side across.
  private stagedPose(L: TruckLayout, truck: Truck, stop: Stop, f: Chore, k: number, load: CarriedLoad, pos: THREE.Vector3, q: THREE.Quaternion) {
    // (Each trip's load at its own spot: chores.ts facilityFor.)
    const [x, y, z, yaw] = stageLocal(stop.cargo, load.size, this.spotFor(f), f.face ?? 0, 0, stop.kind === "pickup");
    pos.set(x, this.ground(L, x, z) + y, z).applyMatrix4(truck.root.matrixWorld);
    q.setFromEuler(this.eu.set(0, truck.heading + yaw, 0, "YXZ"));
  }
  // The pavement's staged loads outside a stop's own dwell (the yard's way): a doorless pickup's,
  // set out as the truck nears it; a doorless drop's, left there when it goes. One entry a stop
  // (a few at most), each shown while the truck is in that city and near, with meshes of its own.
  // (World poses, saved.)
  private pave: { key: string; city: number; x: number; z: number; cargo: string; items: { n: number; u0: number; x: number; y: number; z: number; yaw: number }[] }[] = [];
  private pavePath: object | null = null;
  private static paveKey(stop: Stop) { return `${stop.job}|${stop.kind}|${stop.cargo}`; }
  // (`fetches`: the stop's chores' fetches, when known: a pallet jack's each where its own is.)
  private paveFor(stop: Stop, model: TruckModel, px: number, py: number, pz: number, h: number, city: number, pave = 0, fetches: ({ spot: number[]; face: number } | null)[] | null = null) {
    const L = truckLayout(model), f = fetches?.[0] ?? pavementFetch(L, pave), trips = tripCount(L, stop.cargo, stop.units), key = Crew.paveKey(stop), items = [];
    for (let k = 0; k < trips; k++) {
      const [u0, u1] = tripUnits(stop, trips, k), n = Math.max(1, u1 - u0), load = this.loadFor(stop.cargo, n, u0, key), own = fetches?.[k];
      const [x, y, z, yaw] = own ? stageLocal(stop.cargo, load.size, own.spot, own.face, 0, stop.kind === "pickup") : stageLocal(stop.cargo, load.size, f.spot, f.face, k, stop.kind === "pickup");
      items.push({ n, u0, x: px + Math.cos(h) * x + Math.sin(h) * z, y: py + y, z: pz - Math.sin(h) * x + Math.cos(h) * z, yaw: h + yaw });
    }
    return { key, city, x: px, z: pz, cargo: stop.cargo, items };
  }
  // Add (or replace) a stop's entry, or with null take it away.
  private paveSet(key: string, e: Crew["pave"][number] | null) {
    this.pave = this.pave.filter((q) => q.key !== key);
    if (e) { this.pave.push(e); if (this.pave.length > 4) this.pave.shift(); }
  }
  private pavementProps(j: Journey, truck: Truck) {
    const st = j.st, stop = st.stops[0];
    if (st.mode === "drive" && j.path && j.path !== this.pavePath && j.path.length - st.s <= 150) {
      this.pavePath = j.path;   // (checked once a drive, door or none)
      const a = j.doorlessAhead();
      if (a && stop.kind === "pickup" && this.stageable(stop.cargo)) this.paveSet(Crew.paveKey(stop), this.paveFor(stop, st.truck, a.pose.x, a.y, a.pose.z, a.pose.h, st.city, a.pave, a.fetches));
    }
    const p = truck.root.position;
    this.pave = this.pave.filter((P) => P.city === st.city && Math.hypot(p.x - P.x, p.z - P.z) <= 250);
    const own = st.mode === "dwell" && stop && stop.kind !== "swap" ? Crew.paveKey(stop) : "";   // (the stop's own, in its dwell: stagedLoads)
    for (const P of this.pave) {
      if (P.key === own) continue;
      for (const it of P.items) {
        const load = this.loadFor(P.cargo, it.n, it.u0, P.key), g = load.group;
        g.position.set(it.x, it.y, it.z); g.rotation.set(0, it.yaw, 0, "YXZ"); g.scale.set(1, 1, 1);
        if (g.children[0] && CARGO_BY_ID.get(P.cargo)?.handling === "roll") g.children[0].position.y = -load.size[1] / 2;
        g.visible = true; this.stagedShown.push(g);
      }
    }
  }
  // At a doorless kerb stop, the loads not in hand: a pickup's still waiting on the pavement, a
  // drop's already left there. (The one being picked up or set down is props'.)
  private stagedShown: THREE.Object3D[] = [];
  private stagedLoads(j: Journey, truck: Truck, stop: Stop) {
    const c = CARGO_BY_ID.get(stop.cargo);
    if (!c || !this.noDoor() || !this.stageable(stop.cargo) || stop.kind === "swap") return;
    // (What stays on the pavement once the truck has gone: a drop's every load, a pickup's none.)
    const tp = truck.root.position;
    const key = Crew.paveKey(stop);
    if (stop.kind === "drop" && !this.pave.some((q) => q.key === key)) {
      // (Where the chores set it down: the walk to the first fetch ends at its spot.)
      this.paveSet(key, this.paveFor(stop, truck.model, tp.x, tp.y, tp.z, truck.heading, j.st.city, 0, fetchSpots(j.chores)));
    }
    else this.paveSet(key, null);
    const ph = j.dwellPhase(), ch = j.chores, idx = ph.chore ? ch.indexOf(ph.chore) : ph.phase === "startup" ? ch.length : -1;
    const fetches = ch.filter((q) => q.kind === "fetch"), trips = Math.max(1, ch.filter((q) => q.kind === "stow").length), L = truckLayout(truck.model);
    fetches.forEach((f, k) => {
      const fi = ch.indexOf(f);
      if (fi === idx || (stop.kind === "pickup" ? idx > fi : idx < fi)) return;   // (in hand, or not there (yet, or any more))
      const [u0, u1] = tripUnits(stop, trips, k), load = this.loadFor(stop.cargo, Math.max(1, u1 - u0), u0);
      if (load === this.load && load.group.visible) return;
      this.stagedPose(L, truck, stop, f, k, load, load.group.position, load.group.quaternion);
      if (load.group.children[0] && c.handling === "roll") load.group.children[0].position.y = -load.size[1] / 2;
      load.group.scale.set(1, 1, 1); load.group.visible = true; this.stagedShown.push(load.group);
    });
  }
  // How far back from a doorless fetch's spot the driver stands, so what is held lands STAGE_AHEAD
  // in front of the spot (the building is close in front of it).
  private stagedBack(cargo: string, size: number[]) {
    const h = CARGO_BY_ID.get(cargo)!.handling, tool = STYLE[h].tool, [l, , w] = size, across = !tool && h !== "push" && h !== "roll" && l > 0.6 && w >= 0.3;   // (as carryLoad holds it)
    const held = tool === "handTruck" ? HT_LEAD + 0.04 + l / 2 : tool === "palletJack" ? JACK_LEAD + 0.77 : h === "push" ? pushGap(size[1]) + l / 2 : h === "roll" ? 0.35 + l / 2 : 0.22 + (across ? w : l) / 2;
    return Math.max(0, held - stageAhead(tool));
  }
  private kerbFetch(c: Chore) { return c.kind === "fetch" && (this.docked || !!this.kerb) && c.face !== undefined; }

  // Where the ground is under (x, z) in the truck's frame: the bed's floor, the platform at a dock,
  // the walk ramp's slope or the lift gate's platform when they are out, the pavement up the kerb,
  // or the road.
  // (`inset`: the bed's floor only this far in from its walls: the driver's own footing, who hard
  // against the truck's side is beside it, not in it.)
  private ground(L: TruckLayout, x: number, z: number, inset = 0): number {
    if (x >= L.bedRear - 0.02 && x <= L.bedFront && Math.abs(z) < L.hw - inset) return L.floor;
    if (this.docked) return x < Math.max(L.rear, L.bedRear) + 0.02 ? DOCK_PLATFORM : 0;   // (the leveller's lip over the gap at the bed's edge)
    if (L.loader === "ramp" && this.ctl.ramp > 0.999 && Math.abs(z) < RAMP_HW) { const r = rampY(L, x); if (r !== null) return r; }
    if (L.loader === "liftgate" && this.ctl.gate > 0.999 && x > L.bedRear - GATE_LEN && Math.abs(z) < L.hw - 0.15) return this.gateY(L, this.ctl.drop);
    return this.kerbY(x, z);
  }
  private kerbY(x: number, z: number) {
    const k = this.kerbEdge;
    if (!k) return 0;
    return CURB_H * (1 - THREE.MathUtils.smoothstep((x - k.x) * k.nx + (z - k.z) * k.nz, -0.06, 0.06));
  }
  // The kerb's edge in the truck's frame, from the stop's front door (KERB in front of its wall).
  // (`street`: a stop in a city street, whose kerb runs along the truck's right with no door.)
  private kerbLine(j: Journey, truck: Truck, street: boolean) {
    const d = j.kerbDoor, side = street && !this.docked ? j.kerbSide : null;
    this.kerbEdge = !d && side !== null && side !== undefined ? { x: 0, z: side, nx: 0, nz: -1 } : null;
    if (!d || this.docked) { this.kerb = null; return; }
    const h = truck.heading, p = truck.root.position, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    const kx = d.x + d.nx * KERB - p.x, kz = d.z + d.nz * KERB - p.z;
    this.kerb = this.kerbEdge = { x: kx * fx + kz * fz, z: kx * rx + kz * rz, nx: d.nx * fx + d.nz * fz, nz: d.nx * rx + d.nz * rz };
  }
  // Both hands on the ramp's end while it slides out and is set down (or lifted and pushed in),
  // and off it as it settles.
  private rampGrips(L: TruckLayout, truck: Truck, kind: "rampOut" | "rampIn", u: number) {
    const tip = rampTip(L, rampControl(kind, u)), v = kind === "rampOut" ? u : 1 - u;
    const w = THREE.MathUtils.smoothstep(v, 0.0, 0.1) * (1 - THREE.MathUtils.smoothstep(v, 0.93, 1));
    truck.root.updateMatrixWorld();
    this.gripL.set(tip[0] + 0.03, tip[1] + 0.05, -0.32).applyMatrix4(truck.root.matrixWorld);
    this.gripR.set(tip[0] + 0.03, tip[1] + 0.05, 0.32).applyMatrix4(truck.root.matrixWorld);
    this.wL = this.wR = w;
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
    // (Handing over at a trailer's doors: up to the floor in line with where the load is set down.)
    const hand = ph.chore?.handoff ? ph.chore.lay : j.chores.find((q) => q.handoff)?.lay;
    // (Its fork heels, and the mast behind them, clear of the trailer's underride guard: long tines.)
    const fork = hand && !dock ? { A: [L.rear - 7, 0, hand[2]] as const, B: [L.bedRear - FORK_GUARD, 0, hand[2]] as const, yaw: 0, lift: L.floor + HAND_POCKET + (stop.kind === "pickup" ? 0.06 : 0), travel: 0.15, reach: hand[0] - (L.bedRear - FORK_GUARD), across: false }
      : this.forkTrip(L, dock !== null, stop, truck.model, this.tripNow(j, stop));
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
    // (At a trailer's back, up to its floor well before the long tines and what's on them get
    // there, and down again only once they're clear of it.)
    const rise = !dock && L.trailer ? [0.25, 0.6] : [0.55, 1];
    let fy = travel + (lift - travel) * THREE.MathUtils.smoothstep(k, rise[0], rise[1]);
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
      // (Up to the deck's height before any of the load is over the deck, and down only once it is
      // clear of it again: by how far the load's middle, reach out along the forks, is beyond the
      // deck's side, less the load's half-diagonal, rising over the last FORK_RISE of that.)
      const ld = this.load?.size, r = ld ? Math.hypot(ld[0], ld[2]) / 2 : 0.6, a = fl.rotation.y;
      this.v.set(fl.position.x + Math.cos(a) * reach, 0, fl.position.z - Math.sin(a) * reach).applyMatrix4(this.toTruck.copy(truck.root.matrixWorld).invert());
      fy = travel + (lift - travel) * (1 - THREE.MathUtils.smoothstep(this.v.z - L.hw - r, 0, FORK_RISE));
      this.forkDoor = c?.forklift ? THREE.MathUtils.smoothstep(u, 0, 0.06) * (1 - THREE.MathUtils.smoothstep(u, 0.86, 0.9)) : 0;
    } else {
      const x = A[0] + (B[0] - A[0]) * k, y = A[1], z = A[2] + (B[2] - A[2]) * k;
      this.v.set(x, y, z).applyMatrix4(truck.root.matrixWorld);
      fl.position.copy(this.v); fl.rotation.set(0, truck.heading + yaw, 0);
    }
    // (Set down or picked up, and kept so on the way back: let down out from under what it set
    // down, still up under what it carries; eased back once it stands where it came from, from 0.9,
    // as what it carried goes, at 0.95.)
    if (c?.forklift && u >= 0.4 && u < 0.5) fy += (pickup ? -1 : 1) * 0.06 * ((u - 0.4) / 0.1);   // set down / pick up
    else if (c?.forklift && u >= 0.5) fy += (pickup ? -0.06 : 0.06) * (1 - THREE.MathUtils.smoothstep(u, 0.9, 0.95));
    this.forks.position.y = fy;
    // In a docked trailer from when its mast passes the doors: the spotlight on its middle.
    if (dock && L.trailer && A[0] + (B[0] - A[0]) * k > L.bedRear) {
      fl.updateMatrixWorld();
      this.forkSpot = this.forkSpotV.set(-0.7, 1.1, 0).applyMatrix4(fl.matrixWorld);
    }
    // At a dock the worker walks from where they waved the truck in to the forklift first.
    const walkIn = dock && ph.phase === "park";
    hp.root.visible = true;
    if (walkIn) {
      const w = THREE.MathUtils.clamp(ph.t / (ph.len * 0.85), 0, 1);
      const sx = marshal[0] + (A[0] - 1.2 - marshal[0]) * w, sz = marshal[2] + (A[2] + 0.9 - marshal[2]) * w;
      this.placeChar(hp, truck, sx, P, sz, Math.atan2(-(A[2] + 0.9 - marshal[2]), A[0] - 1.2 - marshal[0]));
      const far = Math.hypot(A[0] - 1.2 - marshal[0], A[2] + 0.9 - marshal[2]);   // (the cycle by the ground covered, so the feet don't slide)
      hp.apply(w < 1 ? walkPose(w * far / STRIDE, idlePose(this.time, this.tmpPose)) : idlePose(this.time, this.tmpPose));
    } else {
      fl.updateMatrixWorld();
      this.v.set(-1.2, 1.06 - CHARACTER_HIP_Y, 0).applyMatrix4(fl.matrixWorld);
      hp.root.position.copy(this.v); hp.root.rotation.set(0, fl.rotation.y, 0);
      hp.apply(seatedPose(this.tmpPose, 0));
    }
    // The load on the forks: to the truck on a pickup, back from it on a drop.
    // (Handing over at a trailer's doors, its tines in the pallet's pockets, HAND_POCKET up: a
    // pickup's set down on the floor, a drop's lifted off it as the forks rise, from 0.4 of the trip.)
    const handing = !!c?.handoff;
    const carrying = c?.forklift ? (pickup ? u < 0.5 : u >= (handing ? 0.4 : 0.5) && u < 0.95) : false;
    const load = this.load;
    if (carrying && load) {
      fl.updateMatrixWorld();
      load.group.visible = true;
      // On blocks, the bundle's underside rests on the tines (5 cm thick) between them.
      // (Set down on a pickup, it rests where it is as the forks lower out from under it.)
      const dn = CARGO_MODELS[stop.cargo]?.dunnage, ry = pickup && u >= 0.4 ? Math.max(fy, lift) : fy;
      const ly = handing ? fy - HAND_POCKET : dn ? ry + 0.05 - dn : ry + 0.06;
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
    const px = door.x - x, pz = door.z - z;
    return stackGeom(L, model, stop, px * fx + pz * fz, px * rx + pz * rz, mode);
  }
  private stackLegs(L: TruckLayout, P: StackGeom, i: number, mh: number, pickup: boolean) { return stackTripLegs(L, P, i, mh, pickup); }
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
    if (docked && L.trailer) {   // into the trailer across the platform from inside the building, to the pallet's own place
      const f = dockForkTrip(L, model, stop, stop.slot ?? 0, trip.i);
      return { A: [L.rear - DOCK_FORK_FROM, P, f.z] as const, B: [f.x, P, f.z] as const, yaw: 0, lift: 0.1, travel: 0.12, reach: DOCK_FORK_REACH, across: false };
    }
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
    const steps = j.chores.filter((c) => c.kind === "stow" || (c.kind === "wait" && !!c.forklift && !c.handoff));
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
    this.load = this.loadFor(id, Math.max(1, u1 - u0), u0);
    const c = CARGO_BY_ID.get(id)!;
    if (c.handling === "walkOn" && this.herd?.id !== id) {
      this.herd?.dispose();
      this.herd = new Herd(id, herdCount(id, stop!.units), this.material, this.scene);
    }
  }
  // A load as carried, `n` units from unit `u0` (built once, the last few kept).
  // `tag`: a set of its own (a stop's loads left on the pavement), apart from the ones carried.
  private loadFor(id: string, n: number, u0: number, tag = ""): CarriedLoad {
    const key = `${id}|${n}|${u0}|${tag}`;
    let load = this.loads.get(key);
    if (!load) {
      load = buildCarried(id, this.material, n, u0); load.group.visible = false; this.scene.add(load.group);
      // Keep the last few loads built (a stop's trips reuse them); older ones give back their geometry.
      for (const [k, old] of this.loads) {
        if (this.loads.size < 24) break;
        if (old === this.load || old.group.visible) continue;   // (in use: carried, or staged on the pavement)
        old.group.removeFromParent();
        old.group.traverse((o: any) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
        this.loads.delete(k);
      }
      this.loads.set(key, load);
    }
    return load;
  }

  // Where a stationary chore happens: the end of the walk before it in the plan.
  private spotFor(c: Chore): [number, number, number] {
    const i = this.plan.indexOf(c);
    for (let k = i - 1; k >= 0; k--) { const p = this.plan[k]; if (p.b) return p.b; }
    return [0, 0, 0];
  }

  // Tools and loads with the driver: each put where it physically is (a hand truck on its wheels
  // and tipped back to the hands, a pallet jack on its rollers with its handle drawn back, a crate
  // on its dolly and a drum on its rim on whatever ground is under them, a box in the arms), and
  // the hands' holds on them set (gripL/R, wL/R) for work() to reach for. Taking a load or leaving
  // it, the hands hold it all the way to (or from) where it rests.
  private props(c: Chore, t: number, u: number, truck: Truck, stop: Stop) {
    const L = truckLayout(truck.model), plan = this.plan, i = plan.indexOf(c), prev = plan[i - 1], next = plan[i + 1];
    const cargo = CARGO_BY_ID.get(stop.cargo)!, load = this.load, pickup = stop.kind === "pickup";
    const humorous = cargo.tier === "humorous";
    truck.root.updateMatrixWorld(); this.truckM.copy(truck.root.matrixWorld);
    if (cargo.handling === "walkOn" && c.kind === "fetch") this.walkHerd(c, u, truck, stop);   // (in or out through the doorway with the driver)
    let item = c.item ?? null;
    // Stowing: the load moves between the hands (or the tool) and its spot on the bed floor;
    // `stowK` is how far it is from the one to the other, and `hold` how firmly it is held.
    let stowK = -1, hold = 1, ghost = false;
    const fromHands = !!prev?.item;   // (a stow after a carry sets the load down; before one, picks it up)
    if (c.kind === "stow") {
      item = prev?.item ?? next?.item ?? null;
      if (item) stowK = THREE.MathUtils.smoothstep(fromHands ? u : 1 - u, 0.15, 0.85);
      hold = fromHands ? 1 - THREE.MathUtils.smoothstep(u, 0.84, 0.97) : THREE.MathUtils.smoothstep(u, 0.03, 0.16);
    }
    // At the facility door the load is taken from just inside it (hands reaching in first) or
    // handed in there; it is out of sight in the doorway when it appears or goes.
    // With no doorway to take it from (a kerb stop whose building has no door found), the load
    // waits on the pavement: picked up from there, or set down there and left (stagedPose), the
    // way a stow handles the bed.
    const staged = c.kind === "fetch" && this.noDoor() && this.stageable(stop.cargo);
    if (staged) {
      item = next?.item ?? prev?.item ?? null;
      if (item) stowK = THREE.MathUtils.smoothstep(fromHands ? u : 1 - u, 0.15, 0.85);
      hold = fromHands ? 1 - THREE.MathUtils.smoothstep(u, 0.84, 0.97) : THREE.MathUtils.smoothstep(u, 0.03, 0.16);
    } else if (c.kind === "fetch" && cargo.handling !== "walkOn") {
      if (next?.item) { item = next.item; ghost = u <= 0.5; hold = THREE.MathUtils.smoothstep(u, 0.2, 0.45); }
      else if (prev?.item) { item = prev.item; ghost = u > 0.5; hold = 1 - THREE.MathUtils.smoothstep(u, 0.55, 0.8); }
    }
    // The tool: the chore's, or the one being taken from (or put back in) the bed.
    const stopTool = STYLE[cargo.handling].tool ?? null;
    const transfer = c.kind === "toolGet" || c.kind === "toolPut";
    const held = c.tool ?? (transfer ? stopTool : c.kind === "stow" ? (prev?.tool ?? next?.tool ?? null) : null);
    this.toolHeld = held;
    // Taking it (or putting it back): from where it rests, upright, to tipped into the hands.
    const tk = transfer ? toolTakeK(c.kind === "toolGet" ? u : 1 - u) : { grip: 1, carry: 1 };
    const rest = transfer && held ? (c.rest ?? toolStore(L, held)) : null;
    const loaded = !!item && !ghost && ((c.kind !== "stow" && !staged) || (fromHands ? u < 0.5 : u > 0.5));
    if (held === "handTruck") {
      const h = this.tools.handTruck; h.visible = true;
      // Tipped back for the hands: further when loaded (its weight over the wheels), and to
      // upright to stand a load down at a stow (and back when it's off the plate).
      let tip = this.handTruckTip(L, this.htLead, item && !ghost ? HT_HANDS_LOADED : HT_HANDS);
      if (load && item && !ghost) tip = Math.min(tip, this.handTruckTipClear(L, this.htLead, load.size[1]));
      if (load && loaded) this.hunch = THREE.MathUtils.clamp((load.size[1] - 1.0) / 0.7, 0, 1);   // (under a tall one, hunched down behind it)
      if ((c.kind === "stow" || staged) && item) {
        const up = fromHands ? THREE.MathUtils.smoothstep(u, 0.1, 0.48) * (1 - THREE.MathUtils.smoothstep(u, 0.62, 0.92)) : THREE.MathUtils.smoothstep(u, 0.08, 0.38) * (1 - THREE.MathUtils.smoothstep(u, 0.52, 0.9));
        tip = tip + (0.04 - tip) * up;
      }
      this.placeHandTruck(L, truck, this.htLead, tip);
      if (rest) this.restBlend(h, truck, rest, HT_WHEEL, tk.carry, 0);
      this.toolGrips(h, HT_GRIP[0], HT_GRIP[1], 0.15, tk.grip);
      if (load && item && (loaded || c.kind === "stow" || staged)) {
        load.group.visible = !ghost; load.group.position.copy(h.position); load.group.quaternion.copy(h.quaternion);
        load.group.translateX(0.04 + load.size[0] / 2); load.group.translateY(HT_PLATE + 0.03);
        if (c.kind === "stow" || staged) stowK = THREE.MathUtils.smoothstep(fromHands ? u : 1 - u, 0.5, 0.85);
      }
      this.pushLean = -0.1;
    } else if (held === "palletJack") {
      const h = this.tools.palletJack; h.visible = true;
      this.placeJack(L, truck, JACK_LEAD);
      if (rest) { this.restBlend(h, truck, rest, 0, tk.carry, 1); this.jackClear(L, truck); }   // (and on the way to and from its rest)
      this.toolGrips(this.jackHandle, 0, JACK_HANDLE, 0.12, tk.grip);
      if (load && item) {
        load.group.visible = !ghost; load.group.position.copy(h.position); load.group.quaternion.copy(h.quaternion);
        // (Up off the floor on the forks once they're pumped up; set down as they're let down.)
        const raise = c.kind === "jackUp" ? THREE.MathUtils.smoothstep(u, 0.1, 0.9) : c.kind === "jackDown" ? 1 - THREE.MathUtils.smoothstep(u, 0.1, 0.9) : 1;
        load.group.translateX(0.77); load.group.translateY(L.trailer ? 0.06 * raise : 0.09);
        if (stop.cargo === "ducks" && c.kind === "walk") this.spillDucks(c, u, load.group);
      }
      this.pushLean = -0.08;
    } else if (item && load) {
      const [l, hh, w] = load.size;
      load.group.visible = !ghost;
      switch (cargo.handling) {
        case "roll": this.rollLoad(L, truck, load, stowK); break;
        case "push": this.pushLoad(L, truck, load, stop.cargo === "motorcycles", this.pushFlipped(c, u)); this.pushLean = -0.18; break;
        case "teamLift":
          // (Between the two carriers' hands; on a drop, the other way round, as it lies in the bed with
          // the driver at its back end, so it isn't swung round as it is taken up.)
          if (this.mate.attached) this.teamLoad(truck, load, HIGH_CARRY.has(stop.cargo), !pickup);
          else this.putLoad(truck, load, 0.3 + l / 2, 0.55, 0, 0);
          this.teamGrips(load, !pickup);
          if (this.mate.attached) this.pushLean = c.backward ? 0 : 0.3;   // (upright, reaching back to the load: no stoop forward; facing it, as they stand)
          break;
        case "walkOn": load.group.visible = false; this.walkHerd(c, u, truck, stop); break;
        case "flatbed": case "tow": load.group.visible = false; break;
        default: this.carryLoad(truck, load, stop.cargo, l, hh, w);
      }
    }
    // Setting the load down exactly where the bed shows it (or lifting it from there): the trip's
    // units in the bed (chores.ts bedUnits), so nothing jumps when the bed takes over. The bed
    // shows them from late in a pickup's stow (early in a drop's), and the carried copy goes then.
    if (stowK >= 0 && load && load.group.visible && cargo.handling !== "walkOn" && cargo.handling !== "flatbed" && cargo.handling !== "tow") {
      const trips = plan.filter((q) => q.kind === "stow").length;
      const ti = plan.filter((q, k) => q.kind === "stow" && k < i).length;
      const [u0, u1] = tripUnits(stop, Math.max(1, trips), ti);
      const ps = staged ? [] : bedUnits(L, truck.model, stop.cargo, stop.units, stop.slot ?? 0).slice(u0, u1);
      if (ps.length || staged) {
        const n = ps.length, inHands = !held && cargo.handling !== "roll";
        // (Held in the hands: where they hold it, in its own frame, to follow it down.)
        const gm = this.gripMate as { L: THREE.Vector3; R: THREE.Vector3 } | null;
        if (inHands) { load.group.updateMatrixWorld(); this.m4.copy(load.group.matrixWorld).invert(); for (const g of [this.gripL, this.gripR, gm?.L, gm?.R]) g?.applyMatrix4(this.m4); }
        if (staged) this.stagedPose(L, truck, stop, c, plan.filter((q, k) => q.kind === "fetch" && k < i).length, load, this.v, this.qa);
        else {
          this.v.set(ps.reduce((a, p) => a + p[0], 0) / n, Math.min(...ps.map((p) => p[1])) + (cargo.handling === "roll" ? load.size[1] / 2 : 0), ps.reduce((a, p) => a + p[2], 0) / n).applyMatrix4(truck.root.matrixWorld);   // a rolled load's group sits at its axle
          this.qa.setFromEuler(this.eu.set(0, truck.heading, 0, "YXZ"));
        }
        load.group.position.lerp(this.v, stowK);
        load.group.quaternion.slerp(this.qa, stowK);
        if (inHands) { load.group.updateMatrixWorld(); for (const g of [this.gripL, this.gripR, gm?.L, gm?.R]) g?.applyMatrix4(load.group.matrixWorld); }
        else if (cargo.handling === "roll") this.rollGrips(load);
      }
      if (!staged && (stop.kind === "pickup" ? t > c.len * 0.97 : t < c.len * 0.03)) load.group.visible = false;
    }
    // How firmly: tools are held throughout (bar taking and stowing them); loads in the hands
    // only while they're held.
    if (!held && item) { this.wL *= hold; this.wR *= hold; }
    if (ghost && !held && load) load.group.visible = false;
    if (humorous && load?.group.visible) this.gagPoint = this.gagV.copy(load.group.position).setY(load.group.position.y + load.size[1] * 0.6);
    void pickup;
  }

  // ---- placing what's in hand ------------------------------------------------------------------
  // A point `ahead` of the driver's feet and `side` to the right, in the truck's frame.
  private fromDriver(ahead: number, side: number): [number, number] {
    const [x, , z, yaw] = this.drv;
    return [x + Math.cos(yaw) * ahead + Math.sin(yaw) * side, z - Math.sin(yaw) * ahead + Math.cos(yaw) * side];
  }
  // Set a group in the truck's frame: at (x, y, z), turned `yaw` from the truck's heading and
  // pitched nose up by `pitch`.
  private setTF(o: THREE.Object3D, truck: Truck, x: number, y: number, z: number, yaw: number, pitch = 0) {
    o.position.set(x, y, z).applyMatrix4(truck.root.matrixWorld);
    o.rotation.set(0, truck.heading + yaw, pitch, "YXZ");
  }
  // The hand truck's tilt (rad back from upright) that brings its handle to `hands` above the
  // driver's feet, its wheels `lead` ahead on whatever ground is there.
  // (Nearer than usual, walked round in a tight space, held more upright: the grip a forearm's
  // length in front of the driver.)
  private handTruckTip(L: TruckLayout, lead: number, hands: number) {
    const [ax, az] = this.fromDriver(lead, 0), axleY = this.ground(L, ax, az) + HT_WHEEL;
    return Math.min(Math.acos(THREE.MathUtils.clamp((this.drv[1] + hands - axleY) / HT_GRIP[1], 0.35, 0.995)),
      Math.asin(THREE.MathUtils.clamp((lead - HT_HAND_AHEAD) / HT_GRIP[1], 0.1, 0.99)));
  }
  // The most it may be tipped back with a load `h` tall on its plate, for the load's back to stay
  // clear of the driver's face and chest (a tall carton is carried nearer upright, about its
  // balance point, its top over the driver's head only if it is above it).
  private handTruckTipClear(L: TruckLayout, lead: number, h: number) {
    const [ax, az] = this.fromDriver(lead, 0), axleY = this.ground(L, ax, az) + HT_WHEEL;
    // (Its back, up to the top of the head: that height reached along the tipped frame, so the
    // longer the more it is tipped; worked out once from a first guess.)
    const back = h + HT_PLATE + 0.03, head = this.drv[1] + HT_HEAD_TOP - axleY;
    if (head <= 0.05) return Math.PI / 2;
    let tip = 0;
    for (let i = 0; i < 2; i++) tip = Math.asin(THREE.MathUtils.clamp((lead - HT_BODY) / Math.min(back, head / Math.cos(tip)), 0, 1));
    return tip;
  }
  private placeHandTruck(L: TruckLayout, truck: Truck, lead: number, tip: number) {
    const [ax, az] = this.fromDriver(lead, 0);
    this.setTF(this.tools.handTruck, truck, ax, this.ground(L, ax, az) + HT_WHEEL, az, this.drv[3], tip);
  }
  // The pallet jack on its steering wheel and fork rollers, its handle drawn back to the hands.
  // The forks pitch to rest on the highest ground under them, not just the ground at their tips:
  // across the bed's back edge, a kerb or the walk ramp's side they ride over the edge rather
  // than through it (and tips past the bed's walls, where the ground reads as the road, don't
  // pull them down into the floor).
  // Steered (the stop's path has it, crewpath.ts), it lies its own way, its handle swivelled to
  // the driver; otherwise straight out ahead of them.
  private placeJack(L: TruckLayout, truck: Truck, lead: number) {
    const ps = this.ps, steered = !Number.isNaN(ps.jx);
    const yaw = steered ? ps.jyaw : this.drv[3], c = Math.cos(yaw), s = Math.sin(yaw);
    const [ox, oz] = steered ? [ps.jx, ps.jz] : this.fromDriver(lead, 0), y0 = this.ground(L, ox, oz);
    let pitch = -Infinity;
    for (let x = JACK_TIP; x > 0.35; x -= 0.15) for (const side of JACK_FORKS) {
      const px = ox + c * x + s * side, pz = oz - s * x + c * side;
      pitch = Math.max(pitch, Math.atan2(this.ground(L, px, pz) - y0, x));
    }
    this.setTF(this.tools.palletJack, truck, ox, y0, oz, yaw, pitch);
    this.jackClear(L, truck);   // (an edge right ahead of the wheel, a kerb: lifted over it)
    // The handle: swivelled towards the driver (in the jack's frame, behind it is -x) and tipped
    // back to their hands, a forearm's length in front of them: the closer they stand, the more
    // upright, folded right up when they are at the jack's back, turning it on the spot.
    const dx = this.drv[0] - ox, dz = this.drv[2] - oz, lx = dx * c - dz * s, lz = dx * s + dz * c;
    const swivel = Math.hypot(lx, lz) > 0.1 ? THREE.MathUtils.clamp(Math.atan2(lz, -lx), -Math.PI / 2, Math.PI / 2) : 0;
    const out = Math.hypot(lx - JACK_PIVOT[0], lz) - JACK_HAND_AHEAD;
    this.jackHandle.rotation.set(0, swivel, Math.asin(THREE.MathUtils.clamp(out / JACK_HANDLE, JACK_UPRIGHT, JACK_TIPPED)) - pitch * Math.cos(swivel), "YZX");
  }
  // The pallet jack raised, if need be, so its forks are nowhere below the ground under them (on
  // the way between its rest and the hands, turning as it goes).
  private jackClear(L: TruckLayout, truck: Truck) {
    const o = this.tools.palletJack, inv = this.m4.copy(truck.root.matrixWorld).invert();
    o.updateMatrixWorld(true);
    let low = 0;
    for (let x = 0; x <= JACK_TIP + 0.04; x += 0.05) for (const side of JACK_FORKS) {
      const q = this.v.set(x, 0, side).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      low = Math.max(low, this.ground(L, q.x, q.z) - q.y);
    }
    if (low > 0) o.position.y += low;
  }
  // Taking a tool from its rest (or putting it back): from standing there upright (k 0) to in
  // the hands as placed (k 1), the handle of a jack swinging down with it.
  private restBlend(o: THREE.Object3D, truck: Truck, r: ToolRest, lift: number, k: number, jack: number) {
    this.v.set(r.at[0], r.at[1] + lift, r.at[2]).applyMatrix4(truck.root.matrixWorld);
    this.qa.setFromEuler(this.eu.set(0, truck.heading + r.yaw, 0, "YXZ"));
    o.position.lerpVectors(this.v, o.position, k);
    o.quaternion.slerpQuaternions(this.qa, o.quaternion.clone(), k);
    if (jack) { this.jackHandle.rotation.z *= k; this.jackHandle.rotation.y *= k; }
  }
  // Both hands on a tool's handle (in the frame of `o`: at (x, y), `half` either side), as firmly as `w`.
  private toolGrips(o: THREE.Object3D, x: number, y: number, half: number, w: number) {
    o.updateMatrixWorld(true);
    this.gripL.set(x - 0.02, y, -half).applyMatrix4(o.matrixWorld);
    this.gripR.set(x - 0.02, y, half).applyMatrix4(o.matrixWorld);
    this.wL = this.wR = w;
  }
  // A load in the arms: in front of the chest (a long one across the body), the hands on its
  // sides near the body, or under its near edge when it's too wide to hold by the sides.
  private carryLoad(truck: Truck, load: CarriedLoad, id: string, l: number, hh: number, w: number) {
    if (id === "trophy") { this.putLoad(truck, load, 0.1, 1.95, 0, 0); this.gripsAt(load, 0, 0.06, Math.min(0.12, w / 2), 1, 1); return; }
    if (id === "envelope") { this.putLoad(truck, load, 0.42, 1.0, 0.12, 0); this.gripsAt(load, 0, hh / 2, 0, 0, 1); return; }
    const across = l > 0.6 && w >= 0.3, depth = across ? w : l, span = across ? l : w;   // (a thin carton, a TV's, edgeways, by its sides)
    const bottom = Math.max(0.15, Math.min(1.1 - hh / 2, CARRY_TOP - hh));   // (a tall one lower, its top below the chin)
    this.putLoad(truck, load, 0.22 + depth / 2, bottom, 0, across ? Math.PI / 2 : 0);
    // In the driver's frame: by the sides if they're in reach, else under the near edge.
    const near = 0.22 + Math.min(0.15, depth / 2), side = span / 2 + GLOVE;
    if (side <= 0.45) this.gripsDriver(near, bottom + Math.min(hh / 2, 0.3), side);
    else this.gripsDriver(0.22 + 0.06, bottom - GLOVE + 0.01, 0.28);
  }
  // A crate on its dolly (or a motorcycle on its wheels, walked beside on its left), on the ground
  // front and back, the hands on its near face (on the bike: the left grip and the tank).
  // Whether a crate on its dolly is pushed from its other end this carry: walked round it, left as
  // it was, an odd number of times since it was taken up (Chore.roundStill; half way round one).
  private pushFlipped(c: Chore, u: number) {
    let n = c.roundStill && u > 0.5 ? 1 : 0;
    for (let k = this.plan.indexOf(c) - 1; k >= 0 && this.plan[k].kind !== "fetch" && this.plan[k].kind !== "stow"; k--) if (this.plan[k].roundStill) n++;
    return n % 2 === 1;
  }
  private pushLoad(L: TruckLayout, truck: Truck, load: CarriedLoad, bike: boolean, flip = false) {
    const [l, hh, w] = load.size, yaw = this.drv[3] + (flip ? Math.PI : 0), f = flip ? -1 : 1;
    const ahead = bike ? -0.1 : pushGap(hh) + l / 2, side = bike ? 0.42 : 0, half = bike ? 0.67 : l / 2 - 0.05;
    const [cx, cz] = this.fromDriver(ahead, side), [fx, fz] = this.fromDriver(ahead + half, side), [bx, bz] = this.fromDriver(ahead - half, side);
    // (Never tipped back towards the driver: up a step, a kerb, it is hopped up level.)
    const yf = this.ground(L, fx, fz), yb = this.ground(L, bx, bz), pitch = Math.min(0, Math.atan2(yf - yb, 2 * half));
    this.setTF(load.group, truck, cx, yf > yb ? yf : (yf + yb) / 2, cz, yaw, pitch * f);
    load.animate?.(this.time);
    if (bike) { this.gripsAt(load, 0.36, 1.07, -0.3, 1, 0); this.gripsAt(load, 0.18, 0.99, 0.0, 0, 1); return; }
    const gy = THREE.MathUtils.clamp(1.02 - ((yf > yb ? yf : (yf + yb) / 2) - this.drv[1]), 0.25, hh - 0.06);
    this.gripsAt(load, -f * (l / 2 + GLOVE), gy, Math.min(0.22, w / 2 - 0.04), 1, 1);   // (on its end nearer the driver)
  }
  // A drum (a tyre, a cheese) rolled on its rim ahead, turning as it goes, the hands on its top
  // behind the crown.
  private rollLoad(L: TruckLayout, truck: Truck, load: CarriedLoad, stowK: number) {
    const [l, hh] = load.size, rad = hh / 2, dist = this.ps.travel;   // (rolled by the ground covered, not by turning on the spot)
    const [cx, cz] = this.fromDriver(0.35 + l / 2, 0);
    this.setTF(load.group, truck, cx, this.ground(L, cx, cz) + rad, cz, this.drv[3], -dist / rad);
    if (load.group.children[0]) load.group.children[0].position.y = -rad;
    load.animate?.(this.time);
    if (stowK < 0) this.rollGrips(load);
  }
  private rollGrips(load: CarriedLoad) {
    const [, hh, w] = load.size, rad = hh / 2, yaw = this.drv[3] + 0, gz = Math.min(0.16, w / 2 - 0.03);
    const p = load.group.position, a = 0.65, hx = -rad * Math.sin(a), hy = rad * Math.cos(a) + 0.04;
    // (The truck's heading plus the driver's yaw: the load group's own yaw, without its roll.)
    const H = load.group.rotation.y, fx = Math.cos(H), fz = -Math.sin(H), rx = Math.sin(H), rz = Math.cos(H);
    this.gripL.set(p.x + fx * hx - rx * gz, p.y + hy, p.z + fz * hx - rz * gz);
    this.gripR.set(p.x + fx * hx + rx * gz, p.y + hy, p.z + fz * hx + rz * gz);
    this.wL = this.wR = 1; void yaw;
  }
  // The driver's end of a team lift: both hands on the end of the load nearest the driver; the
  // worker's on the other end.
  private teamGrips(load: CarriedLoad, flip = false) {
    const [l, hh, w] = load.size, gy = Math.min(hh / 2, 0.65), gz = Math.min(0.22, w / 2 - 0.03);   // (its end, a hand either side of its middle)
    // (Between two, the load points at the driver (teamLoad), or away turned round; alone, it is
    // out ahead of them.)
    const e = flip ? -1 : 1;
    this.gripsAt(load, this.mate.attached ? e * (l / 2 + GLOVE) : -l / 2 - GLOVE, gy, gz, 1, 1);
    if (this.mate.attached) {
      load.group.updateMatrixWorld();
      this.gripMate = { L: new THREE.Vector3(-e * (l / 2 + GLOVE), gy, -gz).applyMatrix4(load.group.matrixWorld), R: new THREE.Vector3(-e * (l / 2 + GLOVE), gy, gz).applyMatrix4(load.group.matrixWorld) };
    }
  }
  // A load set in the driver's frame (x ahead, its bottom y above the feet, z right), turned yaw.
  private putLoad(truck: Truck, load: CarriedLoad, x: number, y: number, z: number, yaw: number) {
    const [px, pz] = this.fromDriver(x, z);
    this.setTF(load.group, truck, px, this.drv[1] + y, pz, this.drv[3] + yaw, 0);
    load.animate?.(this.time);
  }
  // Grips on a load, in its own frame: at (x, y), `half` either side; wl, wr: which hands.
  private gripsAt(load: CarriedLoad, x: number, y: number, half: number, wl: number, wr: number) {
    load.group.updateMatrixWorld();
    if (wl) { this.gripL.set(x, y, half === 0 ? 0 : -Math.abs(half)).applyMatrix4(load.group.matrixWorld); this.wL = wl; }
    if (wr) { this.gripR.set(x, y, Math.abs(half)).applyMatrix4(load.group.matrixWorld); this.wR = wr; }
  }
  // Grips in the driver's frame (ahead, height above the feet, half apart).
  private gripsDriver(ahead: number, y: number, half: number) {
    for (const [g, s] of [[this.gripL, -1], [this.gripR, 1]] as const) {
      const [x, z] = this.fromDriver(ahead, s * half);
      g.set(x, this.drv[1] + y, z).applyMatrix4(this.truckM);
    }
    this.wL = this.wR = 1;
  }
  private truckM = new THREE.Matrix4();

  // Walk-on cargo follows the driver in a line, each animal in the driver's footsteps its own way
  // back (chores.ts herdBack) along the path they walk on this lead (alongTrail), those smoothed
  // over HERD_LOOK either side so it cuts a sharp corner as an animal on a lead does, facing the
  // way it goes, on the ground (or the walk ramp) under it, its legs walking as far as it goes.
  // Short of that far along the lead, it is straight back from where the lead starts, opposite
  // the way its first walk goes. Through a doorway (a fetch next to the lead), the animals walk
  // with the driver: out from where the driver turns round in there, on a pickup, and in as far as
  // the driver goes, on a drop, each out of sight once all of it is half a metre past the wall.
  // Stowing, after a lead (a pickup) each walks on from where the lead leaves it to where it rides
  // in the bed (chores.ts bedUnits), the first in deepest, and turns to face the front there, as
  // the bed shows it; before a lead (a drop), from there into the line the lead starts with,
  // turning round.
  private walkHerd(c: Chore, u: number, truck: Truck, stop: Stop) {
    const herd = this.herd, P = this.path;
    if (!herd || !P) return;
    const n = herd.animals.length, plan = this.plan, i = plan.indexOf(c);
    const isLead = (k: number) => k >= 0 && k < plan.length && plan[k].kind === "walk" && plan[k].item === "animal";
    const door = (k: number) => k >= 0 && plan[k].kind === "fetch" && !!plan[k].flip;
    // (The lead: this walk's run of them, or the one just before or after this chore; and when on
    // it. In a doorway's fetch, the driver is deepest in at its middle.)
    const now = P.starts[i] + u * c.len, mid = (k: number) => P.starts[k] + plan[k].len / 2;
    let k0 = i, k1 = i, T: number;
    if (isLead(i)) T = now;
    else if (isLead(i + 1)) { k0 = k1 = i + 1; T = door(i) ? Math.max(now, mid(i)) : P.starts[k0]; }
    else if (isLead(i - 1)) { k0 = k1 = i - 1; T = door(i) ? Math.min(now, mid(i)) : P.starts[k1] + plan[k1].len; }
    else return;
    while (isLead(k0 - 1)) k0--;
    while (isLead(k1 + 1)) k1++;
    // (Led out of a doorway, a fetch before it: from where the driver turns in there, and before
    // that straight back in through it, square to it.)
    const first = plan[k0], from = plan[k0 - 1], out = door(k0 - 1), T0 = out ? mid(k0 - 1) : P.starts[k0];
    const dir = from?.kind === "fetch" && from.face !== undefined ? [-Math.cos(from.face), Math.sin(from.face)] : [first.b![0] - first.a![0], first.b![2] - first.a![2]];
    const fetch = out ? from : door(k1 + 1) ? plan[k1 + 1] : null, spot = fetch ? this.spotFor(fetch) : null, wall = this.kerb ? 0.5 : 0;
    const L = truckLayout(truck.model);
    truck.root.updateMatrixWorld();
    // (How far the driver has walked along the lead by T, and a quarter second before: the animals
    // walk as far, their legs swinging with how fast.)
    let went = this.trailLength(P, T0, T), pace = THREE.MathUtils.clamp((went - this.trailLength(P, T0, T - 0.25)) / 0.25 / 0.6, 0, 1);
    const pickup = stop.kind === "pickup", spots = c.kind === "stow" ? bedUnits(L, truck.model, stop.cargo, stop.units, stop.slot ?? 0) : null;
    for (let k = 0; k < n; k++) {
      const back = herdBack(herd.animals[k].size[0], k);
      // (The footsteps smoothed over HERD_LOOK either side: the corners cut, as an animal on a
      // lead cuts them; facing along that, the way it goes.)
      const at = (b: number): [number, number] => {
        let sx = 0, sz = 0;
        for (let q = -3; q <= 3; q++) { const [px, pz] = this.alongTrail(P, T, T0, Math.max(0, b + q * HERD_LOOK / 3), dir); sx += px; sz += pz; }
        return [sx / 7, sz / 7];
      };
      let [lx, lz] = at(back), [ax, az] = at(back + 0.25), [bx, bz] = at(Math.max(0, back - 0.25)), fy = Math.atan2(-(bz - az), bx - ax);
      const bed = spots?.[pickup ? k : n - 1 - k];
      if (bed) {
        // (From F, facing yF, to G, facing yG: turning to the way there, walking it, turning to yG.)
        const [F, G, yF, yG] = pickup ? [[lx, lz], [bed[0], bed[2]], fy, 0] : [[bed[0], bed[2]], [lx, lz], 0, fy];
        const d = Math.hypot(G[0] - F[0], G[1] - F[1]), h = d > 0.2 ? Math.atan2(-(G[1] - F[1]), G[0] - F[0]) : yF;
        const off = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
        const turn = (a: number, b: number, w: number) => a + off(a, b) * THREE.MathUtils.smoothstep(w, 0, 1);
        // (The turn first takes up to a third of the stow, as far as it turns. Off the lead, a
        // pickup's goes on at its pace and eases to a stand; into one, a drop's sets off and stops.)
        const t0 = Math.abs(off(yF, h)) / Math.PI * 0.33, x = THREE.MathUtils.clamp((u - t0) / (0.85 - t0), 0, 1);
        const w = pickup ? 1 - (1 - x) * (1 - x) : THREE.MathUtils.smoothstep(x, 0, 1);
        lx = F[0] + (G[0] - F[0]) * w; lz = F[1] + (G[1] - F[1]) * w;
        fy = u < t0 ? turn(yF, h, u / t0) : u > 0.85 ? turn(h, yG, (u - 0.85) / 0.15) : h;
        went = d * w + k; pace = Math.min(1, 4 * Math.sin(Math.PI * Math.min(1, u / 0.9)));
      }
      if (spot && (lx - spot[0]) * Math.cos(fetch!.face ?? 0) - (lz - spot[2]) * Math.sin(fetch!.face ?? 0) > wall + 0.5 + herd.animals[k].size[0] / 2) continue;
      this.v.set(lx, this.ground(L, lx, lz), lz).applyMatrix4(truck.root.matrixWorld);
      herd.pose(k, this.v.x, this.v.y, this.v.z, truck.heading + fy, bed ? went : went - back, pace);
    }
    const lead = herd.animals[0].root;
    if (lead.visible) this.gagPoint = this.gagV.copy(lead.position).setY(lead.position.y + herd.animals[0].size[1] * 0.85);
  }
  // How far the driver walks (m, along the ground) from T0 to T.
  private trailLength(P: NonNullable<Crew["path"]>, T0: number, T: number) {
    const last = P.x.length - 1, f = Math.min(last, Math.max(0, T * P.rate)), j0 = Math.min(last, Math.max(0, Math.ceil(T0 * P.rate)));
    const i0 = Math.floor(f), t = f - i0, i1 = Math.min(last, i0 + 1);
    let d = 0;
    for (let j = j0; j < i0; j++) d += Math.hypot(P.x[j + 1] - P.x[j], P.z[j + 1] - P.z[j]);
    return i0 >= j0 ? d + Math.hypot(P.x[i1] - P.x[i0], P.z[i1] - P.z[i0]) * t : 0;
  }
  // A point `back` behind the driver at time T along the way they have walked since T0 (truck
  // frame: x, z); short of that, on straight back from where they started, opposite `dir`.
  private alongTrail(P: NonNullable<Crew["path"]>, T: number, T0: number, back: number, dir: number[]): [number, number] {
    const last = P.x.length - 1, f = Math.min(last, Math.max(0, T * P.rate)), j0 = Math.min(last, Math.max(0, Math.ceil(T0 * P.rate)));
    const i0 = Math.floor(f), t = f - i0, i1 = Math.min(last, i0 + 1);
    let px = P.x[i0] + (P.x[i1] - P.x[i0]) * t, pz = P.z[i0] + (P.z[i1] - P.z[i0]) * t, d = 0;
    for (let j = i0; j >= j0; j--) {
      const qx = P.x[j], qz = P.z[j], seg = Math.hypot(px - qx, pz - qz);
      if (seg > 1e-6 && d + seg >= back) { const k = (back - d) / seg; return [px + (qx - px) * k, pz + (qz - pz) * k]; }
      d += seg; px = qx; pz = qz;
    }
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    return [px - dir[0] / dl * (back - d), pz - dir[1] / dl * (back - d)];
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

  // Lift-gate platform height for a lowered amount (0 at bed level, 1 on the ground), matching Truck.
  private gateY(L: TruckLayout, lowered: number) { return L.floor + (0.06 - L.floor) * ease(lowered); }

  // How a chore moves the truck's parts, at progress u (1 = done).
  private choreControls(c: Chore, u: number, k: { cab: number; otherCab: number; rear: number; ramp: number; gate: number; drop: number; leafL: number; leafR: number }, swap: boolean) {
    switch (c.kind) {
      case "climbDown": k.cab = u < 1 ? climbDoor(u * c.len, c.len, false) : 0; break;
      case "climbUp": if (swap) k.otherCab = u < 1 ? climbDoor(u * c.len, c.len, true) : 0; else k.cab = u < 1 ? climbDoor(u * c.len, c.len, true) : 0; break;
      case "doorOpen": case "doorClose": k.rear = doorControl(c.kind, u); break;
      case "rampOut": case "rampIn": k.ramp = rampControl(c.kind, u); break;
      case "gateOut": k.gate = Math.min(1, u * 2); k.drop = Math.max(0, u * 2 - 1); break;
      case "gateIn": k.drop = 1 - Math.min(1, u * 2); k.gate = 1 - Math.max(0, u * 2 - 1); break;
      case "gateRide": k.drop = c.dir === "up" ? 1 - ease(u) : ease(u); break;
      case "leafOpen": case "leafClose": { const a = leafAngle(c.kind === "leafOpen", u) / LEAF_OPEN; if ((c.leaf ?? 1) < 0) k.leafL = a; else k.leafR = a; break; }
    }
  }

  private applyTruck(truck: Truck, other: Truck | null, k: { cab: number; otherCab: number; rear: number; ramp: number; gate: number; drop: number; leafL: number; leafR: number }) {
    truck.cabDoor = k.cab; truck.rearDoor = k.rear; truck.ramp = k.ramp;
    truck.liftgate = k.gate; truck.liftgateDrop = k.drop; truck.trailerLeafL = k.leafL; truck.trailerLeafR = k.leafR;
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

// ---- the cab door and steps -------------------------------------------------------------------
// The driver's door and the climb into the cab, in the truck's frame (truck.ts buildCab): the door
// hinged at its front edge (dxf, -hw) and swinging out, the two steps below it, the grab handle
// outside on the pillar behind the door and the one just inside the opening ahead of it.
type CV3 = [number, number, number];
function cabGeom(model: TruckModel) {
  const s = SPECS[model], yf = s.cabFloor, hw = s.cabHW, dl = s.doorLen, dxf = s.cabFront - 0.07, dxb = dxf - dl;
  const belt = yf + (s.cab !== "cabover" ? 0.88 : 0.92);
  return { yf, hw, dl, dxf, dxb, belt, stepX: (dxb + 0.15 + dxf - 0.25) / 2, lower: 0.57, upper: yf - 0.25 };
}
type CabGeom = ReturnType<typeof cabGeom>;
const DOOR_SWING = 1.25;   // Truck.cabDoor 1: the door this far open (rad)
// A point on the door (its own frame: x back from the hinge (negative), y up, z in) when it is
// open by `c` (Truck.cabDoor).
function doorPt(g: CabGeom, c: number, lx: number, ly: number, lz: number): CV3 {
  const th = -DOOR_SWING * ease(c), co = Math.cos(th), si = Math.sin(th);
  return [g.dxf + lx * co + lz * si, ly, -g.hw - lx * si + lz * co];
}
// Where a hand holds: the door's outside handle ("out") or inside pull ("in"), or a grab handle
// at a height ("barF" inside ahead of the door, "barR" outside behind it).
type CabHold = "out" | "in" | ["barF" | "barR", number];
function cabGrip(g: CabGeom, h: CabHold, door: number): CV3 {
  if (h === "out") return doorPt(g, door, -g.dl + 0.21, g.belt - 0.125, -0.05);
  if (h === "in") return doorPt(g, door, -g.dl + 0.3, g.belt - 0.2, 0.13);
  return h[0] === "barF" ? [g.dxf - 0.05, h[1], -g.hw + 0.12] : [g.dxb - 0.08, h[1], -g.hw - 0.055];
}
// The door open by c, the angle back: c for an angle (rad).
const doorFor = (th: number) => { const k = THREE.MathUtils.clamp(th / DOOR_SWING, 0, 1); let c = k; for (let i = 0; i < 6; i++) c -= (ease(c) - k) / Math.max(0.05, 6 * c * (1 - c)); return THREE.MathUtils.clamp(c, 0, 1); };
// A key of the climb, at nominal time t (s): the feet's point (x, y, z, yaw: truck frame), how far
// into the seated pose, a lean forward (negative) and a duck (m) and twist of the body, the door,
// whether the door swings free into this key (slowing, or shut: slamming), each foot's place
// (null: on the ground under the hips) and each hand's hold (null: free).
interface ClimbKey { t: number; root: [number, number, number, number]; seat: number; lean: number; duck: number; twist: number; door: number; swing?: boolean;
  lf: CV3 | null; rf: CV3 | null; lh: CabHold | null; rh: CabHold | null }
const ck = (t: number, root: ClimbKey["root"], o: Partial<ClimbKey> = {}): ClimbKey => ({ t, root, seat: 0, lean: 0, duck: 0, twist: 0, door: 0, lf: null, rf: null, lh: null, rh: null, ...o });
// The places the climb goes through.
function cabSpots(g: CabGeom, L: TruckLayout) {
  const face = (from: CV3, to: CV3) => Math.atan2(-(to[2] - from[2]), to[0] - from[0]);
  const G: CV3 = [g.dxb - 0.3, 0, -g.hw - 0.45];     // truckExtents doorX, doorZ
  const IN = -Math.PI / 2;                        // facing the cab
  const X = g.stepX;
  return {
    G, yawOut: face(G, cabGrip(g, "out", 0)),
    pull: [G[0] - 0.08, 0, G[2] - 0.05] as CV3,
    B: [X, 0, -g.hw - 0.42] as CV3, IN,
    S1: [X, g.lower - 0.03, -g.hw - 0.24] as CV3, S2: [X, g.upper - 0.03, -g.hw - 0.14] as CV3, S3: [X - 0.05, g.yf, -g.hw + 0.22] as CV3,
    seat: [L.seat.x, L.seat.y - CHARACTER_HIP_Y, L.seat.z] as CV3,
    lowL: [X + 0.11, g.lower, -g.hw - 0.08] as CV3, lowR: [X - 0.11, g.lower, -g.hw - 0.08] as CV3,
    upL: [X + 0.11, g.upper, -g.hw - 0.05] as CV3, upR: [X - 0.11, g.upper, -g.hw - 0.05] as CV3,
    flL: [X + 0.08, g.yf, -g.hw + 0.25] as CV3, flR: [X - 0.12, g.yf, -g.hw + 0.25] as CV3,
    midL: [X + 0.11, 0.32, -g.hw - 0.3] as CV3, midR: [X - 0.11, 0.3, -g.hw - 0.3] as CV3,
    // Stepping out round the swinging door: on the circle its end sweeps (and a body's width
    // more), facing its hinge with a hand on its inside pull.
    round: (th: number): [number, number, number, number] => [g.dxf - 1.4 * Math.cos(th), 0, -g.hw - 1.4 * Math.sin(th), -th],
  };
}
const CLIMB_OPEN = 0.75;   // the door held open this far while the driver climbs (Truck.cabDoor)
function climbInKeys(g: CabGeom, L: TruckLayout): ClimbKey[] {
  const S = cabSpots(g, L), y = g.yf, open = CLIMB_OPEN;
  const at = (p: CV3, yaw: number): ClimbKey["root"] => [p[0], p[1], p[2], yaw];
  return [
    ck(0, at(S.G, S.yawOut)),
    ck(0.45, at(S.G, S.yawOut), { lh: "out", lean: -0.08 }),
    ck(1.15, at(S.pull, S.yawOut), { lh: "out", door: 0.42, lean: 0.06 }),
    ck(1.4, at(S.pull, S.yawOut + 0.2), { door: 0.6, swing: true }),
    ck(1.75, at([(S.pull[0] + S.B[0]) / 2, 0, (S.pull[2] + S.B[2]) / 2], -1.2), { door: open, swing: true }),
    ck(2.15, at(S.B, S.IN), { door: open, lh: ["barF", y + 0.55], rh: ["barR", y + 0.45] }),
    ck(2.45, at(S.B, S.IN), { door: open, lh: ["barF", y + 0.55], rh: ["barR", y + 0.45], rf: S.lowR }),
    ck(2.8, at(S.S1, S.IN), { door: open, lh: ["barF", y + 0.78], rh: ["barR", y + 0.7], rf: S.lowR, lf: S.midL }),
    ck(3.3, at(S.S2, S.IN), { door: open, lh: ["barF", y + 0.92], rh: ["barR", y + 0.92], rf: S.lowR, lf: S.upL }),
    ck(3.6, at([S.S2[0], S.S2[1] + 0.06, S.S2[2] + 0.06], S.IN), { door: open, lh: ["barF", y + 0.92], rh: ["barR", y + 0.95], rf: S.flR, lf: S.upL, duck: 0.05 }),
    ck(3.9, at(S.S3, S.IN), { door: open, lh: ["barF", y + 0.88], rf: S.flR, lf: S.flL, duck: 0.18, lean: -0.15 }),
    ck(4.2, at(S.S3, -0.35), { door: open, lh: "in", rf: S.flR, lf: S.flL, duck: 0.15, lean: -0.4, twist: 0.55 }),
    ck(4.8, at(S.seat, 0), { seat: 1, door: 0.1, lh: "in", lean: -0.18, twist: 0.4 }),
    ck(5.0, at(S.seat, 0), { seat: 1, door: 0, swing: true }),
  ];
}
function climbOutKeys(g: CabGeom, L: TruckLayout): ClimbKey[] {
  const S = cabSpots(g, L), y = g.yf, open = CLIMB_OPEN;
  const at = (p: CV3, yaw: number): ClimbKey["root"] => [p[0], p[1], p[2], yaw];
  const th1 = DOOR_SWING * ease(open), r1 = S.round(th1);
  // Shutting it: from round its end to back where the walk starts (G), the inside pull still in reach.
  const thG = 0.42, end = at(S.G, Math.atan2(-(cabGrip(g, "in", doorFor(thG))[2] - S.G[2]), cabGrip(g, "in", doorFor(thG))[0] - S.G[0]));
  return [
    ck(0, at(S.seat, 0), { seat: 1 }),
    ck(0.35, at(S.seat, 0), { seat: 1, lh: "in", lean: -0.18, twist: 0.4 }),
    ck(0.85, at(S.seat, -0.1), { seat: 0.85, lh: "in", lean: -0.3, twist: 0.5, door: 0.35 }),
    ck(1.2, at(S.S3, -0.35), { door: 0.6, swing: true, rf: S.flR, lf: S.flL, duck: 0.15, lean: -0.3, twist: 0.3 }),
    ck(1.5, at(S.S3, S.IN), { door: open, swing: true, lh: ["barF", y + 0.88], rh: ["barR", y + 0.95], rf: S.flR, lf: S.flL, duck: 0.18, lean: -0.15 }),
    ck(1.8, at([S.S2[0], S.S2[1] + 0.06, S.S2[2] + 0.06], S.IN), { door: open, lh: ["barF", y + 0.92], rh: ["barR", y + 0.95], rf: S.upR, lf: S.flL, duck: 0.05 }),
    ck(2.1, at(S.S2, S.IN), { door: open, lh: ["barF", y + 0.92], rh: ["barR", y + 0.9], rf: S.upR, lf: S.upL }),
    ck(2.4, at(S.S2, S.IN), { door: open, lh: ["barF", y + 0.85], rh: ["barR", y + 0.8], rf: S.upR, lf: S.lowL }),
    ck(2.7, at(S.S1, S.IN), { door: open, lh: ["barF", y + 0.75], rh: ["barR", y + 0.65], rf: S.midR, lf: S.lowL }),
    ck(3.0, at(S.B, S.IN), { door: open, lh: ["barF", y + 0.55], rh: ["barR", y + 0.45] }),
    ck(3.2, at(S.B, S.IN), { door: open }),
    ck(3.6, r1, { door: open, lh: "in", lean: -0.12 }),
    ck(4.1, end, { door: doorFor(thG), lh: "in", lean: -0.15 }),
    ck(4.2, end, { door: doorFor(thG * 0.55), swing: true }),
    ck(4.4, end, { door: 0, swing: true }),
  ];
}
// A truck model's climb keys, worked out once.
const CLIMB_CACHE = new Map<string, ClimbKey[]>();
function climbKeys(model: TruckModel, up: boolean) {
  const k = model + (up ? "|in" : "|out");
  let keys = CLIMB_CACHE.get(k);
  if (!keys) { keys = up ? climbInKeys(cabGeom(model), truckLayout(model)) : climbOutKeys(cabGeom(model), truckLayout(model)); CLIMB_CACHE.set(k, keys); }
  return keys;
}
// The cab door during a climb (the keys' own), for Truck.cabDoor.
const CLIMB_G = cabGeom("box26"), CLIMB_L = truckLayout("box26");
const CLIMB_KEYS = { in: climbInKeys(CLIMB_G, CLIMB_L), out: climbOutKeys(CLIMB_G, CLIMB_L) };
function climbDoor(t: number, len: number, up: boolean) {
  const keys = up ? CLIMB_KEYS.in : CLIMB_KEYS.out, T = t * keys[keys.length - 1].t / len;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= T) i++;
  return doorBlend(keys[i], keys[i + 1], THREE.MathUtils.clamp((T - keys[i].t) / (keys[i + 1].t - keys[i].t), 0, 1));
}
// The door between two keys: worked by hand (eased), or swinging free: flung open, slowing to a
// stop, or swung shut, faster and faster till it slams.
function doorBlend(A: ClimbKey, B: ClimbKey, f: number) {
  const k = !B.swing ? ease(f) : B.door > A.door ? 1 - (1 - f) * (1 - f) : f * f;
  return A.door + (B.door - A.door) * k;
}
// Climbing up into a trailer at its back (bedClimb), as keys: `t` (0..1 of the climb), where the
// body stands (x, ground under it, z), how far it leans and crouches, and the feet and hands (null: a foot planted under the body, a hand free).
type BedV3 = [number, number, number];
interface BedKey { t: number; root: BedV3; lean: number; duck: number; lf: BedV3 | null; rf: BedV3 | null; lh: BedV3 | null; rh: BedV3 | null }
function bedClimbKeys(L: TruckLayout, z0: number): BedKey[] {
  // (Nothing of them past the back's edge below the floor's height: the hips stay behind it till
  // they are up over it, and the foot on the guard comes back out from under it before it goes up.)
  const R = L.bedRear, F = L.floor, G = UNDERRIDE_Y;
  const edge = (dz: number, dx = 0.14): BedV3 => [R + dx, F + 0.07, z0 + dz];   // (a glove's middle: resting on the floor)
  const guard: BedV3 = [R - 0.2, G, z0 + 0.12];   // (on the guard's bar, truck.ts)
  return [
    { t: 0, root: [R - 0.6, 0, z0], lean: 0, duck: 0, lf: null, rf: null, lh: null, rh: null },
    // Hands up over the floor's edge, and down on it.
    { t: 0.08, root: [R - 0.62, 0, z0], lean: -0.06, duck: 0, lf: null, rf: null, lh: [R - 0.06, F + 0.3, z0 - 0.24], rh: [R - 0.06, F + 0.3, z0 + 0.24] },
    // (Stood back far enough that the arms reach out straight to it, the elbows not dipping under it.)
    { t: 0.14, root: [R - 0.62, 0, z0], lean: -0.12, duck: 0, lf: null, rf: null, lh: edge(-0.24, 0.08), rh: edge(0.24, 0.08) },
    // A foot up on the underride guard: lifted over its bar from behind, then down on it.
    { t: 0.24, root: [R - 0.56, 0.06, z0], lean: -0.17, duck: 0.06, lf: [R - 0.6, 0, z0 - 0.12], rf: [R - 0.47, G + 0.17, z0 + 0.12], lh: edge(-0.24, 0.08), rh: edge(0.24, 0.08) },
    { t: 0.32, root: [R - 0.5, 0.18, z0], lean: -0.22, duck: 0.12, lf: [R - 0.6, 0, z0 - 0.12], rf: guard, lh: edge(-0.24, 0.08), rh: edge(0.24, 0.08) },
    // Up onto it, pulling on the hands, the other foot off the road.
    { t: 0.5, root: [R - 0.4, G, z0], lean: -0.28, duck: 0.02, lf: [R - 0.52, G + 0.05, z0 - 0.12], rf: guard, lh: edge(-0.24, 0.24), rh: edge(0.24, 0.24) },
    // That foot up behind the edge, then onto the floor.
    { t: 0.6, root: [R - 0.46, 0.7, z0], lean: -0.36, duck: 0.12, lf: [R - 0.16, F + 0.16, z0 - 0.12], rf: guard, lh: edge(-0.25, 0.3), rh: edge(0.25, 0.3) },
    // (Feet on the floor a few centimetres up: with no ankle, a shin leant forward tips the heel down.)
    { t: 0.68, root: [R - 0.34, 0.8, z0], lean: -0.45, duck: 0.16, lf: [R + 0.46, F + 0.04, z0 - 0.12], rf: guard, lh: edge(-0.26, 0.42), rh: edge(0.26, 0.42) },
    // Weight on it; the guard foot back out from under the floor, then up behind the edge.
    { t: 0.74, root: [R - 0.3, 0.9, z0], lean: -0.48, duck: 0.2, lf: [R + 0.46, F + 0.04, z0 - 0.12], rf: [R - 0.36, G + 0.15, z0 + 0.12], lh: edge(-0.26, 0.42), rh: edge(0.26, 0.42) },
    { t: 0.8, root: [R - 0.12, 0.98, z0], lean: -0.5, duck: 0.26, lf: [R + 0.46, F + 0.04, z0 - 0.12], rf: [R - 0.14, F + 0.14, z0 + 0.12], lh: edge(-0.26, 0.42), rh: edge(0.26, 0.42) },
    // Over the edge onto the floor, crouched.
    // (Not crouched so low that a shin, tipped well forward, tips the shoe's heel into the floor.)
    { t: 0.9, root: [R + 0.32, F, z0], lean: -0.25, duck: 0.08, lf: [R + 0.46, F + 0.04, z0 - 0.12], rf: [R + 0.4, F + 0.04, z0 + 0.12], lh: null, rh: null },
    { t: 1, root: [R + 0.5, F, z0], lean: 0, duck: 0, lf: null, rf: null, lh: null, rh: null },
  ];
}
// Where the climb has the driver at progress u of it (truck frame), for the stop's path.
export function bedClimbAt(L: TruckLayout, c: Chore, u: number): { x: number; y: number; z: number } {
  const keys = bedClimbKeys(L, c.a?.[2] ?? 0), T = c.kind === "bedUp" ? u : 1 - u;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= T) i++;
  const A = keys[i], B = keys[i + 1], e = ease(THREE.MathUtils.clamp((T - A.t) / (B.t - A.t), 0, 1));
  return { x: A.root[0] + (B.root[0] - A.root[0]) * e, y: A.root[1] + (B.root[1] - A.root[1]) * e, z: A.root[2] + (B.root[2] - A.root[2]) * e };
}
// Where the climb leaves the driver on the ground (climbDown's end, climbUp's start), facing.
export function cabGround(model: TruckModel, up: boolean): [number, number, number, number] {
  const keys = climbKeys(model, up), k = up ? keys[0] : keys[keys.length - 1];
  return k.root;
}

const wrapYaw = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function springStepCrew(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const c1 = x - target, c2 = v + omega * c1, e = Math.exp(-omega * dt);
  return [target + (c1 + c2 * dt) * e, (c2 - omega * (c1 + c2 * dt)) * e];
}


// Walking round what's held (Chore.round): it stays at the middle of a..b (cx, cz), `r` from
// either end, turning about itself; the driver goes half way round it, facing it, from a to b
// (by the kerb side, +z: behind the truck that is the parking lane, out of the traffic), at that
// distance along the way and no further out to the side than the bed's walls allow when in it,
// or ROUND_SIDE behind the truck.
export function roundAt(L: TruckLayout, c: Chore, u: number) {
  const a = c.a!, b = c.b!, cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2, r = Math.hypot(b[0] - a[0], b[2] - a[2]) / 2;
  const ux = (a[0] - cx) / (r || 1), uz = (a[2] - cz) / (r || 1);
  const inBed = cx >= L.bedRear && a[1] > 0.3, side = c.roundStill ?? Math.min(r, inBed ? L.hw - 0.35 : c.tool === "palletJack" ? ROUND_SIDE_JACK : ROUND_SIDE);   // (round a crate that stays put: along its side)
  const th = Math.PI * ease(u), vx = -uz, vz = ux;
  const sgn = vz >= 0 ? 1 : -1;   // (round by the kerb side, +z)
  // (Round a crate that stays put: out to its side early, then along it, round its corners rather
  // than across them; smoothly, at a walk.)
  const ca = Math.cos(th), s1 = Math.min(1, 1.6 * Math.sin(th)), sa = c.roundStill ? 1 - (1 - s1) * (1 - s1) : Math.sin(th);
  const x = cx + ux * r * ca + vx * sgn * side * sa, z = cz + uz * r * ca + vz * sgn * side * sa;
  return { x, z, yaw: Math.atan2(-(cz - z), cx - x), cx, cz, r };
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
// The walk ramp's surface height at x (truck frame), set down, or null off its length.
function rampY(L: TruckLayout, x: number): number | null {
  const len = L.floor > 1 ? 3.6 : 3.0, pivotY = L.floor - 0.16, th = Math.asin(Math.min(1, (pivotY - 0.02) / len));
  if (x >= L.bedRear || x <= L.bedRear - len * Math.cos(th)) return null;
  return pivotY - (L.bedRear - x) * Math.tan(th);
}
// The legs bent for the hips lowered by `drop` (feet under them), as added to standing: hip, knee.
// Climbing over a load (Chore.over): this much of the climb at each end is getting up onto it
// or down off it.
const CLIMB_UP = 0.16;
// On hands and knees, k of the way down to it (1: crawling), the knees and hands taking turns
// by `phase` (strides).
function crawlPose(P: BodyPose, phase: number, k: number) {
  const s = Math.sin(phase * Math.PI * 2) * 0.25;
  // (Torso level, arms hanging straight down from it to the hands, thighs straight down to the
  // knees, shins back along the top, head up to look ahead.)
  const crawl: BodyPose = { bend: -1.35, twist: 0, headP: 0.9, headY: 0,
    shLP: 1.35 + s, shLR: 0.1, elL: 0.05, shRP: 1.35 - s, shRR: 0.1, elR: 0.05,
    hipL: 0.15 - s, knL: -1.55, hipR: 0.15 + s, knR: -1.55, sideL: 0, sideR: 0, drop: 0.45 };
  blendPose(P, crawl, k, P);
}
function crouchLegs(drop: number): [number, number] {
  const leg = (D: number): [number, number] => {
    const d = THREE.MathUtils.clamp(D, 0.3, LEG_U + LEG_L - 0.002);
    return [Math.acos(THREE.MathUtils.clamp((LEG_U * LEG_U + d * d - LEG_L * LEG_L) / (2 * LEG_U * d), -1, 1)),
      -(Math.PI - Math.acos(THREE.MathUtils.clamp((LEG_U * LEG_U + LEG_L * LEG_L - d * d) / (2 * LEG_U * LEG_L), -1, 1)))];
  };
  const [h0, k0] = leg(HIP_Y), [h1, k1] = leg(HIP_Y - Math.max(0, drop));
  return [h1 - h0, k1 - k0];
}
// The hand truck (its own frame: the axle at the origin): wheel radius, the handle's middle,
// the nose plate's underside; its wheels this far ahead of the driver's feet, and its handle at
// these heights above them, empty and loaded.
// A grip's point is the middle of the glove: this far off the surface it holds (half a glove).
const GLOVE = 0.06;
// A load waiting on the pavement at a doorless stop: this far in front of the fetch spot.
// (A pallet jack's, where its forks hold it: wheeled to its place and set down, not stepped back
// from.)
const stageAhead = (tool: string | null | undefined) => tool === "palletJack" ? JACK_LEAD + 0.77 : STAGE_AHEAD;
// Where trip k's load waits (truck frame, relative to the ground: x, y, z, yaw) in front of a
// doorless fetch spot, as it is held there (on the hand truck's nose plate stood upright, on the
// pallet jack's forks, on its dolly, on its rim, set down from the arms), trips side by side across.
// (`pickup`: a team lift's is turned to point at the driver, as teamLoad holds it on a pickup; a
// drop's points away from them.)
function stageLocal(cargo: string, size: number[], at: number[], face: number, k: number, pickup = false): [number, number, number, number] {
  const [l, hh, w] = size, h = CARGO_BY_ID.get(cargo)!.handling, tool = STYLE[h].tool;
  // (A team lift's: from the driver at its end along the way they face, as it is held: chores.ts
  // teamRow.)
  if (h === "teamLift") { const r = teamSpan(l) / 2; return [at[0] + Math.cos(face) * r, 0, at[2] - Math.sin(face) * r, face + (pickup ? Math.PI : 0)]; }
  const across = !tool && h !== "push" && h !== "roll" && l > 0.6 && w >= 0.3;
  const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * stageGap(cargo, size);   // (as chores.ts facilityFor)
  const ahead = stageAhead(tool);
  const x = at[0] + Math.cos(face) * ahead + Math.sin(face) * side, z = at[2] - Math.sin(face) * ahead + Math.cos(face) * side;
  return [x, h === "roll" ? hh / 2 : 0, z, face + (across ? Math.PI / 2 : 0)];
}
// Walking round what's held, it is blended over to where it is turned (and back) this briskly: 1
// over the whole walk round, more sooner.
const ROUND_BLEND = 1.2;
// Walking round what's held behind the truck, the driver goes no further out to the side than this.
const ROUND_SIDE = 1.0;
// Or round a pallet jack, its pallet's corners swinging out as it turns about its middle (m).
const ROUND_SIDE_JACK = 1.25;
// A team lift's worker, in the driver's footsteps: worked out in steps this long (s), settling to
// the load's length from them over this long from taking hold (s), and never faster than this (m/s).
// A team lift's worker, walking in along the kerb at a stop with no door, sets off this long after
// the truck stops (s).
const WALK_IN_AFTER = 2;
const MATE_DT = 1 / 15, MATE_SETTLE = 0.6, MATE_V = 2.4;
// A load carried in the arms has its top no higher than this above the feet (below the chin).
const CARRY_TOP = 1.36;
// Points of the driver's head (in its frame: its middle, its face, its crown), kept out of loads.
export const HEAD_POINTS: [number, number][] = [[0, 0.17], [0.11, 0.17], [-0.11, 0.17], [0, 0.3], [0.11, 0.29], [0.08, 0.06], [-0.1, 0.06]];
const HT_WHEEL = 0.13, HT_GRIP: [number, number] = [0.02, 1.19], HT_PLATE = -0.115, HT_HANDS = 1.12, HT_HANDS_LOADED = 1.04;
// Turning with it in hand (crewpath.ts Hold): loaded, about the load more and slower.
export const handTruckHold = (loaded: boolean): Hold => loaded ? { lead: HT_LEAD, pivot: 0.8, omega: 2.6, rate: 1.7, wheels: true } : { lead: HT_LEAD, pivot: 0.5, omega: 4, rate: 3.2, wheels: true };
// What a load on it keeps clear of: the driver's face and chest, this far ahead of the feet
// (leaning into the push, hunched), up to the top of the head this high above them.
// The walk ramp's low end, this far (m) from its foot, is low enough to step across.
const RAMP_LIP = 0.6;
const HT_BODY = 0.5, HT_HEAD_TOP = 1.85, HT_HAND_AHEAD = 0.45;
// A fetch turned round inside a doorway (Chore.flip): the walk in takes this much of it, and the
// walk out as much; the driver, and all they hold, are out of sight from FLIP_HIDE to 1 - FLIP_HIDE.
const FLIP_IN = 0.38, FLIP_HIDE = 0.4;
// (A team lift's worker comes out of the doorway after a drop this far behind the driver.)
const MATE_TRAIL = 0.8;
// (And steps down off a walk ramp's side over this far past it (m).)
const RAMP_STEP = 0.45;
// (How far in, of the way, at u.)
// (`fin`, `fout`: walked in already going, from the move before, or walked on out into the next:
// not eased from or to a stand there, but from (or to) going at `sIn` (`sOut`) of the depth over
// the walk in's time, to a stand inside.)
const flipDepth = (u: number, fin = false, fout = false, sIn = 1, sOut = 1) => {
  const on = (x: number, s: number) => s * x + (3 - 2 * s) * x * x + (s - 2) * x * x * x;   // (from going at slope s, to a stand)
  if (u < FLIP_IN) { const x = u / FLIP_IN; return fin ? on(x, sIn) : THREE.MathUtils.smoothstep(x, 0, 1); }
  if (u > 1 - FLIP_IN) { const x = (1 - u) / FLIP_IN; return fout ? on(x, sOut) : THREE.MathUtils.smoothstep(x, 0, 1); }
  return 1;
};
// The driver stands on the bed's floor only this far in from its walls (ground).
const DRIVER_INSET = 0.08;
// Hunched behind a tall load on it: the hips this much lower, the back bent and the head bowed
// this much more (rad).
const HUNCH_DROP = 0.12, HUNCH_BEND = 0.14, HUNCH_HEAD = 0.18;
// The pallet jack: its fork rollers ahead of the steering wheel, its handle's length and pivot,
// the steering wheel ahead of the driver's feet and the handle's height above them.
const JACK_FORKS = [-0.25, 0.25];   // the pallet jack's forks, either side of its middle

const JACK_TIP = 1.32, JACK_HANDLE = 1.0, JACK_PIVOT: [number, number] = [-0.04, 0.2];
// The jack's handle: its grip this far in front of the driver's middle (m); and how far it tips
// back from upright, as the sine of its angle, from folded up to drawn right back.
const JACK_HAND_AHEAD = 0.4, JACK_UPRIGHT = 0.1, JACK_TIPPED = 0.95;
// Taking a tool from its rest: where the driver goes (from the stand to close by it, to grip its
// handle; back a step as it is tipped into the hands, to where it's held as carried; back to the
// stand), at progress u of the chore (toolPut: the same, backwards).
function toolTake(r: ToolRest, tool: "handTruck" | "palletJack", stand: [number, number, number], u: number) {
  const lead = tool === "handTruck" ? HT_LEAD : JACK_LEAD, close = tool === "handTruck" ? 0.72 : 0.62;
  const psi = Math.atan2(-(r.at[2] - stand[2]), r.at[0] - stand[0]);   // facing it from the stand
  const fx = Math.cos(psi), fz = -Math.sin(psi);
  const near = [r.at[0] - fx * close, r.at[2] - fz * close], held = [r.at[0] - fx * lead, r.at[2] - fz * lead];
  const k = toolTakeK(u), go = THREE.MathUtils.smoothstep(u, 0.0, 0.3), back = THREE.MathUtils.smoothstep(u, 0.66, 1.0);
  let x = stand[0] + (near[0] - stand[0]) * go, z = stand[2] + (near[1] - stand[2]) * go;
  x += (held[0] - near[0]) * k.carry; z += (held[1] - near[1]) * k.carry;
  x += (stand[0] - held[0]) * back; z += (stand[2] - held[1]) * back;
  return { x, z, yaw: u < 0.7 ? psi : 0 };
}
// Taking a tool: how firmly it's held (hands reaching for it) and how far from its rest into the
// hands (tipped back as the driver steps back with it).
function toolTakeK(u: number) { return { grip: THREE.MathUtils.smoothstep(u, 0.18, 0.36), carry: THREE.MathUtils.smoothstep(u, 0.4, 0.64) }; }
// The roll-up door's opening (Truck.rearDoor) over doorOpen: bend to the handle, lift it to the
// chest, push it up overhead. doorClose: reach up, pull it down to the chest, bend and push it shut.
function doorControl(kind: "doorOpen" | "doorClose", u: number) {
  if (kind === "doorOpen") return u < 0.22 ? 0 : u < 0.55 ? 0.3 * THREE.MathUtils.smoothstep(u, 0.22, 0.55) : 0.3 + 0.7 * THREE.MathUtils.smoothstep(u, 0.55, 0.85);
  return u < 0.15 ? 1 : u < 0.55 ? 1 - 0.7 * THREE.MathUtils.smoothstep(u, 0.15, 0.55) : 0.3 * (1 - THREE.MathUtils.smoothstep(u, 0.55, 0.85));
}
// Arm lengths of the Character rig (shoulder to elbow, elbow to the hand), and its shoulder
// height above the hips.
const ARM_UPPER = ARM_U, ARM_FORE = ARM_F, SHOULDER_UP = SHOULDER_Y;   // (character.ts)
// Both hands at a point `dx` ahead of the feet and `h` above them: crouching and leaning for
// low points, then the two arm segments solved to reach it (as far as they go). Options: `hR`
// puts the right hand at its own height (hand over hand), `crouch` bends the knees that much
// more (metres), and `narrow` (0..1) brings the hands in from shoulder width to meet in the middle.
function reachPose(dx: number, h: number, P: BodyPose, o: { hR?: number; crouch?: number; narrow?: number } = {}): BodyPose {
  const hR = o.hR ?? h, crouch = o.crouch ?? 0, narrow = o.narrow ?? 0, hm = (h + hR) / 2;
  const k = THREE.MathUtils.clamp((1.1 - hm) / 0.85, 0, 1), up = THREE.MathUtils.clamp((Math.max(h, hR) - 1.6) / 0.4, 0, 1);
  let b = -0.1 - 0.8 * k + 0.12 * up, drop = 0.45 * k + crouch;
  // The face no nearer the door than the hands (the cap's brim leads the head): lean less and
  // crouch more for a low reach.
  const brim = (bb: number) => 0.205 * Math.cos(bb) + 0.835 * Math.sin(-bb);
  if (brim(b) > dx - 0.02) {
    const b0 = b;
    let lo = b0, hi = 0.15;
    for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (brim(m) > dx - 0.02) lo = m; else hi = m; }
    b = hi; drop = Math.min(0.62, drop + SHOULDER_UP * (Math.cos(b) - Math.cos(b0)) * 1.15);
  }
  P.bend = b; P.drop = drop;
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

// The worker's arms on a team lift before they reach for the load (shoulder pitch, elbow).
const TEAM_BACK_ARM: [number, number] = [0.35, 0.2];
// (The worker's way of going across the load, chores.ts mateTurn, judged over MATE_LOOK s either side.)
const MATE_LOOK = 0.2;
// (An animal led in the driver's footsteps walks them smoothed over this far (m) either side of it, crew.ts walkHerd.)
const HERD_LOOK = 0.8;
// A team lift: each end of the load held this high above its carrier's feet (TEAM_CLEAR, chores.ts:
// how far from them).
const TEAM_HANDS = 0.92;
// Or at the shoulder (chores.ts HIGH_CARRY): its bottom over the bins and benches.
const TEAM_SHOULDER = 1.22;
// A forklift at a trailer's back stops its fork heels this far behind it, its mast (0.3 m behind
// them) clear of the underride guard (truck.ts, out to 0.27 m behind).
const FORK_GUARD = 0.62;
// A flatbed's forklift from a front door raises its load to the deck over this distance (m) before
// any of it is over the deck (worker).
const FORK_RISE = 1.2;
// And handing a pallet over there, its tines in the pallet's fork pockets this far up from its foot.
const HAND_POCKET = 0.06;

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
