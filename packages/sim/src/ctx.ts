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
  /** Tiles the village has built on or cleared since the map was made: 1 blocked, 2 open (a starting building that is gone), 0 as the map says. */
  over: Uint8Array;
  /** The terrain as the map was made, before any road was worn or grown over. */
  baseTerrain: Uint8Array;
  /** The ground or what stands on one tile changed (a tree felled, a road worn): its walking cost is worked out again. `refreshCosts` redoes them all. */
  touch(i: number): void;
  refreshCosts(): void;
  /** Can people walk on this tile? The map, with what has been built or taken down. */
  open(x: number, y: number): boolean;
}

export const MIN = 250; // game ms per game minute
export const HOUR = 15000;
