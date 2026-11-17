// Routes on the street grid, and the drivable path built from them.
//
// Grid: node (ix, iz) is the intersection centred at (ix*60 + 9, iz*60 + 9). Directions are
// 0 east (+x), 1 north (-z), 2 west (-x), 3 south (+z); heading = dir * pi/2, and forward is
// (cos h, -sin h) to match Truck. Traffic keeps right; lane centres sit 1.5 m (inner) and 4.5 m
// (kerb) right of the centre line.
//
// A route starts on an edge, `before` metres short of node (ix, iz) while heading `dir`, makes
// one move per node it reaches (S straight, L left, R right) and ends `after` metres past the
// node of its last move. The path is a chain of line pieces (with smooth lane changes) and
// quarter-circle turns, parameterised by distance s. The truck's rear axle rides on it.
// Turns are sized for a 26 ft box truck's rear axle: right turns swing kerb lane to kerb lane at
// r = 6.5 m (the rear axle passing 4.3 m from the kerb corner), left turns inner lane to inner
// lane at r = 9 m. Between turns a line keeps to the kerb lane, unless both of its ends are in
// the inner lane (out of a left and into another): then it stays there rather than weave out and
// back. The journey ignores traffic, so a right turn never waits for a clear kerb lane: traffic
// gets out of the truck's way instead (traffic.ts).
import type { SignalAxis } from "./signals.ts";
import { BLOCK, STREET } from "./grid.ts";

export type Move = "S" | "L" | "R";
export const DIR_X = [1, 0, -1, 0], DIR_Z = [0, -1, 0, 1];
export const nodeX = (ix: number) => ix * BLOCK + STREET / 2;
export const nodeZ = (iz: number) => iz * BLOCK + STREET / 2;
export const turnDir = (d: number, m: Move) => (m === "L" ? (d + 1) % 4 : m === "R" ? (d + 3) % 4 : d);

export const LANE_KERB = 4.5, LANE_INNER = 1.5;
const R_RIGHT = 6.5, R_LEFT = 9;
const EXT_IN = { R: LANE_KERB + R_RIGHT, L: R_LEFT - LANE_INNER };   // turn start, before the node centre
const EXT_OUT = { R: LANE_KERB + R_RIGHT, L: R_LEFT - LANE_INNER };   // turn end, past the node centre
const OFF_IN = { R: LANE_KERB, L: LANE_INNER }, OFF_OUT = { R: LANE_KERB, L: LANE_INNER };
// A lane change: at most LANE_CHANGE metres, and at most LANE_CHANGE_SHARE of its line. The rest
// of the line is split between a run out of the turn before it (LANE_HOLD) and a settled run in
// the new lane before the turn or stop after it (LANE_LEAD), in that proportion when short.
const LANE_CHANGE = 26, LANE_CHANGE_SHARE = 0.75, LANE_HOLD = 12, LANE_LEAD = 15;
const LANE_LAT_ACCEL = 2.5;  // m/s^2 at the sharpest point of a lane change
const SPEED_RIGHT = 4.2, SPEED_LEFT = 5.2, DOCK_TURN_SPEED = 2.6;

// `dock`: the route starts in a loading bay instead (journey.ts): a straight line out of the bay
// from (x, z) on heading H for Lb metres, then a right turn of radius R onto the kerb lane,
// which arrives exactly at the edge position (ix, iz, dir, before).
export interface DockGeom { x: number; z: number; H: number; Lb: number; R: number; door?: DockDoor }
// The bay's roll-up door in world space (centre of its foot on the wall, half-width, height) and
// the leveller lip's hinge at the platform edge: what DockFx opens and lowers.
export interface DockDoor { x: number; z: number; w: number; h: number; lx: number; lz: number }
export interface Route { ix: number; iz: number; dir: number; before: number; moves: string; after: number; dock?: DockGeom; garageIn?: boolean; garageOut?: GarageGeom }

// A parking garage's rooftop stop (facilities.ts "garage", garage.ts builds it): from the kerb
// lane a right turn into the block, a ramp up along its side, a left turn onto the level lane
// across the back of the roof, where the truck stops (`garageIn`, appended to the route). The way
// out (`garageOut`, from the stop at x, z on heading h) carries on along the roof, turns left
// down the far side's ramp and turns left out across the street, into the kerb lane back the
// way the truck came. Each step goes on from where the last ended.
export const GARAGE_H = 4.8;
// `helix`: a freeway's off-ramp instead (interchange.ts), from its right-hand lane at the deck's
// height: out across a deceleration lane that peels off the deck to the right (where it starts
// down), round three-quarters of a loop down into the block beside, a right turn at its foot onto
// a lane along the block just behind the sidewalk, and a taper from it across the kerb cut into
// the street's kerb lane beneath the freeway (a slip-lane merge).
export const HELIX_TOP = 9.6;   // (freeway.ts FW_TOP)
export interface GarageGeom { x: number; z: number; h: number; kind?: "helix" }
type TailStep = { turn: number; sgn: 1 | -1; v: number } | { line: number; v: number; shift?: number };
const GARAGE_IN: TailStep[] = [{ turn: 7, sgn: -1, v: 2.8 }, { line: 26.5, v: 3.4 }, { turn: 7, sgn: 1, v: 2.6 }, { line: 3, v: 2.5 }];
const GARAGE_OUT: TailStep[] = [{ line: 9, v: 3 }, { turn: 7, sgn: 1, v: 2.6 }, { line: 33.5, v: 3.4 }, { turn: 9, sgn: 1, v: 3 }];
export const OFFRAMP_SHIFT = 7.6, OFFRAMP_LEN = 80, OFFRAMP_R = 17.5;
const HELIX_Q: TailStep = { turn: OFFRAMP_R, sgn: -1, v: 6 };
const HELIX_OUT: TailStep[] = [{ line: OFFRAMP_LEN, v: 11, shift: OFFRAMP_SHIFT }, HELIX_Q, HELIX_Q, HELIX_Q, { line: 8.5, v: 5 }, { turn: 8, sgn: -1, v: 4 }, { line: 24, v: 5, shift: -9.5 }];
// (Down from 70% of the way out across the deceleration lane, once it is clear of the deck, to
// the foot of the loop's way out.)
const HELIX_RAMP = [0, 5, 0.7];
// Where on the way in the ramp rises (from the start of step 1 to the end of step 2), and where on
// the way out it comes down.
const GARAGE_IN_RAMP = [1, 2], GARAGE_OUT_RAMP = [1, 2];
// A ramp's height profile: a steady slope, eased in and out over its ends.
function rampProfile(u: number) {
  const e = 0.15, m = 1 / (1 - e), x = Math.min(Math.max(u, 0), 1);
  return x < e ? m * x * x / (2 * e) : x > 1 - e ? 1 - m * (1 - x) * (1 - x) / (2 * e) : m * (x - e / 2);
}

// A line holds lane offset o0, changes to o1 over [c0, c0 + tc] (tc 0: no change), then holds it.
interface LinePiece { kind: "line"; s0: number; len: number; x0: number; z0: number; dir: number; o0: number; o1: number; c0: number; tc: number; vmax?: number }
// A 90-degree turn: easement spiral, circular arc, easement spiral, so the curvature (and the
// front wheels) build up and wind off smoothly instead of snapping at the turn's ends. `sc` is
// metres per unit of TURN_UNIT, `sgn` +1 for left, -1 for right.
interface ArcPiece { kind: "arc"; s0: number; len: number; x0: number; z0: number; h0: number; sc: number; sgn: number; vmax: number }
type Piece = LinePiece | ArcPiece;
interface SignalPoint { ix: number; iz: number; axis: SignalAxis; sLine: number; move: Move }
export interface Pose { x: number; z: number; h: number; k: number }

// Lane changes follow a quintic smoothstep: offset, slope and curvature all start and end at
// zero, so there is no kink where a lane change meets a turn or a straight.
export const smooth = (u: number) => u * u * u * (10 + u * (6 * u - 15));
export const smoothD = (u: number) => 30 * u * u * (1 - u) * (1 - u);
const smoothDD = (u: number) => 60 * u * (1 - u) * (1 - 2 * u);
const SMOOTH_DD_MAX = 10 / Math.sqrt(3);   // peak |smoothDD|

// The unit turn: peak curvature 1, each spiral turning TURN_SPIRAL of the 90 degrees. Tabulated
// once (position in the turn's own frame: x forward, y left); a turn of corner distance T (from
// where it starts to the corner of its two straight lines) is this scaled by T / TURN_UNIT.T.
const TURN_SPIRAL = 22 * Math.PI / 180;
const TURN_UNIT = (() => {
  const ls = 2 * TURN_SPIRAL, arc = Math.PI / 2 - 2 * TURN_SPIRAL, len = 2 * ls + arc, N = 2048;
  const hAt = (u: number) => u < ls ? u * u / (2 * ls) : u <= ls + arc ? ls / 2 + (u - ls) : Math.PI / 2 - (len - u) * (len - u) / (2 * ls);
  const kAt = (u: number) => u < ls ? u / ls : u <= ls + arc ? 1 : (len - u) / ls;
  const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1);
  const sub = 16, du = len / (N * sub);
  let x = 0, y = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < sub; j++) { const h = hAt((i * sub + j + 0.5) * du); x += Math.cos(h) * du; y += Math.sin(h) * du; }
    xs[i + 1] = x; ys[i + 1] = y;
  }
  return { len, N, xs, ys, hAt, kAt, T: x };   // symmetric: the exit's distance to the corner is y = x
})();
function turnPiece(s0: number, x0: number, z0: number, h0: number, T: number, sgn: number, vmax: number): ArcPiece {
  const sc = T / TURN_UNIT.T;
  // Same peak sideways pull as a plain arc of radius T at vmax.
  return { kind: "arc", s0, len: TURN_UNIT.len * sc, x0, z0, h0, sc, sgn, vmax: vmax * Math.sqrt(sc / T) };
}

export class Path {
  readonly pieces: Piece[] = [];
  readonly signals: SignalPoint[] = [];
  readonly turns: { s: number; dir: -1 | 1 }[] = [];  // turn starts, for indicators
  length = 0;
  private cursor = 0;
  // Ramps (a garage's): height y0 at s0 to y1 at s1; level elsewhere, at the last one's end.
  readonly ramps: { s0: number; s1: number; y0: number; y1: number }[] = [];

  // Steps from (x, z) on heading h, from the end of the path so far; the ramp over steps r0..r1
  // goes from y0 to y1.
  private tail(steps: TailStep[], x: number, z: number, h: number, ramp: number[], y0: number, y1: number) {
    let rs0 = 0, rs1 = 0;
    steps.forEach((st, i) => {
      if (i === ramp[0]) rs0 = this.length + ("line" in st ? st.line * (ramp[2] ?? 0) : 0);
      if ("turn" in st) {
        this.turns.push({ s: this.length, dir: st.sgn > 0 ? -1 : 1 });
        const tp = turnPiece(this.length, x, z, h, st.turn, st.sgn, st.v);
        this.pieces.push(tp); this.length += tp.len;
        x += Math.cos(h) * st.turn - Math.sin(h) * st.turn * st.sgn;
        z += -Math.sin(h) * st.turn - Math.cos(h) * st.turn * st.sgn;
        h += st.sgn * Math.PI / 2;
      } else {
        const d = ((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4;
        const sh = st.shift ?? 0;
        this.pieces.push({ kind: "line", s0: this.length, len: st.line, x0: x, z0: z, dir: d, o0: 0, o1: sh, c0: 0, tc: sh ? st.line : 0, vmax: st.v });
        this.length += st.line;
        x += Math.cos(h) * st.line + Math.sin(h) * sh; z += -Math.sin(h) * st.line + Math.cos(h) * sh;
      }
      if (i === ramp[1]) rs1 = this.length;
    });
    this.ramps.push({ s0: rs0, s1: rs1, y0, y1 });
    return { x, z, h };
  }
  // The height of the path at s (0 but on a garage's ramps and roof), and its grade.
  yAt(s: number) {
    if (!this.ramps.length) return 0;
    let y = this.ramps[0].y0;
    for (const r of this.ramps) {
      if (s <= r.s0) break;
      if (s >= r.s1) { y = r.y1; continue; }
      return r.y0 + (r.y1 - r.y0) * rampProfile((s - r.s0) / (r.s1 - r.s0));
    }
    return y;
  }
  gradeAt(s: number) { return this.ramps.length ? (this.yAt(s + 1) - this.yAt(s - 1)) / 2 : 0; }
  // Just a garage's way in (from the kerb lane at x, z on heading h) or out (from the stop): for
  // drawing its ramps (garage.ts).
  static garageTrack(out: boolean, x: number, z: number, h: number, kind?: "helix"): Path {
    const p = new Path({ ix: 0, iz: 0, dir: 0, before: 0, moves: "", after: 0, garageOut: out ? { x, z, h, kind } : undefined }, true);
    if (!out) p.tail(GARAGE_IN, x, z, h, GARAGE_IN_RAMP, 0, GARAGE_H);
    return p;
  }

  constructor(readonly route: Route, trackOnly = false) {
    let d = route.dir;
    let nx = route.ix, nz = route.iz;                    // the node being approached
    let lx = nodeX(nx) - DIR_X[d] * route.before, lz = nodeZ(nz) - DIR_Z[d] * route.before; // current leg start
    let lo = LANE_KERB, legS = 0;
    let lastX = nx, lastZ = nz;
    if (route.dock) {
      // Out of the bay. Line pieces ride LANE_KERB to the right of their reference line, so the
      // reference is shifted left to put the path on the bay's centreline.
      const k = route.dock, sh = Math.sin(k.H), ch = Math.cos(k.H);
      const bayDir = Math.round(k.H / (Math.PI / 2)) % 4;
      this.pieces.push({ kind: "line", s0: 0, len: k.Lb, x0: k.x - sh * LANE_KERB, z0: k.z - ch * LANE_KERB, dir: bayDir, o0: LANE_KERB, o1: LANE_KERB, c0: 0, tc: 0 });
      this.length = k.Lb;
      this.turns.push({ s: this.length, dir: 1 });
      const tp = turnPiece(this.length, k.x + ch * k.Lb, k.z - sh * k.Lb, k.H, k.R, -1, DOCK_TURN_SPEED);
      this.pieces.push(tp);
      this.length += tp.len;
      legS = this.length;
    }
    if (route.garageOut) {
      // Down out of a garage: the route starts at its rooftop stop.
      const g = route.garageOut;
      if (g.kind === "helix") this.tail(HELIX_OUT, g.x, g.z, g.h, HELIX_RAMP, HELIX_TOP, 0);
      else this.tail(GARAGE_OUT, g.x, g.z, g.h, GARAGE_OUT_RAMP, GARAGE_H, 0);
      legS = this.length;
      if (trackOnly) { this.endDir = 0; this.endNode = [0, 0]; return; }
    } else if (trackOnly) { this.endDir = 0; this.endNode = [0, 0]; return; }
    const pushLine = (ex: number, ez: number, o1: number) => {
      const len = Math.max(0, (ex - lx) * DIR_X[d] + (ez - lz) * DIR_Z[d]);
      // Only two lanes, so a line changes lane at most once: none when both ends share one.
      let c0 = 0, tc = 0;
      if (lo !== o1) {
        tc = Math.min(LANE_CHANGE, len * LANE_CHANGE_SHARE);
        // Out of a turn to the kerb: a run out of the turn first. Into the inner lane for a left
        // (no turn behind needs a run-out): as early as the settled run before the left allows.
        if (o1 === LANE_KERB) c0 = len - tc > LANE_HOLD + LANE_LEAD ? LANE_HOLD : (len - tc) * LANE_HOLD / (LANE_HOLD + LANE_LEAD);
        else c0 = Math.max(0, len - LANE_LEAD - tc);
      }
      this.pieces.push({ kind: "line", s0: this.length, len, x0: lx, z0: lz, dir: d, o0: lo, o1, c0, tc });
      this.length += len;
    };
    for (const ch of route.moves) {
      const m = ch as Move;
      // Signal at this node, on the approach: the stop line is 4.1 m before the intersection edge.
      const toNode = (nodeX(nx) - lx) * DIR_X[d] + (nodeZ(nz) - lz) * DIR_Z[d];
      this.signals.push({ ix: nx, iz: nz, axis: (d % 2) as SignalAxis, sLine: legS + toNode - STREET / 2 - 4.1, move: m });
      lastX = nx; lastZ = nz;
      if (m !== "S") {
        const ext = EXT_IN[m], oIn = OFF_IN[m];
        const ex = nodeX(nx) - DIR_X[d] * ext, ez = nodeZ(nz) - DIR_Z[d] * ext;
        pushLine(ex, ez, oIn);
        const h0 = d * Math.PI / 2;
        const r = m === "L" ? R_LEFT : R_RIGHT;
        this.turns.push({ s: this.length, dir: m === "L" ? -1 : 1 });
        const tp = turnPiece(this.length, ex + Math.sin(h0) * oIn, ez + Math.cos(h0) * oIn, h0, r, m === "L" ? 1 : -1, m === "L" ? SPEED_LEFT : SPEED_RIGHT);
        this.pieces.push(tp);
        this.length += tp.len;
        d = turnDir(d, m);
        lx = nodeX(nx) + DIR_X[d] * EXT_OUT[m]; lz = nodeZ(nz) + DIR_Z[d] * EXT_OUT[m];
        lo = OFF_OUT[m]; legS = this.length;
      }
      nx += DIR_X[d]; nz += DIR_Z[d];
    }
    // Final leg to the stop point, `after` metres past the last move's node.
    pushLine(nodeX(lastX) + DIR_X[d] * route.after, nodeZ(lastZ) + DIR_Z[d] * route.after, LANE_KERB);
    this.endDir = d; this.endNode = [lastX, lastZ];
    if (route.garageIn) {
      // On into a garage and up onto its roof, from the kerb lane where the street leg ends.
      const h = d * Math.PI / 2, ex = nodeX(lastX) + DIR_X[d] * route.after + Math.sin(h) * LANE_KERB, ez = nodeZ(lastZ) + DIR_Z[d] * route.after + Math.cos(h) * LANE_KERB;
      this.tail(GARAGE_IN, ex, ez, h, GARAGE_IN_RAMP, 0, GARAGE_H);
    }
  }
  endDir: number; endNode: [number, number];

  private find(s: number): Piece {
    const p = this.pieces;
    if (s < p[this.cursor].s0) this.cursor = 0;
    while (this.cursor < p.length - 1 && s >= p[this.cursor].s0 + p[this.cursor].len) this.cursor++;
    return p[this.cursor];
  }

  // Lateral offset from the centre line at the last eval (traffic: NaN in a turn).
  lastOffset = LANE_KERB;

  eval(s: number, out: Pose): Pose {
    s = Math.min(Math.max(s, 0), this.length);
    const p = this.find(s);
    const u = s - p.s0;
    if (p.kind === "arc") {
      this.lastOffset = NaN;
      const U = TURN_UNIT, w = Math.min(Math.max(u / p.sc, 0), U.len);
      const f = (w / U.len) * U.N, i = Math.min(U.N - 1, Math.floor(f)), a = f - i;
      const fx = (U.xs[i] + (U.xs[i + 1] - U.xs[i]) * a) * p.sc, fy = (U.ys[i] + (U.ys[i + 1] - U.ys[i]) * a) * p.sc * p.sgn;
      const sh = Math.sin(p.h0), ch = Math.cos(p.h0);
      out.x = p.x0 + ch * fx - sh * fy;
      out.z = p.z0 - sh * fx - ch * fy;
      out.h = p.h0 + p.sgn * U.hAt(w); out.k = p.sgn * U.kAt(w) / p.sc;
      return out;
    }
    // Lane offset: o0, blending to o1 over [c0, c0 + tc].
    let o = u < p.c0 || p.tc <= 0 ? p.o0 : p.o1, od = 0, odd = 0;
    if (p.tc > 0 && u >= p.c0 && u <= p.c0 + p.tc) { const w = (u - p.c0) / p.tc, D = p.o1 - p.o0; o = p.o0 + D * smooth(w); od = D * smoothD(w) / p.tc; odd = D * smoothDD(w) / (p.tc * p.tc); }
    this.lastOffset = o;
    const h = p.dir * Math.PI / 2, sh = Math.sin(h), ch = Math.cos(h);
    out.x = p.x0 + ch * u + sh * o;
    out.z = p.z0 - sh * u + ch * o;
    out.h = h - Math.atan(od);
    out.k = -odd / Math.pow(1 + od * od, 1.5);
    return out;
  }

  // Speed limit at s from turns and lane changes ahead (braking at `brake` m/s^2), looking
  // `range` metres on. A lane change squeezed into a short leg is a sharp S-bend: its peak
  // curvature (SMOOTH_DD_MAX * offset / length^2 for the smoothstep) is held to LANE_LAT_ACCEL.
  speedLimit(s: number, brake: number, range = 70): number {
    let v = Infinity;
    const limit = (r0: number, r1: number, vmax: number) => {
      if (r1 < s || r0 > s + range) return;
      v = Math.min(v, Math.sqrt(vmax * vmax + 2 * brake * Math.max(0, r0 - s)));
    };
    for (const p of this.pieces) {
      if (p.s0 > s + range) break;
      if (p.kind === "arc") { limit(p.s0, p.s0 + p.len, p.vmax); continue; }
      if (p.tc > 0) limit(p.s0 + p.c0, p.s0 + p.c0 + p.tc, Math.sqrt(LANE_LAT_ACCEL * p.tc * p.tc / (SMOOTH_DD_MAX * Math.abs(p.o1 - p.o0))));
      if (p.vmax !== undefined) limit(p.s0, p.s0 + p.len, p.vmax);
    }
    return v;
  }
}

// ---- planner --------------------------------------------------------------------------------
// A goal is an edge to stop on: leave node (ix, iz) heading `dir`, stop `after` metres on.
// `straight`: reach it by going straight through the node, so the whole final leg is in the
// kerb lane (truck swaps park two vehicles nose to tail there).
export interface Goal { ix: number; iz: number; dir: number; after: number; straight?: boolean }
const TURN_COST: Record<Move, number> = { S: 0, R: 14, L: 26 };

// Cheapest route from the start edge to any goal (A* over node and heading; no U-turns).
// The first move is made at the node being approached, so a goal on the current edge is
// reached by going round the block.
// `ok`: whether the street leaving a node in a direction may be driven (the city's limits).
export function planRoute(ix: number, iz: number, dir: number, before: number, goals: Goal[], maxExpand = 6000, ok: ((ix: number, iz: number, dir: number) => boolean) | null = null): Route | null {
  type State = { ix: number; iz: number; d: number; g: number; f: number; moves: string };
  const h = (x: number, z: number) => {
    let best = Infinity;
    for (const gl of goals) best = Math.min(best, (Math.abs(gl.ix - x) + Math.abs(gl.iz - z)) * BLOCK);
    return best;
  };
  const open: State[] = [{ ix, iz, d: dir, g: before, f: before + h(ix, iz), moves: "" }];
  const seen = new Map<string, number>();
  let expanded = 0;
  while (open.length && expanded++ < maxExpand) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const st = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    const key = `${st.ix},${st.iz},${st.d}`;
    if ((seen.get(key) ?? Infinity) <= st.g) continue;
    seen.set(key, st.g);
    for (const m of ["S", "R", "L"] as Move[]) {
      const nd = turnDir(st.d, m);
      for (const gl of goals)
        if (gl.ix === st.ix && gl.iz === st.iz && gl.dir === nd && (!gl.straight || m === "S")) {
          // Goal edges are checked when popped, so the first one found is the cheapest.
          return { ix, iz, dir, before, moves: st.moves + m, after: gl.after };
        }
      if (ok && !ok(st.ix, st.iz, nd)) continue;
      const nx = st.ix + DIR_X[nd], nz = st.iz + DIR_Z[nd];
      const g = st.g + BLOCK + TURN_COST[m];
      open.push({ ix: nx, iz: nz, d: nd, g, f: g + h(nx, nz), moves: st.moves + m });
    }
  }
  return null;
}

// The four kerbside goals beside block (bx, bz), each with the block on the truck's right.
export function blockGoals(bx: number, bz: number, after: number, straight = false): Goal[] {
  return [
    { ix: bx, iz: bz, dir: 0, after, straight },          // north side, heading east
    { ix: bx + 1, iz: bz + 1, dir: 2, after, straight },  // south side, heading west
    { ix: bx, iz: bz + 1, dir: 1, after, straight },      // west side, heading north
    { ix: bx + 1, iz: bz, dir: 3, after, straight },      // east side, heading south
  ];
}
