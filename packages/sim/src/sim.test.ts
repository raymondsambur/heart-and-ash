import { describe, expect, it } from 'vitest';
import { GAME_DAY_MS, GAME_HOUR_MS, SIM_STEP_MS, START_HOUR, DAYS_PER_SEASON, isPassable } from '@hearth/shared';
import { createSim, SnapshotError, SNAPSHOT_VERSION } from './index';

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
    expect(JSON.stringify(a.villagers)).not.toBe(JSON.stringify(b.villagers));
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
    expect(() => createSim({ seed: 5, saved: { ...snap, villagers: 'no' as never } })).toThrow(SnapshotError);
    expect(() => createSim({ seed: 6, saved: snap })).toThrow(/seed/);
    expect(() => createSim({ seed: 5, saved: null as never, population: 1 })).not.toThrow();
  });
});

describe('sim: calendar, seasons and weather', () => {
  it('rolls over days, seasons and the year and reports it in events', () => {
    const sim = createSim({ seed: 9 });
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
    const sim = createSim({ seed: 21 });
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

describe('sim: placeholder villagers', () => {
  it('starts with 12 people at home, on walkable ground', () => {
    const sim = createSim({ seed: 1337 });
    const v = sim.view();
    expect(v.population).toBe(12);
    expect(v.entities).toHaveLength(12);
    expect(v.buildings.length).toBeGreaterThanOrEqual(6);
    expect(v.plots).toHaveLength(1);
    for (const e of v.entities) expect(isPassable(sim.world, e.x, e.y)).toBe(true);
    expect(new Set(v.entities.map((e) => e.id)).size).toBe(12);
  });

  it('wander between buildings during the day and stay on walkable ground', () => {
    const sim = createSim({ seed: 1337 });
    const start = new Map(sim.view().entities.map((e) => [e.id, `${e.x},${e.y}`]));
    let moved = 0;
    let walking = 0;
    for (let i = 0; i < 1500; i++) {
      sim.step(SIM_STEP_MS);
      if (i % 20 !== 0) continue;
      for (const e of sim.view().entities) {
        expect(isPassable(sim.world, e.x, e.y)).toBe(true);
        if (e.state === 'walk') {
          walking++;
          expect(e.nx).toBeDefined();
          expect(e.step).toBeGreaterThan(0);
        }
      }
    }
    for (const e of sim.view().entities) if (start.get(e.id) !== `${e.x},${e.y}`) moved++;
    expect(moved).toBeGreaterThan(6);
    expect(walking).toBeGreaterThan(0);
  });

  it('go home and rest at night', () => {
    const sim = createSim({ seed: 1337 });
    // Run to 02:00 of the first night.
    sim.step((24 - START_HOUR + 2) * GAME_HOUR_MS);
    const v = sim.view();
    expect(v.time.hours).toBeGreaterThanOrEqual(2);
    const doors = new Map(v.buildings.map((b) => [b.id, b.door]));
    const homeOf = new Map(sim.serialize().villagers.map((p) => [p.id, p.home]));
    expect(v.entities.every((e) => e.state === 'rest')).toBe(true);
    for (const e of v.entities) expect(doors.get(homeOf.get(e.id)!)).toEqual({ x: e.x, y: e.y });
  });

  it('supports other population sizes', () => {
    const sim = createSim({ seed: 3, population: 60 });
    sim.step(30_000);
    expect(sim.view().entities).toHaveLength(60);
  });
});
