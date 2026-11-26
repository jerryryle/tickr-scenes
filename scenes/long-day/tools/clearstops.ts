// Keeps every kerb stop's pavement clear in a catalogue city: moves the street furniture, street
// trees and lamp posts out of the stretch the crew works on and writes them into the city's files.
// A stop's **work area** is the pavement of the side the truck stands on (a face of its block, one a
// truck can stop along) from just behind the truck's back to just past the door it uses (the
// side's door; with none, the pavement behind the truck), for every truck that stops there: one
// that carries a cargo the site sends or takes (a tractor only where it can reach), where
// journey.ts kerbStopAfter stands it. Each item found in a work area is moved along its pavement to
// the nearest place clear of every work area, of what else stands there, and of the driveways,
// kept-clear stretches and signs (city.ts buildStreet's keep marks); one with nowhere within
// SHIFT_MAX goes. Signal poles, stop signs and an elevated line's or a freeway's columns stay, and
// are reported. Run tools/tractorturns.ts again afterwards: the furniture bounds a tractor's turns.
// With --doors it redrafts the city's facility doors instead: each block's doors as its buildings
// put them with the file's own left out (city.ts kerbDoors, as test/doors.ts checks them), since
// what stands on the pavement steers where a door goes. The clearing and the redrafting each move
// what the other reads, so they are run in turn (make clearstops, then make clearstops DOORS=1, each
// of which repacks the cities first) until both change nothing.
// Args: a city's id [--dry] [--doors], or --list (every catalogue city's id, one a line).
import * as THREE from "three@0.187.0";
import { CityPlan, CITY_HI, CITY_LO, cityDistance, fileOf, kerbDoors, makeCityChunkBuilder } from "../src/city.ts";
import type { Recipe } from "../src/contents.ts";
import { PAVEMENT, PK } from "../src/decor.ts";
import { BLOCK, RING } from "../src/grid.ts";
import { STYLES } from "../src/styles.ts";
import { CATALOGUE } from "../src/world.ts";
import { facilityAt, siteLayout } from "../src/facilities.ts";
import { CARGO, truckCarries } from "../src/cargo.ts";
import { kerbStopAfter } from "../src/journey.ts";
import { truckLayout } from "../src/truck.ts";
import type { TruckModel } from "../src/truck.ts";
import { cityFileOfPlan, fileDoorsOf, fileItem, slugOf } from "./cityfiles.ts";

const csProc = (globalThis as any).process, csFs = csProc.getBuiltinModule("node:fs");
const MODELS: TruckModel[] = ["box16", "box26", "reefer", "flatbed", "tractor"];
// A work area runs from this far (m) behind the truck's back (where the crew comes up onto the
// pavement from its ramp or gate) to this far past the door (on its far side: a team lift backs
// round into it from there, chores.ts curveIn), and with no door from this far behind the truck's
// back (where the loads are set down, chores.ts pavementFetch).
const BEHIND = 1.5, PAST_DOOR = 2.5, NO_DOOR = 4;
// An item is moved at most this far (m) along its pavement, in steps of this; and kept this far
// (m) clear of what else stands there, beyond both their radii.
const SHIFT_MAX = 20, SHIFT_STEP = 0.25, GAP = 0.3;
const FURNITURE_NAME = Object.fromEntries(Object.entries(PK).map(([k, v]) => [v, k])) as Record<number, string>;

interface Item { x: number; z: number; r: number; kind: number }
interface Zone { face: number; lo: number; hi: number }
const csArg: string = csProc.argv[2] ?? "", csDry = csProc.argv.includes("--dry"), csDoors = csProc.argv.includes("--doors");
const csCity = CATALOGUE.find((c) => c.id === csArg);
const cityFileOf = (F: typeof CATALOGUE[number]) => `scenes/long-day/src/city-${F.style}/${slugOf(F.name)}/${slugOf(F.name)}.ts`;
if (csArg === "--list") for (const F of CATALOGUE) console.log(F.id);
else if (!csCity) { console.error(`usage: clearstops <city id> [--dry] [--doors] | --list (no city ${csArg})`); csProc.exit(2); }
else if (csDoors) {
  // Each facility block's doors are worked out from its buildings and written over the file's where
  // they differ. (A block's line is found by its place in the file's blocks, the plan's block order.)
  const F = csCity, file = fileOf(F), bare = new CityPlan(F.key, STYLES[F.style], F.key, { ...file, blocks: file.blocks.map(({ doors: _d, ...b }) => b) });
  const path = cityFileOf(F), lines: string[] = csFs.readFileSync(path, "utf8").split("\n");
  const blockLines = lines.flatMap((l, i) => (/^ {4}\{ at: /.test(l) ? [i] : []));
  let changed = 0, doors = 0, kept = 0, dirty = false;
  const blocks = file.blocks.map((b) => ({ ...b }));
  bare.graph.blocks.forEach((B, i) => {
    const own = file.blocks[i].doors;
    if (!own) return;
    const now = fileDoorsOf(bare, B.kx, B.kz) ?? [];
    doors += own.length;
    // (A door counts as moved as test/doors.ts judges it: more than 2 cm along or out, or another
    // panel or height. The centimetre a curved face's rounding gives is let be.)
    type D = (typeof now)[number];
    const same = (d: D | undefined, e: D | undefined) => !!d && !!e && Math.abs(d.a - e.a) <= 0.02 && Math.abs(d.n - e.n) <= 0.02 && d.panel === e.panel && Math.abs(d.h - e.h) <= 0.02;
    const n = [0, 1, 2, 3, 4, 5, 6, 7].filter((side) => (own.some((d) => d.side === side) || now.some((e) => e.side === side)) && !same(own.find((d) => d.side === side), now.find((e) => e.side === side))).length;
    if (!n) return;
    changed += n;
    blocks[i].doors = now; dirty = true;
    lines[blockLines[i]] = lines[blockLines[i]].replace(/doors: \[[^\]]*\]/, `doors: ${fileItem(now)}`);
  });
  // The furniture is kept off the doors as they now are, as the file's writer keeps it (tools/
  // cityfiles.ts cityFileOfPlan, clearDoors), so that the file reads back as written.
  {
    const streets = cityFileOfPlan(new CityPlan(F.key, STYLES[F.style], F.key, { ...file, blocks }), F.id, F.name).streets;
    const streetLines = lines.flatMap((l, i) => (/^ {4}\{ id: \d+, a: \d+, b: \d+/.test(l) ? [i] : []));
    streets.forEach((st, i) => {
      const was = file.streets[i].furniture ?? [], now = st.furniture ?? [];
      if (fileItem(was) === fileItem(now)) return;
      kept += was.filter((w) => !now.some((x) => fileItem(x) === fileItem(w))).length; dirty = true;
      lines[streetLines[i]] = now.length ? lines[streetLines[i]].replace(/furniture: \[.*\]/, `furniture: ${fileItem(now)}`) : lines[streetLines[i]].replace(/, furniture: \[.*\]/, "");
    });
  }
  if (!csDry && dirty) csFs.writeFileSync(path, lines.join("\n"));
  console.log(`${F.id}: doors redrafted ${changed} of ${doors}, furniture kept off them ${kept}`);
}
else {
  const F = csCity;
  const t0 = Date.now(), plan = new CityPlan(F!.key, STYLES[F!.style]), G = plan.graph;
  // What stands on the pavements, by what drew it, and where nothing may go (world).
  const mats = { ground: new THREE.MeshLambertMaterial(), solid: new THREE.MeshLambertMaterial(), lamp: new THREE.MeshBasicMaterial() };
  for (const B of G.blocks) if (B.inCity) kerbDoors(plan, B.kx, B.kz);
  // (Each street's listed trees and lamps, by recipe: the street and its place in the list.)
  const streetOf = new Map<Recipe, [number, number]>();
  for (const [id, rows] of plan.contents?.streets ?? []) rows.forEach((r, i) => streetOf.set(r, [id, i]));
  const build = makeCityChunkBuilder(mats, plan), groups = new Map<unknown, Item[]>(), fixed: Item[] = [], keep: Item[] = [];
  for (let cx = CITY_LO - RING; cx <= CITY_HI + RING; cx++) for (let cz = CITY_LO - RING; cz <= CITY_HI + RING; cz++) {
    if (cityDistance(cx, cz) > 0) continue;
    const out: number[] = [], src: unknown[] = [], kp: number[] = [];
    PAVEMENT.out = out; PAVEMENT.src = src; PAVEMENT.keep = kp;
    try { const gen = build(cx, cz); let r = gen.next(); while (!r.done) r = gen.next(); } finally { PAVEMENT.out = PAVEMENT.src = PAVEMENT.keep = null; }
    for (let i = 0; i < out.length; i += 4) {
      const o = { x: out[i] + cx * BLOCK, z: out[i + 1] + cz * BLOCK, r: out[i + 2], kind: out[i + 3] }, tag = src[i / 4];
      // (Furniture from the file, or a tree or lamp of a street's listed contents: movable.)
      const movable = tag && typeof tag === "object" && ("street" in tag || ["tree", "lamp"].includes((tag as Recipe).k) && streetOf.has(tag as Recipe));
      if (movable) { const key = "street" in (tag as object) ? JSON.stringify(tag) : tag; const g = groups.get(key) ?? []; if (!g.some((q) => q.x === o.x && q.z === o.z)) g.push(o); groups.set(key, g); }
      else fixed.push(o);
    }
    for (let i = 0; i < kp.length; i += 3) keep.push({ x: kp[i] + cx * BLOCK, z: kp[i + 1] + cz * BLOCK, r: kp[i + 2], kind: -1 });
  }
  // The work areas, by face: along each stop's side, from behind its ramp's foot to past its door.
  const zones: Zone[] = [], reach = G.tractorReach();
  for (const B of G.blocks) {
    if (!B.inCity || B.water || siteLayout(plan, B.kx, B.kz).kind !== "kerb") continue;
    const doors = kerbDoors(plan, B.kx, B.kz), fac = facilityAt(plan, B.kx, B.kz);
    // (The trucks that stop there: those that carry a cargo it sends or takes.)
    const models = MODELS.filter((m) => CARGO.some((c) => (c.from.includes(fac) || c.to.includes(fac)) && truckCarries(m, c.truck)));
    B.sides.forEach((f, side) => {
      if (!G.hasFrontage(f) || !G.drivable(f)) return;
      const door = doors[side];
      let lo = Infinity, hi = -Infinity;
      for (const m of models) {
        if (m === "tractor" && !reach.has(f)) continue;
        const L = truckLayout(m), back = kerbStopAfter(G, f, m) + L.rear;
        const [a, b] = door ? [Math.min(back - BEHIND, door.a - PAST_DOOR), Math.max(back + 1, door.a + PAST_DOOR)] : [back - NO_DOOR, back + 1];
        lo = Math.min(lo, a); hi = Math.max(hi, b);
      }
      if (lo < hi) zones.push({ face: f, lo: Math.max(G.faceA0(f), lo), hi: Math.min(G.faceA1(f), hi) });
    });
  }
  // Whether a point is on a work area's pavement: along its face within the area, and out from the
  // block's edge no further than the pavement reaches.
  const along = (f: number, x: number, z: number) => {
    let best = Infinity, ba = 0;
    for (let a = G.faceA0(f); a <= G.faceA1(f); a += 0.5) { const P = G.facePt(f, a, 0), d = (P.x - x) ** 2 + (P.z - z) ** 2; if (d < best) { best = d; ba = a; } }
    for (let a = ba - 0.5, k = 0; k < 11; k++, a += 0.1) { const P = G.facePt(f, a, 0), d = (P.x - x) ** 2 + (P.z - z) ** 2; if (d < best) { best = d; ba = a; } }
    return { a: ba, d: Math.sqrt(best) };
  };
  const inZone = (o: Item) => zones.some((Z) => {
    const P = G.facePt(Z.face, (Z.lo + Z.hi) / 2, 0);
    if (Math.hypot(P.x - o.x, P.z - o.z) > (Z.hi - Z.lo) / 2 + 8) return false;
    const { a, d } = along(Z.face, o.x, o.z), kerb = G.streets[Z.face >> 1].kerb;
    const out = G.facePt(Z.face, a, -1), side = (out.x - G.facePt(Z.face, a, 0).x) * (o.x - G.facePt(Z.face, a, 0).x) + (out.z - G.facePt(Z.face, a, 0).z) * (o.z - G.facePt(Z.face, a, 0).z);
    return a >= Z.lo - o.r && a <= Z.hi + o.r && side >= 0 && d <= kerb + o.r;
  });
  // Moved where needed: each item in a work area, the shortest shift along its pavement that clears
  // every work area and what else stands there.
  const placed: Item[] = [...fixed, ...[...groups.values()].flat()];
  const moves = new Map<unknown, { dx: number; dz: number } | null>();
  let stuck = 0;
  for (const [key, g] of groups) {
    if (!g.some(inZone)) continue;
    // (Along the pavement: the kerb's line at the first piece, from the nearest face.)
    let face = -1, fa = 0, fd = Infinity;
    for (const Z of zones) { const r = along(Z.face, g[0].x, g[0].z); if (r.d < fd) { fd = r.d; face = Z.face; fa = r.a; } }
    const P0 = G.facePt(face, fa - 0.5, 0), P1 = G.facePt(face, fa + 0.5, 0), tl = Math.hypot(P1.x - P0.x, P1.z - P0.z), tx = (P1.x - P0.x) / tl, tz = (P1.z - P0.z) / tl;
    // (Only what stands within reach of some shift can be in the way.)
    const others = placed.filter((q) => !g.includes(q) && Math.hypot(q.x - g[0].x, q.z - g[0].z) < SHIFT_MAX + 10);
    let got: { dx: number; dz: number } | null = null;
    for (let k = 1; k * SHIFT_STEP <= SHIFT_MAX && !got; k++) for (const s of [1, -1]) {
      const dx = tx * s * k * SHIFT_STEP, dz = tz * s * k * SHIFT_STEP, moved = g.map((o) => ({ ...o, x: o.x + dx, z: o.z + dz }));
      // (Still on its own pavement: as far out from the block's edge as it was, within its face.)
      const r = along(face, moved[0].x, moved[0].z);
      if (Math.abs(r.d - fd) > 0.3 || r.a < G.faceA0(face) + 1.5 || r.a > G.faceA1(face) - 1.5) continue;
      if (moved.some(inZone)) continue;
      if (moved.some((o) => others.some((q) => Math.hypot(q.x - o.x, q.z - o.z) < q.r + o.r + GAP) || keep.some((q) => Math.hypot(q.x - o.x, q.z - o.z) < q.r + o.r))) continue;
      got = { dx, dz };
      g.forEach((o, i) => { o.x = moved[i].x; o.z = moved[i].z; });
      break;
    }
    if (!got) stuck++;
    moves.set(key, got);
  }
  const blocked = fixed.filter((o) => o.kind !== PK.tree && inZone(o)).length;
  // Into the files: furniture along its street (its `at`), a tree's or lamp's place in its row.
  const cityFile = cityFileOf(F), contentsFile = cityFile.replace(/\.ts$/, "-contents.ts");
  const lines: string[] = csFs.readFileSync(cityFile, "utf8").split("\n"), clines: string[] = csFs.readFileSync(contentsFile, "utf8").split("\n");
  let moved = 0, gone = 0;
  // (Each street's line in the city file, and its rows in the contents file.)
  const streetLine = new Map<number, number>();
  lines.forEach((l, i) => { const m = /^ {4}\{ id: (\d+), a: \d+, b: \d+/.exec(l); if (m && !streetLine.has(Number(m[1]))) streetLine.set(Number(m[1]), i); });
  const rowLine = new Map<string, number>();
  { let inStreets = false, id = -1, n = 0;
    clines.forEach((l, i) => {
      if (l.startsWith("  streets: {")) { inStreets = true; return; }
      if (inStreets && l.startsWith("  },")) { inStreets = false; return; }
      const m = inStreets ? /^ {4}(\d+): \[/.exec(l) : null;
      if (m) { id = Number(m[1]); n = 0; return; }
      if (inStreets && /^ {6}\[/.test(l)) rowLine.set(`${id}:${n++}`, i);
    }); }
  const dropLines = new Set<number>();
  for (const [key, mv] of moves) {
    if (typeof key === "string") {
      // Furniture: [kind, side, at] on its street, at = along - 9 (city.ts fileFurniture).
      const t = JSON.parse(key) as { street: number; kind: number; p: number; inward: number }, li = streetLine.get(t.street)!;
      const S = G.streets[t.street], axis = Math.abs(Math.atan2(Math.sin(S.h0 + Math.PI / 2), Math.cos(S.h0 + Math.PI / 2))) < 1e-9 ? 1 : 0, side = (t.inward < 0) === (axis === 1) ? "r" : "l";
      const m = /furniture: (\[.*\])/.exec(lines[li])!, list = JSON.parse(m[1]) as [string, string, number][];
      const at = Math.round((t.p - 9) * 100) / 100, i = list.findIndex(([k, s, a]) => k === FURNITURE_NAME[t.kind] && s === side && Math.abs(a - at) < 0.011);
      if (i < 0) { console.error(`${F!.id}: no ${FURNITURE_NAME[t.kind]} ${side} at ${at} on street ${t.street}`); continue; }
      if (mv) {
        // (Its shift along the street: the world shift on the street's own line.)
        const P = G.streetPt(t.street, 1, 0), Q = G.streetPt(t.street, 2, 0), sx = Q.x - P.x, sz = Q.z - P.z, sl = Math.hypot(sx, sz);
        list[i][2] = Math.round((list[i][2] + (mv.dx * sx + mv.dz * sz) / sl) * 100) / 100; moved++;
      } else { list.splice(i, 1); gone++; }
      // (The list is written back as tools/cityfiles.ts cityFileOfPlan writes it: it is in order
      // along the street, and a street with none left has no list.)
      list.sort((p, q) => p[2] - q[2] || (p[1] < q[1] ? -1 : 1));
      lines[li] = list.length ? lines[li].replace(/furniture: \[.*\]/, `furniture: ${JSON.stringify(list).replace(/,/g, ", ")}`) : lines[li].replace(/, furniture: \[.*\]/, "");
    } else {
      // A tree or lamp: its row's x and z (and a lamp's head), tile-local in the street's tile.
      const [sid, n] = streetOf.get(key as Recipe)!, li = rowLine.get(`${sid}:${n}`)!;
      if (!mv) { dropLines.add(li); gone++; continue; }
      // (In the row's own frame, [x, z, turn] or none: the world shift turned back into it, geom.ts frameApply.)
      const row = JSON.parse(clines[li].replace(/,\s*$/, "")) as unknown[], k = row[0] === "lamp" ? [3, 4, 5, 6] : [3, 4];
      const rot = Array.isArray(row[1]) ? (row[1] as number[])[2] : 0, c = Math.cos(rot), sn = Math.sin(rot);
      const lx = c * mv.dx - sn * mv.dz, lz = sn * mv.dx + c * mv.dz;
      for (const j of k) row[j] = Math.round(((row[j] as number) + (j % 2 ? lx : lz)) * 100) / 100;
      clines[li] = `      ${JSON.stringify(row).replace(/,/g, ", ")},`;
      moved++;
    }
  }
  if (!csDry) {
    csFs.writeFileSync(cityFile, lines.join("\n"));
    // (A street with no rows left is dropped, since tools/cityfiles.ts contentsRowsOf lists none.)
    const kept = clines.filter((_, i) => !dropLines.has(i));
    csFs.writeFileSync(contentsFile, kept.filter((l, i) => !(/^ {4}\d+: \[$/.test(l) && kept[i + 1] === "    ],") && !(l === "    ]," && /^ {4}\d+: \[$/.test(kept[i - 1] ?? ""))).join("\n"));
  }
  const zl = zones.reduce((a, Z) => a + Z.hi - Z.lo, 0), fl = zones.reduce((a, Z) => a + G.faceA1(Z.face) - G.faceA0(Z.face), 0);
  console.log(`${F!.id}: work areas ${(100 * zl / fl).toFixed(0)}% of their sides' length, ${groups.size} movable items in all`);
  console.log(`${F!.id}: ${zones.length} stop sides; moved ${moved}, removed ${gone} (no room within ${SHIFT_MAX} m), ${blocked} fixed things left in work areas (poles, posts, columns) (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
