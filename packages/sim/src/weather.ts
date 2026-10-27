/**
 * Weather: a season-aware Markov chain re-rolled at midnight (adapted from the old game's per-band weather,
 * with one climate for the whole village).
 */
import type { Rng, WeatherKind } from '@hearth/shared';

export const WEATHER_KINDS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];

/** Base transition weights: from -> to. */
const BASE: Record<WeatherKind, Record<WeatherKind, number>> = {
  clear: { clear: 50, cloudy: 30, rain: 9, storm: 2, fog: 8, snow: 3 },
  cloudy: { clear: 28, cloudy: 32, rain: 25, storm: 5, fog: 6, snow: 5 },
  rain: { clear: 16, cloudy: 34, rain: 30, storm: 10, fog: 8, snow: 2 },
  storm: { clear: 22, cloudy: 34, rain: 30, storm: 9, fog: 5, snow: 1 },
  fog: { clear: 34, cloudy: 34, rain: 12, storm: 2, fog: 16, snow: 2 },
  snow: { clear: 20, cloudy: 30, rain: 3, storm: 1, fog: 8, snow: 40 },
};

/** Season x kind multipliers (Spring, Summer, Autumn, Winter). Snow only falls in winter. */
const SEASON_MULT: Record<WeatherKind, [number, number, number, number]> = {
  clear: [1, 1.3, 1, 0.9],
  cloudy: [1, 0.9, 1.1, 1.2],
  rain: [1.3, 1.05, 1.1, 0.6],
  storm: [0.5, 2.6, 1.6, 0.2],
  fog: [2, 0.4, 1.9, 1],
  snow: [0, 0, 0, 1],
};

/** The weather of the next day, given today's and the season. */
export function rollWeather(rng: Rng, from: WeatherKind, season: number): WeatherKind {
  const base = BASE[from];
  const items = WEATHER_KINDS.map((k) => [k, base[k] * SEASON_MULT[k][season]] as const).filter(([, w]) => w > 0);
  return rng.weighted(items);
}
