// Test: the Victorian city's goods (cargo.ts VIC_CARGO) are all that is loaded or delivered in a
// Victorian city, and they are picked up nowhere else but as the freight the city before it brings
// in. It plays journeys from the city before Ravensgate to the start of the city after the one
// after it, and checks every step's ledger, every pickup and drop planned (its cargo, its site's
// facility among the cargo's sources or receivers, its truck and handling), that every pickup
// begun loads all its units, and the freight either side (journey.ts freightFor). It also checks
// that the picker never draws the Victorian goods unless asked, whatever its caller allows.
// The optional args are seeds (comma separated; default: the first three whose Ravensgate visit is
// city 1, 2 or 3).
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { journeyStyle } from "../src/styles.ts";
import { CARGO, CARGO_BY_ID, pickCargo, VIC_CARGO, VIC_FREIGHT, VIC_FREIGHT_IN } from "../src/cargo.ts";

const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2);
const vicAt = (seed: number) => { for (let N = 0; N < 12; N++) if (journeyStyle(seed, N).victorian) return N; return -1; };
const SEEDS: number[] = argv[0] ? argv[0].split(",").map(Number) : [];
for (let seed = 0; !argv[0] && SEEDS.length < 3 && seed < 400; seed++) if (vicAt(seed) >= 1 && vicAt(seed) <= 3) SEEDS.push(seed);
const PERIOD = new Set(["carry", "handTruck", "roll", "teamLift"]);
const fails: string[] = [], kinds = new Set<string>();
let pickups = 0, drops = 0, made = 0, steps = 0;
for (const seed of SEEDS) {
  const R = vicAt(seed);
  if (R < 1) { fails.push(`seed ${seed}: no Victorian city in its first 12`); continue; }
  const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn"), seen = new Set<string>();
  const fail = (m: string) => fails.push(`seed ${seed} city ${j.st.city} t${j.st.cityTime.toFixed(0)}: ${m}`);
  // The freight either side, and nowhere else Victorian.
  const fin = j.freightFor(R)?.cargo ?? "none", fout = j.freightFor(R + 1)?.cargo ?? "none";
  if (!VIC_FREIGHT_IN.includes(fin)) fails.push(`seed ${seed}: Ravensgate (city ${R}) arrives with ${fin}, not period freight`);
  if (!VIC_FREIGHT.includes(fout)) fails.push(`seed ${seed}: city ${R + 1} after Ravensgate arrives with ${fout}, not the brewery's`);
  for (let N = 1; N < 30; N++) {
    const f = j.freightFor(N)?.cargo;
    if (N !== R && N !== R + 1 && f && VIC_CARGO.has(f)) fails.push(`seed ${seed}: city ${N} arrives with ${f}`);
  }
  j.seekTo(j.nominalStart(R - 1));
  // (The pickup whose dwell is under way, and what was loaded when it began: it loads part way through.)
  let begun = null as { stop: unknown; loaded: number } | null;
  for (let guard = 400000; guard-- > 0 && j.st.city <= R + 1;) {
    const s0 = j.st.stops[0], dwell = j.st.mode === "dwell";
    if (dwell && s0?.kind === "pickup" && begun?.stop !== s0) begun = { stop: s0, loaded: j.st.loaded };
    j.step(); steps++;
    const st = j.st, here = st.city === R;
    if (st.loaded - st.unloaded !== j.aboardUnits) fail(`ledger ${st.loaded}-${st.unloaded} != ${j.aboardUnits}`);
    if (here) for (const a of st.aboard) if (!VIC_CARGO.has(a.cargo)) { fail(`${a.cargo} aboard`); break; }
    // (A pickup begun loads all its units.)
    if (dwell && s0?.kind === "pickup" && st.stops[0] !== s0 && st.city === R && begun?.stop === s0) {
      if (st.loaded - begun.loaded !== s0.units) fail(`pickup of ${s0.units} ${s0.cargo} at ${s0.site?.name} loaded ${st.loaded - begun.loaded}`);
      else made++;
    }
    for (const s of st.stops) {
      if (s.kind !== "pickup" && s.kind !== "drop") continue;
      const key = `${st.city}/${s.job}/${s.kind}/${s.site?.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = CARGO_BY_ID.get(s.cargo)!, vic = VIC_CARGO.has(s.cargo);
      if (here) {
        if (!vic) { fail(`${s.kind} of ${s.cargo} at ${s.site?.name}`); continue; }
        kinds.add(s.cargo);
        if (s.kind === "pickup") pickups++; else drops++;
        const fac = s.site!.fac;
        if (!(s.kind === "pickup" ? c.from : c.to).includes(fac)) fail(`${s.kind} of ${s.cargo} at ${s.site?.name}, a ${fac}`);
        if (!PERIOD.has(c.handling)) fail(`${s.cargo} handled by ${c.handling}`);
      } else if (vic) {
        // (Only the freight in, picked up last before, and the freight out, dropped first after.)
        const ok = s.kind === "pickup" ? st.city === R - 1 && s.cargo === fin : st.city === R + 1 && s.job === 0 && s.cargo === fout;
        if (!ok) fail(`${s.kind} of ${s.cargo} at ${s.site?.name} outside Ravensgate`);
      }
    }
    if (here && st.mode === "dwell" && st.truck !== "box16" && st.truck !== "box26") fail(`working in a ${st.truck}`);
  }
}
// The picker: whatever a caller's allow-list lets through, it never draws the Victorian goods
// unless asked for them (`own`); asked, it draws only what the allow-list lets through.
const allows: [string, ((c: { id: string }) => boolean) | undefined][] = [["none", undefined], ["everything", () => true], ["the Victorian goods", (c) => VIC_CARGO.has(c.id)], ["all ids", (c) => CARGO.some((k) => k.id === c.id)]];
for (const [what, allow] of allows) for (let i = 0; i < 4000; i++) {
  const c = pickCargo((i * 0.618034) % 1, (i * 0.414214) % 1, 0.5, i % 3 === 0 ? "winter" : i % 3 === 1 ? "autumn" : null, allow);
  if (c && VIC_CARGO.has(c.id)) { fails.push(`pickCargo with ${what} allowed drew ${c.id} without asking for the Victorian goods`); break; }
}
const drawn = new Set<string>();
for (let i = 0; i < 4000; i++) {
  const c = pickCargo((i * 0.618034) % 1, (i * 0.414214) % 1, 0.5, null, (k) => VIC_CARGO.has(k.id), VIC_CARGO);
  if (!c || !VIC_CARGO.has(c.id)) { fails.push(`pickCargo asked for the Victorian goods drew ${c?.id}`); break; }
  drawn.add(c.id);
}
if (drawn.size !== VIC_CARGO.size) fails.push(`pickCargo drew only ${drawn.size} of the ${VIC_CARGO.size} Victorian goods`);
console.log(`seeds ${SEEDS.join(",")}: ${steps} steps; in Ravensgate ${pickups} pickups (${made} made) and ${drops} drops of ${kinds.size} kinds (${[...kinds].join(", ")})`);
if (pickups < 6) fails.push(`only ${pickups} pickups in Ravensgate`);
if (kinds.size < 5) fails.push(`only ${kinds.size} kinds of Victorian goods moved`);
for (const f of fails.slice(0, 20)) console.log("FAIL " + f);
if (fails.length) proc.exit(1);
