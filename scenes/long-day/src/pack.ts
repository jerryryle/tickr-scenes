// Packed text (docs/long-day-cities.md, "How the scene carries the cities"): a city's layout and
// contents, and a road's map, as the scene carries them, compressed. packBytes runs when the scene
// is built (tools/pack.ts), unpackBytes when a city is planned or a road driven. The compression is
// LZ77 over the text's bytes (the text is ASCII: JSON), each token a run of literals or a copy of
// earlier text, its lengths and distances as variable-length numbers. It is plain TypeScript with
// no imports, so Node runs it as it is.

const PACK_MIN = 4, PACK_WINDOW = 1 << 16, PACK_CHAIN = 24;

export function packBytes(text: string): Uint8Array {
  const n = text.length, src = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const c = text.charCodeAt(i); if (c > 127) throw new Error("packBytes: ASCII only"); src[i] = c; }
  const out: number[] = [], head = new Int32Array(1 << 16).fill(-1), prev = new Int32Array(n).fill(-1);
  const num = (v: number) => { while (v >= 128) { out.push((v & 127) | 128); v >>>= 7; } out.push(v); };
  const hash = (i: number) => ((src[i] * 2654435761 ^ src[i + 1] * 40503 ^ src[i + 2] * 97 ^ src[i + 3]) >>> 0) & 0xffff;
  const add = (i: number) => { if (i + 3 < n) { const h = hash(i); prev[i] = head[h]; head[h] = i; } };
  let lit = 0, i = 0;
  const flush = (end: number) => { if (lit) { num(lit * 2); for (let k = end - lit; k < end; k++) out.push(src[k]); lit = 0; } };
  while (i < n) {
    let best = 0, dist = 0;
    if (i + PACK_MIN <= n) {
      for (let j = head[hash(i)], c = 0; j >= 0 && i - j <= PACK_WINDOW && c < PACK_CHAIN; j = prev[j], c++) {
        let l = 0;
        while (i + l < n && src[j + l] === src[i + l]) l++;
        if (l > best) { best = l; dist = i - j; }
      }
    }
    if (best >= PACK_MIN) {
      flush(i);
      num((best - PACK_MIN) * 2 + 1); num(dist);
      for (let k = 0; k < best; k++) add(i + k);
      i += best;
    } else { add(i); lit++; i++; }
  }
  flush(n);
  return Uint8Array.from(out);
}

export function unpackBytes(bytes: Uint8Array): string {
  const len = bytes.length;
  let out = new Uint8Array(Math.max(1024, len * 8)), n = 0, i = 0;
  const num = () => { let v = 0, sh = 0, b: number; do { b = bytes[i++]; v += (b & 127) * 2 ** sh; sh += 7; } while (b & 128); return v; };
  const room = (k: number) => { if (n + k > out.length) { const o2 = new Uint8Array(Math.max(out.length * 2, n + k)); o2.set(out); out = o2; } };
  while (i < len) {
    const t = num();
    if (t & 1) {
      const l = (t >>> 1) + PACK_MIN, d = num();
      room(l);
      for (let k = 0; k < l; k++) out[n + k] = out[n - d + k];
      n += l;
    } else {
      const l = t >>> 1;
      room(l);
      out.set(bytes.subarray(i, i + l), n); n += l; i += l;
    }
  }
  let s = "";
  for (let k = 0; k < n; k += 8192) s += String.fromCharCode(...out.subarray(k, Math.min(n, k + 8192)));
  return s;
}
