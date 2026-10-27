import { describe, expect, it } from 'vitest';
import { BAL, GAME_DAY_MS, T } from '@hearth/shared';
import { clearRoads, groundView, roadsDay, trafficRows, walked } from './roads';
import type { SimSnapshot } from './serialize';
import { createSim } from './sim';
import { kit, type Kit } from './testkit';

/** A plain grass tile away from everything. */
function aGrassTile(k: Kit): { x: number; y: number; i: number } {
  const w = k.c.world;
  for (let y = 3; y < w.h - 3; y++) {
    for (let x = 3; x < w.w - 3; x++) {
      const i = y * w.w + x;
      if (w.terrain[i] === T.Grass && w.objects[i] === 0 && !k.st.buildings.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.d)) return { x, y, i };
    }
  }
  throw new Error('no grass');
}

describe('roads worn by feet', () => {
  it('count every step on the tile it ends on, and fade a little each day', () => {
    const k = kit(3, 12);
    const t = aGrassTile(k);
    const before = k.st.traffic[t.i];
    walked(k.c, t.x, t.y);
    walked(k.c, t.x, t.y);
    expect(k.st.traffic[t.i]).toBe(before + 2);
    roadsDay(k.c);
    expect(k.st.traffic[t.i]).toBeCloseTo((before + 2) * BAL.roads.decay, 4);
    expect(trafficRows(k.st.traffic, k.st.quiet).some((r) => r[0] === t.i)).toBe(true);
  });

  it('turn a tile that is walked over often into a road, which people walk faster on, and leave a rarely walked tile alone', () => {
    const k = kit(3, 12);
    const busy = aGrassTile(k);
    const rare = { ...aGrassTile(k), x: busy.x + 4, y: busy.y };
    rare.i = rare.y * k.c.world.w + rare.x;
    expect(k.c.world.terrain[rare.i]).toBeDefined();
    for (let d = 0; d < 30; d++) {
      for (let n = 0; n < 5; n++) walked(k.c, busy.x, busy.y);
      if (d % 10 === 0) walked(k.c, rare.x, rare.y);
      roadsDay(k.c);
    }
    expect(k.c.world.terrain[busy.i]).toBe(T.Dirt);
    expect(k.st.ground[busy.i]).toBe(T.Dirt);
    expect(groundView(k.st.ground)).toContainEqual({ i: busy.i, t: T.Dirt });
    expect(k.c.world.terrain[rare.i]).not.toBe(T.Dirt);
    expect(k.c.grid.cost(busy.x, busy.y)).toBeLessThan(k.c.grid.cost(rare.x, rare.y) + 1e-9);
  });

  it('go back to grass when nobody walks them for a while, the map’s own roads too', () => {
    const k = kit(3, 12);
    const t = aGrassTile(k);
    for (let d = 0; d < 20; d++) {
      for (let n = 0; n < 8; n++) walked(k.c, t.x, t.y);
      roadsDay(k.c);
    }
    expect(k.c.world.terrain[t.i]).toBe(T.Dirt);
    // nobody comes any more: the traffic fades, then the road is given back after the quiet days
    let days = 0;
    while (k.c.world.terrain[t.i] === T.Dirt && days < 120) {
      roadsDay(k.c);
      days++;
    }
    expect(k.c.world.terrain[t.i]).toBe(T.Grass);
    expect(k.st.ground[t.i]).toBeUndefined();
    expect(days).toBeGreaterThan(BAL.roads.quietDays);
    // a stretch of the map's own dirt road nobody uses grows over too, and is remembered as a change
    const w = k.c.world;
    const base = k.c.baseTerrain;
    const own = base.findIndex((v, i) => v === T.Dirt && w.terrain[i] === T.Dirt && !k.st.buildings.some((b) => (i % w.w) >= b.x && (i % w.w) < b.x + b.w && ((i / w.w) | 0) >= b.y && ((i / w.w) | 0) < b.y + b.d));
    expect(own).toBeGreaterThanOrEqual(0);
    k.st.quiet[own] = 1;
    k.st.traffic[own] = 1;
    for (let d = 0; d < 40; d++) roadsDay(k.c);
    expect(w.terrain[own]).toBe(T.Grass);
    expect(k.st.ground[own]).toBe(T.Grass);
  });

  it('do not appear on water, a bridge, paving, a field or under a building, and are cleared when something is built', () => {
    const k = kit(3, 12);
    const w = k.c.world;
    const water = w.terrain.findIndex((v) => v === T.Water);
    const plaza = w.terrain.findIndex((v) => v === T.Plaza);
    const bridge = w.terrain.findIndex((v) => v === T.Bridge);
    for (const i of [water, plaza, bridge].filter((x) => x >= 0)) k.st.traffic[i] = 500;
    const house = k.st.buildings.find((b) => b.kind === 'house')!;
    const hi = house.y * w.w + house.x;
    k.st.traffic[hi] = 500;
    const field = k.st.plots[0];
    const fi = field.y * w.w + field.x;
    k.st.traffic[fi] = 500;
    roadsDay(k.c);
    for (const i of [water, plaza, bridge].filter((x) => x >= 0)) expect(Object.keys(k.st.ground)).not.toContain(String(i));
    expect(k.st.ground[hi]).toBeUndefined();
    expect(k.st.ground[fi]).toBeUndefined();
    // a worn road is cleared when a building goes up on it
    const t = aGrassTile(k);
    k.st.traffic[t.i] = 500;
    roadsDay(k.c);
    expect(k.c.world.terrain[t.i]).toBe(T.Dirt);
    clearRoads(k.c, t.x, t.y, 1, 1);
    expect(k.c.world.terrain[t.i]).toBe(T.Grass);
    expect(k.st.ground[t.i]).toBeUndefined();
    expect(k.st.traffic[t.i]).toBe(0);
  });
});

describe('roads in a living village', () => {
  it('appear between the places people go, are shown to the client, and survive a save and load exactly', { timeout: 120_000 }, () => {
    const a = createSim({ seed: 3 });
    a.step(30 * GAME_DAY_MS);
    const worn = Object.values(a.inspect().ground).filter((t) => t === T.Dirt).length;
    expect(worn).toBeGreaterThan(5);
    expect(a.view().ground.length).toBe(Object.keys(a.inspect().ground).length);
    const saved = JSON.parse(JSON.stringify(a.serialize())) as SimSnapshot;
    const b = createSim({ seed: 3, saved });
    expect(b.world.terrain).toEqual(a.world.terrain);
    a.step(6 * GAME_DAY_MS);
    b.step(6 * GAME_DAY_MS);
    expect(JSON.parse(JSON.stringify(b.serialize()))).toEqual(JSON.parse(JSON.stringify(a.serialize())));
  });
});
