import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, BUILD_KINDS, DEMOLISH_LABOUR, GAME_DAY_MS, GAME_HOUR_MS, MAX_ORDERS, O, canPlace, clearWork, findPath, needsThrough, stageWork, totalNeeds, type BuildKind, type Good } from '@hearth/shared';
import { addWork, cancelOrder, deliver, orderDemolish, orderViews, placeOrder, shortfall, stageReady, wishes } from './construct';
import { createSim, SNAPSHOT_VERSION, type SimSnapshot } from './index';
import { addPerson, kit, setStock, type Kit } from './testkit';

/** The nearest spot to the green where `kind` may be put (with a tile of room around it). */
function spotFor(k: Kit, kind: BuildKind, skip = 0): { x: number; y: number } {
  const c = k.st.buildings.length ? k.sim.world.start.center : { x: 48, y: 48 };
  const pw = { world: k.sim.world, buildings: k.st.buildings, plots: k.st.plots };
  const rects = [...k.st.buildings, ...k.st.plots];
  let n = 0;
  for (let r = 4; r < 28; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = c.x + dx;
        const y = c.y + dy;
        const chk = canPlace(pw, kind, x, y);
        if (!chk.ok) continue;
        if (rects.some((b) => x - 1 < b.x + b.w && x + chk.w + 1 > b.x && y - 1 < b.y + b.d && y + chk.d + 1 > b.y)) continue;
        if (n++ >= skip) return { x, y };
      }
  throw new Error('no room');
}

const labourOf = (kind: BuildKind): number => BLUEPRINTS[kind].labour;

/** Do all the labour and bring all the material of an order at once (the unit tests of the stages do not need the village). */
function finishNow(k: Kit, orderId: number): void {
  const o = k.st.orders.find((x) => x.id === orderId)!;
  const p = addPerson(k);
  const bp = BLUEPRINTS[o.kind];
  for (const [g, n] of Object.entries(totalNeeds(bp)) as [Good, number][]) {
    p.carrying = { good: g, qty: n };
    deliver(k.c, p, orderId);
  }
  for (let i = 0; i < 100 && k.st.orders.some((x) => x.id === orderId && x.mode === 'build'); i++) addWork(k.c, p, orderId, labourOf(o.kind) / 10);
}

describe('the blueprint table', () => {
  it('has stage shares that add up and materials that match the balance sheet', () => {
    for (const kind of BUILD_KINDS) {
      const bp = BLUEPRINTS[kind];
      expect(bp.stages.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
      expect(bp.labour).toBeGreaterThan(0);
    }
    expect(totalNeeds(BLUEPRINTS.house)).toEqual({ stone: 12, planks: 30, thatch: 6 });
    expect(totalNeeds(BLUEPRINTS.warehouse)).toEqual({ stone: 10, planks: 40 });
    expect(totalNeeds(BLUEPRINTS.workshop)).toEqual({ stone: 20, planks: 50 });
    expect(totalNeeds(BLUEPRINTS.shrine)).toEqual({ stone: 25, planks: 15 });
    expect(totalNeeds(BLUEPRINTS.watchpost)).toEqual({ stone: 10, planks: 30 });
    expect(totalNeeds(BLUEPRINTS.wall)).toEqual({ stone: 16, planks: 8 });
    expect(totalNeeds(BLUEPRINTS.well)).toEqual({ stone: 20 });
    expect(BLUEPRINTS.field.stages.map((s) => s.id)).toEqual(['cleared', 'ploughed']);
    expect(BLUEPRINTS.house.stages.map((s) => s.id)).toEqual(['cleared', 'foundation', 'frame', 'walls', 'roof']);
    // The house's labour split: clearing 5%, foundation 15%, frame 25%, walls 30%, roof 25%.
    expect(BLUEPRINTS.house.stages.map((s) => s.share)).toEqual([0.05, 0.15, 0.25, 0.3, 0.25]);
  });
});

describe('placing orders', () => {
  it('accepts a good spot and puts a marked plot on the map, with an order for it', () => {
    const k = kit();
    const at = spotFor(k, 'house');
    const r = placeOrder(k.c, 'house', at.x, at.y, false, null);
    expect(r.ok).toBe(true);
    const b = k.st.buildings.at(-1)!;
    expect(b).toMatchObject({ kind: 'house', x: at.x, y: at.y, w: 3, d: 3 });
    expect(b.con).toMatchObject({ mode: 'build', done: 0, pct: 0 });
    expect(k.st.orders).toHaveLength(1);
    const v = orderViews(k.c)[0];
    expect(v).toMatchObject({ kind: 'house', mode: 'build', done: 0, stages: 5, by: 'you' });
    expect(v.needs.map((n) => n.good).sort()).toEqual(['planks', 'stone', 'thatch']);
  });

  it('refuses water, overlap, a blocked door, the far edge, and says why', () => {
    const k = kit();
    const w = k.sim.world;
    const c = w.start.center;
    expect(placeOrder(k.c, 'house', c.x - 12, c.y - 3, false, null)).toMatchObject({ ok: false, code: 'cannot_place' }); // on an existing house
    expect(placeOrder(k.c, 'house', 1, 1, false, null)).toMatchObject({ ok: false });
    expect(placeOrder(k.c, 'house', c.x + 40, c.y, false, null)).toMatchObject({ ok: false, text: expect.stringMatching(/far|edge/) });
    // On the stream.
    let wet: { x: number; y: number } | null = null;
    for (let y = 2; y < w.h - 4 && !wet; y++) for (let x = 2; x < w.w - 4; x++) if (w.terrain[y * w.w + x] === 1 && Math.abs(x - c.x) < 29 && Math.abs(y - c.y) < 29) wet = { x, y };
    if (wet) expect(placeOrder(k.c, 'house', wet.x, wet.y, false, null).ok).toBe(false);
    // In front of an existing door.
    const door = k.st.buildings[0].door;
    expect(placeOrder(k.c, 'well', door.x, door.y, false, null)).toMatchObject({ ok: false });
    expect(k.st.orders).toHaveLength(0);
    expect(k.st.buildings).toHaveLength(7);
  });

  it('limits the number of orders at once', () => {
    const k = kit();
    let placed = 0;
    for (let i = 0; i < MAX_ORDERS + 3; i++) {
      let at: { x: number; y: number };
      try {
        at = spotFor(k, 'well', 0);
      } catch {
        break;
      }
      const r = placeOrder(k.c, 'well', at.x, at.y, false, null);
      if (r.ok) placed++;
      else {
        expect(r.code).toBe('too_many');
        break;
      }
    }
    expect(placed).toBeLessThanOrEqual(MAX_ORDERS);
  });

  it('blocks the tiles it stands on, so nobody walks through it, and moves anybody standing there out', () => {
    const k = kit();
    const at = spotFor(k, 'house');
    const p = addPerson(k);
    p.x = p.nx = at.x + 1;
    p.y = p.ny = at.y + 1;
    expect(placeOrder(k.c, 'house', at.x, at.y, false, null).ok).toBe(true);
    expect(k.c.open(at.x + 1, at.y + 1)).toBe(false);
    expect(k.c.open(at.x + 1, at.y + 3)).toBe(true); // the door tile
    expect(p.x === at.x + 1 && p.y === at.y + 1).toBe(false);
    // A path across it goes around.
    let crossed = 0;
    for (let row = 0; row < 3; row++) {
      if (!k.c.open(at.x - 1, at.y + row) || !k.c.open(at.x + 3, at.y + row)) continue;
      const path = findPath(k.c.grid, at.x - 1, at.y + row, at.x + 3, at.y + row);
      expect(path).not.toBeNull();
      expect(path!.some((t) => t.x >= at.x && t.x < at.x + 3 && t.y >= at.y && t.y < at.y + 3)).toBe(false);
      crossed++;
    }
    expect(crossed).toBeGreaterThan(0);
  });

  it('lays a wall segment on the loop, one way or the other as the loop runs there', () => {
    const k = kit();
    const at = spotFor(k, 'wall');
    expect(placeOrder(k.c, 'wall', at.x, at.y, true, null).ok).toBe(true);
    const piece = k.st.buildings.at(-1)!;
    expect(piece.kind).toBe('wall');
    expect([piece.w, piece.d].sort()).toEqual([1, 4]);
  });
});

describe('building', () => {
  it('waits for material, then goes through the stages, and the finished house is a home', () => {
    const k = kit();
    setStock(k, {});
    const at = spotFor(k, 'house');
    placeOrder(k.c, 'house', at.x, at.y, false, null);
    const o = k.st.orders[0];
    const b = k.st.buildings.at(-1)!;
    const p = addPerson(k);
    // The first stage needs nothing, so it can start; the second needs 12 stone.
    expect(stageReady(o)).toBe(true);
    expect(addWork(k.c, p, o.id, stageWork(BLUEPRINTS.house, 0))).toBe(true);
    expect(o.done).toBe(1);
    expect(b.con).toMatchObject({ mode: 'build', done: 1, pct: 0 });
    expect(stageReady(o)).toBe(false);
    expect(addWork(k.c, p, o.id, 5)).toBe(false);
    expect(orderViews(k.c)[0].waiting).toMatch(/waiting for 12 stone/);
    // Bring the stone and it moves again.
    p.carrying = { good: 'stone', qty: 12 };
    deliver(k.c, p, o.id);
    expect(b.con?.pile).toEqual({ stone: 12 });
    expect(stageReady(o)).toBe(true);
    expect(shortfall(o, 'planks')).toBe(12);
    const homesBefore = k.c.sites.ofKind('home').length;
    finishNow(k, o.id);
    expect(k.st.orders).toHaveLength(0);
    expect(b.con).toBeUndefined();
    expect(k.c.sites.ofKind('home').length).toBe(homesBefore + 1);
    expect(k.st.feed.some((f) => /new house is finished/.test(f.text))).toBe(true);
  });

  it('shows more of the building as stages are done, never less', () => {
    const k = kit();
    const at = spotFor(k, 'warehouse');
    placeOrder(k.c, 'warehouse', at.x, at.y, false, null);
    const o = k.st.orders[0];
    const p = addPerson(k);
    const b = k.st.buildings.at(-1)!;
    const bp = BLUEPRINTS.warehouse;
    let last = -1;
    for (let i = 0; i < bp.stages.length; i++) {
      p.carrying = null;
      for (const [g, n] of Object.entries(needsThrough(bp, i)) as [Good, number][]) {
        const have = o.delivered[g] ?? 0;
        if (n > have) {
          p.carrying = { good: g, qty: n - have };
          deliver(k.c, p, o.id);
        }
      }
      for (let s = 0; s < 4 && b.con; s++) {
        addWork(k.c, p, o.id, stageWork(bp, i) / 4 + (s === 3 ? 1e-6 : 0));
        const prog = b.con ? b.con.done * 100 + b.con.pct : bp.stages.length * 100;
        expect(prog).toBeGreaterThanOrEqual(last);
        last = prog;
      }
    }
    expect(b.con).toBeUndefined();
  });

  it('puts a field to the plough: a finished field is a plot people can sow', () => {
    const k = kit();
    const at = spotFor(k, 'field');
    placeOrder(k.c, 'field', at.x, at.y, false, null);
    const o = k.st.orders[0];
    const fieldsBefore = k.st.fields.length;
    expect(k.c.sites.ofKind('field').some((s) => s.plot === o.plot)).toBe(false);
    finishNow(k, o.id);
    expect(k.st.fields).toHaveLength(fieldsBefore + 1);
    expect(k.st.fields.at(-1)).toMatchObject({ plot: o.plot, state: 'fallow' });
    expect(k.c.sites.ofKind('field').some((s) => s.plot === o.plot)).toBe(true);
  });

  it('a well becomes a water site and a second storehouse a second store', () => {
    const k = kit();
    const waterBefore = k.c.sites.ofKind('water').length;
    const storeBefore = k.c.sites.ofKind('store').length;
    const w = spotFor(k, 'well');
    placeOrder(k.c, 'well', w.x, w.y, false, null);
    finishNow(k, k.st.orders[0].id);
    const s = spotFor(k, 'warehouse');
    placeOrder(k.c, 'warehouse', s.x, s.y, false, null);
    finishNow(k, k.st.orders[0].id);
    expect(k.c.sites.ofKind('water').length).toBe(waterBefore + 1);
    expect(k.c.sites.ofKind('store').length).toBe(storeBefore + 1);
  });

  it('gives back material that was carried to the plot and not needed', () => {
    const k = kit();
    setStock(k, { planks: 0 });
    const at = spotFor(k, 'shrine');
    placeOrder(k.c, 'shrine', at.x, at.y, false, null);
    const o = k.st.orders[0];
    const p = addPerson(k);
    p.carrying = { good: 'wood', qty: 5 };
    deliver(k.c, p, o.id);
    expect(o.delivered.wood).toBeUndefined();
    expect(k.st.stock.wood).toBe(5);
  });
});

describe('demolishing', () => {
  it('takes the stages down in reverse, gives back part of the material, leaves rubble, then clears it', () => {
    const k = kit();
    setStock(k, {});
    const house = k.st.buildings.find((b) => b.kind === 'house')!;
    const people = k.st.people.filter((p) => p.home === house.id);
    expect(orderDemolish(k.c, house.id).ok).toBe(true);
    expect(orderDemolish(k.c, house.id)).toMatchObject({ ok: false, code: 'busy' });
    expect(house.con).toMatchObject({ mode: 'demolish', done: 5 });
    // Whoever lived there is rehomed.
    for (const p of people) expect(p.home).not.toBe(house.id);
    const o = k.st.orders[0];
    const bp = BLUEPRINTS.house;
    const p = addPerson(k);
    let prev = 6;
    for (let i = 0; i < 80 && o.mode === 'demolish'; i++) {
      addWork(k.c, p, o.id, 1);
      expect(o.done).toBeLessThanOrEqual(prev);
      prev = o.done;
    }
    expect(o.mode).toBe('rubble');
    expect(house.con).toMatchObject({ mode: 'rubble' });
    // Half the stone (0.5 of 12), 30% of the planks (30) and thatch (6).
    expect(k.st.stock.stone).toBeCloseTo(6, 6);
    expect(k.st.stock.planks).toBeCloseTo(9, 6);
    expect(k.st.stock.thatch).toBeCloseTo(1.8, 6);
    // The labour was 40% of what raising took (stage by stage).
    expect(stageWork(bp, 4) * DEMOLISH_LABOUR).toBeCloseTo(12, 6);
    addWork(k.c, p, o.id, clearWork(bp) + 0.001);
    expect(k.st.orders).toHaveLength(0);
    expect(k.st.buildings.some((b) => b.id === house.id)).toBe(false);
    // The ground is free again: a starting building's tiles are open, and something new may stand there.
    expect(k.c.open(house.x + 1, house.y + 1)).toBe(true);
    expect(k.sim.world.objects[(house.y + 1) * k.sim.world.w + house.x + 1]).toBe(O.Building);
    expect(placeOrder(k.c, 'house', house.x, house.y, false, null).ok).toBe(true);
  });

  it('cannot take down what is being raised or is already coming down, and a wall comes down too', () => {
    const k = kit();
    const at = spotFor(k, 'wall');
    placeOrder(k.c, 'wall', at.x, at.y, false, null);
    const wall = k.st.buildings.at(-1)!;
    expect(orderDemolish(k.c, wall.id)).toMatchObject({ ok: false, code: 'busy' });
    finishNow(k, k.st.orders[0].id);
    expect(orderDemolish(k.c, wall.id).ok).toBe(true);
    expect(orderDemolish(k.c, 12345)).toMatchObject({ ok: false, code: 'no_target' });
  });

  it('takes a field down and the crop goes with it', () => {
    const k = kit();
    const plot = k.st.plots[0];
    expect(k.st.fields.some((f) => f.plot === plot.id)).toBe(true);
    expect(orderDemolish(k.c, undefined, plot.id).ok).toBe(true);
    expect(k.st.fields.some((f) => f.plot === plot.id)).toBe(false);
    expect(k.c.sites.ofKind('field').some((s) => s.plot === plot.id)).toBe(false);
  });
});

describe('cancelling', () => {
  it('an order nobody has touched just goes away, and the delivered material comes back', () => {
    const k = kit();
    setStock(k, { stone: 0 });
    const at = spotFor(k, 'house');
    placeOrder(k.c, 'house', at.x, at.y, false, null);
    const o = k.st.orders[0];
    const p = addPerson(k);
    p.carrying = { good: 'stone', qty: 5 };
    // Nothing is built yet, so cancelling is a clean undo (the delivery counts as not yet used).
    deliver(k.c, p, o.id);
    expect(cancelOrder(k.c, o.id).ok).toBe(true);
    expect(k.st.orders).toHaveLength(0);
    expect(k.st.buildings).toHaveLength(7);
    expect(k.st.stock.stone).toBe(5);
  });

  it('an order that has begun is taken down again; cancelling a demolition builds it back up', () => {
    const k = kit();
    const at = spotFor(k, 'house');
    placeOrder(k.c, 'house', at.x, at.y, false, null);
    const o = k.st.orders[0];
    const p = addPerson(k);
    addWork(k.c, p, o.id, stageWork(BLUEPRINTS.house, 0) + 1e-6);
    expect(o.done).toBe(1);
    expect(cancelOrder(k.c, o.id).ok).toBe(true);
    expect(o.mode).toBe('demolish');
    expect(cancelOrder(k.c, o.id).ok).toBe(true);
    expect(o.mode).toBe('build');
    expect(o.done).toBe(1);
    expect(cancelOrder(k.c, 999)).toMatchObject({ ok: false, code: 'no_order' });
  });
});

describe('the village at work', () => {
  it('raises a house: material is fetched from the store, people build it, and it finishes', { timeout: 120_000 }, () => {
    const sim = createSim({ seed: 1337 });
    sim.step(GAME_DAY_MS);
    const k = kit(1337);
    void k;
    const v0 = sim.view();
    const c = sim.world.start.center;
    let spot: { x: number; y: number } | null = null;
    for (let r = 4; r < 20 && !spot; r++)
      for (let dy = -r; dy <= r && !spot; dy++)
        for (let dx = -r; dx <= r && !spot; dx++) if (canPlace({ world: sim.world, buildings: v0.buildings, plots: v0.plots }, 'house', c.x + dx, c.y + dy).ok) spot = { x: c.x + dx, y: c.y + dy };
    expect(sim.command({ t: 'build', kind: 'house', x: spot!.x, y: spot!.y }).ok).toBe(true);
    const stockBefore = { ...sim.inspect().stock };
    const seen = new Set<string>();
    let finished = false;
    for (let h = 0; h < 24 * 12 && !finished; h++) {
      sim.step(GAME_HOUR_MS);
      for (const p of sim.inspect().people) if (p.goal?.kind === 'act' && p.goal.order !== undefined) seen.add(p.goal.action);
      finished = sim.view().orders.length === 0;
    }
    expect(finished).toBe(true);
    expect([...seen].sort()).toEqual(['build', 'deliver_material']);
    const st = sim.inspect();
    expect(st.stats.buildings_finished).toBe(1);
    expect(st.buildings.find((b) => b.x === spot!.x && b.y === spot!.y)?.con).toBeUndefined();
    // The stone came out of the store and was built in (minus what quarrying added).
    expect(stockBefore.stone - st.stock.stone).toBeGreaterThan(0);
    expect(st.feed.some((f) => /new house is finished/.test(f.text))).toBe(true);
  });

  it('the sheet of a builder says why: the goal is the build job', { timeout: 120_000 }, () => {
    const sim = createSim({ seed: 1337 });
    sim.step(GAME_DAY_MS);
    const v0 = sim.view();
    const c = sim.world.start.center;
    let spot: { x: number; y: number } | null = null;
    for (let r = 4; r < 20 && !spot; r++)
      for (let dy = -r; dy <= r && !spot; dy++)
        for (let dx = -r; dx <= r && !spot; dx++) if (canPlace({ world: sim.world, buildings: v0.buildings, plots: v0.plots }, 'house', c.x + dx, c.y + dy).ok) spot = { x: c.x + dx, y: c.y + dy };
    sim.command({ t: 'build', kind: 'house', x: spot!.x, y: spot!.y });
    let text = '';
    for (let h = 0; h < 24 * 3 && !text; h++) {
      sim.step(GAME_HOUR_MS / 2);
      for (const p of sim.inspect().people) {
        if (p.goal?.kind === 'act' && p.goal.action === 'build') {
          const s = sim.sheet(p.id)!;
          text = `${s.why.goal} | ${s.why.source} | ${s.doing}`;
          break;
        }
      }
    }
    expect(text).toMatch(/build the house/);
    expect(text).toMatch(/work for the village/);
  });

  it('a person with the dream of a house of their own pitches in, and moves in when it stands', { timeout: 150_000 }, () => {
    const k = kit();
    const p = addPerson(k);
    p.ambitions = [{ kind: 'own_house', progress: 0, startedDay: 0 }];
    const at = spotFor(k, 'house');
    placeOrder(k.c, 'house', at.x, at.y, false, null);
    const o = k.st.orders[0];
    o.labourBy[p.id] = 10;
    const b = k.st.buildings.at(-1)!;
    finishNow(k, o.id);
    expect(p.home).toBe(b.id);
    expect(p.counters.ownHouse).toBe(b.id);
    expect(k.st.feed.some((f) => /moved into the new house/.test(f.text))).toBe(true);
  });

  it('lists the wish of someone who wants a house until one is ordered', () => {
    const k = kit();
    const p = addPerson(k);
    p.ambitions = [{ kind: 'own_house', progress: 0, startedDay: 0, stuck: 'waiting for the manager to give ground for a house' }];
    expect(wishes(k.c).map((w) => w.name)).toContain(p.name);
    const at = spotFor(k, 'house');
    placeOrder(k.c, 'house', at.x, at.y, false, null);
    expect(wishes(k.c).map((w) => w.name)).not.toContain(p.name);
  });
});

describe('saves with construction in them', () => {
  it('continues exactly after a save and load in the middle of a build', { timeout: 120_000 }, () => {
    const make = () => {
      const sim = createSim({ seed: 21 });
      (sim.inspect() as { tier: number }).tier = 1;
      sim.step(GAME_DAY_MS);
      const v0 = sim.view();
      const c = sim.world.start.center;
      let spot: { x: number; y: number } | null = null;
      for (let r = 4; r < 20 && !spot; r++)
        for (let dy = -r; dy <= r && !spot; dy++)
          for (let dx = -r; dx <= r && !spot; dx++) if (canPlace({ world: sim.world, buildings: v0.buildings, plots: v0.plots }, 'warehouse', c.x + dx, c.y + dy).ok) spot = { x: c.x + dx, y: c.y + dy };
      sim.command({ t: 'build', kind: 'warehouse', x: spot!.x, y: spot!.y });
      sim.command({ t: 'demolish', building: 7 });
      return sim;
    };
    const a = make();
    a.step(GAME_DAY_MS * 1.5);
    expect(a.view().orders.length).toBe(2);
    const saved = JSON.parse(JSON.stringify(a.serialize())) as SimSnapshot;
    expect(saved.v).toBe(SNAPSHOT_VERSION);
    expect(saved.orders).toHaveLength(2);
    const b = createSim({ seed: 21, saved });
    expect(JSON.stringify(b.view().buildings)).toBe(JSON.stringify(a.view().buildings));
    a.step(GAME_DAY_MS * 2);
    b.step(GAME_DAY_MS * 2);
    // Compared as data: a property that was `undefined` in the live state is gone after a round trip, which only changes key order.
    expect(JSON.parse(JSON.stringify(b.serialize()))).toEqual(JSON.parse(JSON.stringify(a.serialize())));
  });

  it('upgrades a version 2 snapshot (M1, no orders) and lets it build', () => {
    const sim0 = createSim({ seed: 8 });
    sim0.step(GAME_HOUR_MS * 3);
    const snap = JSON.parse(JSON.stringify(sim0.serialize())) as unknown as Record<string, unknown>;
    const old: Record<string, unknown> = { ...snap, v: 2 };
    delete old.orders;
    delete old.nextOrderId;
    delete old.nextBuildingId;
    delete old.nextPlotId;
    const sim = createSim({ seed: 8, saved: old as unknown as SimSnapshot });
    const st = sim.inspect();
    expect(st.orders).toEqual([]);
    expect(st.nextBuildingId).toBe(8);
    expect(st.nextPlotId).toBe(3);
    expect(sim.serialize().v).toBe(SNAPSHOT_VERSION);
    const c = sim.world.start.center;
    const v = sim.view();
    let ok = false;
    for (let r = 4; r < 20 && !ok; r++)
      for (let dx = -r; dx <= r && !ok; dx++) if (canPlace({ world: sim.world, buildings: v.buildings, plots: v.plots }, 'well', c.x + dx, c.y - r).ok) ok = sim.command({ t: 'build', kind: 'well', x: c.x + dx, y: c.y - r }).ok;
    expect(ok).toBe(true);
    sim.step(GAME_HOUR_MS * 2);
    expect(sim.view().orders).toHaveLength(1);
  });
});
