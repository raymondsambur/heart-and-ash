/**
 * The village wall (M6): one loop around the settlement made of four-tile pieces that touch end to end with no gap, and a single
 * gate in it. The loop is a rectangle planned once around what the village has (`planRing`); its pieces are the slots of the ring,
 * raised in order from the gate outwards so that every piece joins the one before it (`wallCandidates`). Pure, so the sim, the
 * rules and the client's placement preview agree.
 */
import { BUILD_RADIUS, WALL_ARTS, canPlace, footprintOf, type BuildKind } from './blueprints';
import type { PlacementWorld } from './placement';

/** The wall's rectangle: the pieces run along the rows `y0` and `y1` (x0..x1, a multiple of four tiles) and the columns `x0` and `x1` between them. */
export interface WallRing {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The index (in `ringSlots` order) of the slot where the gate goes. */
  gate: number;
}

export interface WallSlot {
  x: number;
  y: number;
  /** Laid along y (one tile wide, four deep). */
  rot: boolean;
}

const PIECE = 4;

/** All the slots of a ring in order, clockwise from the top left. */
export function ringSlots(r: WallRing): WallSlot[] {
  const a = (r.x1 - r.x0 + 1) / PIECE;
  const b = (r.y1 - r.y0 - 1) / PIECE;
  const out: WallSlot[] = [];
  for (let k = 0; k < a; k++) out.push({ x: r.x0 + PIECE * k, y: r.y0, rot: false });
  for (let k = 0; k < b; k++) out.push({ x: r.x1, y: r.y0 + 1 + PIECE * k, rot: true });
  for (let k = a - 1; k >= 0; k--) out.push({ x: r.x0 + PIECE * k, y: r.y1, rot: false });
  for (let k = b - 1; k >= 0; k--) out.push({ x: r.x0, y: r.y0 + 1 + PIECE * k, rot: true });
  return out;
}

const dims = (s: WallSlot): { w: number; d: number } => (s.rot ? { w: 1, d: PIECE } : { w: PIECE, d: 1 });

/** Steps round the ring between two slots, the short way. */
function ringDist(i: number, j: number, n: number): number {
  const d = Math.abs(i - j);
  return Math.min(d, n - d);
}

/** Which slots already have a wall piece (finished or going up) on them. */
export function builtSlots(pw: PlacementWorld, ring: WallRing): boolean[] {
  const slots = ringSlots(ring);
  return slots.map((s) => {
    const { w, d } = dims(s);
    return pw.buildings.some((b) => b.kind !== undefined && WALL_ARTS.has(b.kind) && b.x === s.x && b.y === s.y && b.w === w && b.d === d);
  });
}

/** The slots of the wall that are still empty, as footprints: nothing else may be raised on them (they are reserved for the wall). */
export function reservedSlots(pw: PlacementWorld, ring: WallRing): { kind: string; x: number; y: number; w: number; d: number; door: { x: number; y: number } }[] {
  const built = builtSlots(pw, ring);
  const out: { kind: string; x: number; y: number; w: number; d: number; door: { x: number; y: number } }[] = [];
  ringSlots(ring).forEach((s, i) => {
    if (built[i]) return;
    const { w, d } = dims(s);
    out.push({ kind: 'wall', x: s.x, y: s.y, w, d, door: { x: -9, y: -9 } });
  });
  return out;
}

export interface RingProgress {
  built: number;
  total: number;
  /** The gate stands (or is going up). */
  gate: boolean;
}

export function ringProgress(pw: PlacementWorld, ring: WallRing): RingProgress {
  const built = builtSlots(pw, ring);
  return { built: built.filter(Boolean).length, total: built.length, gate: built[ring.gate] === true };
}

/**
 * The slots a piece of this kind may be raised on now, best first: the gate only on the gate's slot, a wall on any other slot that
 * joins a piece already there (the first piece goes beside the gate's slot), and only where the ground allows.
 */
export function wallCandidates(pw: PlacementWorld, kind: BuildKind, ring: WallRing): WallSlot[] {
  if (kind !== 'wall' && kind !== 'gate') return [];
  const slots = ringSlots(ring);
  const n = slots.length;
  const built = builtSlots(pw, ring);
  const none = !built.some(Boolean);
  const out: { s: WallSlot; rank: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (built[i]) continue;
    if (kind === 'gate' ? i !== ring.gate : i === ring.gate) continue;
    const joins = built[(i + 1) % n] || built[(i - 1 + n) % n];
    const first = ringDist(i, ring.gate, n) <= 1;
    if (!(none ? first : joins)) continue;
    if (!canPlace(pw, kind, slots[i].x, slots[i].y, slots[i].rot).ok) continue;
    out.push({ s: slots[i], rank: ringDist(i, ring.gate, n) });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out.map((o) => o.s);
}

/** Why a wall piece cannot be raised now, in words (used when there is no candidate). */
export function wallWhy(pw: PlacementWorld, kind: BuildKind, ring: WallRing): string {
  const p = ringProgress(pw, ring);
  if (kind === 'gate' && p.gate) return 'The wall already has its gate: a wall has a single one.';
  if (p.built >= p.total) return 'The wall is complete.';
  if (kind === 'wall' && p.built >= p.total - 1 && !p.gate) return 'Only the gate is left to raise.';
  return 'The next piece of the wall cannot be raised yet: something is in the way, or it is not beside the wall that stands.';
}

/** The candidate nearest to a clicked tile. */
export function nearestSlot(cands: readonly WallSlot[], x: number, y: number): WallSlot | null {
  let best: WallSlot | null = null;
  let bd = Infinity;
  for (const s of cands) {
    const { w, d } = dims(s);
    const dd = Math.hypot(s.x + w / 2 - x - 0.5, s.y + d / 2 - y - 0.5);
    if (dd < bd) {
      best = s;
      bd = dd;
    }
  }
  return best;
}

/**
 * The rectangles a loop may take, in the order they are tried: a margin of 3, 4, 5, 6 and 2 tiles round everything the village has,
 * each moved up to four tiles any way, whole pieces on every side, inside what may be built. They are only rectangles: whether the
 * ground suits is decided by the caller.
 */
export function ringRects(pw: PlacementWorld): Omit<WallRing, 'gate'>[] {
  const green = pw.world.start.center;
  const rects = [...pw.buildings.filter((b) => !(b.kind !== undefined && WALL_ARTS.has(b.kind))), ...pw.plots];
  if (rects.length === 0) return [];
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const r of rects) {
    bx0 = Math.min(bx0, r.x);
    by0 = Math.min(by0, r.y);
    bx1 = Math.max(bx1, r.x + r.w - 1);
    by1 = Math.max(by1, r.y + r.d - 1);
  }
  const order = (n: number): number[] => [0, ...Array.from({ length: n }, (_, k) => [k + 1, -(k + 1)]).flat()];
  const out: Omit<WallRing, 'gate'>[] = [];
  for (const margin of [3, 4, 5, 6, 2]) {
    const wNeed = bx1 - bx0 + 1 + 2 * margin;
    const hNeed = by1 - by0 + 1 + 2 * margin;
    const a = Math.max(3, Math.ceil(wNeed / PIECE));
    const b = Math.max(3, Math.ceil((hNeed - 2) / PIECE));
    const width = a * PIECE;
    const height = b * PIECE + 2;
    const cx = (bx0 + bx1) / 2;
    const cy = (by0 + by1) / 2;
    const bx = Math.round(cx - (width - 1) / 2);
    const by = Math.round(cy - (height - 1) / 2);
    for (const dy of order(4)) {
      for (const dx of order(4)) {
        const r = { x0: bx + dx, y0: by + dy, x1: bx + dx + width - 1, y1: by + dy + height - 1 };
        // inside what may be built, and round everything the village has
        if (Math.max(Math.abs(r.x0 - green.x), Math.abs(r.x1 - green.x), Math.abs(r.y0 - green.y), Math.abs(r.y1 - green.y)) > BUILD_RADIUS - 1) continue;
        if (r.x0 > bx0 - 2 || r.y0 > by0 - 2 || r.x1 < bx1 + 2 || r.y1 < by1 + 2) continue;
        out.push(r);
      }
    }
  }
  return out;
}

/** Which side the road comes in on: the gate goes there. */
function gateSide(pw: PlacementWorld, approach: { x: number; y: number } | null): { sideE: boolean | null; sideS: boolean | null } {
  const green = pw.world.start.center;
  const to = approach ?? { x: green.x + 40, y: green.y };
  const east = Math.abs(to.x - green.x) >= Math.abs(to.y - green.y);
  return { sideE: east ? to.x >= green.x : null, sideS: east ? null : to.y >= green.y };
}

/** What the caller may decide while a loop is planned. */
export interface RingOptions {
  /** Turn a loop down (the first one it takes is planned). */
  accept?: (ring: WallRing) => boolean;
  /** Choose the gate's slot among those a gate may take on this rectangle (-1 turns the rectangle down). Asked for at most `PICK_TRIES` rectangles. */
  pickGate?: (ring0: Omit<WallRing, 'gate'>, candidates: number[]) => number;
}

/** How many rectangles that fit the ground a gate is looked for on: moving the rectangle a little rarely changes what the gate can reach. */
const PICK_TRIES = 24;

/**
 * Plan the loop: the first rectangle (`ringRects`) whose every slot is on ground a wall may stand on. By default the gate goes on the side
 * the road comes in from, on the slot nearest the green; `pickGate` may choose it instead. Null when there is no such rectangle.
 */
export function planRing(pw: PlacementWorld, approach: { x: number; y: number } | null, opts: RingOptions = {}): WallRing | null {
  const green = pw.world.start.center;
  const { sideE, sideS } = gateSide(pw, approach);
  let picked = 0;
  for (const ring0 of ringRects(pw)) {
    const slots = ringSlots({ ...ring0, gate: 0 });
    let gate = -1;
    if (opts.pickGate) {
      if (picked >= PICK_TRIES) break;
      // every slot but one must take a wall, and that one a gate: the candidates are the slots a gate may take
      const wallOk = slots.map((s) => canPlace(pw, 'wall', s.x, s.y, s.rot).ok);
      const bad = wallOk.map((ok, i) => (ok ? -1 : i)).filter((i) => i >= 0);
      if (bad.length > 1) continue;
      const cands = slots.map((_, i) => i).filter((i) => (bad.length === 0 || bad[0] === i) && canPlace(pw, 'gate', slots[i].x, slots[i].y, slots[i].rot).ok);
      if (cands.length === 0) continue;
      picked++;
      gate = opts.pickGate(ring0, cands);
      if (gate < 0) continue;
    } else {
      let gd = Infinity;
      slots.forEach((s, i) => {
        const onSide = sideE !== null ? (sideE ? s.rot && s.x === ring0.x1 : s.rot && s.x === ring0.x0) : sideS ? !s.rot && s.y === ring0.y1 : !s.rot && s.y === ring0.y0;
        if (!onSide) return;
        const { w, d } = dims(s);
        const dd = Math.hypot(s.x + w / 2 - green.x, s.y + d / 2 - green.y);
        if (dd < gd) {
          gd = dd;
          gate = i;
        }
      });
      if (gate < 0) continue;
      if (!slots.every((s, i) => canPlace(pw, i === gate ? 'gate' : 'wall', s.x, s.y, s.rot).ok)) continue;
    }
    const ring = { ...ring0, gate };
    if (!opts.accept || opts.accept(ring)) return ring;
  }
  return null;
}

/** What a refused building says, turned into what is in the way. */
function blocker(reason: string): string {
  if (reason.includes('deep water')) return 'deep water, rock or paving';
  if (reason.includes('Blight')) return 'the Blight';
  if (reason.includes('building or field')) return 'other buildings or fields';
  if (reason.includes('doorway')) return 'a doorway';
  if (reason.includes('edge')) return 'the edge of the map';
  return 'rocks, trees or buildings';
}

/** Why there is no loop to plan, in words: nothing near enough fits, or what stands in the way of the best route. */
export function ringFailure(pw: PlacementWorld): string {
  const rects = ringRects(pw);
  if (rects.length === 0) return `The village has spread too far to be walled: a wall must stay within ${BUILD_RADIUS} tiles of the green.`;
  let bestN = Infinity;
  let bestWhy = '';
  for (const r of rects) {
    let n = 0;
    let why = '';
    for (const s of ringSlots({ ...r, gate: 0 })) {
      const c = canPlace(pw, 'wall', s.x, s.y, s.rot);
      if (!c.ok) {
        n++;
        why = why || c.reason;
      }
    }
    // a route that is clear but has no slot for a gate on the road side is stuck on that
    if (n === 0) return 'The gate has no place on the side the road comes in from: something stands in the way there.';
    if (n < bestN) {
      bestN = n;
      bestWhy = why;
    }
  }
  return `There is no room to run a wall right round the village: even the best route is blocked in ${bestN} ${bestN === 1 ? 'place' : 'places'} by ${blocker(bestWhy)}.`;
}

/** Whether a piece (of art `wall` or `gateway`) is a footprint of this kind at all (used by tests and the preview). */
export function slotFootprint(s: WallSlot, kind: BuildKind): { w: number; d: number } {
  return footprintOf(kind, s.rot);
}
