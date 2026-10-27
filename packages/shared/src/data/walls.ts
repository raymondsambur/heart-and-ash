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
 * Plan the loop: a rectangle around everything the village has (with a margin), a whole number of pieces on each side, every
 * slot on ground a wall may stand on, inside what may be built. The gate goes on the side the road comes in from. Null when
 * there is no such rectangle.
 */
export function planRing(pw: PlacementWorld, approach: { x: number; y: number } | null): WallRing | null {
  const green = pw.world.start.center;
  const rects = [...pw.buildings.filter((b) => !(b.kind !== undefined && WALL_ARTS.has(b.kind))), ...pw.plots];
  if (rects.length === 0) return null;
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
  const to = approach ?? { x: green.x + 40, y: green.y };
  const east = Math.abs(to.x - green.x) >= Math.abs(to.y - green.y);
  const sideE = east ? to.x >= green.x : null;
  const sideS = east ? null : to.y >= green.y;
  const order = (n: number): number[] => [0, ...Array.from({ length: n }, (_, k) => [k + 1, -(k + 1)]).flat()];
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
        const ring0 = { x0: bx + dx, y0: by + dy, x1: bx + dx + width - 1, y1: by + dy + height - 1 };
        // inside what may be built, and round everything the village has
        if (Math.max(Math.abs(ring0.x0 - green.x), Math.abs(ring0.x1 - green.x), Math.abs(ring0.y0 - green.y), Math.abs(ring0.y1 - green.y)) > BUILD_RADIUS - 1) continue;
        if (ring0.x0 > bx0 - 2 || ring0.y0 > by0 - 2 || ring0.x1 < bx1 + 2 || ring0.y1 < by1 + 2) continue;
        // the gate's slot: on the side the road comes from, the one nearest the green's row or column
        const probe: WallRing = { ...ring0, gate: 0 };
        const slots = ringSlots(probe);
        let gate = -1;
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
        const ring: WallRing = { ...ring0, gate };
        const ok = slots.every((s, i) => canPlace(pw, i === gate ? 'gate' : 'wall', s.x, s.y, s.rot).ok);
        if (ok) return ring;
      }
    }
  }
  return null;
}

/** Whether a piece (of art `wall` or `gateway`) is a footprint of this kind at all (used by tests and the preview). */
export function slotFootprint(s: WallSlot, kind: BuildKind): { w: number; d: number } {
  return footprintOf(kind, s.rot);
}
