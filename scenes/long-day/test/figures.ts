// Test: with a big material (main.ts gives the crowd the spotlit one), Figures draws people, dogs,
// pigeons and umbrellas wholly into its own mesh, which the driver spotlight leaves solid, and
// only boxes too big to be part of them (a vignette's food truck or couch) into the big mesh,
// which the spotlight thins.
import * as THREE from "three@0.187.0";
import { Figures } from "../src/figure.ts";

const scene = new THREE.Scene(), mat = new THREE.MeshLambertMaterial(), big = new THREE.MeshLambertMaterial();
const F = new Figures(scene, mat, 400, 0, { material: big, cap: 16 });
let fail = 0;
const check = (what: string, n: number, b: number) => {
  if (F.n !== n || F.b !== b) { console.log(`FAIL ${what}: ${F.n} small, ${F.b} big (want ${n}, ${b})`); fail++; }
};

F.begin();
// A tall adult striding with arms out, leaning, a child, a dog, a pigeon and an umbrella.
const look = { shirt: 0x2e86c1, pants: 0x222222, skin: 0xc68642, hair: 0x2a1a10 };
F.person({ x: 0, z: 0, yaw: 0.3, s: 1.15, lean: 0.4, legs: [0.6, -0.6], arms: [1.6, -1.2], armOut: [0.8, 0.8], ...look });
F.person({ x: 1, z: 0, yaw: 0, s: 0.6, ...look });
F.dog({ x: 2, z: 0, yaw: 0, phase: 0.5, gait: 1, color: 0x8a5a2a, size: 1.4, jump: 0.5, pitch: 0.6 });
F.pigeon(3, 0, 0, 0, 0, 1);
F.umbrella(4, 1, 0, F.handR, 0x333333);
const small = F.n;
check("people, a dog, a pigeon and an umbrella", small, 0);
if (small === 0) { console.log("FAIL nothing drawn"); fail++; }

// A food truck's body and a couch: big; a wheel: not.
F.box(0, 1.6, 0, 5.0, 2.3, 2.2, 0, 0, 0xc0392b);
F.box(0, 0.5, 0, 2.0, 0.45, 0.85, 0, 0, 0x2a7a7a);
F.box(0, 0.4, 0, 0.75, 0.75, 0.3, 0, 0, 0x1a1a1a);
check("props", small + 1, 2);
F.end_();
if (F.bigMesh!.count !== 2 || F.mesh.count !== small + 1) { console.log("FAIL mesh counts"); fail++; }

// Without a big material, everything stays in the one mesh.
const G = new Figures(scene, mat, 16);
G.begin(); G.box(0, 1.6, 0, 5.0, 2.3, 2.2, 0, 0, 0); G.end_();
if (G.n !== 1 || G.bigMesh !== null) { console.log("FAIL no big material"); fail++; }

if (fail) (globalThis as any).process.exit(1);
console.log("figures ok");
