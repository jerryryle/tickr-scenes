// Routes on the city's street graph (citygraph.ts), and the drivable path built from them.
//
// Headings: forward is (cos h, -sin h) to match Truck; h grows turning left. Traffic keeps right;
// lane centres sit 1.5 m (inner) and 4.5 m (kerb) right of a street's centre line. Streets are
// straight (a curving road is a chain of them, joined at bends).
//
// A route starts on a directed street (dedge) `d`, `before` metres short of the node it runs to,
// takes one dedge on at each node it reaches (`edges`) and ends `after` metres along the last one.
// The path is a chain of line pieces (with smooth lane changes) and turns, parameterised by
// distance s. The truck's rear axle rides on it. A turn is easement spiral, circular arc,
// easement spiral, through whatever angle the streets meet at. Right turns swing kerb lane to kerb
// lane on a corner radius of 6.5 m (the rear axle passing 4.3 m from a right-angled kerb corner),
// left turns inner lane to inner lane on 9 m; a bend where a street carries straight on at an
// angle keeps its lane, on a wide radius. Between turns a line keeps to the kerb lane, unless both
// of its ends are in the inner lane (out of a left and into another): then it stays there rather
// than weave out and back. The journey ignores traffic, so a right turn never waits for a clear
// kerb lane: traffic gets out of the truck's way instead (traffic.ts).
import type { CityGraph } from "./citygraph.ts";
import { angleDiff } from "./citygraph.ts";

export type Move = "S" | "L" | "R";
export const DIR_X = [1, 0, -1, 0], DIR_Z = [0, -1, 0, 1];

export const LANE_KERB = 4.5, LANE_INNER = 1.5;
const R_RIGHT = 6.5, R_LEFT = 9, R_BEND = 40;
// The stop line, short of where the street's mouth opens into the intersection: far enough
// back that a vehicle waiting there is clear of the truck's swing through a turn (city.ts paints
// it there).
export const STOP_BACK = 6.5;
// A lane change: at most LANE_CHANGE metres, and at most LANE_CHANGE_SHARE of its line. The rest
// of the line is split between a run out of the turn before it (LANE_HOLD) and a settled run in
// the new lane before the turn or stop after it (LANE_LEAD), in that proportion when short.
const LANE_CHANGE = 26, LANE_CHANGE_SHARE = 0.75, LANE_HOLD = 12, LANE_LEAD = 15;
const LANE_LAT_ACCEL = 2.5;  // m/s^2 at the sharpest point of a lane change
const MIN_CHANGE = 12;        // the shortest leg a lane change is made on
const SPEED_RIGHT = 4.2, SPEED_LEFT = 5.2, SPEED_BEND = 10, DOCK_TURN_SPEED = 2.6;

// `dock`: the route starts in a loading bay instead (journey.ts): a straight line out of the bay
// from (x, z) on heading H for Lb metres, then a right turn of radius R onto the kerb lane,
// which arrives exactly at the route's start (d, before).
export interface DockGeom { x: number; z: number; H: number; Lb: number; R: number; door?: DockDoor }
// The bay's roll-up door in world space (centre of its foot on the wall, half-width, height) and
// the leveller lip's hinge at the platform edge: what DockFx opens and lowers.
export interface DockDoor { x: number; z: number; w: number; h: number; lx: number; lz: number }
// `lane`: the lane it starts in (the kerb lane unless the last route ended in the inner one).
export interface Route { d: number; before: number; edges: number[]; after: number; lane?: number; dock?: DockGeom; garageIn?: boolean; garageOut?: GarageGeom }

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
// `slip`: a long slip ramp instead, where the blocks beside the freeway past the exit are one
// superblock (city.ts): the same deceleration lane, then straight on beside the freeway, coming
// down all the way on its own deck (about 7%), onto a lane behind the sidewalk and the same kind
// of taper into the kerb lane beneath the freeway, before the next intersection.
export type ExitKind = "helix" | "slip";
export interface GarageGeom { x: number; z: number; h: number; kind?: ExitKind }
type TailStep = { turn: number; sgn: 1 | -1; v: number } | { line: number; v: number; shift?: number };
const GARAGE_IN: TailStep[] = [{ turn: 7, sgn: -1, v: 2.8 }, { line: 26.5, v: 3.4 }, { turn: 7, sgn: 1, v: 2.6 }, { line: 3, v: 2.5 }];
const GARAGE_OUT: TailStep[] = [{ line: 9, v: 3 }, { turn: 7, sgn: 1, v: 2.6 }, { line: 33.5, v: 3.4 }, { turn: 9, sgn: 1, v: 3 }];
export const OFFRAMP_SHIFT = 7.6, OFFRAMP_LEN = 80, OFFRAMP_R = 17.5;
const HELIX_Q: TailStep = { turn: OFFRAMP_R, sgn: -1, v: 6 };
const HELIX_OUT: TailStep[] = [{ line: OFFRAMP_LEN, v: 11, shift: OFFRAMP_SHIFT }, HELIX_Q, HELIX_Q, HELIX_Q, { line: 8.5, v: 5 }, { turn: 8, sgn: -1, v: 4 }, { line: 24, v: 5, shift: -9.5 }];
// (Down from 70% of the way out across the deceleration lane, once it is clear of the deck, to
// the foot of the loop's way out.)
const HELIX_RAMP = [0, 5, 0.7];
// (Down from the same point on the deceleration lane to the end of the straight.)
export const SLIP_RUN = 111, SLIP_TAPER = 24, SLIP_SHIFT = -8.5;
const SLIP_OUT: TailStep[] = [{ line: OFFRAMP_LEN, v: 11, shift: OFFRAMP_SHIFT }, { line: SLIP_RUN, v: 11 }, { line: SLIP_TAPER, v: 7, shift: SLIP_SHIFT }];
const SLIP_RAMP = [0, 1, 0.65];
export const isExitKind = (k: string | undefined): k is ExitKind => k === "helix" || k === "slip";
// Where on the way in the ramp rises (from the start of step 1 to the end of step 2), and where on
// the way out it comes down.
const GARAGE_IN_RAMP = [1, 2], GARAGE_OUT_RAMP = [1, 2];
// A ramp's height profile: a steady slope, eased in and out over its ends.
function rampProfile(u: number) {
  const e = 0.15, m = 1 / (1 - e), x = Math.min(Math.max(u, 0), 1);
  return x < e ? m * x * x / (2 * e) : x > 1 - e ? 1 - m * (1 - x) * (1 - x) / (2 * e) : m * (x - e / 2);
}


// A line from (x0, z0) on heading h holds lane offset o0, changes to o1 over [c0, c0 + tc] (tc 0:
// no change), then holds it.
interface LinePiece { kind: "line"; s0: number; len: number; x0: number; z0: number; h: number; o0: number; o1: number; c0: number; tc: number; vmax?: number }
// A turn through `ang` (radians, > 0): easement spiral, circular arc, easement spiral, so the
// curvature (and the front wheels) build up and wind off smoothly instead of snapping at the
// turn's ends. `sc` is metres per unit of its unit turn, `sgn` +1 for left, -1 for right.
interface ArcPiece { kind: "arc"; s0: number; len: number; x0: number; z0: number; h0: number; sc: number; sgn: number; ang: number; vmax: number }
type Piece = LinePiece | ArcPiece;
// A signal on the way: the node, the phase its approach runs on, where its stop line is and the
// move made there.
export interface SignalPoint { node: number; phase: number; sLine: number; move: Move }
export interface Pose { x: number; z: number; h: number; k: number }

// Lane changes follow a quintic smoothstep: offset, slope and curvature all start and end at
// zero, so there is no kink where a lane change meets a turn or a straight.
export const smooth = (u: number) => u * u * u * (10 + u * (6 * u - 15));
export const smoothD = (u: number) => 30 * u * u * (1 - u) * (1 - u);
const smoothDD = (u: number) => 60 * u * (1 - u) * (1 - 2 * u);
const SMOOTH_DD_MAX = 10 / Math.sqrt(3);   // peak |smoothDD|

// The unit turn through `ang`: peak curvature 1, each spiral turning the same share of it as
// TURN_SPIRAL is of a right angle. Tabulated once per angle (position in the turn's own frame: x
// forward, y left); a turn of corner distance T (from where it starts to the corner of its two
// straight lines) is this scaled by T / unit.T.
const TURN_SPIRAL = 22 * Math.PI / 180;
interface TurnUnit { len: number; N: number; xs: Float64Array; ys: Float64Array; hAt: (u: number) => number; kAt: (u: number) => number; T: number }
const TURN_UNITS = new Map<number, TurnUnit>();
function turnUnit(ang: number): TurnUnit {
  const key = Math.round(ang * 1e6);
  const hit = TURN_UNITS.get(key);
  if (hit) return hit;
  const sp = TURN_SPIRAL * ang / (Math.PI / 2), ls = 2 * sp, arc = ang - 2 * sp, len = 2 * ls + arc, N = 2048;
  const hAt = (u: number) => u < ls ? u * u / (2 * ls) : u <= ls + arc ? ls / 2 + (u - ls) : ang - (len - u) * (len - u) / (2 * ls);
  const kAt = (u: number) => u < ls ? u / ls : u <= ls + arc ? 1 : (len - u) / ls;
  const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1);
  const sub = 16, du = len / (N * sub);
  let x = 0, y = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < sub; j++) { const h = hAt((i * sub + j + 0.5) * du); x += Math.cos(h) * du; y += Math.sin(h) * du; }
    xs[i + 1] = x; ys[i + 1] = y;
  }
  // The corner: where the start's line (y = 0) meets the end's (through (x, y) on heading ang).
  const u: TurnUnit = { len, N, xs, ys, hAt, kAt, T: x - y * Math.cos(ang) / Math.sin(ang) };
  TURN_UNITS.set(key, u);
  return u;
}
function turnPiece(s0: number, x0: number, z0: number, h0: number, T: number, sgn: number, vmax: number, ang = Math.PI / 2): ArcPiece {
  const U = turnUnit(ang), sc = T / U.T;
  // Same peak sideways pull as a plain arc of radius T at vmax (on a right angle; the unit turn's
  // peak curvature is 1 / sc whatever its angle).
  // (A turn squeezed tight, down to radius sc, also no faster than 1.1 sc m/s: the truck's heading
  // then turns at most 1.1 rad a second.)
  return { kind: "arc", s0, len: U.len * sc, x0, z0, h0, sc, sgn, ang, vmax: Math.min(vmax * Math.sqrt(sc / T), 1.1 * sc) };
}

export class Path {
  readonly pieces: Piece[] = [];
  readonly signals: SignalPoint[] = [];
  // Where the path enters a roundabout (a one-way ring at an unsignalled node): the node and the
  // give-way line on the approach.
  readonly yields: { node: number; sLine: number }[] = [];
  // Where the path comes to an all-way stop (a node whose control is "stop"): the node and its stop
  // line on the approach.
  readonly stops: { node: number; sLine: number }[] = [];
  // Every node the path goes through: its stop line on the approach, where the far mouth is
  // passed (roughly: straight across), and the dedges in and out.
  readonly nodes: { node: number; sLine: number; sOut: number; from: number; to: number; move: Move }[] = [];
  readonly turns: { s: number; dir: -1 | 1 }[] = [];  // turn starts, for indicators
  length = 0;
  dockOut = 0;   // (out of a bay: where its turn out joins the kerb lane; else 0)
  private cursor = 0;
  // Ramps (a garage's): height y0 at s0 to y1 at s1; level elsewhere, at the last one's end.
  readonly ramps: { s0: number; s1: number; y0: number; y1: number }[] = [];
  // The dedge the path ends on, how far along it (from the node it leaves), and in which lane.
  endEdge = -1; endA = 0; endLane = LANE_KERB;

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
        const sh = st.shift ?? 0;
        this.pieces.push({ kind: "line", s0: this.length, len: st.line, x0: x, z0: z, h, o0: 0, o1: sh, c0: 0, tc: sh ? st.line : 0, vmax: st.v });
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
  static garageTrack(out: boolean, x: number, z: number, h: number, kind?: ExitKind): Path {
    const p = new Path(null, { d: -1, before: 0, edges: [], after: 0, garageOut: out ? { x, z, h, kind } : undefined }, true);
    if (!out) p.tail(GARAGE_IN, x, z, h, GARAGE_IN_RAMP, 0, GARAGE_H);
    return p;
  }

  constructor(readonly graph: CityGraph | null, readonly route: Route, trackOnly = false) {
    if (route.dock) {
      // Out of the bay: a line on the bay's centreline, then a right turn onto the kerb lane.
      const k = route.dock, sh = Math.sin(k.H), ch = Math.cos(k.H);
      this.pieces.push({ kind: "line", s0: 0, len: k.Lb, x0: k.x, z0: k.z, h: k.H, o0: 0, o1: 0, c0: 0, tc: 0 });
      this.length = k.Lb;
      this.turns.push({ s: this.length, dir: 1 });
      const tp = turnPiece(this.length, k.x + ch * k.Lb, k.z - sh * k.Lb, k.H, k.R, -1, DOCK_TURN_SPEED);
      this.pieces.push(tp);
      this.length += tp.len;
      this.dockOut = this.length;
    }
    if (route.garageOut) {
      // Down out of a garage: the route starts at its rooftop stop.
      const g = route.garageOut;
      if (g.kind === "helix") this.tail(HELIX_OUT, g.x, g.z, g.h, HELIX_RAMP, HELIX_TOP, 0);
      else if (g.kind === "slip") this.tail(SLIP_OUT, g.x, g.z, g.h, SLIP_RAMP, HELIX_TOP, 0);
      else this.tail(GARAGE_OUT, g.x, g.z, g.h, GARAGE_OUT_RAMP, GARAGE_H, 0);
    }
    if (trackOnly || !this.graph) return;
    const G = this.graph;
    // The current leg: a straight line through (lx, lz) (on the centre line) on heading lh, from
    // `legS`, in lane `lo`; d is the dedge it is on.
    let d = route.d, legS = this.length, lo = route.lane ?? LANE_KERB;
    const st0 = G.streets[d >> 1], P0 = G.facePt(d, st0.len - route.before, -st0.half);
    let lx = P0.x, lz = P0.z, lh = P0.h;
    const along = (x: number, z: number) => (x - lx) * Math.cos(lh) - (z - lz) * Math.sin(lh);
    const pushLine = (len: number, o1: number) => {
      len = Math.max(0, len);
      // (A lane change needs room: on a leg too short for one, it stays in its lane.)
      if (len < MIN_CHANGE) o1 = lo;
      // Only two lanes, so a line changes lane at most once: none when both ends share one.
      let c0 = 0, tc = 0;
      if (lo !== o1) {
        tc = Math.min(LANE_CHANGE, len * LANE_CHANGE_SHARE);
        // Out of a turn to the kerb: a run out of the turn first. Into the inner lane for a left
        // (no turn behind needs a run-out): as early as the settled run before the left allows.
        if (o1 === LANE_KERB) c0 = len - tc > LANE_HOLD + LANE_LEAD ? LANE_HOLD : (len - tc) * LANE_HOLD / (LANE_HOLD + LANE_LEAD);
        else c0 = Math.max(0, len - LANE_LEAD - tc);
      }
      this.pieces.push({ kind: "line", s0: this.length, len, x0: lx, z0: lz, h: lh, o0: lo, o1, c0, tc });
      this.length += len;
      lo = o1;
    };
    for (let ei = 0; ei < route.edges.length; ei++) {
      const e = route.edges[ei], N = G.dedgeTo(d), node = G.nodes[N], hin = G.dedgeEndH(d), hout = G.dedgeStartH(e);
      const turn = angleDiff(hout - hin), ang = Math.abs(turn);
      // (Round a roundabout's ring, one-way street to one-way street, a bend: straight on.)
      const m: Move = ang < Math.PI / 4 || (G.streets[d >> 1].ring && G.streets[e >> 1].ring) ? "S" : turn > 0 ? "L" : "R";
      // Signal at this node, on the approach: STOP_BACK short of the street's mouth.
      const ai = G.armIndexIn(d);
      const toNode = along(node.x, node.z);
      if (node.control === "signal") this.signals.push({ node: N, phase: node.phaseOf[ai], sLine: legS + toNode - node.arms[ai].mouth - STOP_BACK, move: m });
      else if (node.control === "stop") this.stops.push({ node: N, sLine: legS + toNode - node.arms[ai].mouth - STOP_BACK });
      // (Its give-way line is the street's painted stop line, STOP_BACK short of the mouth: behind the
      // crosswalk, not on it.)
      else if (G.streets[e >> 1].ring && !G.streets[d >> 1].ring) this.yields.push({ node: N, sLine: legS + toNode - node.arms[ai].mouth - STOP_BACK });
      this.nodes.push({ node: N, sLine: legS + toNode - node.arms[ai].mouth - STOP_BACK, sOut: legS + toNode + G.armOut(e).mouth, from: d, to: e, move: m });
      // Straight on along the same line (or near enough): the leg carries on.
      if (ang < 1e-4) { d = e; continue; }
      // The turn's lane: the kerb lane for a right, the inner for a left, the lane it is in for a
      // bend; but where the leg is too short to change lanes on (between close turns), the lane
      // it is in. The corner for lane o: where the incoming lane's line meets the outgoing one's
      // (u along the incoming lane from abreast of the node to it). The turn starts T before it
      // and ends T after.
      const fi = [Math.cos(hin), -Math.sin(hin)], fo = [Math.cos(hout), -Math.sin(hout)];
      const den = fi[0] * fo[1] - fi[1] * fo[0];
      // (v: along the outgoing lane from abreast of the node to it.)
      const corner = (o: number) => {
        const ix = node.x + Math.sin(hin) * o, iz = node.z + Math.cos(hin) * o, ox = node.x + Math.sin(hout) * o, oz = node.z + Math.cos(hout) * o;
        const uu = ((ox - ix) * fo[1] - (oz - iz) * fo[0]) / den, cx = ix + fi[0] * uu, cz = iz + fi[1] * uu;
        return { u: uu, v: (cx - ox) * fo[0] + (cz - oz) * fo[1], cx, cz };
      };
      const R = m === "R" ? R_RIGHT : m === "L" ? R_LEFT : R_BEND;
      let oIn = m === "R" ? LANE_KERB : m === "L" ? LANE_INNER : lo;
      if (oIn !== lo && toNode + corner(oIn).u - R * Math.tan(ang / 2) < MIN_CHANGE) oIn = lo;
      // (The last turn, a left from the kerb lane with too little room after it to move back to
      // the kerb before the stop: taken wide, into the kerb lane, so the stop is at the kerb.)
      if (ei === route.edges.length - 1 && oIn === LANE_INNER && lo === LANE_KERB && route.after - corner(oIn).v - R * Math.tan(ang / 2) < MIN_CHANGE) oIn = LANE_KERB;
      const oOut = oIn, { u, v, cx, cz } = corner(oIn);
      // (Where streets are short and turns close together, a turn tightens to fit the room it has:
      // the leg behind it, half the way to the next turn's corner (past any nodes it goes straight
      // on through), the way to the stop after the last. Its neighbours then never overlap it.)
      let room = NaN, run = 0, ej = e;
      for (let k = ei + 1; k < route.edges.length; k++) {
        const e2 = route.edges[k], N2 = G.nodes[G.dedgeTo(ej)], h1 = G.dedgeEndH(ej), h2 = G.dedgeStartH(e2), t2 = angleDiff(h2 - h1);
        run += G.faceLen(ej); ej = e2;
        if (Math.abs(t2) < 1e-4) continue;
        // (That turn's corner, in the lane it will take.)
        const o2 = Math.abs(t2) < Math.PI / 4 ? oOut : t2 > 0 ? LANE_INNER : LANE_KERB;
        const f1 = [Math.cos(h1), -Math.sin(h1)], f2 = [Math.cos(h2), -Math.sin(h2)], dn = f1[0] * f2[1] - f1[1] * f2[0];
        const ix2 = N2.x + Math.sin(h1) * o2, iz2 = N2.z + Math.cos(h1) * o2, ox2 = N2.x + Math.sin(h2) * o2, oz2 = N2.z + Math.cos(h2) * o2;
        const u2 = ((ox2 - ix2) * f2[1] - (oz2 - iz2) * f2[0]) / dn;
        room = (run + u2 - v) / 2;
        break;
      }
      if (Number.isNaN(room)) room = run + route.after - v - 0.5;   // (no turn left: on to the stop)
      const T = Math.min(R * Math.tan(ang / 2), Math.max(0.3, toNode + u), Math.max(0.3, room));
      pushLine(toNode + u - T, oIn);
      this.turns.push({ s: this.length, dir: m === "L" ? -1 : m === "R" ? 1 : (turn > 0 ? -1 : 1) });
      const sx = cx - fi[0] * T, sz = cz - fi[1] * T;
      const tp = turnPiece(this.length, sx, sz, hin, T, turn > 0 ? 1 : -1, m === "L" ? SPEED_LEFT : m === "R" ? SPEED_RIGHT : SPEED_BEND, ang);
      this.pieces.push(tp);
      this.length += tp.len;
      d = e; lo = oOut; legS = this.length;
      // The next leg starts on the outgoing street's centre line abreast of the turn's end.
      const ex = cx + fo[0] * T, ez = cz + fo[1] * T;
      lh = hout; lx = ex - Math.sin(hout) * oOut; lz = ez - Math.cos(hout) * oOut;
    }
    // Final leg to the stop point, `after` metres along the last dedge from the node it leaves.
    const stE = G.streets[d >> 1], PE = G.facePt(d, route.after, -stE.half);
    pushLine(along(PE.x, PE.z), LANE_KERB);
    this.endEdge = d; this.endA = route.after; this.endLane = lo;
    if (route.garageIn) {
      // On into a garage and up onto its roof, from the kerb lane where the street leg ends.
      const ex = PE.x + Math.sin(PE.h) * LANE_KERB, ez = PE.z + Math.cos(PE.h) * LANE_KERB;
      this.tail(GARAGE_IN, ex, ez, PE.h, GARAGE_IN_RAMP, 0, GARAGE_H);
    }
  }

  private find(s: number): Piece {
    const p = this.pieces;
    if (s < p[this.cursor].s0) this.cursor = 0;
    while (this.cursor < p.length - 1 && s >= p[this.cursor].s0 + p[this.cursor].len) this.cursor++;
    return p[this.cursor];
  }

  // Lateral offset from the centre line at the last eval (traffic: NaN in a turn), and the
  // street's heading there (a turn's at its start).
  lastOffset = LANE_KERB;
  lastLineH = 0;

  // eval, leaving the search cursor and lastOffset (which traffic reads) as they were: for
  // looking elsewhere along the path than where the truck is.
  peek(s: number, out: Pose): Pose {
    const cursor = this.cursor, lastOffset = this.lastOffset, lastLineH = this.lastLineH;
    this.eval(s, out);
    this.cursor = cursor; this.lastOffset = lastOffset; this.lastLineH = lastLineH;
    return out;
  }

  eval(s: number, out: Pose): Pose {
    s = Math.min(Math.max(s, 0), this.length);
    const p = this.find(s);
    const u = s - p.s0;
    if (p.kind === "arc") {
      this.lastOffset = NaN; this.lastLineH = p.h0;
      const U = turnUnit(p.ang), w = Math.min(Math.max(u / p.sc, 0), U.len);
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
    this.lastOffset = o; this.lastLineH = p.h;
    const sh = Math.sin(p.h), ch = Math.cos(p.h);
    out.x = p.x0 + ch * u + sh * o;
    out.z = p.z0 - sh * u + ch * o;
    out.h = p.h - Math.atan(od);
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
// A goal is a dedge to stop on: leave the node it starts from along it, stop `after` metres on.
// `straight`: reach it by going straight through that node, so the whole final leg is in the
// kerb lane (truck swaps park two vehicles nose to tail there).
export interface Goal { d: number; after: number; straight?: boolean }
const TURN_COST: Record<Move, number> = { S: 0, R: 14, L: 26 };

// Cheapest route from the start (dedge d, `before` metres short of its end) to any goal: A* over
// dedges (no U-turns), costed by length and turns. The first move is made at the node being
// approached, so a goal on the current dedge is reached by going round the block.
// `ok`: whether a dedge may be driven (the city's streets).
export function planRoute(G: CityGraph, d: number, before: number, goals: Goal[], maxExpand = 6000, ok: ((d: number) => boolean) | null = null): Route | null {
  type State = { d: number; g: number; f: number; edges: number[] };
  const goalPts = goals.map((gl) => G.nodes[G.dedgeFrom(gl.d)]);
  const h = (e: number) => {
    const n = G.nodes[G.dedgeTo(e)];
    let best = Infinity;
    for (const p of goalPts) best = Math.min(best, Math.hypot(p.x - n.x, p.z - n.z));
    return best;
  };
  const open: State[] = [{ d, g: before, f: before + h(d), edges: [] }];
  const seen = new Map<number, number>();
  let expanded = 0;
  while (open.length && expanded++ < maxExpand) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const st = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if ((seen.get(st.d) ?? Infinity) <= st.g) continue;
    seen.set(st.d, st.g);
    // (Moves in a fixed order, straight on first, then right, then left, as on the old grid.)
    const moves = G.movesFrom(st.d).sort((p, q) => MOVE_ORDER[p.move] - MOVE_ORDER[q.move] || p.turn - q.turn);
    for (const mv of moves) {
      for (const gl of goals)
        if (gl.d === mv.to && (!gl.straight || mv.move === "S")) {
          // Goal edges are checked when popped, so the first one found is the cheapest.
          return { d, before, edges: [...st.edges, mv.to], after: gl.after };
        }
      if (ok && !ok(mv.to)) continue;
      const g = st.g + G.streets[mv.to >> 1].len + TURN_COST[mv.move];
      open.push({ d: mv.to, g, f: g + h(mv.to), edges: [...st.edges, mv.to] });
    }
  }
  return null;
}
const MOVE_ORDER: Record<Move, number> = { S: 0, R: 1, L: 2 };

// The kerbside goals beside a block: one per face, each with the block on the truck's right.
export function blockGoals(G: CityGraph, block: number, after: number, straight = false): Goal[] {
  return G.blocks[block].faces.map((f) => ({ d: f, after, straight }));
}

// How wide a ramp's deck must be, either side of its track, for the biggest truck that uses it
// (a 26 ft box truck) to stay on it: its rear axle follows the track, so through a turn its front
// swings out wide and its back cuts in. Per sample of `step` metres along the track: the left
// edge's offset (negative) and the right's, at least `half` and with a margin, widened smoothly
// into and out of the turns (as real ramps are). In the track's own frame, so one per kind.
const SWEEPS = new Map<string, { l: number[]; r: number[] }>();
export function trackSweep(kind: "up" | "down" | ExitKind, half: number, step = 0.75): { l: number[]; r: number[] } {
  const key = `${kind}/${half}/${step}`, hit = SWEEPS.get(key);
  if (hit) return hit;
  const p = kind === "up" ? Path.garageTrack(false, 0, 0, 0) : Path.garageTrack(true, 0, 0, 0, isExitKind(kind) ? kind : undefined);
  const FRONT = 8.65, REAR = -2.7, HW = 1.32, MARGIN = 0.45, q = { x: 0, z: 0, h: 0, k: 0 };
  const S: { x: number; z: number; rx: number; rz: number }[] = [];
  for (let s = 0; s <= p.length + 1e-6; s += step) { p.eval(Math.min(s, p.length), q); S.push({ x: q.x, z: q.z, rx: Math.sin(q.h), rz: Math.cos(q.h) }); }
  const n = S.length, L = new Array<number>(n).fill(0), R = new Array<number>(n).fill(0);
  for (let s = 0; s <= p.length; s += step / 2) {
    p.eval(s, q);
    const fx = Math.cos(q.h), fz = -Math.sin(q.h), rx = Math.sin(q.h), rz = Math.cos(q.h), i0 = Math.round(s / step);
    for (let u = REAR; u <= FRONT + 1e-6; u += 0.5) for (const k of [-HW, HW]) {
      const x = q.x + fx * u + rx * k, z = q.z + fz * u + rz * k;
      let bi = i0, bd = Infinity;
      for (let i = Math.max(0, i0 - Math.ceil(6 / step)); i <= Math.min(n - 1, i0 + Math.ceil(14 / step)); i++) { const d = (S[i].x - x) ** 2 + (S[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
      const off = (x - S[bi].x) * S[bi].rx + (z - S[bi].z) * S[bi].rz;
      if (off < L[bi]) L[bi] = off; if (off > R[bi]) R[bi] = off;
    }
  }
  // Widest within a few metres either way, then eased along.
  const spread = (a: number[], pick: (x: number, y: number) => number, w: number) => a.map((_, i) => { let v = a[i]; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) v = pick(v, a[j]); return v; });
  const ease = (a: number[], w: number) => a.map((_, i) => { let t = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { t += a[j]; c++; } return t / c; });
  const w = Math.ceil(4 / step), e = Math.ceil(5 / step);
  const l = ease(spread(L.map((v) => Math.min(-half, v - MARGIN)), Math.min, w), e).map((v) => Math.min(-half, v));
  const r = ease(spread(R.map((v) => Math.max(half, v + MARGIN)), Math.max, w), e).map((v) => Math.max(half, v));
  const out = { l, r };
  SWEEPS.set(key, out);
  return out;
}
