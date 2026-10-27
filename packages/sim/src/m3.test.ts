import { describe, expect, it } from 'vitest';
import { BAL, GAME_DAY_MS, GAME_HOUR_MS, Rng, type BuildingDef } from '@hearth/shared';
import { defenceOf, directorDay, harvestKeeps, refugees, startPlague } from './director';
import { blightReach, foodDaysOf, fuelDaysOf, lightHearths, rationOf, spoil, statusOf, woodGoal } from './economy';
import { refreshJobs } from './jobs';
import { restoreState, SNAPSHOT_VERSION, type SimSnapshot } from './serialize';
import { createSim } from './sim';
import { kit, setStock, type Kit } from './testkit';

/** A finished building of a kind, put on the map somewhere harmless (the tests only count them). */
function addBuilding(k: Kit, kind: BuildingDef['kind'], n = 1): void {
  for (let i = 0; i < n; i++) {
    const id = k.st.nextBuildingId++;
    k.st.buildings.push({ id, kind, x: 2 + i * 4, y: 2, w: 2, d: 2, door: { x: 2 + i * 4, y: 4 } });
  }
}

/** Put the clock of the context at a day and hour (the tests call the systems directly). */
function at(k: Kit, day: number, hour: number): void {
  k.c.day = day;
  k.c.hour = hour;
  k.c.season = Math.floor(day / 24) % 4;
  k.c.now = day * GAME_DAY_MS + hour * GAME_HOUR_MS;
}

describe('hearths and winter wood', () => {
  it('burn wood for every house with people in it, once an evening, and light a fire there', () => {
    const k = kit();
    at(k, 80, 17.5);
    setStock(k, { wood: 100 });
    const houses = k.st.buildings.filter((b) => b.kind === 'house' && k.st.people.some((p) => p.home === b.id)).length;
    expect(houses).toBeGreaterThan(2);
    lightHearths(k.c);
    expect(k.st.stock.wood).toBeCloseTo(100 - houses * BAL.heat.woodPerHouse[3], 5);
    const lit = k.st.buildings.filter((b) => (k.st.fires[b.id] ?? 0) > k.c.now).length;
    expect(lit).toBe(houses);
    // the same evening, a second call does nothing
    lightHearths(k.c);
    expect(k.st.stock.wood).toBeCloseTo(100 - houses * 6, 5);
  });

  it('burn less in spring and autumn, nothing in summer, and wait for the lighting hour', () => {
    const k = kit();
    setStock(k, { wood: 100 });
    at(k, 10, 17.5);
    lightHearths(k.c);
    const spring = 100 - k.st.stock.wood;
    expect(spring).toBeGreaterThan(0);
    expect(spring).toBeLessThan(15);
    setStock(k, { wood: 100 });
    at(k, 30, 17.5);
    lightHearths(k.c);
    expect(k.st.stock.wood).toBe(100);
    setStock(k, { wood: 100 });
    at(k, 85, 12);
    lightHearths(k.c);
    expect(k.st.stock.wood).toBe(100);
  });

  it('leave houses cold and say so when the wood is gone', () => {
    const k = kit();
    at(k, 80, 17.5);
    setStock(k, { wood: 0 });
    lightHearths(k.c);
    expect(k.st.stats.cold_nights).toBeGreaterThan(2);
    expect(k.st.feed.some((f) => f.kind === 'cold')).toBe(true);
    expect(Object.values(k.st.fires).every((until) => until <= k.c.now)).toBe(true);
  });

  it('aim at a winter of wood in the autumn, and press harder the emptier the store is', () => {
    const k = kit();
    at(k, 60, 9);
    setStock(k, { wood: 50 });
    const poor = woodGoal(k.c);
    expect(poor.priority).toBe(5);
    expect(poor.target).toBeGreaterThan(24 * 6 * 3);
    setStock(k, { wood: poor.target });
    expect(woodGoal(k.c).priority).toBe(3);
    expect(fuelDaysOf(k.c)).toBeGreaterThan(10);
  });
});

describe('spoilage and rations', () => {
  it('spoils raw food slowly, cooked food faster, and less in winter and with a second storehouse', () => {
    const k = kit();
    at(k, 10, 9);
    setStock(k, { ration: 100, meal: 100 });
    spoil(k.c);
    expect(k.st.stock.ration).toBeCloseTo(100 * (1 - BAL.spoil.ration), 6);
    expect(k.st.stock.meal).toBeLessThan(k.st.stock.ration);
    setStock(k, { ration: 100 });
    at(k, 80, 9);
    spoil(k.c);
    const winter = 100 - k.st.stock.ration;
    addBuilding(k, 'warehouse');
    setStock(k, { ration: 100 });
    spoil(k.c);
    expect(100 - k.st.stock.ration).toBeLessThan(winter);
    expect(winter).toBeLessThan(BAL.spoil.ration * 100);
  });

  it('are set by the manager, rejected when unknown, and change what a portion is', () => {
    const k = kit();
    expect(k.sim.command({ t: 'ration', level: 1 }).ok).toBe(true);
    expect(statusOf(k.c).rationing).toBe(1);
    expect(rationOf(k.c).portion).toBeLessThan(1);
    expect(rationOf(k.c).points).toBeLessThan(1);
    expect(rationOf(k.c).points).toBeGreaterThan(rationOf(k.c).portion);
    expect(k.sim.command({ t: 'ration', level: 2 }).ok).toBe(true);
    expect(rationOf(k.c).portion).toBeLessThan(0.8);
    expect(k.sim.command({ t: 'ration', level: 7 as 0 }).ok).toBe(false);
    expect(statusOf(k.c).rationing).toBe(2);
    k.sim.command({ t: 'ration', level: 0 });
    expect(rationOf(k.c)).toEqual({ portion: 1, points: 1, mood: 0 });
  });

  it('make the food last longer: strict rations use less of the store over the same days', { timeout: 60_000 }, () => {
    const run = (level: 0 | 2): number => {
      const sim = createSim({ seed: 11 });
      sim.step(2 * GAME_HOUR_MS);
      sim.command({ t: 'ration', level });
      const st = sim.inspect() as { stock: Record<string, number> };
      st.stock.ration = 400;
      st.stock.meal = 0;
      sim.step(3 * GAME_DAY_MS);
      return 400 - st.stock.ration - st.stock.meal;
    };
    expect(run(2)).toBeLessThan(run(0));
  });

  it('report the days of food and fuel in the status', () => {
    const k = kit();
    setStock(k, { ration: 60, meal: 0, wood: 100 });
    const s = statusOf(k.c);
    expect(s.foodDays).toBeCloseTo(60 / k.c.people.length, 1);
    expect(s.fuelDays).toBeGreaterThan(0);
    expect(s.alert).toBe(null);
    expect(foodDaysOf(k.c)).toBeCloseTo(s.foodDays, 1);
  });
});

describe('the events director', () => {
  it('warns of a raid a day before it comes, and fixes the next one a few weeks on', () => {
    const k = kit();
    at(k, 45, 0);
    k.st.dir.nextRaid = 45;
    directorDay(k.c);
    expect(k.st.dir.raid).not.toBeNull();
    expect(k.st.dir.raid!.day).toBe(46);
    expect(k.st.dir.raid!.size).toBeGreaterThanOrEqual(BAL.director.raid.size[0]);
    expect(k.st.feed.at(-1)!.kind).toBe('raid');
    expect(statusOf(k.c).alert).toBe('raid');
    at(k, 46, 0);
    directorDay(k.c);
    expect(k.st.dir.raid).toBeNull();
    expect(k.st.stats.raids).toBe(1);
    expect(k.st.dir.nextRaid).toBeGreaterThan(46 + BAL.director.raid.gap - BAL.director.raid.spread - 1);
  });

  it('leaves a village too small to survive it alone for a while', () => {
    const k = kit(1, 12);
    k.st.people.length = 4;
    at(k, 45, 0);
    k.st.dir.nextRaid = 45;
    directorDay(k.c);
    expect(k.st.dir.raid).toBeNull();
    expect(k.st.dir.nextRaid).toBeGreaterThan(45);
  });

  const raidOutcome = (size: number, prepare: (k: Kit) => void): { repelled: number; overrun: number; lost: number; k: Kit } => {
    const k = kit(5, 12);
    prepare(k);
    at(k, 50, 0);
    setStock(k, { ration: 100, wood: 100, planks: 50, cloth: 10, tool: 4 });
    k.st.dir.raid = { day: 50, size, warned: true };
    directorDay(k.c);
    const s = k.st.stats;
    return { repelled: s.raids_repelled ?? 0, overrun: s.raids_overrun ?? 0, lost: s.loot ?? 0, k };
  };

  it('is driven off by a prepared village, and costs it nothing', () => {
    const r = raidOutcome(3, (k) => {
      addBuilding(k, 'watchpost', 2);
      addBuilding(k, 'wall', 4);
    });
    expect(r.repelled).toBe(1);
    expect(r.lost).toBe(0);
  });

  it('breaks into a village with no defence at all, takes goods and hurts people', () => {
    const r = raidOutcome(12, () => undefined);
    expect(r.overrun).toBe(1);
    expect(r.lost).toBeGreaterThan(10);
    expect(r.k.st.stats.wounds).toBeGreaterThanOrEqual(2);
    expect(r.k.st.feed.at(-1)!.kind).toBe('raid');
    expect(r.k.st.stock.ration).toBeLessThan(100);
  });

  it('counts watch posts, walls and people on watch towards the defence, but not buildings still going up', () => {
    const k = kit();
    at(k, 50, 0);
    const base = defenceOf(k.c);
    addBuilding(k, 'watchpost');
    expect(defenceOf(k.c)).toBeCloseTo(base + BAL.defence.watchpost, 5);
    addBuilding(k, 'wall', 2);
    expect(defenceOf(k.c)).toBeCloseTo(base + BAL.defence.watchpost + 2 * BAL.defence.wall, 5);
    const before = defenceOf(k.c);
    const watcher = k.c.people.find((p) => p.hp >= 40 && p.born < -16 * 96)!;
    watcher.counters.watchAt = k.c.now - GAME_HOUR_MS;
    const gain = (BAL.defence.onWatch - 1) * (BAL.defence.base + BAL.defence.perFighting * watcher.skills.fighting.lv);
    expect(defenceOf(k.c)).toBeCloseTo(before + gain, 5);
    addBuilding(k, 'watchpost');
    k.st.buildings.at(-1)!.con = { mode: 'build', done: 1, pct: 10, order: 99 };
    expect(defenceOf(k.c)).toBeCloseTo(before + gain, 5);
  });

  it('posts a watch job where there are posts, and a bigger one while raiders are expected', () => {
    const k = kit();
    refreshJobs(k.c);
    expect(k.st.jobs.some((j) => j.key === 'watch:duty')).toBe(false);
    k.st.dir.raid = { day: 99, size: 4, warned: true };
    refreshJobs(k.c);
    const job = k.st.jobs.find((j) => j.key === 'watch:duty')!;
    expect(job.slots).toBe(2);
    expect(job.priority).toBe(5);
    k.st.dir.raid = null;
    addBuilding(k, 'watchpost', 2);
    refreshJobs(k.c);
    expect(k.st.jobs.find((j) => j.key === 'watch:duty')!.slots).toBe(4);
  });

  it('spoils about one harvest in five, and none before the autumn of the first year', () => {
    const k = kit();
    at(k, 10, 9);
    for (let i = 0; i < 50; i++) expect(harvestKeeps(k.c).keeps).toBe(1);
    at(k, 60, 9);
    let bad = 0;
    for (let i = 0; i < 1000; i++) if (harvestKeeps(k.c).keeps < 1) bad++;
    expect(bad).toBeGreaterThan(140);
    expect(bad).toBeLessThan(260);
  });

  it('brings a plague that sickens a few, and kills one who is near death', () => {
    const k = kit(2, 14);
    at(k, 120, 9);
    startPlague(k.c);
    const sick = k.st.people.filter((p) => p.ills.some((i) => i.id === 'plague'));
    expect(sick.length).toBeGreaterThanOrEqual(BAL.director.plague.min);
    expect(sick.length).toBeLessThanOrEqual(BAL.director.plague.max);
    expect(k.st.feed.at(-1)!.kind).toBe('plague');
    expect(statusOf(k.c).alert).toBe('plague');
    const victim = sick.find((p) => k.c.day - p.born > 5 * 96)!;
    victim.hp = 0.2;
    const n = k.st.people.length;
    k.sim.step(3 * GAME_HOUR_MS);
    expect(k.st.people.length).toBe(n - 1);
    expect(k.st.graves.at(-1)!.cause).toBe('plague');
  });

  it('lets the sick recover, so nobody stays sick for ever', () => {
    const k = kit(2, 14);
    at(k, 120, 9);
    startPlague(k.c);
    for (let d = 0; d < 60; d++) {
      at(k, 121 + d, 9);
      directorDay(k.c);
      for (const p of k.st.people) p.hp = p.maxHp;
    }
    expect(k.st.people.some((p) => p.ills.some((i) => i.id === 'plague'))).toBe(false);
    expect(k.st.stats.plague_recoveries).toBeGreaterThanOrEqual(3);
  });

  it('takes refugees in when there is food for them and sends them on when there is not', () => {
    const fed = kit(4, 12);
    at(fed, 60, 9);
    setStock(fed, { ration: 400 });
    const n = fed.st.people.length;
    refugees(fed.c);
    expect(fed.st.people.length).toBeGreaterThanOrEqual(n + BAL.director.refugees.count[0]);
    expect(fed.st.stats.refugees_taken).toBeGreaterThanOrEqual(2);
    const poor = kit(4, 12);
    at(poor, 60, 9);
    setStock(poor, { ration: 20 });
    const m = poor.st.people.length;
    refugees(poor.c);
    expect(poor.st.people.length).toBe(m);
    expect(poor.st.stats.refugees_turned_away).toBeGreaterThanOrEqual(2);
    expect(poor.st.feed.at(-1)!.kind).toBe('refugees');
  });

  it('lets a travelling master teach for a while, then move on', () => {
    const k = kit(6, 14);
    at(k, 50, 9);
    k.st.dir.master = { name: 'Han Mu', skill: 'smithing', until: 55 };
    k.st.dir.nextRaid = 999;
    const total = (): number => k.c.people.reduce((s, p) => s + p.skills.smithing.lv * 1000 + p.skills.smithing.xp, 0);
    const before = total();
    directorDay(k.c);
    expect(total()).toBeGreaterThan(before);
    at(k, 55, 9);
    directorDay(k.c);
    expect(k.st.dir.master).toBeNull();
    expect(k.st.feed.at(-1)!.kind).toBe('master');
  });

  it('creeps the Blight in every month, and the shrines hold some of it back', () => {
    const k = kit();
    const shrines = k.st.buildings.filter((b) => b.kind === 'shrine' && !b.con).length;
    expect(shrines).toBeGreaterThan(0);
    for (let d = 1; d <= 3; d++) {
      at(k, d * BAL.director.blight.everyDays, 9);
      k.st.dir.blightDay = k.c.day;
      directorDay(k.c);
    }
    expect(k.st.dir.blight).toBe(3);
    expect(blightReach(k.c)).toBe(Math.max(0, 3 - shrines * 2));
    addBuilding(k, 'shrine');
    expect(blightReach(k.c)).toBe(Math.max(0, 3 - (shrines + 1) * 2));
    k.st.dir.blight = 9;
    at(k, 10, 9);
    setStock(k, { ration: 100 });
    spoil(k.c);
    expect(100 - k.st.stock.ration).toBeGreaterThan(BAL.spoil.ration * 100);
  });
});

describe('a winter', () => {
  it('without preparation runs the stores dry and hurts, and a prepared village comes through it', { timeout: 240_000 }, () => {
    const autumn = createSim({ seed: 3 });
    autumn.step(72 * GAME_DAY_MS);
    const saved = JSON.parse(JSON.stringify(autumn.serialize())) as SimSnapshot;
    const winter = (stock: Record<string, number>): { minFoodDays: number; minFoodNeed: number; deaths: number; coldNights: number; start: number; end: number } => {
      const sim = createSim({ seed: 3, saved });
      const st = sim.inspect() as { people: { needs: { food: number }; away: unknown }[]; stock: Record<string, number>; stats: Record<string, number> };
      Object.assign(st.stock, stock);
      // the winter is what is measured here, not a raid that happens to fall in it
      (sim.inspect() as { dir: { nextRaid: number } }).dir.nextRaid = 9999;
      const before = { ...st.stats };
      const start = st.people.length;
      let minFoodDays = Infinity;
      let minFoodNeed = 100;
      for (let d = 0; d < 24; d++) {
        sim.step(GAME_DAY_MS);
        const here = st.people.filter((p) => !p.away);
        minFoodDays = Math.min(minFoodDays, (st.stock.ration + st.stock.meal) / Math.max(1, here.length));
        minFoodNeed = Math.min(minFoodNeed, here.reduce((a, p) => a + p.needs.food, 0) / Math.max(1, here.length));
      }
      return { minFoodDays, minFoodNeed, deaths: (st.stats.deaths ?? 0) - (before.deaths ?? 0), coldNights: (st.stats.cold_nights ?? 0) - (before.cold_nights ?? 0), start, end: st.people.length };
    };
    const prepared = winter({ ration: 340, meal: 0, wood: 700 });
    const bare = winter({ ration: 25, meal: 0, wood: 15 });
    expect(prepared.coldNights).toBe(0);
    expect(prepared.minFoodDays).toBeGreaterThan(3);
    expect(prepared.deaths).toBe(0);
    expect(bare.minFoodDays).toBeLessThan(1);
    expect(bare.minFoodNeed).toBeLessThan(prepared.minFoodNeed);
  });
});

describe('saves', () => {
  it('upgrade a village from before M3: no director yet, so a fresh one whose first raid is weeks away', () => {
    const sim = createSim({ seed: 8 });
    sim.step(40 * GAME_DAY_MS);
    const snap = JSON.parse(JSON.stringify(sim.serialize())) as SimSnapshot & Record<string, unknown>;
    const raw: Record<string, unknown> = snap;
    raw.v = 3;
    delete raw.rationing;
    delete raw.hearthDay;
    delete raw.dir;
    const st = restoreState(snap, new Rng(1));
    expect(SNAPSHOT_VERSION).toBe(4);
    expect(st.rationing).toBe(0);
    expect(st.dir.raid).toBeNull();
    expect(st.dir.nextRaid).toBeGreaterThanOrEqual(40 + BAL.director.raid.first);
    expect(st.dir.blightDay).toBeGreaterThan(40);
    const again = createSim({ seed: 8, saved: snap });
    again.step(GAME_DAY_MS);
    expect(again.view().status.rationing).toBe(0);
  });

  it('keep the director, the rations and the hearths through a round trip', () => {
    const sim = createSim({ seed: 8 });
    sim.step(5 * GAME_DAY_MS);
    sim.command({ t: 'ration', level: 2 });
    const st = sim.inspect() as { dir: { raid: unknown; blight: number } };
    st.dir.blight = 4;
    st.dir.raid = { day: 99, size: 5, warned: true };
    const back = createSim({ seed: 8, saved: JSON.parse(JSON.stringify(sim.serialize())) as SimSnapshot });
    const b = back.inspect();
    expect(b.rationing).toBe(2);
    expect(b.dir.blight).toBe(4);
    expect(b.dir.raid).toEqual({ day: 99, size: 5, warned: true });
  });
});
