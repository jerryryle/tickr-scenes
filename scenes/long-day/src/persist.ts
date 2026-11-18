// Journey persistence in board storage, so the scene resumes where it left off.
// Loading is bounded (`loadTimeout`) so a busy storage lock can't push setup() past the board's
// 15 s startup budget; a load that loses the race is ignored and the journey starts fresh.
// Saves are best-effort: one when the scene stops (teardown), and one every 20 minutes in case it never
// gets to stop cleanly (power loss, a crash). An offline board keeps running and saves later.
import type { Season } from "./climate.ts";

export interface SavedState {
  v: number;          // schema version; a mismatch starts a fresh journey
  seed: number;       // a changed seed starts a fresh journey
  random?: boolean;   // the seed was drawn at random (env seed 0), so any saved seed resumes
  season?: Season;    // the first city's season when the journey began
  simTime: number;    // seconds of journey simulated so far
  period?: number;    // seconds per city (cityMinutes, countrySeconds): a change starts a fresh journey
  journey: unknown;   // unused since version 4: the journey is a function of its time
}
export const STATE_VERSION = 4; // 4: deterministic journey, only the time is saved
const PERSIST_KEY = "journey";

export class Persistence {
  private saving = false;
  private lastSave = NaN; // set on the first tick, so the first save comes one interval in
  status = "not loaded";
  private readOnly = false;
  private pending: Promise<void> | null = null;
  constructor(private sys: SceneSys, private interval = 1200, private loadTimeout = 3000) {}

  // `period`: the journey's seconds per city, which places a saved time (absent from older saves).
  async load(seed: number, random = false, period?: number): Promise<SavedState | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((res) => { timer = setTimeout(() => res("timeout"), this.loadTimeout); });
    try {
      const read = this.sys.storage.board.transaction((tx) => tx.get<SavedState>(PERSIST_KEY));
      read.catch(() => {}); // a late failure after the timeout must not surface as unhandled
      const s = await Promise.race([read, timeout]);
      // A load that loses the race says nothing about what is stored: run a fresh journey but
      // never save it, so the stored one is still there next time.
      if (s === "timeout") { this.status = "load timed out (not saving)"; this.readOnly = true; return null; }
      const periodChanged = period !== undefined && s?.period !== undefined && s.period !== period;
      if (!s || s.v !== STATE_VERSION || (random ? !s.random : s.seed !== seed) || periodChanged) { this.status = s ? "reset (version/seed/period)" : "fresh"; return null; }
      this.status = "resumed";
      return s;
    } catch (e: any) {
      this.status = "load failed: " + (e?.code ?? "error") + " (not saving)"; this.readOnly = true;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Call every frame; writes at most once per interval, never awaits in render.
  tick(now: number, snapshot: () => SavedState) {
    if (this.readOnly) return;
    if (Number.isNaN(this.lastSave)) this.lastSave = now;
    if (this.saving || now - this.lastSave < this.interval) return;
    this.lastSave = now;
    this.write(snapshot());
  }

  // Save now, for teardown(): resolves when the write lands or fails, never rejects. Waits out a
  // periodic save already in flight, then writes the latest state over it.
  async flush(snapshot: () => SavedState): Promise<void> {
    if (this.readOnly) return;
    const state = snapshot();
    if (this.pending) await this.pending;
    await this.write(state);
  }

  private write(state: SavedState): Promise<void> {
    this.saving = true;
    const p = this.sys.storage.board
      .transaction((tx) => { tx.set(PERSIST_KEY, state); })
      .then(() => { this.status = "saved"; }, (e: any) => { this.status = "save failed: " + (e?.code ?? "error"); })
      .finally(() => { this.saving = false; if (this.pending === p) this.pending = null; });
    this.pending = p;
    return p;
  }
}
