/**
 * The village wall (M6), the sim's side: how far the loop is, and whether it is closed. The loop itself (its rectangle, its slots and
 * the order they are raised in) is planned in `shared/data/walls.ts`; here is what the finished pieces make of it.
 */
import { WALL_ARTS, ringProgress, type BuildingDef } from '@hearth/shared';
import type { Ctx } from './ctx';

const finishedWalls = (c: Ctx): BuildingDef[] => c.st.buildings.filter((b) => WALL_ARTS.has(b.kind) && !b.con);

/**
 * Do the finished wall pieces and the gate shut the village in? From the green, walk over every tile that is not a wall piece or the
 * gate's tiles (the gate counts as shut here: it is the one opening, and it is guarded); if the edge of the map cannot be reached the
 * loop is closed.
 */
export function isClosed(c: Ctx): boolean {
  const pieces = finishedWalls(c);
  if (!pieces.some((b) => b.kind === 'gateway')) return false;
  const w = c.world.w;
  const h = c.world.h;
  const blocked = new Uint8Array(w * h);
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
  return { ...p, closed: p.built >= p.total && isClosed(c) };
}
