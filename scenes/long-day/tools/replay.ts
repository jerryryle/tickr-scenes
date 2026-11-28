// Reproduces a moment a board showed (make replay). From the run's start line, which main.ts logs
// once as the scene starts, and the board's local time of the moment, it plays the run headless
// with its street life up to then, and finds the visit the moment falls in. For a test render of
// that visit from its spec (debug.ts DEBUG_VISIT), from shortly before the moment to shortly after,
// it writes the defines (defines.txt), tickr-scene's --clock, --tz and --env (render-args.txt) and
// the seconds to render (secs.txt). A visit plays the same from its spec as in the run
// (test/visitspec.ts), so the render shows what the board did, from the director's own camera.
// Args: "<start line>" <moment, the board's local time: HH:MM[:SS] on the run's day, or
//       YYYY-MM-DDTHH:MM[:SS]> <seconds before> <seconds after> <out dir>
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, setDoorProbe, setParkedProbe, setPavementProbe } from "../src/journey.ts";
import { kerbDoors, parkedObstacles, pavementObstacles } from "../src/city.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { CLOCK } from "../src/vignettes.ts";
import { clockHour, glowAt } from "../src/atmosphere.ts";
import { seasonAt } from "../src/climate.ts";

const replayProc = (globalThis as any).process, replayFs = replayProc.getBuiltinModule("node:fs");
const replayFail = (msg: string): never => { console.error(`replay: ${msg}`); replayProc.exit(2); throw new Error(msg); };
const [replayLine = "", replayAt = "", replayBefore = "30", replayAfter = "60", replayOut = "."] = replayProc.argv.slice(2);

// The start line: "Long Day: seed S, starting at journey time Xs, clock C ZONE[, settings {...}]",
// C with its UTC offset. The tool keeps the board's time zone, as the render does (--tz).
const replayM = /seed (\d+), starting at journey time ([\d.]+)s, clock (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d) (\S+?)(?:, settings (\{.*\}))?$/.exec(replayLine.trim())
  ?? replayFail(`no start line in "${replayLine}" (it reads "Long Day: seed ..., starting at journey time ...s, clock ... <zone>")`);
const [, replaySeed, replayBase, replayClock, replayZone, replaySettings] = replayM;
replayProc.env.TZ = replayZone;
const replayWall0 = new Date(replayClock).getTime(), replayStart = Number(replayBase);
const replayEnv = { seed: Number(replaySeed), ...(replaySettings ? JSON.parse(replaySettings) : {}) };

// The moment, as the board's local time: on the run's day (the next day if that is before the
// run began) unless given with its date.
const replayMoment = (() => {
  if (/^\d{4}-/.test(replayAt)) return new Date(replayAt).getTime();
  const hm = /^(\d{1,2}):(\d\d)(?::(\d\d))?$/.exec(replayAt) ?? replayFail(`no time in "${replayAt}" (HH:MM[:SS], 24-hour)`);
  const d = new Date(replayWall0); d.setHours(Number(hm[1]), Number(hm[2]), Number(hm[3] ?? 0), 0);
  if (d.getTime() < replayWall0) d.setDate(d.getDate() + 1);
  return d.getTime();
})();
const replayScene = (replayMoment - replayWall0) / 1000, replayT = replayStart + replayScene;
if (!(replayScene >= 0)) replayFail(`${replayAt} is before the run began (${replayClock})`);

// The run, headless, set up as main.ts sets up the scene's: the probes, the clock the street life
// keeps, then the street life.
setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
const replayCfg = readConfig(replayEnv as SceneEnv);
const replayJ = new Journey(replayCfg, replayStart, seasonAt(new Date(replayWall0)));
CLOCK.hourAt = (t) => clockHour(replayCfg.timeOfDay, replayWall0, t - replayJ.st.clockBase + replayJ.cityStart(replayJ.st.city) - replayStart);
CLOCK.glowAt = (h, w) => glowAt(replayWall0, h, w);
const replayEvents: [number, string][] = [];
replayJ.onEvent = (line) => replayEvents.push([replayJ.st.simTime, line]);
const replayScn = new THREE.Scene(), replayMat = new THREE.MeshBasicMaterial();
replayJ.attachLife(new StreetLife(new Traffic(replayScn, replayMat, null), new Crowd(replayScn, replayMat), new Ambient(replayScn, replayMat)));
replayJ.advanceTo(replayT);

// The visit the moment falls in, as its spec, and the next one's as the run draws it: the render
// keeps the run's seed (--env), and the next visit its number and its climate (both counted from
// the visit's place in the run, which is 1 in the render), so its road in and its town are the run's.
const replayN = replayJ.st.city, replayT0 = replayJ.cityStart(replayN), replayInto = replayT - replayT0;
const [replayVisit, replayNext] = replayJ.captureSpecs(), replayNextC = replayJ.climateOf(replayN + 1);
Object.assign(replayNext, { index: replayN + 1, season: replayNextC.season, weather: replayNextC.weather, snow: replayNextC.snowCover });
// From shortly before the moment, so that the render's clock (--clock: the board's at the same
// moment of the run) falls on a whole second, as the scene keeps its clock (climate.ts).
const replayOff0 = Math.round((replayT0 - replayStart) * 1000);
const replayFromMs = Math.ceil((replayOff0 + Math.max(0, Math.round((replayInto - Number(replayBefore)) * 1000))) / 1000) * 1000 - replayOff0;
const replayFrom = replayFromMs / 1000, replaySecs = Math.ceil(replayInto + Number(replayAfter) - replayFrom);
const replayDefines = [
  `DEBUG_VISIT=${JSON.stringify([replayVisit, replayNext])}`,
  `DEBUG_SKIP_MINUTES=${(replayFrom / 60).toFixed(9)}`,
];
replayFs.writeFileSync(`${replayOut}/env.json`, JSON.stringify(replayEnv) + "\n");
replayFs.writeFileSync(`${replayOut}/render-args.txt`, `--clock ${new Date(replayWall0 + replayOff0 + replayFromMs).toISOString()} --tz ${replayZone} --env ${replayOut}/env.json\n`);
replayFs.writeFileSync(`${replayOut}/defines.txt`, replayDefines.join("\n") + "\n");
replayFs.writeFileSync(`${replayOut}/secs.txt`, `${replaySecs}\n`);

const replayMs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const replayPose = replayJ.pose;
console.log(`seed ${replaySeed}, run began ${replayClock}; ${replayAt} is scene time ${replayMs(replayScene)}, journey time ${replayMs(replayT)}`);
console.log(`visit ${replayN}: ${replayJ.plan.name} (${replayVisit.city}), in by ${replayVisit.arriveBy}, from journey time ${replayMs(replayT0)}; the moment is ${replayMs(replayInto)} into it`);
console.log(`the truck: ${replayJ.st.truck}, ${replayJ.st.mode}, at ${replayPose.x.toFixed(1)}, ${replayPose.z.toFixed(1)} heading ${replayPose.h.toFixed(2)}`);
for (const [t, line] of replayEvents) if (t >= replayT0 - 1e-6) console.log(`  ${line}`);
console.log(`rendering ${replayMs(replayFrom)} to ${replayMs(replayFrom + replaySecs)} into the visit (the moment at ${replayMs(replayInto - replayFrom)} into the video)`);
