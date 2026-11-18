// Resolved scene configuration, with defaults and clamping so a bad override can't break the run.
import { DEBUG_SEED } from "./debug.ts";

type TimeMode = "cycle" | "day" | "dusk" | "night";
export interface Config {
  seed: number;
  timeOfDay: TimeMode;
  weather: boolean;
  humorFrequency: number;
  cityMinutes: number;
  countrySeconds: number;
  debugHud: boolean;
}
// Seconds of journey per city: its time in town and the drive to the next.
export const journeyPeriod = (c: Config) => c.cityMinutes * 60 + c.countrySeconds;
const cfgClamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export function readConfig(env: SceneEnv): Config {
  const num = (k: string, d: number) => (Number.isFinite(Number(env[k])) ? Number(env[k]) : d);
  const tod = String(env.timeOfDay ?? "cycle");
  return {
    seed: (DEBUG_SEED || Math.floor(num("seed", 0))) >>> 0,   // 0: a random journey (kept in board storage), else this one
    timeOfDay: (["cycle", "day", "dusk", "night"].includes(tod) ? tod : "cycle") as TimeMode,
    weather: env.weather !== false,
    humorFrequency: cfgClamp(num("humorFrequency", 0.02), 0, 0.1),
    cityMinutes: cfgClamp(num("cityMinutes", 30), 5, 60),
    countrySeconds: cfgClamp(num("countrySeconds", 45), 30, 60),
    debugHud: env.debugHud === true,
  };
}
