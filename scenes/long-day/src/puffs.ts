// Exhaust and air-brake puffs: small cubes that rise, swell, then shrink away (a hard-edged
// "fade" that suits the LED wall better than alpha). One instanced mesh for every puff in the
// world, so it costs one draw call. Puffs live in world space, so they stay behind a moving truck.
import * as THREE from "three@0.187.0";

interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; color: THREE.Color }

export class PuffSystem {
  readonly mesh: THREE.InstancedMesh;
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
    parent.add(this.mesh);
  }
  emit(at: THREE.Vector3, vel: THREE.Vector3, color: number, size = 0.35, life = 1.6) {
    if (this.puffs.length >= this.max) this.puffs.shift();
    this.puffs.push({ x: at.x, y: at.y, z: at.z, vx: vel.x, vy: vel.y, vz: vel.z, age: 0, life, size, color: new THREE.Color(color) });
  }
  save() { return this.puffs.map((p) => ({ ...p, color: p.color.clone() })); }
  load(s: Puff[]) { this.puffs = s.map((p) => ({ ...p, color: p.color.clone() })); this.update(0); }
  clear() { this.puffs.length = 0; this.mesh.count = 0; }
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
    for (const p of this.puffs) {
      const k = p.age / p.life;
      const scale = p.size * (k < 0.6 ? 1 + k * 2.2 : (1 + 0.6 * 2.2) * (1 - (k - 0.6) / 0.4));
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.setScalar(Math.max(scale, 0.001)));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
