import { describe, expect, it } from 'vitest';
import { FLORA, GAME_DAY_MS, O, TREE_CODES, canPlace } from '@hearth/shared';
import { HANDLERS, type Done } from './actions';
import { applyFlora, chopTree, clearFlora, floraDay, floraView, grassNear, nearestObject, pickPlant, standingTile } from './flora';
import type { SimSnapshot } from './serialize';
import { createSim } from './sim';
import { kit, type Kit } from './testkit';
import type { Step } from './types';

const BUSH: ReadonlySet<number> = new Set([O.Bush]);

function setDay(k: Kit, day: number): void {
  k.c.day = day;
  k.c.season = Math.floor(day / 24) % 4;
}

/** The first tree and bush near the village, by position. */
function aTree(k: Kit) {
  const t = nearestObject(k.c, k.sim.world.start.center, TREE_CODES, 40);
  expect(t).not.toBeNull();
  return t!;
}
function aBush(k: Kit) {
  const t = nearestObject(k.c, k.sim.world.start.center, BUSH, 45);
  expect(t).not.toBeNull();
  return t!;
}

describe('trees', () => {
  it('take four chops to fell, leave a stump that can be walked over, and come back as a sapling and then a tree', () => {
    const k = kit(3, 12);
    setDay(k, 5);
    const t = aTree(k);
    const i = t.y * k.c.world.w + t.x;
    const was = k.c.world.objects[i];
    expect(TREE_CODES.has(was)).toBe(true);
    for (let n = 1; n < FLORA.chopsPerTree; n++) {
      expect(chopTree(k.c, t)).toBe(false);
      expect(k.c.world.objects[i]).toBe(was);
    }
    expect(chopTree(k.c, t)).toBe(true);
    expect(k.c.world.objects[i]).toBe(O.Stump);
    expect(k.c.open(t.x, t.y)).toBe(true);
    expect(floraView(k.st.flora)).toContainEqual({ i, code: O.Stump, was });
    // growing days pass: a sapling, then the tree again
    for (let d = 0; d < FLORA.stumpDays; d++) floraDay(k.c);
    expect(k.c.world.objects[i]).toBe(O.Sapling);
    for (let d = 0; d < FLORA.saplingDays; d++) floraDay(k.c);
    expect(k.c.world.objects[i]).toBe(was);
    expect(k.st.flora.find((f) => f.i === i)).toBeUndefined();
  });

  it('do not grow in winter, and not through a building', () => {
    const k = kit(3, 12);
    const t = aTree(k);
    const i = t.y * k.c.world.w + t.x;
    for (let n = 0; n < FLORA.chopsPerTree; n++) chopTree(k.c, t);
    setDay(k, 80);
    for (let d = 0; d < 40; d++) floraDay(k.c);
    expect(k.c.world.objects[i]).toBe(O.Stump);
    setDay(k, 10);
    for (let d = 0; d < FLORA.stumpDays + FLORA.saplingDays - 1; d++) floraDay(k.c);
    expect(k.c.world.objects[i]).toBe(O.Sapling);
    // a house raised on the sapling's tile: it is cleared and does not come back
    clearFlora(k.c, t.x, t.y, 1, 1);
    expect(k.c.world.objects[i]).toBe(O.None);
    for (let d = 0; d < 60; d++) floraDay(k.c);
    expect(k.c.world.objects[i]).toBe(O.None);
    // the entry stays (so the client keeps the map's tree off the tile) but it no longer grows
    expect(k.st.flora.find((f) => f.i === i)).toMatchObject({ code: O.None, was: O.None });
  });

  it('can be built over once cut: a stump, a sapling or a bare bush is not in the way', () => {
    const k = kit(3, 12);
    const w = k.c.world;
    // find a spot where a house is blocked only by a tree
    let tried = 0;
    for (let y = 8; y < w.h - 8 && tried < 1; y += 3) {
      for (let x = 8; x < w.w - 8 && tried < 1; x += 3) {
        const o = w.objects[y * w.w + x];
        if (!TREE_CODES.has(o)) continue;
        const pw = { world: w, buildings: k.st.buildings, plots: k.st.plots };
        const before = canPlace(pw, 'well', x, y);
        if (before.ok) continue;
        for (let n = 0; n < FLORA.chopsPerTree; n++) chopTree(k.c, { x, y });
        const after = canPlace(pw, 'well', x, y);
        if (!after.ok && /tree|rock|building/i.test(after.reason)) continue;
        tried++;
        expect(w.objects[y * w.w + x]).toBe(O.Stump);
        expect(after.ok || !/in the way/.test((after as { reason: string }).reason)).toBe(true);
      }
    }
    expect(tried).toBe(1);
  });
});

describe('bushes', () => {
  it('are picked bare and bear again after a while, in the growing seasons', () => {
    const k = kit(3, 12);
    setDay(k, 5);
    const t = aBush(k);
    const i = t.y * k.c.world.w + t.x;
    expect(pickPlant(k.c, t)).toBe(true);
    expect(k.c.world.objects[i]).toBe(O.BareBush);
    expect(pickPlant(k.c, t)).toBe(false);
    for (let d = 0; d < FLORA.bushDays - 1; d++) floraDay(k.c);
    expect(k.c.world.objects[i]).toBe(O.BareBush);
    floraDay(k.c);
    expect(k.c.world.objects[i]).toBe(O.Bush);
  });

  it('are looked for near where they are wanted, and bare grass is the last resort', () => {
    const k = kit(3, 12);
    const centre = k.sim.world.start.center;
    const t = aBush(k);
    expect(Math.abs(t.x - centre.x) + Math.abs(t.y - centre.y)).toBeLessThan(90);
    const stand = standingTile(k.c, t.x, t.y)!;
    expect(Math.abs(stand.x - t.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(stand.y - t.y)).toBeLessThanOrEqual(1);
    const g = grassNear(k.c, centre)!;
    expect(k.c.world.objects[g.y * k.c.world.w + g.x]).toBe(O.None);
    expect([2, 3]).toContain(k.c.world.terrain[g.y * k.c.world.w + g.x]);
  });
});

describe('the people who work the ground', () => {
  it('walk to a real tree or bush, stand beside it and face it, and what they do changes it', { timeout: 120_000 }, () => {
    const sim = createSim({ seed: 3 });
    sim.step(40 * GAME_DAY_MS);
    const st = sim.inspect();
    expect(st.stats.trees_felled).toBeGreaterThan(5);
    expect(st.stats.plants_picked).toBeGreaterThan(5);
    expect(st.flora.length).toBeGreaterThan(5);
    // every difference is a real tile of this map, of a kind that can differ
    for (const f of st.flora) {
      expect([O.Stump, O.Sapling, O.BareBush, O.None]).toContain(f.code);
      expect(sim.world.objects[f.i]).toBe(f.code);
    }
    expect(sim.view().flora.length).toBe(st.flora.length);
  });

  it('chop at the tree they went to, and a forager picks the bush beside them', () => {
    const k = kit(3, 12);
    setDay(k, 5);
    const tree = aTree(k);
    const bush = aBush(k);
    const p = k.c.people[0];
    const step = (a: string, o: { x: number; y: number }): Step => ({ a, at: 'forest', ox: o.x, oy: o.y, tx: o.x, ty: o.y });
    const done = (a: string, o: { x: number; y: number }): Done => ({ c: k.c, p, step: step(a, o), act: { step: step(a, o), startedAt: 0, endsAt: 0 }, hours: 3, q: 1 });
    const before = k.c.world.objects[tree.y * k.c.world.w + tree.x];
    for (let n = 0; n < FLORA.chopsPerTree; n++) {
      p.carrying = null;
      HANDLERS.chop_wood(done('chop_wood', tree));
    }
    expect(k.c.world.objects[tree.y * k.c.world.w + tree.x]).toBe(O.Stump);
    expect(before).not.toBe(O.Stump);
    expect(k.st.stats.trees_felled).toBe(1);
    p.carrying = null;
    HANDLERS.forage(done('forage', bush));
    expect(k.c.world.objects[bush.y * k.c.world.w + bush.x]).toBe(O.BareBush);
    expect(k.st.stats.plants_picked).toBe(1);
    const got = p.carrying as { good: string; qty: number } | null;
    expect(got?.good).toBe('ration');
    // a forager at a bush brings back more than one picking over bare grass
    const grass = grassNear(k.c, k.sim.world.start.center)!;
    const q = k.c.people[1];
    q.carrying = null;
    HANDLERS.forage({ ...done('forage', grass), p: q });
    const gotQ = q.carrying as unknown as { qty: number };
    expect(gotQ.qty).toBeLessThan(got!.qty);
  });
});

describe('saves', () => {
  it('keep the ground the village has changed, and a loaded village runs exactly as one that never stopped', { timeout: 120_000 }, () => {
    const a = createSim({ seed: 3 });
    a.step(12 * GAME_DAY_MS);
    expect(a.inspect().flora.length).toBeGreaterThan(0);
    const saved = JSON.parse(JSON.stringify(a.serialize())) as SimSnapshot;
    const b = createSim({ seed: 3, saved });
    expect(b.world.objects).toEqual(a.world.objects);
    a.step(6 * GAME_DAY_MS);
    b.step(6 * GAME_DAY_MS);
    expect(JSON.parse(JSON.stringify(b.serialize()))).toEqual(JSON.parse(JSON.stringify(a.serialize())));
    const base = createSim({ seed: 3 });
    applyFlora(base.world.objects, []);
    expect(b.world.objects).not.toEqual(base.world.objects);
  });
});
