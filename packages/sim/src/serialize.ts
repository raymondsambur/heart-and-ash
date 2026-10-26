import { Rng, SPEEDS, type BuildingDef, type PlotDef, type WeatherKind } from '@hearth/shared';
import { WEATHER_KINDS } from './weather';
import type { SimState, Villager } from './types';

/** Bump when the shape of the saved state changes, and add a step to `MIGRATIONS`. */
export const SNAPSHOT_VERSION = 1;

export interface SimSnapshot {
  v: number;
  seed: number;
  /** State of the single seeded rng. */
  rng: number;
  totalMs: number;
  carryMs: number;
  speed: number;
  weather: WeatherKind;
  nextId: number;
  villageName: string;
  stock: Record<string, number>;
  buildings: BuildingDef[];
  plots: PlotDef[];
  villagers: Villager[];
}

export class SnapshotError extends Error {}

/** Old versions are upgraded one step at a time to the current one. */
const MIGRATIONS: Record<number, (s: Record<string, unknown>) => Record<string, unknown>> = {};

export function serializeState(st: SimState, rng: Rng): SimSnapshot {
  return JSON.parse(
    JSON.stringify({
      v: SNAPSHOT_VERSION,
      seed: st.seed,
      rng: rng.state,
      totalMs: st.totalMs,
      carryMs: st.carryMs,
      speed: st.speed,
      weather: st.weather,
      nextId: st.nextId,
      villageName: st.villageName,
      stock: st.stock,
      buildings: st.buildings,
      plots: st.plots,
      villagers: st.villagers,
    }),
  ) as SimSnapshot;
}

function num(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SnapshotError(`snapshot field ${k} is not a number`);
  return v;
}

function arr(o: Record<string, unknown>, k: string): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new SnapshotError(`snapshot field ${k} is not a list`);
  return v;
}

/** Validate a saved snapshot, upgrade it if it is old, and load it into state. Sets the rng state. */
export function restoreState(saved: unknown, rng: Rng): SimState {
  if (typeof saved !== 'object' || saved === null) throw new SnapshotError('snapshot is not an object');
  let s = saved as Record<string, unknown>;
  let v = num(s, 'v');
  if (v > SNAPSHOT_VERSION) throw new SnapshotError(`snapshot version ${v} is newer than this build (${SNAPSHOT_VERSION})`);
  while (v < SNAPSHOT_VERSION) {
    const up = MIGRATIONS[v];
    if (!up) throw new SnapshotError(`no migration from snapshot version ${v}`);
    s = up(s);
    v = num(s, 'v');
  }
  const speed = num(s, 'speed');
  if (!(SPEEDS as readonly number[]).includes(speed)) throw new SnapshotError('snapshot speed is invalid');
  const weather = s.weather;
  if (typeof weather !== 'string' || !WEATHER_KINDS.includes(weather as WeatherKind)) throw new SnapshotError('snapshot weather is invalid');
  const stock = s.stock;
  if (typeof stock !== 'object' || stock === null) throw new SnapshotError('snapshot stock is invalid');
  const villageName = s.villageName;
  if (typeof villageName !== 'string') throw new SnapshotError('snapshot village name is invalid');
  const villagers = arr(s, 'villagers') as Villager[];
  for (const vl of villagers) {
    if (typeof vl !== 'object' || vl === null || typeof vl.id !== 'number' || typeof vl.x !== 'number' || typeof vl.y !== 'number' || !Array.isArray(vl.path)) throw new SnapshotError('snapshot villager is invalid');
  }
  rng.state = num(s, 'rng');
  return {
    seed: num(s, 'seed'),
    totalMs: num(s, 'totalMs'),
    carryMs: num(s, 'carryMs'),
    speed: speed as SimState['speed'],
    weather: weather as WeatherKind,
    nextId: num(s, 'nextId'),
    villageName,
    stock: { ...(stock as Record<string, number>) },
    buildings: arr(s, 'buildings') as BuildingDef[],
    plots: arr(s, 'plots') as PlotDef[],
    villagers: JSON.parse(JSON.stringify(villagers)) as Villager[],
  };
}
