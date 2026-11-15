// Seeded randomness so generation is reproducible from env.seed.
// mulberry32: a sequence generator. hash2/hash3: stateless coordinate hashes (murmur3-style
// per-input mixing plus fmix32 avalanche), so nearby inputs and nearby seeds are uncorrelated.
// Inputs are floored to integers; pass a distinct `salt` for each independent property.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngMix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
  h ^= k; h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}
function rngFmix(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash2(x: number, y: number, seed = 0, salt = 0): number {
  let h = rngMix(seed | 0, salt | 0);
  h = rngMix(h, Math.floor(x) | 0);
  h = rngMix(h, Math.floor(y) | 0);
  return rngFmix(h);
}
export function hash3(x: number, y: number, z: number, seed = 0, salt = 0): number {
  return rngFmix(rngMix(rngMix(rngMix(rngMix(seed | 0, salt | 0), Math.floor(x) | 0), Math.floor(y) | 0), Math.floor(z) | 0));
}

// mulberry32 with its state in the open, so a simulation using it can be saved and restored.
export class Rng {
  constructor(public s: number) { this.s >>>= 0; }
  readonly next = () => {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
