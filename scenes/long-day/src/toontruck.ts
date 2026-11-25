// The trucks' storybook cartoon shape (truck.ts makeToon): soft, rounded and chunky. Each truck's
// shells (cab, hood, box or trailer) are boxes; here each is a region whose edges are rounded off
// (toonRound: a rounded box's, a radius of its own on each side, none where the box meets
// something that stays square, its doors or the cab's cowl) and whose big faces are puffed out a
// little, and the cab is made taller and the hood shorter. The parts' long faces are first cut
// into strips across the bands that curve (toonSlice), so they can bend; what is near a shell (a
// lamp, a mirror, a handle) moves with it. The result is a morph target, its normals worked out
// afresh, so the rounding shades as curves and fades in and out with `toon`.
import * as THREE from "three@0.187.0";

const clamp = THREE.MathUtils.clamp, smoothstep = THREE.MathUtils.smoothstep;

export interface ToonRegion {
  x0: number; x1: number; y0: number; y1: number; hw: number;      // the shell's box (z from -hw to hw)
  top: number; bottom: number; front: number; back: number; side: number;   // the rounding's radius on each side (0: square)
  frontFrom?: number;    // the front's rounding only above this height (a cab's, above its hood)
  pillow: number;        // how far its sides and top are puffed out at their middles (a fraction)
}
// Whether a point is near enough a region to move with it (its own parts and what is on them).
function toonNear(R: ToonRegion, x: number, y: number, z: number) {
  return x >= R.x0 - 0.02 && x < R.x1 + 0.05 && y > R.y0 - 0.05 && y < R.y1 + 0.3 && Math.abs(z) < R.hw + 0.7;
}
export function regionAt(regions: readonly ToonRegion[], p: THREE.Vector3): ToonRegion | null {
  for (const R of regions) if (toonNear(R, p.x, p.y, p.z)) return R;
  return null;
}

// A point of a region's as the rounded, puffed shell has it. The rounding: within a band a
// radius deep along each rounded side, the point's place in the band (0 at its start, 1 at the
// face) on each axis is a vector d; a corner of the box (d on two or three axes) is pulled in onto
// a quarter circle (or sphere) by scaling d from its largest component to its length, so a slab's
// inner and outer faces stay nested.
export function toonRound(R: ToonRegion, p: THREE.Vector3) {
  const fr = R.frontFrom === undefined ? R.front : R.front * smoothstep(p.y, R.frontFrom - 0.05, R.frontFrom + 0.25);
  const ax = band(p.x, R.x0, R.x1, R.back, fr), ay = band(p.y, R.y0, R.y1, R.bottom, R.top), az = band(p.z, -R.hw, R.hw, R.side, R.side);
  // (What stands out past a face, a mirror or a lamp, moves as the face under it does: the corner
  // is worked out for its foot on the face and the rest carried out as it was.)
  const cx = clamp(ax.d, -1, 1), cy = clamp(ay.d, -1, 1), cz = clamp(az.d, -1, 1);
  const inf = Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz)), l2 = Math.hypot(cx, cy, cz);
  if (l2 > 1e-9 && inf < l2 - 1e-9) {
    const f = inf / l2;
    p.x = ax.q + (cx * f + ax.d - cx) * ax.r; p.y = ay.q + (cy * f + ay.d - cy) * ay.r; p.z = az.q + (cz * f + az.d - cz) * az.r;
  }
  // Puffed: the sides out and the top up, most at their middles, nothing at their edges.
  if (R.pillow > 0) {
    const ux = clamp((p.x - R.x0) / (R.x1 - R.x0), 0, 1), uy = clamp((p.y - R.y0) / (R.y1 - R.y0), 0, 1), uz = clamp((p.z + R.hw) / (2 * R.hw), 0, 1);
    const bell = (u: number) => 1 - (2 * u - 1) ** 2;
    p.z *= 1 + R.pillow * bell(ux) * bell(uy);
    p.y = R.y0 + (p.y - R.y0) * (1 + R.pillow * 0.6 * bell(ux) * bell(uz));
  }
  return p;
}
// A coordinate's place in a rounded side's band: d (0 at the band's start, 1 at the face, more
// past it), its start q and its radius r; d 0 outside the bands.
function band(v: number, lo: number, hi: number, rLo: number, rHi: number) {
  if (rHi > 1e-4 && v > hi - rHi) return { d: (v - (hi - rHi)) / rHi, q: hi - rHi, r: rHi };
  if (rLo > 1e-4 && v < lo + rLo) return { d: (v - (lo + rLo)) / rLo, q: lo + rLo, r: rLo };
  return { d: 0, q: v, r: 0 };
}

// Where to cut a region's parts so its rounding and puffing can bend them: three strips across
// each rounded band, and every metre or so along its faces.
export function toonCuts(R: ToonRegion): [number[], number[], number[]] {
  const bands = (lo: number, hi: number, rLo: number, rHi: number, step: number) => {
    const c: number[] = [];
    for (const f of [0, 0.35, 0.7]) { if (rHi > 0) c.push(hi - rHi * (1 - f)); if (rLo > 0) c.push(lo + rLo * (1 - f)); }
    const n = Math.max(1, Math.round((hi - lo) / step));
    for (let i = 1; i < n; i++) c.push(lo + (hi - lo) * i / n);
    return c;
  };
  return [bands(R.x0, R.x1, R.back, R.front, 1.0), bands(R.y0, R.y1, R.bottom, R.top, 0.9), bands(-R.hw, R.hw, R.side, R.side, 0.8)];
}

// A copy of a (non-indexed, or made so) geometry with its triangles cut by planes across one axis
// of the frame `at` maps its vertices into (every attribute interpolated), those whose middle is
// near enough a region `keep` says.
export function toonSlice(g: THREE.BufferGeometry, at: (i: number, out: THREE.Vector3) => THREE.Vector3, axis: 0 | 1 | 2, cuts: number[], keep: (c: THREE.Vector3) => boolean): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g, names = Object.keys(src.attributes);
  const attrs = names.map((n) => src.getAttribute(n) as THREE.BufferAttribute), sizes = attrs.map((a) => a.itemSize);
  const out: number[][] = names.map(() => []);
  type V = { t: number; a: number[] };
  const tmp = new THREE.Vector3(), c = new THREE.Vector3();
  const vert = (i: number): V => {
    const a: number[] = [];
    attrs.forEach((A, j) => { for (let k = 0; k < sizes[j]; k++) a.push(A.getComponent(i, k)); });
    return { t: at(i, tmp).getComponent(axis), a };
  };
  const lerp = (p: V, q: V, t: number): V => { const f = (t - p.t) / (q.t - p.t); return { t, a: p.a.map((v, i) => v + (q.a[i] - v) * f) }; };
  const clip = (poly: V[], t: number, above: boolean) => {
    const r: V[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], pin = above ? p.t >= t : p.t <= t, qin = above ? q.t >= t : q.t <= t;
      if (pin) r.push(p);
      if (pin !== qin) r.push(lerp(p, q, t));
    }
    return r;
  };
  const emit = (v: V) => { let o = 0; sizes.forEach((n, j) => { for (let k = 0; k < n; k++) out[j].push(v.a[o + k]); o += n; }); };
  const count = src.getAttribute("position").count;
  const sorted = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i + 2 < count; i += 3) {
    const tri = [vert(i), vert(i + 1), vert(i + 2)];
    c.set(0, 0, 0); for (let k = 0; k < 3; k++) c.add(at(i + k, tmp)); c.multiplyScalar(1 / 3);
    const lo = Math.min(tri[0].t, tri[1].t, tri[2].t), hi = Math.max(tri[0].t, tri[1].t, tri[2].t);
    const inside = keep(c) ? sorted.filter((t) => t > lo + 1e-4 && t < hi - 1e-4) : [];
    if (!inside.length) { tri.forEach(emit); continue; }
    const bounds = [lo, ...inside, hi];
    for (let s = 0; s + 1 < bounds.length; s++) {
      const poly = clip(clip(tri, bounds[s], true), bounds[s + 1], false);
      for (let j = 1; j + 1 < poly.length; j++) { emit(poly[0]); emit(poly[j]); emit(poly[j + 1]); }
    }
  }
  const r = new THREE.BufferGeometry();
  names.forEach((n, j) => r.setAttribute(n, new THREE.BufferAttribute(new Float32Array(out[j]), sizes[j])));
  r.computeBoundingSphere();
  if (src !== g) src.dispose();
  return r;
}

// Flat normals of a non-indexed triangle list's positions (into `out`; where a triangle has
// shrunk to nothing, `fallback`'s).
export function faceNormals(pos: Float32Array, fallback: ArrayLike<number>, out: Float32Array) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i + 8 < pos.length; i += 9) {
    a.set(pos[i + 3] - pos[i], pos[i + 4] - pos[i + 1], pos[i + 5] - pos[i + 2]);
    b.set(pos[i + 6] - pos[i], pos[i + 7] - pos[i + 1], pos[i + 8] - pos[i + 2]);
    c.crossVectors(a, b);
    const l = c.length();
    for (let k = 0; k < 3; k++) {
      const o = i + k * 3;
      if (l > 1e-10) { out[o] = c.x / l; out[o + 1] = c.y / l; out[o + 2] = c.z / l; }
      else { out[o] = fallback[o]; out[o + 1] = fallback[o + 1]; out[o + 2] = fallback[o + 2]; }
    }
  }
  return out;
}
