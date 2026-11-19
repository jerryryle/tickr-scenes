// Seasons and weather, city by city. Time of day follows the real clock (atmosphere.ts); the
// season and the weather change with every city instead, so the journey keeps changing: city 0
// starts in the real season, each city after it moves on a season, and each city's weather is
// drawn from the seed for that season and style (no snow in the desert, more fog by the bay).
// A season also repaints the city's style: autumn leaves, spring blossom, snow on the ground and
// the roofs, and bare broadleaf trees in a snowy winter.
import * as THREE from "three@0.187.0";
import { hash2 } from "./rng.ts";
import { DEBUG_CLIMATE } from "./debug.ts";
import type { CityStyle } from "./styles.ts";

export type Season = "spring" | "summer" | "autumn" | "winter";
type WeatherKind = "clear" | "cloudy" | "overcast" | "rain" | "storm" | "snow" | "fog";
export interface Climate { season: Season; weather: WeatherKind; snowCover: boolean }

const SEASONS: Season[] = ["winter", "spring", "summer", "autumn"];

export function realSeason(): Season {
  const m = new Date().getMonth();   // the board's local month
  return SEASONS[Math.floor(((m + 1) % 12) / 3)];
}

export function cityClimate(seed: number, N: number, style: CityStyle, start: Season): Climate {
  const season = SEASONS[(SEASONS.indexOf(start) + N) % 4];
  const r = hash2(N, 5, seed, 0xc11a);
  const dry = style.id === "desert", mild = style.id === "desert" || style.id === "coastal";
  // Weights: clear, cloudy, overcast, rain, storm, snow, fog.
  let w: number[];
  switch (season) {
    case "winter": w = mild ? [3, 2, 2, dry ? 0.3 : 2, 0.3, 0, style.id === "coastal" ? 2 : 0.2] : [2, 2, 2, 0.6, 0, 4, 1]; break;
    case "spring": w = [4, 3, 1, dry ? 0.3 : 2, dry ? 0 : 0.6, 0, style.id === "coastal" ? 1.5 : 0.3]; break;
    case "summer": w = [6, 2, 0.5, dry ? 0.1 : 0.8, dry ? 0.4 : 1, 0, style.id === "coastal" ? 2 : 0.1]; break;
    default: w = [4, 3, 2, dry ? 0.3 : 1.6, 0.3, 0, style.id === "coastal" ? 1.5 : 0.8];
  }
  const kinds: WeatherKind[] = ["clear", "cloudy", "overcast", "rain", "storm", "snow", "fog"];
  let total = w.reduce((a, b) => a + b, 0), x = r * total, weather: WeatherKind = "clear";
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) { weather = kinds[i]; break; } }
  const snowCover = season === "winter" && !mild && (weather === "snow" || hash2(N, 6, seed, 0xc11a) < 0.6);
  if (DEBUG_CLIMATE) { const [ds, dw] = DEBUG_CLIMATE.split("/") as [Season, WeatherKind]; return { season: ds, weather: dw, snowCover: ds === "winter" && !mild }; }
  return { season, weather, snowCover };
}

// The cargo season a climate allows (cargo.ts knows winter and autumn goods).
export const cargoSeason = (c: Climate): "winter" | "autumn" | null => (c.season === "winter" ? "winter" : c.season === "autumn" ? "autumn" : null);

// Weather as the few numbers the renderer needs, blendable between two places.
export interface WeatherMix { cloud: number; rain: number; snow: number; fog: number; storm: number }
export function weatherMix(k: WeatherKind): WeatherMix {
  switch (k) {
    case "clear": return { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0 };
    case "cloudy": return { cloud: 0.35, rain: 0, snow: 0, fog: 0, storm: 0 };
    case "overcast": return { cloud: 0.8, rain: 0, snow: 0, fog: 0.1, storm: 0 };
    case "rain": return { cloud: 0.9, rain: 0.7, snow: 0, fog: 0.15, storm: 0 };
    case "storm": return { cloud: 1, rain: 1, snow: 0, fog: 0.2, storm: 1 };
    case "snow": return { cloud: 0.85, rain: 0, snow: 0.8, fog: 0.25, storm: 0 };
    case "fog": return { cloud: 0.6, rain: 0, snow: 0, fog: 1, storm: 0 };
  }
}
export function lerpWeather(a: WeatherMix, b: WeatherMix, k: number): WeatherMix {
  const l = (x: number, y: number) => x + (y - x) * k;
  return { cloud: l(a.cloud, b.cloud), rain: l(a.rain, b.rain), snow: l(a.snow, b.snow), fog: l(a.fog, b.fog), storm: l(a.storm, b.storm) };
}

// ---- seasonal palettes ------------------------------------------------------------------------
export const SNOW = 0xc4d0e0;   // a little blue and below white: a large pale fill washes out on LEDs
const AUTUMN_LEAVES = [0xd2691e, 0xe0a020, 0xb8321e, 0x9a6a2a, 0xc8501e];
const SPRING_LEAVES = [0x6fbf4a, 0x8ad05a, 0xf2a6c8, 0xf7c6dc, 0x5aa83c];
export const BARE = [0x6a5a4a, 0x7a6a58];
const shadeBy = (c: number, k: number, toward = 0x000000) => new THREE.Color(c).lerp(new THREE.Color(toward), k).getHex();

// Recolour a palette of tree greens and a ground colour for a climate.
export function seasonGreens(greens: number[], c: Climate, conifer = false): number[] {
  if (c.snowCover) return conifer ? greens.map((g) => shadeBy(g, 0.25)) : BARE;
  if (c.season === "autumn") return conifer ? greens : AUTUMN_LEAVES;
  if (c.season === "spring") return conifer ? greens : SPRING_LEAVES;
  if (c.season === "winter") return greens.map((g) => shadeBy(g, 0.3, 0x6a6a50));
  return greens;
}
export function seasonGround(color: number, c: Climate) {
  if (c.snowCover) return shadeBy(color, 0.85, SNOW);
  if (c.season === "autumn") return shadeBy(color, 0.3, 0xa08a40);
  if (c.season === "winter") return shadeBy(color, 0.35, 0x8a8460);
  if (c.season === "spring") return shadeBy(color, 0.15, 0x7ad04a);
  return color;
}

const seasonalStyles = new Map<string, CityStyle>();
export function seasonalStyle(style: CityStyle, c: Climate): CityStyle {
  const key = `${style.id}/${c.season}/${c.snowCover}`;
  let s = seasonalStyles.get(key);
  if (!s) {
    s = { ...style, trees: { ...style.trees, greens: seasonGreens(style.trees.greens, c) }, grass: seasonGround(style.grass, c) };
    if (c.snowCover) s.roofs = style.roofs.map((r) => shadeBy(r, 0.7, SNOW));
    seasonalStyles.set(key, s);
  }
  return s;
}
