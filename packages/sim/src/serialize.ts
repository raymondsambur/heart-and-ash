import { GOODS, Rng, SPEEDS, generateWorld, type BuildingDef, type Good, type PlotDef, type WeatherKind } from '@hearth/shared';
import { newField } from './actions';
import { drawTraits, startingSkills, TRADE_ROTA } from './people';
import { SiteIndex } from './sites';
import { dayOf } from './calendar';
import { ensureDirector } from './director';
import type { DirectorState, Field, FeedItem, Grave, Job, Order, Person, SimState } from './types';
import { WEATHER_KINDS } from './weather';

/** Bump when the shape of the saved state changes, and add a step to `MIGRATIONS`. */
export const SNAPSHOT_VERSION = 4;

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
  fields: Field[];
  jobs: Job[];
  nextJobId: number;
  jobsAt: number;
  orders: Order[];
  nextOrderId: number;
  nextBuildingId: number;
  nextPlotId: number;
  people: Person[];
  graves: Grave[];
  feed: FeedItem[];
  nextFeedId: number;
  fires: Record<number, number>;
  lastDay: number;
  stats: Record<string, number>;
  pool: number;
  rationing: 0 | 1 | 2;
  hearthDay: number;
  dir: DirectorState;
}

export class SnapshotError extends Error {}

type Raw = Record<string, unknown>;

/** Old versions are upgraded one step at a time to the current one. */
const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  // v1 (M0): placeholder villagers walking between places, a stock of grain/firewood/timber/stone.
  1: (s) => {
    const seed = typeof s.seed === 'number' ? s.seed : 0;
    const world = generateWorld(seed);
    const buildings = (s.buildings as BuildingDef[]) ?? [];
    const plots = (s.plots as PlotDef[]) ?? [];
    const sites = new SiteIndex(world, buildings, plots);
    const fixed = new Set(['home', 'store', 'shrine', 'field', 'water', 'plaza', 'edge']);
    const known = sites.sites.filter((x) => fixed.has(x.kind)).map((x) => x.id);
    const old = (s.stock as Record<string, number>) ?? {};
    const stock = Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<Good, number>;
    stock.ration = old.grain ?? 0;
    stock.wood = old.firewood ?? 0;
    stock.planks = old.timber ?? 0;
    stock.stone = old.stone ?? 0;
    const rng = new Rng(seed ^ 0x77aa);
    // Imported villagers get a fresh mind (the M0 ones had none); the body, look, place and name carry over.
    const people = ((s.villagers as Raw[]) ?? []).map((v) => {
      const home = typeof v.home === 'number' ? v.home : null;
      return {
        ...blankMind(rng),
        id: v.id,
        name: v.name,
        look: v.look,
        sex: (v.look as { gender?: number } | undefined)?.gender === 1 ? 1 : 0,
        born: -30 * 96,
        home,
        x: v.x,
        y: v.y,
        nx: v.x,
        ny: v.y,
        face: v.face ?? 0,
        known: known.slice(),
      };
    });
    const out: Raw = { ...s, v: 2, stock, people, fields: plots.filter((p) => p.kind === 'field').map((p) => newField(p.id)), jobs: [], nextJobId: 1, jobsAt: -1, graves: [], feed: [], nextFeedId: 1, fires: {}, lastDay: 0, stats: {}, pool: 8 };
    delete out.villagers;
    return out;
  },
  // v2 (M1) to v3 (M2): the village can build. No orders yet; the counters for new buildings and plots start after the ones that exist.
  2: (s) => {
    const maxOf = (list: unknown): number => (Array.isArray(list) ? list.reduce<number>((m, x) => Math.max(m, typeof (x as { id?: unknown })?.id === 'number' ? (x as { id: number }).id : 0), 0) : 0);
    return { ...s, v: 3, orders: [], nextOrderId: 1, nextBuildingId: maxOf(s.buildings) + 1, nextPlotId: maxOf(s.plots) + 1 };
  },
  // v3 (M2) to v4 (M3): rationing, the hearths and the events director. An old village starts with a fresh director whose first
  // raid is a few weeks away from the day it is loaded (the director fills in `nextRaid` when it first runs).
  3: (s) => ({ ...s, v: 4, rationing: 0, hearthDay: -1, dir: null }),
};

/** The parts of a person the M0 villager did not have. */
function blankMind(rng: Rng): Raw {
  const needs = { food: 80, water: 85, rest: 75, warmth: 90, safety: 85, company: 70, purpose: 70 };
  return {
    parents: [],
    partner: null,
    children: [],
    path: [],
    stepMs: 0,
    stepLeft: 0,
    hidden: false,
    needs,
    hp: 100,
    maxHp: 100,
    ills: [],
    skills: startingSkills(rng, TRADE_ROTA[rng.int(0, TRADE_ROTA.length - 1)], 30),
    traits: drawTraits(rng),
    ambitions: [],
    loyalty: 55,
    mood: 70,
    moodEvents: [],
    relations: {},
    memory: [],
    carrying: null,
    silver: rng.int(2, 20),
    inv: { tool: 1, clothes: 1 },
    rhythm: 0,
    goal: null,
    source: null,
    goalSince: 0,
    plan: [],
    planIdx: 0,
    act: null,
    talk: null,
    job: null,
    why: { goal: 'Settling in', source: 'leisure', top: [], plan: '' },
    nextDecide: 0,
    fails: 0,
    blocked: null,
    lastAct: '',
    pregnant: null,
    debt: 0,
    stall: false,
    away: null,
    counters: {},
  };
}

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
      fields: st.fields,
      jobs: st.jobs,
      nextJobId: st.nextJobId,
      jobsAt: st.jobsAt,
      orders: st.orders,
      nextOrderId: st.nextOrderId,
      nextBuildingId: st.nextBuildingId,
      nextPlotId: st.nextPlotId,
      people: st.people,
      graves: st.graves,
      feed: st.feed,
      nextFeedId: st.nextFeedId,
      fires: st.fires,
      lastDay: st.lastDay,
      stats: st.stats,
      pool: st.pool,
      rationing: st.rationing,
      hearthDay: st.hearthDay,
      dir: st.dir,
    }),
  ) as SimSnapshot;
}

function num(o: Raw, k: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SnapshotError(`snapshot field ${k} is not a number`);
  return v;
}

function arr(o: Raw, k: string): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new SnapshotError(`snapshot field ${k} is not a list`);
  return v;
}

function obj(o: Raw, k: string): Record<string, never> {
  const v = o[k];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot field ${k} is not an object`);
  return v as Record<string, never>;
}

/** Validate a saved snapshot, upgrade it if it is old, and load it into state. Sets the rng state. */
export function restoreState(saved: unknown, rng: Rng): SimState {
  if (typeof saved !== 'object' || saved === null) throw new SnapshotError('snapshot is not an object');
  let s = saved as Raw;
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
  const villageName = s.villageName;
  if (typeof villageName !== 'string') throw new SnapshotError('snapshot village name is invalid');
  const people = arr(s, 'people') as Person[];
  for (const p of people) {
    if (typeof p !== 'object' || p === null || typeof p.id !== 'number' || typeof p.x !== 'number' || typeof p.y !== 'number' || !Array.isArray(p.path) || typeof p.needs !== 'object') {
      throw new SnapshotError('snapshot person is invalid');
    }
  }
  const stock = obj(s, 'stock') as unknown as Record<Good, number>;
  const full = Object.fromEntries(GOODS.map((g) => [g, typeof stock[g] === 'number' ? stock[g] : 0])) as Record<Good, number>;
  rng.state = num(s, 'rng');
  const clone = <T>(x: unknown): T => JSON.parse(JSON.stringify(x)) as T;
  return {
    seed: num(s, 'seed'),
    totalMs: num(s, 'totalMs'),
    carryMs: num(s, 'carryMs'),
    speed: speed as SimState['speed'],
    weather: weather as WeatherKind,
    nextId: num(s, 'nextId'),
    villageName,
    stock: full,
    buildings: clone(arr(s, 'buildings')),
    plots: clone(arr(s, 'plots')),
    fields: clone(arr(s, 'fields')),
    jobs: clone(arr(s, 'jobs')),
    nextJobId: num(s, 'nextJobId'),
    jobsAt: num(s, 'jobsAt'),
    orders: clone(arr(s, 'orders')),
    nextOrderId: num(s, 'nextOrderId'),
    nextBuildingId: num(s, 'nextBuildingId'),
    nextPlotId: num(s, 'nextPlotId'),
    people: clone(people),
    graves: clone(arr(s, 'graves')),
    feed: clone(arr(s, 'feed')),
    nextFeedId: num(s, 'nextFeedId'),
    fires: clone(obj(s, 'fires')),
    lastDay: num(s, 'lastDay'),
    stats: clone(obj(s, 'stats')),
    pool: num(s, 'pool'),
    rationing: s.rationing === 1 || s.rationing === 2 ? s.rationing : 0,
    hearthDay: typeof s.hearthDay === 'number' ? s.hearthDay : -1,
    dir: ensureDirector(typeof s.dir === 'object' && s.dir !== null ? clone<DirectorState>(s.dir) : undefined, rng, dayOf(num(s, 'totalMs'))),
  };
}
