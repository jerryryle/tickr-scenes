// Work done a piece at a time: a generator that yields between pieces of it, so it can be run a
// few pieces a frame ahead of when it is needed (CityPlan.prepare), or to its end at once (drain)
// when it is needed now. Either way it does the same work in the same order, so what it makes is
// the same. (Imports nothing: modules that load in the import cycle use it.)
export type Steps<T> = Generator<void, T, void>;
export function drain<T>(g: Steps<T>): T {
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
