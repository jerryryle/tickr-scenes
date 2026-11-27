// The journey simulation drives the truck through the city from job to job, reversing into
// loading docks, swapping trucks at Ryder rental lots and moving on to a new city every ~30
// minutes; the camera director films it, and the crew (the driver and a dock worker) does the
// work at each stop.
import { setWorldBytes } from "./worlddata.ts";
import { WORLD_ASSET } from "./world-packed.ts";
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { SEA_REACH } from "./outline.ts";
import { hash2 } from "./rng.ts";
import { drain } from "./slices.ts";
import type { Steps } from "./slices.ts";
import { readConfig } from "./env.ts";
import { DEBUG_VISIT } from "./debug.ts";
import { parseVisitSpecs, visitOf } from "./visits.ts";
import { DEBUG_AT, DEBUG_BLOCK, DEBUG_CAMLOG, DEBUG_JAM_SHOT, DEBUG_MEMLOG, DEBUG_SCENARIO, DEBUG_SCRUBTEST, DEBUG_SKIP_MINUTES, DEBUG_STOP, DEBUG_STOP_LEAD, DEBUG_VIEW } from "./debug.ts";
import { SCENARIOS } from "./scenarios.ts";
import { captureCanvasClass, uploadable } from "./canvas.ts";
import { ChunkStreamer, disposeTree } from "./chunks.ts";
import type { ChunkBuild } from "./chunks.ts";
import { OCCLUSION } from "./occlusion.ts";
import { applyCutaway, applyDriverSpot, cutUniforms, NO_CUT_BOXES, updateCutaway, updateDriverSpot } from "./cutaway.ts";
import { Engine } from "./engine.ts";
import { applyLampGlow, applyLampLight, Atmosphere, HEAD_LIGHTS, HEAD_Y, INTERIOR_LIGHT, LAMPS_ON, updateLampLights } from "./atmosphere.ts";
import { applyPaintTint } from "./cars.ts";
import { Hud } from "./hud.ts";
import { PuffSystem } from "./puffs.ts";
import { keepStrapsWarm, LIVERY_ASSETS, Truck, TruckKit, truckLayout } from "./truck.ts";
import type { LiveryName, TruckModel } from "./truck.ts";
import { makeFacadeMaterial, setFacadeAtlas } from "./facade.ts";
import { paintFacadeAtlas } from "./facadeart.ts";
import { makeLampMaterial, setSignalPreempt, setSignalTime } from "./signals.ts";
import { interchangeTrack } from "./interchange.ts";
import { realSeason, weatherMix } from "./climate.ts";
import { CITY_HI, CITY_LO, cityDistance, gateEnd, insideCity, kerbDoors, makeCityChunkBuilder, parkedObstacles, pavementObstacles } from "./city.ts";
import { elevatedLine } from "./decor.ts";
import { BLOCK, RING, STREET } from "./grid.ts";
import type { CityMaterials, CityPlan } from "./city.ts";
import { SEA_COLOR, SEA_Y, shoreMoorings } from "./city.ts";
import { DOCK_DEPTH, DOCK_PLATFORM, facilityAt, facilityName, siteLayout } from "./facilities.ts";
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
import { SEA_ALONG, SeaLife } from "./sealife.ts";
import { KnittingWorksFx } from "./city-storybook/storybook-landmark-knitting-works.ts";
import { SteamBreweryFx } from "./city-victorian/victorian-landmark-steam-brewery.ts";
import { FIG_STYLE } from "./figure.ts";
import { StreetLife } from "./life.ts";

const STREAM_RADIUS = 3;
// City chunks that leave the view are kept (ChunkStreamer's cache) up to this much geometry
// (about as much again in GPU buffers), so streets driven again come straight back, and the
// cells round the truck's route are built ahead into it. Kept chunks hold their sign and plate
// slots, so the cache sheds its oldest when either atlas runs low.
const CHUNK_CACHE_BYTES = 512e6;
const SIGN_RESERVE = 64, PLATE_RESERVE = 48;
const CARRIAGE_BAND = [0.45, 0.55];   // the road's period over which a truck becomes a carriage (setToon)
const FORK_SPOT_RADIUS = 1.8;   // the spotlight on the forklift in a docked trailer (m): it and its load, from the side
// Prefetch: the cells within STREAM_RADIUS of the route ahead (sampled every PREFETCH_STEP m) and
// round the next stops, at most PREFETCH_MAX of them.
const PREFETCH_STEP = 20, PREFETCH_MAX = 320, PREFETCH_STOPS = 3, ENTRY_PREFETCH = 3;   // ENTRY_PREFETCH: blocks on in from the gate built coming in to town
const TOUR_VIEW = DEBUG_VIEW !== "" && DEBUG_VIEW !== "scrub" && DEBUG_VIEW !== "countryTop" && DEBUG_VIEW !== "rear" && DEBUG_VIEW !== "door" && DEBUG_VIEW !== "yard" && DEBUG_VIEW !== "dock" && DEBUG_VIEW !== "dockIn" && DEBUG_VIEW !== "dockSide" && DEBUG_VIEW !== "siteEdge" && DEBUG_VIEW !== "jam" && DEBUG_VIEW !== "top" && !DEBUG_VIEW.startsWith("crew");   // test renders with a tour camera

export default function createScene({ sys, env, assets }: SceneInputs): Scene {
  setWorldBytes(assets[WORLD_ASSET].bytes);   // (every city and road, packed: worlddata.ts)
  const cfg = readConfig(env);
  let engine: Engine, streamer: ChunkStreamer, hud: Hud;
  let puffs: PuffSystem, kit: TruckKit, fleet: FleetBaker, truck: Truck, journey: Journey, mats: CityMaterials, director: Director, crew: Crew, dockFx: DockFx, frontDoor: FrontDoorFx;
  let other: Truck | null = null;
  const backdrop = new Backdrop();
  let seekMs = 0;   // the last seek's cost (debug HUD)
  let traffic: Traffic, crowd: Crowd, ambient: Ambient, seaLife: SeaLife, worksFx: KnittingWorksFx, breweryFx: SteamBreweryFx, countryWorld: CountryWorld, elevatedReach: ElevatedReach;
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
  let base = 0, scrubPrev = 0;          // journey time at scene time 0
  let lastX = NaN, lastZ = 0;   // the truck's last rendered position, for wheel travel



  // The sea off a coastal or port town (outline.ts): one surface under the whole town at the
  // water's level, from the shore's deepest bay out; the land and the beach lie over it. It reaches
  // as far as anyone sees, out past the fog (a few hundred metres) and along the coast a good way
  // past the town, by the country road's last stretch in (country.ts coastShift).
  // (In 30 m tiles: the fog is by distance from each vertex (engine.ts), blended across each
  // triangle, so one with corners kilometres off would be fog all over.)
  const SEA_TILE = 30, SEA_OUT = 720, SEA_FAR = 650;
  let seaMesh: THREE.Mesh | null = null;
  // (The next city's, built ahead a few pieces at a time: prepareNextCity.)
  let nextSea: { seed: number; job: Steps<THREE.Mesh | null>; mesh?: THREE.Mesh | null } | null = null;
  function buildSea() {
    if (seaMesh) { engine.world.remove(seaMesh); seaMesh.geometry.dispose(); seaMesh = null; }
    const plan = journey.plan, ahead = nextSea?.seed === plan.seed ? nextSea : null;
    nextSea = null;
    const m = ahead ? (ahead.mesh !== undefined ? ahead.mesh : drain(ahead.job)) : drain(seaSteps(plan));
    if (m) { seaMesh = m; engine.world.add(m); }
  }
  function* seaSteps(plan: CityPlan): Steps<THREE.Mesh | null> {
    const O = plan.outline, d0 = O.shoreDeepest, deep = d0 === null ? null : d0 + SEA_REACH + 10;   // (under the land the sea reaches round: outline.ts seaward)
    if (O.sea === null || deep === null) return null;
    const s = O.sea, b = new Batch(), y = SEA_Y;
    const x0 = s === 0 ? O.X1 - deep : s === 2 ? O.X0 - SEA_OUT : O.X0 - SEA_ALONG, x1 = s === 0 ? O.X1 + SEA_OUT : s === 2 ? O.X0 + deep : O.X1 + SEA_ALONG;
    const z0 = s === 1 ? O.Z0 - SEA_OUT : s === 3 ? O.Z1 - deep : O.Z0 - SEA_ALONG, z1 = s === 1 ? O.Z0 + deep : s === 3 ? O.Z1 + SEA_OUT : O.Z1 + SEA_ALONG;
    // (Only tiles with sea in them: under the land, where the town isn't built out past the fog,
    // the sea seen on through it (sealife.ts farFog) would show inland.)
    // (On one grid, each tile once where the two regions overlap.)
    const done = new Set<string>();
    const tiles = function* (x0: number, x1: number, z0: number, z1: number): Steps<void> {
      for (let x = Math.floor(x0 / SEA_TILE) * SEA_TILE; x < x1; x += SEA_TILE) {
        yield;
        for (let z = Math.floor(z0 / SEA_TILE) * SEA_TILE; z < z1; z += SEA_TILE) {
          const xe = x + SEA_TILE, ze = z + SEA_TILE, key = `${x},${z}`;
          if (done.has(key)) continue;
          done.add(key);
          if (![[x, z], [xe, z], [x, ze], [xe, ze], [(x + xe) / 2, (z + ze) / 2]].some(([px, pz]) => O.seaward(px, pz))) continue;
          b.tri(x, y, z, xe, y, z, xe, y, ze, SEA_COLOR); b.tri(x, y, z, xe, y, ze, x, y, ze, SEA_COLOR);
        }
      }
    };
    yield* tiles(x0, x1, z0, z1);
    // (And round the shore's bend in towards the road in, outside the town: outline.ts.)
    const bend = O.bendSea(SEA_ALONG);
    if (bend) yield* tiles(...bend);
    return b.build(seaLife.surface)!;
  }
  // The next city, ahead of the hand-over, a few pieces of it a frame, so no one frame does it all:
  // its street graph (Journey.prepareNext), then its sea and the life on it. (buildCity takes them
  // in; all pure functions of the seed, so when they are built changes nothing else.)
  function prepareNextCity() {
    const P = journey.prepareNext(2);
    if (!P) return;
    if (nextSea?.seed !== P.seed) nextSea = { seed: P.seed, job: seaSteps(P) };
    if (nextSea.mesh === undefined) { const r = nextSea.job.next(); if (r.done) nextSea.mesh = r.value; return; }
    seaLife.prepare(P, 1);
  }
  // (Test renders: the stretch of shore nearest the middle of the town's sea side.)
  function midShore(plan: CityPlan) {
    const O = plan.outline, mx = (O.X0 + O.X1) / 2, mz = (O.Z0 + O.Z1) / 2;
    let best = null as CityPlan["shore"][number] | null, bd = Infinity;
    for (const e of plan.shore) { const d = Math.hypot((e.ax + e.bx) / 2 - mx, (e.az + e.bz) / 2 - mz); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  function buildCity() {
    streamer?.clear();
    buildSea();
    seaLife.build(journey.plan);
    FIG_STYLE.storybook = !!journey.plan.style.storybook; FIG_STYLE.victorian = !!journey.plan.style.victorian;
    if (traffic) { traffic.ryderToon = journey.plan.style.storybook ? 1 : 0; traffic.ryderCarriage = journey.plan.style.victorian ? 1 : 0; }
    const dockOf = (bx: number, bz: number) => { const L = siteLayout(journey.plan, bx, bz); return L.kind === "dock" ? L : null; };
    if (journey.plan.style.storybook) worksFx.build(journey.plan, dockOf); else worksFx.clear();
    breweryFx.build(journey.plan, dockOf);
    engine.seaFar = journey.plan.outline.sea === null ? 0 : SEA_FAR;
    engine.setSky(journey.plan.style.sky);
    // (Already up on the road in, as the town's skyline rose: backdropState.)
    if (backdrop.built !== `${journey.plan.style.id}/${journey.st.citySeed}`) backdrop.build(journey.plan.style, journey.st.citySeed);
    // Each chunk's tall parts go into the occlusion map the camera consults (occlusion.ts).
    // (The storybook's parked trucks are cartoons, the Victorian city's carriages: truck.ts makeToon, makeCarriage.)
    const toon = journey.plan.style.storybook ? 1 : 0, carriage = journey.plan.style.victorian ? 1 : 0;
    const build = makeCityChunkBuilder(mats, journey.plan, (st) => fleet.build(toon || carriage ? st.map((x) => ({ ...x, toon, carriage })) : st));
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
    // (Coming in to town, no path yet: the blocks round the gate it comes in by, and on in from it, so
    // they are built while it is still out on the road, not as it arrives: on a board too slow to
    // build them then, the fog that hides what isn't built would roll in over the town.)
    if (st.mode === "inbound") {
      const g = journey.plan.graph.gates[journey.entryGate]!, n = journey.plan.graph.nodes[g.node], ix = -[1, 0, -1, 0][g.dir], iz = -[0, -1, 0, 1][g.dir];
      for (let k = 0; k <= ENTRY_PREFETCH && cells.length < PREFETCH_MAX; k++) ring(Math.floor(n.x / BLOCK) + ix * k, Math.floor(n.z / BLOCK) + iz * k, STREAM_RADIUS);
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

  // The trucks turn cartoonish (truck.ts toonWarp) wholly in the storybook city, and on the
  // drive to or from it as the land does (CountryRoad.storyAt); and into carriages (truck.ts
  // makeCarriage) in the Victorian city and on the road as it creeps in (CountryRoad.periodAt).
  // The carriage comes in over the short stretch where the period passes CARRIAGE_BAND, about 40 m
  // of road where the crew change into carters (crew.ts) and the oncoming traffic turns horse-drawn:
  // half a truck with its team half grown is a muddle of floating parts to watch for long.
  function setToon() {
    const road = journey.st.mode === "country" ? journey.country : null;
    const k = road ? road.storyAt(journey.countryS) : journey.plan.style.storybook ? 1 : 0;
    const c = road ? THREE.MathUtils.smoothstep(road.periodAt(journey.countryS), CARRIAGE_BAND[0], CARRIAGE_BAND[1]) : journey.plan.style.victorian ? 1 : 0;
    truck.toon = k; truck.carriage = c; if (other) { other.toon = k; other.carriage = c; }
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
  let trafficFollow = -1, trafficFollowT = 0;   // (DEBUG_VIEW "traffic" keeps these: the vehicle followed, and since when)
  let tourT = 0, tourTrain = -1, tourBend: { x: number; z: number; nx: number; nz: number; ex: number; ez: number } | null = null;   // (tourBend: lineBend's shot)
  let jamShot: { x: number; y: number; z: number; lx: number; lz: number } | null = null;   // (DEBUG_VIEW "jam": the fixed shot, once set up)
  function tourCamera(dt: number): boolean {
    if (!DEBUG_VIEW || DEBUG_VIEW === "countryTop" || DEBUG_VIEW === "scrub") return false;
    tourT += dt;
    // "traffic" shows the vehicle nearest the truck, from its front quarter, and picks a new one every 8 s.
    if (DEBUG_VIEW === "traffic") {
      if (trafficFollow < 0 || tourT - trafficFollowT > 8 || !traffic.vehiclePose(trafficFollow)) { trafficFollow = traffic.vehicleNear(truck.root.position.x, truck.root.position.z); trafficFollowT = tourT; }
      const v = traffic.vehiclePose(trafficFollow);
      if (!v) return false;
      const fx = Math.cos(v.h), fz = -Math.sin(v.h), d = 4 + v.len * 0.8;
      engine.camera.position.set(v.x + fx * d - fz * d * 0.8, 2.6, v.z + fz * d + fx * d * 0.8);
      engine.camera.lookAt(v.x, 1.3, v.z);
      return true;
    }
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
    } else if (DEBUG_VIEW === "fwBend" && plan.fwCurve) {
      // A still shot of an organic town's freeway round its curve, from beside and above its middle.
      const C = plan.fwCurve, i = Math.floor(C.pts.length * 0.55), [px, pz] = C.pts[i], [qx, qz] = C.pts[i + 1], l = Math.hypot(qx - px, qz - pz) || 1;
      const nx = -(qz - pz) / l, nz = (qx - px) / l, ex = (qx - px) / l, ez = (qz - pz) / l;
      cx = px; cz = pz;
      cam.position.set(px + nx * 38 - ex * 22, 22, pz + nz * 38 - ez * 22); cam.lookAt(px, 7, pz);
    } else if (DEBUG_VIEW === "lineBend") {
      // A still shot of the sharpest bend on the first elevated line (or, with none, a cable car's
      // avenue), from beside it and above, to watch the trains or cable cars round it.
      if (!tourBend) {
        const G = plan.graph, L = plan.elevatedLines[0]?.pts ?? [];
        let pts = L;
        if (pts.length < 3) {
          // (A cable car's avenue: the junction where two of its streets meet at the sharpest angle.)
          let bn = -1, bb = -1;
          for (const N of G.nodes) {
            const cs = N.arms.filter((a) => G.streets[a.street].tags.cable && G.streets[a.street].inCity);
            if (cs.length !== 2) continue;
            const d = cs[0].h - cs[1].h, t = Math.PI - Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
            if (t > bb) { bb = t; bn = N.id; }
          }
          if (bn >= 0) { const N = G.nodes[bn], a = N.arms.find((q) => G.streets[q.street].tags.cable)!; pts = [[N.x - Math.cos(a.h) * 30, N.z + Math.sin(a.h) * 30], [N.x, N.z], [N.x + Math.cos(a.h) * 30, N.z - Math.sin(a.h) * 30]]; }
        }
        let best = 1, bt = -1;
        for (let i = 1; i + 1 < pts.length; i++) {
          const h0 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), h1 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
          const t = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)));
          if (t > bt) { bt = t; best = i; }
        }
        const P = pts[best] ?? [0, 0], Q = pts[best + 1] ?? [P[0] + 1, P[1]], l = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1;
        tourBend = { x: P[0], z: P[1], nx: -(Q[1] - P[1]) / l, nz: (Q[0] - P[0]) / l, ex: (Q[0] - P[0]) / l, ez: (Q[1] - P[1]) / l };
      }
      const B = tourBend;
      cx = B.x; cz = B.z;
      cam.position.set(B.x + B.nx * 40 - B.ex * 25, 34, B.z + B.nz * 40 - B.ez * 25); cam.lookAt(B.x, 3, B.z);
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
      const sh = midShore(plan);
      if (sh) { cx = (sh.ax + sh.bx) / 2 + sh.nx * 10; cz = (sh.az + sh.bz) / 2 + sh.nz * 10; }
      const a = tourT * 0.05;
      cam.position.set(cx + Math.cos(a) * 70, 95, cz + Math.sin(a) * 70); cam.lookAt(cx, 0, cz);
    } else if (DEBUG_VIEW === "wharf" && shoreMoorings(plan).wharf) {
      // From the quay beside a port's container wharf, watching its cranes work (sealife.ts).
      const W = shoreMoorings(plan).wharf!, sw = Math.sin(tourT * 0.05) * 25;
      cx = W.x; cz = W.z;
      cam.position.set(W.x - W.nx * 4 + W.ex * (48 + sw), 14, W.z - W.nz * 4 + W.ez * (48 + sw)); cam.lookAt(W.x + W.nx * 14, 10, W.z + W.nz * 14);
    } else if (DEBUG_VIEW === "sea" && midShore(plan)) {
      // Low on the shore nearest the middle of a town on the sea, looking out over the water and
      // turning slowly from along the coast one way to the other (sealife.ts).
      const sh = midShore(plan)!, mx = (sh.ax + sh.bx) / 2, mz = (sh.az + sh.bz) / 2, L = Math.hypot(sh.bx - sh.ax, sh.bz - sh.az);
      const ex = (sh.bx - sh.ax) / L, ez = (sh.bz - sh.az) / L, sw = Math.sin(tourT * 0.06) * 160;
      cx = mx; cz = mz;
      cam.position.set(mx - sh.nx * 22, 13, mz - sh.nz * 22); cam.lookAt(mx + sh.nx * 140 + ex * sw, -1, mz + sh.nz * 140 + ez * sw);
    } else if (DEBUG_BLOCK) {
      // Circling low over one block (its key after the colon: "block:kx,kz"), to see its ground.
      const B = plan.graph.block(DEBUG_BLOCK[0], DEBUG_BLOCK[1]);
      if (B) { cx = B.cx; cz = B.cz; }
      const a = tourT * 0.12;
      cam.position.set(cx + Math.cos(a) * 55, 38, cz + Math.sin(a) * 55); cam.lookAt(cx, 0, cz);
    } else if (DEBUG_VIEW.startsWith("works") && plan.worksBlock >= 0) {
      // These show the storybook city's knitting works or the Victorian city's steam brewery from across its
      // street, drifting along it ("works"), or circling high ("worksHigh"); close on the knitting works' vats
      // ("worksVats") or spools ("worksSpools"); close on the brewery's engine ("worksEngine"), its cooperage
      // yard ("worksYard"), its dock ("worksDock") or the top of its brewhouse ("worksTop").
      const B = plan.graph.blocks[plan.worksBlock], an = B.anchor!, G = plan.graph;
      const P = (a: number, n: number) => G.facePt(an.face, a + an.delta, n);
      const [ca, cn, cy, la, ln, ly] = DEBUG_VIEW === "worksVats" ? [44, -15, 6, 41, 9, 5] : DEBUG_VIEW === "worksSpools" ? [24, -10, 5, 20.5, 13, 9] : DEBUG_VIEW === "worksEngine" ? [43, -11, 11, 44, 16, 7.5] : DEBUG_VIEW === "worksYard" ? [40, -5, 8, 40, 7, 1] : DEBUG_VIEW === "worksDock" ? [24, -12, 3.5, 20.5, 13, 3.5]
        : DEBUG_VIEW === "worksTop" ? [26, -22, 14, 22, 20, 21] : DEBUG_VIEW === "worksHigh" ? [30 + Math.cos(tourT * 0.15) * 60, 25 + Math.sin(tourT * 0.15) * 60, 38, 30, 22, 4] : [18 + tourT * 1.5, -48, 12, 30 + tourT * 0.4, 20, 8];
      const C0 = P(ca, cn), C1 = P(la, ln);
      cx = C1.x; cz = C1.z;
      cam.position.set(C0.x, cy, C0.z); cam.lookAt(C1.x, ly, C1.z);
    } else if (DEBUG_VIEW === "gate" && plan.graph.gates[0]) {
      // This view stands on the road in, outside the entry gate, looking into town past it (a storybook city's
      // arch stands just inside), and drifts in slowly.
      const e = gateEnd(plan.graph.gates[0]), fx = Math.cos(e.h), fz = -Math.sin(e.h), d = 45 - tourT * 2;
      cx = e.x; cz = e.z;
      cam.position.set(e.x + fx * d - fz * 3, 5, e.z + fz * d + fx * 3); cam.lookAt(e.x - fx * 20, 7, e.z - fz * 20);
    } else if (DEBUG_AT) {
      // Circling low over a point ("at:x,z"), a junction's poles and its traffic; or, given a
      // heading too ("at:x,z,h"), from a fixed spot in the street 16 m out that way and 5 m up. The
      // point is in the journey's coordinates, moved to the world's as the jam shot's is.
      const p = truck.root.position;
      cx = DEBUG_AT[0] + p.x - journey.pose.x; cz = DEBUG_AT[1] + p.z - journey.pose.z;
      const a = tourT * 0.25;
      if (DEBUG_AT.length > 2) { const h = DEBUG_AT[2]; cam.position.set(cx + Math.cos(h) * 16, 5, cz - Math.sin(h) * 16); cam.lookAt(cx, 1.2, cz); }
      else { cam.position.set(cx + Math.cos(a) * 30, 22, cz + Math.sin(a) * 30); cam.lookAt(cx, 0, cz); }
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
    // (Outside town only as it comes in: the town it is coming to, round its gate.)
    if (ahead) { aheadDir.x = Math.cos(truck.heading); aheadDir.z = -Math.sin(truck.heading); if (!truckOutside() || journey.st.mode === "inbound") updatePrefetch(); }
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
    if (DEBUG_VIEW === "jam") {
      // Test renders, a gridlock clearing: one fixed shot, set up at about head height 14 m out in
      // front of the cab and a little to its right once the truck has stood held 5 s (journey.ts
      // jam), looking back at its front across the street ahead that holds it up; held
      // there, not following it. (Before that, from out ahead of it: trim it off.)
      const p = truck.root.position;
      // (Where the truck will stand held, given (DEBUG_JAM_SHOT): from the first frame. Else as it
      // has stood held 5 s.)
      // (The journey's coordinates, the world's less however far the world has been moved: rebase.)
      const J = DEBUG_JAM_SHOT ? DEBUG_JAM_SHOT.split(",").map(Number) : null;
      const at = J ? [J[0] + p.x - journey.pose.x, J[1] + p.z - journey.pose.z, J[2]] : (journey.st.jamT ?? 0) > 5 ? [p.x, p.z, truck.heading] : null;
      if ((!jamShot || J) && at) {   // (the given spot: each frame, as the world may move under it)
        const [x, z, h] = at, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h), nose = truckLayout(truck.model).front;
        jamShot = { x: x + fx * (nose + 14) + rx * 2.5, y: 4.5, z: z + fz * (nose + 14) + rz * 2.5, lx: x + fx * (nose - 1), lz: z + fz * (nose - 1) };
      }
      if (jamShot) { engine.camera.position.set(jamShot.x, jamShot.y, jamShot.z); engine.camera.lookAt(jamShot.lx, 1.8, jamShot.lz); }
      else { const h = truck.heading; engine.camera.position.set(p.x + Math.cos(h) * 30, 7, p.z - Math.sin(h) * 30); engine.camera.lookAt(p.x, 1.5, p.z); }
      focus.copy(p); updateDriverSpot(engine.camera, null); return;
    }
    if (DEBUG_VIEW === "dockIn" || DEBUG_VIEW === "dockSide") {   // test renders, at a dock: from the platform's back by the building's wall, out into the truck; or on the platform beside the bay, the street side
      const L = truckLayout(truck.model), h = truck.heading, p = truck.root.position, P = DOCK_PLATFORM;
      const at = (x: number, y: number, z: number) => new THREE.Vector3(p.x + Math.cos(h) * x + Math.sin(h) * z, y, p.z - Math.sin(h) * x + Math.cos(h) * z);
      engine.camera.fov = 50; engine.camera.updateProjectionMatrix();
      if (DEBUG_VIEW === "dockIn") { engine.camera.position.copy(at(L.rear - DOCK_DEPTH + 0.3, P + 2.3, 0.6)); engine.camera.lookAt(at(L.rear + 4, P + 0.5, 0)); }
      else { engine.camera.position.copy(at(L.rear - 1.4, P + 2.4, -4.0)); engine.camera.lookAt(at(L.rear + 1.0, P + 0.5, 0)); }
      focus.copy(p); updateDriverSpot(engine.camera, null); return;
    }
    if (DEBUG_VIEW === "top") {   // test renders: straight down over the back of the truck and the pavement beside it, the truck along the frame, the pavement below it
      const L = truckLayout(truck.model), h = truck.heading, p = truck.root.position;
      const cx = p.x + Math.cos(h) * (L.bedRear - 3) + Math.sin(h) * 2.4, cz = p.z - Math.sin(h) * (L.bedRear - 3) + Math.cos(h) * 2.4;
      engine.camera.fov = 40; engine.camera.updateProjectionMatrix();
      engine.camera.position.set(cx, 15, cz); engine.camera.up.set(-Math.sin(h), 0, -Math.cos(h)); engine.camera.lookAt(cx, 0, cz);
      focus.copy(p); updateDriverSpot(engine.camera, null); return;
    }
    if (DEBUG_VIEW.startsWith("crew") && !crew.inSeat) {   // test renders: close on the driver (crewSide, crewBack, crewFront, crewQ: from the street side, behind the truck, ahead, a rear quarter), a long lens
      const h = truck.heading, d = crew.driver.root.position;
      const o = DEBUG_VIEW === "crewBack" ? [-6, -1.2] : DEBUG_VIEW === "crewFront" ? [6, -1.5] : DEBUG_VIEW === "crewQ" ? [-4.2, -4.2] : [0.6, -6];
      engine.camera.fov = 24; engine.camera.updateProjectionMatrix();
      engine.camera.position.set(d.x + Math.cos(h) * o[0] + Math.sin(h) * o[1], d.y + 1.5, d.z - Math.sin(h) * o[0] + Math.cos(h) * o[1]);
      engine.camera.lookAt(d.x, d.y + 0.95, d.z);
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
    // The driver spotlight (cutaway.ts): only while the truck's door is open at a stop (journey.driverSpotOn), and
    // the driver is out of the seat and the camera outside; never following them into a facility.
    const d = crew.driver.root.position;
    const out = !director.interior && !crew.inSeat && !crew.indoors && journey.driverSpotOn;
    // Otherwise, while the forklift is in a docked trailer, the spotlight is on the forklift
    // (crew.forkSpot), wide enough for it and its load. The teammate on a team lift gets a second
    // spot on the same terms as the driver's (crew.mateSpot).
    const mate = !director.interior && journey.driverSpotOn ? crew.mateSpot : null;
    if (out) updateDriverSpot(cam, spotChest.copy(d).setY(d.y + 1.1), 1.0, mate);
    else updateDriverSpot(cam, director.interior ? null : crew.forkSpot, FORK_SPOT_RADIUS, mate);
    // The view: as far as the city is built round the camera (never further, so nothing is seen
    // popping in), and out on the open land the country's longer view; eased across the edge of town.
    const hard = Math.hypot(streamer.clearDistance(cam.position.x, cam.position.z), cam.position.y);
    const outside = cityDistance(Math.floor(focus.x / BLOCK), Math.floor(focus.z / BLOCK)) > 0;
    const want = outside ? Math.min(COUNTRY_CLEAR, hard) : streamer.radius > STREAM_RADIUS ? Math.min(hard, (STREAM_RADIUS + 0.5) * BLOCK) : hard;
    fogClear = fogClear < 0 || dt === 0 ? want : Math.min(hard, fogClear + (want - fogClear) * (1 - Math.exp(-dt / 1.5)));
    engine.setViewDistance(fogClear, cam.position.distanceTo(focus));
    streamer.setCamera(cam.position.x, cam.position.z);   // (the next stream builds round the camera too)
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
    if (r.road === journey.previousExit) { r.road.center(r.road.SB, tmpPose); journey.arrivalRoad.center(journey.arrivalRoad.SB, tmpPose2); return { ...r, dx: tmpPose2.x - tmpPose.x, dz: tmpPose2.z - tmpPose.z }; }
    return { ...r, dx: 0, dz: 0 };
  }
  function pickRoad0(): { road: CountryRoad; u: number; s: number } | null {
    const st = journey.st, ex = journey.exitRoadAhead, p = journey.pose;
    if (ex) {
      if (st.mode === "country") { const u = journey.countryU + journey.frac; return { road: ex, u, s: ex.sAt(Math.max(0, u)) }; }
      ex.center(0, tmpPose);
      const s = (p.x - tmpPose.x) * Math.cos(tmpPose.h) - (p.z - tmpPose.z) * Math.sin(tmpPose.h);
      return Math.hypot(p.x - tmpPose.x, p.z - tmpPose.z) < 520 ? { road: ex, u: -1, s } : null;
    }
    const arr = journey.arrivalRoad;
    let sArr: number;
    // (sArr: from where the arrival straight begins, its road's hand-over.)
    if (st.mode === "inbound") sArr = arr.sAt(journey.countryU + journey.frac) - arr.SB;
    else { arr.center(arr.gateS, tmpPose); sArr = ARRIVE_LEN + Math.hypot(p.x - tmpPose.x, p.z - tmpPose.z); }
    if (sArr > ARRIVE_LEN + 450) return null;
    const prev = journey.previousExit;
    if (prev) return { road: prev, u: prev.duration + st.cityTime + journey.frac, s: prev.SB + sArr };
    return { road: arr, u: st.cityTime + journey.frac, s: arr.SB + sArr };
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
    return N === journey.st.city && (k - Math.round(journey.cityStart(N) * TICK_HZ)) % SNAP_TICKS === 0;
  }
  function boundaryAtOrBefore(k: number) {
    const N = journey.cityAt(k / TICK_HZ), k0 = Math.round(journey.cityStart(N) * TICK_HZ);
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
        prev.center(prev.SB, tmpPose); journey.arrivalRoad.center(journey.arrivalRoad.SB, tmpPose2);
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
      const rr = [{ road: journey.arrivalRoad, dx: 0, dz: 0 }], ex = journey.exitRoadAhead, pv = journey.previousExit;
      if (ex) rr.push({ road: ex, dx: 0, dz: 0 });
      if (pv && pv !== ex) { pv.center(pv.SB, tmpPose); journey.arrivalRoad.center(journey.arrivalRoad.SB, tmpPose2); rr.push({ road: pv, dx: tmpPose2.x - tmpPose.x, dz: tmpPose2.z - tmpPose.z }); }
      elevatedReach.update(journey.plan, rr);
      freewayReach.update(journey.plan, rr);
    }
    // A freeway city's freeway: hidden on the entry side where the road coming in draws it; its
    // cars (and those on the next city's, out on the road to it).
    {
      const inbound = roadShown && (roadShown === journey.previousExit || roadShown === journey.arrivalRoad) && roadShown.inp.toFreeway;
      freewayReach.cover(inbound ? (roadShown === journey.arrivalRoad ? ARRIVE_LEN : FW_TIP) : 0);
      const t = journey.st.simTime + journey.frac, cam = engine.camera.position;
      cityCars.update(journey.plan.freewayFrame, journey.clockTime + journey.frac, cam, false);   // (the city's clock: as its visit plays wherever it comes)
      const ahead = roadShown && roadShown === journey.exitRoadAhead && roadShown.inp.toFreeway ? roadShown : null;
      if (ahead && roadFrame?.road !== ahead) roadFrame = { road: ahead, F: Frame.ofRoad(ahead) };
      roadCars.update(ahead ? roadFrame!.F : null, t, cam, true);
    }
    // The road (its cars and train at this moment), and the far land under everything in the city's
    // own countryside colour in town (below a river's water, in a town with one: city.ts buildRiver).
    if (pr) { countryWorld.update(pr.u, pr.s, switched); if (journey.plan.lowWater) countryWorld.lowerBase(-1.7); }
    else countryWorld.setBase(truck.root.position.x, truck.root.position.z, countryWorld.groundOf(BIOME_OF[journey.plan.style.id], journey.climate), journey.plan.lowWater ? -1.7 : -0.3);
    const inCountry = journey.st.mode === "country";
    syncTrucks();
    // (The lights run on the city's clock, as the journey and street life see them.)
    setSignalTime(journey.clockTime + journey.frac);
    setSignalPreempt(inCountry ? [] : journey.st.preempt ?? [], journey.clockTime + journey.frac);
    placeTruck(dt, fresh);
    stopAnimation();
    updateTablet();
    crew.update(dt, journey, truck, other, engine.camera); dockFx.update(journey); frontDoor.update(journey, crew.workerRoot, crew.forkDoor);
    setToon();
    truck.update(dt, time);
    truck.honk(journey.honking);   // (out of a gridlock: journey.ts JAM_HONK)
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
    const st = journey.st, ex = journey.exitRoadAhead;
    const rise = (d: number) => 1 - smooth(THREE.MathUtils.clamp(d / 1000, 0, 1));
    if (pr && ex && pr.road === ex) {
      const s = pr.s, L = ex.gateS, fall = (x: number) => 1 - smooth(THREE.MathUtils.clamp((x - 100) / 500, 0, 1));
      let mid = (600 + L - 1000) / 2;
      if (L < 1600) { let lo = 100, hi = L; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (fall(m) > rise(L - m)) lo = m; else hi = m; } mid = lo; }
      return s < mid ? { city: st.city, p: fall(s) } : { city: st.city + 1, p: rise(L - s) };
    }
    if (pr && pr.road === journey.previousExit) return { city: st.city, p: rise(pr.road.gateS - pr.s) };
    if (pr && pr.road === journey.arrivalRoad) return { city: st.city, p: rise(pr.road.gateS - pr.s) };
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
      // Seed 0 asks for a random journey: a new one every time the scene starts (nothing is saved or
      // resumed).
      const random = cfg.seed === 0;
      // The images load meanwhile, all at once (independent of each other).
      const loading = Promise.all([
        Promise.all(LIVERY_ASSETS.map((n) => assets[n].loadImage())),
        assets.logoWhite.loadImage(), assets.logoColor.loadImage(), assets.batonWordmark.loadImage(),
      ]);
      loading.catch(() => {});   // (a failure surfaces at the await below, not as unhandled meanwhile)
      // The preview's random journey is the day's journey: the same on every reload.
      const today = new Date();
      const daySeed = Math.floor(hash2(today.getFullYear() * 1000 + today.getMonth() * 40 + today.getDate(), 7, 0, 0x5eed) * 2 ** 31) || 1;
      if (random) cfg.seed = sys.isPreview ? daySeed : ((Math.floor(Math.random() * 2 ** 31) ^ Date.now()) >>> 0 || 1);
      setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
      const scenario = DEBUG_SCENARIO ? SCENARIOS[DEBUG_SCENARIO] : null;
      if (DEBUG_SCENARIO && !scenario) throw new Error(`no scenario ${DEBUG_SCENARIO} (scenarios.ts)`);
      const visits = scenario ? scenario.visits : DEBUG_VISIT ? parseVisitSpecs(DEBUG_VISIT) : undefined, watch = scenario ? scenario.stop : DEBUG_STOP;
      // (From the start: the skip, or a little before a stop; test renders only.)
      const lifeFor = () => { const sc = new THREE.Scene(), m = new THREE.MeshBasicMaterial(); return new StreetLife(new Traffic(sc, m, null), new Crowd(sc, m), new Ambient(sc, m)); };
      const stopAt = watch >= 0 ? Journey.stopTime(cfg, realSeason(), visits, watch, 0, lifeFor) : null;
      base = stopAt !== null ? Math.max(0, stopAt - DEBUG_STOP_LEAD) : DEBUG_SKIP_MINUTES * 60;
      if (DEBUG_CAMLOG) JOURNEY_LOG.out = (line) => sys.log(`J ${line}`);
      journey = new Journey(cfg, base, realSeason(), visits);
      journey.keyframing = journey.keepNeighbours = sys.isPreview || DEBUG_SCRUBTEST > 0;   // (only the preview scrubs)
      // The one line logged (besides debug builds'), for reproducing what was seen: the journey and
      // where it starts (journey time = this + scene time).
      sys.log(`Long Day: seed ${cfg.seed}, starting at journey time ${base.toFixed(1)}s`);
      const [liveries, logoWhite, logoColor, batonWordmark] = await loading;
      const images = {} as Record<LiveryName, CanvasImageSource>;
      LIVERY_ASSETS.forEach((n, i) => { images[n] = uploadable(liveries[i]); });
      puffs = new PuffSystem(engine.scene);
      kit = new TruckKit(images);
      fleet = new FleetBaker(kit);
      signAtlas.logo = logoWhite; signAtlas.logoColor = logoColor; signAtlas.batonMark = batonWordmark;
      truck = newTruck(journey.st.truck);
      keepStrapsWarm(engine.scene);
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
      const movers = engine.mats.ground.clone(); applyDriverSpot(movers); applyLampGlow(movers); applyLampLight(movers); applyPaintTint(movers);
      const people = engine.mats.ground.clone(); applyLampGlow(people); applyLampLight(people);
      traffic = new Traffic(engine.scene, movers, (model, toon, carriage) => fleet.vehicle(model, toon, carriage));
      crowd = new Crowd(engine.scene, people, movers);
      cityCars = new FreewayTraffic(engine.scene, movers); roadCars = new FreewayTraffic(engine.scene, movers);
      ambient = new Ambient(engine.scene, engine.mats.ground);
      seaLife = new SeaLife(engine.world, engine.mats.ground);
      worksFx = new KnittingWorksFx(engine.world, engine.mats.solid);
      breweryFx = new SteamBreweryFx(engine.world, engine.mats.solid);
      // The clock first: attaching street life replays the city so far, and its vignettes and
      // pedestrians keep the hours.
      atmosphere = new Atmosphere(cfg, engine.scene, backdrop.scene);
      // (The vignettes keep the hours: they pass the city's clock, the sky runs on scene time. A
      // visit's spec may pin the hour it arrives at, the clock running on from there.)
      CLOCK.hourAt = (t) => atmosphere.hourAt(t - journey.st.clockBase + journey.cityStart(journey.st.city) - base);
      atmosphere.hourPin = (t) => {
        const jt = base + t, N = journey.cityAt(jt), h = visitOf(cfg.seed, N).spec?.hour;
        return h === undefined ? null : (((h + (jt - journey.cityStart(N)) / 3600) % 24) + 24) % 24;
      };
      const tl = performance.now();
      journey.attachLife(new StreetLife(traffic, crowd, ambient));
      seekMs = performance.now() - tl;

      const facadeMat = makeFacadeMaterial();
      applyCutaway(facadeMat); applyDriverSpot(facadeMat);
      for (const m of [facadeMat, engine.mats.ground, engine.mats.solid, seaLife.surface]) applyLampLight(m);   // streetlights and headlights light the world (the sea and the harbour too: their material is the ground's clone, made before this)
      mats = { ground: engine.mats.ground, solid: facadeMat, lamp: makeLampMaterial() };
      buildCity();
      countryWorld = new CountryWorld(engine.scene, mats, (st) => fleet.build(st));
      countryWorld.exact = PREVIEW;   // (a scrubbed frame shows the same road pieces as the played one)
      elevatedReach = new ElevatedReach(engine.world, mats.solid);
      freewayReach = new FreewayReach(engine.world, mats.ground);   // (not the solid material: the truck's see-through spotlight leaves the freeway be)
      VIG_LOG.out = (line) => sys.log(line);
      atmosphere.update(0, engine, backdrop, journey.plan.style.sky, weatherMix(journey.climate.weather));
      setSignalTime(journey.clockTime + journey.frac);
      streamer.fill(truck.root.position);
      if (TOUR_VIEW) { tourCamera(0); streamer.fill(focus); }
      crew.update(0, journey, truck, other, engine.camera); dockFx.update(journey); frontDoor.update(journey, crew.workerRoot, crew.forkDoor);
      setToon();
      truck.update(0);
      placeCamera(0);
      // Compile what only appears later too (rain, snow, stars, the country road and its cars, the
      // horn: truck.ts honk), so its first appearance doesn't stall a frame.
      countryWorld.group.visible = true; atmosphere.prepare(true); truck.honk(0);
      engine.precompile(); engine.renderer.compile(backdrop.scene, backdrop.camera);
      countryWorld.group.visible = false; atmosphere.prepare(false); truck.honk(-1);
    },
    render(ctx, frame) {
      let { t, dt } = frame;
      if (DEBUG_SCRUBTEST) t = scrubTestTime(t);
      if (DEBUG_VIEW === "scrub") { const t2 = t < 6 ? t : t - 4; dt = t2 - scrubPrev; scrubPrev = t2; t = t2; }   // test renders: a scrub back
      if (!baked) {
        captureCanvasClass(ctx);
        // Canvases exist now: paint the facade atlas (the city's buildings have none until then;
        // a failure throws, every frame).
        setFacadeAtlas(mats.solid, paintFacadeAtlas());
        baked = true;
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
      seaLife.update(shown);
      worksFx.update(shown); breweryFx.update(shown);
      if (!TOUR_VIEW) streamRound(true);
      prepareNextCity();
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
        // (A carriage's oil lamps throw only a faint, short glow round its team.)
        const h = truck.heading, ahead = truck.frontX + 7.5 - 5 * truck.carriage, on = truck.headlights && atmosphere.night > 0.15;
        HEAD_LIGHTS.value[0].set(truck.root.position.x + Math.cos(h) * ahead, truck.root.position.z - Math.sin(h) * ahead, h, on ? 1 - 0.85 * truck.carriage : 0);
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
          countryWorld.active ? `segments build ${countryWorld.lastBuildMs.toFixed(1)}/${countryWorld.maxBuildMs.toFixed(1)}ms` : `chunks ${streamer.chunks.size} q${streamer.pending} build ${streamer.lastBuildMs.toFixed(1)}/${streamer.maxBuildMs.toFixed(1)}ms seek ${seekMs.toFixed(0)}ms`,
        ]);
      }
    },
  };
}
