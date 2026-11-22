// Building facades from one texture atlas. Walls are Batch.wall quads whose aAux holds (u, v,
// tile): u counts bays across the wall, v counts floors up it, and the shader repeats the tile
// with fract(). A colour atlas, and a mask in the same layout saying what the building's vertex
// colour tints (wall) and what keeps its own colour (glass, frames, doors), so one tile serves
// every wall colour.
// The atlas is the one facadeart.ts paints once canvases exist (the first frame, before anything is
// drawn: setFacadeAtlas): 8x8 tiles of 128 px, each kind in FACADE_VARIANTS variants (tile = kind
// + 16 * variant), its mask also saying which pixels are glass lit from inside after dark, and how
// brightly. Primitives in the same batch keep aux.z = -1 and render as plain vertex colour, so a
// chunk's buildings, roofs and trim are a single draw call.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { NIGHT_GLOW } from "./atmosphere.ts";
import { hash2 } from "./rng.ts";
import { FACADE_GRID, FACADE_TILE, FACADE_VARIANTS } from "./facadeart.ts";

function atlasTexture(image: CanvasImageSource): THREE.Texture {
  const tex = new THREE.Texture(image as any);
  // Uploaded as plain RGBA8 and decoded to linear in the shader: mipmap generation for sRGB8
  // textures is unreliable on some GL implementations (missing levels sample as black).
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;            // crisp up close (dashboard and side shots)
  tex.minFilter = THREE.LinearMipmapLinearFilter; // no shimmer in the moving overhead chase
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// A number as a GLSL float literal (always with a point, never in exponent form).
const glslFloat = (v: number) => { const t = v.toFixed(40).replace(/0+$/, ""); return t.endsWith(".") ? t + "0" : t; };

// (No atlas until setFacadeAtlas gives it one, on the first frame.)
export function makeFacadeMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uFacade = { value: null as THREE.Texture | null }, uMask = { value: null as THREE.Texture | null };
  mat.userData.facade = { uFacade, uMask };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uFacade, uMask });
    shader.uniforms.uNight = NIGHT_GLOW;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aAux;\nvarying vec3 vAux;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAux = aAux;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAux;\nuniform sampler2D uFacade;\nuniform float uNight;\nuniform sampler2D uMask;")
      .replace("#include <color_fragment>", `
  // Gradients and samples are taken unconditionally: derivatives inside non-uniform control flow
  // are undefined in GLSL, and some GPUs return garbage there.
  const float GRID = ${glslFloat(FACADE_GRID)};
  vec2 tsz = vec2(1.0 / GRID);   // one tile, in texture coordinates
  vec2 gx = dFdx(vAux.xy) * tsz, gy = dFdy(vAux.xy) * tsz;
  float tileId = floor(max(vAux.z, 0.0) + 0.5); // interpolation can turn 8.0 into 7.9999
  float kind = mod(tileId, 16.0);
  // Tile i sits at column i % cols, row i / cols from the top of the image (flipY puts row 0 at the top of v).
  vec2 cell = vec2(mod(tileId, GRID), GRID - 1.0 - floor(tileId / GRID));
  // Keep half a texel inside the tile so filtering never picks up the neighbour; gradients come
  // from the unwrapped coordinates, so fract() seams don't drop to the smallest mip.
  const float INSET = ${glslFloat(0.5 / FACADE_TILE)};
  vec2 st = (cell + clamp(fract(vAux.xy), INSET, 1.0 - INSET)) * tsz;
  vec4 msk = textureGrad(uMask, st, gx, gy);
  vec4 fac = vec4(sRGBTransferEOTF(textureGrad(uFacade, st, gx, gy)).rgb, msk.r);
  if (vAux.z < 0.0) fac = vec4(1.0);
#ifdef USE_COLOR
  diffuseColor.rgb *= mix(fac.rgb, fac.rgb * vColor.rgb, fac.a);
#endif`)
      // After dark (atmosphere.ts): about half the windows lit, one room per bay and floor (offices
      // and lobbies: two per bay, and more of them lit), in warm lamplight, cool office light or
      // a television's blue, each a little brighter or dimmer; and the streetlight heads
      // (aux.z = -2) glowing. The mask says which pixels are glass and how brightly they glow
      // (blinds, curtains).
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  {
    float glass = vAux.z < 0.0 ? 0.0 : msk.g * msk.b;
    float work = step(abs(kind - 0.0), 0.5) + step(abs(kind - 10.0), 0.5) + step(abs(kind - 15.0), 0.5) + step(abs(kind - 14.0), 0.5) + step(abs(kind - 9.0), 0.5);
    vec2 cid = floor(vAux.xy * vec2(1.0 + work, 1.0)) + vec2(tileId * 7.13, tileId * 3.7);
    float r1 = fract(sin(dot(cid, vec2(12.9898, 78.233))) * 43758.5453);
    float r2 = fract(sin(dot(cid, vec2(39.3468, 11.1351))) * 24634.6345);
    float lit = step(0.5 - 0.15 * work, r1);
    vec3 warm = vec3(1.0, 0.75, 0.4), cool = vec3(0.7, 0.78, 0.9), tv = vec3(0.45, 0.55, 1.0) * 0.6;
    vec3 lc = work > 0.5 ? mix(cool, warm, step(0.8, r2)) : r2 < 0.1 ? tv : r2 < 0.28 ? mix(warm, cool, 0.5) : warm;
    float bright = 0.7 + 0.45 * fract(r2 * 7.0);
    totalEmissiveRadiance += uNight * glass * lit * lc * 0.85 * bright;
    if (vAux.z < -1.5) totalEmissiveRadiance += uNight * vec3(1.0, 0.86, 0.55) * 1.3;
  }`);
  };
  mat.customProgramCacheKey = () => "facade-v7";
  return mat;
}

// Give a facade material the atlas facadeart.ts painted.
export function setFacadeAtlas(mat: THREE.Material, atlas: { colour: CanvasImageSource; mask: CanvasImageSource }) {
  const u = mat.userData.facade;
  u.uFacade.value?.dispose(); u.uMask.value?.dispose();
  u.uFacade.value = atlasTexture(atlas.colour); u.uMask.value = atlasTexture(atlas.mask);
}

// Which variant of each kind a building gets (the same on all its sides and storeys): a hash of
// where it stands in its chunk and the chunk (setFacadeChunk, by whoever builds chunks).
let FACADE_SALT = 0;
export function setFacadeChunk(cx: number, cz: number, seed: number) { FACADE_SALT = Math.floor(hash2(cx, cz, seed, 0xfa5) * 2 ** 30); }
function buildingVariant(x: number, z: number): number {
  return Math.floor(hash2(Math.round(x * 2), Math.round(z * 2), FACADE_SALT, 0xfacade) * FACADE_VARIANTS);
}
const withVariant = (tile: number, v: number) => tile < 0 ? tile : tile % 16 + 16 * v;

// A band of identical storeys. `tile` may instead list one tile per side (+z, +x, -z, -x), e.g.
// dock doors on a warehouse's yard side only.
export interface FacadeBand { tile: number | readonly number[]; floors: number; floorH: number }

export const BAY = 3.4; // target bay width in metres; walls round to whole bays

// Wall a box footprint with facade bands stacked from y0: e.g. a storefront band then office
// floors. `doorSide` (0..3 in the order +z, +x, -z, -x) gets `doorTile` in the middle bay of the
// first band, for houses and lobbies. Returns the top height.
export function facadeBox(b: Batch, x0: number, z0: number, x1: number, z1: number, y0: number,
                          bands: FacadeBand[], color: number, doorSide = -1, doorTile = -1): number {
  const corners = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
  const variant = buildingVariant(x0 + x1, z0 + z1);
  doorTile = withVariant(doorTile, variant);
  let y = y0;
  bands.forEach((band, bi) => {
    const h = band.floors * band.floorH;
    for (let s = 0; s < 4; s++) {
      const tile = withVariant(typeof band.tile === "number" ? band.tile : band.tile[s], variant);
      const [ax, az] = corners[s], [bx, bz] = corners[(s + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const bays = Math.max(1, Math.round(len / BAY));
      if (bi === 0 && s === doorSide && doorTile >= 0 && bays >= 1) {
        // Split the first band's wall into [0,k) door [k+1,n) so the door is a whole bay.
        const k = Math.floor(bays / 2), f0 = k / bays, f1 = (k + 1) / bays;
        const lerp = (f: number) => [ax + (bx - ax) * f, az + (bz - az) * f];
        const [px, pz] = lerp(f0), [qx, qz] = lerp(f1);
        if (k > 0) b.wall(ax, az, px, pz, y, y + h, color, tile, 0, k, 0, band.floors);
        b.wall(px, pz, qx, qz, y, y + band.floorH, color, doorTile, 0, 1, 0, 1);
        if (band.floors > 1) b.wall(px, pz, qx, qz, y + band.floorH, y + h, color, tile, 0, 1, 1, band.floors - 1);
        if (bays - k - 1 > 0) b.wall(qx, qz, bx, bz, y, y + h, color, tile, 0, bays - k - 1, 0, band.floors);
      } else {
        b.wall(ax, az, bx, bz, y, y + h, color, tile, 0, bays, 0, band.floors);
      }
    }
    y += h;
  });
  return y;
}
