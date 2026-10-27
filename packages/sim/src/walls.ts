/**
 * The village wall (M6), the sim's side: how far the loop is, and whether it is closed. The loop itself (its rectangle, its slots and
 * the order they are raised in) is planned in `shared/data/walls.ts`; here is what the finished pieces make of it.
 */
import { TERRAIN_INFO, WALL_ARTS, isPassable, ringProgress, ringSlots, type BuildingDef, type WallRing } from '@hearth/shared';
import type { Ctx } from './ctx';

const finishedWalls = (c: Ctx): BuildingDef[] => c.st.buildings.filter((b) => WALL_ARTS.has(b.kind) && !b.con);

/**
 * Do the finished wall pieces and the gate shut the village in? From the green, walk over every tile that is not a wall piece, the
 * gate's tiles (the gate counts as shut here: it is the one opening, and it is guarded) or ground nobody can cross (a stream, a cliff:
 * a wall that ends at one is as good as one that goes on); if the edge of the map cannot be reached the loop is closed.
 */
export function isClosed(c: Ctx): boolean {
  const pieces = finishedWalls(c);
  if (!pieces.some((b) => b.kind === 'gateway')) return false;
  const w = c.world.w;
  const h = c.world.h;
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < blocked.length; i++) if (!TERRAIN_INFO[c.world.terrain[i]].passable) blocked[i] = 1;
  for (const b of pieces) for (let y = b.y; y < b.y + b.d; y++) for (let x = b.x; x < b.x + b.w; x++) blocked[y * w + x] = 1;
  const start = c.world.start.center;
  const seen = new Uint8Array(w * h);
  const stack = [start.y * w + start.x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const x = cur % w;
    const y = (cur / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const i = (y + dy) * w + (x + dx);
      if (blocked[i] || seen[i]) continue;
      seen[i] = 1;
      stack.push(i);
    }
  }
  return true;
}

/** The loop's progress for the view: pieces up, pieces planned, the gate, and whether it is closed. Null before it is begun. */
export function wallState(c: Ctx): { built: number; total: number; gate: boolean; closed: boolean } | null {
  const ring = c.st.ring;
  if (!ring) return null;
  const p = ringProgress({ world: c.world, buildings: c.st.buildings, plots: c.st.plots }, ring);
  // Closed is what the finished pieces and the ground make of it: a stream or a cliff can stand in for a piece the builders cannot reach.
  return { ...p, closed: isClosed(c) };
}

/** The kinds of place the village works at outside its walls. */
const OUTSIDE_KINDS = ['forest', 'quarry', 'meadow', 'stream', 'edge'] as const;

/**
 * Would a wall on this ring leave the village able to reach what it works at outside? Walk from the tiles outside the gate over everything
 * a person can cross, with the pieces of the ring (and the gate's own tiles) in the way: the forests, quarries, meadows, streams and the
 * road out that lie outside the ring must still be reached, or the loop would shut the village off from the other side of a stream.
 */
export function keepsOutsideOpen(c: Ctx, ring: WallRing): boolean {
  const w = c.world;
  const slots = ringSlots(ring);
  const blocked = new Uint8Array(w.w * w.h);
  for (const s of slots) for (let i = 0; i < 4; i++) blocked[(s.rot ? s.y + i : s.y) * w.w + (s.rot ? s.x : s.x + i)] = 1;
  const g = slots[ring.gate];
  const out = g.rot ? (g.x === ring.x1 ? [1, 0] : [-1, 0]) : g.y === ring.y1 ? [0, 1] : [0, -1];
  const stack: number[] = [];
  const seen = new Uint8Array(w.w * w.h);
  for (let i = 0; i < 4; i++) {
    const x = (g.rot ? g.x : g.x + i) + out[0];
    const y = (g.rot ? g.y + i : g.y) + out[1];
    if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
    const k = y * w.w + x;
    if (!blocked[k] && !seen[k] && isPassable(w, x, y)) {
      seen[k] = 1;
      stack.push(k);
    }
  }
  while (stack.length) {
    const cur = stack.pop()!;
    const x = cur % w.w;
    const y = (cur / w.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const k = ny * w.w + nx;
      if (seen[k] || blocked[k] || !isPassable(w, nx, ny)) continue;
      seen[k] = 1;
      stack.push(k);
    }
  }
  let total = 0;
  let reached = 0;
  for (const kind of OUTSIDE_KINDS) {
    let n = 0;
    let r = 0;
    for (const s of c.sites.ofKind(kind)) {
      if (s.x >= ring.x0 && s.x <= ring.x1 && s.y >= ring.y0 && s.y <= ring.y1) continue;
      n++;
      if (seen[s.y * w.w + s.x]) r++;
    }
    if (n > 0 && r === 0) return false;
    total += n;
    reached += r;
  }
  return total === 0 || reached / total >= 0.85;
}

/** How much a trip to each kind of place outside the walls counts for in choosing the gate. */
const TRIP_WEIGHT: Record<(typeof OUTSIDE_KINDS)[number], number> = { meadow: 1.5, forest: 1.2, stream: 1, edge: 1, quarry: 0.7 };

/**
 * The gate's slot: of the slots a gate may take, the one that makes the shortest trips, on average, from the green out through the gate to
 * the forests, meadows, streams, quarries and the road out that lie outside the walls (a stream that the gate does not reach counts as far
 * away). A slot that leaves a whole kind of place unreachable, or most places, is not taken. -1 when there is none.
 */
export function bestGate(c: Ctx, ring0: Omit<WallRing, 'gate'>, candidates: number[]): number {
  const w = c.world;
  const ring: WallRing = { ...ring0, gate: 0 };
  const slots = ringSlots(ring);
  const blocked = new Uint8Array(w.w * w.h);
  for (const s of slots) for (let i = 0; i < 4; i++) blocked[(s.rot ? s.y + i : s.y) * w.w + (s.rot ? s.x : s.x + i)] = 1;
  const outside: { x: number; y: number; weight: number; kind: string }[] = [];
  for (const kind of OUTSIDE_KINDS) for (const s of c.sites.ofKind(kind)) if (!(s.x >= ring0.x0 && s.x <= ring0.x1 && s.y >= ring0.y0 && s.y <= ring0.y1)) outside.push({ x: s.x, y: s.y, weight: TRIP_WEIGHT[kind], kind });
  const green = c.world.start.center;
  const dist = new Int32Array(w.w * w.h);
  let best = -1;
  let bestCost = Infinity;
  for (const i of candidates) {
    const g = slots[i];
    const out = g.rot ? (g.x === ring0.x1 ? [1, 0] : [-1, 0]) : g.y === ring0.y1 ? [0, 1] : [0, -1];
    dist.fill(-1);
    const queue: number[] = [];
    for (let k = 0; k < 4; k++) {
      const x = (g.rot ? g.x : g.x + k) + out[0];
      const y = (g.rot ? g.y + k : g.y) + out[1];
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
      const idx = y * w.w + x;
      if (!blocked[idx] && dist[idx] < 0 && isPassable(w, x, y)) {
        dist[idx] = 0;
        queue.push(idx);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const cur = queue[h];
      const x = cur % w.w;
      const y = (cur / w.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
        const k = ny * w.w + nx;
        if (dist[k] >= 0 || blocked[k] || !isPassable(w, nx, ny)) continue;
        dist[k] = dist[cur] + 1;
        queue.push(k);
      }
    }
    const inner = Math.abs(g.x - green.x) + Math.abs(g.y - green.y);
    let total = 0;
    let weight = 0;
    let reached = 0;
    const kinds = new Map<string, number>();
    for (const o of outside) {
      const d = dist[o.y * w.w + o.x];
      const ok = d >= 0;
      if (ok) reached++;
      kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + (ok ? 1 : 0));
      total += o.weight * (inner + (ok ? d : 250));
      weight += o.weight;
    }
    if (outside.length > 0 && (reached / outside.length < 0.85 || [...kinds.values()].some((n) => n === 0))) continue;
    const cost = weight > 0 ? total / weight : inner;
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}
