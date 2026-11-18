// Test: when a saved journey resumes and when the board starts afresh (Persistence.load), and
// when it saves (tick, flush), against a stand-in for board storage.
import { Persistence, STATE_VERSION } from "../src/persist.ts";
import type { SavedState } from "../src/persist.ts";

{
  const proc = (globalThis as any).process;
  const errs: string[] = [];
  const expect = (what: string, ok: boolean) => { if (!ok) errs.push(what); };

  // Board storage: "ok" keeps values, "hang" never answers, "fail" rejects. Counts the writes.
  type Mode = "ok" | "hang" | "fail";
  function board(mode: Mode, stored?: SavedState) {
    const values = new Map<string, unknown>();
    if (stored) values.set("journey", stored);
    const b = { writes: 0, values, sys: null as unknown as SceneSys };
    const tx = { get: (k: string) => values.get(k), set: (k: string, v: unknown) => { values.set(k, JSON.parse(JSON.stringify(v))); b.writes++; } };
    const transaction = (cb: (t: typeof tx) => unknown) =>
      mode === "hang" ? new Promise(() => {}) : mode === "fail" ? Promise.reject({ code: "unavailable" }) : Promise.resolve().then(() => cb(tx));
    b.sys = { storage: { board: { transaction } } } as unknown as SceneSys;
    return b;
  }
  const PERIOD = 30 * 60 + 45;
  const state = (o: Partial<SavedState> = {}): SavedState => ({ v: STATE_VERSION, seed: 42, simTime: 5000, period: PERIOD, journey: null, ...o });

  // Resuming: the same version, seed and period.
  {
    const p = new Persistence(board("ok", state()).sys, 1200, 50);
    const s = await p.load(42, false, PERIOD);
    expect("resumes the same seed and period", s?.simTime === 5000 && p.status === "resumed");
  }
  // Starting afresh: nothing stored, another seed, another version, another period.
  expect("fresh with nothing stored", (await new Persistence(board("ok").sys, 1200, 50).load(42, false, PERIOD)) === null);
  expect("fresh for another seed", (await new Persistence(board("ok", state()).sys, 1200, 50).load(7, false, PERIOD)) === null);
  expect("fresh for another version", (await new Persistence(board("ok", state({ v: STATE_VERSION - 1 })).sys, 1200, 50).load(42, false, PERIOD)) === null);
  expect("fresh for another period", (await new Persistence(board("ok", state()).sys, 1200, 50).load(42, false, 5 * 60 + 45)) === null);
  // A save from before periods were kept resumes.
  expect("resumes a save without a period", (await new Persistence(board("ok", state({ period: undefined })).sys, 1200, 50).load(42, false, PERIOD))?.simTime === 5000);
  // A random journey (seed 0) resumes whatever random journey is stored, but not a chosen seed's.
  expect("random resumes a random journey", (await new Persistence(board("ok", state({ random: true })).sys, 1200, 50).load(0, true, PERIOD))?.seed === 42);
  expect("random does not resume a chosen seed", (await new Persistence(board("ok", state()).sys, 1200, 50).load(0, true, PERIOD)) === null);

  // Saving: the first tick starts the interval; a save each interval after; flush saves at once.
  {
    const b = board("ok"), p = new Persistence(b.sys, 100, 50);
    await p.load(42, false, PERIOD);
    p.tick(10, () => state({ simTime: 10 }));
    p.tick(109, () => state({ simTime: 109 }));
    expect("no save before an interval has passed", b.writes === 0);
    p.tick(110, () => state({ simTime: 110 }));
    await p.flush(() => state({ simTime: 111 }));
    expect("a save after an interval, and one on flush", b.writes === 2 && (b.values.get("journey") as SavedState).simTime === 111);
  }
  // A read that times out or fails leaves what is stored alone: never saves.
  for (const mode of ["hang", "fail"] as Mode[]) {
    const b = board(mode), p = new Persistence(b.sys, 100, 20);
    const s = await p.load(42, false, PERIOD);
    p.tick(0, () => state()); p.tick(500, () => state());
    await p.flush(() => state());
    expect(`${mode}: starts afresh without saving (${p.status})`, s === null && b.writes === 0 && /not saving/.test(p.status));
  }

  console.log(`persist: ${errs.length ? errs.length + " failed" : "ok"}`);
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
