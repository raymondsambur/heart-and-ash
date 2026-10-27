/**
 * The living ground (M6): foragers pick from real bushes and flowers, woodcutters fell real trees, and what was picked or cut grows
 * back (nothing grows in winter). The map's objects are changed in place, so walking, building and the client all see the same
 * ground; `st.flora` remembers what differs from the map and how far along it is, `st.chops` the chops a tree has taken.
 */
import { FLORA, FORAGE_CODES, O, TREE_CODES, type FloraTile } from '@hearth/shared';
import type { Ctx } from './ctx';
import type { FloraEntry } from './types';

export interface Tile {
  x: number;
  y: number;
}

const idx = (c: Ctx, x: number, y: number): number => y * c.world.w + x;

/** A walkable tile next to an object (where a person stands to work at it), or null when it is walled in. */
export function standingTile(c: Ctx, x: number, y: number): Tile | null {
  const around: Tile[] = [
    { x, y: y + 1 },
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y - 1 },
    { x: x + 1, y: y + 1 },
    { x: x - 1, y: y + 1 },
  ];
  for (const t of around) if (c.open(t.x, t.y)) return t;
  return null;
}

/** The nearest tile within `reach` (Chebyshev) of a point that holds one of these objects and that a person could stand next to. */
export function nearestObject(c: Ctx, from: Tile, codes: ReadonlySet<number>, reach: number = FLORA.reach): Tile | null {
  const w = c.world.w;
  const h = c.world.h;
  let best: Tile | null = null;
  let bd = Infinity;
  for (let y = Math.max(1, from.y - reach); y <= Math.min(h - 2, from.y + reach); y++) {
    for (let x = Math.max(1, from.x - reach); x <= Math.min(w - 2, from.x + reach); x++) {
      if (!codes.has(c.world.objects[y * w + x])) continue;
      // blighted growth is dead and gives nothing
      if (c.world.blight[y * w + x] >= 130) continue;
      const d = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (d >= bd) continue;
      if (!standingTile(c, x, y)) continue;
      best = { x, y };
      bd = d;
    }
  }
  return best;
}

/** Any open grass or plains tile near a point with nothing on it: where people forage greens when no bush is near. */
export function grassNear(c: Ctx, from: Tile, reach = 14): Tile | null {
  const w = c.world.w;
  let best: Tile | null = null;
  let bd = Infinity;
  for (let y = Math.max(1, from.y - reach); y <= Math.min(c.world.h - 2, from.y + reach); y++) {
    for (let x = Math.max(1, from.x - reach); x <= Math.min(w - 2, from.x + reach); x++) {
      const i = y * w + x;
      const t = c.world.terrain[i];
      if ((t !== 2 && t !== 3) || c.world.objects[i] !== O.None || !c.open(x, y)) continue;
      const d = Math.abs(x - from.x) + Math.abs(y - from.y);
      // a little noise so people do not all pick the very same tile
      const score = d + ((x * 7 + y * 13 + c.day) % 5);
      if (score < bd) {
        best = { x, y };
        bd = score;
      }
    }
  }
  return best;
}

/** One chop at a tree. The last one fells it: the tile shows a stump from then on. Returns whether the tree fell. */
export function chopTree(c: Ctx, tile: Tile): boolean {
  const i = idx(c, tile.x, tile.y);
  const code = c.world.objects[i];
  if (!TREE_CODES.has(code)) return false;
  const left = (c.st.chops[i] ?? FLORA.chopsPerTree) - 1;
  if (left > 0) {
    c.st.chops[i] = left;
    return false;
  }
  delete c.st.chops[i];
  const e = c.st.flora.find((f) => f.i === i);
  if (e) {
    e.code = O.Stump;
    e.age = 0;
  } else c.st.flora.push({ i, code: O.Stump, was: code, age: 0 });
  c.world.objects[i] = O.Stump;
  return true;
}

/** Pick a bush clean (it shows bare until it bears again) or the flowers (they are gone until they bloom again). */
export function pickPlant(c: Ctx, tile: Tile): boolean {
  const i = idx(c, tile.x, tile.y);
  const code = c.world.objects[i];
  if (!FORAGE_CODES.has(code)) return false;
  const now = code === O.Bush ? O.BareBush : O.None;
  c.st.flora.push({ i, code: now, was: code, age: 0 });
  c.world.objects[i] = now;
  return true;
}

/** Something is built on these tiles: whatever was growing back there is cleared for good. */
export function clearFlora(c: Ctx, x: number, y: number, w: number, d: number): void {
  const inside = (i: number): boolean => {
    const tx = i % c.world.w;
    const ty = (i / c.world.w) | 0;
    return tx >= x && tx < x + w && ty >= y && ty < y + d;
  };
  // What was cut or picked here stays bare for good: the entry is kept (so the client does not bring the map's tree back) but no longer grows.
  for (const f of c.st.flora) {
    if (!inside(f.i)) continue;
    if (c.world.objects[f.i] !== O.Building) c.world.objects[f.i] = O.None;
    f.code = O.None;
    f.was = O.None;
  }
  for (const k of Object.keys(c.st.chops)) if (inside(Number(k))) delete c.st.chops[Number(k)];
}

/** A wall is run through trees and brush: they are cut where it goes (nothing is left of them, and they do not grow back). */
export function clearBrush(c: Ctx, x: number, y: number, w: number, d: number): void {
  for (let ty = y; ty < y + d; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const i = ty * c.world.w + tx;
      const o = c.world.objects[i];
      if (TREE_CODES.has(o) || o === O.Bush || o === O.Flowers || o === O.Reeds) {
        c.world.objects[i] = O.None;
        c.st.flora.push({ i, code: O.None, was: O.None, age: 0 });
        delete c.st.chops[i];
      }
    }
  }
}

/** Whether something stands or is being raised on a tile (so a tree does not grow back through it). */
function occupied(c: Ctx, i: number): boolean {
  const x = i % c.world.w;
  const y = (i / c.world.w) | 0;
  const inR = (r: { x: number; y: number; w: number; d: number }): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d;
  return c.st.buildings.some(inR) || c.st.plots.some(inR);
}

/** Once a day: what was cut or picked grows back, in the seasons when anything grows. */
export function floraDay(c: Ctx): void {
  if (c.season === 3 || c.st.flora.length === 0) return;
  const keep: FloraEntry[] = [];
  for (const f of c.st.flora) {
    f.age++;
    if (f.was === O.Bush || f.was === O.Flowers) {
      if (f.age >= FLORA.bushDays && !occupied(c, f.i)) {
        c.world.objects[f.i] = f.was;
        continue;
      }
    } else if (f.code === O.Stump && f.age >= FLORA.stumpDays) {
      f.code = O.Sapling;
      f.age = 0;
      c.world.objects[f.i] = O.Sapling;
    } else if (f.code === O.Sapling && f.age >= FLORA.saplingDays && !occupied(c, f.i)) {
      c.world.objects[f.i] = f.was;
      continue;
    }
    keep.push(f);
  }
  c.st.flora = keep;
}

/** Put the saved differences back on the map's objects (when a saved village is loaded). */
export function applyFlora(objects: Uint8Array, flora: readonly FloraTile[]): void {
  for (const f of flora) objects[f.i] = f.code;
}

/** What the client needs to show the living ground. */
export function floraView(flora: readonly FloraEntry[]): FloraTile[] {
  return flora.map((f) => ({ i: f.i, code: f.code, was: f.was }));
}
