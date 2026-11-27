// The skyline backdrop: distant silhouettes for the city's style (a suspension bridge across the
// bay, a far skyline, mesas, smokestacks, farm hills, evergreen hills under a snowy peak). It is
// drawn in its own pass before the world, from a camera at the origin that shares the main
// camera's rotation, so it never moves with the truck and sits beyond the fogged edge of the
// streamed city. Colours are hazed towards the sky; it is unlit (MeshBasic).
import * as THREE from "three@0.187.0";
import { mulberry32 } from "./rng.ts";
import { sbCurve, sbTube } from "./city-storybook/storybook-buildings-town.ts";
import { Batch } from "./geom.ts";
import type { CityStyle } from "./styles.ts";
import { shade } from "./city.ts";

const BACKDROP_R = 900;
// Horizon haze for a sky colour: the fog colour, the backdrop's ground and what distant
// silhouettes fade towards.
export function hazeColor(sky: number) { return new THREE.Color(sky).lerp(new THREE.Color(0xa8c2ec), 0.3); }

export class Backdrop {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 3, 10, 4000);
  readonly mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });   // tinted by the atmosphere
  private mesh: THREE.Mesh | null = null;

  build(style: CityStyle, seed: number) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const b = new Batch(), r = mulberry32(seed ^ 0xbac4d);
    const sky = hazeColor(style.sky), tmp = new THREE.Color();
    // Ground out to the horizon in the haze colour, under everything.
    b.cyl(0, -0.5, 0, 4000, 1, sky.getHex(), 24);
    const haze = (c: number, k = 0.4) => tmp.set(c).lerp(sky, k).getHex();
    const at = (ang: number, dist = BACKDROP_R) => [Math.cos(ang) * dist, Math.sin(ang) * dist] as const;
    const col = style.backdropColor;
    // A low ridge all the way round, so the horizon is never bare.
    const ridge = (h0: number, h1: number, c: number, dist = BACKDROP_R + 150, n = 90) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, [x, z] = at(a, dist), h = h0 + (h1 - h0) * (0.5 + 0.5 * Math.sin(a * 5 + seed) * Math.sin(a * 3.3));
        b.box(x, h / 2, z, 2 * Math.PI * dist / n * 1.08, h, 20, haze(c, 0.5), -a + Math.PI / 2);
      }
    };
    switch (style.backdrop) {
      case "bridge": {
        ridge(20, 70, col);
        // A long suspension bridge across part of the horizon.
        const a0 = r() * Math.PI * 2, span = 0.55, steps = 60;
        const red = haze(0xc0442a, 0.3);
        for (let i = 0; i <= steps; i++) {
          const a = a0 + (i / steps - 0.5) * span, [x, z] = at(a);
          b.box(x, 22, z, 2 * BACKDROP_R * span / steps * 1.1, 3, 8, haze(0x4a4f57, 0.35), -a + Math.PI / 2);   // deck
          // Main cable: up from the anchorages to the tower tops, sagging across the main span.
          const u = i / steps;
          const cable = u < 0.3 ? 25 + 73 * (u / 0.3) : u > 0.7 ? 25 + 73 * ((1 - u) / 0.3) : 40 + 58 * Math.pow((u - 0.5) / 0.2, 2);
          b.box(x, cable, z, 2 * BACKDROP_R * span / steps * 1.1, 1.6, 2, red, -a + Math.PI / 2);
          if (i % 3 === 0) b.box(x, (22 + cable) / 2, z, 0.8, cable - 22, 0.8, red);
        }
        for (const u of [0.3, 0.7]) {
          const a = a0 + (u - 0.5) * span, [x, z] = at(a);
          for (const k of [-6, 6]) b.box(x + Math.sin(a) * k, 50, z - Math.cos(a) * k, 5, 100, 5, red, -a);
          b.box(x, 92, z, 5, 4, 16, red, -a); b.box(x, 60, z, 5, 3, 16, red, -a);
        }
        break;
      }
      case "skyline": {
        ridge(10, 30, col, BACKDROP_R + 250);
        for (let i = 0; i < 150; i++) {
          const a = r() * Math.PI * 2, d = BACKDROP_R + r() * 200, [x, z] = at(a, d), h = 30 + Math.pow(r(), 2) * 190, w = 16 + r() * 30;
          b.box(x, h / 2, z, w, h, w, haze(shade(col, 0.8 + r() * 0.4), 0.3 + (d - BACKDROP_R) / 600), -a);
          if (h > 150) b.box(x, h + 15, z, 1.5, 30, 1.5, haze(0x3a4050, 0.3));
        }
        break;
      }
      case "mesas": {
        ridge(25, 60, shade(col, 0.85), BACKDROP_R + 300);
        for (let i = 0; i < 26; i++) {
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R + r() * 150), h = 40 + r() * 70, w = 80 + r() * 160;
          b.box(x, h / 2, z, w, h, w * 0.5, haze(col, 0.35), -a);
          b.box(x, h + 2, z, w * 0.98, 4, w * 0.48, haze(0xd9a070, 0.35), -a);           // lit cap rock
          b.box(x, h * 0.25, z, w * 1.35, h * 0.5, w * 0.7, haze(shade(col, 0.85), 0.35), -a); // talus
        }
        break;
      }
      case "spires": {
        // The Victorian city's is a smoky town round the horizon: rows of slate roofs, church towers
        // with their spires, a dome or two on a drum, mill chimneys with smoke hanging off them, and
        // gasholders in their iron frames.
        ridge(18, 34, col, BACKDROP_R + 200);
        const roofC = haze(0x3e444c, 0.35), wallC = (k: number) => haze(shade(col, 0.8 + k * 0.3), 0.32), smoke = haze(0x8e8a84, 0.12);
        for (let i = 0; i < 110; i++) {   // the town's roofs, in rows
          const a = (i / 110) * Math.PI * 2 + r() * 0.03, d = BACKDROP_R + 40 + r() * 160, [x, z] = at(a, d), w = 30 + r() * 40, h = 18 + r() * 22, dd = 16 + r() * 10;
          b.box(x, h / 2, z, w, h, dd, wallC(r()), -a + Math.PI / 2);
          b.prism(x, h + dd * 0.22, z, w, dd * 0.44, dd + 1, roofC, -a + Math.PI / 2);
        }
        for (let i = 0; i < 16; i++) {   // church towers and their spires
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R + 20 + r() * 120), th = 50 + r() * 35, tw = 10 + r() * 5, sh = 50 + r() * 60, c = wallC(0.3 + r() * 0.3);
          b.box(x, th / 2, z, tw, th, tw, c, -a);
          if (r() < 0.75) b.cone(x, th + sh / 2, z, tw * 0.62, sh, haze(0x3a4048, 0.32), 8, 0, -a + Math.PI / 8);
          else for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.cone(x + px * tw * 0.4, th + 5, z + pz * tw * 0.4, 1.6, 10, c, 4);   // a tower with pinnacles
        }
        for (let i = 0; i < 2; i++) {   // a dome on its drum, its lantern
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R + 60 + r() * 60), R = 22 + r() * 8, c = wallC(0.6);
          b.box(x, 25, z, R * 3, 50, R * 2.4, c, -a);
          b.cyl(x, 50 + R * 0.5, z, R, R, c, 14);
          b.lathe("bdDome", [[1, 0], [0.92, 0.4], [0.7, 0.72], [0.36, 0.94], [0.14, 1]], x, 50 + R, z, R * 1.04, R * 1.1, haze(0x6a7a78, 0.3), 14);
          b.cyl(x, 50 + R * 2.1 + 4, z, 3.4, 8, c, 8); b.cone(x, 50 + R * 2.1 + 12, z, 3.6, 8, haze(0x6a7a78, 0.3), 8);
        }
        for (let i = 0; i < 26; i++) {   // mill chimneys, smoke drifting off the tops of most
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R + r() * 150), h = 80 + r() * 70, rr = 3.6 + r() * 2;
          b.lathe("bdChimney", [[1, 0], [0.6, 1], [0, 1]], x, 0, z, rr, h, haze(0x6a3e30, 0.32), 6);
          if (r() < 0.7) for (let k = 0; k < 4; k++) b.ico(x - Math.sin(a) * k * 14 + Math.cos(a) * k * 4, h + 7 + k * 5, z + Math.cos(a) * k * 14 + Math.sin(a) * k * 4, 8 + k * 3.5, smoke, 0.55, k);
        }
        for (let i = 0; i < 3; i++) {   // gasholders: the bell, the iron frame of columns round it, its rings
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R + 30 + r() * 80), R = 32 + r() * 12, H = 40 + r() * 20, iron = haze(0x4a3028, 0.32);
          b.cyl(x, H * 0.45, z, R, H * 0.9, haze(0x5e625a, 0.32), 14);
          for (let k = 0; k < 10; k++) { const t = (k / 10) * Math.PI * 2; b.box(x + Math.cos(t) * (R + 2), H / 2 + 3, z + Math.sin(t) * (R + 2), 2.2, H + 6, 2.2, iron); }
          for (const y of [H * 0.55, H + 5]) b.tubeSeg(x, y, z, R + 2.3, 2, iron, 14);
        }
        break;
      }
      case "stacks": {
        ridge(15, 35, col);
        for (let i = 0; i < 60; i++) {
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R + r() * 100), w = 30 + r() * 60, h = 15 + r() * 25;
          b.box(x, h / 2, z, w, h, w * 0.6, haze(shade(col, 0.9 + r() * 0.2), 0.35), -a);
          if (r() < 0.5) b.cyl(x, h + 30, z, 3, 60 + r() * 30, haze(0x7a4a3a, 0.35), 6);
        }
        break;
      }
      case "farmhills": {
        for (let i = 0; i < 70; i++) {
          const a = (i / 70) * Math.PI * 2 + r() * 0.05, [x, z] = at(a, BACKDROP_R + r() * 200), rad = 90 + r() * 120;
          b.ico(x, -rad * 0.6, z, rad, haze(shade(col, 0.85 + r() * 0.3), 0.4), 0.55);
        }
        for (let i = 0; i < 6; i++) {   // a few silos and a farm water tower on the hills
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R - 50);
          b.cyl(x, 14, z, 4, 28, haze(0xb8bcc0, 0.4), 8); b.cone(x, 30, z, 4.4, 5, haze(0x8a9096, 0.4), 8);
        }
        break;
      }
      case "storyhills": {
        // The storybook city's are round hills banded in contour stripes (each is a stack of domes, each
        // smaller and higher than the last, so their rims show as stripes), and tall bent spires
        // striped up their length, leaning over.
        const bands = [0xa6e05a, 0x5fcf8a, 0xf3e07a, 0x5fcf8a, 0xff9fc0];
        for (let i = 0; i < 46; i++) {
          const a = (i / 46) * Math.PI * 2 + r() * 0.06, [x, z] = at(a, BACKDROP_R + r() * 220), rad = 80 + r() * 110, k0 = Math.floor(r() * 5);
          for (let k = 0; k < 4; k++) { const f = 1 - k * 0.2; b.ico(x, -rad * 0.55 + rad * k * 0.16, z, rad * f, haze(bands[(k0 + k) % bands.length], 0.35), 0.55, a + k * 1.12); }
        }
        for (let i = 0; i < 14; i++) {
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R + 60 + r() * 120), H = 70 + r() * 90, bend = (r() - 0.5) * 50, tx = -Math.sin(a), tz = Math.cos(a);
          const seg = 7, cols = [haze(0x1fb5b0, 0.35), haze(r() < 0.5 ? 0xff7fb5 : 0xfbe58a, 0.35)];
          for (let k = 0; k < seg; k++) {
            const u = (k + 0.5) / seg, off = bend * u * u, rad = 9 * (1 - u) + 1.2;
            b.cyl(x + tx * off, H * u, z + tz * off, rad, H / seg + 0.5, cols[k % 2], 8, 0, 0, a + k);
          }
          b.ico(x + tx * bend, H + 2, z + tz * bend, 3.5, haze(0xf2c230, 0.3));
        }
        // Curly clouds are heaps of puffs, each with a curl of cloud at its end.
        for (let i = 0; i < 12; i++) {
          const a = r() * Math.PI * 2, [x, z] = at(a, BACKDROP_R - 100 + r() * 150), y = 150 + r() * 110, ex = -Math.sin(a), ez = Math.cos(a), w = haze(0xfffaf0, 0.12);
          for (let k = 0; k < 4; k++) b.ico(x + ex * (k - 1.5) * 16, y + Math.sin(k * 1.7 + i) * 6, z + ez * (k - 1.5) * 16, 13 + Math.sin(k * 2.1 + i) * 4, w, 0.65, a + k);
          sbTube(b, sbCurve(7, (t) => [x + ex * (34 + Math.cos(t * 7) * 9 * (1 - t)), y + Math.sin(t * 7) * 9 * (1 - t), z + ez * (34 + Math.cos(t * 7) * 9 * (1 - t))]), () => 3.2, () => w, 6, a);
        }
        break;
      }
      case "evergreens": {
        // A big snowy peak over dark forested hills.
        const a0 = r() * Math.PI * 2, [px, pz] = at(a0, BACKDROP_R + 500);
        b.cone(px, 160, pz, 420, 320, haze(0x6a7a8a, 0.35), 10);
        b.cone(px, 270, pz, 150, 100, haze(0xf2f4f8, 0.25), 10);
        for (let i = 0; i < 80; i++) {
          const a = (i / 80) * Math.PI * 2, [x, z] = at(a, BACKDROP_R + r() * 120), rad = 70 + r() * 80;
          b.ico(x, -rad * 0.55, z, rad, haze(col, 0.35), 0.6);
          for (let k = 0; k < 3; k++) { const [tx, tz] = at(a + (r() - 0.5) * 0.06, BACKDROP_R - 20 + r() * 40); b.cone(tx, 18 + r() * 25, tz, 7, 30, haze(shade(col, 0.8), 0.3), 6); }
        }
        break;
      }
    }
    this.mesh = b.build(this.mat);
    if (this.mesh) { this.mesh.scale.y = Math.max(0.001, this.presence); this.scene.add(this.mesh); }
    this.built = `${style.id}/${seed}`;
  }
  built = "";
  // How far the silhouettes stand above the horizon (1: the city's own; they sink away on the road
  // out of town and the next city's rise on the road in).
  private presence = 1;
  setPresence(p: number) { this.presence = p; if (this.mesh) this.mesh.scale.y = Math.max(0.001, p); }

  // Match the main camera's direction and lens; the backdrop has no parallax.
  sync(main: THREE.PerspectiveCamera) {
    this.camera.position.set(0, main.position.y, 0);
    this.camera.quaternion.copy(main.quaternion);
    if (this.camera.fov !== main.fov || this.camera.aspect !== main.aspect) {
      this.camera.fov = main.fov; this.camera.aspect = main.aspect; this.camera.updateProjectionMatrix();
    }
  }
}
