import { describe, expect, it } from 'vitest';
import { strHash, GAME_DAY_MS, GAME_HOUR_MS, SIM_STEP_MS, START_HOUR, DAYS_PER_SEASON, isPassable } from '@hearth/shared';
import { createSim, SnapshotError, SNAPSHOT_VERSION, type SimSnapshot } from './index';

const DAY = GAME_DAY_MS;

function run(seed: number, ms: number, chunk = SIM_STEP_MS) {
  const sim = createSim({ seed });
  for (let t = 0; t < ms; t += chunk) sim.step(chunk);
  return sim;
}

describe('sim: determinism', () => {
  it('gives identical serialization for the same seed and steps', () => {
    const a = run(7, DAY / 2);
    const b = run(7, DAY / 2);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });

  it('does not depend on how game time is chunked into step calls', () => {
    const a = run(7, DAY / 4, SIM_STEP_MS);
    const b = run(7, DAY / 4, SIM_STEP_MS * 10);
    const c = createSim({ seed: 7 });
    // Chunks that are not a multiple of the step: the sim carries the remainder.
    for (let left = DAY / 4; left > 0; left -= 37) c.step(Math.min(37, left));
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
    expect(JSON.stringify(c.serialize())).toBe(JSON.stringify(a.serialize()));
  });

  it('differs between seeds', () => {
    const a = run(1, 60_000).serialize();
    const b = run(2, 60_000).serialize();
    expect(JSON.stringify(a.people)).not.toBe(JSON.stringify(b.people));
  });

  it('uses no wall clock or Math.random', () => {
    const realNow = Date.now;
    const realRandom = Math.random;
    Date.now = () => {
      throw new Error('Date.now used');
    };
    Math.random = () => {
      throw new Error('Math.random used');
    };
    try {
      run(3, 30_000);
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
  });
});

describe('sim: serialize and restore', () => {
  it('round-trips through JSON and keeps running identically', () => {
    const a = run(11, DAY / 3);
    const snap = JSON.parse(JSON.stringify(a.serialize()));
    expect(snap.v).toBe(SNAPSHOT_VERSION);
    const b = createSim({ seed: 11, saved: snap });
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
    expect(JSON.stringify(b.view())).toBe(JSON.stringify(a.view()));
    a.step(DAY / 3);
    b.step(DAY / 3);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
  });

  it('keeps the speed in the snapshot', () => {
    const a = createSim({ seed: 5 });
    a.command({ t: 'speed', speed: 4 });
    const b = createSim({ seed: 5, saved: JSON.parse(JSON.stringify(a.serialize())) });
    expect(b.view().speed).toBe(4);
  });

  it('rejects snapshots it cannot read', () => {
    const snap = run(5, 1000).serialize();
    expect(() => createSim({ seed: 5, saved: { ...snap, v: SNAPSHOT_VERSION + 1 } })).toThrow(SnapshotError);
    expect(() => createSim({ seed: 5, saved: { ...snap, speed: 3 } })).toThrow(SnapshotError);
    expect(() => createSim({ seed: 5, saved: { ...snap, people: 'no' as never } })).toThrow(SnapshotError);
    expect(() => createSim({ seed: 5, saved: { ...snap, people: [{ id: 1 } as never] } })).toThrow(SnapshotError);
    expect(() => createSim({ seed: 6, saved: snap })).toThrow(/seed/);
    expect(() => createSim({ seed: 5, saved: null as never, population: 1 })).not.toThrow();
  });
});

describe('sim: calendar, seasons and weather', () => {
  it('rolls over days, seasons and the year and reports it in events', { timeout: 120_000 }, () => {
    // The calendar does not depend on how many people live in the village: two keep the test quick on a slow machine.
    const sim = createSim({ seed: 9, population: 2 });
    const step = DAY / 2; // half a day per call keeps the test fast
    let days = 0;
    let seasons = 0;
    const lastSeasons: number[] = [];
    for (let d = 0; d < DAYS_PER_SEASON * 4 + 2; d++) {
      sim.step(step);
      sim.step(step);
      for (const e of sim.events()) {
        if (e.t === 'day') days++;
        if (e.t === 'season') {
          seasons++;
          lastSeasons.push(e.season);
        }
      }
    }
    expect(days).toBeGreaterThanOrEqual(DAYS_PER_SEASON * 4);
    expect(seasons).toBe(4);
    expect(lastSeasons).toEqual([1, 2, 3, 0]);
    const t = sim.view().time;
    expect(t.year).toBe(1);
    expect(t.season).toBe(0);
    expect(sim.events()).toEqual([]);
  });

  it('starts at dawn and advances the clock with game time', () => {
    const sim = createSim({ seed: 9 });
    expect(sim.view().time.hours).toBe(START_HOUR);
    sim.step(GAME_HOUR_MS * 3);
    expect(sim.view().time.hours).toBeCloseTo(START_HOUR + 3, 5);
    expect(sim.view().time.day).toBe(0);
  });

  it('only snows in winter', () => {
    const sim = createSim({ seed: 21, population: 2 });
    for (let d = 0; d < DAYS_PER_SEASON * 3; d++) {
      sim.step(DAY);
      const v = sim.view().time;
      if (v.season !== 3) expect(v.weather).not.toBe('snow');
    }
  });
});

describe('sim: commands', () => {
  it('changes speed and refuses unknown speeds', () => {
    const sim = createSim({ seed: 1 });
    expect(sim.view().speed).toBe(1);
    expect(sim.command({ t: 'speed', speed: 0 })).toEqual({ ok: true });
    expect(sim.view().speed).toBe(0);
    expect(sim.command({ t: 'speed', speed: 3 as never }).ok).toBe(false);
    expect(sim.view().speed).toBe(0);
  });
});

describe('sim: the villagers', () => {
  it('start with 12 people at home, on walkable ground, with minds of their own', () => {
    const sim = createSim({ seed: 1337 });
    const v = sim.view();
    expect(v.population).toBe(12);
    expect(v.entities).toHaveLength(12);
    expect(v.roster).toHaveLength(12);
    expect(v.buildings.length).toBeGreaterThanOrEqual(6);
    expect(v.plots).toHaveLength(2);
    for (const e of v.entities) expect(isPassable(sim.world, e.x, e.y)).toBe(true);
    expect(new Set(v.entities.map((e) => e.id)).size).toBe(12);
    for (const p of sim.inspect().people) {
      expect(p.traits.length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(p.skills).length).toBeGreaterThanOrEqual(15);
      expect(p.known.length).toBeGreaterThan(5);
    }
    // Families live together: couples are partners, children know their parents.
    const people = sim.inspect().people;
    for (const p of people) if (p.partner !== null) expect(people.find((x) => x.id === p.partner)?.partner).toBe(p.id);
  });

  it('work, eat, sleep and walk on walkable ground through a day', () => {
    const sim = createSim({ seed: 1337 });
    const acts = new Set<string>();
    let walking = 0;
    for (let i = 0; i < 24 * 4; i++) {
      sim.step(GAME_HOUR_MS / 4);
      for (const e of sim.view().entities) {
        expect(isPassable(sim.world, e.x, e.y)).toBe(true);
        if (e.state === 'walk') {
          walking++;
          expect(e.nx).toBeDefined();
          expect(e.step).toBeGreaterThan(0);
        }
      }
      for (const p of sim.inspect().people) if (p.act) acts.add(p.act.step.a);
    }
    expect(walking).toBeGreaterThan(50);
    for (const a of ['sleep', 'eat']) expect(acts.has(a)).toBe(true);
    // Somebody did real work for the village.
    expect(sim.inspect().stats.jobs_done).toBeGreaterThan(0);
  });

  it('sleep indoors through most of the night', () => {
    const sim = createSim({ seed: 1337 });
    sim.step((24 - START_HOUR + 2) * GAME_HOUR_MS);
    const v = sim.view();
    expect(v.time.hours).toBeGreaterThanOrEqual(2);
    const sleepy = sim.inspect().people.filter((p) => p.act?.step.a === 'sleep' || p.hidden);
    expect(sleepy.length).toBeGreaterThanOrEqual(7);
  });

  // A full year of the whole village is what this proves, so it gets room on a slow machine (about 8 s here, 5 times that on a small server).
  it('feed and warm themselves through the first winter without starving', { timeout: 180_000 }, () => {
    const sim = createSim({ seed: 1337 });
    for (let d = 0; d < DAYS_PER_SEASON * 4; d++) sim.step(DAY);
    const st = sim.inspect();
    expect(st.stats.death_hunger ?? 0).toBe(0);
    expect(st.stats.death_thirst ?? 0).toBe(0);
    expect(st.stats.death_cold ?? 0).toBe(0);
    expect(st.people.length).toBeGreaterThanOrEqual(12);
    expect(st.stats.harvest_ripe).toBeGreaterThan(0);
  });

  it('keep every person busy or explained: nobody is blocked for three days', () => {
    const sim = createSim({ seed: 21 });
    let worst = 0;
    for (let d = 0; d < 24; d++) {
      sim.step(DAY);
      const st = sim.inspect();
      for (const p of st.people) if (p.blocked) worst = Math.max(worst, (st.totalMs - p.blocked.since) / DAY);
    }
    expect(worst).toBeLessThan(3);
  });

  it('explain what each person is doing in a sentence they can show on the sheet', () => {
    const sim = createSim({ seed: 1337 });
    sim.step(DAY / 2);
    for (const b of sim.view().roster) {
      const s = sim.sheet(b.id)!;
      expect(s).not.toBeNull();
      expect(s.doing.length).toBeGreaterThan(2);
      expect(s.why.goal.length).toBeGreaterThan(2);
      expect(s.needs).toHaveLength(7);
      expect(s.traits.length).toBeGreaterThanOrEqual(2);
      expect(s.mood).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(s)).not.toMatch(/[　-鿿]/);
    }
    expect(sim.sheet(99999)).toBeNull();
  });

  it('put births, arrivals, deaths and dreams in the feed', { timeout: 120_000 }, () => {
    const sim = createSim({ seed: 1337 });
    const kinds = new Set<string>();
    for (let d = 0; d < DAYS_PER_SEASON * 2; d++) {
      sim.step(DAY);
      for (const e of sim.events()) if (e.t === 'feed') kinds.add(e.item.kind);
    }
    expect(kinds.has('farm')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(sim.view().feed.length).toBeGreaterThan(0);
  });

  it('supports other population sizes', () => {
    const sim = createSim({ seed: 3, population: 60 });
    sim.step(30_000);
    expect(sim.view().entities).toHaveLength(60);
  });
});

describe('sim: save and load', () => {
  it('continues exactly as it would have after a save and load in the middle of the run', () => {
    const a = createSim({ seed: 11 });
    a.step(DAY * 3);
    const saved = JSON.parse(JSON.stringify(a.serialize())) as SimSnapshot;
    const b = createSim({ seed: 11, saved });
    a.step(DAY * 2);
    b.step(DAY * 2);
    expect(JSON.stringify(b.serialize())).toBe(JSON.stringify(a.serialize()));
  });

  it('upgrades a version 1 snapshot (the M0 placeholder villagers) into people with minds', () => {
    const base = createSim({ seed: 17 }).serialize();
    const old = {
      v: 1,
      seed: 17,
      rng: base.rng,
      totalMs: 5 * GAME_HOUR_MS,
      carryMs: 0,
      speed: 2,
      weather: 'clear',
      nextId: 4,
      villageName: 'Old Ford',
      stock: { grain: 70, firewood: 20, timber: 10, stone: 5 },
      buildings: base.buildings,
      plots: base.plots,
      villagers: [1, 2, 3].map((id) => ({ id, name: `Villager ${id}`, look: base.people[0].look, role: 'villager', home: base.buildings[id - 1].id, x: base.buildings[id - 1].door.x, y: base.buildings[id - 1].door.y, path: [], nx: 0, ny: 0, stepMs: 0, stepLeft: 0, face: 0, act: null, wait: 0, goal: -1 })),
    };
    const sim = createSim({ seed: 17, saved: old as unknown as SimSnapshot });
    const st = sim.inspect();
    expect(st.people.map((p) => p.name)).toEqual(['Villager 1', 'Villager 2', 'Villager 3']);
    expect(st.stock.ration).toBe(70);
    expect(st.stock.wood).toBe(20);
    expect(st.stock.planks).toBe(10);
    expect(sim.view().speed).toBe(2);
    expect(sim.serialize().v).toBe(SNAPSHOT_VERSION);
    // And it lives on.
    sim.step(DAY);
    expect(sim.view().entities).toHaveLength(3);
  });
});

describe('sim: golden run', () => {
  // A fingerprint of seed 1337 after four game days. It changes whenever the behaviour of the village changes on purpose:
  // when it does, check the new run looks right (npm run soak) and update the digest and the facts below together.
  // M6: the facts moved a little (37 jobs, 94 meals, 35 chats before): woodcutters and foragers now walk to a real tree or bush, and the snapshot
  // is version 7 (the living ground, the roads).
  // M5: the facts moved a little (38 jobs, 93 meals, 16 chats before) because the Outside draws from the village's random stream every
  // day (its wealth drifts, a rumour may come), which reshuffles the later draws; the snapshot is version 6 (silver, tier, peak, the Outside).
  // M4: the facts are unchanged; the digest moved because the snapshot is version 5 (priorities, rules, offers, reports, away).
  // M3: the facts moved (28 jobs, 92 meals, 74 chats before) because the hearths now burn the village's wood from the first evening, which
  // sends more people to the woodpile in the first days; the snapshot also has three new fields (rationing, hearthDay, dir). The director's
  // own random stream is forked, so it does not shift the village's.
  // M2: the facts are unchanged; the digest moved only because the snapshot is version 3 (orders and id counters), a stock job
  // for thatch, a longer ban-key format and one ambition's stuck text (diffed against the M1 snapshot of the same run).
  it('matches the recorded run', () => {
    const sim = createSim({ seed: 1337 });
    sim.step(4 * DAY);
    const snap = sim.serialize();
    const st = sim.inspect();
    const facts = { people: st.people.length, day: sim.view().time.day, jobsDone: Math.round(st.stats.jobs_done ?? 0), meals: Math.round(st.stats.meals ?? 0), chats: st.stats.chats ?? 0 };
    // Floats can differ in their last digit between Node versions: round them (here only, never in the sim) before hashing.
    const json = JSON.stringify(snap, (_k, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v));
    const digest = `${strHash(json).toString(16)}:${json.length}`;
    expect({ facts, digest }).toEqual(GOLDEN);
  });
});

const GOLDEN = { facts: { people: 12, day: 4, jobsDone: 32, meals: 92, chats: 23 }, digest: '45c3457a:43389' };
