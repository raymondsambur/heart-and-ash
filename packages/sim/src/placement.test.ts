import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, BUILD_KINDS, CARETAKER_RULES, GAME_DAY_MS, canPlace, placementsFor, type BuildKind, type BuildingDef } from '@hearth/shared';
import { autoSpot, runRules } from './policy';
import { createSim } from './sim';
import { kit, type Kit } from './testkit';

const pw = (k: Kit) => ({ world: k.sim.world, buildings: k.st.buildings, plots: k.st.plots });
const green = (k: Kit) => k.sim.world.start.center;
const cheb = (k: Kit, x: number, y: number): number => Math.max(Math.abs(x - green(k).x), Math.abs(y - green(k).y));
const approach = (k: Kit) => {
  const e = k.c.sites.ofKind('edge')[0];
  return { x: e.x, y: e.y };
};

/** Put a finished building (or several) where a test says. */
function add(k: Kit, kind: BuildingDef['kind'], x: number, y: number, w: number, d: number): void {
  k.st.buildings.push({ id: k.st.nextBuildingId++, kind, x, y, w, d, door: { x: x + (w >> 1), y: y + d } });
}

describe('where a rule puts a building', () => {
  it('only offers places the sim would accept, with a tile of room around, and in the same order every time', () => {
    const k = kit(3, 12);
    for (const kind of BUILD_KINDS) {
      const list = placementsFor(pw(k), kind, { approach: approach(k) }, 12);
      expect(list.length, kind).toBeGreaterThan(0);
      for (const p of list) {
        expect(canPlace(pw(k), kind, p.x, p.y, p.rot).ok, `${kind} ${p.x},${p.y}`).toBe(true);
        expect(p.cost).toBeGreaterThanOrEqual(-20);
      }
      for (let i = 1; i < list.length; i++) expect(list[i].cost).toBeGreaterThanOrEqual(list[i - 1].cost);
      expect(placementsFor(pw(k), kind, { approach: approach(k) }, 12)).toEqual(list);
    }
  });

  it('keeps fields out of the square and puts them next to the other fields', () => {
    const k = kit(3, 12);
    const fields = k.st.plots.filter((p) => p.kind === 'field');
    expect(fields.length).toBeGreaterThan(0);
    for (const p of placementsFor(pw(k), 'field', { approach: approach(k) }, 20)) {
      expect(cheb(k, p.x + 2.5, p.y + 2.5)).toBeGreaterThanOrEqual(9);
    }
    const best = placementsFor(pw(k), 'field', { approach: approach(k) }, 1)[0];
    const near = Math.min(...fields.map((f) => Math.hypot(f.x + f.w / 2 - (best.x + 2.5), f.y + f.d / 2 - (best.y + 2.5))));
    expect(near).toBeLessThan(12);
  });

  it('gathers houses near the green and near each other, not on the square', () => {
    const k = kit(3, 12);
    const houses = k.st.buildings.filter((b) => b.kind === 'house');
    for (const p of placementsFor(pw(k), 'house', { approach: approach(k) }, 10)) {
      const r = cheb(k, p.x + 1.5, p.y + 1.5);
      expect(r).toBeGreaterThanOrEqual(5);
      expect(r).toBeLessThanOrEqual(16);
      expect(Math.min(...houses.map((h) => Math.hypot(h.x + h.w / 2 - (p.x + 1.5), h.y + h.d / 2 - (p.y + 1.5))))).toBeLessThan(9);
    }
  });

  it('puts watch posts out towards the road the raiders come along, and spreads them', () => {
    const k = kit(3, 12);
    const a = approach(k);
    const first = placementsFor(pw(k), 'watchpost', { approach: a }, 1)[0];
    expect(cheb(k, first.x + 1, first.y + 1)).toBeGreaterThanOrEqual(10);
    // nearer the approach than the green is
    expect(Math.hypot(first.x - a.x, first.y - a.y)).toBeLessThan(Math.hypot(green(k).x - a.x, green(k).y - a.y));
    add(k, BLUEPRINTS.watchpost.art as BuildingDef['kind'], first.x, first.y, 2, 2);
    const second = placementsFor(pw(k), 'watchpost', { approach: a }, 1)[0];
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThanOrEqual(8);
  });

  it('lays walls across the road, and continues a line end to end, leaving a gap to walk through', () => {
    const k = kit(3, 12);
    const a = approach(k);
    // the road runs east and west of the green, so a wall across it runs north to south (laid the other way)
    expect(Math.abs(a.x - green(k).x)).toBeGreaterThan(Math.abs(a.y - green(k).y));
    const first = placementsFor(pw(k), 'wall', { approach: a }, 1)[0];
    expect(first.rot).toBe(true);
    add(k, BLUEPRINTS.wall.art as BuildingDef['kind'], first.x, first.y, 1, 4);
    const second = placementsFor(pw(k), 'wall', { approach: a }, 1)[0];
    expect(second.rot).toBe(true);
    expect(second.x).toBe(first.x);
    expect(Math.abs(second.y - first.y)).toBe(5);
  });

  it('keeps a second well among the houses and away from the first, a second shrine away from the first and storehouse near the green', () => {
    const k = kit(3, 12);
    const well = k.sim.world.start.well;
    for (const p of placementsFor(pw(k), 'well', { approach: approach(k) }, 5)) expect(Math.hypot(p.x - well.x, p.y - well.y)).toBeGreaterThanOrEqual(7);
    const shrine = k.st.buildings.find((b) => b.kind === 'shrine')!;
    const s = placementsFor(pw(k), 'shrine', { approach: approach(k) }, 1)[0];
    expect(Math.hypot(s.x - shrine.x, s.y - shrine.y)).toBeGreaterThanOrEqual(7);
    const store = placementsFor(pw(k), 'warehouse', { approach: approach(k) }, 1)[0];
    expect(cheb(k, store.x + 2, store.y + 1.5)).toBeLessThanOrEqual(12);
  });

  it('is what a building rule uses: the field a rule orders is out of the square, and autoSpot agrees with the best place', () => {
    const k = kit(3, 12);
    k.sim.command({ t: 'rule', rule: { id: 0, enabled: true, cond: { metric: 'fields', op: '<', value: 3 }, act: { t: 'build', kind: 'field' } } });
    const spot = autoSpot(k.c, 'field')!;
    k.c.day = 10;
    runRules(k.c);
    const order = k.st.orders.find((o) => o.kind === 'field')!;
    expect(order).toBeDefined();
    expect(cheb(k, order.x + 2.5, order.y + 2.5)).toBeGreaterThanOrEqual(9);
    expect({ x: order.x, y: order.y }).toEqual({ x: spot.x, y: spot.y });
  });

  it('lays out a village that looks planned: after two months on the suggested rules nothing stands in the square, and the fields, houses and posts are where they should be', { timeout: 120_000 }, () => {
    const sim = createSim({ seed: 3 });
    const st = sim.inspect() as { tier: number; stock: Record<string, number> };
    st.tier = 2;
    for (const r of CARETAKER_RULES) sim.command({ t: 'rule', rule: { ...r, id: 0 } });
    Object.assign(st.stock, { planks: 600, stone: 600, wood: 900, thatch: 80 });
    sim.step(60 * GAME_DAY_MS);
    const v = sim.view();
    const c = sim.world.start.center;
    const built = (kind: BuildKind) => (kind === 'field' ? v.plots.filter((p) => p.kind === 'field') : v.buildings.filter((b) => b.kind === BLUEPRINTS[kind].art));
    const start = new Set(sim.world.start.buildings.map((b) => b.id));
    for (const b of v.buildings.filter((x) => !start.has(x.id))) expect(Math.max(Math.abs(b.x + b.w / 2 - c.x), Math.abs(b.y + b.d / 2 - c.y)), `${b.kind} ${b.x},${b.y}`).toBeGreaterThanOrEqual(5);
    for (const p of v.plots.filter((x) => x.id > 2)) expect(Math.max(Math.abs(p.x + p.w / 2 - c.x), Math.abs(p.y + p.d / 2 - c.y))).toBeGreaterThanOrEqual(9);
    expect(built('house').length).toBeGreaterThan(5);
    expect(built('watchpost').length).toBeGreaterThanOrEqual(1);
    expect(built('wall').length).toBeGreaterThanOrEqual(1);
  });
});
