// Resolved scene configuration, with defaults and clamping so a bad override can't break the run.
import { DEBUG_SEED } from "./debug.ts";

type TimeMode = "cycle" | "day" | "dusk" | "night";
export interface Config {
  seed: number;
  timeOfDay: TimeMode;
  weather: boolean;
  humorFrequency: number;
  cityMinutes: number;
  debugHud: boolean;
}
const cfgClamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// The settings a run uses that differ from their defaults, for the line that reproduces it (main.ts).
export function settingsOff(cfg: Config) {
  const d = readConfig({} as SceneEnv), out: Partial<Config> = {};
  for (const k of ["timeOfDay", "weather", "humorFrequency", "cityMinutes"] as const) if (cfg[k] !== d[k]) (out as Record<string, unknown>)[k] = cfg[k];
  return out;
}
export function readConfig(env: SceneEnv): Config {
  const num = (k: string, d: number) => (Number.isFinite(Number(env[k])) ? Number(env[k]) : d);
  const tod = String(env.timeOfDay ?? "cycle");
  return {
    seed: (DEBUG_SEED || Math.floor(num("seed", 0))) >>> 0,   // 0: a new random journey each time the scene starts, else this one
    timeOfDay: (["cycle", "day", "dusk", "night"].includes(tod) ? tod : "cycle") as TimeMode,
    weather: env.weather !== false,
    humorFrequency: cfgClamp(num("humorFrequency", 0.02), 0, 0.1),
    cityMinutes: cfgClamp(num("cityMinutes", 30), 5, 60),
    debugHud: env.debugHud === true,
  };
}
