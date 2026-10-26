/** The per-step context every system reads: the state, the map, the clock and a few lookups. */
import type { PathGrid, Rng, WeatherKind, WorldData } from '@hearth/shared';
import type { SiteIndex } from './sites';
import type { Person, SimEvent, SimState } from './types';

export interface Ctx {
  st: SimState;
  world: WorldData;
  grid: PathGrid;
  sites: SiteIndex;
  rng: Rng;
  pending: SimEvent[];
  /** Game ms since the start, the day, the hour of the day (0..24), the season, the temperature and the weather. */
  now: number;
  day: number;
  hour: number;
  season: number;
  temp: number;
  weather: WeatherKind;
  person(id: number): Person | undefined;
  /** Living people on the map (not away), in id order. */
  people: Person[];
  /** Mark the people index stale after someone is born, dies or leaves. */
  dirty(): void;
}

export const MIN = 250; // game ms per game minute
export const HOUR = 15000;
