// Test: a truck's exhaust puffs (truck.ts PUFF_VEL, pipeMouth; puffs.ts) never go into its bed.
// For every model with a pipe, puffs leave the tip (idle and under acceleration) while the truck
// stands, drives straight, or turns left or right at walking to street pace, or backs up at up to
// its pace into a bay (journey.ts reverse), its rear axle on a circle; each puff, a cube swelling
// then shrinking as PuffSystem draws it, is followed through its life in the truck's frame and
// must stay out of the bed: the box (floor plate to roof, side to side, back to front) or the
// flatbed's deck. They once rose straight up through a box truck's floor while it idled at a stop
// (seed 1511948805 at 206:00), and at a slower sideways speed still clipped a 26 ft box's tail as
// it swung out pulling away on a tight left turn, and its front as it swung out backing round a
// bay's turn.
// Args: none
import * as THREE from "three@0.187.0";
import { SPECS, PUFF_VEL, PUFF_IDLE, PUFF_HARD, pipeMouth, type TruckModel } from "../src/truck.ts";
import { PuffSystem, puffScale } from "../src/puffs.ts";
{
  const proc = (globalThis as any).process;
  const DT = 1 / 60, MARGIN = 0.02;   // (puffs must clear the bed by 2 cm)
  const errs: string[] = [];
  let cases = 0, worst = Infinity;
  for (const model of Object.keys(SPECS) as TruckModel[]) {
    const s = SPECS[model], c = s.cargo;
    if (s.exhaust !== "pipe" || !c) continue;
    const e = new THREE.Vector3(...pipeMouth(s));
    const y0 = c.floor - 0.12, y1 = Math.max(c.top, c.floor);
    for (const v of [0, 1, 3, 6, -1, -2.2]) for (const R of v ? [Infinity, 7, 12, -7, -12] : [Infinity]) for (const k of [PUFF_IDLE, PUFF_HARD]) {
      cases++;
      // The truck's pose (its rear axle and heading; three.js's: forward is (cos h, -sin h), so a
      // growing h turns left), puffs emitted every 0.1 s over the first second.
      let x = 0, z = 0, h = 0, t = 0, deepest = Infinity;
      const puffs = new PuffSystem(new THREE.Group(), 256), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      const toTruck = (px: number, pz: number) => { const dx = px - x, dz = pz - z, cs = Math.cos(h), sn = Math.sin(h); return [cs * dx - sn * dz, sn * dx + cs * dz]; };
      while (t < 1 + k.life) {
        if (t < 1 && Math.abs(t / 0.1 - Math.round(t / 0.1)) < 1e-6) {
          q.setFromAxisAngle(up, h);
          const at = e.clone().applyQuaternion(q).add(new THREE.Vector3(x, 0, z));
          puffs.emit(at, new THREE.Vector3(...PUFF_VEL.pipe).applyQuaternion(q), k.color, k.size, k.life);
        }
        puffs.update(DT);
        x += Math.cos(h) * v * DT; z -= Math.sin(h) * v * DT; h += (v / R) * DT; t += DT;
        for (const p of puffs.save()) {
          const half = puffScale(p.age, p.life, p.size) / 2, [lx, lz] = toTruck(p.x, p.z);
          if (p.y + half < y0 || p.y - half > y1 || lx + half < c.x0 || lx - half > c.x1) continue;
          deepest = Math.min(deepest, Math.abs(lz) - half - c.hw);   // (how far its inner face is outside the bed's side)
        }
      }
      worst = Math.min(worst, deepest);
      if (deepest < MARGIN && errs.length < 10)
        errs.push(`${model} ${v < 0 ? `reversing at ${-v}` : `at ${v}`} m/s ${R === Infinity ? "straight" : R > 0 ? `turning left, R ${R}` : `turning right, R ${-R}`}, ${k === PUFF_HARD ? "accelerating" : "idling"}: a puff comes ${deepest < 0 ? `${(-deepest).toFixed(2)} m into` : `within ${deepest.toFixed(2)} m of`} the bed`);
    }
  }
  console.log(`exhaust: ${cases} cases, closest a puff comes to the bed ${worst.toFixed(2)} m, ${errs.length} problems`);
  if (errs.length) { for (const m of errs) console.error(m); proc.exit(1); }
}
