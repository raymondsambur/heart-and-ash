import { describe, expect, it } from 'vitest';
import { GAME_DAY_MS, MAP_SIZE, T, VILLAGE_W, generateWorld, villageConnected } from '@hearth/shared';
import type { SimSnapshot } from './serialize';
import { createSim } from './sim';

describe('the bigger map', () => {
  it('is generated for any size, the same every time, with the village in the middle and everything still joined up', () => {
    for (const seed of [3, 7, 11, 1337]) {
      const a = generateWorld(seed, MAP_SIZE, MAP_SIZE);
      const b = generateWorld(seed, MAP_SIZE, MAP_SIZE);
      expect(a.w).toBe(MAP_SIZE);
      expect(a.h).toBe(MAP_SIZE);
      expect(a.terrain).toEqual(b.terrain);
      expect(a.objects).toEqual(b.objects);
      expect(a.start.center).toEqual({ x: Math.floor(MAP_SIZE / 2) - 48 + 42, y: Math.floor(MAP_SIZE / 2) - 48 + 52 });
      expect(villageConnected(a), `seed ${seed}`).toBe(true);
      // the starting village is the same village, moved to the middle
      const small = generateWorld(seed);
      const dx = a.start.center.x - small.start.center.x;
      const dy = a.start.center.y - small.start.center.y;
      expect(a.start.buildings.map((q) => ({ k: q.kind, x: q.x - dx, y: q.y - dy }))).toEqual(small.start.buildings.map((q) => ({ k: q.kind, x: q.x, y: q.y })));
    }
  });

  it('has a lot more land: more trees to cut, more bushes to pick and more stone, and the old size is untouched', () => {
    const big = generateWorld(3, MAP_SIZE, MAP_SIZE);
    const small = generateWorld(3);
    expect(small.w).toBe(VILLAGE_W);
    const count = (w: { terrain: Uint8Array; objects: Uint8Array }, f: (t: number, o: number) => boolean): number => w.terrain.reduce((n, t, i) => n + (f(t, w.objects[i]) ? 1 : 0), 0);
    expect(count(big, (_t, o) => o === 1 || o === 2)).toBeGreaterThan(count(small, (_t, o) => o === 1 || o === 2) * 2);
    expect(count(big, (_t, o) => o === 5)).toBeGreaterThan(count(small, (_t, o) => o === 5) * 2);
    expect(count(big, (t) => t === T.Rock)).toBeGreaterThan(count(small, (t) => t === T.Rock));
  });
});

describe('a village and its map', () => {
  it('keeps the size it was made with, through a save and load, and an older save is the small map', { timeout: 120_000 }, () => {
    const big = createSim({ seed: 3, size: MAP_SIZE });
    expect(big.world.w).toBe(MAP_SIZE);
    big.step(3 * GAME_DAY_MS);
    const snap = JSON.parse(JSON.stringify(big.serialize())) as SimSnapshot;
    expect(snap.size).toBe(MAP_SIZE);
    const back = createSim({ seed: 3, saved: snap, size: 96 });
    expect(back.world.w).toBe(MAP_SIZE);
    expect(back.world.terrain).toEqual(big.world.terrain);
    big.step(2 * GAME_DAY_MS);
    back.step(2 * GAME_DAY_MS);
    expect(JSON.parse(JSON.stringify(back.serialize()))).toEqual(JSON.parse(JSON.stringify(big.serialize())));
    const small = createSim({ seed: 3 });
    small.step(GAME_DAY_MS);
    const old = JSON.parse(JSON.stringify(small.serialize())) as Record<string, unknown>;
    delete old.size;
    old.v = 6;
    const loaded = createSim({ seed: 3, saved: old as unknown as SimSnapshot, size: MAP_SIZE });
    expect(loaded.world.w).toBe(96);
  });

  it('lives on the big map: people walk, wood is cut, the wall plan fits', { timeout: 240_000 }, () => {
    const sim = createSim({ seed: 3, size: MAP_SIZE });
    sim.step(40 * GAME_DAY_MS);
    const st = sim.inspect();
    expect(sim.view().population).toBeGreaterThanOrEqual(8);
    expect(st.stats.trees_felled).toBeGreaterThan(5);
    expect(st.stats.jobs_done).toBeGreaterThan(100);
    expect(st.stock.wood).toBeGreaterThan(100);
  });
});
