import {
  BAL,
  DAYS_PER_YEAR,
  MAX_RULES,
  GAME_HOUR_MS,
  Rng,
  SIM_STEP_MS,
  SPEEDS,
  START_STOCK,
  GOODS,
  TERRAIN_INFO,
  generateWorld,
  isPassable,
  villageName,
  worldPathGrid,
  type BuildingDef,
  type Good,
  type PathGrid,
  type PersonSheet,
  type PlotDef,
  type RuleDef,
  type Speed,
  type TimeView,
  type VillageView,
  type WorldData,
} from '@hearth/shared';
import { newField } from './actions';
import { drawAmbitions, reviewAmbitions } from './ambitions';
import { clockOf, dayOf } from './calendar';
import { cancelOrder, computeOverlay, orderDemolish, orderViews, placeOrder, wishes } from './construct';
import { directorDay, newDirector } from './director';
import { answerOffer, expireOffers } from './offers';
import { applyFlora, floraDay, floraView } from './flora';
import { wallState } from './walls';
import { applyGround, groundView, roadsDay } from './roads';
import { newOutside, outsideDay, outsideView } from './outside';
import { deleteRule, defaultPriorities, runRules, setPriority, setRule } from './policy';
import { awayReport, baseOf, dayReport, emptyBase, markRead, seasonReport } from './reports';
import { foodDaysOf, lightHearths, statusOf } from './economy';
import { pushFeed } from './feed';
import type { Ctx } from './ctx';
import { tickPerson } from './exec';
import { refreshJobs } from './jobs';
import { dailyLife } from './life';
import { temperature } from './needs';
import { newPerson, planHouseholds, TRADE_ROTA } from './people';
import { restoreState, serializeState, type SimSnapshot } from './serialize';
import { SiteIndex } from './sites';
import type { CommandResult, Person, SimCommand, SimEvent, SimState } from './types';
import { briefOf, entityView, sheetOf } from './views';
import { rollWeather } from './weather';
import { relOf } from './util';

export interface CreateSimOptions {
  seed: number;
  /** A snapshot produced by `serialize`; when given, `seed` must match it. */
  saved?: SimSnapshot | null;
  /** Number of people in a new village (default 12). The bench uses larger numbers. */
  population?: number;
  /** Width and height of the map of a new village in tiles (default 96; the game asks for `MAP_SIZE`). A saved village ignores it. */
  size?: number;
}

/** The library contract (docs/ARCHITECTURE.md). Pure and deterministic: one seeded rng, no wall clock, no I/O. */
export interface Sim {
  readonly seed: number;
  /** The static map (identical for a given seed). */
  readonly world: WorldData;
  /** The time-control setting (0 = paused). The sim does not use it to advance: the host decides how many steps to run. */
  readonly speed: Speed;
  /** Orders from the player. */
  command(cmd: SimCommand): CommandResult;
  /** Advance by `dtGameMs` of game time. Any chunking gives the same result. */
  step(dtGameMs: number): void;
  /** Data for the client. Entity `step` and `route` are in game ms and tiles. */
  view(): VillageView;
  /** The sheet of one person, or null when they are not on the map. */
  sheet(id: number): PersonSheet | null;
  /** Events since the last call (reports, feed items, notifications). */
  events(): SimEvent[];
  /** Full state, versioned. */
  serialize(): SimSnapshot;
  /** Read-only look at the state for the soak script and tests. */
  inspect(): Readonly<SimState>;
}

const FEED_IN_VIEW = 40;
/** While the manager is away the village stops itself when this few are left, or when there is under this much food. */
const CRISIS_PEOPLE = 3;
const CRISIS_FOOD_DAYS = 0.5;
const POOL = 8;

/** Sites a new person already knows: everything fixed in the village, and what lies near their own home. */
export function startingKnowledge(sites: SiteIndex, home: { x: number; y: number } | null): number[] {
  const fixed = new Set(['home', 'store', 'shrine', 'field', 'water', 'plaza', 'edge']);
  return sites.sites.filter((s) => fixed.has(s.kind) || (home && Math.abs(s.x - home.x) + Math.abs(s.y - home.y) < 24)).map((s) => s.id);
}

export function createSim(opts: CreateSimOptions): Sim {
  // A saved village keeps the size of the map it was made on (the first maps were 96 x 96); a new one takes the size asked for.
  const size = opts.saved ? (typeof opts.saved.size === 'number' && opts.saved.size >= 32 ? opts.saved.size : 96) : (opts.size ?? 96);
  const world = generateWorld(opts.seed, size, size);
  const baseGrid = worldPathGrid(world);
  /** What the village has built on or cleared since the map was made (see construct.ts). */
  const over = new Uint8Array(world.w * world.h);
  /** The time cost of entering every tile, worked out once and kept (the pathfinder asks for it thousands of times a day). */
  const costGrid = new Float64Array(world.w * world.h);
  const tileCost = (x: number, y: number): number => {
    const o = over[y * world.w + x];
    if (o === 1) return Infinity;
    if (o === 2) {
      const t = TERRAIN_INFO[world.terrain[y * world.w + x]];
      return t.passable && t.speed > 0 ? 1 / t.speed : Infinity;
    }
    return baseGrid.cost(x, y);
  };
  const touch = (i: number): void => {
    costGrid[i] = tileCost(i % world.w, (i / world.w) | 0);
  };
  const refreshCosts = (): void => {
    for (let y = 0, i = 0; y < world.h; y++) for (let x = 0; x < world.w; x++, i++) costGrid[i] = tileCost(x, y);
  };
  const grid: PathGrid = {
    w: world.w,
    h: world.h,
    cost(x, y) {
      return x < 0 || y < 0 || x >= world.w || y >= world.h ? Infinity : costGrid[y * world.w + x];
    },
  };
  const baseTerrain = world.terrain.slice();
  const rng = new Rng(opts.seed ^ 0x51a7e);
  const pending: SimEvent[] = [];
  let st: SimState;

  if (opts.saved) {
    if (opts.saved.seed !== opts.seed) throw new Error(`snapshot is for seed ${opts.saved.seed}, not ${opts.seed}`);
    st = restoreState(opts.saved, rng, world.w * world.h);
  } else {
    st = emptyState(opts.seed);
  }
  // The sites (where the forest and the meadows are) come from the map as it was made, so a loaded village and one that never stopped agree;
  // only then does the ground the village has changed (trees cut, bushes picked) go back onto the map.
  const sites = new SiteIndex(world, st.buildings, st.plots, st.orders);
  applyFlora(world.objects, st.flora);
  applyGround(world.terrain, st.ground);
  computeOverlay(world, st.buildings, over);
  refreshCosts();

  // ---- the shared context, refreshed once per step ----
  let byId = new Map<number, Person>();
  let living: Person[] = [];
  let stale = true;
  const rebuild = (): void => {
    byId = new Map(st.people.map((p) => [p.id, p]));
    living = st.people.filter((p) => !p.away);
    stale = false;
  };
  const c: Ctx = {
    st,
    world,
    grid,
    sites,
    rng,
    pending,
    now: 0,
    day: 0,
    hour: 0,
    season: 0,
    temp: 10,
    weather: 'clear',
    over,
    baseTerrain,
    touch,
    refreshCosts,
    open(x, y) {
      if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
      const o = over[y * world.w + x];
      if (o === 1) return false;
      if (o === 2) return TERRAIN_INFO[world.terrain[y * world.w + x]].passable;
      return isPassable(world, x, y);
    },
    person(id) {
      if (stale) rebuild();
      return byId.get(id);
    },
    get people() {
      if (stale) rebuild();
      return living;
    },
    dirty() {
      stale = true;
    },
  };
  const sync = (): void => {
    const clock = clockOf(st.totalMs);
    c.now = st.totalMs;
    c.day = clock.day;
    c.hour = clock.hours;
    c.season = clock.season;
    c.weather = st.weather;
    c.temp = temperature(clock.season, clock.hours, st.weather);
  };

  function emptyState(seed: number): SimState {
    const buildings: BuildingDef[] = world.start.buildings.map((b) => ({ ...b, door: { ...b.door } }));
    const plots: PlotDef[] = world.start.plots.map((p) => ({ ...p }));
    const stock = Object.fromEntries(GOODS.map((g) => [g, START_STOCK[g] ?? 0])) as Record<Good, number>;
    return {
      seed,
      totalMs: 0,
      carryMs: 0,
      speed: 1,
      weather: 'clear',
      nextId: 1,
      villageName: villageName(rng),
      stock,
      buildings,
      plots,
      fields: plots.filter((p) => p.kind === 'field').map((p) => newField(p.id)),
      jobs: [],
      nextJobId: 1,
      jobsAt: -1,
      orders: [],
      nextOrderId: 1,
      nextBuildingId: buildings.reduce((m, b) => Math.max(m, b.id), 0) + 1,
      nextPlotId: plots.reduce((m, p) => Math.max(m, p.id), 0) + 1,
      people: [],
      graves: [],
      feed: [],
      nextFeedId: 1,
      fires: {},
      lastDay: 0,
      stats: {},
      pool: POOL,
      rationing: 0,
      hearthDay: -1,
      dir: newDirector(rng.fork('director')),
      priorities: defaultPriorities(),
      rules: [],
      nextRuleId: 1,
      offers: [],
      nextOfferId: 1,
      reports: [],
      nextReportId: 1,
      dayBase: emptyBase(),
      seasonBase: emptyBase(),
      away: null,
      crisis: null,
      silver: BAL.outside.startSilver,
      tier: 0,
      peak: 0,
      outside: newOutside(rng.fork('outside')),
      flora: [],
      chops: {},
      ring: null,
      size,
      ground: {},
      traffic: new Float32Array(world.w * world.h),
      quiet: new Uint8Array(world.w * world.h),
    };
  }

  /** Fill a new village: households under the roofs, kin and neighbours who know each other, first dreams. */
  function populate(population: number): void {
    const homes = st.buildings.filter((b) => b.kind === 'house');
    sync();
    st.weather = rollWeather(rng, 'clear', 0);
    c.weather = st.weather;
    const households = planHouseholds(rng, population);
    const byHome = new Map<number, Person[]>();
    households.forEach((h, i) => {
      const home = homes[i % homes.length];
      const known = startingKnowledge(sites, home.door);
      const fam: Person[] = [];
      const make = (age: number, sex: 0 | 1, parents?: Person[]): Person => {
        const p = newPerson({ id: st.nextId++, rng, sex, age, day: 0, home: home.id, x: home.door.x, y: home.door.y, known, parents, trade: TRADE_ROTA[(st.nextId + i) % TRADE_ROTA.length] });
        st.people.push(p);
        fam.push(p);
        return p;
      };
      const adults = h.adults.map((a) => make(a.age, a.sex));
      const elders = h.elders.map((a) => make(a.age, a.sex));
      if (adults.length === 2) {
        adults[0].partner = adults[1].id;
        adults[1].partner = adults[0].id;
      }
      const kids = h.kids.map((age) => make(age, rng.int(0, 1) as 0 | 1, adults.length ? adults : undefined));
      for (const k of kids) for (const a of adults) a.children.push(k.id);
      for (const k of kids) k.parents = adults.map((a) => a.id);
      for (const a of fam) for (const b of fam) if (a !== b) Object.assign(relOf(a, b.id), { fam: 80, aff: 45 + rng.int(0, 20), rom: a.partner === b.id ? 70 : 0 });
      byHome.set(home.id, (byHome.get(home.id) ?? []).concat(fam));
    });
    // neighbours: everybody knows everybody a little, in a village this small
    const all = st.people;
    for (const a of all) for (const b of all) if (a !== b && !a.relations[b.id]) Object.assign(relOf(a, b.id), { fam: 12 + rng.int(0, 25), aff: rng.int(-8, 22), rom: 0 });
    stale = true;
    for (const p of st.people) drawAmbitions(c, p);
  }

  if (!opts.saved) populate(opts.population ?? 12);
  sync();
  st.peak = Math.max(st.peak, c.people.length);
  if (st.dayBase.day < 0) st.dayBase = baseOf(c);
  if (st.seasonBase.day < 0) st.seasonBase = baseOf(c);

  // ---- ticking ----
  function newDay(day: number, prevSeason: number, season: number, year: number): void {
    pending.push({ t: 'day', day });
    if (season !== prevSeason) pending.push({ t: 'season', season, year });
    const next = rollWeather(rng, st.weather, season);
    if (next !== st.weather) {
      st.weather = next;
      pending.push({ t: 'weather', kind: next });
    }
    sync();
    // The report of the day that ended, and of the season if it ended too, before the new day changes anything.
    dayReport(c);
    if (season !== prevSeason) seasonReport(c, prevSeason, season === 0 ? year - 1 : year);
    dailyLife(c);
    directorDay(c);
    outsideDay(c);
    floraDay(c);
    roadsDay(c);
    expireOffers(c);
    checkCrisis();
    for (const p of c.people) reviewAmbitions(c, p);
  }

  /** While the manager is away a village that would be lost parks itself instead of dying unseen. */
  function checkCrisis(): void {
    if (st.crisis) return;
    const n = c.people.length;
    // Nobody left ends the village whether or not the manager is there; the other crises only park it while they are away.
    const why = n === 0 ? 'nobody is left' : !st.away ? '' : n <= CRISIS_PEOPLE ? `only ${n} people are left` : foodDaysOf(c) < CRISIS_FOOD_DAYS ? 'the food has run out' : '';
    if (!why) return;
    st.crisis = why;
    st.speed = 0;
    pushFeed(st, pending, 'crisis', n === 0 ? `Nobody is left in ${st.villageName}. It lasted ${Math.floor(c.day / DAYS_PER_YEAR)} years and ${c.day % DAYS_PER_YEAR} days, with ${st.peak} people at the most.` : `The village stopped itself while you were away: ${why}. It waits for you.`);
  }

  function tick(dt: number): void {
    const before = st.totalMs;
    st.totalMs += dt;
    const prev = clockOf(before);
    const now = clockOf(st.totalMs);
    sync();
    if (now.day !== prev.day) newDay(now.day, prev.season, now.season, now.year);
    lightHearths(c);
    if (st.jobsAt < 0 || st.totalMs - st.jobsAt >= GAME_HOUR_MS) {
      st.jobsAt = st.totalMs;
      runRules(c);
      refreshJobs(c);
    }
    for (const p of c.people) {
      if (p.counters.dead) continue;
      tickPerson(c, p, dt);
    }
  }

  // The state object is replaced on restore only before this point, so `c.st` stays valid.
  return {
    seed: opts.seed,
    world,

    get speed(): Speed {
      return st.speed;
    },

    command(cmd: SimCommand): CommandResult {
      if (cmd.t === 'away') {
        if (cmd.on && !st.away) st.away = { since: c.day, base: baseOf(c) };
        else if (!cmd.on && st.away) {
          awayReport(c);
          st.away = null;
          st.crisis = null;
        }
        return { ok: true };
      }
      if (cmd.t === 'priority') return setPriority(c, cmd.group, cmd.level);
      if (cmd.t === 'rule') return setRule(c, cmd.rule);
      if (cmd.t === 'rule_del') return deleteRule(c, cmd.id);
      if (cmd.t === 'answer') return answerOffer(c, cmd.offer, cmd.option);
      if (cmd.t === 'read') return markRead(c, cmd.report), { ok: true };
      if (cmd.t === 'ration') {
        if (cmd.level !== 0 && cmd.level !== 1 && cmd.level !== 2) return { ok: false, code: 'bad_ration', text: 'Unknown rationing level.' };
        st.rationing = cmd.level;
        return { ok: true, text: cmd.level === 0 ? 'Full portions again.' : cmd.level === 1 ? 'Rations are tight.' : 'Strict rations.' };
      }
      if (cmd.t === 'speed') {
        if (!SPEEDS.includes(cmd.speed)) return { ok: false, code: 'bad_speed', text: 'Unknown speed.' };
        st.speed = cmd.speed as Speed;
        return { ok: true };
      }
      sync();
      if (cmd.t === 'build') return placeOrder(c, cmd.kind, cmd.x, cmd.y, cmd.rot === true, null);
      if (cmd.t === 'demolish') return orderDemolish(c, cmd.building, cmd.plot);
      if (cmd.t === 'cancel') return cancelOrder(c, cmd.order);
      return { ok: false, code: 'unknown_command', text: 'Unknown command.' };
    },

    step(dtGameMs: number): void {
      if (!(dtGameMs > 0)) return;
      st.carryMs += dtGameMs;
      while (st.carryMs >= SIM_STEP_MS) {
        st.carryMs -= SIM_STEP_MS;
        tick(SIM_STEP_MS);
      }
    },

    view(): VillageView {
      sync();
      const clock = clockOf(st.totalMs);
      const time: TimeView = {
        hours: clock.hours,
        day: clock.day,
        dayOfSeason: clock.dayOfSeason,
        season: clock.season,
        year: clock.year,
        weather: st.weather,
        hourMs: GAME_HOUR_MS,
      };
      const here = c.people;
      return {
        time,
        speed: st.speed,
        entities: here.map((p) => entityView(c, p)),
        buildings: st.buildings.map((b) => ({ ...b, door: { ...b.door } })),
        plots: st.plots.map((p) => ({ ...p })),
        stock: Object.fromEntries(Object.entries(st.stock).map(([k, v]) => [k, Math.round(v * 10) / 10])),
        population: here.length,
        roster: here.map((p) => briefOf(c, p)),
        feed: st.feed.slice(-FEED_IN_VIEW).map((f) => ({ ...f, people: f.people.slice() })),
        orders: orderViews(c),
        wishes: wishes(c),
        status: statusOf(c),
        policy: {
          priorities: st.priorities.slice(),
          rules: st.rules.map((r) => ({ id: r.id, enabled: r.enabled, cond: { ...r.cond }, act: { ...r.act } as RuleDef['act'] })),
          offers: st.offers.map(({ n: _n, ...o }) => ({ ...o, options: o.options.map((x) => ({ ...x })) })),
          away: st.away !== null,
          crisis: st.crisis,
          maxRules: Math.min(MAX_RULES, BAL.tiers.maxRules[st.tier]),
          ring: st.ring ? { ...st.ring } : null,
          wall: wallState(c),
        },
        outside: outsideView(c),
        flora: floraView(st.flora),
        ground: groundView(st.ground),
        reports: st.reports.map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l })) })),
      };
    },

    sheet(id: number): PersonSheet | null {
      sync();
      const p = c.person(id);
      return p && !p.away ? sheetOf(c, p) : null;
    },

    events(): SimEvent[] {
      return pending.splice(0, pending.length);
    },

    serialize(): SimSnapshot {
      return serializeState(st, rng);
    },

    inspect(): Readonly<SimState> {
      return st;
    },
  };
}

export { DAYS_PER_YEAR, dayOf };
