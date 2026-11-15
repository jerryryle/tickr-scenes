// Signs, billboards and the marquee.
// Facility name signs and billboard ads share one atlas texture (1024x1024): the top half holds
// 64 name slots of 256x32 that chunks take when built and give back when disposed; the bottom
// half holds up to 24 billboard ads of 256x96, drawn once. So a chunk's signs and billboards are a
// single quad mesh with a single material. Everything is drawn lazily (bake(), called from
// render) because canvases only exist once the first frame has captured the canvas class; a
// chunk's sign mesh stays hidden until what it shows has been drawn.
// The marquee is a separate strip texture that scrolls (theatres, the concert hall, Baton Tower).
import * as THREE from "three@0.187.0";
import { hash2 } from "./rng.ts";
import { canBakeTextures, makeCanvas } from "./canvas.ts";
import { CityPlan } from "./city.ts";
import { FAC, facilityAt, facilityName, hasSign, isRyderFacility } from "./facilities.ts";
import type { FacilityDef } from "./facilities.ts";

const SIGN_W = 256, SIGN_H = 32, SIGN_COLS = 4, SIGN_ROWS = 16;
export const AD_W = 256, AD_H = 96, AD_COLS = 4, AD_ROWS = 6, AD_Y0 = 512;
const ATLAS_W = 1024, ATLAS_H = AD_Y0 + AD_ROWS * AD_H;

export interface SignStyle { bg: string; fg: string; logo: boolean; baton?: boolean }
interface SignJob { slot: number; text: string; style: SignStyle; baked: boolean }
export interface SignMesh { mesh: THREE.Mesh; slots: number[]; ads: boolean }

export class SignAtlas {
  readonly material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  logo: CanvasImageSource | null = null;      // logoWhite, for Ryder's own signs
  logoColor: CanvasImageSource | null = null; // logoColor, for Ryder billboards
  batonMark: CanvasImageSource | null = null; // the BATON wordmark (white), for Baton's own signs
  private canvas: { canvas: any; g: CanvasRenderingContext2D } | null = null;
  private texture: THREE.Texture | null = null;
  private free: number[] = [];
  private jobs = new Map<number, SignJob>();
  private meshes = new Set<SignMesh>();
  private adsBaked = false;
  constructor() { for (let i = SIGN_COLS * SIGN_ROWS - 1; i >= 0; i--) this.free.push(i); }

  // Reserve a name slot for `text`; -1 when the atlas is full (the chunk simply has no sign).
  alloc(text: string, style: SignStyle): number {
    const slot = this.free.pop();
    if (slot === undefined) return -1;
    this.jobs.set(slot, { slot, text, style, baked: false });
    return slot;
  }
  release(slot: number) {
    if (!this.jobs.delete(slot)) return;
    this.free.push(slot);
  }
  // A chunk's sign mesh, shown once its slots and the ads (if it uses them) are drawn.
  attach(mesh: THREE.Mesh, slots: number[], ads: boolean): SignMesh {
    const m = { mesh, slots, ads };
    this.meshes.add(m); this.refresh(m);
    return m;
  }
  detach(m: SignMesh) { this.meshes.delete(m); }
  private refresh(m: SignMesh) {
    m.mesh.visible = m.slots.every((k) => !!this.jobs.get(k)?.baked) && (!m.ads || this.adsBaked);
  }

  // UV rectangles (half a texel inset so filtering never reaches a neighbour).
  uv(slot: number) {
    const col = slot % SIGN_COLS, row = Math.floor(slot / SIGN_COLS);
    return this.rect(col * SIGN_W, row * SIGN_H, SIGN_W, SIGN_H);
  }
  adUV(ad: number) {
    const i = ((ad % ADS.length) + ADS.length) % ADS.length;
    return this.rect((i % AD_COLS) * AD_W, AD_Y0 + Math.floor(i / AD_COLS) * AD_H, AD_W, AD_H);
  }
  private rect(x: number, y: number, w: number, h: number) {
    return { u0: (x + 0.5) / ATLAS_W, u1: (x + w - 0.5) / ATLAS_W, v0: 1 - (y + h - 0.5) / ATLAS_H, v1: 1 - (y + 0.5) / ATLAS_H };
  }

  // Draw the ads (first call) and up to `max` pending name signs.
  bake(max = 3) {
    if (!canBakeTextures()) return;
    let dirty = false, n = 0;
    if (!this.canvas) this.create();
    if (!this.adsBaked) { ADS.forEach((ad, i) => this.drawAd(ad, i)); this.adsBaked = true; dirty = true; }
    for (const j of this.jobs.values()) {
      if (j.baked) continue;
      if (n++ >= max) break;
      this.draw(j);
      j.baked = true; dirty = true;
    }
    if (dirty) {
      this.texture!.needsUpdate = true;
      for (const m of this.meshes) this.refresh(m);
    }
  }

  private create() {
    this.canvas = makeCanvas(ATLAS_W, ATLAS_H);
    const tex = new THREE.Texture(this.canvas.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    this.texture = tex;
    this.material.map = tex; this.material.needsUpdate = true;
  }

  private draw(j: SignJob) {
    const g = this.canvas!.g;
    const x = (j.slot % SIGN_COLS) * SIGN_W, y = Math.floor(j.slot / SIGN_COLS) * SIGN_H;
    g.save();
    g.beginPath(); g.rect(x, y, SIGN_W, SIGN_H); g.clip();
    g.fillStyle = j.style.bg; g.fillRect(x, y, SIGN_W, SIGN_H);
    let left = x + 8, width = SIGN_W - 16;
    if (j.style.baton && this.batonMark) {
      // The wordmark, then what the place is (TOWER, LABS) in light spaced capitals.
      const h = 20, w = h * 612 / 184;
      g.drawImage(this.batonMark, x + 10, y + (SIGN_H - h) / 2, w, h);
      left = x + 20 + w; width = SIGN_W - 28 - w;
      j = { ...j, text: j.text.replace(/^Baton\s*/i, "").toUpperCase() };
    } else if (j.style.logo && this.logo) {
      const lw = 26 * (1791 / 512);
      g.drawImage(this.logo, x + 6, y + 3, lw, 26);
      left = x + 12 + lw; width = SIGN_W - 18 - lw;
    }
    g.fillStyle = j.style.fg;
    fitAtlasText(g, j.text, left + width / 2, y + SIGN_H / 2 + 1, width, 22);
    g.restore();
  }

  private drawAd(ad: Ad, i: number) {
    const g = this.canvas!.g;
    const x = (i % AD_COLS) * AD_W, y = AD_Y0 + Math.floor(i / AD_COLS) * AD_H;
    g.save();
    g.beginPath(); g.rect(x, y, AD_W, AD_H); g.clip();
    g.translate(x, y);
    ad(g, this);
    g.restore();
  }
}

// Centred bold text, shrunk to fit `width`.
function fitAtlasText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, width: number, size: number, weight = "bold") {
  g.textAlign = "center"; g.textBaseline = "middle";
  const font = (s: number) => `${weight} ${s}px sans-serif`;
  g.font = font(size);
  while (size > 8 && g.measureText(text).width > width) { size--; g.font = font(size); }
  g.fillText(text, cx, cy);
}

// ---- billboard ads ----------------------------------------------------------------------------
// Each draws into a 256x96 panel at the origin. Ryder ads, Baton in-jokes and the values, plus
// a few faded ghost signs for painting on old brick.
type Ad = (g: CanvasRenderingContext2D, atlas: SignAtlas) => void;
const RED = "#ce1126";
const panel = (bg: string): Ad => (g) => { g.fillStyle = bg; g.fillRect(0, 0, AD_W, AD_H); };
const headline = (text: string, y: number, color: string, size: number, w = 236) => (g: CanvasRenderingContext2D) => { g.fillStyle = color; fitAtlasText(g, text, AD_W / 2, y, w, size); };
const ad = (...parts: Ad[]): Ad => (g, a) => parts.forEach((p) => p(g, a));
const ryderLogo = (x: number, y: number, h: number, white = false): Ad => (g, a) => {
  const img = white ? a.logo : a.logoColor;
  if (img) g.drawImage(img, x, y, h * 1791 / 512, h);
};
// Small pictograms.
const tooth = (cx: number, cy: number, s: number, color = "#fffaf0"): Ad => (g) => {
  g.fillStyle = color; g.strokeStyle = "#333"; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - s, cy - s * 0.6);
  g.quadraticCurveTo(cx - s, cy - s * 1.2, cx - s * 0.4, cy - s * 1.1);
  g.quadraticCurveTo(cx, cy - s * 0.85, cx + s * 0.4, cy - s * 1.1);
  g.quadraticCurveTo(cx + s, cy - s * 1.2, cx + s, cy - s * 0.6);
  g.quadraticCurveTo(cx + s * 0.9, cy + s * 0.2, cx + s * 0.6, cy + s * 1.1);
  g.lineTo(cx + s * 0.25, cy + s * 0.2); g.lineTo(cx - s * 0.25, cy + s * 0.2); g.lineTo(cx - s * 0.6, cy + s * 1.1);
  g.quadraticCurveTo(cx - s * 0.9, cy + s * 0.2, cx - s, cy - s * 0.6);
  g.fill(); g.stroke();
};
const frog = (cx: number, cy: number, s: number): Ad => (g) => {
  g.fillStyle = "#3fae49"; g.beginPath(); g.ellipse(cx, cy, s * 1.3, s * 0.9, 0, 0, Math.PI * 2); g.fill();
  for (const k of [-1, 1]) {
    g.fillStyle = "#3fae49"; g.beginPath(); g.arc(cx + k * s * 0.6, cy - s * 0.75, s * 0.45, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(cx + k * s * 0.6, cy - s * 0.8, s * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#111"; g.beginPath(); g.arc(cx + k * s * 0.6, cy - s * 0.78, s * 0.14, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = "#1d5e24"; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy - s * 0.1, s * 0.6, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
};
const cup = (cx: number, cy: number, s: number, color = "#fff"): Ad => (g) => {
  g.fillStyle = color; g.fillRect(cx - s * 0.7, cy - s * 0.5, s * 1.4, s * 1.2);
  g.strokeStyle = color; g.lineWidth = s * 0.22; g.beginPath(); g.arc(cx + s * 0.8, cy, s * 0.35, -Math.PI / 2, Math.PI / 2); g.stroke();
  g.lineWidth = s * 0.14;
  for (const k of [-0.35, 0, 0.35]) { g.beginPath(); g.moveTo(cx + k * s, cy - s * 0.7); g.quadraticCurveTo(cx + k * s + s * 0.3, cy - s * 1.0, cx + k * s, cy - s * 1.4); g.stroke(); }
};
// Belle: a fluffy cream face, tan floppy ears, big dark eyes, a brown nose, a brown collar and tag.
const belle = (cx: number, cy: number, s: number): Ad => (g) => {
  g.fillStyle = "#d9b48c";
  for (const k of [-1, 1]) { g.beginPath(); g.ellipse(cx + k * s * 0.92, cy + s * 0.05, s * 0.36, s * 0.72, k * 0.25, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#5a3a26"; g.fillRect(cx - s * 0.6, cy + s * 0.78, s * 1.2, s * 0.18);                       // collar
  g.fillStyle = "#9aa0a6"; g.beginPath(); g.arc(cx, cy + s * 1.08, s * 0.13, 0, Math.PI * 2); g.fill();     // tag
  g.fillStyle = "#f4ead8"; g.beginPath(); g.arc(cx, cy, s * 0.9, 0, Math.PI * 2); g.fill();
  for (const [dx, dy, r] of [[-0.45, -0.75, 0.35], [0.1, -0.9, 0.38], [0.55, -0.7, 0.32]]) { g.beginPath(); g.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2); g.fill(); }   // fluffy top
  g.fillStyle = "#1e1410";
  for (const k of [-1, 1]) { g.beginPath(); g.arc(cx + k * s * 0.36, cy - s * 0.12, s * 0.16, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#ffffff";
  for (const k of [-1, 1]) { g.beginPath(); g.arc(cx + k * s * 0.36 + s * 0.05, cy - s * 0.17, s * 0.04, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#3a2218"; g.beginPath(); g.ellipse(cx, cy + s * 0.2, s * 0.17, s * 0.12, 0, 0, Math.PI * 2); g.fill();   // nose
  g.fillStyle = "#3a2218"; g.beginPath(); g.ellipse(cx, cy + s * 0.48, s * 0.22, s * 0.13, 0, 0, Math.PI); g.fill();      // smile
  g.fillStyle = "#c98b7a"; g.beginPath(); g.ellipse(cx, cy + s * 0.53, s * 0.1, s * 0.07, 0, 0, Math.PI); g.fill();       // tongue
};
const critter = (cx: number, cy: number, s: number, kind: "panda" | "capy" | "dog"): Ad => (g) => {
  const fur = kind === "panda" ? "#c4502a" : kind === "capy" ? "#8a6a48" : "#e9e3d6";
  g.fillStyle = fur; g.beginPath(); g.arc(cx, cy, s, 0, Math.PI * 2); g.fill();
  for (const k of [-1, 1]) { g.beginPath(); g.arc(cx + k * s * 0.75, cy - s * 0.75, s * (kind === "capy" ? 0.25 : 0.38), 0, Math.PI * 2); g.fill(); }
  if (kind === "panda") { g.fillStyle = "#fff"; for (const k of [-1, 1]) { g.beginPath(); g.ellipse(cx + k * s * 0.42, cy - s * 0.1, s * 0.3, s * 0.22, 0, 0, Math.PI * 2); g.fill(); } }
  if (kind === "capy") { g.fillStyle = "#6e5236"; g.beginPath(); g.ellipse(cx, cy + s * 0.35, s * 0.6, s * 0.45, 0, 0, Math.PI * 2); g.fill(); }
  if (kind === "dog") { g.fillStyle = "#7a5a3a"; for (const k of [-1, 1]) { g.beginPath(); g.ellipse(cx + k * s * 0.85, cy - s * 0.2, s * 0.28, s * 0.55, k * 0.3, 0, Math.PI * 2); g.fill(); } }
  g.fillStyle = "#111";
  for (const k of [-1, 1]) { g.beginPath(); g.arc(cx + k * s * 0.38, cy - s * 0.15, s * 0.11, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.arc(cx, cy + s * 0.22, s * 0.13, 0, Math.PI * 2); g.fill();
};
const ghost = (lines: string[]): Ad => (g) => {
  g.fillStyle = "#8f4c36"; g.fillRect(0, 0, AD_W, AD_H);
  g.strokeStyle = "rgba(40,20,10,0.35)"; g.lineWidth = 1;
  for (let yy = 6; yy < AD_H; yy += 8) { g.beginPath(); g.moveTo(0, yy); g.lineTo(AD_W, yy); g.stroke(); }   // mortar
  g.fillStyle = "rgba(238,226,196,0.55)";
  lines.forEach((t, i) => fitAtlasText(g, t, AD_W / 2, AD_H / (lines.length + 1) * (i + 1), 232, i === 0 ? 30 : 20));
};

const ADS: Ad[] = [
  // Ryder.
  ad(panel("#ffffff"), ryderLogo(24, 14, 52), headline("Trucks. Drivers. Done.", 82, "#222", 18)),
  ad(panel(RED), ryderLogo(70, 8, 34, true), headline("FLEET LEASING", 60, "#fff", 26), headline("from one truck to a thousand", 84, "#ffe4e4", 14)),
  ad(panel("#1d2a3a"), headline("DRIVE WITH US", 30, "#fff", 28), headline("Ryder is hiring drivers", 58, "#cfe0ff", 16), ryderLogo(88, 68, 22, true)),
  // Baton.
  ad(panel("#e8f4ff"), tooth(42, 52, 22), tooth(80, 58, 15), headline("ADDITIONAL TEETH", 32, "#0f3d6e", 24, 150), headline("Now in stock. Ask in the bathroom.", 64, "#333", 12, 150)),
  ad(panel("#1b4d2a"), frog(48, 54, 26), headline("FROG WEEK", 34, "#b6f5a0", 30, 150), headline("is next week", 66, "#fff", 18, 150)),
  ad(panel("#111111"), headline("BATON'S NEXT", 26, "#fff", 22), headline("TOP MODEL", 56, "#f5c542", 36), headline("now 97% accurate. Fierce.", 84, "#bbb", 13)),
  ad(panel("#d9f2e6"), (g) => { for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { g.fillStyle = (r + c) % 2 ? "#2f8f4a" : "#3aa75a"; g.fillRect(14 + c * 14, 30 + r * 15, 11, 14); g.fillStyle = "#cfd8d4"; g.fillRect(14 + c * 14, 30 + r * 15, 11, 2); } },
     headline("THE WALLS OF JERRYCO", 18, "#1f3d2a", 18), headline("Built one can", 52, "#1f3d2a", 16, 130), headline("at a time.", 72, "#1f3d2a", 16, 130)),
  ad(panel("#f7e7c6"), headline("SMELL-O-DESK", 26, "#6b2d0f", 28), headline("garlic · leather · espresso · bread", 54, "#6b2d0f", 13), headline("Remote triggered. Welcome back from Italy.", 78, "#6b2d0f", 11)),
  ad(panel("#2b1a12"), cup(40, 54, 22, "#f2e6d0"), headline("18 GRAMS IN.", 34, "#f2e6d0", 20, 160), headline("36 GRAMS OUT.", 60, "#f5b041", 20, 160), headline("Respect the extraction.", 82, "#c8b8a0", 11, 160)),
  ad(panel("#3a6b4a"), critter(56, 54, 26, "panda"), critter(200, 54, 26, "capy"), headline("CHESS", 34, "#fff", 22, 90), headline("CLUB", 58, "#fff", 22, 90), headline("Tues · Conf room B", 80, "#e0f0e0", 10, 90)),
  ad(panel("#f2b8c6"), belle(50, 42, 26), (g) => { g.fillStyle = "#5a1a2a"; fitAtlasText(g, "BELLE", 170, 34, 140, 34); fitAtlasText(g, "Office Dog of the Year", 170, 66, 140, 15); }),
  // The values.
  ad(panel("#0f2742"), headline("RESPECT", 32, "#fff", 34), headline("THE PROBLEM", 66, "#7fc4ff", 30)),
  ad(panel("#7a1020"), headline("EXTREME", 32, "#fff", 34), headline("OWNERSHIP", 66, "#ffd1d8", 32)),
  ad(panel("#f5c542"), headline("TEAMWORK MAKES", 34, "#222", 26), headline("THE DREAM WORK", 66, "#222", 26)),
  ad(panel("#ffffff"), headline("LIVE ABOVE", 30, "#111", 30), (g) => { g.fillStyle = "#111"; g.fillRect(20, 52, 216, 5); }, headline("THE LINE", 76, "#888", 22)),
  // Products and the board.
  ad(panel("#0e5aa8"), headline("RyderShare", 38, "#fff", 34), headline("Know where it is. Right now.", 72, "#d6ecff", 15)),
  ad(panel("#202833"), headline("RADIUS", 34, "#5fd3ff", 36), headline("Tools for the people who run the fleet", 70, "#fff", 12)),
  // Baton.
  ad(panel("#000000"), (g, a) => { if (a.batonMark) g.drawImage(a.batonMark, 48, 14, 160, 48); }, headline("Enabling Supply Chain on Autopilot", 78, "#ffffff", 14)),
  ad(panel("#181b27"), headline("Almost everything comes", 30, "#ffffff", 20), headline("from a truck*", 56, "#ffffff", 24),
     (g, a) => { if (a.batonMark) g.drawImage(a.batonMark, 168, 74, 66, 20); g.fillStyle = "#9aa3b8"; fitAtlasText(g, "*seriously", 52, 84, 80, 11, "normal"); }),
  ad(panel("#000000"), (g) => { g.fillStyle = "#ff8a00"; for (let c = 0; c < 48; c++) for (let r = 0; r < 4; r++) if ((c * 7 + r * 3) % 5 < 2) g.fillRect(8 + c * 5, 64 + r * 5, 3, 3); },
     headline("TICKR", 30, "#ff8a00", 34), headline("49,152 pixels of joy", 54, "#ffd08a", 13)),
  // Ghost signs, painted on brick long ago.
  ghost(["RYDER", "TRUCK RENTAL · EST. 1933"]),
  ghost(["ADDITIONAL TEETH", "5¢ · INQUIRE WITHIN"]),
  // Not a billboard: the BATON wordmark alone, for Baton Tower's crown.
  ad(panel("#000000"), (g, a) => { if (a.batonMark) g.drawImage(a.batonMark, 22, 14, 212, 64); }),
];
export const AD_BATON_MARK = ADS.length - 1, AD_RYDER = [0, 1, 2], AD_GHOST = [ADS.length - 3, ADS.length - 2], AD_BATON = [ADS.length - 6, ADS.length - 5];
export const AD_BILLBOARD = ADS.map((_, i) => i).filter((i) => !AD_GHOST.includes(i) && i !== AD_BATON_MARK);

const SIGN_BOARDS = ["#1f4f8f", "#2e6b3a", "#7a2e2e", "#3b3b42", "#8a5a1a", "#1d6f78", "#5b2d77", "#b0522a"];

// The sign for the facility on block (bx, bz), or null for homes.
export function facilitySign(plan: CityPlan, bx: number, bz: number): { text: string; style: SignStyle } | null {
  const id = facilityAt(plan, bx, bz);
  if (!hasSign(id)) return null;
  const name = facilityName(plan, id, bx, bz);
  if (/^Baton\b/.test(name)) return { text: name, style: { bg: "#000000", fg: "#e8eaf0", logo: false, baton: true } };
  if (isRyderFacility(id))
    return { text: (FAC[id] as FacilityDef).label.replace("Ryder ", ""), style: { bg: RED, fg: "#ffffff", logo: true } };
  const bg = SIGN_BOARDS[Math.floor(hash2(bx, bz, plan.seed, 0x5163) * SIGN_BOARDS.length)];
  return { text: name, style: { bg, fg: "#ffffff", logo: false } };
}

export const signAtlas = new SignAtlas();

// ---- marquee ----------------------------------------------------------------------------------
// One strip of LED-style text that scrolls across every marquee in the city.
const MARQUEE_TEXT = "  ★  FROG WEEK IS NEXT WEEK  ★  ADDITIONAL TEETH AVAILABLE  ★  RESPECT THE PROBLEM  ★  EXTREME OWNERSHIP  ★  " +
  "TEAMWORK MAKES THE DREAM WORK  ★  LIVE ABOVE THE LINE  ★  NOW SHOWING: BATON'S NEXT TOP MODEL  ★  BELLE IS A GOOD DOG  ★  " +
  "RED PANDA v CAPYBARA: THE REMATCH  ★  TICKR: 49,152 PIXELS OF JOY";
class Marquee {
  readonly material = new THREE.MeshBasicMaterial({ color: 0x120800 });   // dark until drawn
  private texture: THREE.Texture | null = null;
  update(t: number) {
    if (!this.texture) {
      if (!canBakeTextures()) return;
      const { canvas, g } = makeCanvas(2048, 32);
      g.fillStyle = "#120800"; g.fillRect(0, 0, 2048, 32);
      g.fillStyle = "#ffb000"; g.font = "bold 22px sans-serif"; g.textBaseline = "middle"; g.textAlign = "left";
      const w = g.measureText(MARQUEE_TEXT).width, scale = Math.min(1, 2040 / w);
      g.save(); g.scale(scale, 1); g.fillText(MARQUEE_TEXT, 4 / scale, 17); g.restore();
      const tex = new THREE.Texture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
      tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
      tex.repeat.set(0.18, 1); tex.needsUpdate = true;
      this.texture = tex; this.material.map = tex; this.material.color.setHex(0xffffff); this.material.needsUpdate = true;
    }
    this.texture.offset.x = (t * 0.018) % 1;
  }
}
export const marquee = new Marquee();
