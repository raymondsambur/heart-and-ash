import {
  GAME_HOUR_MS,
  LOOK_RANGES,
  Rng,
  SIM_STEP_MS,
  SPEEDS,
  STEP_MS,
  generateWorld,
  personName,
  tileSpeed,
  villageName,
  findPath,
  worldPathGrid,
  type BuildingDef,
  type Dir,
  type EntityView,
  type Look,
  type PathGrid,
  type PlotDef,
  type Point,
  type Speed,
  type TimeView,
  type VillageView,
  type WeatherKind,
  type WorldData,
} from '@hearth/shared';
import { clockOf, dayOf } from './calendar';
import { PLACE_WEIGHT, placesOf, type Place } from './places';
import { restoreState, serializeState, type SimSnapshot } from './serialize';
import type { CommandResult, SimCommand, SimEvent, SimState, Villager } from './types';
import { rollWeather } from './weather';

export interface CreateSimOptions {
  seed: number;
  /** A snapshot produced by `serialize`; when given, `seed` must match it. */
  saved?: SimSnapshot | null;
  /** Number of placeholder villagers for a new village (default 12). The bench uses larger numbers. */
  population?: number;
}

/** The library contract (docs/ARCHITECTURE.md). Pure and deterministic: one seeded rng, no wall clock, no I/O. */
export interface Sim {
  readonly seed: number;
  /** The static map (identical for a given seed). */
  readonly world: WorldData;
  /** Orders from the player. */
  command(cmd: SimCommand): CommandResult;
  /** Advance by `dtGameMs` of game time. Any chunking gives the same result. */
  step(dtGameMs: number): void;
  /** Data for the client. Entity `step` and `route` are in game ms and tiles. */
  view(): VillageView;
  /** Events since the last call (reports, feed items, notifications). */
  events(): SimEvent[];
  /** Full state, versioned. */
  serialize(): SimSnapshot;
}

const INITIAL_STOCK = { grain: 80, firewood: 30, timber: 24, stone: 12 };
const ROUTE_LOOKAHEAD = 6;

function randomLook(rng: Rng): Look {
  return {
    gender: rng.int(0, 1) as 0 | 1,
    skin: rng.int(0, LOOK_RANGES.skin - 1),
    hairStyle: rng.int(0, LOOK_RANGES.hairStyle - 1),
    hairColor: rng.int(0, LOOK_RANGES.hairColor - 1),
    outfit: 0,
    outfitColor: rng.int(0, LOOK_RANGES.outfitColor - 1),
    sashColor: rng.int(0, LOOK_RANGES.sashColor - 1),
    accessory: rng.chance(0.25) ? rng.int(1, LOOK_RANGES.accessory - 1) : 0,
  };
}

function faceOf(dx: number, dy: number, keep: Dir): Dir {
  if (dx === 0 && dy === 0) return keep;
  const sx = dx - dy;
  const sy = dx + dy;
  if (sy >= 0) return sx >= 0 ? 0 : 1;
  return sx >= 0 ? 3 : 2;
}

function isNight(hours: number): boolean {
  return hours >= 21 || hours < 5.5;
}

export function createSim(opts: CreateSimOptions): Sim {
  const world = generateWorld(opts.seed);
  const grid: PathGrid = worldPathGrid(world);
  const rng = new Rng(opts.seed ^ 0x51a7e);
  const pending: SimEvent[] = [];
  let st: SimState;

  if (opts.saved) {
    if (opts.saved.seed !== opts.seed) throw new Error(`snapshot is for seed ${opts.saved.seed}, not ${opts.seed}`);
    st = restoreState(opts.saved, rng);
  } else {
    st = newState(opts.seed, world, rng, opts.population ?? 12);
  }

  const places: Place[] = placesOf(world, st.buildings, st.plots);
  const placeOfBuilding = (id: number): number => places.findIndex((p) => p.building === id);

  function newState(seed: number, w: WorldData, r: Rng, population: number): SimState {
    const buildings: BuildingDef[] = w.start.buildings.map((b) => ({ ...b, door: { ...b.door } }));
    const plots: PlotDef[] = w.start.plots.map((p) => ({ ...p }));
    const homes = buildings.filter((b) => b.kind === 'house');
    const state: SimState = {
      seed,
      totalMs: 0,
      carryMs: 0,
      speed: 1,
      weather: 'clear',
      nextId: 1,
      villageName: villageName(r),
      stock: { ...INITIAL_STOCK },
      buildings,
      plots,
      villagers: [],
    };
    state.weather = rollWeather(r, 'clear', 0);
    for (let i = 0; i < population; i++) {
      const home = homes[i % homes.length];
      state.villagers.push({
        id: state.nextId++,
        name: personName(r),
        look: randomLook(r),
        role: i === 0 ? 'elder' : 'villager',
        home: home.id,
        x: home.door.x,
        y: home.door.y,
        path: [],
        nx: home.door.x,
        ny: home.door.y,
        stepMs: 0,
        stepLeft: 0,
        face: 0,
        act: null,
        wait: r.int(0, 8000),
        goal: -1,
      });
    }
    return state;
  }

  function startStep(v: Villager): void {
    const next = v.path.shift();
    if (!next) {
      v.stepMs = 0;
      return;
    }
    const diag = next.x !== v.x && next.y !== v.y ? Math.SQRT2 : 1;
    const speed = tileSpeed(world, next.x, next.y) || 1;
    v.nx = next.x;
    v.ny = next.y;
    v.stepMs = Math.round((STEP_MS * diag) / speed);
    v.stepLeft = v.stepMs;
    v.face = faceOf(next.x - v.x, next.y - v.y, v.face);
    v.act = null;
  }

  function goTo(v: Villager, target: Point, goal: number): boolean {
    const path = findPath(grid, v.x, v.y, target.x, target.y);
    if (!path) return false;
    v.goal = goal;
    v.path = path;
    if (path.length > 0) startStep(v);
    return true;
  }

  function pickPlace(): number {
    const items: (readonly [number, number])[] = places.map((p, i) => [i, PLACE_WEIGHT[p.kind]] as const);
    return rng.weighted(items);
  }

  function arrive(v: Villager, hours: number): void {
    const place = v.goal >= 0 ? places[v.goal] : undefined;
    if (isNight(hours)) {
      v.act = 'rest';
      v.wait = 10_000;
    } else {
      v.act = place?.act ?? null;
      v.wait = rng.int(8000, 24000);
    }
    v.goal = -1;
  }

  function decide(v: Villager, hours: number): void {
    if (isNight(hours)) {
      const home = placeOfBuilding(v.home);
      const door = home >= 0 ? places[home].at : { x: v.x, y: v.y };
      if (v.x === door.x && v.y === door.y) {
        v.act = 'rest';
        v.wait = 10_000;
      } else if (!goTo(v, door, home)) v.wait = 2000;
      return;
    }
    const gi = pickPlace();
    const place = places[gi];
    let target = place.at;
    if (place.plot) {
      const p = place.plot;
      target = { x: p.x + rng.int(0, p.w - 1), y: p.y + rng.int(0, p.d - 1) };
    }
    if (target.x === v.x && target.y === v.y) {
      v.goal = gi;
      arrive(v, hours);
    } else if (!goTo(v, target, gi)) v.wait = 2000;
  }

  function tickVillager(v: Villager, dt: number, hours: number): void {
    if (v.stepMs > 0) {
      v.stepLeft -= dt;
      if (v.stepLeft > 0) return;
      v.x = v.nx;
      v.y = v.ny;
      v.stepMs = 0;
      v.stepLeft = 0;
      if (v.path.length > 0) startStep(v);
      else arrive(v, hours);
      return;
    }
    if (v.wait > 0) {
      v.wait -= dt;
      if (v.wait > 0) return;
      v.act = null;
    }
    decide(v, hours);
  }

  function tick(dt: number): void {
    const before = st.totalMs;
    st.totalMs += dt;
    const clock = clockOf(st.totalMs);
    const dayBefore = dayOf(before);
    const dayNow = dayOf(st.totalMs);
    if (dayNow !== dayBefore) {
      const prev = clockOf(before);
      pending.push({ t: 'day', day: dayNow });
      if (clock.season !== prev.season) pending.push({ t: 'season', season: clock.season, year: clock.year });
      const next = rollWeather(rng, st.weather, clock.season);
      if (next !== st.weather) {
        st.weather = next;
        pending.push({ t: 'weather', kind: next });
      }
    }
    for (const v of st.villagers) tickVillager(v, dt, clock.hours);
  }

  function entityView(v: Villager): EntityView {
    const moving = v.stepMs > 0;
    const e: EntityView = {
      id: v.id,
      name: v.name,
      x: v.x,
      y: v.y,
      face: v.face,
      state: moving ? 'walk' : v.act === 'rest' ? 'rest' : v.act ? 'work' : 'idle',
      look: v.look,
      role: v.role,
    };
    if (moving) {
      e.nx = v.nx;
      e.ny = v.ny;
      e.step = v.stepMs;
      // The tiles after the step in progress, so a client running faster than the update rate keeps walking.
      const n = Math.min(ROUTE_LOOKAHEAD, v.path.length);
      if (n > 0) {
        const route: number[] = [];
        for (let i = 0; i < n; i++) route.push(v.path[i].x, v.path[i].y);
        e.route = route;
      }
    } else if (v.act) e.act = v.act;
    return e;
  }

  return {
    seed: opts.seed,
    world,

    command(cmd: SimCommand): CommandResult {
      if (cmd.t === 'speed') {
        if (!SPEEDS.includes(cmd.speed)) return { ok: false, code: 'bad_speed', text: 'Unknown speed.' };
        st.speed = cmd.speed as Speed;
        return { ok: true };
      }
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
      const c = clockOf(st.totalMs);
      const time: TimeView = {
        hours: c.hours,
        day: c.day,
        dayOfSeason: c.dayOfSeason,
        season: c.season,
        year: c.year,
        weather: st.weather as WeatherKind,
        hourMs: GAME_HOUR_MS,
      };
      return {
        time,
        speed: st.speed,
        entities: st.villagers.map(entityView),
        buildings: st.buildings.map((b) => ({ ...b, door: { ...b.door } })),
        plots: st.plots.map((p) => ({ ...p })),
        stock: { ...st.stock },
        population: st.villagers.length,
      };
    },

    events(): SimEvent[] {
      return pending.splice(0, pending.length);
    },

    serialize(): SimSnapshot {
      return serializeState(st, rng);
    },
  };
}
