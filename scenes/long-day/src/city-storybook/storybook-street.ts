// This file draws the storybook city's street pieces (styles.ts, `storybook`), each in the place of a
// modern piece that another city draws: its lollipop signals and their name boards (signals.ts), its
// street furniture (decor.ts), the twin crook lamps on its avenue medians (city.ts), the Very Long
// Scarf strung over a street in place of bunting, and the patchwork balloon over the town
// (ambient.ts). Each piece is sweets, curls and stripes in the palette of
// storybook-buildings-town.ts, and keeps about the triangle count of the piece it replaces, since a
// chunk holds dozens of them. Its paving is drawn by a patch on the ground's shader ("the candy
// paving", below).
// The file imports only geometry and three's types, so city.ts and the others can import it at load.
import * as THREE from "three@0.187.0";
import { Batch } from "../geom.ts";
import { hash2 } from "../rng.ts";
import { SB, SB_BULB, SB_GLOW, SB_LENS, sbCurve, sbTube } from "./storybook-buildings-town.ts";
import type { SbP3 } from "./storybook-buildings-town.ts";
import { STYLE_STORYBOOK } from "./storybook-style.ts";

// sbLocal runs fn, which draws into b about the origin, and then moves what it drew to (x, z) turned
// by rot (Frame2's sense: local +x goes to (cos rot, -sin rot), local +z to (sin rot, cos rot)).
function sbLocal(b: Batch, x: number, z: number, rot: number, fn: () => void) {
  const n0 = b.mark();
  fn();
  b.transformFrom(n0, { ox: x, oz: z, rot });
}

// ---- junctions ----------------------------------------------------------------------------------
// The signal's tag for its lamps (signals.ts): `lamp` is the state each shows in (0 red, 1 yellow, 2 green).
export type StorySignalTag = (lamp: 0 | 1 | 2) => void;
const SS_LAMPS = [0xff2a1a, 0xffb000, 0x22ff66];
// storySignal draws the storybook's lollipop signal at (px, pz) for the traffic coming up heading
// (fx, fz), the road towards (ax, az). A candy-striped pole leans out towards the road and carries a
// plum lollipop disc that faces the traffic, its three gumball lamps red over yellow over green
// (tagged as any signal's), with a gold ball and a curl of pink ribbon on top. Under the disc, a
// butter board pointing towards the road carries the cross street's name: `letter` places its
// lettering (signals.ts, through the plates), and is null where there is none. `room` is how far the
// kerb's face is from the pole, which the board keeps short of. Pole and board go in `solid`, the
// lamps in `lamps`.
export function storySignal(solid: Batch, lamps: Batch, px: number, pz: number, fx: number, fz: number, ax: number, az: number, room: number, tag: StorySignalTag,
  letter: ((x: number, y: number, z: number, w: number, h: number, rotY: number) => void) | null) {
  // (Local frame: +z towards the road, +x along it; the traffic heads along local +x times f, and
  // the disc faces it, along -x times f.)
  const rot = Math.atan2(ax, az), f = Math.sign(fx * Math.cos(rot) - fz * Math.sin(rot)) || 1;
  const H = 4.6, lean = 0.6, dy = H + 0.35, at = (y: number): SbP3 => [0, y, lean * (y / H) ** 2];
  sbLocalBoth(solid, lamps, px, pz, rot, () => {
    sbTube(solid, sbCurve(5, (t) => at(t * H)), () => 0.11, (i) => (i % 2 ? SB.cream : SB.pink), 5, px + pz);
    // The disc: a plum lollipop with a cream face and a gold ball on top.
    solid.cyl(0, dy, lean, 0.47, 0.12, SB.plum, 12, 0, Math.PI / 2);
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2, x = -f * 0.065, R = 0.38;
      solid.tri(x, dy, lean, x, dy + Math.sin(a0) * R, lean + Math.cos(a0) * R, x, dy + Math.sin(a1) * R, lean + Math.cos(a1) * R, SB.cream, [-f, 0, 0]);
    }
    solid.ico(0, dy + 0.55, lean, 0.11, SB.mustard);
    // (The ribbon: from the ball, a loop over and back down the disc's far side.)
    sbTube(solid, sbCurve(4, (t): SbP3 => [f * 0.1, dy + 0.62 + Math.sin(t * Math.PI) * 0.3, lean + Math.sin(t * Math.PI * 1.6) * 0.32]), () => 0.035, () => SB.pink, 4, px);
    for (const k of [0, 1, 2] as const) { tag(k); lamps.ico(-f * 0.13, dy + 0.25 - k * 0.25, lean, 0.1, SS_LAMPS[k]); }
    lamps.aux.set(0, 0, -1);
    // The name board, on the pole's traffic side, pointing to the road.
    if (letter) {
      const y = 3.45, len = Math.min(1.9, room + 0.45 - 0.35), zc = at(y)[2] + len / 2 - 0.55, d = -f * 0.13;
      if (len < 1.2) return;
      solid.box(d, y, zc, 0.05, 0.36, len, SB.butter);
      solid.box(d + f * 0.01, y, zc, 0.04, 0.44, len + 0.08, SB.plum);
      solid.boxR(d + f * 0.01, y, zc + len / 2 + 0.04, 0.04, 0.31, 0.31, SB.plum, Math.PI / 4, 0, 0);
      solid.boxR(d, y, zc + len / 2 + 0.01, 0.05, 0.25, 0.25, SB.butter, Math.PI / 4, 0, 0);
      const [wx, wz] = frameXZ(d - f * 0.03, zc, px, pz, rot);
      letter(wx, y, wz, len - 0.12, 0.24, rot - f * Math.PI / 2);
    }
  });
}
// (A point in sbLocal's frame, moved as it moves what it draws.)
function frameXZ(x: number, z: number, ox: number, oz: number, rot: number): [number, number] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [ox + c * x + s * z, oz - s * x + c * z];
}
// (sbLocal over two batches at once.)
function sbLocalBoth(a: Batch, b: Batch, x: number, z: number, rot: number, fn: () => void) {
  const na = a.mark(), nb = b.mark();
  fn();
  a.transformFrom(na, { ox: x, oz: z, rot }); b.transformFrom(nb, { ox: x, oz: z, rot });
}

// ---- streetlights -------------------------------------------------------------------------------
// The glass of a storybook lamp glows after dark in its own colour (SB_GLOW): butter mostly, now and
// then pink or aqua, by where it hangs.
export const sbLampGlass = (x: number, z: number) => { const h = hash2(Math.round(x * 10), Math.round(z * 10), 0, 0x1a3); return h < 0.6 ? SB.lamp : h < 0.8 ? SB.pink : SB.aqua; };
// storyCrook draws a crook's curl, its shade and its lamp from the top of a pole at (px, top, pz)
// over towards (hx, hz), as storyLamp's (storybook-buildings-town.ts) curls. It returns where its
// light hangs.
export function storyCrook(s: Batch, px: number, pz: number, hx: number, hz: number, top: number): SbP3 {
  const dx = hx - px, dz = hz - pz, k = 1 - Math.cos(Math.PI * 0.95);
  const pts = sbCurve(4, (t): SbP3 => { const a = t * Math.PI * 0.95, f = (1 - Math.cos(a)) / k; return [px + dx * f, top + Math.sin(a) * 0.9, pz + dz * f]; });
  sbTube(s, pts, () => 0.075, () => SB.ink, 5, px * 1.3 + pz + hx);
  const [ex, ey, ez] = pts[pts.length - 1];
  s.cyl(ex, ey - 0.25, ez, 0.03, 0.5, SB.ink, 4);
  s.cone(ex, ey - 0.55, ez, 0.42, 0.36, SB.ink, 7, 0, hx + hz);
  s.aux.set(0, 0, SB_GLOW); s.ico(ex, ey - 0.86, ez, 0.26, sbLampGlass(ex, ez), 1.15, hx * 0.7 + hz); s.aux.set(0, 0, -1);
  return [ex, ey - 0.9, ez];
}
// storyTwinLamp draws an avenue median's streetlight at (px, pz) on ground y0: one pole, a gold
// knob on top and two crooks back to back, one curling over each carriageway, to (px ± ux, pz ± uz).
// It returns where its two lights hang.
export function storyTwinLamp(s: Batch, px: number, pz: number, ux: number, uz: number, y0: number): SbP3[] {
  const top = y0 + 5.8;
  sbTube(s, [[px, y0, pz], [px, y0 + 0.5, pz], [px, top, pz]], (i) => (i < 1 ? 0.13 : 0.09), (i) => (i < 1 ? SB.plum : SB.ink), 6, px + pz);
  s.ico(px, top + 0.06, pz, 0.14, SB.mustard);
  return [storyCrook(s, px, pz, px + ux, pz + uz, top), storyCrook(s, px, pz, px - ux, pz - uz, top)];
}

// ---- street furniture ---------------------------------------------------------------------------
// Each piece is drawn by decor.ts streetFurniture in the pavement's frame, as the Victorian city's
// are (victorian-street.ts VicPiece): at (x, z) on the kerb's face, `inward` (ix, iz) from the road
// towards the buildings, on ground y0. Each keeps to the footprint of the modern piece it stands in
// for, which decor.ts records for the walkers, and stands as far in from the kerb (d) as that one.
export type StoryPiece = (s: Batch, x: number, z: number, ix: number, iz: number, y0: number) => void;
// (In the piece's frame: +z inward, +x along the kerb. `h` hashes where it stands, for its colours.)
const sbPiece = (d: number, draw: (s: Batch, y0: number, h: number) => void): StoryPiece => (s, x, z, ix, iz, y0) =>
  sbLocal(s, x + ix * d, z + iz * d, Math.atan2(ix, iz), () => draw(s, y0, hash2(Math.round(x * 10), Math.round(z * 10), 0, 0x5b7)));
const pickBy = <T,>(h: number, a: readonly T[]) => a[Math.floor(h * a.length) % a.length];

// A squirter (for a hydrant): a round-bellied pump with a cream band, its curly gold spout over the
// kerb and a tap wheel on top.
export const storySquirter = sbPiece(0.7, (s, y0, h) => {
  s.lathe("bulb", SB_BULB, 0, y0, 0, 0.21, 0.66, pickBy(h, [SB.red, SB.coral, SB.violet]), 6);
  s.tubeSeg(0, y0 + 0.3, 0, 0.215, 0.07, SB.cream, 6, 0, 0, 0.3);
  s.cyl(0, y0 + 0.69, 0, 0.13, 0.04, SB.mustard, 6, 0, 0, 0.3);
  sbTube(s, [[0, y0 + 0.4, -0.12], [0, y0 + 0.46, -0.36], [0, y0 + 0.3, -0.42]], () => 0.045, () => SB.mustard, 4, 0);
});
// A striped barrel (for a trash can): teal, sky or mint with a white band, its gold lid sprung open
// on a coil at the back.
export const storyBarrel = sbPiece(0.7, (s, y0, h) => {
  s.cyl(0, y0 + 0.42, 0, 0.27, 0.84, pickBy(h, [SB.teal, SB.mint, SB.sky]), 6);
  s.tubeSeg(0, y0 + 0.5, 0, 0.285, 0.12, SB.white, 6, 0, 0, 0.3);
  s.boxR(0, y0 + 0.94, 0.24, 0.04, 0.2, 0.04, SB.ink, 0.3, 0, 0);
  s.cyl(0, y0 + 1.16, 0.14, 0.3, 0.04, SB.mustard, 6, -1.0);
});
// A curl-backed bench (for a bench): a pink seat and back between two ink curls, each a leg at the
// front that sweeps up under the seat and curls over at the top of the back.
export const storyBench = sbPiece(0.7, (s, y0) => {
  s.box(0, y0 + 0.46, 0.12, 1.8, 0.08, 0.42, SB.pink);
  s.boxR(0, y0 + 0.8, 0.36, 1.7, 0.34, 0.06, SB.pink, 0.18, 0, 0);
  for (const x of [-0.86, 0.86]) sbTube(s, [[x, y0, -0.06], [x, y0 + 0.44, 0.2], [x, y0 + 0.86, 0.42], [x, y0 + 1.04, 0.3]], () => 0.04, () => SB.ink, 4, x);
});
// A post pot (for a mailbox): a round plum, navy or red pot on a crooked ink stalk, with a gold knob
// on its lid.
export const storyPostPot = sbPiece(0.7, (s, y0, h) => {
  sbTube(s, [[0, y0, 0], [0.05, y0 + 0.45, 0.02], [0, y0 + 0.92, 0]], () => 0.05, () => SB.ink, 4, 0.3);
  s.lathe("bulb", SB_BULB, 0, y0 + 0.86, 0, 0.3, 0.62, pickBy(h, [SB.plum, SB.navy, SB.red]), 6);
  s.cone(0, y0 + 1.52, 0, 0.07, 0.14, SB.mustard, 4);
});
// A paper kiosk (for newspaper boxes): a round kiosk in cream and teal stripes under a pointed red
// roof, with a plum shelf of papers on its road side.
export const storyKiosk = sbPiece(0.7, (s, y0) => {
  for (let k = 0; k < 2; k++) s.tubeSeg(0, y0 + 0.32 + k * 0.64, 0, 0.36, 0.65, k ? SB.teal : SB.cream, 6, 0, 0, k * 0.3);
  s.cone(0, y0 + 1.5, 0, 0.5, 0.5, SB.red, 6);
  s.box(0, y0 + 0.82, -0.42, 0.56, 0.06, 0.16, SB.plum);
});
// A candy hitching post (for a parking meter): a red and cream striped post a metre high with a gold
// knob on top.
export const storyCandyPost = sbPiece(0.45, (s, y0) => {
  for (let k = 0; k < 2; k++) s.tubeSeg(0, y0 + 0.25 + k * 0.5, 0, 0.045, 0.51, k ? SB.cream : SB.red, 4, 0, 0, k * 0.4);
  s.cone(0, y0 + 1.06, 0, 0.08, 0.12, SB.mustard, 4);
});
// A toadstool shelter (for a bus shelter): a red toadstool cap spotted cream on a fat cream stalk at
// the back, a pink bench in its shade. The cap keeps over the pavement, short of the kerb.
export const storyToadstool = sbPiece(1.05, (s, y0) => {
  const z = 0.55, R = 1.3, H = 0.75, y = y0 + 2.25;
  s.tubeSeg(0, y0 + 1.15, z, 0.24, 2.3, SB.cream, 6);
  s.lathe("lens", SB_LENS, 0, y, z, R, H, SB.red, 9);
  for (let k = 0; k < 3; k++) { const a = k * 2.1 + 0.4; s.cone(Math.cos(a) * R * 0.5, y + H * 0.9, z + Math.sin(a) * R * 0.5, 0.22, 0.08, SB.cream, 4, 0, a); }
  s.box(0, y0 + 0.45, -0.1, 1.6, 0.07, 0.4, SB.pink);
  for (const x of [-0.7, 0.7]) s.box(x, y0 + 0.21, -0.1, 0.07, 0.42, 0.32, SB.ink);
});
// A hoop rack (for a bike rack): three hoops in a row for tethering pogo bubbles and unicycles.
export const storyHoops = sbPiece(0.7, (s, y0) => {
  [-0.6, 0, 0.6].forEach((x, k) => sbTube(s, sbCurve(3, (t): SbP3 => [x, y0 + Math.sin(t * Math.PI) * 0.8, Math.cos(t * Math.PI) * 0.3]), () => 0.035, () => [SB.violet, SB.teal, SB.coral][k], 3, k));
});

// ---- the Very Long Scarf ------------------------------------------------------------------------
// storyScarf strings the Very Long Scarf across a street in place of bunting (storybook-buildings-
// town.ts bunting): the same two striped poles at the backs of the pavements, (ax, az) and (bx, bz),
// and a knitted scarf half a metre deep hung between them, sagging lower than bunting does but well
// above any truck, striped by the metre in its own colours, tasselled at both ends.
export function storyScarf(s: Batch, ax: number, az: number, bx: number, bz: number, y0: number, salt: number) {
  const H = y0 + 8.6, sag = 1.9, W = 0.5, L = Math.hypot(bx - ax, bz - az), n = Math.max(8, Math.round(L / 0.75));
  for (const [x, z] of [[ax, az], [bx, bz]]) {
    sbTube(s, sbCurve(3, (t) => [x, y0 + t * (H - y0 + 0.4), z]), () => 0.09, (i) => (i % 2 ? SB.white : SB.teal), 5, x + z);
    s.ico(x, H + 0.55, z, 0.2, SB.pink, 1, x - z);
  }
  const cols = [[SB.red, SB.mustard, SB.teal], [SB.violet, SB.lime, SB.orange], [SB.magenta, SB.cream, SB.navy]][salt % 3];
  const at = (t: number): SbP3 => [ax + (bx - ax) * t, H - Math.sin(t * Math.PI) * sag, az + (bz - az) * t];
  const nx = -(bz - az) / (L || 1) * 0.02, nz = (bx - ax) / (L || 1) * 0.02;
  for (let i = 0; i < n; i++) {
    const p = at(i / n), q = at((i + 1) / n), c = cols[i % 3];
    for (const k of [1, -1]) {
      const ox = nx * k, oz = nz * k;
      s.tri(p[0] + ox, p[1], p[2] + oz, q[0] + ox, q[1], q[2] + oz, q[0] + ox, q[1] - W, q[2] + oz, c, [ox, 0, oz]);
      s.tri(p[0] + ox, p[1], p[2] + oz, q[0] + ox, q[1] - W, q[2] + oz, p[0] + ox, p[1] - W, p[2] + oz, c, [ox, 0, oz]);
    }
  }
  // (The tassels: a fringe of three under each end.)
  for (const t of [0.012, 0.988]) { const [x, y, z] = at(t); for (const k of [-1, 0, 1]) s.cone(x + (bx - ax) / L * k * 0.15, y - W - 0.18, z + (bz - az) / L * k * 0.15, 0.06, 0.36, cols[0], 4, Math.PI); }
}

// ---- the balloon over the town ------------------------------------------------------------------
// storyBalloon draws the patchwork hot-air balloon that drifts over a storybook city in place of the
// advertising blimp (ambient.ts), its origin at the envelope's middle and about 1 across (scaled
// there): an envelope of patches in eight gores and six rows, a ring of gold at its mouth, ropes down
// to a wicker basket and a striped burner between.
export function storyBalloon(b: Batch) {
  const P = [SB.red, SB.mustard, SB.teal, SB.pink, SB.violet, SB.lime, SB.orange, SB.cream];
  // (The profile from the crown down: radius and height, about the middle.)
  const prof: [number, number][] = [[0, 1.05], [0.5, 0.95], [0.85, 0.65], [1, 0.2], [0.92, -0.25], [0.6, -0.7], [0.3, -0.98]];
  const G = 8;
  for (let r = 0; r + 1 < prof.length; r++) for (let g = 0; g < G; g++) {
    const a0 = (g / G) * Math.PI * 2, a1 = ((g + 1) / G) * Math.PI * 2, [r0, y0] = prof[r], [r1, y1] = prof[r + 1];
    const c = P[(g * 3 + r * 5) % P.length], am = (a0 + a1) / 2, face: [number, number, number] = [Math.cos(am), (r0 - r1) * 0.6 + 0.01, Math.sin(am)];
    const A: SbP3 = [r0 * Math.cos(a0), y0, r0 * Math.sin(a0)], B: SbP3 = [r0 * Math.cos(a1), y0, r0 * Math.sin(a1)];
    const C: SbP3 = [r1 * Math.cos(a1), y1, r1 * Math.sin(a1)], D: SbP3 = [r1 * Math.cos(a0), y1, r1 * Math.sin(a0)];
    if (r0 > 0) b.tri(...A, ...B, ...C, c, face);
    b.tri(...A, ...C, ...D, c, face);
  }
  b.cyl(0, -0.99, 0, 0.31, 0.03, SB.mustard, 8);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; b.boxR(Math.cos(a) * 0.2, -1.2, Math.sin(a) * 0.2, 0.012, 0.45, 0.012, SB.ink, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
  b.cyl(0, -1.12, 0, 0.05, 0.1, SB.red, 6);
  b.box(0, -1.5, 0, 0.26, 0.2, 0.26, 0x9a6a3a);
  b.box(0, -1.4, 0, 0.27, 0.03, 0.27, 0x7a4a22);
}

// ---- the candy paving ---------------------------------------------------------------------------
// A storybook street's road and junctions are paved in candy cobbles, and its pavements, plazas and
// paths in fish-scale tiles. city.ts tags their ground (aux.z SB_COBBLES or SB_SCALES, aux.xy the way
// along the street in the world), and applyCandyPaving draws the stones on the ground's material
// from the world position, as victorian-street.ts applySetts draws a Victorian street's setts.
// The cobbles are rounded bricks laid in herringbone at 45 degrees to the street, each one of three
// tones of the road's blue-violet with a paler crown, in lavender grout. The tiles are scallops in
// overlapping rows along the kerb, cream with now and then a pink or butter one, each with a fine
// inner arc. Each joint is drawn at least about a pixel wide across it, and fades out where a stone
// comes to less than about two pixels across that joint; the stones' tones fade to their mean where
// a stone comes to less than about two pixels the longer way. So a far street reads as even paving
// and never shimmers, and a low look along the street keeps the joints it can still draw.
export const SB_COBBLES = -9, SB_SCALES = -10;
// In the rain (applySetts' SETT_WET, set each frame from the weather: main.ts) the paving darkens
// and takes the sky's sheen, strongest at a grazing look, as the setts do. Round puddles of plain
// dark water stand on it, and each raindrop that falls in one sends out a ring that glows in the
// shops' candy colours (STYLE_STORYBOOK walls.commercial, in order of hue), stepping on through them
// as it spreads (SB_PAVE_TIME: the scene's time, s, also set in main.ts).
export const SB_PAVE_TIME = { value: 0 };
// (A cobble's short side and a tile's width, m; the pixel's share of a stone over which the pattern
// fades, and past which a joint is left out whatever its way; the puddles' noise, a cycle per so many
// m, and per kind the level it stands over in full rain; and the raindrops' grid, m.)
const PAVE = { cobble: 0.38, scale: 1.0, fade: [0.22, 0.5, 0.75], puddleScale: 0.3, cobblePuddle: 0.56, scalePuddle: 0.62, dropCell: 2.0 };
const f3 = (x: number) => x.toFixed(3);
// (sRGB hex to the linear vec3 the shader mixes in.)
const lin = (hex: number) => `vec3(${[16, 8, 0].map((s) => f3(Math.pow(((hex >> s) & 255) / 255, 2.2))).join(", ")})`;
// (An sRGB colour's hue, 0..1.)
const hue = (hex: number) => {
  const [r, g, b] = [16, 8, 0].map((s) => ((hex >> s) & 255) / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = d === 0 ? 0 : mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d;
  return ((h / 6) % 1 + 1) % 1;
};
// (The raindrops' rings' colours, round the wheel of hue.)
const DROP_COLOURS = [...STYLE_STORYBOOK.walls.commercial].sort((a, b) => hue(a) - hue(b));
const PAVE_GLSL = `
const vec3 SB_DROP[${DROP_COLOURS.length}] = vec3[](${DROP_COLOURS.map(lin).join(", ")});
// (The puddles' noise at q, m: Victorian-sized blobs (victorian-street.ts) with a finer ruffle to
// their shores.)
float sbPuddle(vec2 q) {
  q *= ${f3(PAVE.puddleScale)};
  return 0.72 * stNoise(q + 31.0) + 0.28 * stNoise(q * 3.7 + 7.0);
}
// (The rings' colour at u, in colours along the list, blended between neighbours and round again.)
vec3 sbDrop(float u) {
  float f = mod(u, ${DROP_COLOURS.length}.0), i = floor(f);
  return mix(SB_DROP[int(i)], SB_DROP[int(mod(i + 1.0, ${DROP_COLOURS.length}.0))], smoothstep(0.0, 1.0, f - i));
}
// (The cobble q falls in, in a herringbone of 2-by-1 bricks on the unit grid, by (c.x - c.y) mod 4
// of q's cell c: 0 and 1 the two cells of a brick along x, 2 and 3 the two of a brick along y. id,
// out: the brick's corner. Returned: how far q is inside its rounded edge, and that edge's normal.)
vec3 sbCobble(vec2 q, out vec2 id) {
  vec2 c = floor(q);
  float m = mod(c.x - c.y, 4.0);
  vec4 b = m < 1.5 ? vec4(c.x - m, c.y, 2.0, 1.0) : vec4(c.x, c.y - (m < 2.5 ? 1.0 : 0.0), 1.0, 2.0);
  id = b.xy;
  vec2 hs = 0.5 * b.zw, o = q - b.xy - hs, a = abs(o) - hs + 0.5;
  vec2 n = a.x > a.y ? vec2(sign(o.x), 0.0) : vec2(0.0, sign(o.y));
  if (a.x > 0.0 && a.y > 0.0) n = sign(o) * normalize(a);
  return vec3(0.5 - length(max(a, 0.0)) - min(max(a.x, a.y), 0.0), n);
}
// (The fish scale q falls in: scales W wide in rows H apart, each row's set off by half a scale,
// each lying under the row above it. id, out: its row and index. Returned: how far q is inside its
// edge, and that edge's normal.)
vec3 sbScale(vec2 q, float W, float H, out vec2 id) {
  float R = 0.5 * W, r0 = floor(q.y / H);
  for (float i = 2.0; i >= -1.0; i -= 1.0) {
    float r = r0 + i, o = 0.5 * mod(r, 2.0), k = floor(q.x / W - o + 0.5);
    vec2 c = vec2((k + o) * W, r * H);
    float d = length(q - c);
    if (d < R) {
      id = vec2(r, k);
      vec2 u = vec2(c.x - 0.5 * W, c.y + H), v = vec2(c.x + 0.5 * W, c.y + H);
      vec2 w = length(q - u) < length(q - v) ? u : v;
      float eo = R - d, ew = length(q - w) - R;
      return eo < ew ? vec3(eo, (q - c) / max(d, 1e-4)) : vec3(ew, (q - w) / max(ew + R, 1e-4));
    }
  }
  id = vec2(r0, 0.0);
  return vec3(0.0, 0.0, 1.0);
}`;
export function applyCandyPaving(mat: THREE.Material) {
  const prev = mat.onBeforeCompile.bind(mat), prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    // (After applySetts, whose aux varyings, wetness, sky and hashes this reads.)
    prev(shader, renderer);
    shader.uniforms.uSbTime = SB_PAVE_TIME;
    shader.fragmentShader = shader.fragmentShader
      .replace("uniform vec3 uSettSky;", "uniform vec3 uSettSky;\nuniform float uSbTime;")
      .replace("void main() {", PAVE_GLSL + "\nvoid main() {")
      .replace("#include <color_fragment>", `#include <color_fragment>
  float sbShine = 0.0, sbFloor = 0.0; vec3 sbGlow = vec3(0.0);   // (the wet sheen's strength, its share seen from overhead too, and the raindrops' rings' own light: emissivemap_fragment below)
  {
    float cob = abs(vSettAux.z - (${f3(SB_COBBLES)})) < 0.5 ? 1.0 : 0.0, til = abs(vSettAux.z - (${f3(SB_SCALES)})) < 0.5 ? 1.0 : 0.0;
    // (x along the street, y across it, m; and a pixel's size on the ground, m, the larger way.
    // Both before the branch, as a derivative is undefined in one.)
    vec2 d = length(vSettAux.xy) > 0.5 ? normalize(vSettAux.xy) : vec2(1.0, 0.0);
    vec2 p = vec2(dot(vSettXZ, d), dot(vSettXZ, vec2(-d.y, d.x)));
    // (A pixel's step in p each way on the screen, and its size on the ground the larger way, m.
    // Both before the branch, as a derivative is undefined in one.)
    vec2 dpx = dFdx(p), dpy = dFdy(p), dwx = dFdx(vSettXZ), dwy = dFdy(vSettXZ);
    float px = max(abs(dpx.x) + abs(dpy.x), abs(dpx.y) + abs(dpy.y));
    // (The puddles' noise here, and the level they stand over, which falls as the rain sets in.)
    float pn = sbPuddle(vSettXZ), pfw = max(fwidth(pn), 0.004);
    float pth = mix(${f3(PAVE.cobblePuddle)}, ${f3(PAVE.scalePuddle)}, til) + 0.2 * (1.0 - smoothstep(0.15, 0.6, uSettWet));
    if (dot(normalize(vNormal), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) < 0.5) cob = til = 0.0;
    if (cob + til > 0.5) {
      // (e: how far inside the stone's edge, m; n: that edge's normal in p; size: the stone's
      // narrow way, m. A pixel's size across the edge sets how wide its joint is drawn and how much
      // of the edge shows, and its size the larger way how much of the stone's tone shows.)
      vec3 tone, grout, mean;
      vec2 id, n;
      float e, size, h;
      if (cob > 0.5) {
        // (The herringbone, turned 45 degrees to the street, in units of a cobble's short side.)
        vec3 c = sbCobble(vec2(p.x + p.y, p.y - p.x) * (0.7071 / ${f3(PAVE.cobble)}), id);
        e = c.x * ${f3(PAVE.cobble)}; n = vec2(c.y - c.z, c.y + c.z) * 0.7071; size = ${f3(PAVE.cobble)};
        h = stHash2(id + 0.37);
        tone = h < 0.45 ? vec3(1.0) : h < 0.78 ? vec3(1.28, 1.2, 1.12) : vec3(0.74, 0.76, 0.92);
        tone *= 0.9 + 0.22 * smoothstep(0.0, 0.09, e);
        grout = mix(diffuseColor.rgb, ${lin(0xc8c0f0)}, 0.6) / max(diffuseColor.rgb, 0.001);
        mean = vec3(1.12);
      } else {
        // (The scales, in rows along the kerb.)
        vec3 c = sbScale(vec2(p.x, -p.y), ${f3(PAVE.scale)}, ${f3(PAVE.scale * 0.35)}, id);
        e = c.x; n = vec2(c.y, -c.z); size = ${f3(PAVE.scale * 0.35)};
        h = stHash2(id + 0.71);
        tone = h < 0.22 ? ${lin(0xffc4d0)} / ${lin(0xf2dcc8)} : h < 0.38 ? ${lin(0xfbe7a6)} / ${lin(0xf2dcc8)} : vec3(1.0);
        tone *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.1, e));
        grout = vec3(0.82, 0.74, 0.78);
        mean = vec3(0.97);
      }
      float pxn = abs(dot(n, dpx)) + abs(dot(n, dpy));
      float show = 1.0 - smoothstep(${f3(PAVE.fade[0])}, ${f3(PAVE.fade[1])}, px / size);
      float edge = (1.0 - smoothstep(${f3(PAVE.fade[0])}, ${f3(PAVE.fade[1])}, pxn / size)) * (1.0 - smoothstep(${f3(PAVE.fade[1])}, ${f3(PAVE.fade[2])}, px / size));
      float jw = max(0.025, 0.7 * pxn);
      // (A scale's fine inner arc, a little in from its round edge.)
      if (til > 0.5) tone *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, max(0.02, pxn), abs(e - 0.13))) * edge;
      float joint = (1.0 - smoothstep(jw * 0.5, jw * 1.2, e)) * edge;
      diffuseColor.rgb *= mix(mix(mean, tone, show), grout, joint);
      if (uSettWet > 0.0) {
        // (The puddles: where the noise stands over its level, its shore drawn a pixel wide.)
        float inside = smoothstep(pth - pfw, pth + pfw, pn);
        diffuseColor.rgb *= mix(1.0, cob > 0.5 ? 0.62 : 0.78, uSettWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${lin(0x2a2660)}, inside * 0.8);
        // (The rings: two raindrops at a time in each cell of a grid in the world, each a ring
        // spreading out from where it fell for 1.5 s and fading as it goes, falling somewhere new
        // each time, near enough the cell's middle that the ring stays in its cell. A drop that falls
        // on dry ground leaves no ring, and a ring stops at the shore. A ring starts at a colour of its
        // own and steps through two of the list's colours a second as it spreads. A ring too fine for
        // the pixels is left out.)
        vec2 gi = floor(vSettXZ / ${f3(PAVE.dropCell)}), gc = (gi + 0.5) * ${f3(PAVE.dropCell)}, dv = vSettXZ - gc;
        float ring = 0.0;
        vec3 ringCol = vec3(0.0);
        for (float k = 0.0; k < 2.0; k += 1.0) {
          float t = uSbTime / 1.5 + stHash2(gi + 31.0 + k * 3.0), nf = floor(t), age = t - nf;
          vec2 at = (vec2(stHash2(gi + nf * 1.3 + k), stHash2(gi - nf * 0.7 + k * 5.0)) - 0.5) * ${f3(PAVE.dropCell * 0.35)};
          if (sbPuddle(gc + at) < pth + 0.01) continue;
          vec2 dd = dv - at;
          float l = length(dd), rr = age * ${f3(PAVE.dropCell * 0.3)};
          vec2 g = dd / max(l, 1e-4);
          float w = max(abs(dot(g, dwx)) + abs(dot(g, dwy)), 0.01), ww = max(0.07, 1.2 * w);
          float a = (1.0 - age * age) * (1.0 - smoothstep(0.5 * (ww - w), 0.5 * (ww + w), abs(l - rr))) * (1.0 - smoothstep(0.08, 0.16, w));
          ring += a;
          ringCol += a * sbDrop(8.0 * stHash2(gi + nf * 2.1 + k * 11.0) + 3.0 * age);
        }
        ring = min(ring, 1.0) * inside;
        ringCol = ringCol / max(ring, 1e-3) * inside;
        sbShine = uSettWet * mix(0.6, 1.7, inside) * (1.0 - joint * (1.0 - inside)) * (1.0 - ring);
        sbFloor = uSettWet * 0.25 * inside;
        sbGlow = ringCol * ring * uSettWet * 0.6;
        diffuseColor.rgb = mix(diffuseColor.rgb, ringCol, ring * uSettWet);
      }
    }
  }`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if (sbShine > 0.0) totalEmissiveRadiance += uSettSky * (sbFloor + sbShine * (0.06 + 0.94 * pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 4.0)));
  totalEmissiveRadiance += sbGlow;`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|candy-v5";
  mat.needsUpdate = true;
}
