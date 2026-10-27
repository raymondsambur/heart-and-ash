import { describe, expect, it } from 'vitest';
import { O, T, VILLAGE_H, VILLAGE_W, findPath, generateWorld, isPassable, objectBlocks, villageConnected, worldPathGrid } from './index';

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

describe('worldgen', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = generateWorld(1337);
    const b = generateWorld(1337);
    expect(same(a.terrain, b.terrain)).toBe(true);
    expect(same(a.objects, b.objects)).toBe(true);
    expect(same(a.blight, b.blight)).toBe(true);
    const c = generateWorld(1338);
    expect(same(a.terrain, c.terrain)).toBe(false);
  });

  it('is village-sized and holds the expected features', () => {
    const w = generateWorld(1337);
    expect(w.w).toBe(VILLAGE_W);
    expect(w.h).toBe(VILLAGE_H);
    const count = (t: number) => w.terrain.reduce((n, v) => n + (v === t ? 1 : 0), 0);
    expect(count(T.Water)).toBeGreaterThan(100);
    expect(count(T.Forest)).toBeGreaterThan(500);
    expect(count(T.Grass) + count(T.Plains)).toBeGreaterThan(1500);
    expect(count(T.Rock)).toBeGreaterThan(5);
    expect(count(T.Bridge)).toBeGreaterThan(0);
  });

  it('creeps Blight in from the edges and keeps the village clean', () => {
    const w = generateWorld(1337);
    const at = (x: number, y: number) => w.blight[y * w.w + x];
    let edge = 0;
    let centre = 0;
    for (let i = 0; i < w.w; i++) {
      edge += at(i, 0) + at(i, w.h - 1) + at(0, i) + at(w.w - 1, i);
      centre += at(i, w.h >> 1) > 0 && i > 25 && i < 60 ? 1 : 0;
    }
    expect(edge / (4 * w.w)).toBeGreaterThan(100);
    expect(centre).toBe(0);
    expect(at(w.start.center.x, w.start.center.y)).toBe(0);
  });

  it('places a hand-made starting village that works', () => {
    for (const seed of [1, 1337, 9001, 424242]) {
      const w = generateWorld(seed);
      const s = w.start;
      expect(s.buildings.filter((b) => b.kind === 'house')).toHaveLength(5);
      expect(s.buildings.filter((b) => b.kind === 'warehouse')).toHaveLength(1);
      expect(s.buildings.filter((b) => b.kind === 'shrine')).toHaveLength(1);
      expect(s.plots).toHaveLength(2);
      expect(w.objects[s.well.y * w.w + s.well.x]).toBe(O.Well);
      for (const b of s.buildings) {
        for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) expect(w.objects[y * w.w + x]).toBe(O.Building);
        expect(isPassable(w, b.door.x, b.door.y)).toBe(true);
      }
      for (const p of s.plots) for (let y = p.y; y < p.y + p.d; y++) for (let x = p.x; x < p.x + p.w; x++) expect(w.terrain[y * w.w + x]).toBe(T.Farm);
      expect(villageConnected(w)).toBe(true);
    }
  });

  it('lets people walk from a house to the field and across the bridge', () => {
    const w = generateWorld(1337);
    const grid = worldPathGrid(w);
    const door = w.start.buildings[0].door;
    const field = w.start.plots[0];
    const p = findPath(grid, door.x, door.y, field.x + 1, field.y + 1);
    expect(p).not.toBeNull();
    const far = findPath(grid, door.x, door.y, w.start.center.x + 30, w.start.center.y);
    expect(far).not.toBeNull();
    for (const step of far!) expect(objectBlocks(w.objects[step.y * w.w + step.x])).toBe(false);
  });
});
