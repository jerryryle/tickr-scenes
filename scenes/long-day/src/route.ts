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
// Turns are sized for a 26 ft box truck's rear axle: right turns run kerb lane to inner lane at
// r = 6.5 m (clearing the kerb corner by about a metre), left turns inner lane to inner lane at
// r = 9 m. Lines then merge back to the kerb lane.
import type { SignalAxis } from "./signals.ts";
import { BLOCK, STREET } from "./grid.ts";

export type Move = "S" | "L" | "R";
export const DIR_X = [1, 0, -1, 0], DIR_Z = [0, -1, 0, 1];
export const nodeX = (ix: number) => ix * BLOCK + STREET / 2;
export const nodeZ = (iz: number) => iz * BLOCK + STREET / 2;
export const turnDir = (d: number, m: Move) => (m === "L" ? (d + 1) % 4 : m === "R" ? (d + 3) % 4 : d);

export const LANE_KERB = 4.5, LANE_INNER = 1.5;
const R_RIGHT = 6.5, R_LEFT = 9;
const EXT_IN = { R: LANE_INNER + R_RIGHT, L: R_LEFT - LANE_INNER };   // turn start, before the node centre
const EXT_OUT = { R: LANE_KERB + R_RIGHT, L: R_LEFT - LANE_INNER };   // turn end, past the node centre
const OFF_IN = { R: LANE_KERB, L: LANE_INNER }, OFF_OUT = { R: LANE_INNER, L: LANE_INNER };
const LANE_CHANGE = 18;  // metres for a lane change
const LANE_LAT_ACCEL = 2.5;  // m/s^2 at the sharpest point of a lane change
const SPEED_RIGHT = 4.2, SPEED_LEFT = 5.2, DOCK_TURN_SPEED = 2.6;

// `dock`: the route starts in a loading bay instead (journey.ts): a straight line out of the bay
// from (x, z) on heading H for Lb metres, then a right turn of radius R onto the kerb lane,
// which arrives exactly at the edge position (ix, iz, dir, before).
export interface DockGeom { x: number; z: number; H: number; Lb: number; R: number; door?: DockDoor }
// The bay's roll-up door in world space (centre of its foot on the wall, half-width, height) and
// the leveller lip's hinge at the platform edge: what DockFx opens and lowers.
export interface DockDoor { x: number; z: number; w: number; h: number; lx: number; lz: number }
export interface Route { ix: number; iz: number; dir: number; before: number; moves: string; after: number; dock?: DockGeom }

interface LinePiece { kind: "line"; s0: number; len: number; x0: number; z0: number; dir: number; o0: number; o1: number; t0: number; t1: number }
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

  constructor(readonly route: Route) {
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
      this.pieces.push({ kind: "line", s0: 0, len: k.Lb, x0: k.x - sh * LANE_KERB, z0: k.z - ch * LANE_KERB, dir: bayDir, o0: LANE_KERB, o1: LANE_KERB, t0: 0, t1: 0 });
      this.length = k.Lb;
      this.turns.push({ s: this.length, dir: 1 });
      const tp = turnPiece(this.length, k.x + ch * k.Lb, k.z - sh * k.Lb, k.H, k.R, -1, DOCK_TURN_SPEED);
      this.pieces.push(tp);
      this.length += tp.len;
      legS = this.length;
    }
    const pushLine = (ex: number, ez: number, o1: number) => {
      const len = Math.max(0, (ex - lx) * DIR_X[d] + (ez - lz) * DIR_Z[d]);
      const t0 = lo !== LANE_KERB ? Math.min(LANE_CHANGE, len / 2) : 0, t1 = o1 !== LANE_KERB ? Math.min(LANE_CHANGE, len / 2) : 0;
      this.pieces.push({ kind: "line", s0: this.length, len, x0: lx, z0: lz, dir: d, o0: lo, o1, t0, t1 });
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
    // Lane offset: o0 blends to the kerb lane over t0, then to o1 over the last t1 metres.
    let o = LANE_KERB, od = 0, odd = 0;
    if (p.t0 > 0 && u < p.t0) { const w = u / p.t0; o = p.o0 + (LANE_KERB - p.o0) * smooth(w); od = (LANE_KERB - p.o0) * smoothD(w) / p.t0; odd = (LANE_KERB - p.o0) * smoothDD(w) / (p.t0 * p.t0); }
    else if (p.t1 > 0 && u > p.len - p.t1) { const w = (u - (p.len - p.t1)) / p.t1; o = LANE_KERB + (p.o1 - LANE_KERB) * smooth(w); od = (p.o1 - LANE_KERB) * smoothD(w) / p.t1; odd = (p.o1 - LANE_KERB) * smoothDD(w) / (p.t1 * p.t1); }
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
      if (p.t0 > 0) limit(p.s0, p.s0 + p.t0, Math.sqrt(LANE_LAT_ACCEL * p.t0 * p.t0 / (SMOOTH_DD_MAX * Math.abs(LANE_KERB - p.o0))));
      if (p.t1 > 0) limit(p.s0 + p.len - p.t1, p.s0 + p.len, Math.sqrt(LANE_LAT_ACCEL * p.t1 * p.t1 / (SMOOTH_DD_MAX * Math.abs(p.o1 - LANE_KERB))));
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
