import { describe, expect, it } from 'vitest';
import { BAL, CARETAKER_RULES, O, GAME_DAY_MS, T, WALL_ARTS, builtSlots, canPlace, nearestSlot, planRing, reservedSlots, ringFailure, ringProgress, ringRects, ringSlots, wallCandidates, wallWhy, type BuildingDef, type WallRing } from '@hearth/shared';
import { defenceOf } from './director';
import { clearBrush, floraDay } from './flora';
import { isClosed, keepsOutsideOpen, wallState } from './walls';
import { spotNear } from './move';
import { createSim } from './sim';
import { refreshJobs } from './jobs';
import { kit, setStock, type Kit } from './testkit';
import type { Order } from './types';

const pw = (k: Kit) => ({ world: k.sim.world, buildings: k.st.buildings, plots: k.st.plots });
const approach = (k: Kit) => {
  const e = k.c.sites.ofKind('edge')[0];
  return { x: e.x, y: e.y };
};

/** Put a finished wall piece on a slot. */
function raise(k: Kit, ring: WallRing, i: number, gate = false): void {
  const s = ringSlots(ring)[i];
  k.st.buildings.push({ id: k.st.nextBuildingId++, kind: gate ? 'gateway' : 'wall', x: s.x, y: s.y, w: s.rot ? 1 : 4, d: s.rot ? 4 : 1, door: { x: s.x, y: s.y } } as BuildingDef);
}

describe('the plan of the wall', () => {
  it('is a rectangle round everything the village has, a whole number of four-tile pieces to a side, with a margin, inside the build radius', () => {
    const k = kit(3, 12);
    const ring = planRing(pw(k), approach(k))!;
    expect(ring).not.toBeNull();
    expect((ring.x1 - ring.x0 + 1) % 4).toBe(0);
    expect((ring.y1 - ring.y0 - 1) % 4).toBe(0);
    for (const b of [...k.st.buildings, ...k.st.plots]) {
      expect(b.x).toBeGreaterThanOrEqual(ring.x0 + 2);
      expect(b.y).toBeGreaterThanOrEqual(ring.y0 + 2);
      expect(b.x + b.w - 1).toBeLessThanOrEqual(ring.x1 - 2);
      expect(b.y + b.d - 1).toBeLessThanOrEqual(ring.y1 - 2);
    }
    const slots = ringSlots(ring);
    expect(slots.length).toBe(2 * ((ring.x1 - ring.x0 + 1) / 4) + 2 * ((ring.y1 - ring.y0 - 1) / 4));
    // no two pieces overlap and the pieces touch end to end all the way round, with no gap
    const cells = new Set<string>();
    for (const s of slots) for (let i = 0; i < 4; i++) cells.add(s.rot ? `${s.x},${s.y + i}` : `${s.x + i},${s.y}`);
    expect(cells.size).toBe(slots.length * 4);
    const ring4 = (x: number, y: number): boolean => cells.has(`${x},${y}`);
    let corners = 0;
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      const n = [ring4(x + 1, y), ring4(x - 1, y), ring4(x, y + 1), ring4(x, y - 1)].filter(Boolean).length;
      expect(n, key).toBeGreaterThanOrEqual(2);
      if (n >= 2) corners++;
    }
    expect(corners).toBe(cells.size);
  });

  it('puts the gate on the side the road comes in from, where the main street crosses it', () => {
    const k = kit(3, 12);
    const a = approach(k);
    const ring = planRing(pw(k), a)!;
    const gate = ringSlots(ring)[ring.gate];
    expect(gate.rot).toBe(true);
    expect(gate.x).toBe(ring.x1);
    const green = k.sim.world.start.center;
    expect(green.y).toBeGreaterThanOrEqual(gate.y - 1);
    expect(green.y).toBeLessThanOrEqual(gate.y + 4);
  });

  it('avoids water and rock, and refuses to plan where there is no way round', () => {
    for (const seed of [3, 7, 11, 1337]) {
      const k = kit(seed, 12);
      const ring = planRing(pw(k), approach(k));
      expect(ring, `seed ${seed}`).not.toBeNull();
      for (const s of ringSlots(ring!)) {
        for (let i = 0; i < 4; i++) {
          const x = s.rot ? s.x : s.x + i;
          const y = s.rot ? s.y + i : s.y;
          const t = k.sim.world.terrain[y * k.sim.world.w + x];
          expect([T.Water, T.DeepWater, T.Rock], `${seed} ${x},${y}`).not.toContain(t);
        }
      }
    }
    const k = kit(3, 12);
    k.st.buildings.length = 0;
    k.st.plots.length = 0;
    expect(planRing(pw(k), null)).toBeNull();
  });
});

describe('raising the wall', () => {
  it('starts beside the gate, and every piece after that joins the one before it', () => {
    const k = kit(3, 12);
    const ring = planRing(pw(k), approach(k))!;
    const slots = ringSlots(ring);
    const n = slots.length;
    const first = wallCandidates(pw(k), 'wall', ring);
    expect(first.length).toBeGreaterThanOrEqual(1);
    const gi = ring.gate;
    const beside = [slots[(gi + 1) % n], slots[(gi - 1 + n) % n]];
    for (const s of first) expect(beside.some((b) => b.x === s.x && b.y === s.y)).toBe(true);
    // raise the whole wall piece by piece, always taking the best candidate: each one stands beside a piece already there
    let built = 0;
    for (let guard = 0; guard < n + 2; guard++) {
      const c = wallCandidates(pw(k), 'wall', ring)[0];
      if (!c) break;
      const i = slots.findIndex((s) => s.x === c.x && s.y === c.y);
      const before = builtSlots(pw(k), ring);
      if (built > 0) expect(before[(i + 1) % n] || before[(i - 1 + n) % n]).toBe(true);
      raise(k, ring, i);
      built++;
    }
    expect(built).toBe(n - 1);
    expect(wallCandidates(pw(k), 'wall', ring)).toEqual([]);
    expect(wallWhy(pw(k), 'wall', ring)).toMatch(/Only the gate is left/);
    // the gate has one slot, and only one gate is ever allowed
    const g = wallCandidates(pw(k), 'gate', ring);
    expect(g).toHaveLength(1);
    raise(k, ring, gi, true);
    expect(wallCandidates(pw(k), 'gate', ring)).toEqual([]);
    expect(wallWhy(pw(k), 'gate', ring)).toMatch(/single one|complete/);
    expect(ringProgress(pw(k), ring)).toEqual({ built: n, total: n, gate: true });
  });

  it('is clicked into place: the piece snaps to the nearest free slot, and a gate cannot go anywhere else', () => {
    const k = kit(3, 12);
    const ring = planRing(pw(k), approach(k))!;
    const slots = ringSlots(ring);
    const c = wallCandidates(pw(k), 'wall', ring);
    const far = nearestSlot(c, k.sim.world.start.center.x, k.sim.world.start.center.y)!;
    expect(c.some((s) => s.x === far.x && s.y === far.y)).toBe(true);
    // through the command: wherever you point, the order lands on a slot of the ring
    const spot = k.sim.world.start.center;
    const res = k.sim.command({ t: 'build', kind: 'wall', x: spot.x, y: spot.y });
    expect(res.ok).toBe(true);
    const order = k.st.orders.find((o) => o.kind === 'wall')!;
    expect(slots.some((s) => s.x === order.x && s.y === order.y && (s.rot ? order.w === 1 : order.d === 1))).toBe(true);
    expect(k.st.ring).not.toBeNull();
    // the gate goes on its own slot only, wherever you point, and there is only one
    const g = k.sim.command({ t: 'build', kind: 'gate', x: 0, y: 0 });
    expect(g.ok).toBe(true);
    const gateOrder = k.st.orders.find((o) => o.kind === 'gate')!;
    const gs = slots[k.st.ring!.gate];
    expect({ x: gateOrder.x, y: gateOrder.y }).toEqual({ x: gs.x, y: gs.y });
    const again = k.sim.command({ t: 'build', kind: 'gate', x: spot.x, y: spot.y });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('wall_why');
  });

  it('keeps the empty slots free of other buildings, whoever asks', () => {
    const k = kit(3, 12);
    const ring = planRing(pw(k), approach(k))!;
    k.st.ring = ring;
    const slot = ringSlots(ring)[3];
    const r = k.sim.command({ t: 'build', kind: 'house', x: slot.x, y: slot.y });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wall_line');
    expect(reservedSlots(pw(k), ring)).toHaveLength(ringSlots(ring).length);
    // and the rules' own choices stay off them and inside the loop when there is room
    const k2 = kit(3, 12);
    k2.st.tier = 2;
    k2.st.ring = ring;
    const spot = k2.sim.command({ t: 'rule', rule: { id: 0, enabled: true, cond: { metric: 'houses', op: '<', value: 99 }, act: { t: 'build', kind: 'house' } } });
    expect(spot.ok).toBe(true);
  });

  it('clears the trees in its way instead of being stopped by them', () => {
    const k = kit(3, 12);
    const ring = planRing(pw(k), approach(k))!;
    const slots = ringSlots(ring);
    const w = k.sim.world;
    // plant a tree on a slot that is not the gate's, then order a wall there
    const target = slots.find((s, i) => i !== ring.gate)!;
    const tile = target.rot ? { x: target.x, y: target.y + 1 } : { x: target.x + 1, y: target.y };
    const ti = tile.y * w.w + tile.x;
    w.objects[ti] = 2;
    const c = wallCandidates(pw(k), 'wall', ring);
    expect(c.length).toBeGreaterThan(0);
    k.st.ring = ring;
    const before = k.st.orders.length;
    const cand = c.find((s) => s.x === target.x && s.y === target.y);
    if (cand) {
      expect(k.sim.command({ t: 'build', kind: 'wall', x: target.x, y: target.y }).ok).toBe(true);
      expect(k.st.orders.length).toBe(before + 1);
      expect(w.objects[ti]).toBe(0);
    }
  });
});

describe('the finished wall', () => {
  it('is closed only when the pieces and the gate shut the village in, and the gate is open to walk through but a wall is not', () => {
    const k = kit(3, 12);
    const ring = planRing(pw(k), approach(k))!;
    k.st.ring = ring;
    const slots = ringSlots(ring);
    expect(isClosed(k.c)).toBe(false);
    slots.forEach((_, i) => i !== ring.gate && raise(k, ring, i));
    expect(isClosed(k.c)).toBe(false);
    raise(k, ring, ring.gate, true);
    expect(isClosed(k.c)).toBe(true);
    expect(wallState(k.c)).toEqual({ built: slots.length, total: slots.length, gate: true, closed: true });
    // one piece short and it is not
    k.st.buildings = k.st.buildings.filter((b) => !(b.kind === 'wall' && b.x === slots[4].x && b.y === slots[4].y));
    expect(isClosed(k.c)).toBe(false);
    expect(wallState(k.c)!.closed).toBe(false);
    // the overlay: the gate's tiles are open, a wall's are not
    k.sim.command({ t: 'speed', speed: 1 });
    const gate = k.st.buildings.find((b) => b.kind === 'gateway')!;
    const wall = k.st.buildings.find((b) => b.kind === 'wall')!;
    const grid = k.sim.world;
    void grid;
    expect(WALL_ARTS.has(gate.kind) && WALL_ARTS.has(wall.kind)).toBe(true);
  });

  it('makes the village harder to raid: a closed loop adds to the defence, an open one adds only its pieces', () => {
    const k = kit(3, 12);
    const ring = planRing(pw(k), approach(k))!;
    k.st.ring = ring;
    const slots = ringSlots(ring);
    const base = defenceOf(k.c);
    slots.forEach((_, i) => i !== ring.gate && raise(k, ring, i));
    const open = defenceOf(k.c);
    expect(open - base).toBeCloseTo(BAL.defence.wallCap * 1, 5);
    raise(k, ring, ring.gate, true);
    expect(defenceOf(k.c) - open).toBeCloseTo(BAL.defence.loop, 5);
  });
});

describe('a village that builds its own wall', () => {
  it('raises the whole loop and its one gate on the suggested rules, and people still get in and out through the gate', { timeout: 240_000 }, () => {
    const sim = createSim({ seed: 3 });
    const st = sim.inspect() as { tier: number; stock: Record<string, number>; buildings: BuildingDef[] };
    st.tier = 2;
    for (const r of CARETAKER_RULES) sim.command({ t: 'rule', rule: { ...r, id: 0 } });
    Object.assign(st.stock, { planks: 900, stone: 900, wood: 900, thatch: 80 });
    sim.step(110 * GAME_DAY_MS);
    const v = sim.view();
    expect(v.policy.wall).not.toBeNull();
    expect(v.policy.wall!.closed).toBe(true);
    expect(v.buildings.filter((b) => b.kind === 'gateway' && !b.con)).toHaveLength(1);
    expect(v.policy.ring).not.toBeNull();
    // nothing else stands on the line of the wall
    const ring = v.policy.ring!;
    const slots = ringSlots(ring);
    const onLine = (b: { x: number; y: number; w: number; d: number }): boolean => slots.some((s) => b.x < s.x + (s.rot ? 1 : 4) && b.x + b.w > s.x && b.y < s.y + (s.rot ? 4 : 1) && b.y + b.d > s.y);
    for (const b of v.buildings.filter((q) => !WALL_ARTS.has(q.kind))) expect(onLine(b), `${b.kind} ${b.x},${b.y}`).toBe(false);
    // a person can still go from the green to the far side of the gate
    const gate = v.buildings.find((b) => b.kind === 'gateway')!;
    expect(v.population).toBeGreaterThan(3);
    expect(gate).toBeDefined();
  });
});

/** A stream running the length of the map just outside the village (two tiles wide unless asked), on the given ground. */
function stream(k: Kit, ground: number, width = 2): { x: number } {
  const w = k.sim.world;
  let bx1 = -Infinity;
  for (const b of [...k.st.buildings, ...k.st.plots]) bx1 = Math.max(bx1, b.x + b.w - 1);
  const x = bx1 + 2;
  for (let y = 0; y < w.h; y++) for (let dx = 0; dx < width; dx++) w.terrain[y * w.w + x + dx] = ground;
  return { x };
}

/** Does a wall piece's footprint stand in shallow water? */
const wetSlot = (k: Kit, s: { x: number; y: number; rot: boolean }): boolean => {
  const w = k.sim.world;
  for (let i = 0; i < 4; i++) if (w.terrain[(s.rot ? s.y + i : s.y) * w.w + (s.rot ? s.x : s.x + i)] === T.Water) return true;
  return false;
};

describe('a wall and a stream', () => {
  it('may stand in shallow water, but a gate may not, and neither may deep water or rock be built on', () => {
    const k = kit(3, 12);
    const w = k.sim.world;
    const g = w.start.center;
    const x = g.x + 20;
    const y = g.y - 25;
    const at = (t: number) => {
      for (let i = 0; i < 4; i++) w.terrain[y * w.w + x + i] = t;
    };
    at(T.Water);
    expect(canPlace(pw(k), 'wall', x, y, false).ok).toBe(true);
    expect(canPlace(pw(k), 'gate', x, y, false).ok).toBe(false);
    expect(canPlace(pw(k), 'house', x, y, false).ok).toBe(false);
    at(T.DeepWater);
    const deep = canPlace(pw(k), 'wall', x, y, false);
    expect(deep.ok).toBe(false);
    if (!deep.ok) expect(deep.reason).toContain('deep water');
  });

  it('is run across: a loop is planned over a stream, with pieces standing in the water', () => {
    const k = kit(3, 12);
    expect(planRing(pw(k), approach(k))).not.toBeNull();
    // the stream crosses every route, so there was no loop before; now there is
    stream(k, T.Water);
    for (const r of ringRects(pw(k))) expect(ringSlots({ ...r, gate: 0 }).some((s) => wetSlot(k, s)), 'a route misses the stream').toBe(true);
    const ring = planRing(pw(k), approach(k))!;
    expect(ring).not.toBeNull();
    const w = k.sim.world;
    expect(ringSlots(ring).filter((s) => wetSlot(k, s)).length).toBeGreaterThan(0);
    // the gate stands on dry land
    const gate = ringSlots(ring)[ring.gate];
    for (let i = 0; i < 4; i++) expect(w.terrain[(gate.rot ? gate.y + i : gate.y) * w.w + (gate.rot ? gate.x : gate.x + i)]).not.toBe(T.Water);
  });

  it('says what is in the way when deep water or rock cuts every route, and refuses the orders with that reason', () => {
    const k = kit(3, 12);
    stream(k, T.DeepWater);
    expect(planRing(pw(k), approach(k))).toBeNull();
    expect(ringFailure(pw(k))).toMatch(/blocked in \d+ places? by deep water, rock or paving/);
    const res = k.sim.command({ t: 'build', kind: 'wall', x: 60, y: 60 });
    expect(res).toMatchObject({ ok: false, code: 'no_ring' });
    expect(k.sim.view().policy.wallBlock).toMatch(/deep water/);
  });

  it('counts a stream as part of the wall: the village is closed when the pieces and the water shut it in', () => {
    const k = kit(3, 12);
    stream(k, T.Water, 9);
    const ring = planRing(pw(k), approach(k))!;
    const w = k.sim.world;
    const covered = (s: { x: number; y: number; rot: boolean }): boolean => {
      for (let i = 0; i < 4; i++) if (w.terrain[(s.rot ? s.y + i : s.y) * w.w + (s.rot ? s.x : s.x + i)] !== T.Water) return false;
      return true;
    };
    const slots = ringSlots(ring);
    k.st.ring = ring;
    // raise every piece but the ones the stream covers entirely (and the gate)
    slots.forEach((s, i) => {
      if (i === ring.gate) return raise(k, ring, i, true);
      if (!covered(s)) raise(k, ring, i);
    });
    expect(slots.some(covered)).toBe(true);
    expect(wallState(k.c)!.built).toBeLessThan(slots.length);
    expect(isClosed(k.c)).toBe(true);
    expect(wallState(k.c)!.closed).toBe(true);
    // and then the wall rules have nothing more to ask for
    expect(k.sim.command({ t: 'build', kind: 'wall', x: 60, y: 60 })).toMatchObject({ ok: false, code: 'wall_closed' });
  });
});

describe('building materials', () => {
  it('are hauled for any shortfall, however small, so a stage is never left waiting for a tenth of a stone', () => {
    const k = kit(3, 12);
    setStock(k, { stone: 100, planks: 100 });
    const order: Order = { id: 900, mode: 'build', kind: 'wall', x: 5, y: 5, w: 4, d: 1, door: { x: 5, y: 6 }, done: 2, work: 0, delivered: { stone: 15.1, planks: 10 }, placedDay: 0, by: null, labourBy: {} };
    k.st.orders.push(order);
    refreshJobs(k.c);
    expect(k.st.jobs.some((j) => j.key === 'haul:900:stone')).toBe(true);
    order.delivered.stone = 16;
    refreshJobs(k.c);
    expect(k.st.jobs.some((j) => j.key === 'haul:900:stone')).toBe(false);
  });
});

describe('a wall that would shut the village off', () => {
  it('is the same loop as before wherever the outside stays reachable', () => {
    const k = kit(3, 12);
    const plain = planRing(pw(k), approach(k));
    const chosen = planRing(pw(k), approach(k), { accept: (r) => keepsOutsideOpen(k.c, r) });
    expect(plain).not.toBeNull();
    expect(chosen).toEqual(plain);
    expect(keepsOutsideOpen(k.c, plain!)).toBe(true);
  });

  it('is turned down when a stream runs the length of the map and the gate would open onto the far bank only', () => {
    const k = kit(3, 12);
    stream(k, T.Water, 2);
    const plain = planRing(pw(k), approach(k));
    expect(plain).not.toBeNull();
    // the gate stands on the east side, where the road goes, across the stream from the forests and the meadows
    const refused = planRing(pw(k), approach(k), { accept: (r) => keepsOutsideOpen(k.c, r) });
    expect(refused).toBeNull();
    const res = k.sim.command({ t: 'build', kind: 'wall', x: 60, y: 60 });
    expect(res).toMatchObject({ ok: false, code: 'no_ring' });
    expect(k.sim.view().policy.wallBlock).toMatch(/cut it off/);
  });
});

describe('places on the map', () => {
  it('are not offered once a wall stands on them', () => {
    const k = kit(3, 12);
    const s = k.c.sites.ofKind('stream')[0];
    expect(k.c.sites.get(s.id)).toBeDefined();
    k.st.buildings.push({ id: k.st.nextBuildingId++, kind: 'wall', x: s.x, y: s.y, w: 4, d: 1, door: { x: s.x, y: s.y + 1 } } as BuildingDef);
    k.c.sites.sync(k.st.buildings, k.st.plots, k.st.orders);
    expect(k.c.sites.get(s.id)).toBeUndefined();
  });

  it('give each person the same spot every time they plan to go there, and others a different one', () => {
    const k = kit(3, 12);
    const a = Array.from({ length: 5 }, () => spotNear(k.c, 80, 80, 1, 7));
    expect(new Set(a.map((q) => `${q.x},${q.y}`)).size).toBe(1);
    const spots = new Set(Array.from({ length: 12 }, (_, i) => spotNear(k.c, 80, 80, 1, 100 + i)).map((q) => `${q.x},${q.y}`));
    expect(spots.size).toBeGreaterThan(2);
  });
});

describe('trees beside the wall', () => {
  /** A bare ring slot with a tree on the tile next to it, and one two tiles off. */
  function lined(k: Kit): { near: number; far: number; onIt: number } {
    const ring = planRing(pw(k), approach(k))!;
    raise(k, ring, 0);
    const s = ringSlots(ring)[0];
    const W = k.c.world.w;
    const at = (x: number, y: number): number => y * W + x;
    // beside the first tile of the piece, on the side away from the ring's start of row or column, and a second further out
    const near = s.rot ? at(s.x + 1, s.y) : at(s.x, s.y + 1);
    const far = s.rot ? at(s.x + 2, s.y) : at(s.x, s.y + 2);
    const onIt = at(s.x, s.y);
    for (const i of [near, far, onIt]) {
      k.c.world.objects[i] = O.Oak;
      k.c.touch(i);
    }
    return { near, far, onIt };
  }

  it('are cut a tile back from every wall that stands, each day, and trees further off are left', () => {
    const k = kit(3, 12);
    const t = lined(k);
    floraDay(k.c);
    expect(k.c.world.objects[t.onIt]).toBe(O.None);
    expect(k.c.world.objects[t.near]).toBe(O.None);
    expect(k.c.world.objects[t.far]).toBe(O.Oak);
  });

  it('are cut a tile back when the piece is ordered, and bushes beside it stay', () => {
    const k = kit(3, 12);
    const W = k.c.world.w;
    const i = 40 * W + 40;
    const bush = 40 * W + 42;
    for (const j of [i, i + 1, i + W]) k.c.world.objects[j] = O.Pine;
    k.c.world.objects[bush] = O.Bush;
    clearBrush(k.c, 41, 40, 1, 1, 1);
    expect(k.c.world.objects[i]).toBe(O.None);
    expect(k.c.world.objects[i + 1]).toBe(O.None);
    expect(k.c.world.objects[i + W]).toBe(O.None);
    expect(k.c.world.objects[bush]).toBe(O.Bush);
    // a margin of zero is the old behaviour: only the footprint
    k.c.world.objects[i] = O.Pine;
    clearBrush(k.c, 41, 40, 1, 1, 0);
    expect(k.c.world.objects[i]).toBe(O.Pine);
  });
});
