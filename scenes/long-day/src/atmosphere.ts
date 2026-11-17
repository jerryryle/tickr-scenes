// Time of day and weather on screen.
// The time of day is the real local time on the board's clock (timeOfDay "cycle"; "day", "dusk"
// and "night" pin it): scene time t maps to the wall clock at setup plus t, so scrubbing the
// preview moves the sun too. The sun's height through the day sets the sky, the light and the
// haze; after dark the windows and streetlights come on and the truck runs its headlights.
// The weather (climate.ts) comes from the city, blended across the country drive: cloud greys
// the sky and flattens the light, fog pulls the haze in, rain and snow fall around the camera
// (stateless: every drop's position is a function of t), and storms flash.
import * as THREE from "three@0.187.0";
import { hash2, mulberry32 } from "./rng.ts";
import type { Config } from "./env.ts";
import { DEBUG_HOUR } from "./debug.ts";
import { Engine } from "./engine.ts";
import { weatherMix } from "./climate.ts";
import type { WeatherMix } from "./climate.ts";
import { Backdrop, hazeColor } from "./backdrop.ts";

export const NIGHT_GLOW = { value: 0 };     // facade material: lit windows and streetlights (0..1)

// Vehicle lamps after dark: geometry tagged aux.z -3 (headlamps) and -4 (tail lamps) glows in
// any material given this, by LAMPS_ON (0..1, set each frame).
export const LAMPS_ON = { value: 0 };
export function applyLampGlow(mat: THREE.Material) {
  const prev = mat.onBeforeCompile.bind(mat), prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uLampsOn = LAMPS_ON;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aAux;\nvarying float vLampTag;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLampTag = aAux.z;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLampTag;\nuniform float uLampsOn;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if (vLampTag < -2.5 && vLampTag > -3.5) totalEmissiveRadiance += uLampsOn * vec3(1.0, 0.92, 0.7) * 1.4;
  else if (vLampTag < -3.5 && vLampTag > -4.5) totalEmissiveRadiance += uLampsOn * vec3(1.0, 0.08, 0.06) * 1.1;`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|lamps-v1";
  mat.needsUpdate = true;
}

// Streetlight on people and things: the pools below are painted on the ground, so anything
// standing in one (the driver, a load, pedestrians) gets the same warm light from the nearest
// lamps through this. City chunks register their lamp heads (LAMP_SITES: an object and its lamps
// in its own coordinates); updateLampLights picks the few nearest a point each frame.
export const LAMP_SITES = new Map<THREE.Object3D, number[]>();
const LAMP_N = 32;
const LAMP_LIGHTS = { value: Array.from({ length: LAMP_N }, () => new THREE.Vector4(0, -100, 0, 0)) };
// The truck's headlights on the road ahead: (x, z) of the lit patch's centre, heading, strength.
const HEAD_N = 12;
export const HEAD_LIGHTS = { value: Array.from({ length: HEAD_N }, () => new THREE.Vector4(0, 0, 0, 0)) };   // [0]: the truck, then the nearest traffic (w: strength, also scales the patch)
// The height of the surface each vehicle's lights fall on (the road it is on: up on a freeway,
// a garage's roof, a hill), set with HEAD_LIGHTS.
export const HEAD_Y = { value: Array.from({ length: HEAD_N }, () => 0) };
// The truck's dome lights, cargo box and cab (Truck.interiorLight).
export const INTERIOR_LIGHT = { value: Array.from({ length: 4 }, () => new THREE.Vector4()) };
const lampTmp = new THREE.Vector3();
export function updateLampLights(at: THREE.Vector3) {
  const best: { d: number; x: number; y: number; z: number }[] = [];
  if (LAMPS_ON.value > 0) for (const [obj, lamps] of LAMP_SITES) {
    if (!obj.parent) continue;
    obj.updateWorldMatrix(true, false);
    for (let i = 0; i < lamps.length; i += 3) {
      lampTmp.set(lamps[i], lamps[i + 1], lamps[i + 2]).applyMatrix4(obj.matrixWorld);
      const d = Math.hypot(lampTmp.x - at.x, lampTmp.z - at.z);
      if (d > 110) continue;
      best.push({ d, x: lampTmp.x, y: lampTmp.y, z: lampTmp.z });
    }
  }
  // (Ties broken by position: LAMP_SITES's order depends on which chunks were built when, and a
  // scrubbed frame must light the same lamps as the played one.)
  best.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z || a.y - b.y);
  for (let i = 0; i < LAMP_N; i++) {
    const b = best[i];
    LAMP_LIGHTS.value[i].set(b ? b.x : 0, b ? b.y : -100, b ? b.z : 0, b ? 1 : 0);
  }
}
export function applyLampLight(mat: THREE.Material) {
  const prev = mat.onBeforeCompile.bind(mat), prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uLampLightOn = LAMPS_ON;
    shader.uniforms.uLampPos = LAMP_LIGHTS;
    shader.uniforms.uHeadLights = HEAD_LIGHTS; shader.uniforms.uHeadY = HEAD_Y;
    shader.uniforms.uInterior = INTERIOR_LIGHT;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLampWP;\nvarying vec3 vLampWN;")
      .replace("#include <project_vertex>", `#include <project_vertex>
  { vec4 lw = vec4(transformed, 1.0);
    vec3 ln = objectNormal;
  #ifdef USE_INSTANCING
    lw = instanceMatrix * lw; ln = mat3(instanceMatrix) * ln;
  #endif
    vLampWP = (modelMatrix * lw).xyz; vLampWN = normalize(mat3(modelMatrix) * ln); }`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vLampWP;\nvarying vec3 vLampWN;\nuniform float uLampLightOn;\nuniform vec4 uLampPos[${LAMP_N}];\nuniform vec4 uHeadLights[${HEAD_N}];\nuniform float uHeadY[${HEAD_N}];\nuniform vec4 uInterior[4];`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if (uLampLightOn > 0.0) {
    float lit = 0.0;
    for (int i = 0; i < ${LAMP_N}; i++) {
      vec4 L = uLampPos[i];
      float d = length(vLampWP.xz - L.xz);
      lit += L.w * (1.0 - smoothstep(0.5, 8.0, d)) * step(vLampWP.y, L.y);   // the pool's reach, below the lamp
    }
    // Headlights: an oval ahead of each vehicle, low down over the road it is on (not on what
    // is under it: the street under a freeway).
    float head = 0.0;
    for (int i = 0; i < ${HEAD_N}; i++) {
      vec4 V = uHeadLights[i];
      if (V.w <= 0.0) continue;
      vec2 hd = vLampWP.xz - V.xy;
      float hc = cos(V.z), hs = sin(V.z), sz = 0.55 + 0.45 * V.w;
      vec2 hl = vec2(hd.x * hc - hd.y * hs, hd.x * hs + hd.y * hc) / (vec2(8.5, 3.6) * sz);
      float dy = vLampWP.y - uHeadY[i];
      head += V.w * (1.0 - smoothstep(0.15, 1.0, dot(hl, hl))) * (1.0 - smoothstep(1.0, 2.6, dy)) * smoothstep(-2.5, -1.5, dy)
        * max(step(0.5, vLampWN.y), smoothstep(-0.6, -0.3, dy));
    }
    // (Never on what faces down, nor on the sides of what hangs below the road: a freeway deck's
    // underside and girders, seen from the street below. The road itself faces up.)
    head = min(head, 1.3) * smoothstep(-0.35, 0.05, vLampWN.y);
    // Dome lights: anything inside the cargo box or the cab.
    float dome = 0.0;
    for (int b = 0; b < 4; b += 2) {
      vec4 C = uInterior[b], H = uInterior[b + 1];
      vec3 q = vLampWP - C.xyz;
      float cy = cos(C.w), sy = sin(C.w);
      vec3 l = vec3(q.x * cy - q.z * sy, q.y, q.x * sy + q.z * cy);
      if (H.w > 0.5) {
        // (Tilted with the body: H.w is 2 + its pitch.)
        float p = H.w - 2.0, cp = cos(p), sp = sin(p);
        vec3 m = vec3(l.x * cp + l.y * sp, -l.x * sp + l.y * cp, l.z);
        if (all(lessThan(abs(m), H.xyz))) dome = 1.0 - 0.35 * (H.y - m.y) / (2.0 * H.y);   // brightest up by the lamp
      }
    }
    // Light scales with the surface's own colour (plus a little, so dark asphalt still shows it).
    totalEmissiveRadiance += (diffuseColor.rgb * 1.2 + 0.045) * uLampLightOn * (vec3(1.0, 0.78, 0.5) * min(lit, 1.3) + vec3(1.0, 0.93, 0.8) * head + vec3(1.0, 0.95, 0.85) * dome);
  }`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|lamplight-v8";
  mat.needsUpdate = true;
}

// Pools of light on the ground after dark (under streetlights, ahead of the headlights): soft
// discs added on top of what is there, bright in the middle and fading to nothing at the rim,
// drawn only when it is dark enough to see them.
function makePoolMaterial() {
  return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
const poolMat = makePoolMaterial();
export class PoolBuilder {
  private pos: number[] = []; private col: number[] = []; private c = new THREE.Color();
  // A disc at (x, y, z), radii rx along yaw's forward and rz across it.
  disc(x: number, y: number, z: number, rx: number, rz: number, yaw: number, color: number, strength: number, seg = 14) {
    this.c.set(color).multiplyScalar(strength);
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number) => [x + fx * Math.cos(a) * rx + fz * Math.sin(a) * rz, y, z + fz * Math.cos(a) * rx - fx * Math.sin(a) * rz];
      for (const v of [[x, y, z], p(a1), p(a0)]) this.pos.push(...v);
      this.col.push(this.c.r, this.c.g, this.c.b, 0, 0, 0, 0, 0, 0);
    }
  }
  build(material: THREE.Material = poolMat): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    const m = new THREE.Mesh(g, material); m.renderOrder = 1;
    return m;
  }
}

const SKY_KEYS: [number, number][] = [   // sun elevation (sin) -> clear sky colour
  [-0.35, 0x050b1e], [-0.12, 0x1a1f52], [-0.02, 0x5a3a78], [0.04, 0xd8683e], [0.12, 0xe89a5a], [0.22, 0x3f7ad0],
];
const HAZE_DAY = new THREE.Color(0xa8c2ec);

export class Atmosphere {
  private wall0 = Date.now();
  readonly sky = new THREE.Color(); readonly haze = new THREE.Color();
  elevation = 1; night = 0; weather: WeatherMix = weatherMix("clear");
  private tmp = new THREE.Color(); private tmp2 = new THREE.Color();
  private rain: THREE.InstancedMesh; private snow: THREE.InstancedMesh;
  private stars: THREE.InstancedMesh; private moon: THREE.Mesh;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(1, 1, 1);
  private fwd = new THREE.Vector3();
  flash = 0;

  constructor(private cfg: Config, scene: THREE.Scene, backdropScene: THREE.Scene) {
    const rg = new THREE.BoxGeometry(0.03, 0.9, 0.03);
    this.rain = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: 0xaab8cc, fog: false }), 900);
    this.snow = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xf4f7fa, fog: false }), 700);
    for (const m of [this.rain, this.snow]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    // Stars and the moon, in the backdrop's pass (they never move with the truck).
    this.stars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 260);
    const r = mulberry32(0x57a25);
    for (let i = 0; i < 260; i++) {
      const az = r() * Math.PI * 2, el = 0.08 + Math.asin(r()) * 0.9, d = 3000, s = 5 + r() * 7;
      this.m4.compose(this.v.set(Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(az) * Math.cos(el) * d), this.q, this.sc.set(s, s, s));
      this.stars.setMatrixAt(i, this.m4);
    }
    this.moon = new THREE.Mesh(new THREE.IcosahedronGeometry(60, 1), new THREE.MeshBasicMaterial({ color: 0xf2eedc, fog: false }));
    this.stars.frustumCulled = false;
    backdropScene.add(this.stars, this.moon);
  }

  // Make everything drawable for a precompile (or put it back).
  prepare(on: boolean) {
    this.rain.count = this.snow.count = on ? 1 : 0;
    this.stars.visible = this.moon.visible = on;
  }

  // Hours (0..24) at scene time t.
  hourAt(t: number) {
    if (DEBUG_HOUR >= 0) return DEBUG_HOUR;
    switch (this.cfg.timeOfDay) {
      case "day": return 12.5;
      case "dusk": return this.sunTimes().set - 0.1;
      case "night": return 23;
    }
    const d = new Date(this.wall0 + t * 1000);
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }
  // Sunrise and sunset for the real date (a mid-latitude day: about 9.5 h in December, 14.5 h
  // in June), and the sun's highest elevation.
  private sunTimes() {
    const now = new Date(this.wall0);
    const doy = (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000;
    const k = Math.cos(2 * Math.PI * (doy - 172) / 365);
    const len = 12 + 2.5 * k, noon = 12.6 + (k > 0 ? 0.5 : 0);   // summer time pushes noon later
    return { rise: noon - len / 2, set: noon + len / 2, max: 0.75 + 0.2 * k };
  }

  // Work out the sky, light and haze for scene time t and the weather, and apply them.
  update(t: number, engine: Engine, backdrop: Backdrop, daySky: number, weather: WeatherMix) {
    this.weather = weather;
    const h = this.hourAt(t), { rise, set, max } = this.sunTimes();
    // Sun elevation as a sine: up through the day, down through the night.
    const e = h >= rise && h <= set ? Math.sin(Math.PI * (h - rise) / (set - rise)) * max
      : -Math.sin(Math.PI * (((h - set + 24) % 24) / (24 - (set - rise)))) * 0.6;
    this.elevation = e;
    const dayK = THREE.MathUtils.smoothstep(e, -0.06, 0.2);
    this.night = 1 - THREE.MathUtils.smoothstep(e, -0.08, 0.06);
    // Clear sky by elevation, the city's day sky at the top.
    const keys: [number, number][] = [...SKY_KEYS, [0.35, daySky]];
    let i = 0;
    while (i < keys.length - 1 && e > keys[i + 1][0]) i++;
    if (i >= keys.length - 1) this.sky.setHex(daySky);
    else {
      const [e0, c0] = keys[i], [e1, c1] = keys[i + 1];
      this.sky.setHex(c0).lerp(this.tmp.setHex(c1), THREE.MathUtils.clamp((e - e0) / (e1 - e0), 0, 1));
    }
    if (e < keys[0][0]) this.sky.setHex(keys[0][1]);
    // Cloud greys it towards a sky-bright grey; fog whitens it.
    const lum = 0.15 + 0.75 * dayK;
    // (A slate blue rather than a pale grey: grey fills light every emitter and read as a glow.)
    this.tmp.setRGB(0.3 * lum, 0.38 * lum, 0.52 * lum, THREE.SRGBColorSpace);
    this.sky.lerp(this.tmp, weather.cloud * 0.85);
    // Storm lightning: brief flashes now and then, a function of t.
    const slot = Math.floor(t / 5.3), ph = t - slot * 5.3;
    this.flash = weather.storm > 0.5 && hash2(slot, 1, 0x11, 0xf1a5) < 0.35 && (ph < 0.12 || (ph > 0.22 && ph < 0.3)) ? 1 : 0;
    if (this.flash) this.sky.lerp(this.tmp.setHex(0xdfe6ff), 0.7);
    // Haze: the sky towards a pale blue by day, the sky darkened by night, whiter in fog.
    this.haze.copy(this.sky).lerp(this.tmp.copy(HAZE_DAY).multiplyScalar(0.12 + 0.88 * dayK), 0.3);
    this.haze.lerp(this.tmp.setRGB(0.5 * lum + 0.06, 0.56 * lum + 0.06, 0.66 * lum + 0.06, THREE.SRGBColorSpace), weather.fog * 0.5);
    engine.sky.copy(this.sky); engine.fog.color.copy(this.haze);
    // The backdrop's colours were baked against its day haze: scale them to tonight's.
    const base = hazeColor(daySky);
    const tint = backdrop.mat;
    tint.color.setRGB(Math.min(1.2, this.haze.r / base.r), Math.min(1.2, this.haze.g / base.g), Math.min(1.2, this.haze.b / base.b));
    // Light: a warm low sun, flattened by cloud; a cool moon after dark.
    const az = Math.PI * (0.15 + 0.7 * THREE.MathUtils.clamp((h - rise) / (set - rise), 0, 1));
    const sunUp = e > -0.02;
    const el = sunUp ? Math.max(0.05, Math.asin(Math.min(1, e))) : 0.7;
    const daz = sunUp ? az : az + Math.PI;
    engine.sunDir.set(-Math.cos(daz) * Math.cos(el) * 80, Math.sin(el) * 80, -Math.sin(daz) * Math.cos(el) * 80 + 20);
    const warm = THREE.MathUtils.smoothstep(e, 0.02, 0.35);
    if (sunUp) {
      engine.sun.color.setHex(0xffb070).lerp(this.tmp.setHex(0xffffff), warm);
      engine.sun.intensity = Engine.DAY.sun * THREE.MathUtils.smoothstep(e, -0.02, 0.18) * (1 - 0.75 * weather.cloud);
    } else {
      engine.sun.color.setHex(0x9ab0ff);
      engine.sun.intensity = 0.6 * (1 - weather.cloud);
    }
    engine.hemi.intensity = (0.8 + 1.2 * dayK) * (1 - 0.15 * weather.cloud) + this.flash * 2;
    engine.hemi.color.setHex(0x5a6ab0).lerp(this.tmp.setHex(0xcfe6ff), dayK);
    engine.hemi.groundColor.setHex(0x1a1a28).lerp(this.tmp.setHex(0x4a4030), dayK);
    poolMat.opacity = this.night; poolMat.visible = this.night > 0.03;
    NIGHT_GLOW.value = Math.max(this.night, 0.5 * weather.cloud * (1 - dayK * 0.6) * (weather.rain + weather.fog > 0.5 ? 1 : 0));
    // Stars and the moon: clear nights only.
    const starK = this.night * (1 - weather.cloud);
    this.stars.visible = this.moon.visible = starK > 0.05;
    (this.stars.material as THREE.MeshBasicMaterial).color.setScalar(starK);
    (this.moon.material as THREE.MeshBasicMaterial).color.setHex(0xf2eedc).multiplyScalar(starK);
    this.moon.position.set(-Math.cos(daz) * 1700, 900, -Math.sin(daz) * 1700);
  }

  // After the view distance is set for the frame: fog weather pulls the haze in.
  applyFog(engine: Engine) {
    const f = this.weather.fog;
    if (f <= 0.01) return;
    const far = engine.fog.far, near = engine.fog.near;
    engine.fog.far = far + (Math.max(55, far * 0.4) - far) * f;
    engine.fog.near = Math.min(engine.fog.far - 10, near + (Math.max(8, near * 0.15) - near) * f);
  }

  // Rain and snow in a box ahead of the camera.
  // The world moved by (dx, dz) under the camera: the rain and snow move with it.
  private ox = 0; private oz = 0;
  get offset(): [number, number] { return [this.ox, this.oz]; }
  set offset(o: [number, number]) { [this.ox, this.oz] = o; }
  rebase(dx: number, dz: number) { this.ox = (this.ox + dx) % 4600; this.oz = (this.oz + dz) % 4600; }
  precipitation(t: number, cam: THREE.Camera) {
    const w = this.weather;
    cam.getWorldDirection(this.fwd);
    const cx = cam.position.x + this.fwd.x * 18, cz = cam.position.z + this.fwd.z * 18, cy = Math.max(10, cam.position.y * 0.5);
    const W = 46, H = 26;
    const wrap = (v: number, lo: number, span: number) => lo + ((((v - lo) % span) + span) % span);
    const fill = (mesh: THREE.InstancedMesh, n: number, speed: number, sway: number, salt: number) => {
      mesh.count = n;
      for (let i = 0; i < n; i++) {
        const hx = hash2(i, 1, salt) * W, hz = hash2(i, 2, salt) * W, hy = hash2(i, 3, salt) * H;
        const sw = sway ? Math.sin(t * 0.9 + i) * sway : -t * 2.2;   // snow sways; rain slants with the wind
        const x = wrap(hx + sw + this.ox, cx - W / 2, W), z = wrap(hz + (sway ? Math.cos(t * 0.7 + i * 1.3) * sway : 0) + this.oz, cz - W / 2, W);
        const y = wrap(hy - t * speed, cy - H / 2, H);
        if (sway) this.q.identity(); else this.q.setFromAxisAngle(this.v.set(0, 0, 1), 0.15);
        this.m4.compose(this.v.set(x, Math.max(0.05, y), z), this.q, this.sc.set(1, 1, 1));
        mesh.setMatrixAt(i, this.m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };
    fill(this.rain, Math.round(900 * Math.min(1, w.rain)), 16, 0, 0x2a1);
    fill(this.snow, Math.round(700 * Math.min(1, w.snow)), 1.6, 0.6, 0x5a0);
  }
}
