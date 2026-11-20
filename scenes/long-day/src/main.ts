// The journey simulation drives the truck through the city from job to job, reversing into
// loading docks, swapping trucks at Ryder rental lots and moving on to a new city every ~30
// minutes; the camera director films it, and the crew (the driver and a dock worker) does the
// work at each stop.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { SEA_REACH } from "./outline.ts";
import { hash2 } from "./rng.ts";
import { journeyPeriod, readConfig } from "./env.ts";
import { DEBUG_BLOCK, DEBUG_CAMLOG, DEBUG_MEMLOG, DEBUG_SCRUBTEST, DEBUG_SKIP_MINUTES, DEBUG_VIEW } from "./debug.ts";
import { captureCanvasClass, uploadable } from "./canvas.ts";
import { ChunkStreamer, disposeTree } from "./chunks.ts";
import type { ChunkBuild } from "./chunks.ts";
import { OCCLUSION } from "./occlusion.ts";
import { Persistence, STATE_VERSION } from "./persist.ts";
import type { SavedState } from "./persist.ts";
import { applyCutaway, applyDriverSpot, cutUniforms, NO_CUT_BOXES, updateCutaway, updateDriverSpot } from "./cutaway.ts";
import { Engine } from "./engine.ts";
import { applyLampGlow, applyLampLight, Atmosphere, HEAD_LIGHTS, HEAD_Y, INTERIOR_LIGHT, LAMPS_ON, updateLampLights } from "./atmosphere.ts";
import { Hud } from "./hud.ts";
import { PuffSystem } from "./puffs.ts";
import { LIVERY_ASSETS, Truck, TruckKit, truckLayout } from "./truck.ts";
import type { LiveryName, TruckModel } from "./truck.ts";
import { makeFacadeMaterial, setFacadeAtlas } from "./facade.ts";
import { paintFacadeAtlas } from "./facadeart.ts";
import { makeLampMaterial, setSignalPreempt, setSignalTime } from "./signals.ts";
import { interchangeTrack } from "./interchange.ts";
import { realSeason, weatherMix } from "./climate.ts";
import { CITY_HI, CITY_LO, cityDistance, insideCity, kerbDoors, makeCityChunkBuilder, parkedObstacles, pavementObstacles } from "./city.ts";
import { elevatedLine } from "./decor.ts";
import { BLOCK, RING, STREET } from "./grid.ts";
import type { CityMaterials } from "./city.ts";
import { facilityAt, facilityName } from "./facilities.ts";
import { ATLAS_UPLOAD, marquee, plateAtlas, signAtlas } from "./signs.ts";
import { CARGO_BY_ID, TRUCK_SLOTS } from "./cargo.ts";
import { smooth } from "./route.ts";
import type { Pose } from "./route.ts";
import { ARRIVE_LEN, BIOME_OF, BORE_H, BORE_HALF, citySeedOf, CountryRoad } from "./country.ts";
import { Journey, JOURNEY_LOG, setDoorProbe, setParkedProbe, setPavementProbe } from "./journey.ts";
import type { Mode } from "./journey.ts";
import { Director } from "./director.ts";
import { Crew } from "./crew.ts";
import { DockFx, FrontDoorFx } from "./dockfx.ts";
import { FleetBaker } from "./fleet.ts";
import { COUNTRY_CLEAR, CountryWorld } from "./countryworld.ts";
import { ElevatedReach, elevatedLift } from "./elevated.ts";
import { Frame, FreewayReach, FreewayTraffic, FW_TIP, HeadSpots } from "./freeway.ts";
import { Backdrop } from "./backdrop.ts";
import { Traffic } from "./traffic.ts";
import { Crowd } from "./crowd.ts";
import { CLOCK, VIG_LOG } from "./vignettes.ts";
import { SNAP_SKIPPED } from "./snap.ts";
import { Ambient } from "./ambient.ts";
import { StreetLife } from "./life.ts";

const STREAM_RADIUS = 3;
// City chunks that leave the view are kept (ChunkStreamer's cache) up to this much geometry
// (about as much again in GPU buffers), so streets driven again come straight back, and the
// cells round the truck's route are built ahead into it. Kept chunks hold their sign and plate
// slots, so the cache sheds its oldest when either atlas runs low.
const CHUNK_CACHE_BYTES = 512e6;
const SIGN_RESERVE = 64, PLATE_RESERVE = 48;
// Prefetch: the cells within STREAM_RADIUS of the route ahead (sampled every PREFETCH_STEP m) and
// round the next stops, at most PREFETCH_MAX of them.
const PREFETCH_STEP = 20, PREFETCH_MAX = 320, PREFETCH_STOPS = 3;
const TOUR_VIEW = DEBUG_VIEW !== "" && DEBUG_VIEW !== "scrub" && DEBUG_VIEW !== "countryTop" && DEBUG_VIEW !== "rear" && DEBUG_VIEW !== "door" && DEBUG_VIEW !== "yard" && DEBUG_VIEW !== "dock" && DEBUG_VIEW !== "siteEdge";   // test renders with a tour camera

export default function createScene({ sys, env, assets }: SceneInputs): Scene {
  const cfg = readConfig(env);
  let engine: Engine, streamer: ChunkStreamer, hud: Hud, persist: Persistence;
  let puffs: PuffSystem, kit: TruckKit, fleet: FleetBaker, truck: Truck, journey: Journey, mats: CityMaterials, director: Director, crew: Crew, dockFx: DockFx, frontDoor: FrontDoorFx;
  let other: Truck | null = null;
  const backdrop = new Backdrop();
  let seekMs = 0;   // the last seek's cost (debug HUD)
  let traffic: Traffic, crowd: Crowd, ambient: Ambient, countryWorld: CountryWorld, elevatedReach: ElevatedReach;
  let freewayReach: FreewayReach, cityCars: FreewayTraffic, roadCars: FreewayTraffic;
  let roadFrame: { road: CountryRoad; F: Frame } | null = null;
  let atmosphere: Atmosphere;
  let roadShown: CountryRoad | null = null;
  const skyTmp = new THREE.Color(), skyTmp2 = new THREE.Color();
  const headSpots = new HeadSpots();   // (the headlight slots' candidates, reused every frame)
  let memLogSlot = -1;
  let baked = false, cityShown = -1, tabletKey = "";
  let lastMode: Mode | "" = "";
  const focus = new THREE.Vector3(), aheadDir = { x: 0, z: 0 };
  const pose: Pose = { x: 0, z: 0, h: 0, k: 0 };
  const spotSeat = new THREE.Vector3(), spotChest = new THREE.Vector3();
  let base = 0, randomSeed = false, scrubPrev = 0;          // journey time at scene time 0 (the saved time)
  let lastX = NaN, lastZ = 0;   // the truck's last rendered position, for wheel travel

  function snapshot(): SavedState {
    return { v: STATE_VERSION, seed: cfg.seed, random: randomSeed, season: journey.startSeason, simTime: journey.st.simTime, period: journey.period, journey: null };
  }

  // The sea off a coastal or port town (outline.ts): one plane under the whole town at the water's
  // level, from the shore's deepest bay out to the horizon; the land and the beach lie over it.
  let seaMesh: THREE.Mesh | null = null;
  function buildSea() {
    if (seaMesh) { engine.world.remove(seaMesh); seaMesh.geometry.dispose(); seaMesh = null; }
    const O = journey.plan.outline, d0 = O.shoreDeepest, deep = d0 === null ? null : d0 + SEA_REACH + 10;   // (under the land the sea reaches round: outline.ts seaward)
    if (O.sea === null || deep === null) return;
    const FAR = 7000, s = O.sea, b = new Batch();
    const x0 = s === 0 ? O.X1 - deep : s === 2 ? O.X0 - FAR : O.X0 - FAR, x1 = s === 0 ? O.X1 + FAR : s === 2 ? O.X0 + deep : O.X1 + FAR;
    const z0 = s === 1 ? O.Z0 - FAR : s === 3 ? O.Z1 - deep : O.Z0 - FAR, z1 = s === 1 ? O.Z0 + deep : s === 3 ? O.Z1 + FAR : O.Z1 + FAR;
    b.box((x0 + x1) / 2, -1.55, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0, 0x2f6f9a);
    const m = b.build(mats.ground)!; seaMesh = m; engine.world.add(m);
  }
  function buildCity() {
    streamer?.clear();
    buildSea();
    engine.setSky(journey.plan.style.sky);
    backdrop.build(journey.plan.style, journey.st.citySeed);
    // Each chunk's tall parts go into the occlusion map the camera consults (occlusion.ts).
    const build = makeCityChunkBuilder(mats, journey.plan, (st) => fleet.build(st));
    const withOcclusion = function* (cx: number, cz: number): ChunkBuild {
      const g = yield* build(cx, cz);
      // (The block holds its sign slots and lamp sites from here: dropped at this yield, as
      // ChunkStreamer.clear does, it hands them back.)
      let dropped = true;
      try { yield; dropped = false; } finally { if (dropped && g) disposeTree(g); }
      if (g) {
        const f = OCCLUSION.add(g, cx * BLOCK, cz * BLOCK, [mats.ground], "city"), u = g.userData;
        const prev = u.onDispose, stash = u.onStash, restore = u.onRestore;
        u.onDispose = () => { prev?.(); OCCLUSION.remove(f); };
        u.onStash = () => { stash?.(); OCCLUSION.remove(f); };
        u.onRestore = () => { restore?.(); OCCLUSION.restore(f); };
      }
      return g;
    };
    streamer = new ChunkStreamer(engine.world, BLOCK, withOcclusion, STREAM_RADIUS, 1, (cx, cz) => cityDistance(cx, cz) > RING);
    streamer.cacheLimit = CHUNK_CACHE_BYTES;
    streamer.exact = PREVIEW;   // a scrubbed frame shows the same blocks as the played one
    streamer.keepCached = () => signAtlas.freeSlots >= SIGN_RESERVE && plateAtlas.freeSlots >= PLATE_RESERVE;
    prefetchKey.length = 0;
    cityShown = journey.st.city;
  }

  // The cells the truck will want next (ChunkStreamer.setPrefetch): along the rest of its route,
  // nearest the route first, then round its next stops. Worked out again when the route or the
  // stops change.
  // (What they depend on, compared field by field: this runs every frame, and allocates nothing
  // unless something changed. Cleared, with prefetchKey.length = 0, to work them out again.)
  const prefetchKey: (number | string | null)[] = [];
  const prefetchPose: Pose = { x: 0, z: 0, h: 0, k: 0 };
  let pfAt = 0, pfChanged = false;
  function pfPut(v: number | string | null) { if (prefetchKey[pfAt] !== v) { prefetchKey[pfAt] = v; pfChanged = true; } pfAt++; }
  function updatePrefetch() {
    const st = journey.st, path = st.mode === "drive" ? journey.path : null, r = path ? st.route : null;
    pfAt = 0; pfChanged = prefetchKey.length === 0;
    pfPut(st.city); pfPut(st.mode); pfPut(r ? r.d : null); pfPut(r ? r.before.toFixed(1) : null); pfPut(r ? r.edges.join(",") : null);
    for (let k = 0; k < PREFETCH_STOPS; k++) { const site = st.stops[k]?.site; pfPut(site ? site.bx : null); pfPut(site ? site.bz : null); }
    if (!pfChanged) return;
    const cells: [number, number][] = [], seen = new Set<string>();
    const ring = (bx: number, bz: number, r: number) => {
      const round: [number, number, number][] = [];
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const k = `${bx + dx},${bz + dz}`;
        if (!seen.has(k)) { seen.add(k); round.push([bx + dx, bz + dz, dx * dx + dz * dz]); }
      }
      round.sort((a, b) => a[2] - b[2]);
      for (const [x, z] of round) cells.push([x, z]);
    };
    if (path) {
      let lx = NaN, lz = NaN;
      for (let s = st.s; s <= path.length && cells.length < PREFETCH_MAX; s += PREFETCH_STEP) {
        path.peek(Math.min(s, path.length), prefetchPose);
        const bx = Math.floor(prefetchPose.x / BLOCK), bz = Math.floor(prefetchPose.z / BLOCK);
        if (bx !== lx || bz !== lz) { lx = bx; lz = bz; ring(bx, bz, STREAM_RADIUS); }
      }
    }
    for (const p of st.stops.slice(0, PREFETCH_STOPS)) if (p.site && cells.length < PREFETCH_MAX) ring(p.site.bx, p.site.bz, STREAM_RADIUS);
    if (cells.length > PREFETCH_MAX) cells.length = PREFETCH_MAX;
    streamer.setPrefetch(cells);
  }

  let revFrom: number | null = null;   // the trailer's articulation as reversing began
  function placeTruck(dt: number, jumped: boolean) {
    const p = journey.renderPose(pose);
    const moved = jumped || Number.isNaN(lastX) ? 0 : Math.hypot(p.x - lastX, p.z - lastZ) * (journey.st.mode === "reverse" ? -1 : 1);
    lastX = p.x; lastZ = p.z;
    truck.follow(p.x, p.z, p.h, p.k, moved);
    // Out of town, the road's hills (and up an on-ramp onto a freeway); in town, up a garage's
    // ramps and on its roof, or down a freeway's off-ramp.
    const m = journey.st.mode, pr = m === "country" || m === "inbound" ? pickRoad0() : null;
    if (pr && pr.s > 0) truck.setGrade(pr.road.truckY(pr.s), pr.road.truckGrade(pr.s, truck.wheelbase));
    else { const lift = journey.truckLift(truck.wheelbase); truck.setGrade(lift.y, lift.grade); }
    const aboard = journey.countryAboard;
    truck.speed = aboard ? 0 : journey.st.v; truck.accel = aboard ? 0 : journey.accel;
    // Reversing into a bay, the trailer's axles follow the bay path (journey.ts reversePose);
    // blended over the first metres back from however the hitch left it on the way in.
    const ty = journey.trailerYaw();
    if (ty !== null) {
      if (jumped || revFrom === null) revFrom = jumped ? ty : truck.trailerYaw;
      truck.trailerYaw = revFrom + (ty - revFrom) * THREE.MathUtils.smoothstep(journey.reversed, 0, 4);
    } else {
      revFrom = null;
      // (Driving and stopped in town: at the angle the journey steps it to (hitchStep), the trailer
      // street life and the tests know, rather than the truck's own model, which can drift from it.
      // Out on the road, the truck's own.)
      if (m === "drive" || m === "dwell") truck.trailerYaw = journey.renderHitchYaw();
      else if (jumped) truck.trailerYaw = 0;
    }
  }

  function newTruck(model: TruckModel) {
    const t = new Truck(kit, model, puffs);
    engine.scene.add(t.root);
    freshTruck.set(t, t.save());
    return t;
  }
  // Trucks out of use (swapped out, the spare gone): hidden rather than disposed, so undoing a
  // part-tick or loading a snapshot (presLoad) puts back the very trucks it saved. Past a few the
  // oldest are disposed; a board, which keeps no snapshots, disposes them at the next tick (tick).
  // One taken back into use starts as a new one would, unless its saved state is put back (presLoad).
  const IDLE_TRUCKS = 3;
  const idleTrucks: Truck[] = [];
  const freshTruck = new WeakMap<Truck, ReturnType<Truck["save"]>>();
  function idleTruck(t: Truck) {
    t.root.visible = false; idleTrucks.push(t);
    if (idleTrucks.length > IDLE_TRUCKS) idleTrucks.shift()!.dispose();
  }
  // (The latest idled of the model: the one a part-tick's undo wants back. `fresh`: reset as new,
  // for one whose saved state doesn't follow.)
  function wakeTruck(model: TruckModel, fresh: boolean) {
    let i = idleTrucks.length - 1;
    while (i >= 0 && idleTrucks[i].model !== model) i--;
    if (i < 0) return newTruck(model);
    const t = idleTrucks.splice(i, 1)[0];
    t.root.visible = true;
    if (fresh) { t.load(freshTruck.get(t)!); t.resetLooks(); }
    return t;
  }
  // Make the driven truck and the second one (or none) these models, keeping the trucks already
  // there where they fit: for the driven model the driven truck first (a swap: the second one),
  // for the second model the second truck first. Says whether the driven truck changed.
  function placeTrucks(tm: TruckModel, om: TruckModel | null, fresh = true) {
    const prev = truck, prevOther = other;
    const fits = (x: Truck | null, m: TruckModel, taken: Truck | null) => (x && x !== taken && x.model === m ? x : null);
    const t = fits(prev, tm, null) ?? fits(prevOther, tm, null) ?? wakeTruck(tm, fresh);
    const o = om ? fits(prevOther, om, t) ?? fits(prev, om, t) ?? wakeTruck(om, fresh) : null;
    for (const x of [prev, prevOther]) if (x && x !== t && x !== o) idleTruck(x);
    truck = t; other = o;
    return t !== prev;
  }

  // Keep the second truck in step with the journey: the spare parked ahead at a swap stop,
  // which becomes the driven truck at the hand-over, leaving the old one parked.
  function syncTrucks() {
    const st = journey.st;
    // (A new driven truck, somewhere else: its wheels and trailer don't travel from where the last one stood.)
    if (placeTrucks(st.truck, st.spare ?? st.parked?.model ?? null)) { truck.engineOn = true; tabletKey = ""; lastX = NaN; }
    if (other) {
      if (st.spare) journey.sparePose(pose);
      else if (st.parked) { pose.x = st.parked.x; pose.z = st.parked.z; pose.h = st.parked.h; pose.k = 0; }
      other.follow(pose.x, pose.z, pose.h, 0, 0);
      other.speed = 0; other.accel = 0; other.engineOn = false; other.hazards = false; other.signal = 0; other.headlights = false;
    }
  }

  const siteEdgeAt = new THREE.Vector3();   // (the siteEdge view's streaming centre)
  // Test renders only: a tour camera on the downtown core nearest the start.
  let tourT = 0, tourTrain = -1;
  function tourCamera(dt: number): boolean {
    if (!DEBUG_VIEW || DEBUG_VIEW === "countryTop" || DEBUG_VIEW === "scrub") return false;
    tourT += dt;
    const plan = journey.plan;
    let best = Infinity, bx = 0, bz = 0;
    for (let z = -12; z <= 12; z++) for (let x = -12; x <= 12; x++) {
      const d = DEBUG_VIEW.startsWith("baton")
        ? (/^Baton/.test(facilityName(plan, facilityAt(plan, x, z), x, z)) ? Math.hypot(x, z) : Infinity)
        : plan.coreDistance(x, z);
      if (d < best) { best = d; bx = x; bz = z; }
    }
    let cx = bx * BLOCK + 9, cz = bz * BLOCK + 9;
    const cam = engine.camera;
    if (DEBUG_VIEW.startsWith("baton")) {
      cx += 30; cz += 30;
      const a = tourT * 0.25;
      const near = DEBUG_VIEW === "batonNear";
      cam.position.set(cx + Math.cos(a) * (near ? 28 : 70), near ? 40 : 24, cz + Math.sin(a) * (near ? 28 : 70));
      cam.lookAt(cx, near ? 38 : 18, cz);
    } else if (DEBUG_VIEW.startsWith("elevated")) {
      // The first elevated line: "elevated" pans east alongside it from inside town out over the
      // ramp to the country; "elevatedStreet" looks east along the street beneath it.
      let line = NaN;
      for (let z = CITY_LO; z <= CITY_HI && Number.isNaN(line); z++) if (elevatedLine(plan.style, z)) line = z;
      if (Number.isNaN(line)) line = 1;
      const lz = line * BLOCK + 9, east = (CITY_HI + 1) * BLOCK;
      if (DEBUG_VIEW === "elevatedBridge") {
        // A bridge over a road out of town: the first place on any line, either side, where the
        // line climbs again after reaching the ground.
        let bx = NaN, bl = line;
        for (let z = CITY_LO; z <= CITY_HI && Number.isNaN(bx); z++) {
          if (!elevatedLine(plan.style, z)) continue;
          for (const d of [1, -1]) {
            let down = false;
            for (let s = 0; s < 2500 && Number.isNaN(bx); s += 4) {
              const x = d > 0 ? east + s : CITY_LO * BLOCK - s, f = elevatedLift(z, x);
              if (f === 0) down = true; else if (down && f > 0.99) { bx = x; bl = z; }
            }
          }
        }
        if (Number.isNaN(bx)) bx = east + 300;
        const a = tourT * 0.15, bz = bl * BLOCK + 9;
        cam.position.set(bx + Math.cos(a) * 70, 22, bz + Math.sin(a) * 70); cam.lookAt(bx, 3, bz);
      } else if (DEBUG_VIEW === "elevatedTrain" && ambient?.trainX.length) {
        // The train that comes nearest the ramp east of town in the next 80 s.
        if (tourTrain < 0) { let best = Infinity; ambient.trainX.forEach((x, k) => { for (const d of [-1, 1]) { const m = Math.abs(x + d * 14 * 40 - east - 120); if (m < best) { best = m; tourTrain = k; } } }); }
        const x = ambient.trainX[tourTrain];
        cam.position.set(x - 25, 9, lz + 38); cam.lookAt(x, 3, lz);
      } else if (DEBUG_VIEW === "elevatedStreet") {
        const x = east - 260 + tourT * 6;
        cam.position.set(x, 2.2, lz + 5.5); cam.lookAt(x + 60, 5, lz);
      } else {
        const x = east - 60 + tourT * 8;
        cam.position.set(x - 30, DEBUG_VIEW === "elevatedHigh" ? 30 : 9, lz + 40); cam.lookAt(x, 3, lz);
      }
      cx = cam.position.x; cz = lz;
    } else if (DEBUG_VIEW === "exit" && plan.interchange) {
      // Over where the freeway's off-ramp comes down to the street: high, then low from the street.
      const t = interchangeTrack(plan), q = { x: 0, z: 0, h: 0, k: 0 };
      t.eval(t.length - 14, q);
      const low = Math.floor(tourT / 4) % 2 === 1, fx = Math.cos(q.h), fz = -Math.sin(q.h);
      if (low) cam.position.set(q.x + fx * 16 - Math.sin(q.h) * 7, 3.5, q.z + fz * 16 - Math.cos(q.h) * 7);
      else cam.position.set(q.x - fx * 4 + Math.sin(q.h) * 16, 24, q.z - fz * 4 + Math.cos(q.h) * 16);
      cam.lookAt(q.x, 0, q.z);
      cx = q.x; cz = q.z;
    } else if (DEBUG_VIEW === "aerial") {
      // High over the downtown nearest the middle of town, circling slowly, looking down at the layout.
      // (Over the river if the city has one, else a roundabout's park, else the residential block
      // nearest the middle; but the shore before any of them.)
      const G = plan.graph, ring = G.streets.find((st) => st.ring), pickB = G.blocks.find((b) => b.water) ?? (ring ? [G.faceBlock[ring.id * 2], G.faceBlock[ring.id * 2 + 1]].map((b) => G.blocks[b]).find((b) => b?.park) : undefined) ?? G.blocks.filter((b) => plan.district(b.kx, b.kz) === "residential").sort((p, q) => Math.hypot(p.cx, p.cz) - Math.hypot(q.cx, q.cz))[0];
      if (pickB) { cx = pickB.cx; cz = pickB.cz; }
      // (Over the shore first, in a town on the sea: outline.ts.)
      const sh = plan.shore[Math.floor(plan.shore.length / 2)];
      if (sh) { cx = (sh.ax + sh.bx) / 2 + sh.nx * 10; cz = (sh.az + sh.bz) / 2 + sh.nz * 10; }
      const a = tourT * 0.05;
      cam.position.set(cx + Math.cos(a) * 70, 95, cz + Math.sin(a) * 70); cam.lookAt(cx, 0, cz);
    } else if (DEBUG_BLOCK) {
      // Circling low over one block (its key after the colon: "block:kx,kz"), to see its ground.
      const B = plan.graph.block(DEBUG_BLOCK[0], DEBUG_BLOCK[1]);
      if (B) { cx = B.cx; cz = B.cz; }
      const a = tourT * 0.12;
      cam.position.set(cx + Math.cos(a) * 55, 38, cz + Math.sin(a) * 55); cam.lookAt(cx, 0, cz);
    } else if (DEBUG_VIEW === "street") {
      cam.position.set(cx - 1.5, 3.2, cz + 150 - tourT * 3);
      cam.lookAt(cx - 1.5, 9, cz - 100);
    } else {
      const a = tourT * 0.12;
      cam.position.set(cx + Math.cos(a) * 95, 38, cz + Math.sin(a) * 95);
      cam.lookAt(cx, 6, cz);
    }
    focus.set(cx, 0, cz);
    streamer.update(focus);
    updateCutaway(cam, NO_CUT_BOXES, false);
    engine.setViewDistance(streamer.clearDistance(cam.position.x, cam.position.z), 30);
    return true;
  }

  // A chase camera that drifts over a block below its roofs either rises over them or, among
  // towers, is pulled in along its line to the truck until it is back over the street.
  const chaseTmp = new THREE.Vector3(), driverChest = new THREE.Vector3();
  // The drive camera's target, moved out of the buildings (Director.avoidBuildings): over low
  // roofs it rises above the roofline; among towers it comes in over the street towards the truck.
  function chaseTargetOutOfBuildings(c: THREE.Vector3, t: THREE.Vector3, rise: boolean) {
    const plan = journey.plan;
    let roof = 0;
    const inBuildings = (x: number, z: number) => {
      // Lots fill each block right to its sidewalks; keep five metres clear of them (closer, a
      // wall fills half the frame).
      const blk = plan.graph.blockNear(x, z, 5);
      if (!blk?.inCity) return false;
      const bx = blk.kx, bz = blk.kz;
      const d = plan.district(bx, bz);
      if (d === "park") return false;
      roof = d === "downtown" ? 22 + 90 * plan.downtownHeight(bx, bz) * plan.style.towerScale : 17;
      return c.y < roof + 3;
    };
    if (!inBuildings(c.x, c.z)) return false;
    if (rise && roof + 6 <= 40) { c.y = roof + 6; return true; }
    chaseTmp.set(t.x - c.x, 0, t.z - c.z);
    const len = chaseTmp.length();
    if (len < 1) return false;
    chaseTmp.divideScalar(len);
    for (let k = 1; k < len - 1; k++)
      if (!inBuildings(c.x + chaseTmp.x * k, c.z + chaseTmp.z * k)) { c.x += chaseTmp.x * (k + 1); c.z += chaseTmp.z * (k + 1); return true; }
    return false;
  }

  const truckOutside = () => cityDistance(Math.floor(truck.root.position.x / BLOCK), Math.floor(truck.root.position.z / BLOCK)) > 0;
  // How far the city is streamed round the truck, decided on ticks only (it is presentation state,
  // saved with the snapshots): out of town further (its edge in view from the open land), coming
  // back in once the fog has eased in to match.
  function streamRadius() {
    if (truckOutside()) streamer.setRadius(5);
    else if (streamer.radius > STREAM_RADIUS && fogClear >= 0 && fogClear <= (STREAM_RADIUS + 0.6) * BLOCK) streamer.setRadius(STREAM_RADIUS);
  }
  // The city streamed round the truck at that radius. `ahead`: also build ahead of need (prefetch,
  // the next ring out), as frames do.
  function streamRound(ahead: boolean) {
    if (ahead) { aheadDir.x = Math.cos(truck.heading); aheadDir.z = -Math.sin(truck.heading); if (!truckOutside()) updatePrefetch(); }
    if (!((DEBUG_VIEW as string) === "vignette" && crowd.vig.view())) streamer.update(truck.root.position, ahead ? aheadDir : null);   // (test renders: streamed round the vignette instead)
  }

  function placeCamera(dt: number) {
    director.update({ journey, truck, other, dt, gag: crew.gagPoint, driver: crew.inSeat ? null : driverChest.copy(crew.driver.root.position).setY(crew.driver.root.position.y + 1.1) });
    if (DEBUG_VIEW === "countryTop") {   // test renders: straight down over the truck
      const p = truck.root.position;
      engine.camera.position.set(p.x, 160, p.z + 0.01); engine.camera.lookAt(p.x, 0, p.z);
      focus.copy(p); engine.setViewDistance(400, 160); return;
    }
    if (DEBUG_VIEW === "vignette") {   // test renders: watching the debug vignette from the street
      const w = crowd?.vig.view();
      if (w) {
        engine.camera.position.set(w.x + w.ox * w.back - w.fx * w.back * 0.45, w.y, w.z + w.oz * w.back - w.fz * w.back * 0.45);
        engine.camera.lookAt(w.x, w.look, w.z); focus.copy(truck.root.position); updateDriverSpot(engine.camera, null);
        streamer.update(new THREE.Vector3(w.x, 0, w.z));
        updateCutaway(engine.camera, NO_CUT_BOXES, false); engine.setViewDistance(streamer.clearDistance(engine.camera.position.x, engine.camera.position.z), 30); return;
      }
    }
    // test renders: low in the street by a site laid on its block's anchor, looking past either end
    // of its square (by turns, 5 s each) at the lots beside it
    const ss = DEBUG_VIEW === "siteEdge" ? journey.st.stops[0]?.site : null, sb = ss ? journey.plan.blockOf(ss.bx, ss.bz) : null;
    if (sb?.anchor && !sb.square) {
      const { face, delta } = sb.anchor, end = Math.floor(journey.st.simTime / 5) % 2, s = end ? 1 : -1, a = delta + (end ? 51 : 9);
      const G = journey.plan.graph, c = G.facePt(face, a - s * 9, -7), l = G.facePt(face, a + s * 6, 3);
      engine.camera.position.set(c.x, 1.3, c.z); engine.camera.lookAt(l.x, 0.4, l.z); engine.camera.fov = 50; engine.camera.updateProjectionMatrix();
      focus.copy(truck.root.position); updateDriverSpot(engine.camera, null); streamer.update(siteEdgeAt.set(c.x, 0, c.z)); return;
    }
    const dk = DEBUG_VIEW === "dock" ? journey.dock : null;
    if (dk) {   // test renders: high over the street, looking down on the bay the truck backs into
      const ox = Math.cos(dk.H), oz = -Math.sin(dk.H);
      engine.camera.position.set(dk.edge.x + ox * 24, 30, dk.edge.z + oz * 24); engine.camera.lookAt(dk.edge.x + ox * 13, 0, dk.edge.z + oz * 13); engine.camera.fov = 62; engine.camera.updateProjectionMatrix();
      focus.copy(truck.root.position); updateDriverSpot(engine.camera, null); return;
    }
    if (DEBUG_VIEW === "rear" || DEBUG_VIEW === "door" || DEBUG_VIEW === "yard") {   // test renders: close on the back of the truck (street side), towards the building, or down on the yard beside it
      const L = truckLayout(truck.model), h = truck.heading, p = truck.root.position;
      const at = (x: number, y: number, z: number) => new THREE.Vector3(p.x + Math.cos(h) * x + Math.sin(h) * z, y, p.z - Math.sin(h) * x + Math.cos(h) * z);
      const kd = journey.kerbDoor;
      if (DEBUG_VIEW === "yard") { engine.camera.position.copy(at(L.bedRear - 6, 13, -9)); engine.camera.lookAt(at(L.bedRear + 3, 0.5, 5)); }
      else if (DEBUG_VIEW === "door" && kd) {   // facing the front door from across the pavement, a little to one side
        engine.camera.position.set(kd.x + kd.nx * 3.2 - kd.nz * 7, 2.4, kd.z + kd.nz * 3.2 + kd.nx * 7); engine.camera.lookAt(kd.x + kd.nx * 1.2, 1.3, kd.z + kd.nz * 1.2);
      } else if (DEBUG_VIEW === "door") { engine.camera.position.copy(at(L.bedRear - 12, 3.2, 0)); engine.camera.lookAt(at(L.bedRear - 2, 1.4, 6)); }
      else { engine.camera.position.copy(at(L.bedRear - 4.5, 2.6, -5.5)); engine.camera.lookAt(at(L.bedRear + 0.3, 1.5, 0)); }
      focus.copy(p); updateDriverSpot(engine.camera, null); return;
    }
    if (tourCamera(dt)) return;
    const cam = engine.camera;
    truck.interiorView = director.interior;
    focus.copy(truck.root.position);
    // Held shots at a stop: street trees, poles and the like within 7 m of the camera are left out,
    // so nothing near the lens blocks the work at the truck (3 m otherwise).
    const held = director.beat === "curb" || director.beat === "load" || director.beat === "swap";
    cutUniforms.uNearClip.value = held && !director.interior ? 7 : 3;
    updateCutaway(cam, truck.cutBoxes, director.cutaway);   // (only what stands between the camera and the truck)
    // The driver spotlight: only while the truck's door is open at a stop (journey.driverSpotOn), and
    // the driver is out of the seat and the camera outside.
    const d = crew.driver.root.position;
    const out = !director.interior && !crew.inSeat && journey.driverSpotOn;
    updateDriverSpot(cam, out ? spotChest.copy(d).setY(d.y + 1.1) : null);
    // The view: as far as the city is built round the camera (never further, so nothing is seen
    // popping in), and out on the open land the country's longer view; eased across the edge of town.
    const hard = Math.hypot(streamer.clearDistance(cam.position.x, cam.position.z), cam.position.y);
    const outside = cityDistance(Math.floor(focus.x / BLOCK), Math.floor(focus.z / BLOCK)) > 0;
    const want = outside ? Math.min(COUNTRY_CLEAR, hard) : streamer.radius > STREAM_RADIUS ? Math.min(hard, (STREAM_RADIUS + 0.5) * BLOCK) : hard;
    fogClear = fogClear < 0 || dt === 0 ? want : Math.min(hard, fogClear + (want - fogClear) * (1 - Math.exp(-dt / 1.5)));
    engine.setViewDistance(fogClear, cam.position.distanceTo(focus));
  }

  // ---- the way in and out of town ---------------------------------------------------------------
  // The road the country world draws, and how far along it the truck is: the road out of town once
  // the way out is planned; after the next city takes over out on the road, that same road moved into
  // the new city's coordinates (continuous playback) or, after a seek, the arrival straight alone;
  // none once the truck is well into town (or the way out is still far off).
  const tmpPose: Pose = { x: 0, z: 0, h: 0, k: 0 }, tmpPose2: Pose = { x: 0, z: 0, h: 0, k: 0 };
  type RoadPick = { road: CountryRoad; u: number; s: number; dx: number; dz: number };
  function pickRoad(): RoadPick | null {
    const r = pickRoad0();
    if (!r) return null;
    // The last city's road, after the hand-over: moved into this city's coordinates.
    if (r.road === journey.previousExit) { r.road.center(r.road.SB, tmpPose); journey.arrivalRoad.center(0, tmpPose2); return { ...r, dx: tmpPose2.x - tmpPose.x, dz: tmpPose2.z - tmpPose.z }; }
    return { ...r, dx: 0, dz: 0 };
  }
  function pickRoad0(): { road: CountryRoad; u: number; s: number } | null {
    const st = journey.st, ex = journey.exitRoad, p = journey.pose;
    if (ex) {
      if (st.mode === "country") { const u = journey.countryU + journey.frac; return { road: ex, u, s: ex.sAt(Math.max(0, u)) }; }
      ex.center(0, tmpPose);
      const s = (p.x - tmpPose.x) * Math.cos(tmpPose.h) - (p.z - tmpPose.z) * Math.sin(tmpPose.h);
      return Math.hypot(p.x - tmpPose.x, p.z - tmpPose.z) < 520 ? { road: ex, u: -1, s } : null;
    }
    const arr = journey.arrivalRoad;
    let sArr: number;
    if (st.mode === "inbound") sArr = arr.sAt(journey.countryU + journey.frac);
    else { arr.center(ARRIVE_LEN, tmpPose); sArr = ARRIVE_LEN + Math.hypot(p.x - tmpPose.x, p.z - tmpPose.z); }
    if (sArr > ARRIVE_LEN + 450) return null;
    const prev = journey.previousExit;
    if (prev) return { road: prev, u: prev.duration + st.cityTime + journey.frac, s: prev.SB + sArr };
    return { road: arr, u: st.cityTime + journey.frac, s: sArr };
  }
  // The world moved by (dx, dz): the next city took over out on the road. Everything on screen
  // that isn't placed from the journey each frame moves with it, so nothing visibly changes.
  // (The road itself is placed from the journey: pickRoad.)
  function rebase(dx: number, dz: number) {
    director.rebase(dx, dz); puffs.rebase(dx, dz); atmosphere.rebase(dx, dz);
    lastX += dx; lastZ += dz;
  }
  // The skyline's height and whose it is: the city's own in town, sinking away on the road out and
  // the next city's rising on the road in.

  // ---- the presentation's clock -----------------------------------------------------------------
  // Everything that carries state from frame to frame (the camera director, the trucks' moving
  // parts, the crew's springs, the puffs) is updated on fixed ticks of journey time, so where it is
  // at any moment depends only on where it was at an earlier tick. Each frame runs the ticks up to
  // its time, then a part-tick to the exact moment, which it undoes after drawing. In the preview a
  // snapshot every 10 s of journey (with the journey's own keyframes) lets a scrub back land
  // exactly where playing forward would have; a board never scrubs, so it keeps none.
  const TICK_HZ = 30, SNAP_TICKS = 10 * TICK_HZ;
  const PREVIEW = sys.isPreview || DEBUG_SCRUBTEST > 0;
  let presK = -1, presCity = -1;   // the last tick, and the city the presentation is in
  let lastRoad: RoadPick | null = null;
  type PresSnap = {
    k: number; city: number; dir: ReturnType<Director["save"]>; crew: ReturnType<Crew["saveState"]>; puffs: ReturnType<PuffSystem["save"]>; atm: [number, number];
    truck: { model: TruckModel; s: ReturnType<Truck["save"]> };
    other: { model: TruckModel | null; s: ReturnType<Truck["save"]> | null };   // (model null: no second truck; its record is kept for reuse)
    m: { lastX: number; lastZ: number; fogClear: number; lastMode: Mode | ""; tabletKey: string; revFrom: number | null; radius: number };
  };
  const snaps = new Map<number, PresSnap>();
  // (`into`: an earlier snapshot, filled again in place: the frame's part-tick saves one every frame.)
  function presSave(into?: PresSnap): PresSnap {
    const p = into ?? ({ truck: {}, other: { model: null, s: null }, m: {} } as PresSnap);
    p.k = presK; p.city = presCity;
    p.dir = director.save(p.dir); p.crew = crew.saveState(p.crew); p.puffs = puffs.save(p.puffs); p.atm = atmosphere.offsetInto(p.atm ?? [0, 0]);
    p.truck.model = truck.model; p.truck.s = truck.save(p.truck.s);
    p.other.model = other ? other.model : null; if (other) p.other.s = other.save(p.other.s ?? undefined);
    const m = p.m;
    m.lastX = lastX; m.lastZ = lastZ; m.fogClear = fogClear; m.lastMode = lastMode; m.tabletKey = tabletKey; m.revFrom = revFrom; m.radius = streamer.radius;
    return p;
  }
  let partSnap: PresSnap | undefined;   // the part-tick's, reused (never one of the snapshots kept in `snaps`)
  function presLoad(p: PresSnap) {
    // (The trucks it saved where they're still about: just idled by the part-tick, say. Their saved
    // state follows, so they aren't reset as new.)
    const changed = placeTrucks(p.truck.model, p.other.model, false);
    truck.load(p.truck.s);
    if (other && p.other.s) other.load(p.other.s);
    director.load(p.dir); crew.loadState(p.crew); puffs.load(p.puffs); atmosphere.offset = p.atm;
    ({ lastX, lastZ, fogClear, lastMode, tabletKey, revFrom } = p.m); streamer.setRadius(p.m.radius);
    if (changed) tabletKey = "";   // (another driven truck than before: its tablet may not show the saved stop)
    presK = p.k; presCity = p.city;
  }
  // Is tick k on a snapshot boundary (every 10 s of a city's time, the journey's keyframes)?
  function onBoundary(k: number) {
    const N = journey.cityAt(k / TICK_HZ);
    return N === journey.st.city && (k - Math.round(N * journey.period * TICK_HZ)) % SNAP_TICKS === 0;
  }
  function boundaryAtOrBefore(k: number) {
    const N = journey.cityAt(k / TICK_HZ), k0 = Math.round(N * journey.period * TICK_HZ);
    return k0 + Math.floor((k - k0) / SNAP_TICKS) * SNAP_TICKS;
  }
  function tick() {
    presK++;
    step(presK / TICK_HZ, 1 / TICK_HZ, false);
    if (!PREVIEW) while (idleTrucks.length) idleTrucks.pop()!.dispose();   // (only a part-tick's undo needs them)
    if (DEBUG_SCRUBTEST || DEBUG_CAMLOG) scrubTestLog();
    if (PREVIEW && onBoundary(presK)) {
      snaps.set(presK, presSave());
      for (const [k, sn] of snaps) if (Math.abs(sn.city - presCity) > 1) snaps.delete(k);
    }
  }
  // Land on tick K: from the latest snapshot at or before it (within 10 s), or else from scratch at
  // the 10 s boundary before it; then the ticks up to K.
  function jumpTo(K: number) {
    let best = -1;
    for (const k of snaps.keys()) if (k <= K && k > best) best = k;
    if (best >= 0 && K - best <= SNAP_TICKS) {
      journey.seekTo(best / TICK_HZ);
      countryWorld.setRoad(null); roadShown = null;
      presLoad(snaps.get(best)!);
      tabletKey = "";   // (the tablet's canvas still shows where the scrub came from: draw it again)
      if (journey.st.city !== cityShown) buildCity();
      streamer.fill(new THREE.Vector3(journey.pose.x, 0, journey.pose.z));
      // Landing on the snapshot itself: no tick follows to put the truck, crew, doors and camera
      // where the snapshot has them (they still show where the scrub came from), so step to its
      // own moment, then put back the state exactly as saved.
      if (best === K) { const h = partSnap = presSave(partSnap); step(K / TICK_HZ, 0, false); presLoad(h); }   // (partSnap: free until the frame's part-tick)
    } else freshAt(boundaryAtOrBefore(K));
    while (presK < K) tick();
  }
  function freshAt(k: number) {
    journey.seekTo(k / TICK_HZ);
    director.reset(); puffs.clear(); lastX = NaN; fogClear = -1; tabletKey = ""; lastMode = journey.st.mode; revFrom = null;
    streamer.setRadius(STREAM_RADIUS);   // (from scratch: in town, the usual radius; step widens it out of town)
    countryWorld.setRoad(null); roadShown = null;
    presCity = -1; presK = k;
    step(k / TICK_HZ, 0, true);
    if (PREVIEW && onBoundary(k) && !snaps.has(k)) snaps.set(k, presSave());
    if (DEBUG_SCRUBTEST || DEBUG_CAMLOG) scrubTestLog();
  }
  // One update of the presentation at journey time `time`, `dt` after the last (0 and `fresh` when
  // starting from scratch; `part` for a frame's part-tick, which is undone after drawing).
  function step(time: number, dt: number, fresh: boolean, part = false) {
    journey.advanceTo(time);
    // A new city: carried straight on from the road out of the last one (continuous playback), or
    // from scratch.
    if (journey.st.city !== presCity) {
      const prev = journey.previousExit;
      if (!fresh && presCity >= 0 && journey.st.city === presCity + 1 && prev) {
        prev.center(prev.SB, tmpPose); journey.arrivalRoad.center(0, tmpPose2);
        rebase(tmpPose2.x - tmpPose.x, tmpPose2.z - tmpPose.z);
        presCity = journey.st.city;
        buildCity();
        // Build what is in view of the new city at once, out on the road as far as it streams there:
        // the view distance never reaches past what is built (placeCamera), so an empty streamer
        // would pull the fog in to the camera and let it wash back out over the land.
        const outside = cityDistance(Math.floor(journey.pose.x / BLOCK), Math.floor(journey.pose.z / BLOCK)) > 0;
        if (outside) streamer.setRadius(5);
        streamer.fill(new THREE.Vector3(journey.pose.x, 0, journey.pose.z));
      } else {
        if (!fresh) { director.reset(); puffs.clear(); lastX = NaN; }
        presCity = journey.st.city;
        if (journey.st.city !== cityShown) buildCity();
        streamer.fill(new THREE.Vector3(journey.pose.x, 0, journey.pose.z));
      }
    }
    // The road out of town or into it (from the journey: pickRoad), placed in this city's coordinates.
    const pr = lastRoad = pickRoad();
    let switched = fresh;
    if (!pr) { if (roadShown) { countryWorld.setRoad(null); roadShown = null; } }
    else if (pr.road !== roadShown) {
      countryWorld.setRoad(pr.road); roadShown = pr.road; countryWorld.setOffset(pr.dx, pr.dz); switched = true;
      if (DEBUG_CAMLOG) sys.log(`ROAD ${pr.road.inp.kind}${pr.road.inp.toFreeway ? " to-freeway" : ""} c${pr.road.inp.city} at u${pr.u.toFixed(1)} s${pr.s.toFixed(0)}: ${pr.road.pieces.map((p) => `${p.kind}${p.open ? "(open)" : ""}@${p.s.toFixed(0)}`).join(" ")} stops ${pr.road.stops.map((x) => `${x.kind}@u${x.arrive.toFixed(1)}`).join(" ")}${pr.road.tractorRun ? ` tractor appear@u${pr.road.tractorRun.appear.toFixed(1)} pass@s${pr.road.tractorRun.pass0.toFixed(0)}-${pr.road.tractorRun.pass1.toFixed(0)}` : ""}`);
    }
    else {
      const o = countryWorld.offset;
      if (o.x !== pr.dx || o.z !== pr.dz) { OCCLUSION.shift("road", pr.dx - o.x, pr.dz - o.z); countryWorld.setOffset(pr.dx, pr.dz); }
    }
    // A metro city's elevated lines out of town, clear of these roads.
    {
      const rr = [{ road: journey.arrivalRoad, dx: 0, dz: 0 }], ex = journey.exitRoad, pv = journey.previousExit;
      if (ex) rr.push({ road: ex, dx: 0, dz: 0 });
      if (pv && pv !== ex) { pv.center(pv.SB, tmpPose); journey.arrivalRoad.center(0, tmpPose2); rr.push({ road: pv, dx: tmpPose2.x - tmpPose.x, dz: tmpPose2.z - tmpPose.z }); }
      elevatedReach.update(journey.plan, rr);
      freewayReach.update(journey.plan, rr);
    }
    // A freeway city's freeway: hidden on the entry side where the road coming in draws it; its
    // cars (and those on the next city's, out on the road to it).
    {
      const inbound = roadShown && (roadShown === journey.previousExit || roadShown === journey.arrivalRoad) && roadShown.inp.toFreeway;
      freewayReach.cover(inbound ? (roadShown === journey.arrivalRoad ? ARRIVE_LEN : FW_TIP) : 0);
      const t = journey.st.simTime + journey.frac, cam = engine.camera.position;
      cityCars.update(journey.plan.freewayFrame, t, cam, false);
      const ahead = roadShown && roadShown === journey.exitRoad && roadShown.inp.toFreeway ? roadShown : null;
      if (ahead && roadFrame?.road !== ahead) roadFrame = { road: ahead, F: Frame.ofRoad(ahead) };
      roadCars.update(ahead ? roadFrame!.F : null, t, cam, true);
    }
    // The road (its cars and train at this moment), and the far land under everything in the city's
    // own countryside colour in town (below a river's water, in a town with one: city.ts buildRiver).
    if (pr) { countryWorld.update(pr.u, pr.s, switched); if (journey.plan.lowWater) countryWorld.lowerBase(-1.7); }
    else countryWorld.setBase(truck.root.position.x, truck.root.position.z, countryWorld.groundOf(BIOME_OF[journey.plan.style.id], journey.climate), journey.plan.lowWater ? -1.7 : -0.3);
    const inCountry = journey.st.mode === "country";
    syncTrucks();
    setSignalTime(time);
    setSignalPreempt(inCountry ? [] : journey.st.preempt ?? [], journey.st.simTime + journey.frac);
    placeTruck(dt, fresh);
    stopAnimation();
    updateTablet();
    crew.update(dt, journey, truck, other, engine.camera); dockFx.update(journey); frontDoor.update(journey, crew.workerRoot, crew.forkDoor);
    truck.update(dt, time);
    other?.update(dt, time);
    puffs.update(dt);
    // (The preview also streams exactly what is round the truck at every tick, not only when a frame
    // is drawn: the view distance follows what is built, so it then depends only on the tick, and a
    // scrub's catch-up ticks see what playing forward saw. A part-tick leaves both to the frame.)
    if (!TOUR_VIEW && !part) { streamRadius(); if (streamer.exact) streamRound(false); }
    placeCamera(dt);
  }
  // Test renders (DEBUG_SCRUBTEST): the camera and truck at every tick, to compare a scrub with playing forward.
  // Its timeline: forward to DEBUG_SCRUBTEST seconds at one uneven frame rate, then back to half
  // way and forward again at another.
  function scrubTestTime(t: number) {
    const S = DEBUG_SCRUBTEST;
    return t < S ? t : Math.min(S, S / 2 + (t - S) * 2.1 + 0.004);
  }
  let scrubLogged = -1;
  const skipLogged = new Set<string>();
  function scrubTestLog() {
    if (presK === scrubLogged) return;
    scrubLogged = presK;
    for (const f of SNAP_SKIPPED) if (!skipLogged.has(f)) { skipLogged.add(f); sys.log(`SNAP skipped ${f} (not plain data: not saved)`); }
    const c = engine.camera, p = truck.root.position;
    sys.log(`TICK ${presK} ${c.position.x.toFixed(5)} ${c.position.y.toFixed(5)} ${c.position.z.toFixed(5)} ${c.quaternion.x.toFixed(6)} ${c.quaternion.y.toFixed(6)} ${c.quaternion.z.toFixed(6)} ${c.quaternion.w.toFixed(6)} ${p.x.toFixed(4)} ${p.z.toFixed(4)} ${director.beat}/${director.variant} ${journey.st.mode} ${journey.st.v.toFixed(2)} ${truck.heading.toFixed(4)} ${c.fov.toFixed(2)} ${p.y.toFixed(3)} fog ${fogClear.toFixed(3)} r${streamer.radius} acc ${journey.accel.toFixed(3)} ${truck.model}/${other?.model ?? "-"}`);
  }

  function backdropState(pr: { road: CountryRoad; s: number } | null): { city: number; p: number } {
    const st = journey.st, ex = journey.exitRoad;
    const rise = (d: number) => 1 - smooth(THREE.MathUtils.clamp(d / 1000, 0, 1));
    if (pr && ex && pr.road === ex) {
      const s = pr.s, L = ex.gateS, fall = (x: number) => 1 - smooth(THREE.MathUtils.clamp((x - 100) / 500, 0, 1));
      let mid = (600 + L - 1000) / 2;
      if (L < 1600) { let lo = 100, hi = L; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (fall(m) > rise(L - m)) lo = m; else hi = m; } mid = lo; }
      return s < mid ? { city: st.city, p: fall(s) } : { city: st.city + 1, p: rise(L - s) };
    }
    if (pr && pr.road === journey.previousExit) return { city: st.city, p: rise(pr.road.gateS - pr.s) };
    if (pr && pr.road === journey.arrivalRoad) return { city: st.city, p: rise(ARRIVE_LEN - pr.s) };
    return { city: st.city, p: 1 };
  }
  let fogClear = -1;   // the view distance in use (eased through the edge of town)

  // Lights and the brake hiss through a stop (the crew works the doors).
  function stopAnimation() {
    const st = journey.st;
    if (st.mode === "dwell" && lastMode !== "dwell") truck.hiss();
    lastMode = st.mode;
    truck.hazards = st.mode === "dwell" || st.mode === "reverse" || journey.countryStopped;
    truck.signal = journey.indicator;
  }

  function updateTablet() {
    const road = journey.country;
    if (road) {
      const key = "country" + road.inp.toName;
      if (key !== tabletKey && truck.setTablet(road.inp.toName, `${journey.aboardUnits} aboard`)) tabletKey = key;
      return;
    }
    const stop = journey.nextStop;
    const name = stop?.site?.name ?? (stop?.kind === "depart" ? "Highway" : "Cruising");
    const what = stop && stop.kind !== "swap" && stop.kind !== "depart" ? `${stop.kind === "pickup" ? "Pick up" : "Drop"} ${stop.units} ${CARGO_BY_ID.get(stop.cargo)!.name}`
      : stop?.kind === "swap" ? `Swap to ${stop.truck}` : `${journey.aboardUnits} aboard`;
    const key = name + what;
    if (key !== tabletKey && truck.setTablet(name, what)) tabletKey = key;   // (none before canvases exist: drawn on the first frame)
  }

  return {
    async setup() {
      engine = new Engine(sys);
      engine.backdrop = backdrop;
      ATLAS_UPLOAD.renderer = engine.renderer;   // (the sign and plate atlases upload just what they draw)
      hud = new Hud();
      persist = new Persistence(sys);
      // Seed 0 asks for a random journey: resume the one in storage, or draw a new one.
      const random = randomSeed = cfg.seed === 0;
      // The images load meanwhile, all at once (independent of each other and of the storage read).
      const loading = Promise.all([
        Promise.all(LIVERY_ASSETS.map((n) => assets[n].loadImage())), assets.facades.loadImage(),
        assets.logoWhite.loadImage(), assets.logoColor.loadImage(), assets.batonWordmark.loadImage(),
      ]);
      loading.catch(() => {});   // (a failure surfaces at the await below, not as unhandled while storage is read)
      const saved = await persist.load(cfg.seed, random, journeyPeriod(cfg));
      // The preview has no lasting storage, so its random journey is the day's journey: the same on
      // every reload.
      const today = new Date();
      const daySeed = Math.floor(hash2(today.getFullYear() * 1000 + today.getMonth() * 40 + today.getDate(), 7, 0, 0x5eed) * 2 ** 31) || 1;
      if (random) cfg.seed = saved?.seed ?? (sys.isPreview ? daySeed : ((Math.floor(Math.random() * 2 ** 31) ^ Date.now()) >>> 0 || 1));
      base = (saved?.simTime ?? 0) + DEBUG_SKIP_MINUTES * 60;   // the skip: test renders only
      setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
      if (DEBUG_CAMLOG) JOURNEY_LOG.out = (line) => sys.log(`J ${line}`);
      journey = new Journey(cfg, base, saved?.season ?? realSeason());
      journey.keyframing = journey.keepNeighbours = sys.isPreview || DEBUG_SCRUBTEST > 0;   // (only the preview scrubs)
      // The one line logged (besides debug builds'), for reproducing what was seen: the journey and
      // where it starts (journey time = this + scene time).
      sys.log(`Long Day: seed ${cfg.seed}, starting at journey time ${base.toFixed(1)}s`);
      const [liveries, facades, logoWhite, logoColor, batonWordmark] = await loading;
      const images = {} as Record<LiveryName, CanvasImageSource>;
      LIVERY_ASSETS.forEach((n, i) => { images[n] = uploadable(liveries[i]); });
      const atlas = uploadable(facades);
      puffs = new PuffSystem(engine.scene);
      kit = new TruckKit(images);
      fleet = new FleetBaker(kit);
      signAtlas.logo = logoWhite; signAtlas.logoColor = logoColor; signAtlas.batonMark = batonWordmark;
      truck = newTruck(journey.st.truck);
      placeTruck(0, true);
      syncTrucks();
      director = new Director(engine.camera, cfg.seed);
      director.avoidBuildings = chaseTargetOutOfBuildings;
      director.confine = (pos) => {
        // Under a freeway's deck with the truck: below it.
        for (const F of [journey.plan.freewayFrame, roadFrame && roadShown === roadFrame.road ? roadFrame.F : null]) {
          const c = F?.under(pos.x, pos.z);
          if (c != null && truck.root.position.y < c - 2.5) pos.y = Math.min(pos.y, c - 0.6);
        }
        const pr = pickRoad();
        if (!pr || pr.s < 0) return;
        const r = pr.road, at = r.locate(pos.x - pr.dx, pos.z - pr.dz, pr.s, 160);
        // In a tunnel: within its bore, under its vault.
        if (r.tunnelAt(at.s)) {
          const y = r.heightAt(at.s), n = THREE.MathUtils.clamp(at.n, -BORE_HALF + 1.1, BORE_HALF - 1.1);
          r.point(at.s, n, tmpPose); pos.x = tmpPose.x + pr.dx; pos.z = tmpPose.z + pr.dz;
          pos.y = THREE.MathUtils.clamp(pos.y, y + 1.2, y + BORE_H - 0.9);
          return;
        }
        // Elsewhere above the ground (where the land is level, the shots are as they are in town).
        const g = r.floorAt(at.s, at.n);
        if (Math.abs(g) >= 0.05 && pos.y < g + 1.2) pos.y = g + 1.2;
      };
      const crewMat = engine.mats.ground.clone(); applyLampLight(crewMat);   // streetlight falls on the driver and the load
      // The crew material (driver, worker, loads and tools) never thins out in the driver spotlight.
      crew = new Crew(engine.scene, crewMat);
      dockFx = new DockFx(engine.scene); frontDoor = new FrontDoorFx(engine.scene);
      // Cars and anything else big enough to stand between the camera and the driver get the
      // driver spotlight, the vignettes' big props (a food truck, a couch) included. Passers-by (the
      // crowd and the vignettes' people) don't: they're small and soon gone, so they may hide the
      // driver for a moment.
      const movers = engine.mats.ground.clone(); applyDriverSpot(movers); applyLampGlow(movers); applyLampLight(movers);
      const people = engine.mats.ground.clone(); applyLampGlow(people); applyLampLight(people);
      traffic = new Traffic(engine.scene, movers, (model) => fleet.build([{ model, x: 0, z: 0, h: 0 }]));
      crowd = new Crowd(engine.scene, people, movers);
      cityCars = new FreewayTraffic(engine.scene, movers); roadCars = new FreewayTraffic(engine.scene, movers);
      ambient = new Ambient(engine.scene, engine.mats.ground);
      // The clock first: attaching street life replays the city so far, and its vignettes and
      // pedestrians keep the hours.
      atmosphere = new Atmosphere(cfg, engine.scene, backdrop.scene);
      CLOCK.hourAt = (t) => atmosphere.hourAt(t - base);   // (the vignettes keep the hours: they pass journey time, the sky runs on scene time)
      const tl = performance.now();
      journey.attachLife(new StreetLife(traffic, crowd, ambient));
      seekMs = performance.now() - tl;

      const facadeMat = makeFacadeMaterial(atlas);
      applyCutaway(facadeMat); applyDriverSpot(facadeMat);
      for (const m of [facadeMat, engine.mats.ground, engine.mats.solid]) applyLampLight(m);   // streetlights and headlights light the world
      mats = { ground: engine.mats.ground, solid: facadeMat, lamp: makeLampMaterial() };
      buildCity();
      countryWorld = new CountryWorld(engine.scene, mats, (st) => fleet.build(st));
      countryWorld.exact = PREVIEW;   // (a scrubbed frame shows the same road pieces as the played one)
      elevatedReach = new ElevatedReach(engine.world, mats.solid);
      freewayReach = new FreewayReach(engine.world, mats.ground);   // (not the solid material: the truck's see-through spotlight leaves the freeway be)
      VIG_LOG.out = (line) => sys.log(line);
      atmosphere.update(0, engine, backdrop, journey.plan.style.sky, weatherMix(journey.climate.weather));
      setSignalTime(base);
      streamer.fill(truck.root.position);
      if (TOUR_VIEW) { tourCamera(0); streamer.fill(focus); }
      crew.update(0, journey, truck, other, engine.camera); dockFx.update(journey); frontDoor.update(journey, crew.workerRoot, crew.forkDoor);
      truck.update(0);
      placeCamera(0);
      // Compile what only appears later too (rain, snow, stars, the country road and its cars),
      // so its first appearance doesn't stall a frame.
      countryWorld.group.visible = true; atmosphere.prepare(true);
      engine.precompile(); engine.renderer.compile(backdrop.scene, backdrop.camera);
      countryWorld.group.visible = false; atmosphere.prepare(false);
    },
    render(ctx, frame) {
      let { t, dt } = frame;
      if (DEBUG_SCRUBTEST) t = scrubTestTime(t);
      if (DEBUG_VIEW === "scrub") { const t2 = t < 6 ? t : t - 4; dt = t2 - scrubPrev; scrubPrev = t2; t = t2; }   // test renders: a scrub back
      if (!baked) {
        captureCanvasClass(ctx); baked = true;
        // Canvases exist now: paint the full facade atlas over the asset one the city started with.
        try { setFacadeAtlas(mats.solid, paintFacadeAtlas()); } catch (e: any) { sys.log("facade atlas: kept the asset (" + (e?.message ?? e) + ")"); }
      }
      const target = Math.max(0, base + t);
      // The presentation runs on fixed ticks of journey time (see step); a scrub, a long jump ahead
      // or the first frame lands on a tick from a snapshot or from scratch, and replays from there.
      const K = Math.floor(target * TICK_HZ + 1e-6);
      // (A board keeps no snapshots: after a hitch it ticks on from where it was, keeping the
      // camera and the rest, unless starting afresh at the last 10 s boundary is fewer ticks.)
      const far = K > presK + 5 * TICK_HZ;
      if (presK < 0 || K < presK || (far && (PREVIEW || K - presK > K - boundaryAtOrBefore(K) || journey.cityAt(K / TICK_HZ) !== presCity))) {
        const ts = performance.now();
        if (presK < 0 && !PREVIEW) freshAt(K); else jumpTo(K);
        seekMs = performance.now() - ts;
      }
      while (presK < K) tick();
      // This frame's moment, between two ticks: a part-tick on top of the last one, undone after
      // drawing (never across a hand-over: that frame shows the tick).
      let held: PresSnap | null = null;
      if (target - presK / TICK_HZ > 1e-7 && journey.cityAt(target) === presCity) { held = partSnap = presSave(partSnap); step(target, target - presK / TICK_HZ, false, true); }
      // The moment the frame shows: its own, or the last tick's when there was no part-tick (the
      // street life is drawn there too, so it stays with the truck).
      const shown = held ? target : presK / TICK_HZ;
      const pr = lastRoad, inCity = journey.st.mode !== "country", alpha = journey.alphaAt(shown);
      const road = journey.st.mode === "country" ? journey.exitRoad : null;
      // Street life around the truck (none on the open road): simulated with the journey, drawn
      // between its last two steps.
      traffic.time = shown; traffic.draw(alpha);
      crowd.draw(alpha, shown);
      ambient.update(shown, alpha, journey.plan, TOUR_VIEW ? focus : truck.root.position, inCity);
      if (!TOUR_VIEW) streamRound(true);
      {
        const bd = backdropState(pr);
        const bc = bd.city === journey.st.city ? { style: journey.plan.style, seed: journey.st.citySeed } : { style: journey.exitRoad!.inp.toStyle, seed: citySeedOf(cfg.seed, bd.city) };
        if (backdrop.built !== `${bc.style.id}/${bc.seed}`) backdrop.build(bc.style, bc.seed);
        backdrop.setPresence(bd.p);
      }
      // (The preview draws every sign before the frame, so a scrubbed frame shows the same signs.)
      if (PREVIEW) { signAtlas.bake(Infinity); plateAtlas.bake(Infinity); } else { signAtlas.bake(); plateAtlas.bake(); }
      marquee.update(shown);
      // Time of day from the clock, weather from the city (blended along the country road).
      const weather = road ? road.weatherAt(journey.countryU) : weatherMix(journey.climate.weather);
      const sky = road ? skyTmp.setHex(journey.plan.style.sky).lerp(skyTmp2.setHex(road.inp.toStyle.sky), road.blendAt(journey.countryS)).getHex() : journey.plan.style.sky;
      atmosphere.update(t, engine, backdrop, sky, weather);
      truck.headlights = atmosphere.night > 0.3 || weather.fog > 0.5 || weather.rain > 0.5 || !!journey.country?.tunnelAt(journey.countryS, 40);
      LAMPS_ON.value = Math.max(THREE.MathUtils.clamp((atmosphere.night - 0.15) * 1.6, 0, 1), weather.fog > 0.5 || weather.rain > 0.5 ? 0.7 : 0);
      updateLampLights(truck.root.position);
      // The headlights' light on the road ahead (applyLampLight).
      {
        const h = truck.heading, ahead = truck.frontX + 7.5, on = truck.headlights && atmosphere.night > 0.15;
        HEAD_LIGHTS.value[0].set(truck.root.position.x + Math.cos(h) * ahead, truck.root.position.z - Math.sin(h) * ahead, h, on ? 1 : 0);
        HEAD_Y.value[0] = truck.root.position.y;   // (up on a freeway, a garage roof, a hill)
        if (!on) for (let k = 1; k < HEAD_LIGHTS.value.length; k++) HEAD_LIGHTS.value[k].w = 0;   // the other vehicles' too
        else {
          if (roadShown && journey.st.mode === "country" && journey.countryS > 400) countryWorld.headlights(HEAD_LIGHTS.value, 1, truck.root.position, HEAD_Y.value);
          else traffic.headlights(HEAD_LIGHTS.value, 1, truck.root.position, HEAD_Y.value);
          // Freeway cars' too: the nearest of them and of the vehicles above share the slots.
          const spots = headSpots;
          spots.clear();
          cityCars.headlights(truck.root.position, 120, spots); roadCars.headlights(truck.root.position, 120, spots);
          if (spots.n) {
            const p = truck.root.position;
            for (let k = 1; k < HEAD_LIGHTS.value.length; k++) { const V = HEAD_LIGHTS.value[k]; if (V.w > 0) spots.add(Math.hypot(V.x - p.x, V.y - p.z), V.x, V.y, V.z, V.w, HEAD_Y.value[k]); }
            for (let k = 1; k < HEAD_LIGHTS.value.length; k++) {
              const q = spots.takeNearest();
              if (q) { HEAD_LIGHTS.value[k].set(q[1], q[2], q[3], q[4]); HEAD_Y.value[k] = q[5]; } else HEAD_LIGHTS.value[k].w = 0;
            }
          }
        }
      }
      // Dome lights after dark: the cargo box always, the cab while the truck is stopped for a job.
      truck.interiorLight(INTERIOR_LIGHT.value, LAMPS_ON.value > 0, LAMPS_ON.value > 0 && journey.st.mode === "dwell");
      atmosphere.applyFog(engine);
      atmosphere.precipitation(t, engine.camera);
      engine.followSun(focus);
      crew.firstPerson(engine.camera);
      engine.draw(ctx);
      if (held) presLoad(held);
      persist.tick(target, snapshot);
      if (DEBUG_MEMLOG > 0 && Math.floor(t / DEBUG_MEMLOG) !== memLogSlot) {
        memLogSlot = Math.floor(t / DEBUG_MEMLOG);
        (globalThis as any).gc?.();   // test builds: measure what is actually retained
        let objs = 0, sceneAB = 0; const seenG = new Set<any>(), seenA = new Set<any>();
        engine.scene.traverse((o: any) => {
          objs++;
          const g = o.geometry; if (!g || seenG.has(g)) return; seenG.add(g);
          for (const a of [...Object.values(g.attributes), g.index] as any[]) { const arr = a?.array; if (arr && !seenA.has(arr.buffer)) { seenA.add(arr.buffer); sceneAB += arr.buffer.byteLength; } }
        });
        const mi = engine.renderer.info.memory, pm = (globalThis as any).process?.memoryUsage?.();
        sys.log("MEMLOG " + JSON.stringify({ t: Math.round(t), city: journey.st.city, mode: journey.st.mode, geo: mi.geometries, tex: mi.textures, prog: engine.renderer.info.programs?.length ?? 0, objs, heap: pm ? Math.round(pm.heapUsed / 1e6) : -1, ext: pm ? Math.round(pm.external / 1e6) : -1, ab: pm ? Math.round(pm.arrayBuffers / 1e6) : -1, sceneAB: Math.round(sceneAB / 1e6), gc: typeof (globalThis as any).gc, rss: pm ? Math.round(pm.rss / 1e6) : -1, chunks: streamer.chunks.size, cached: streamer.cache.size, cacheMB: Math.round(streamer.cacheBytes / 1e6), restored: streamer.restored, prefetched: streamer.prefetched, pfPending: streamer.prefetchPending, plateFree: plateAtlas.freeSlots, built: streamer.built, signsFree: signAtlas.freeSlots }));
      }
      if (cfg.debugHud) {
        const st = journey.st, ns = journey.nextStop;
        const t = st.cityTime;
        hud.draw(ctx, engine.renderer, dt, [
          `city ${st.city} ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}  ${st.mode}${st.mode === "dwell" ? ":" + journey.dwellPhase().phase : ""}  ${st.truck}  ${st.v.toFixed(1)}m/s  cam ${director.beat}/${director.variant}`,
          `next ${ns ? ns.kind + " " + (ns.site?.name ?? "") : "-"}  stops ${st.stopsDone}`,
          `ledger in ${st.loaded} out ${st.unloaded} aboard ${journey.aboardUnits} ${st.loaded - st.unloaded === journey.aboardUnits ? "ok" : "MISMATCH"}  slots ${journey.aboardSlots}/${TRUCK_SLOTS[st.truck]}`,
          director.debugLine(truck),
          countryWorld.active ? `segments build ${countryWorld.lastBuildMs.toFixed(1)}/${countryWorld.maxBuildMs.toFixed(1)}ms  ${persist.status}` : `chunks ${streamer.chunks.size} q${streamer.pending} build ${streamer.lastBuildMs.toFixed(1)}/${streamer.maxBuildMs.toFixed(1)}ms seek ${seekMs.toFixed(0)}ms`,
        ]);
      }
    },

    // Save where the journey is, so the next start resumes from here rather than from the last
    // periodic save. Needs a runtime that allows storage in teardown(); on an older one the write
    // fails with "ended", which flush() swallows.
    async teardown() {
      if (persist && journey) await persist.flush(snapshot);
    },
  };
}
