// The journey simulation drives the truck through the city from job to job, reversing into
// loading docks, swapping trucks at Ryder rental lots and moving on to a new city every ~30
// minutes; the camera director films it, and the crew (the driver and a dock worker) does the
// work at each stop.
import * as THREE from "three@0.187.0";
import { hash2, mulberry32 } from "./rng.ts";
import { readConfig } from "./env.ts";
import { DEBUG_CAMLOG, DEBUG_MEMLOG, DEBUG_SCRUBTEST, DEBUG_SKIP_MINUTES, DEBUG_VIEW } from "./debug.ts";
import { captureCanvasClass, uploadable } from "./canvas.ts";
import { ChunkStreamer } from "./chunks.ts";
import type { ChunkBuild } from "./chunks.ts";
import { OCCLUSION } from "./occlusion.ts";
import { Persistence, STATE_VERSION } from "./persist.ts";
import type { SavedState } from "./persist.ts";
import { applyCutaway, applyDriverSpot, cutUniforms, updateCutaway, updateDriverSpot } from "./cutaway.ts";
import { Engine } from "./engine.ts";
import { applyLampGlow, applyLampLight, Atmosphere, HEAD_LIGHTS, INTERIOR_LIGHT, LAMPS_ON, updateLampLights } from "./atmosphere.ts";
import { Hud } from "./hud.ts";
import { PuffSystem } from "./puffs.ts";
import { LIVERY_ASSETS, Truck, truckExtents, TruckKit, truckLayout } from "./truck.ts";
import type { LiveryName, TruckModel } from "./truck.ts";
import { makeFacadeMaterial } from "./facade.ts";
import { makeLampMaterial, setSignalPreempt, setSignalTime } from "./signals.ts";
import { realSeason, weatherMix } from "./climate.ts";
import { CITY_HI, CITY_LO, cityDistance, insideCity, kerbDoors, makeCityChunkBuilder, pavementObstacles } from "./city.ts";
import { elevatedLine } from "./decor.ts";
import { BLOCK, RING, STREET } from "./grid.ts";
import type { CityMaterials } from "./city.ts";
import { facilityAt, facilityName } from "./facilities.ts";
import { marquee, plateAtlas, signAtlas } from "./signs.ts";
import { CARGO_BY_ID, TRUCK_SLOTS } from "./cargo.ts";
import { smooth } from "./route.ts";
import type { Pose } from "./route.ts";
import { ARRIVE_LEN, BIOME_OF, BORE_H, BORE_HALF, citySeedOf, CountryRoad } from "./country.ts";
import { Journey, JOURNEY_LOG, setDoorProbe, setPavementProbe } from "./journey.ts";
import type { Mode } from "./journey.ts";
import { Director } from "./director.ts";
import { Crew } from "./crew.ts";
import { DockFx, FrontDoorFx } from "./dockfx.ts";
import { FleetBaker } from "./fleet.ts";
import { COUNTRY_CLEAR, CountryWorld } from "./countryworld.ts";
import { ElevatedReach, elevatedLift } from "./elevated.ts";
import { Frame, FreewayReach, FreewayTraffic, FW_TIP } from "./freeway.ts";
import { Backdrop } from "./backdrop.ts";
import { Traffic } from "./traffic.ts";
import { Crowd } from "./crowd.ts";
import { Ambient } from "./ambient.ts";
import { StreetLife } from "./life.ts";

const STREAM_RADIUS = 3;
const TOUR_VIEW = DEBUG_VIEW !== "" && DEBUG_VIEW !== "scrub" && DEBUG_VIEW !== "countryTop" && DEBUG_VIEW !== "rear" && DEBUG_VIEW !== "door";   // test renders with a tour camera

const rnd01 = mulberry32(0x5eed);

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
  let memLogSlot = -1;
  let baked = false, cityShown = -1, tabletKey = "";
  let lastMode: Mode | "" = "";
  const focus = new THREE.Vector3(), aheadDir = { x: 0, z: 0 };
  const pose: Pose = { x: 0, z: 0, h: 0, k: 0 };
  const spotSeat = new THREE.Vector3(), spotChest = new THREE.Vector3(), cutCentre = new THREE.Vector3();
  let base = 0, randomSeed = false, scrubPrev = 0;          // journey time at scene time 0 (the saved time)
  let lastX = NaN, lastZ = 0;   // the truck's last rendered position, for wheel travel

  function snapshot(): SavedState {
    return { v: STATE_VERSION, seed: cfg.seed, random: randomSeed, season: journey.startSeason, simTime: journey.st.simTime, journey: null };
  }

  function buildCity() {
    streamer?.clear();
    engine.setSky(journey.plan.style.sky);
    backdrop.build(journey.plan.style, journey.st.citySeed);
    // Each chunk's tall parts go into the occlusion map the camera consults (occlusion.ts).
    const build = makeCityChunkBuilder(mats, journey.plan, (st) => fleet.build(st));
    const withOcclusion = function* (cx: number, cz: number): ChunkBuild {
      const g = yield* build(cx, cz);
      yield;
      if (g) { const f = OCCLUSION.add(g, cx * BLOCK, cz * BLOCK, [mats.ground], "city"), prev = g.userData.onDispose; g.userData.onDispose = () => { prev?.(); OCCLUSION.remove(f); }; }
      return g;
    };
    streamer = new ChunkStreamer(engine.world, BLOCK, withOcclusion, STREAM_RADIUS, 1, (cx, cz) => cityDistance(cx, cz) > RING);
    cityShown = journey.st.city;
  }

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
    truck.speed = journey.st.v; truck.accel = journey.accel;
    // Reversing into a bay, the trailer leads along the bay path; ease into it from however the
    // hitch left it on the way in.
    const ty = journey.trailerYaw();
    if (ty !== null) truck.trailerYaw = jumped ? ty : truck.trailerYaw + (ty - truck.trailerYaw) * Math.min(1, dt * 4);
    else if (jumped) truck.trailerYaw = 0;
  }

  function newTruck(model: TruckModel) {
    const t = new Truck(kit, model, puffs);
    engine.scene.add(t.root);
    return t;
  }

  // Keep the second truck in step with the journey: the spare parked ahead at a swap stop,
  // which becomes the driven truck at the hand-over, leaving the old one parked.
  function syncTrucks() {
    const st = journey.st;
    if (st.truck !== truck.model) {
      if (other && other.model === st.truck) { const t = truck; truck = other; other = t; }
      else { truck.dispose(); truck = newTruck(st.truck); }
      truck.engineOn = true; tabletKey = "";
    }
    const want = st.spare ?? st.parked?.model ?? null;
    if (other && other.model !== want) { other.dispose(); other = null; }
    if (want && !other) other = newTruck(want);
    if (other) {
      if (st.spare) journey.sparePose(pose);
      else if (st.parked) { pose.x = st.parked.x; pose.z = st.parked.z; pose.h = st.parked.h; pose.k = 0; }
      other.follow(pose.x, pose.z, pose.h, 0, 0);
      other.speed = 0; other.accel = 0; other.engineOn = false; other.hazards = false; other.signal = 0;
    }
  }

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
    updateCutaway(cam, focus, false);
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
      const lx = ((x % BLOCK) + BLOCK) % BLOCK, lz = ((z % BLOCK) + BLOCK) % BLOCK;
      // Lots fill each chunk's [STREET, BLOCK) square (frontages run right to the sidewalk); keep
      // five metres clear of them (closer, a wall fills half the frame).
      const lotBand = (l: number) => l > STREET - 5 || l < 5;
      if (!(lotBand(lx) && lotBand(lz))) return false;
      const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
      if (!insideCity(bx, bz)) return false;
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

  function placeCamera(dt: number) {
    director.update({ journey, truck, other, dt, gag: crew.gagPoint, driver: crew.inSeat ? null : driverChest.copy(crew.driver.root.position).setY(crew.driver.root.position.y + 1.1) });
    if (DEBUG_VIEW === "countryTop") {   // test renders: straight down over the truck
      const p = truck.root.position;
      engine.camera.position.set(p.x, 160, p.z + 0.01); engine.camera.lookAt(p.x, 0, p.z);
      focus.copy(p); engine.setViewDistance(400, 160); return;
    }
    if (DEBUG_VIEW === "rear" || DEBUG_VIEW === "door") {   // test renders: close on the back of the truck (street side), or towards the building
      const L = truckLayout(truck.model), h = truck.heading, p = truck.root.position;
      const at = (x: number, y: number, z: number) => new THREE.Vector3(p.x + Math.cos(h) * x + Math.sin(h) * z, y, p.z - Math.sin(h) * x + Math.cos(h) * z);
      const kd = journey.kerbDoor;
      if (DEBUG_VIEW === "door" && kd) {   // facing the front door from across the pavement, a little to one side
        engine.camera.position.set(kd.x + kd.nx * 3.2 - kd.nz * 7, 2.4, kd.z + kd.nz * 3.2 + kd.nx * 7); engine.camera.lookAt(kd.x + kd.nx * 1.2, 1.3, kd.z + kd.nz * 1.2);
      } else if (DEBUG_VIEW === "door") { engine.camera.position.copy(at(L.bedRear - 12, 3.2, 0)); engine.camera.lookAt(at(L.bedRear - 2, 1.4, 6)); }
      else { engine.camera.position.copy(at(L.bedRear - 4.5, 2.6, -5.5)); engine.camera.lookAt(at(L.bedRear + 0.3, 1.5, 0)); }
      focus.copy(p); updateDriverSpot(engine.camera, null); return;
    }
    if (tourCamera(dt)) return;
    const cam = engine.camera;
    truck.interiorView = director.interior;
    focus.copy(truck.root.position);
    // The see-through cone is centred on the middle of the truck (its origin is the rear axle) and
    // sized to its length, trailer included, so it rings the whole truck.
    const ex = truckExtents(truck.model), h = truck.heading;
    cutCentre.set(focus.x + Math.cos(h) * ex.center, focus.y, focus.z - Math.sin(h) * ex.center);
    cutUniforms.uCutRadius.value = (ex.front - ex.rear) / 2 + 2;
    // Held shots at a stop: street trees, poles and the like within 7 m of the camera are left out,
    // so nothing near the lens blocks the work at the truck (3 m otherwise).
    const held = director.beat === "curb" || director.beat === "load" || director.beat === "swap";
    cutUniforms.uNearClip.value = held && !director.interior ? 7 : 3;
    updateCutaway(cam, cutCentre, director.cutaway);
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
    truck: { model: TruckModel; s: ReturnType<Truck["save"]> }; other: { model: TruckModel; s: ReturnType<Truck["save"]> } | null;
    m: { lastX: number; lastZ: number; fogClear: number; lastMode: Mode | ""; tabletKey: string };
  };
  const snaps = new Map<number, PresSnap>();
  function presSave(): PresSnap {
    return {
      k: presK, city: presCity, dir: director.save(), crew: crew.saveState(), puffs: puffs.save(), atm: atmosphere.offset,
      truck: { model: truck.model, s: truck.save() }, other: other ? { model: other.model, s: other.save() } : null,
      m: { lastX, lastZ, fogClear, lastMode, tabletKey },
    };
  }
  function presLoad(p: PresSnap) {
    syncTrucks();
    if (truck.model === p.truck.model) truck.load(p.truck.s);
    if (other && p.other && other.model === p.other.model) other.load(p.other.s);
    director.load(p.dir); crew.loadState(p.crew); puffs.load(p.puffs); atmosphere.offset = p.atm;
    ({ lastX, lastZ, fogClear, lastMode, tabletKey } = p.m);
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
      if (journey.st.city !== cityShown) buildCity();
      streamer.fill(new THREE.Vector3(journey.pose.x, 0, journey.pose.z));
    } else freshAt(boundaryAtOrBefore(K));
    while (presK < K) tick();
  }
  function freshAt(k: number) {
    journey.seekTo(k / TICK_HZ);
    director.reset(); puffs.clear(); lastX = NaN; fogClear = -1; tabletKey = ""; lastMode = journey.st.mode;
    countryWorld.setRoad(null); roadShown = null;
    presCity = -1; presK = k;
    step(k / TICK_HZ, 0, true);
    if (PREVIEW && onBoundary(k) && !snaps.has(k)) snaps.set(k, presSave());
    if (DEBUG_SCRUBTEST || DEBUG_CAMLOG) scrubTestLog();
  }
  // One update of the presentation at journey time `time`, `dt` after the last (0 and `fresh` when
  // starting from scratch).
  function step(time: number, dt: number, fresh: boolean) {
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
      if (DEBUG_CAMLOG) sys.log(`ROAD ${pr.road.inp.kind}${pr.road.inp.toFreeway ? " to-freeway" : ""} c${pr.road.inp.city} at u${pr.u.toFixed(1)} s${pr.s.toFixed(0)}: ${pr.road.pieces.map((p) => `${p.kind}@${p.s.toFixed(0)}`).join(" ")}`);
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
    // own countryside colour in town.
    if (pr) countryWorld.update(pr.u, pr.s, switched);
    else countryWorld.setBase(truck.root.position.x, truck.root.position.z, countryWorld.groundOf(BIOME_OF[journey.plan.style.id], journey.climate));
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
  function scrubTestLog() {
    if (presK === scrubLogged) return;
    scrubLogged = presK;
    const c = engine.camera, p = truck.root.position;
    sys.log(`TICK ${presK} ${c.position.x.toFixed(5)} ${c.position.y.toFixed(5)} ${c.position.z.toFixed(5)} ${c.quaternion.x.toFixed(6)} ${c.quaternion.y.toFixed(6)} ${c.quaternion.z.toFixed(6)} ${c.quaternion.w.toFixed(6)} ${p.x.toFixed(4)} ${p.z.toFixed(4)} ${director.beat}/${director.variant} ${journey.st.mode} ${journey.st.v.toFixed(2)} ${truck.heading.toFixed(4)}`);
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
      if (key !== tabletKey) { truck.setTablet(road.inp.toName, `${journey.aboardUnits} aboard`); tabletKey = key; }
      return;
    }
    const stop = journey.nextStop;
    const name = stop?.site?.name ?? (stop?.kind === "depart" ? "Highway" : "Cruising");
    const what = stop && stop.kind !== "swap" && stop.kind !== "depart" ? `${stop.kind === "pickup" ? "Pick up" : "Drop"} ${stop.units} ${CARGO_BY_ID.get(stop.cargo)!.name}`
      : stop?.kind === "swap" ? `Swap to ${stop.truck}` : `${journey.aboardUnits} aboard`;
    const key = name + what;
    if (key !== tabletKey) { truck.setTablet(name, what); tabletKey = key; }
  }

  return {
    async setup() {
      engine = new Engine(sys);
      engine.backdrop = backdrop;
      hud = new Hud();
      persist = new Persistence(sys);
      // Seed 0 asks for a random journey: resume the one in storage, or draw a new one.
      const random = randomSeed = cfg.seed === 0;
      const saved = await persist.load(cfg.seed, random);
      // The preview has no lasting storage, so its random journey is the day's journey: the same on
      // every reload.
      const today = new Date();
      const daySeed = Math.floor(hash2(today.getFullYear() * 1000 + today.getMonth() * 40 + today.getDate(), 7, 0, 0x5eed) * 2 ** 31) || 1;
      if (random) cfg.seed = saved?.seed ?? (sys.isPreview ? daySeed : ((Math.floor(Math.random() * 2 ** 31) ^ Date.now()) >>> 0 || 1));
      base = (saved?.simTime ?? 0) + DEBUG_SKIP_MINUTES * 60;   // the skip: test renders only
      setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles);
      if (DEBUG_CAMLOG) JOURNEY_LOG.out = (line) => sys.log(`J ${line}`);
      journey = new Journey(cfg, base, saved?.season ?? realSeason());
      journey.keyframing = journey.keepNeighbours = sys.isPreview || DEBUG_SCRUBTEST > 0;   // (only the preview scrubs)
      // The one line logged (besides debug builds'), for reproducing what was seen: the journey and
      // where it starts (journey time = this + scene time).
      sys.log(`Long Day: seed ${cfg.seed}, starting at journey time ${base.toFixed(1)}s`);
      const images = {} as Record<LiveryName, CanvasImageSource>;
      for (const n of LIVERY_ASSETS) images[n] = uploadable(await assets[n].loadImage());
      const atlas = uploadable(await assets.facades.loadImage());
      puffs = new PuffSystem(engine.scene);
      kit = new TruckKit(images);
      fleet = new FleetBaker(kit);
      signAtlas.logo = await assets.logoWhite.loadImage();
      signAtlas.logoColor = await assets.logoColor.loadImage();
      signAtlas.batonMark = await assets.batonWordmark.loadImage();
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
      // Cars, people and anything else that can stand between the camera and the driver get the
      // driver spotlight.
      const movers = engine.mats.ground.clone(); applyDriverSpot(movers); applyLampGlow(movers); applyLampLight(movers);
      traffic = new Traffic(engine.scene, movers, (model) => fleet.build([{ model, x: 0, z: 0, h: 0 }]));
      crowd = new Crowd(engine.scene, movers);
      cityCars = new FreewayTraffic(engine.scene, movers); roadCars = new FreewayTraffic(engine.scene, movers);
      ambient = new Ambient(engine.scene, engine.mats.ground);
      const tl = performance.now();
      journey.attachLife(new StreetLife(traffic, crowd, ambient));
      seekMs = performance.now() - tl;

      const facadeMat = makeFacadeMaterial(atlas);
      applyCutaway(facadeMat); applyDriverSpot(facadeMat);
      for (const m of [facadeMat, engine.mats.ground, engine.mats.solid]) applyLampLight(m);   // streetlights and headlights light the world
      mats = { ground: engine.mats.ground, solid: facadeMat, lamp: makeLampMaterial() };
      buildCity();
      countryWorld = new CountryWorld(engine.scene, mats, (st) => fleet.build(st));
      elevatedReach = new ElevatedReach(engine.world, mats.solid);
      freewayReach = new FreewayReach(engine.world, mats.ground);   // (not the solid material: the truck's see-through spotlight leaves the freeway be)
      atmosphere = new Atmosphere(cfg, engine.scene, backdrop.scene);
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
      if (!baked) { captureCanvasClass(ctx); baked = true; }
      const target = Math.max(0, base + t);
      // The presentation runs on fixed ticks of journey time (see step); a scrub, a long jump ahead
      // or the first frame lands on a tick from a snapshot or from scratch, and replays from there.
      const K = Math.floor(target * TICK_HZ + 1e-6);
      if (presK < 0 || K < presK || K > presK + 5 * TICK_HZ) {
        const ts = performance.now();
        if (presK < 0 && !PREVIEW) freshAt(K); else jumpTo(K);
        seekMs = performance.now() - ts;
      }
      while (presK < K) tick();
      // This frame's moment, between two ticks: a part-tick on top of the last one, undone after
      // drawing (never across a hand-over: that frame shows the tick).
      let held: PresSnap | null = null;
      if (target - presK / TICK_HZ > 1e-7 && journey.cityAt(target) === presCity) { held = presSave(); step(target, target - presK / TICK_HZ, false); }
      const pr = lastRoad, inCity = journey.st.mode !== "country", alpha = journey.alpha;
      const road = journey.st.mode === "country" ? journey.exitRoad : null;
      // Street life around the truck (none on the open road): simulated with the journey, drawn
      // between its last two steps.
      traffic.time = target; traffic.draw(alpha);
      crowd.draw(alpha, target);
      ambient.update(target, alpha, journey.plan, TOUR_VIEW ? focus : truck.root.position, inCity);
      if (!TOUR_VIEW) {
        // Out of town the city is streamed further (its edge in view from the open land); the radius
        // comes back in once the fog has eased in to match.
        const outside = cityDistance(Math.floor(truck.root.position.x / BLOCK), Math.floor(truck.root.position.z / BLOCK)) > 0;
        if (outside) streamer.setRadius(5);
        else if (streamer.radius > STREAM_RADIUS && fogClear >= 0 && fogClear <= (STREAM_RADIUS + 0.6) * BLOCK) streamer.setRadius(STREAM_RADIUS);
        aheadDir.x = Math.cos(truck.heading); aheadDir.z = -Math.sin(truck.heading);
        streamer.update(truck.root.position, aheadDir);
      }
      {
        const bd = backdropState(pr);
        const bc = bd.city === journey.st.city ? { style: journey.plan.style, seed: journey.st.citySeed } : { style: journey.exitRoad!.inp.toStyle, seed: citySeedOf(cfg.seed, bd.city) };
        if (backdrop.built !== `${bc.style.id}/${bc.seed}`) backdrop.build(bc.style, bc.seed);
        backdrop.setPresence(bd.p);
      }
      signAtlas.bake(); plateAtlas.bake();
      marquee.update(target);
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
        if (!on) for (let k = 1; k < HEAD_LIGHTS.value.length; k++) HEAD_LIGHTS.value[k].w = 0;   // the other vehicles' too
        else if (roadShown && journey.st.mode === "country" && journey.countryS > 400) countryWorld.headlights(HEAD_LIGHTS.value, 1, truck.root.position);
        else traffic.headlights(HEAD_LIGHTS.value, 1, truck.root.position);
      }
      // Dome lights after dark: the cargo box always, the cab while the truck is stopped for a job.
      truck.interiorLight(INTERIOR_LIGHT.value, LAMPS_ON.value > 0, LAMPS_ON.value > 0 && journey.st.mode === "dwell");
      atmosphere.applyFog(engine);
      atmosphere.precipitation(t, engine.camera);
      engine.followSun(focus);
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
        sys.log("MEMLOG " + JSON.stringify({ t: Math.round(t), city: journey.st.city, mode: journey.st.mode, geo: mi.geometries, tex: mi.textures, prog: engine.renderer.info.programs?.length ?? 0, objs, heap: pm ? Math.round(pm.heapUsed / 1e6) : -1, ext: pm ? Math.round(pm.external / 1e6) : -1, ab: pm ? Math.round(pm.arrayBuffers / 1e6) : -1, sceneAB: Math.round(sceneAB / 1e6), gc: typeof (globalThis as any).gc, rss: pm ? Math.round(pm.rss / 1e6) : -1, chunks: streamer.chunks.size }));
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
