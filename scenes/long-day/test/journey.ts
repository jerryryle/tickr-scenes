// Test: fast-forwards the journey and checks invariants; exits non-zero on a failure.
// Args (all optional): minutes [env-json] [force-cargo]
import { hash2 } from "../src/rng.ts";
import { readConfig } from "../src/env.ts";
import { slotEnd, TRUCK_SLOTS } from "../src/cargo.ts";
import { V_JOIN } from "../src/country.ts";
import { Journey } from "../src/journey.ts";

{
  const argv: string[] = (globalThis as any).process.argv.slice(2);
  const minutes = Number(argv[0] ?? 70);
  const env = JSON.parse(argv[1] ?? "{}");
  const cfg = readConfig(env as SceneEnv);
  const DT = 0.1;
  const j = new Journey(cfg, 0);
  const errs: string[] = [];
  const err = (m: string) => { if (errs.length < 40) errs.push(`t${j.st.simTime.toFixed(1)} ${m}`); };
  let px = j.pose.x, pz = j.pose.z, ph = j.pose.h, pmode = j.st.mode, ptruck = j.st.truck, pcity = j.st.city;
  let redStops = 0, redTime = 0, atRed = false, curRed = 0, longReds = 0;
  let still = 0, reverses = 0, docks = 0, kerbs = 0, swaps = 0, garages = 0;
  const kinds: Record<string, number> = {}, dockBy: Record<string, number> = {}, kerbBy: Record<string, number> = {};
  const arrivals: string[] = [];
  j.onEvent = (line) => { if (/arrived|swap|no route|no job/.test(line) || (globalThis as any).process.env.JTLOG) arrivals.push(line); };
  const n = Math.round(minutes * 60 / DT);
  // Checkpoints for the seek test: the state at random times, as linear playback reached them.
  const sig = (q: Journey) => `${q.st.city}/${q.st.step} ${q.st.mode} ${q.st.truck} ${q.pose.x.toFixed(4)},${q.pose.z.toFixed(4)},${q.pose.h.toFixed(4)} s${q.st.stopsDone} a${q.aboardUnits}`;
  const checks = new Map<number, string>();
  for (let k = 0; k < 24; k++) checks.set(Math.floor(hash2(k, 7, 99, 1) * n), "");
  const departs: string[] = []; let handoffs = 0;
  for (let i = 0; i < n; i++) {
    if (checks.has(i)) checks.set(i, sig(j));
    const stop = j.st.stops[0];
    const st0truck = j.st.truck;
    j.step();
    if (j.st.mode === "country" && pmode !== "country") { const r = j.country!; if ((globalThis as any).process.env.JTPIECES) for (const p of r.pieces) { let t = 0; while (t < r.duration && r.sAt(t) < p.s) t += 0.5; console.log(`PIECE c${j.st.city} ${p.kind} v${p.variant} side${p.side} at journey ${((j.st.cityStart + j.st.departAt + t) / 60).toFixed(2)}min`); }
    departs.push(`city ${j.st.city} left ${(j.st.departAt / 60).toFixed(1)}min ${j.countryLength.toFixed(0)}s (planned ${j.st.exit!.dEst}) gate ${j.st.exit!.gate} ${r.fromBiome}->${r.toBiome} SB ${(r.SB / 1000).toFixed(2)}km stops ${r.stops.map((x) => x.kind + '@' + x.arrive.toFixed(0)).join(',')} | ${r.pieces.map((p) => p.kind).join(',')} | end v${r.vAt(r.duration).toFixed(2)} ${st0truck}->${r.inp.toTruck} ${(() => { let km = 0, la = 0; const q = { x: 0, z: 0, h: 0, k: 0 }; for (let t = 0; t < r.duration; t += 0.5) { r.center(r.sAt(t), q); km = Math.max(km, Math.abs(q.k)); la = Math.max(la, r.vAt(t) ** 2 * Math.abs(q.k)); } return `minR ${(1 / km).toFixed(0)}m lat ${la.toFixed(2)}`; })()}`); }
    if (j.st.mode === "country" && pmode !== "country") {
      // The hills: level at both ends (the cities) and through every set piece, never steeper
      // than the grade limit, and the ground under the road is the road.
      const r = j.country!;
      let top = 0, steep = 0;
      for (let s = 0; s <= r.length; s += 1) {
        const y = r.heightAt(s), g = Math.abs(r.heightAt(s + 1) - y);
        top = Math.max(top, y); steep = Math.max(steep, g);
        if (!Number.isFinite(y)) { err(`road height not finite at ${s} (c${j.st.city})`); break; }
        if ((s < 300 || s > r.SB - 150) && Math.abs(r.baseAt(s)) > 1e-6) { err(`land not level near a city at s${s}: ${r.baseAt(s).toFixed(3)} (c${j.st.city})`); break; }
        if (s > r.length - 100 && Math.abs(y) > 1e-6) { err(`road not down at the gate at s${s} (c${j.st.city})`); break; }
        if (Math.abs(r.floorAt(s, 3) - (r.tunnelAt(s) ? y : r.baseAt(s))) > 1e-9) { err(`ground under the road is not the road at s${s} (c${j.st.city})`); break; }
      }
      for (const p of r.pieces) for (let s = p.s - 30; s <= p.s + p.len + 30; s += 5)
        if (Math.abs(r.baseAt(s) - r.baseAt(p.s)) > 0.01) { err(`${p.kind} not level: ${(r.baseAt(s) - r.baseAt(p.s)).toFixed(2)} m at s${s.toFixed(0)} (c${j.st.city})`); break; }
      if (steep > 0.0551) err(`road too steep: ${(steep * 100).toFixed(1)}% (c${j.st.city})`);
      // By the freeway: the truck's way up the on-ramp, and along the freeway to its off-ramp.
      if (r.inp.toFreewayMerge) {
        let ts = 0;
        for (let s = r.gateS - 700; s < r.length; s += 1) ts = Math.max(ts, Math.abs(r.truckY(s + 1) - r.truckY(s)));
        if (ts > 0.07) err(`on-ramp too steep: ${(ts * 100).toFixed(1)}% (c${j.st.city})`);
        if (Math.abs(r.truckY(r.length) - 9.6) > 1e-6) err(`not on the freeway at its off-ramp (c${j.st.city})`);
        // How hard it turns going over onto the on-ramp and up it (sideways pull, m/s^2).
        const q0 = { x: 0, z: 0, h: 0, k: 0 }, q1 = { x: 0, z: 0, h: 0, k: 0 };
        let lat = 0;
        for (let u = r.duration - 20; u < r.duration + r.arriveDur - 0.5; u += 0.25) {
          r.poseAt(u, q0); r.poseAt(u + 0.25, q1);
          const ds = Math.hypot(q1.x - q0.x, q1.z - q0.z), dh = Math.atan2(Math.sin(q1.h - q0.h), Math.cos(q1.h - q0.h));
          if (ds > 0.2) lat = Math.max(lat, Math.abs(dh / ds) * (ds / 0.25) ** 2);
        }
        if (lat > 2.2) err(`on-ramp too sharp: ${lat.toFixed(2)} m/s^2 (c${j.st.city})`);
        console.log(`ONRAMP c${j.st.city} lateral ${lat.toFixed(2)} m/s^2`);
      }
      console.log(`HILLS c${j.st.city} ${r.fromBiome}->${r.toBiome}${r.inp.toFreeway ? (r.inp.toFreewayMerge ? " (freeway, merging)" : " (freeway)") : ""} top ${top.toFixed(1)}m steepest ${(steep * 100).toFixed(1)}%`);
    }
    if (j.st.mode === "country" && pmode !== "country") {
      // The train must cross only while the truck waits at the crossing, and only near it.
      const r = j.country!, rp = r.pieces.find((p) => p.kind === "rail");
      if (rp && r.trainT >= 0) {
        const len = 9 * 17, q = { x: 0, z: 0, h: 0, k: 0 }, tq = { x: 0, z: 0, h: 0, k: 0 };
        let worst = 1e9, roll = 0;
        for (let u = r.trainT; u < r.trainT + (150 + len + 240) / 20; u += 0.25) {
          const front = -150 + 20 * (u - r.trainT), s = r.sAt(u);
          if (front > -10 && front - len < 10 && s > rp.s - 8) roll = Math.max(roll, s - rp.s);
          r.center(s, q);
          for (let n = front - len; n <= front; n += 8) { if (n < -240 || n > 240) continue; r.point(rp.s, n, tq); const d = Math.hypot(q.x - tq.x, q.z - tq.z); if (Math.abs(s - rp.s) > 40) worst = Math.min(worst, d); }
        }
        console.log(`TRAIN c${j.st.city} rail@${rp.s.toFixed(0)} tt${r.trainT.toFixed(0)} dur${r.duration.toFixed(0)} SB${r.SB.toFixed(0)} rollThrough ${roll.toFixed(1)} nearestAway ${worst.toFixed(0)}m`);
        if (roll > 0) err(`truck drives through the crossing while the train passes (c${j.st.city})`);
      }
    }
    const st = j.st;
    if (st.mode === "reverse" && pmode !== "reverse") { reverses++; if ((globalThis as any).process.env.JTFIND) console.log(`FIND reverse ${st.truck} t=${(st.simTime / 60).toFixed(2)}min ${st.stops[0]?.site?.name}`); }
    if (st.mode === "dwell" && pmode !== "dwell" && (globalThis as any).process.env.JTFIND && stop) console.log(`FIND dwell ${stop.kind} ${st.truck} ${j.dock ? "dock" : "kerb"} t=${(st.simTime / 60).toFixed(2)}min ${stop.cargo} ${stop.site?.name}`);
    if (st.mode === "dwell" && pmode !== "dwell" && stop) {
      kinds[stop.kind] = (kinds[stop.kind] ?? 0) + 1;
      if (stop.kind === "swap") swaps++;
      else if (j.dock) { docks++; dockBy[st.truck] = (dockBy[st.truck] ?? 0) + 1; }
      else { kerbs++; kerbBy[st.truck] = (kerbBy[st.truck] ?? 0) + 1; }
      // Up on a garage's roof: level, at its height.
      if (j.garageStop(stop)) {
        garages++;
        const l = j.truckLift();
        if (Math.abs(l.y - 4.8) > 1e-6 || Math.abs(l.grade) > 1e-6) err(`not on the garage roof at its stop: y${l.y.toFixed(2)} grade ${l.grade.toFixed(3)}`);
        if ((globalThis as any).process.env.JTFIND) console.log(`FIND garage ${st.truck} t=${(st.simTime / 60).toFixed(2)}min ${stop.site?.name}`);
      }
    }
    const jump = Math.hypot(j.pose.x - px, j.pose.z - pz);
    const dh = Math.abs(Math.atan2(Math.sin(j.pose.h - ph), Math.cos(j.pose.h - ph)));
    const handover = st.truck !== ptruck || st.city !== pcity;
    if (st.mode === "country" && pmode !== "country" && j.countryLength < 45) err(`country only ${j.countryLength.toFixed(0)}s`);
    if (st.city !== pcity) {
      // The hand-over: the new city's arrival straight must carry on exactly from the old road.
      const old = j.previousExit;
      if (!old) err("no previous road at the hand-over");
      else { const q = old.poseAt(old.duration, { x: 0, z: 0, h: 0, k: 0 }), a = j.arrivalRoad.poseAt(0, { x: 0, z: 0, h: 0, k: 0 });
        const dh2 = Math.abs(Math.atan2(Math.sin(q.h - a.h), Math.cos(q.h - a.h)));
        if (dh2 > 1e-6) err(`hand-over heading ${dh2}`);
        if (Math.abs(old.vAt(old.duration) - V_JOIN) > 0.05) err(`hand-over speed ${old.vAt(old.duration).toFixed(2)}`);
        if ((globalThis as any).process.env.JTLOG) console.log(`HANDOVER c${st.city} offset ${(a.x - q.x).toFixed(1)},${(a.z - q.z).toFixed(1)} v${old.vAt(old.duration).toFixed(3)}`); }
    }
    // An abrupt halt or lurch: the speed the pose actually moves at changing faster than the truck can brake.
    {
      const sp = jump / 0.1, g: any = globalThis;
      if (!handover && g.__prevSp !== undefined && g.__prevSp - sp > 1.6 && st.mode !== "reverse" && pmode !== "reverse")
        err(`abrupt halt ${g.__prevSp.toFixed(1)}->${sp.toFixed(1)} m/s ${pmode}->${st.mode} t=${(st.simTime / 60).toFixed(2)}min c${st.city} ct${st.cityTime.toFixed(1)} stops ${st.stops.length} path ${j.path ? "y" : "n"}`);
      if ((globalThis as any).process.env.JTGATE && st.mode === "drive" && st.modeTime < 8 && st.stopsDone % 1000 === 0 && st.cityTime < 60) console.log(`GATE c${st.city} mt${st.modeTime.toFixed(1)} sp${sp.toFixed(2)} v${st.v.toFixed(2)} path ${j.path ? "y" : "n"} stops ${st.stops.length} light ${(j as any).lightAhead}`);
      g.__prevSp = handover ? undefined : sp;
    }
    if (!handover && jump > Math.abs(j.lastStep) * 1.2 + 0.05) err(`pose jump ${jump.toFixed(2)} (step ${j.lastStep.toFixed(2)}) ${pmode}->${st.mode}`);
    if (!handover && dh > 0.12) {
      const pc: any = j.path ? (j.path as any).find(st.s) : null;
      err(`heading jump ${dh.toFixed(2)} ${pmode}->${st.mode} v${st.v.toFixed(1)} piece ${pc ? pc.kind + " len" + pc.len.toFixed(1) + " t0 " + (pc.t0 ?? 0).toFixed(1) + " t1 " + (pc.t1 ?? 0).toFixed(1) + " u" + (st.s - pc.s0).toFixed(1) : "-"} next ${stop?.kind} dockExit ${(j.path?.route as any)?.dock ? "y" : "n"}`);
    }
    if (st.loaded - st.unloaded !== j.aboardUnits) err(`ledger ${st.loaded}-${st.unloaded} != ${j.aboardUnits}`);
    if (j.aboardSlots > TRUCK_SLOTS[st.truck]) err(`over capacity ${j.aboardSlots}/${TRUCK_SLOTS[st.truck]}`);
    {
      const iv = st.aboard.map((a) => [a.slot, slotEnd(a.slotsPerUnit, a.units, a.slot)]).sort((p, q) => p[0] - q[0]);
      for (let i = 1; i < iv.length; i++) if (iv[i][0] < iv[i - 1][1] - 1e-6) err(`slot overlap ${JSON.stringify(iv)}`);
      for (const v of iv) if (v[1] > TRUCK_SLOTS[st.truck] + 1e-6) { err(`slot past the end ${JSON.stringify(iv)} / ${TRUCK_SLOTS[st.truck]}`); break; }
    }
    if (st.mode === "drive" && st.v < 0.05 && (j.lightAhead === "red" || j.lightAhead === "yellow")) { redTime += DT; curRed += DT; if (!atRed) { redStops++; atRed = true; } } else if (st.v > 0.5) { if (atRed && curRed > 5) longReds++; atRed = false; curRed = 0; }
    still = (st.mode === "drive" || st.mode === "reverse") && Math.abs(st.v) < 0.05 ? still + DT : 0;
    if (still > 90) { err(`stuck in ${st.mode} at s=${st.s.toFixed(1)}/${j.path?.length.toFixed(1)}`); still = -1e9; }
    px = j.pose.x; pz = j.pose.z; ph = j.pose.h; pmode = st.mode; ptruck = st.truck; pcity = st.city;
  }
  // Seek test: a fresh journey jumping to the checkpoints in a scrambled order, and the original
  // seeking backwards within its own city, must land on exactly what linear playback saw.
  const order = [...checks.keys()].sort((a, b) => hash2(a, 3, 5, 7) - hash2(b, 3, 5, 7));
  const q = new Journey(cfg, 0);
  let seekBad = 0; const t0 = Date.now();
  let seekMax = 0;
  for (const i of order) { const a = Date.now(); q.seekTo(i * DT); seekMax = Math.max(seekMax, Date.now() - a); if (sig(q) !== checks.get(i)) { seekBad++; err(`seek ${(i * DT).toFixed(1)}: ${sig(q)} != ${checks.get(i)}`); } }
  const seekMs = (Date.now() - t0) / order.length;
  let back = 0;
  for (const i of [...checks.keys()].filter((i) => Math.floor(i * DT / j.period) === j.st.city)) { j.seekTo(i * DT); back++; if (sig(j) !== checks.get(i)) err(`back seek ${(i * DT).toFixed(1)}: ${sig(j)} != ${checks.get(i)}`); }
  const restore = `seeks ${order.length - seekBad}/${order.length} ok, ${seekMs.toFixed(0)} ms avg, ${seekMax} max; back ${back}`;
  j.seekTo(n * DT);
  const st = j.st;
  for (const d of departs) console.log("  " + d);
  console.log(`garage roofs ${garages}`);
  console.log(`red-light stops ${redStops} (${longReds} over 5 s), waiting ${redTime.toFixed(0)} s`);
  console.log(`state json ${JSON.stringify(j.snapshot()).length} bytes, keyframes ${j.keyframeCount}`);
  console.log(`minutes ${minutes} stops ${st.stopsDone} cities ${st.city} truck ${st.truck}`);
  console.log(`dwells ${JSON.stringify(kinds)} dock ${docks} kerb ${kerbs} swap ${swaps} reverses ${reverses}`);
  console.log(`ledger in ${st.loaded} out ${st.unloaded} aboard ${j.aboardUnits}  restore ${restore}`);
  console.log(`dock by truck ${JSON.stringify(dockBy)} kerb by truck ${JSON.stringify(kerbBy)}`);
  for (const e of arrivals.slice(0, Number((globalThis as any).process.env.JTLOG ?? 14))) console.log("  " + e);
  console.log(errs.length ? "ERRORS\n" + errs.join("\n") : "OK");
  if (errs.length) (globalThis as any).process.exitCode = 1;
}
