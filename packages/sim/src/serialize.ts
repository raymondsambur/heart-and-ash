import { BAL, GOODS, Rng, SPEEDS, generateWorld, type WallRing, type BuildingDef, type Good, type PlotDef, type WeatherKind } from '@hearth/shared';
import { newField } from './actions';
import { drawTraits, startingSkills, TRADE_ROTA } from './people';
import { SiteIndex } from './sites';
import { dayOf } from './calendar';
import { ensureDirector } from './director';
import { trafficRows } from './roads';
import { ensureOutside } from './outside';
import { defaultPriorities } from './policy';
import { emptyBase } from './reports';
import type { Base, DirectorState, FloraEntry, Field, FeedItem, Grave, Job, Offer, Order, OutsideState, Person, Report, Rule, SimState } from './types';
import { WEATHER_KINDS } from './weather';

/** Bump when the shape of the saved state changes, and add a step to `MIGRATIONS`. */
export const SNAPSHOT_VERSION = 7;

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
  priorities: number[];
  rules: Rule[];
  nextRuleId: number;
  offers: Offer[];
  nextOfferId: number;
  reports: Report[];
  nextReportId: number;
  dayBase: Base;
  seasonBase: Base;
  away: SimState['away'];
  crisis: string | null;
  silver: number;
  tier: 0 | 1 | 2;
  peak: number;
  outside: OutsideState;
  flora: FloraEntry[];
  chops: Record<number, number>;
  ring: WallRing | null;
  size: number;
  ground: Record<number, number>;
  /** The tiles with traffic: [tile, traffic, days quiet]. */
  traffic: [number, number, number][];
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
  // v4 (M3) to v5 (M4): priorities, rules, decisions and reports. All start empty; the first day's report is skipped (no base yet).
  4: (s) => ({ ...s, v: 5 }),
  // v5 (M4) to v6 (M5): the Outside, silver, the settlement tier and the peak. An older village gets a fresh Outside; its tier is worked out on the first day.
  5: (s) => ({ ...s, v: 6 }),
  // v6 (M5) to v7 (M6): the living ground (cut trees, picked bushes). The map starts as it was made.
  6: (s) => ({ ...s, v: 7 }),
};

/** Typed traffic arrays from their saved rows. */
function trafficArrays(rows: [number, number, number][], cells: number): { traffic: Float32Array; quiet: Uint8Array } {
  const n = Math.max(cells, rows.reduce((m, r) => Math.max(m, r[0] + 1), 0));
  const traffic = new Float32Array(n);
  const quiet = new Uint8Array(n);
  for (const [i, v, q] of rows) {
    traffic[i] = v;
    quiet[i] = q;
  }
  return { traffic, quiet };
}

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
      priorities: st.priorities,
      rules: st.rules,
      nextRuleId: st.nextRuleId,
      offers: st.offers,
      nextOfferId: st.nextOfferId,
      reports: st.reports,
      nextReportId: st.nextReportId,
      dayBase: st.dayBase,
      seasonBase: st.seasonBase,
      away: st.away,
      crisis: st.crisis,
      silver: st.silver,
      tier: st.tier,
      peak: st.peak,
      outside: st.outside,
      flora: st.flora,
      chops: st.chops,
      ring: st.ring,
      size: st.size,
      ground: st.ground,
      traffic: trafficRows(st.traffic, st.quiet),
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
/** `cells` is the number of tiles of the map (width times height), for the traffic; it is worked out from the saved rows when not given. */
export function restoreState(saved: unknown, rng: Rng, cells = 0): SimState {
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
    priorities: Array.isArray(s.priorities) && s.priorities.length === defaultPriorities().length ? (s.priorities as number[]).slice() : defaultPriorities(),
    rules: Array.isArray(s.rules) ? clone<Rule[]>(s.rules) : [],
    nextRuleId: typeof s.nextRuleId === 'number' ? s.nextRuleId : 1,
    offers: Array.isArray(s.offers) ? clone<Offer[]>(s.offers) : [],
    nextOfferId: typeof s.nextOfferId === 'number' ? s.nextOfferId : 1,
    reports: Array.isArray(s.reports) ? clone<Report[]>(s.reports) : [],
    nextReportId: typeof s.nextReportId === 'number' ? s.nextReportId : 1,
    dayBase: typeof s.dayBase === 'object' && s.dayBase !== null ? clone<Base>(s.dayBase) : emptyBase(),
    seasonBase: typeof s.seasonBase === 'object' && s.seasonBase !== null ? clone<Base>(s.seasonBase) : emptyBase(),
    away: typeof s.away === 'object' && s.away !== null ? clone<SimState['away']>(s.away) : null,
    crisis: typeof s.crisis === 'string' ? s.crisis : null,
    silver: typeof s.silver === 'number' ? s.silver : BAL.outside.startSilver,
    tier: s.tier === 1 || s.tier === 2 ? s.tier : 0,
    peak: typeof s.peak === 'number' ? s.peak : 0,
    ground: typeof s.ground === 'object' && s.ground !== null && !Array.isArray(s.ground) ? clone<Record<number, number>>(s.ground) : {},
    ...trafficArrays(Array.isArray(s.traffic) ? (s.traffic as [number, number, number][]) : [], cells),
    ring: typeof s.ring === 'object' && s.ring !== null ? clone<WallRing>(s.ring) : null,
    size: typeof s.size === 'number' && s.size >= 32 ? s.size : 96,
    flora: Array.isArray(s.flora) ? clone<FloraEntry[]>(s.flora) : [],
    chops: typeof s.chops === 'object' && s.chops !== null && !Array.isArray(s.chops) ? clone<Record<number, number>>(s.chops) : {},
    outside: ensureOutside(typeof s.outside === 'object' && s.outside !== null ? clone<OutsideState>(s.outside) : undefined, rng, dayOf(num(s, 'totalMs'))),
  };
}
