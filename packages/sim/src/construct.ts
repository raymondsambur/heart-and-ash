/**
 * Construction and demolition (docs/ROADMAP.md, M2). The manager places an order on a plot; the order lands on the job board as
 * hauling jobs (material from the store to the plot) and a build job; villagers pick them up through the ordinary M1 brain.
 * Labour advances the stages of the blueprint (`shared/data/blueprints.ts`); the building (or plot) carries a `con` the client
 * draws from. Demolition runs the stages backwards, gives part of the material back and leaves rubble that is cleared last.
 *
 * Nothing here moves a person: it changes the world (what stands, what blocks, what the sites are) and the order's progress.
 */
import {
  BAL,
  BLUEPRINTS,
  DEMOLISH_LABOUR,
  GOOD_LABEL,
  MAX_ORDERS,
  STAGE_TEXT,
  blueprintOfKind,
  canPlace,
  clearWork,
  doorTile,
  findPath,
  footprintOf,
  nearestSlot,
  planRing,
  reservedSlots,
  wallCandidates,
  wallWhy,
  needsThrough,
  refundRate,
  stageWork,
  totalNeeds,
  O,
  type BuildKind,
  type BuildingDef,
  type Blueprint,
  type ConView,
  type Good,
  type OrderView,
  type PlotDef,
  type WishView,
  type WorldData,
} from '@hearth/shared';
import { newField } from './actions';
import { clearBrush, clearFlora } from './flora';
import { clearRoads } from './roads';
import { tierReason } from './outside';
import type { CommandResult, Order, Person } from './types';
import type { Ctx } from './ctx';
import type { Draft } from './jobs';
import { pushFeed } from './feed';
import { stop } from './move';
import { addMood, mem, stat } from './util';

const fail = (code: string, text: string): CommandResult => ({ ok: false, code, text });

// ---------------------------------------------------------------------------------------------------
// The map under the buildings
// ---------------------------------------------------------------------------------------------------

/**
 * Which tiles the village has changed since the map was made. The map's own grid is never edited (every boot and every
 * client has the same one): this overlay says 1 where something now stands, 2 where a building of the starting village has gone.
 */
export function computeOverlay(world: Pick<WorldData, 'w' | 'h' | 'objects'>, buildings: readonly BuildingDef[], out: Uint8Array): void {
  out.fill(0);
  for (let i = 0; i < world.objects.length; i++) if (world.objects[i] === O.Building) out[i] = 2;
  for (const b of buildings) {
    // A finished gate is open to walk through; everything else that stands blocks.
    const open = b.kind === 'gateway' && !b.con ? 2 : 1;
    for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < world.w && y < world.h) out[y * world.w + x] = open;
  }
}

/** Call after anything was raised, finished or removed: the blocked tiles, the sites and the job board follow. */
export function structuresChanged(c: Ctx): void {
  computeOverlay(c.world, c.st.buildings, c.over);
  c.sites.sync(c.st.buildings, c.st.plots, c.st.orders);
  c.st.jobsAt = -1;
  // People already on their way must not walk through what now stands.
  const w = c.world.w;
  for (const p of c.people) {
    if (c.over[p.y * w + p.x] === 1) {
      const o = c.st.orders.find((x) => p.x >= x.x && p.y >= x.y && p.x < x.x + x.w && p.y < x.y + x.d);
      const out = o ? o.door : { x: p.x, y: p.y };
      p.x = p.nx = out.x;
      p.y = p.ny = out.y;
      stop(p);
    } else if (p.path.some((t) => c.over[t.y * w + t.x] === 1) || (p.stepMs > 0 && c.over[p.ny * w + p.nx] === 1)) {
      stop(p);
    }
  }
}

function structureOf(c: Ctx, o: Order): (BuildingDef | PlotDef) | undefined {
  return o.building !== undefined ? c.st.buildings.find((b) => b.id === o.building) : c.st.plots.find((p) => p.id === o.plot);
}

/** What the client draws: write the order's progress onto its building or plot. */
function syncCon(c: Ctx, o: Order): void {
  const t = structureOf(c, o);
  if (!t) return;
  const bp = BLUEPRINTS[o.kind];
  let need = 0;
  if (o.mode === 'build') need = stageWork(bp, o.done);
  else if (o.mode === 'demolish') need = stageWork(bp, o.done - 1) * DEMOLISH_LABOUR;
  else need = clearWork(bp);
  const pct = need > 0 ? Math.min(100, Math.floor(((o.work / need) * 100) / 5) * 5) : 0;
  const con: ConView = { mode: o.mode, done: o.done, pct, order: o.id };
  if (o.mode === 'build') {
    const built = o.done > 0 ? needsThrough(bp, o.done - 1) : {};
    const pile: Record<string, number> = {};
    for (const [g, n] of Object.entries(o.delivered) as [Good, number][]) {
      const left = Math.floor(n - (built[g] ?? 0) + 1e-6);
      if (left > 0) pile[g] = left;
    }
    if (Object.keys(pile).length) con.pile = pile;
  }
  const old = t.con;
  if (!old || old.mode !== con.mode || old.done !== con.done || old.pct !== con.pct || JSON.stringify(old.pile) !== JSON.stringify(con.pile)) t.con = con;
}

// ---------------------------------------------------------------------------------------------------
// Placing, ordering down, cancelling
// ---------------------------------------------------------------------------------------------------

function plazaTile(c: Ctx): { x: number; y: number } {
  const s = c.sites.ofKind('plaza')[0];
  return s ? { x: s.x, y: s.y } : { x: c.world.start.center.x, y: c.world.start.center.y + 2 };
}

/** Order a building raised or a field ploughed. `by` is the villager who asked (their own house), or null for the manager. */
export function placeOrder(c: Ctx, kind: BuildKind, x0: number, y0: number, rot0: boolean, by: number | null): CommandResult {
  let x = x0;
  let y = y0;
  let rot = rot0;
  const st = c.st;
  const bp = BLUEPRINTS[kind];
  if (!bp) return fail('bad_kind', 'The village cannot build that.');
  if (!Number.isInteger(x) || !Number.isInteger(y)) return fail('bad_place', 'Pick a tile.');
  const locked = tierReason(kind, st.tier);
  if (locked) return fail('tier', locked);
  const wall = kind === 'wall' || kind === 'gate';
  if (wall) {
    // The wall is one loop with one gate: a piece goes on the next free slot of the ring, the one nearest to where you pointed.
    const pw = { world: c.world, buildings: st.buildings, plots: st.plots };
    const ring = st.ring ?? planRing(pw, approachOf(c));
    if (!ring) return fail('no_ring', 'There is no room to run a wall right round the village.');
    const slot = nearestSlot(wallCandidates(pw, kind, ring), x, y);
    if (!slot) return fail('wall_why', wallWhy(pw, kind, ring));
    st.ring = ring;
    x = slot.x;
    y = slot.y;
    rot = slot.rot;
  }
  if (st.orders.length >= Math.min(MAX_ORDERS, BAL.tiers.maxOrders[st.tier])) return fail('too_many', 'There are too many orders at once for a settlement of this size. Cancel one or wait for the builders.');
  const reserved = !wall && st.ring ? reservedSlots({ world: c.world, buildings: st.buildings, plots: st.plots }, st.ring) : [];
  if (reserved.some((r) => x < r.x + r.w && x + footprintOf(kind, rot).w > r.x && y < r.y + r.d && y + footprintOf(kind, rot).d > r.y)) return fail('wall_line', 'That is where the village wall is planned to run.');
  const chk = canPlace({ world: c.world, buildings: st.buildings, plots: st.plots }, kind, x, y, rot);
  if (!chk.ok) return fail('cannot_place', chk.reason);
  const { w, d, door } = chk;

  const id = st.nextOrderId++;
  const isField = kind === 'field';
  const con: ConView = { mode: 'build', done: 0, pct: 0, order: id };
  const order: Order = { id, mode: 'build', kind, x, y, w, d, door, done: 0, work: 0, delivered: {}, placedDay: c.day, by, labourBy: {} };
  if (isField) {
    const plot: PlotDef = { id: st.nextPlotId++, kind: 'field', x, y, w, d, con };
    st.plots.push(plot);
    order.plot = plot.id;
  } else {
    const b: BuildingDef = { id: st.nextBuildingId++, kind: bp.art as BuildingDef['kind'], x, y, w, d, door: { ...door }, con };
    st.buildings.push(b);
    order.building = b.id;
  }
  st.orders.push(order);
  clearFlora(c, x, y, w, d);
  clearRoads(c, x, y, w, d);
  if (wall) clearBrush(c, x, y, w, d);
  structuresChanged(c);

  // The tile in front must be reachable from the village green with this standing there.
  const from = plazaTile(c);
  if (!findPath(c.grid, from.x, from.y, door.x, door.y) && !(from.x === door.x && from.y === door.y)) {
    st.orders.pop();
    if (isField) st.plots.pop();
    else st.buildings.pop();
    st.nextOrderId--;
    if (isField) st.nextPlotId--;
    else st.nextBuildingId--;
    structuresChanged(c);
    return fail('unreachable', 'Nobody could walk there from the village green.');
  }
  syncCon(c, order);
  pushFeed(st, c.pending, 'build', `${by === null ? 'The manager' : (c.person(by)?.name ?? 'Someone')} ordered ${article(bp.label)} ${bp.label.toLowerCase()}.`, by === null ? [] : [by]);
  stat(c, 'orders_placed');
  return { ok: true, text: `${bp.label} ordered. Builders will bring the materials from the store.` };
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

/** Homes for people who lost theirs: the finished house with the fewest people under its roof. */
export function emptiestHome(c: Ctx, except?: number): number | null {
  const counts = new Map<number, number>();
  for (const b of c.st.buildings) if (b.kind === 'house' && !b.con && b.id !== except) counts.set(b.id, 0);
  for (const o of c.st.people) if (o.home !== null && counts.has(o.home)) counts.set(o.home, counts.get(o.home)! + 1);
  let best: number | null = null;
  for (const [id, n] of counts) if (best === null || n < counts.get(best)!) best = id;
  return best;
}

/** Order a building (or a field) taken down. */
export function orderDemolish(c: Ctx, buildingId?: number, plotId?: number): CommandResult {
  const st = c.st;
  const b = buildingId !== undefined ? st.buildings.find((x) => x.id === buildingId) : undefined;
  const plot = plotId !== undefined ? st.plots.find((x) => x.id === plotId) : undefined;
  const t = b ?? plot;
  if (!t) return fail('no_target', 'There is nothing there to take down.');
  if (t.con) return fail('busy', t.con.mode === 'build' ? 'That is still being raised: cancel its order instead.' : 'It is already being taken down.');
  const bp = blueprintOfKind(plot ? 'field' : (t as BuildingDef).kind);
  if (!bp) return fail('cannot_demolish', 'That cannot be taken down.');
  if (st.orders.length >= MAX_ORDERS) return fail('too_many', 'There are too many orders at once. Cancel one or wait for the builders.');
  const id = st.nextOrderId++;
  const n = bp.stages.length;
  const order: Order = { id, mode: 'demolish', kind: bp.kind, x: t.x, y: t.y, w: t.w, d: t.d, door: b ? { ...b.door } : doorTile(t.x, t.y, t.w, t.d), done: n, work: 0, delivered: needsThrough(bp, n - 1), placedDay: c.day, by: null, labourBy: {} };
  if (b) order.building = b.id;
  else order.plot = plot!.id;
  st.orders.push(order);
  t.con = { mode: 'demolish', done: n, pct: 0, order: id };
  if (b?.kind === 'house') evict(c, b.id);
  if (plot) st.fields = st.fields.filter((f) => f.plot !== plot.id);
  structuresChanged(c);
  pushFeed(st, c.pending, 'build', `The manager ordered ${article(bp.label)} ${bp.label.toLowerCase()} taken down.`, []);
  stat(c, 'orders_placed');
  return { ok: true, text: `${bp.label} will be taken down. Part of the material comes back to the store.` };
}

/** People who lived in a house that is coming down find another roof if there is one. */
function evict(c: Ctx, buildingId: number): void {
  let n = 0;
  for (const p of c.st.people) {
    if (p.home !== buildingId) continue;
    p.home = emptiestHome(c, buildingId);
    n++;
  }
  if (n > 0) pushFeed(c.st, c.pending, 'home', `${n} ${n === 1 ? 'person' : 'people'} had to leave the house that is coming down.`, []);
}

export function cancelOrder(c: Ctx, orderId: number): CommandResult {
  const st = c.st;
  const o = st.orders.find((x) => x.id === orderId);
  if (!o) return fail('no_order', 'That order is already done or gone.');
  const bp = BLUEPRINTS[o.kind];
  if (o.mode === 'rubble') return fail('cannot_cancel', 'Only the rubble is left; it will be cleared.');
  if (o.mode === 'demolish') {
    // Changed their mind: what still stands is built up again from here.
    o.mode = 'build';
    o.work = 0;
    delete o.note;
    const t = structureOf(c, o);
    if (t) t.con = undefined;
    if (o.done >= bp.stages.length) finishBuild(c, o, bp, true);
    else {
      syncCon(c, o);
      structuresChanged(c);
    }
    return { ok: true, text: `The ${bp.label.toLowerCase()} will be built back up.` };
  }
  // A build that has not begun just goes away; one that has is taken down.
  if (o.done === 0 && o.work <= 0) {
    for (const [g, n] of Object.entries(o.delivered) as [Good, number][]) st.stock[g] = (st.stock[g] ?? 0) + n;
    if (o.building !== undefined) st.buildings = st.buildings.filter((b) => b.id !== o.building);
    else st.plots = st.plots.filter((p) => p.id !== o.plot);
    st.orders = st.orders.filter((x) => x.id !== o.id);
    structuresChanged(c);
    return { ok: true, text: `The ${bp.label.toLowerCase()} order is cancelled; nothing was built.` };
  }
  // The unused pile goes back to the store; what is built comes down.
  const built = o.done > 0 ? needsThrough(bp, o.done - 1) : {};
  for (const [g, n] of Object.entries(o.delivered) as [Good, number][]) {
    const spare = n - (built[g] ?? 0);
    if (spare > 0) st.stock[g] = (st.stock[g] ?? 0) + spare;
  }
  o.delivered = built;
  o.mode = 'demolish';
  o.work = 0;
  delete o.note;
  if (o.done === 0) o.mode = 'rubble';
  syncCon(c, o);
  structuresChanged(c);
  return { ok: true, text: `Work had begun, so the builders will take the ${bp.label.toLowerCase()} down again.` };
}

// ---------------------------------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------------------------------

/** Missing material for the stage in hand (and the next, so builders are not left waiting). */
export function shortfall(o: Order, good: Good, ahead = 1): number {
  const bp = BLUEPRINTS[o.kind];
  const target = needsThrough(bp, Math.min(bp.stages.length - 1, o.done + ahead))[good] ?? 0;
  return Math.max(0, target - (o.delivered[good] ?? 0));
}

/** The stage in hand has all its material. */
export function stageReady(o: Order): boolean {
  if (o.mode !== 'build') return true;
  const bp = BLUEPRINTS[o.kind];
  const need = needsThrough(bp, Math.min(o.done, bp.stages.length - 1));
  return (Object.entries(need) as [Good, number][]).every(([g, n]) => (o.delivered[g] ?? 0) >= n - 1e-6);
}

function missingText(o: Order): string {
  const bp = BLUEPRINTS[o.kind];
  const need = needsThrough(bp, Math.min(o.done, bp.stages.length - 1));
  const parts: string[] = [];
  for (const [g, n] of Object.entries(need) as [Good, number][]) {
    const lack = Math.ceil(n - (o.delivered[g] ?? 0) - 1e-6);
    if (lack > 0) parts.push(`${lack} ${GOOD_LABEL[g].toLowerCase()}`);
  }
  return parts.length ? `waiting for ${parts.join(' and ')}` : '';
}

/** A builder puts a load of material on the plot. */
export function deliver(c: Ctx, p: Person, orderId: number): void {
  const o = c.st.orders.find((x) => x.id === orderId);
  const load = p.carrying;
  if (!load) return;
  p.carrying = null;
  if (!o || o.mode !== 'build') {
    c.st.stock[load.good] = (c.st.stock[load.good] ?? 0) + load.qty;
    return;
  }
  const bp = BLUEPRINTS[o.kind];
  if ((totalNeeds(bp)[load.good] ?? 0) <= 0) {
    // Not something this building uses: back to the store.
    c.st.stock[load.good] = (c.st.stock[load.good] ?? 0) + load.qty;
    return;
  }
  o.delivered[load.good] = (o.delivered[load.good] ?? 0) + load.qty;
  o.labourBy[p.id] = (o.labourBy[p.id] ?? 0) + 0.2;
  stat(c, `delivered_${load.good}`, load.qty);
  const note = missingText(o);
  if (note) o.note = note;
  else delete o.note;
  syncCon(c, o);
  c.st.jobsAt = -1;
}

/** One act of work on an order, in labour units. */
export function addWork(c: Ctx, p: Person, orderId: number, units: number): boolean {
  const st = c.st;
  const o = st.orders.find((x) => x.id === orderId);
  if (!o) return false;
  const bp = BLUEPRINTS[o.kind];
  o.labourBy[p.id] = (o.labourBy[p.id] ?? 0) + units;
  if (o.mode === 'build') {
    if (!stageReady(o)) {
      o.note = missingText(o);
      return false;
    }
    delete o.note;
    o.work += units;
    while (o.done < bp.stages.length) {
      const need = stageWork(bp, o.done);
      if (o.work + 1e-9 < need) break;
      o.work -= need;
      o.done++;
      if (o.done < bp.stages.length && !stageReady(o)) {
        o.work = 0;
        o.note = missingText(o);
        break;
      }
    }
    if (o.done >= bp.stages.length) finishBuild(c, o, bp);
    else syncCon(c, o);
  } else if (o.mode === 'demolish') {
    o.work += units;
    for (;;) {
      const need = stageWork(bp, o.done - 1) * DEMOLISH_LABOUR;
      if (o.done <= 0 || o.work + 1e-9 < need) break;
      o.work -= need;
      // The stage comes down: part of its material goes back to the store.
      const stage = bp.stages[o.done - 1];
      for (const [g, n] of Object.entries(stage.needs) as [Good, number][]) {
        st.stock[g] = (st.stock[g] ?? 0) + n * refundRate(g);
        o.delivered[g] = Math.max(0, (o.delivered[g] ?? 0) - n);
      }
      o.done--;
    }
    if (o.done <= 0) {
      o.mode = 'rubble';
      o.work = 0;
    }
    syncCon(c, o);
    st.jobsAt = -1;
  } else {
    o.work += units;
    if (o.work + 1e-9 >= clearWork(bp)) finishRubble(c, o, bp);
    else syncCon(c, o);
  }
  return true;
}

function finishBuild(c: Ctx, o: Order, bp: Blueprint, quiet = false): void {
  const st = c.st;
  // Material left over goes back to the store.
  const total = totalNeeds(bp);
  for (const [g, n] of Object.entries(o.delivered) as [Good, number][]) {
    const spare = n - (total[g] ?? 0);
    if (spare > 0.01) st.stock[g] = (st.stock[g] ?? 0) + spare;
  }
  const t = structureOf(c, o);
  if (t) t.con = undefined;
  st.orders = st.orders.filter((x) => x.id !== o.id);
  const name = bp.label.toLowerCase();
  const crew = Object.entries(o.labourBy)
    .map(([id, u]) => ({ p: c.person(Number(id)), u }))
    .filter((x): x is { p: Person; u: number } => !!x.p && x.u >= 2)
    .sort((a, b) => b.u - a.u);
  if (o.plot !== undefined && bp.kind === 'field') st.fields.push(newField(o.plot));
  structuresChanged(c);
  if (quiet) return;
  pushFeed(st, c.pending, 'build', `The new ${name} is finished${crew.length ? `, built by ${crew.slice(0, 3).map((x) => x.p.name).join(', ')}${crew.length > 3 ? ' and others' : ''}` : ''}.`, crew.slice(0, 3).map((x) => x.p.id));
  stat(c, 'buildings_finished');
  stat(c, `finished_${bp.kind}`);
  for (const { p } of crew) {
    addMood(c, p, `proud of the new ${name}`, 4, 48);
    mem(c, p, 'built', `helped raise the ${name}`, 0.5);
  }
  if (bp.kind === 'house' && o.building !== undefined) settleHouse(c, o, crew.map((x) => x.p));
  if (bp.kind === 'shrine') for (const { p, u } of crew) if (u >= 6) p.counters.builtShrine = c.day;
}

/** A new house: whoever asked for one (or worked hardest on it while wanting one) moves in with their family, then the homeless. */
function settleHouse(c: Ctx, o: Order, crew: Person[]): void {
  const id = o.building!;
  const wants = (p: Person): boolean => p.ambitions.some((a) => !a.ended && (a.kind === 'own_house' || a.kind === 'be_left_alone'));
  const owner = (o.by !== null ? c.person(o.by) : undefined) ?? crew.find(wants) ?? c.people.find((p) => wants(p) && p.home !== null && c.st.people.filter((q) => q.home === p.home).length > 1);
  const b = c.st.buildings.find((x) => x.id === id);
  if (owner && b) {
    const house = [owner];
    if (owner.partner !== null) {
      const mate = c.person(owner.partner);
      if (mate) house.push(mate);
    }
    for (const kid of owner.children) {
      const k = c.person(kid);
      if (k && k.home === owner.home && k.born > c.day - 14 * 96) house.push(k);
    }
    for (const m of house) m.home = id;
    owner.counters.ownHouse = id;
    pushFeed(c.st, c.pending, 'home', `${owner.name} moved into the new house${house.length > 1 ? ' with their family' : ''}.`, [owner.id]);
  }
  // The homeless take what is left.
  let room = 4 - c.st.people.filter((p) => p.home === id).length;
  for (const p of c.st.people) {
    if (room <= 0) break;
    if (p.home === null) {
      p.home = id;
      room--;
    }
  }
}

function finishRubble(c: Ctx, o: Order, bp: Blueprint): void {
  const st = c.st;
  if (o.building !== undefined) st.buildings = st.buildings.filter((b) => b.id !== o.building);
  else st.plots = st.plots.filter((p) => p.id !== o.plot);
  st.orders = st.orders.filter((x) => x.id !== o.id);
  structuresChanged(c);
  pushFeed(st, c.pending, 'build', `The ${bp.label.toLowerCase()} is gone and the ground is clear.`, []);
  stat(c, 'buildings_removed');
}

// ---------------------------------------------------------------------------------------------------
// The job board and the views
// ---------------------------------------------------------------------------------------------------

/** What the village's builders have to do: bring material, build, take down, clear rubble. */
export function constructionJobs(c: Ctx, draft: (key: string, goal: Draft['goal'], priority: number, slots: number, o?: Partial<Draft>) => Draft): Draft[] {
  const out: Draft[] = [];
  // Loads on their way count against what is still missing.
  const carried = new Map<string, number>();
  for (const p of c.people) {
    const g = p.goal;
    if (g && g.kind === 'act' && g.action === 'deliver_material' && g.order !== undefined && p.carrying) {
      const k = `${g.order}:${p.carrying.good}`;
      carried.set(k, (carried.get(k) ?? 0) + p.carrying.qty);
    }
  }
  for (const o of c.st.orders) {
    const bp = BLUEPRINTS[o.kind];
    const name = bp.label.toLowerCase();
    if (o.mode === 'build') {
      const stage = bp.stages[Math.min(o.done, bp.stages.length - 1)];
      for (const g of Object.keys(totalNeeds(bp)) as Good[]) {
        const lack = shortfall(o, g) - (carried.get(`${o.id}:${g}`) ?? 0);
        if (lack >= 1 && (c.st.stock[g] ?? 0) >= 1) {
          out.push(draft(`haul:${o.id}:${g}`, { kind: 'act', action: 'deliver_material', order: o.id, good: g, label: `bring ${GOOD_LABEL[g].toLowerCase()} to the ${name}` }, 5, Math.min(3, Math.ceil(lack / 5))));
        }
      }
      if (stageReady(o)) {
        delete o.note;
        out.push(draft(`build:${o.id}`, { kind: 'act', action: 'build', order: o.id, label: `build the ${name} (${STAGE_TEXT[stage.id]})` }, 5, bp.w * bp.d >= 6 ? 4 : 2, { skill: 'building' }));
      } else {
        const miss = missingText(o);
        const nothing = (Object.keys(totalNeeds(bp)) as Good[]).filter((g) => shortfall(o, g, 0) > 0 && (c.st.stock[g] ?? 0) < 1);
        o.note = nothing.length ? `${miss}; the store has no ${nothing.map((g) => GOOD_LABEL[g].toLowerCase()).join(' or ')}` : miss;
      }
    } else if (o.mode === 'demolish') {
      out.push(draft(`demolish:${o.id}`, { kind: 'act', action: 'demolish', order: o.id, label: `take the ${name} down` }, 4, 3, { skill: 'building' }));
    } else {
      out.push(draft(`rubble:${o.id}`, { kind: 'act', action: 'clear_rubble', order: o.id, label: `clear the rubble of the ${name}` }, 4, 2));
    }
  }
  return out;
}

/** Material the standing orders still lack in all, by good (the store's producers aim a little above it). */
export function outstanding(c: Ctx): Partial<Record<Good, number>> {
  const out: Partial<Record<Good, number>> = {};
  for (const o of c.st.orders) {
    if (o.mode !== 'build') continue;
    const bp = BLUEPRINTS[o.kind];
    for (const [g, n] of Object.entries(totalNeeds(bp)) as [Good, number][]) out[g] = (out[g] ?? 0) + Math.max(0, n - (o.delivered[g] ?? 0));
  }
  return out;
}

export function orderViews(c: Ctx): OrderView[] {
  const workers = new Map<number, number>();
  for (const p of c.people) {
    const g = p.goal;
    if (g && g.kind === 'act' && g.order !== undefined) workers.set(g.order, (workers.get(g.order) ?? 0) + 1);
  }
  return c.st.orders.map((o) => {
    const bp = BLUEPRINTS[o.kind];
    const n = bp.stages.length;
    let overall = 0;
    if (o.mode === 'build') {
      let done = 0;
      for (let i = 0; i < o.done; i++) done += stageWork(bp, i);
      overall = ((done + o.work) / bp.labour) * 100;
    } else if (o.mode === 'demolish') {
      const need = stageWork(bp, o.done - 1) * DEMOLISH_LABOUR;
      overall = ((n - o.done + (need > 0 ? o.work / need : 0)) / n) * 100;
    } else overall = (o.work / clearWork(bp)) * 100;
    const needs = o.mode === 'build' ? (Object.entries(totalNeeds(bp)) as [Good, number][]).map(([g, need]) => ({ good: g, have: Math.min(need, Math.floor(o.delivered[g] ?? 0)), need })) : [];
    const by = o.by === null ? 'you' : (c.person(o.by)?.name ?? 'a villager');
    const view: OrderView = { id: o.id, mode: o.mode, kind: o.kind, label: bp.label, x: o.x, y: o.y, w: o.w, d: o.d, done: o.done, stages: n, overall: Math.max(0, Math.min(100, Math.round(overall))), needs, workers: workers.get(o.id) ?? 0, day: o.placedDay, by };
    if (o.building !== undefined) view.building = o.building;
    if (o.plot !== undefined) view.plot = o.plot;
    if (o.note) view.waiting = o.note;
    return view;
  });
}

/** Villagers who want something built that nobody has ordered. */
export function wishes(c: Ctx): WishView[] {
  const out: WishView[] = [];
  const raising = (kind: BuildKind): boolean => c.st.orders.some((o) => o.kind === kind && o.mode === 'build');
  for (const p of c.people) {
    for (const a of p.ambitions) {
      if (a.ended || !a.stuck) continue;
      if (a.kind === 'own_house' && !raising('house')) out.push({ who: p.id, name: p.name, wish: 'a house of their own', day: a.startedDay });
      else if (a.kind === 'build_shrine' && !raising('shrine')) out.push({ who: p.id, name: p.name, wish: 'a new shrine', day: a.startedDay });
      else if (a.kind === 'be_left_alone' && !raising('house')) out.push({ who: p.id, name: p.name, wish: 'a house away from the crowd', day: a.startedDay });
    }
  }
  return out;
}


/** Where trouble comes from: the far end of the main street (a wall puts its gate on that side). */
export function approachOf(c: Ctx): { x: number; y: number } | null {
  const e = c.sites.ofKind('edge')[0];
  return e ? { x: e.x, y: e.y } : null;
}
