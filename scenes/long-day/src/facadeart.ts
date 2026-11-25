// The facade atlas (facade.ts) is painted at startup instead of loaded. It holds 128 tiles of 128x128 in
// an 8x16 grid, with room for FACADE_KINDS kinds (FACADE, facadetiles.ts) in four variants each (tile = kind +
// FACADE_KINDS * variant; facadeBox picks a building's variant). It is two 1024x2048 canvases, colour and a mask in
// the same layout (separate, so a far-off wall's mipmaps never blend the one into the other):
//   R  the building's vertex colour tints this (wall), or it keeps its own colour (glass, frames)
//   G  glass: lit from inside after dark
//   B  how brightly (a blind half down, a curtain, the back of a deep room)
// Everything is drawn as whole-pixel rectangles, so the mask's edges are exact; tiles repeat
// across a wall (fract in the shader), so whatever touches a tile's edge matches the opposite one.
import { mulberry32 } from "./rng.ts";
import { makeCanvas } from "./canvas.ts";
import { FACADE_KINDS } from "./facadetiles.ts";

export const FACADE_TILE = 128, FACADE_GRID = 8, FACADE_ROWS = 16, FACADE_VARIANTS = 4;
const FA_S = FACADE_TILE, FA_W = FA_S * FACADE_GRID, FA_H = FA_S * FACADE_ROWS;

interface FaMask { t: number; g: number; l: number }
const FA_WALL: FaMask = { t: 1, g: 0, l: 0 }, FA_TRIM: FaMask = { t: 0, g: 0, l: 0 };
const FA_GLASS = (l = 1): FaMask => ({ t: 0, g: 1, l });

// Colours that keep their own colour (untinted).
const FA_GL = "#2f4a6b", FA_GL_DARK = "#1f2d40", FA_GL_DEEP = "#22344b", FA_FRAME = "#dcdcd4", FA_FRAME_DARK = "#2a2e33";
const FA_SHUTTERS = ["#3a4a40", "#2b3a55", "#5a2a2a", "#26282b"];
const FA_DOORS = ["#5e3a28", "#2b3a55", "#6b1f1f", "#2f4a3a"];
const FA_AWNINGS: [string, string][] = [["#1f5a3a", "#e8e4d8"], ["#8a2222", "#e8e4d8"], ["#22324a", "#22324a"], ["#c46a1a", "#f0e2c0"]];

class FaPainter {
  constructor(private g: CanvasRenderingContext2D, private gm: CanvasRenderingContext2D, private ox: number, private oy: number) {}
  // A rectangle in tile pixels, in colour and mask both.
  rect(x: number, y: number, w: number, h: number, col: string, m: FaMask) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (w <= 0 || h <= 0) return;
    this.g.fillStyle = col; this.g.fillRect(this.ox + x, this.oy + y, w, h);
    this.gm.fillStyle = `rgb(${m.t * 255},${m.g * 255},${Math.round(m.l * 255)})`; this.gm.fillRect(this.ox + x, this.oy + y, w, h);
  }
  wall(x: number, y: number, w: number, h: number, col: string) { this.rect(x, y, w, h, col, FA_WALL); }
  // Colour only, over whatever the mask says (shading, reflections, texture).
  paint(x: number, y: number, w: number, h: number, col: string) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (w <= 0 || h <= 0) return;
    this.g.fillStyle = col; this.g.fillRect(this.ox + x, this.oy + y, w, h);
  }
  // A pane of glass with a room behind it: the back wall darker below the sill line, a ceiling
  // light's sheen near the top, and the sky's reflection as a diagonal streak.
  pane(x: number, y: number, w: number, h: number, opts: { col?: string; dark?: string; light?: number; streak?: boolean; blind?: number; curtains?: string | null } = {}) {
    const col = opts.col ?? FA_GL, dark = opts.dark ?? FA_GL_DEEP, l = opts.light ?? 1;
    this.rect(x, y, w, h, col, FA_GLASS(l));
    this.rect(x, y + h * 0.62, w, h * 0.38, dark, FA_GLASS(l * 0.75));
    if (h > 18) this.rect(x + 1, y + 2, w - 2, 2, "#4d6a8a", FA_GLASS(Math.min(1, l * 1.15)));
    if (opts.blind) {   // a roller blind part way down: light, glows softly
      const bh = h * opts.blind;
      this.rect(x, y, w, bh, "#d9d3c4", FA_GLASS(l * 0.55));
      this.paint(x, y + bh - 2, w, 2, "#b8b2a2");
    }
    if (opts.curtains) {   // curtains drawn to either side
      const cw = Math.max(2, Math.round(w * 0.18));
      this.rect(x, y, cw, h, opts.curtains, FA_GLASS(l * 0.45)); this.rect(x + w - cw, y, cw, h, opts.curtains, FA_GLASS(l * 0.45));
    }
    if (opts.streak !== false && w > 10 && h > 10) {   // the sky in the glass
      for (let i = 0; i < Math.min(w, h) * 0.7; i += 1) {
        const px = x + w * 0.15 + i, py = y + h * 0.85 - i * (h / w) * 0.9;
        if (px < x + w - 2 && py > y + 1) this.paint(px, py, 2, 1, "rgba(150,180,210,0.35)");
      }
    }
  }
  // A framed window: surround, pane, sill.
  window(x: number, y: number, w: number, h: number, opts: { frame?: string; surround?: number; sill?: boolean; mullion?: boolean; transom?: number; pane?: Parameters<FaPainter["pane"]>[4] } = {}) {
    const f = opts.frame ?? FA_FRAME, s = opts.surround ?? 4;
    this.rect(x - s, y - s, w + 2 * s, h + 2 * s, f, FA_TRIM);
    this.pane(x, y, w, h, opts.pane);
    if (opts.mullion) this.rect(x + w / 2 - 1, y, 2, h, f, FA_TRIM);
    if (opts.transom) this.rect(x, y + opts.transom, w, 2, f, FA_TRIM);
    if (opts.sill !== false) this.rect(x - s - 2, y + h + s, w + 2 * s + 4, 3, "#c9c7bd", FA_TRIM);
  }
  // This paints a disc as one whole-pixel row after another (so its mask's edges are as exact as a rect's).
  disc(cx: number, cy: number, r: number, col: string, m: FaMask, lower = -Infinity) {
    for (let y = Math.floor(-r); y < r; y++) {
      if (y < lower) continue;
      const h = y + 0.5, w = Math.sqrt(Math.max(0, r * r - h * h));
      this.rect(cx - w, cy + y, 2 * w, 1, col, m);
    }
  }
  // An arch is a rectangle w wide from y + w/2 down to y + h, under a half disc whose top is at y.
  arch(x: number, y: number, w: number, h: number, col: string, m: FaMask) {
    const r = w / 2;
    for (let k = Math.floor(-r); k < 0; k++) { const hh = k + 0.5, ww = Math.sqrt(Math.max(0, r * r - hh * hh)); this.rect(x + r - ww, y + r + k, 2 * ww, 1, col, m); }
    this.rect(x, y + r, w, h - r, col, m);
  }
  // Glass in an arch or a disc has the room's back wall darker below the sill line, and is lit after dark.
  archGlass(x: number, y: number, w: number, h: number, l = 1, col = FA_GL, dark = FA_GL_DEEP) {
    this.arch(x, y, w, h, col, FA_GLASS(l));
    this.rect(x, y + h * 0.62, w, h * 0.38, dark, FA_GLASS(l * 0.75));
  }
  discGlass(cx: number, cy: number, r: number, l = 1) {
    this.disc(cx, cy, r, FA_GL, FA_GLASS(l)); this.disc(cx, cy, r, FA_GL_DEEP, FA_GLASS(l * 0.75), Math.round(r * 0.25));
  }
  // Texture on a wall (tinted with it): fine speckle, slightly darker or lighter than `base`.
  speckle(rnd: () => number, n: number, x0 = 0, y0 = 0, w = FA_S, h = FA_S) {
    for (let i = 0; i < n; i++) {
      const v = rnd() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.10)";
      this.paint(x0 + Math.floor(rnd() * w), y0 + Math.floor(rnd() * h), 1 + Math.floor(rnd() * 2), 1, v);
    }
  }
}

const FA_W0 = "#efeeea";   // the usual wall white (tinted by the building colour)

// ---- the kinds ---------------------------------------------------------------------------------
type FaKind = (p: FaPainter, v: number, rnd: () => number) => void;

const faOffice: FaKind = (p, v, rnd) => {
  // A glazed bay over a spandrel panel; columns at the tile's edges.
  const glass = [FA_GL, "#3a3a32", "#2c4a4a", FA_GL][v], deep = [FA_GL_DEEP, "#28261f", "#1f3636", FA_GL_DEEP][v];
  p.wall(0, 0, FA_S, FA_S, "#e6e6e2");
  p.paint(0, 0, FA_S, 1, "rgba(0,0,0,0.08)");
  const top = 10, h = v === 3 ? 92 : 84;
  p.pane(6, top, FA_S - 12, h, { col: glass, dark: deep, blind: v === 1 ? 0.3 : v === 3 ? 0.18 : 0 });
  p.rect(6, top, FA_S - 12, 2, FA_FRAME_DARK, FA_TRIM); p.rect(6, top + h - 2, FA_S - 12, 2, FA_FRAME_DARK, FA_TRIM);
  const mull = v === 2 ? 3 : 2;
  for (let i = 1; i < mull; i++) p.rect(6 + ((FA_S - 12) * i) / mull - 1, top, 2, h, FA_FRAME_DARK, FA_TRIM);
  if (v === 3) p.rect(6, top + 26, FA_S - 12, 2, FA_FRAME_DARK, FA_TRIM);
  p.speckle(rnd, 80, 0, top + h, FA_S, FA_S - top - h);
};

const faPunched: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, FA_W0); p.speckle(rnd, 120);
  if (v === 0) p.window(40, 26, 48, 64, { transom: 18 });
  else if (v === 1) p.window(46, 18, 36, 78, { mullion: false, transom: 24, pane: { curtains: "#c9b99a" } });
  else if (v === 2) { p.window(22, 30, 34, 56, {}); p.window(72, 30, 34, 56, { pane: { blind: 0.45 } }); }
  else {
    p.window(36, 24, 56, 64, { mullion: true });
    p.rect(42, 92, 22, 14, "#b9bcbf", FA_TRIM); p.paint(44, 94, 18, 2, "#8c9094"); p.paint(44, 99, 18, 2, "#8c9094");   // an A/C unit under the sill
  }
};

const faDeco: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, "#ece6d8"); p.speckle(rnd, 60);
  // Pilasters at the edges, a tall window between, an ornamented spandrel.
  p.paint(0, 0, 10, FA_S, "rgba(0,0,0,0.07)"); p.paint(FA_S - 10, 0, 10, FA_S, "rgba(0,0,0,0.07)");
  const n = v === 2 ? 2 : 1, ww = v === 2 ? 26 : 36, gap = 14;
  const x0 = (FA_S - (n * ww + (n - 1) * gap)) / 2;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (ww + gap);
    p.rect(x, 8, ww, 88, FA_GL_DARK, FA_GLASS(0.9));
    p.pane(x + 2, 10, ww - 4, 84, { col: FA_GL_DARK, dark: "#18222f", light: 0.9 });
    p.rect(x, 44, ww, 3, "#9a9a92", FA_TRIM);
  }
  // spandrel ornament
  const orn = ["#b8ae98", "#9c8f74", "#c2b9a5", "#a9a28f"][v];
  if (v === 1) for (let i = 0; i < 6; i++) p.rect(FA_S / 2 - 30 + i * 10, 104 + (i % 2) * 4, 8, 4, orn, FA_TRIM);   // zigzag
  else if (v === 3) { p.rect(FA_S / 2 - 24, 104, 48, 3, orn, FA_TRIM); p.rect(FA_S / 2 - 16, 110, 32, 3, orn, FA_TRIM); p.rect(FA_S / 2 - 8, 116, 16, 3, orn, FA_TRIM); }   // stepped
  else p.rect(FA_S / 2 - 22, 106, 44, 8, orn, FA_TRIM);
};

const faResidential: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, FA_W0); p.speckle(rnd, 120);
  const sh = FA_SHUTTERS[v];
  p.window(44, 24, 40, 60, { mullion: true, transom: 30, pane: { curtains: v % 2 ? "#e0d6c0" : null, blind: v === 2 ? 0.35 : 0 } });
  // shutters with louvres
  for (const x of [26, 90]) {
    p.rect(x, 20, 12, 68, sh, FA_TRIM);
    for (let y = 24; y < 86; y += 5) p.paint(x + 1, y, 10, 1, "rgba(0,0,0,0.25)");
  }
  if (v === 3) {   // a window box with flowers
    p.rect(38, 92, 52, 8, "#5b3b26", FA_TRIM);
    for (let i = 0; i < 10; i++) p.rect(40 + i * 5 + (rnd() * 2 | 0), 86 + (rnd() * 4 | 0), 3, 4, ["#d8424a", "#f0c040", "#e070b0"][i % 3], FA_TRIM);
  }
};

const faStorefront: FaKind = (p, v, rnd) => {
  const [aw, aw2] = FA_AWNINGS[v];
  p.wall(0, 0, FA_S, FA_S, "#e4e2dc");
  // fascia, awning, shop window, a door at one side
  p.wall(0, 0, FA_S, 16, "#d6d4cc");
  p.rect(0, 16, FA_S, 14, aw, FA_TRIM);
  for (let x = 0; x < FA_S; x += 16) p.rect(x + 8, 16, 8, 14, aw2, FA_TRIM);
  p.paint(0, 29, FA_S, 2, "rgba(0,0,0,0.3)");
  const glassC = "#4a6a7a";
  p.rect(4, 34, 86, 82, FA_FRAME_DARK, FA_TRIM);
  p.pane(7, 37, 80, 74, { col: glassC, dark: "#3b5664", streak: true, light: 0.65 });
  // goods in the window: shelves of boxes or a mannequin, glowing with the shop
  const goods = ["#c09a5a", "#d0d0c8", "#a04040", "#5a7a4a"];
  if (v !== 2) for (let i = 0; i < 7; i++) p.rect(12 + i * 11, 88 - (rnd() * 10 | 0), 8, 18, goods[(i + v) % 4], FA_GLASS(0.8));
  else { p.rect(30, 60, 10, 46, "#d8d0c0", FA_GLASS(0.8)); p.rect(56, 64, 10, 42, "#d8d0c0", FA_GLASS(0.8)); }
  // the door
  p.rect(96, 34, 28, 94, FA_FRAME_DARK, FA_TRIM);
  p.pane(99, 38, 22, 86, { col: glassC, dark: "#3b5664", streak: false, light: 0.8 });
  p.rect(116, 78, 2, 12, "#c0c0c0", FA_TRIM);
  p.rect(0, 116, 92, 12, "#9c9a92", FA_TRIM);   // stall riser
};

const faIndustrial: FaKind = (p, v, rnd) => {
  // Corrugated cladding: vertical ribs.
  p.wall(0, 0, FA_S, FA_S, "#e8e8e6");
  for (let x = 0; x < FA_S; x += 8) { p.paint(x, 0, 2, FA_S, "rgba(0,0,0,0.12)"); p.paint(x + 2, 0, 1, FA_S, "rgba(255,255,255,0.18)"); }
  if (v === 0) { p.rect(0, 12, FA_S, 16, FA_FRAME_DARK, FA_TRIM); p.pane(0, 14, FA_S, 12, { col: FA_GL_DARK, dark: FA_GL_DARK, streak: false, light: 0.7 }); }
  if (v === 1) for (let i = 0; i < 3; i++) { const x = 18 + i * 34; p.rect(x, 14, 24, 18, "#8a8e92", FA_TRIM); for (let y = 17; y < 31; y += 3) p.paint(x + 1, y, 22, 1, "#5a5e62"); }   // louvres
  if (v === 2) for (let i = 0; i < 14; i++) p.paint(rnd() * FA_S, 30 + rnd() * 60, 2, 20 + rnd() * 30, "rgba(130,70,30,0.12)");   // rust runs
  if (v === 3) { p.rect(0, 10, FA_S, 30, FA_FRAME_DARK, FA_TRIM); for (let x = 0; x < FA_S; x += 32) p.pane(x + 2, 12, 28, 26, { col: "#5a7080", dark: "#4b5f6c", light: 0.85 }); }   // clerestory
  p.paint(0, FA_S - 3, FA_S, 3, "rgba(0,0,0,0.15)");
};

const faDock: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, "#e6e6e4");
  const faDoor = ["#9a9a96", "#5e6e7e", "#c9a640", "#7a8a6a"][v];
  p.rect(14, 8, 100, 4, FA_FRAME_DARK, FA_TRIM);
  p.rect(18, 12, 92, 102, faDoor, FA_TRIM);
  for (let y = 16; y < 112; y += 6) p.paint(18, y, 92, 1, "rgba(0,0,0,0.22)");
  p.rect(18, 50, 92, 6, "#5a6672", FA_GLASS(0.5));   // vision panels, lit inside
  for (let x = 22; x < 108; x += 15) p.paint(x, 51, 11, 4, FA_GL_DARK);
  p.rect(14, 114, 10, 14, "#1d1d1d", FA_TRIM); p.rect(104, 114, 10, 14, "#1d1d1d", FA_TRIM);   // bumpers
  p.rect(56, 0, 16, 7, ["#c03030", "#2a6ab0", "#2a8a4a", "#e0a020"][v], FA_TRIM);   // bay number plate
  p.paint(60, 2, 8, 3, "#f0f0f0");
  p.speckle(rnd, 40, 0, 0, 14, FA_S); p.speckle(rnd, 40, 114, 0, 14, FA_S);
};

const faBlank: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, "#efefeb");
  if (v === 0) p.speckle(rnd, 900);
  if (v === 1) { p.speckle(rnd, 300); p.paint(0, 0, FA_S, 1, "rgba(0,0,0,0.12)"); p.paint(0, 0, 1, FA_S, "rgba(0,0,0,0.12)"); }   // precast panel joints
  if (v === 2) { p.speckle(rnd, 400); p.paint(0, 63, FA_S, 2, "rgba(0,0,0,0.08)"); }   // a reveal line
  if (v === 3) { p.speckle(rnd, 400); p.rect(52, 44, 24, 24, "#a9acae", FA_TRIM); for (let y = 47; y < 66; y += 4) p.paint(54, y, 20, 2, "#7b7f83"); }   // a vent
};

const faBrick: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, "#f4f2ee");
  // Courses of 16x8 bricks, running bond (seamless at 128).
  for (let r = 0; r < 16; r++) {
    p.paint(0, r * 8 + 7, FA_S, 1, "rgba(0,0,0,0.18)");
    for (let x = (r % 2) * 8; x < FA_S; x += 16) p.paint(x, r * 8, 1, 7, "rgba(0,0,0,0.14)");
    for (let x = (r % 2) * 8; x < FA_S; x += 16) if (rnd() < 0.3) p.paint(x + 1, r * 8, 15, 7, rnd() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.08)");
  }
  if (v === 0) p.window(42, 30, 44, 62, { transom: 20 });
  if (v === 1) {   // arched lintel (stepped)
    p.window(42, 34, 44, 58, { pane: { curtains: "#c0a888" } });
    for (let i = 0; i < 4; i++) p.rect(36 + i * 4, 30 - i * 3, 56 - i * 8, 3, "#b8a088", FA_TRIM);
  }
  if (v === 2) { p.window(18, 30, 36, 60, {}); p.window(74, 30, 36, 60, { pane: { blind: 0.5 } }); }
  if (v === 3) {   // with a fire escape landing
    p.window(42, 26, 44, 66, { mullion: true });
    p.rect(0, 100, FA_S, 3, "#2a2a2a", FA_TRIM);
    for (let x = 2; x < FA_S; x += 8) p.rect(x, 86, 2, 14, "#2a2a2a", FA_TRIM);
    p.rect(0, 85, FA_S, 2, "#2a2a2a", FA_TRIM);
  }
};

const faBrutalist: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, "#e2e0da"); p.speckle(rnd, 700);
  // board-marked concrete
  for (let y = 0; y < FA_S; y += 10) p.paint(0, y, FA_S, 1, "rgba(0,0,0,0.05)");
  if (v === 0 || v === 2) {
    p.rect(14, 46, 100, 30, "#55575a", FA_TRIM);
    p.pane(18, 50, 92, 24, { col: FA_GL_DARK, dark: "#18222f", streak: v === 0, blind: v === 2 ? 0.4 : 0 });
    p.paint(14, 46, 100, 4, "rgba(0,0,0,0.35)");
  } else {
    // deep fins with tall slot windows
    for (const x of [24, 74]) { p.rect(x, 14, 30, 90, "#4d4f52", FA_TRIM); p.pane(x + 4, 18, 22, 82, { col: FA_GL_DARK, dark: "#18222f", light: 0.85 }); }
    if (v === 3) for (const x of [0, 58, 120]) p.wall(x, 0, 8, FA_S, "#d6d4cc");
  }
};

const faCurtain: FaKind = (p, v, rnd) => {
  // Full-height glazing on a mullion grid.
  const glass = ["#24384f", "#2c4a4a", "#3a3428", "#334a66"][v], deep = ["#1b2a3c", "#203838", "#2b261c", "#263850"][v];
  p.rect(0, 0, FA_S, FA_S, FA_FRAME_DARK, FA_TRIM);
  const cols = v === 2 ? 3 : 2, rows = v === 1 ? 2 : 1;
  const cw = FA_S / cols, rh = FA_S / rows;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++)
    p.pane(c * cw + 1, r * rh + 1, cw - 2, rh - 2, { col: glass, dark: deep, streak: (c + r) % 2 === 0, blind: rnd() < 0.25 ? 0.2 + rnd() * 0.4 : 0 });
  p.rect(0, 100, FA_S, 4, FA_FRAME_DARK, FA_TRIM);   // the floor slab's edge, an opaque spandrel below
  p.rect(0, 104, FA_S, 24, deep, FA_TRIM);
  p.paint(0, 104, FA_S, 1, "rgba(255,255,255,0.15)");
};

const faApartment: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, FA_W0); p.speckle(rnd, 120);
  // A balcony faDoor and window, a balcony across the bottom.
  p.window(20, 18, 34, 92, { sill: false, surround: 3, pane: { curtains: v === 1 ? "#d8cbb0" : null } });
  p.window(70, 22, 38, 48, { surround: 3, pane: { blind: v === 2 ? 0.4 : 0 } });
  p.rect(6, 108, 116, 4, "#c4c2ba", FA_TRIM);   // slab
  if (v === 0 || v === 1) { p.rect(6, 84, 116, 2, "#2a2a2a", FA_TRIM); for (let x = 8; x < 122; x += 5) p.rect(x, 86, 1, 22, "#2a2a2a", FA_TRIM); }
  if (v === 2) { p.rect(6, 84, 116, 24, "#8aa0b0", FA_TRIM); p.paint(6, 84, 116, 2, "#5e6e7a"); }   // glass balustrade
  if (v === 3) { p.wall(6, 84, 116, 24, "#e2e0d8"); p.paint(6, 84, 116, 2, "rgba(0,0,0,0.15)"); }   // solid
  if (v !== 2) for (let i = 0; i < 3; i++) p.rect(84 + i * 10, 96 - (i % 2) * 4, 7, 12 + (i % 2) * 4, "#3e7a3a", FA_TRIM);   // plants
};

const faSiding: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, "#f2f1ee");
  const board = [8, 8, 12, 6][v];
  for (let y = 0; y < FA_S; y += board) { p.paint(0, y + board - 2, FA_S, 2, "rgba(0,0,0,0.13)"); p.paint(0, y, FA_S, 1, "rgba(255,255,255,0.25)"); }
  p.speckle(rnd, 60);
  if (v === 0) p.window(46, 28, 36, 52, { transom: 26, frame: "#f6f6f2" });
  if (v === 1) p.window(36, 26, 56, 52, { mullion: true, frame: "#f6f6f2", pane: { curtains: "#e6dcc6" } });
  if (v === 2) p.window(48, 22, 32, 66, { frame: "#f6f6f2", pane: { blind: 0.3 } });
  if (v === 3) { p.window(28, 30, 28, 44, { frame: "#f6f6f2" }); p.window(72, 30, 28, 44, { frame: "#f6f6f2" }); }
};

const faDoor: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, "#f2f1ee"); p.speckle(rnd, 60);
  for (let y = 0; y < FA_S; y += 8) p.paint(0, y + 6, FA_S, 2, "rgba(0,0,0,0.13)");
  const col = FA_DOORS[v];
  p.rect(40, 20, 48, 108, "#f6f6f2", FA_TRIM);
  p.rect(46, 26, 36, 102, col, FA_TRIM);
  // panels, or a glass light
  if (v === 1 || v === 3) p.pane(54, 34, 20, 34, { col: FA_GL, light: 0.8, streak: false });
  else { p.paint(52, 34, 10, 30, "rgba(0,0,0,0.15)"); p.paint(66, 34, 10, 30, "rgba(0,0,0,0.15)"); p.paint(52, 76, 10, 40, "rgba(0,0,0,0.15)"); p.paint(66, 76, 10, 40, "rgba(0,0,0,0.15)"); }
  p.rect(76, 76, 3, 6, "#d4b050", FA_TRIM);   // handle
  p.rect(46, 4, 36, 12, "#f6f6f2", FA_TRIM); p.pane(48, 6, 32, 8, { col: FA_GL, light: 0.7, streak: false });   // transom light
  p.rect(92, 44, 6, 10, "#e8d8a0", FA_GLASS(1));   // porch lamp
};

const faLobby: FaKind = (p, v, rnd) => {
  p.rect(0, 0, FA_S, FA_S, FA_FRAME_DARK, FA_TRIM);
  const glass = ["#4a6a80", "#3b5a66", "#5a6a78", "#466070"][v];
  p.pane(3, 3, FA_S - 6, FA_S - 6, { col: glass, dark: "#3a5262", light: 0.5 });
  p.rect(FA_S / 2 - 1, 0, 2, FA_S, FA_FRAME_DARK, FA_TRIM);
  p.rect(0, 30, FA_S, 3, FA_FRAME_DARK, FA_TRIM);
  // a pair of doors with push bars, a ceiling light strip inside
  p.rect(40, 40, 2, 88, "#9a9a9a", FA_TRIM); p.rect(86, 40, 2, 88, "#9a9a9a", FA_TRIM);
  p.rect(48, 80, 14, 2, "#c8c8c8", FA_TRIM); p.rect(66, 80, 14, 2, "#c8c8c8", FA_TRIM);
  p.rect(10, 34, FA_S - 20, 3, "#f0f0e0", FA_GLASS(0.9));
  if (v === 2) p.rect(12, 6, FA_S - 24, 20, "#e8e2cc", FA_GLASS(1));   // a lit name panel
  if (v === 3) for (let i = 0; i < 2; i++) p.rect(14 + i * 86, 96, 14, 32, "#3e7a3a", FA_GLASS(0.6));   // potted trees
};

const faRibbon: FaKind = (p, v, rnd) => {
  p.wall(0, 0, FA_S, FA_S, "#e8e7e2"); p.speckle(rnd, 200);
  const top = [40, 30, 36, 44][v], h = [40, 56, 46, 30][v];
  p.rect(0, top - 3, FA_S, h + 6, FA_FRAME_DARK, FA_TRIM);
  p.pane(0, top, FA_S, h, { col: v === 1 ? "#2c4a4a" : FA_GL, dark: v === 1 ? "#1f3636" : FA_GL_DEEP, blind: v === 2 ? 0.35 : 0 });
  for (let x = 0; x < FA_S; x += v === 3 ? 32 : 64) p.rect(x, top, 2, h, FA_FRAME_DARK, FA_TRIM);
  if (v === 3) p.paint(0, top + h + 3, FA_S, 6, "rgba(0,0,0,0.12)");
};


// ---- the storybook city's ----------------------------------------------------------------------
// Its tiles have thick trim (the trim keeps its own colour, bevelled light above and dark below) round round and arched
// glass with curtains, muntins and plants behind it, on walls the building's colour tints. The walls are papered
// in a pattern of its own (dots, wavy stripes, diamonds, scallops) and shaded under the storey's eave
// and over a dado band. The variants differ in shape so a tower's storeys don't repeat.
const FA_STORY_TRIM = ["#2a2440", "#fff3dc", "#e8333a", "#1fb5b0"];
const FA_STORY_CURT = ["#ff7fb5", "#f2c230", "#9a6cf0", "#6fe0e8"];
// The wall is tinted, with a pattern papered over it in a slightly lighter and darker tone, the eave's
// shadow along its top and a dado band along its foot.
function faStoryWall(p: FaPainter, v: number, rnd: () => number, base = "#f6f2ea") {
  p.wall(0, 0, FA_S, FA_S, base); p.speckle(rnd, 50);
  const lt = "rgba(255,255,255,0.22)", dk = "rgba(0,0,0,0.06)";
  if (v === 0) for (let y = 4; y < FA_S; y += 16) for (let x = (y / 16) % 2 ? 12 : 4; x < FA_S; x += 16) p.paint(x, y, 4, 4, lt);   // the pattern is polka dots
  else if (v === 1) for (let x = 0; x < FA_S; x += 16) for (let y = 0; y < FA_S; y++) p.paint(x + Math.round(Math.sin(y / 9) * 3), y, 5, 1, lt);   // the pattern is wavy stripes
  else if (v === 2) for (let y = 0; y < FA_S; y += 16) for (let x = 0; x < FA_S; x += 16) for (let k = 0; k < 6; k++) p.paint(x + 8 - k, y + 2 + k, 2 * k + 1, 1, (x / 16 + y / 16) % 2 ? lt : dk);   // the pattern is diamonds
  else for (let y = 10; y < FA_S; y += 14) for (let x = 0; x < FA_S; x += 14) for (let k = 0; k < 4; k++) p.paint(x + k, y + Math.round(Math.sqrt(16 - (k - 2) * (k - 2))), 1, 1, dk);   // the pattern is scallops
  p.paint(0, 0, FA_S, 4, "rgba(0,0,0,0.16)"); p.paint(0, 4, FA_S, 3, "rgba(0,0,0,0.07)");                       // this shades under the eave
  p.paint(0, 112, FA_S, 2, "rgba(255,255,255,0.18)"); p.paint(0, 114, FA_S, 14, "rgba(0,0,0,0.07)");           // this paints the dado band
}
// This paints a bevelled trim ring round a porthole, with rivets round it.
function faRing(p: FaPainter, cx: number, cy: number, r: number, w: number, col: string) {
  p.disc(cx, cy, r, col, FA_TRIM);
  p.disc(cx - 1, cy - 1, r - 1, col, FA_TRIM);
  for (let y = -r; y < r; y++) { const h = y + 0.5, ww = Math.sqrt(Math.max(0, r * r - h * h)); if (y < -r * 0.3) p.paint(cx - ww, cy + y, ww * 2, 1, "rgba(255,255,255,0.18)"); else if (y > r * 0.35) p.paint(cx - ww, cy + y, ww * 2, 1, "rgba(0,0,0,0.18)"); }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, rr = r - w / 2; p.rect(cx + Math.cos(a) * rr - 1, cy + Math.sin(a) * rr - 1, 2, 2, "#d4b050", FA_TRIM); }
}
// Glass in a disc has a room behind it, curtains drawn to the sides and a sheen.
function faPortGlass(p: FaPainter, cx: number, cy: number, r: number, curt: string, l = 1) {
  p.discGlass(cx, cy, r, l);
  // (The curtains are drawn to either side and gathered in at the middle by their ties.)
  for (let y = -r; y < r; y++) { const h = y + 0.5, w = Math.sqrt(Math.max(0, r * r - h * h)), cw = Math.min(w, r * (0.18 + 0.22 * Math.abs(h) / r)); if (cw > 0.5) { p.rect(cx - w, cy + y, cw, 1, curt, FA_GLASS(l * 0.5)); p.rect(cx + w - cw, cy + y, cw, 1, curt, FA_GLASS(l * 0.5)); } }
  p.paint(cx - r * 0.45, cy - r * 0.55, Math.max(2, r * 0.25), 2, "rgba(255,255,255,0.45)");
}
const faStorybook: FaKind = (p, v, rnd) => {
  faStoryWall(p, v, rnd);
  const t = FA_STORY_TRIM[v], cu = FA_STORY_CURT[v];
  if (v === 0) {   // variant 0 is a porthole, crossed, in a riveted ring, with a little hood over it
    faRing(p, 64, 56, 31, 9, t); faPortGlass(p, 64, 56, 21, cu);
    p.rect(62, 35, 4, 42, t, FA_TRIM); p.rect(43, 54, 42, 4, t, FA_TRIM);
    for (let k = 0; k < 5; k++) { const hx = 44 + k * 10, c = k % 2 ? t : "#fff3dc"; p.rect(hx - 5, 14, 10, 6, c, FA_TRIM); p.disc(hx, 20, 5, c, FA_TRIM, 0); }   // this paints a scalloped hood
    p.rect(38, 12, 52, 3, t, FA_TRIM);
    p.rect(52, 96, 24, 8, "#e8333a", FA_TRIM); for (let i = 0; i < 4; i++) p.disc(55 + i * 6, 93, 4, ["#ff7fb5", "#f2c230", "#a6e05a", "#9a6cf0"][i], FA_TRIM);
  } else if (v === 1) {   // variant 1 is a tall arch, its keystone, muntins and tied curtains; it has a box of flowers
    p.arch(36, 10, 56, 90, t, FA_TRIM); p.paint(37, 11, 3, 88, "rgba(255,255,255,0.2)"); p.paint(88, 30, 3, 70, "rgba(0,0,0,0.18)");
    p.archGlass(43, 17, 42, 80, 1, FA_GL, FA_GL_DEEP);
    for (let y = 26; y < 97; y++) { const cw = Math.max(0, 9 - Math.abs(y - 60) * 0.25); p.rect(43, y, cw, 1, cu, FA_GLASS(0.5)); p.rect(85 - cw, y, cw, 1, cu, FA_GLASS(0.5)); }
    p.rect(63, 17, 2, 80, t, FA_TRIM); p.rect(43, 55, 42, 2, t, FA_TRIM);
    p.rect(58, 6, 12, 10, "#fff3dc", FA_TRIM); p.paint(58, 6, 12, 2, "rgba(255,255,255,0.3)");   // this paints the keystone
    p.rect(32, 100, 64, 5, t, FA_TRIM); p.rect(40, 105, 48, 9, "#e8333a", FA_TRIM);
    for (let x = 40; x < 88; x += 6) p.paint(x, 105, 3, 9, "rgba(255,255,255,0.25)");
    for (let i = 0; i < 6; i++) p.disc(44 + i * 8, 99 - (i % 2) * 2, 4, ["#ff7fb5", "#f2c230", "#9a6cf0", "#a6e05a"][i % 4], FA_TRIM);
  } else if (v === 2) {   // variant 2 has two small portholes out of line and a striped band round the storey
    for (let x = 0; x < FA_S; x += 8) p.rect(x, 104, 8, 7, (x / 8) % 2 ? "#fff3dc" : t, FA_TRIM);
    faRing(p, 40, 44, 21, 7, t); faPortGlass(p, 40, 44, 14, cu);
    faRing(p, 88, 66, 21, 7, t); faPortGlass(p, 88, 66, 14, FA_STORY_CURT[(v + 1) % 4], 0.8);
  } else {   // variant 3 is a crooked window with muntins and a striped shutter hung off true
    for (let y = 0; y < 80; y++) { const dx = Math.round(y * 0.12); p.rect(30 + dx, 98 - y, 56, 1, t, FA_TRIM); if (y > 2 && y < 78) p.paint(30 + dx, 98 - y, 2, 1, "rgba(255,255,255,0.2)"); }
    for (let y = 6; y < 74; y++) { const dx = Math.round(y * 0.12); p.rect(37 + dx, 98 - y, 42, 1, y < 30 ? FA_GL_DEEP : FA_GL, FA_GLASS(y < 30 ? 0.75 : 1)); p.rect(37 + dx, 98 - y, 8, 1, cu, FA_GLASS(0.5)); p.rect(57 + dx, 98 - y, 2, 1, t, FA_TRIM); }
    for (let x = 37; x < 79; x++) p.rect(x + 5, 98 - 40, 1, 2, t, FA_TRIM);
    for (let y = 22; y < 100; y++) p.rect(92 + Math.round((100 - y) * 0.12), y, 14, 1, Math.floor(y / 8) % 2 ? "#ff7fb5" : "#fff3dc", FA_TRIM);
    p.rect(104, 30, 3, 3, "#2a2440", FA_TRIM); p.rect(104, 88, 3, 3, "#2a2440", FA_TRIM);   // these paint the hinges
  }
};
const faStoryShop: FaKind = (p, v, rnd) => {
  faStoryWall(p, (v + 2) % 4, rnd, "#f4eee4");
  const t = FA_STORY_TRIM[v], sc = [["#e8333a", "#fff3dc"], ["#1fb5b0", "#fff3dc"], ["#9a6cf0", "#f2c230"], ["#ff9a2e", "#fff3dc"]][v];
  // this paints a signboard and a scalloped, striped valance under it
  p.rect(0, 0, FA_S, 6, t, FA_TRIM); p.paint(0, 5, FA_S, 1, "rgba(0,0,0,0.3)");
  for (let x = 0; x < FA_S; x += 16) { const c = sc[(x / 16) % 2]; p.rect(x, 6, 16, 10, c, FA_TRIM); p.disc(x + 8, 16, 8, c, FA_TRIM, 0); p.paint(x, 6, 16, 2, "rgba(255,255,255,0.25)"); for (let y = 16; y < 24; y++) p.paint(x + 2, y, 12 - Math.abs(y - 16) * 1.5 > 0 ? 12 - Math.abs(y - 16) * 1.5 : 0, 1, "rgba(0,0,0,0.12)"); }
  // the shop window is an arch with its frame bevelled, muntins and a display of yarn on a shelf
  p.arch(4, 30, 86, 86, t, FA_TRIM); p.paint(5, 52, 3, 62, "rgba(255,255,255,0.22)"); p.paint(85, 52, 3, 62, "rgba(0,0,0,0.2)");
  p.archGlass(9, 35, 76, 79, 0.75, "#4a6a7a", "#3b5664");
  p.rect(46, 35, 2, 79, t, FA_TRIM); p.rect(9, 70, 76, 2, t, FA_TRIM);
  p.rect(10, 102, 74, 3, "#8a5a34", FA_GLASS(0.6));
  const goods = ["#ff7fb5", "#f2c230", "#6fe0e8", "#9a6cf0", "#a6e05a", "#ff9a2e"];
  for (let i = 0; i < 7; i++) { const gx = 16 + i * 10, gy = 96 - (rnd() * 6 | 0), c = goods[(i + v) % 6]; p.disc(gx, gy, 5, c, FA_GLASS(0.8)); p.paint(gx - 2, gy - 3, 2, 2, "rgba(255,255,255,0.5)"); }
  for (let i = 0; i < 4; i++) { const gx = 20 + i * 16; p.rect(gx, 80, 8, 10, goods[(i + v + 2) % 6], FA_GLASS(0.8)); p.rect(gx + 3, 78, 2, 2, "#ffffff", FA_GLASS(0.8)); }   // these are hats on stands
  // this paints a chequered stall riser
  for (let x = 0; x < 92; x += 6) for (let y = 116; y < 128; y += 6) p.rect(x, y, 6, 6, ((x + y) / 6) % 2 ? t : "#fff3dc", FA_TRIM);
  // the door is round-topped and panelled, with a round light in it
  p.arch(95, 34, 30, 94, t, FA_TRIM); p.arch(98, 37, 24, 91, ["#5e3a28", "#2b3a55", "#6b1f1f", "#2f4a3a"][v], FA_TRIM);
  p.paint(98, 37, 2, 91, "rgba(255,255,255,0.15)");
  p.paint(101, 76, 18, 18, "rgba(0,0,0,0.15)"); p.paint(101, 100, 18, 22, "rgba(0,0,0,0.15)");
  p.disc(110, 56, 7, "#d4b050", FA_TRIM); p.disc(110, 56, 5, FA_GL, FA_GLASS(0.8));
  p.rect(116, 86, 3, 8, "#d4b050", FA_TRIM);
};
const faStoryDoor: FaKind = (p, v, rnd) => {
  faStoryWall(p, (v + 1) % 4, rnd);
  const t = FA_STORY_TRIM[(v + 1) % 4], door = ["#e8333a", "#1fb5b0", "#9a6cf0", "#f2c230"][v];
  // the doorway has a bevelled arch, a keystone, the door's planks, two hinges, a knocker and a light
  p.arch(36, 16, 56, 112, t, FA_TRIM); p.paint(37, 30, 3, 98, "rgba(255,255,255,0.22)"); p.paint(88, 30, 3, 98, "rgba(0,0,0,0.2)");
  p.rect(58, 12, 12, 9, "#fff3dc", FA_TRIM);
  p.arch(43, 23, 42, 105, door, FA_TRIM);
  for (let x = 50; x < 85; x += 7) p.paint(x, 40, 1, 88, "rgba(0,0,0,0.13)");
  for (const y of [52, 104]) p.rect(43, y, 16, 3, "#2a2440", FA_TRIM);
  p.disc(64, 44, 9, "#d4b050", FA_TRIM); faPortGlass(p, 64, 44, 7, FA_STORY_CURT[v], 0.8); p.rect(63, 37, 2, 14, "#d4b050", FA_TRIM);
  p.disc(64, 74, 4, "#d4b050", FA_TRIM); p.disc(64, 74, 2, door, FA_TRIM);   // this is the knocker
  p.rect(77, 84, 3, 8, "#d4b050", FA_TRIM);
  p.rect(98, 30, 10, 2, "#2a2440", FA_TRIM); p.disc(104, 40, 6, "#ffe08a", FA_GLASS(1)); p.rect(100, 32, 8, 3, "#2a2440", FA_TRIM);   // this is a lamp on its bracket
  if (v % 2) for (let i = 0; i < 6; i++) p.disc(18 + (i % 2) * 6, 124 - i * 12, 5, ["#a6e05a", "#5fd3a0"][i % 2], FA_TRIM);   // odd variants have a climber up the side
  else { p.rect(12, 104, 16, 12, "#e8333a", FA_TRIM); for (let i = 0; i < 3; i++) p.disc(15 + i * 5, 101, 4, FA_STORY_CURT[(i + v) % 4], FA_TRIM); }   // even variants have a pot of tufts
};

const FA_KINDS: FaKind[] = [faOffice, faPunched, faDeco, faResidential, faStorefront, faIndustrial, faDock, faBlank, faBrick, faBrutalist, faCurtain, faApartment, faSiding, faDoor, faLobby, faRibbon, faStorybook, faStoryShop, faStoryDoor];

// The whole atlas, on two new canvases.
export function paintFacadeAtlas(): { colour: any; mask: any } {
  const c = makeCanvas(FA_W, FA_H), m = makeCanvas(FA_W, FA_H);
  for (const x of [c.g, m.g]) { x.imageSmoothingEnabled = false; x.fillStyle = "#000"; x.fillRect(0, 0, FA_W, FA_H); }
  for (let v = 0; v < FACADE_VARIANTS; v++)
    for (let k = 0; k < FA_KINDS.length; k++) {
      const id = k + FACADE_KINDS * v, x = (id % FACADE_GRID) * FA_S, y = Math.floor(id / FACADE_GRID) * FA_S;
      const p = new FaPainter(c.g, m.g, x, y);
      for (const g of [c.g, m.g]) { g.save(); g.beginPath(); g.rect(x, y, FA_S, FA_S); g.clip(); }
      FA_KINDS[k](p, v, mulberry32(0xfa0ade + id * 7919));
      c.g.restore(); m.g.restore();
    }
  return { colour: c.canvas, mask: m.canvas };
}
