// Exhaust and air-brake puffs: small cubes that rise, swell, then shrink away (a hard-edged
// "fade" that suits the LED wall better than alpha). In the storybook a puff is a little round
// cloud instead (`cloud`), which wobbles as it goes. One instanced mesh for each kind holds every
// puff in the world, so each costs one draw call. Puffs live in world space, so they stay behind a
// moving truck.
import * as THREE from "three@0.187.0";

export interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; color: THREE.Color; cloud: boolean }

function copyPuffs(from: Puff[], to: Puff[]): Puff[] {
  to.length = from.length;
  for (let i = 0; i < from.length; i++) {
    const p = from[i]; let q = to[i];
    if (!q) q = to[i] = { ...p, color: p.color.clone() };
    else { q.x = p.x; q.y = p.y; q.z = p.z; q.vx = p.vx; q.vy = p.vy; q.vz = p.vz; q.age = p.age; q.life = p.life; q.size = p.size; q.color.copy(p.color); q.cloud = p.cloud; }
  }
  return to;
}

// A puff's edge at `age`: it swells to 2.32 times its size over the first 60% of its life, then
// shrinks away.
export function puffScale(age: number, life: number, size: number) {
  const k = age / life;
  return size * (k < 0.6 ? 1 + k * 2.2 : (1 + 0.6 * 2.2) * (1 - (k - 0.6) / 0.4));
}

// A cloud a unit across, four round lumps, within the cube a plain puff fills.
function cloudGeometry() {
  const lumps: [number, number, number, number][] = [[0, -0.02, 0, 0.3], [-0.24, -0.12, 0.06, 0.2], [0.24, -0.1, -0.05, 0.22], [0.04, 0.2, 0.02, 0.22]];
  const pos: number[] = [], nrm: number[] = [];
  for (const [x, y, z, r] of lumps) {
    const g = new THREE.IcosahedronGeometry(r, 1), P = g.getAttribute("position"), N = g.getAttribute("normal");
    for (let i = 0; i < P.count; i++) { pos.push(P.getX(i) + x, P.getY(i) + y, P.getZ(i) + z); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

export class PuffSystem {
  readonly mesh: THREE.InstancedMesh;
  readonly clouds: THREE.InstancedMesh;
  private puffs: Puff[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  constructor(parent: THREE.Object3D, private max = 64) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // instances move freely; the bounding sphere would go stale
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.clouds = new THREE.InstancedMesh(cloudGeometry(), mat, max);
    this.clouds.count = 0;
    this.clouds.frustumCulled = false;
    this.clouds.setColorAt(0, new THREE.Color(1, 1, 1));
    parent.add(this.mesh, this.clouds);
  }
  emit(at: THREE.Vector3, vel: THREE.Vector3, color: number, size = 0.35, life = 1.6, cloud = false) {
    if (this.puffs.length >= this.max) this.puffs.shift();
    this.puffs.push({ x: at.x, y: at.y, z: at.z, vx: vel.x, vy: vel.y, vz: vel.z, age: 0, life, size, color: new THREE.Color(color), cloud });
  }
  // Saved puffs (`into`: an earlier save, its records filled again in place), and back: into the
  // puffs' own records where there are enough.
  save(into?: Puff[]): Puff[] { return copyPuffs(this.puffs, into ?? []); }
  load(s: Puff[]) { copyPuffs(s, this.puffs); this.update(0); }
  clear() { this.puffs.length = 0; this.mesh.count = 0; this.clouds.count = 0; }
  rebase(dx: number, dz: number) { for (const p of this.puffs) { p.x += dx; p.z += dz; } }
  update(dt: number) {
    let n = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) { this.puffs.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const drag = Math.pow(0.96, dt * 60); p.vx *= drag; p.vz *= drag;
    }
    let c = 0;
    for (const p of this.puffs) {
      const k = Math.max(puffScale(p.age, p.life, p.size), 0.001), M = p.cloud ? this.clouds : this.mesh, i = p.cloud ? c++ : n++;
      // (A cloud squashes and stretches as it goes, and turns a little.)
      const w = p.cloud ? 0.12 * Math.sin(p.age * 13) : 0;
      if (p.cloud) this.q.setFromAxisAngle(this.v.set(0, 1, 0), p.age * 1.5); else this.q.identity();
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(k * (1 + w), k * (1 - w), k * (1 + w)));
      M.setMatrixAt(i, this.m);
      M.setColorAt(i, p.color);
    }
    for (const [M, count] of [[this.mesh, n], [this.clouds, c]] as const) {
      M.count = count;
      M.instanceMatrix.needsUpdate = true;
      if (M.instanceColor) M.instanceColor.needsUpdate = true;
    }
  }
}
