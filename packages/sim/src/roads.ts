/**
 * Roads that nobody ordered (M6): a tile people keep walking over is worn into a dirt road, and a road nobody walks any more grows
 * over again. Every step a person takes counts as traffic on the tile it ends on; once a day the traffic fades a little, a busy tile
 * becomes a road and a road that has been quiet for a while is given back to the grass. A road is faster to walk on, so people
 * choose it, which keeps it busy. The terrain is changed in place (so walking and building see it), `st.ground` remembers what
 * differs from the map, and the client paints the same list.
 */
import { BAL, T, type GroundTile } from '@hearth/shared';
import type { Ctx } from './ctx';

/** What a road may be made of: open ground, not water, rock, paving, a bridge or a field. */
const WORN_FROM: ReadonlySet<number> = new Set([T.Grass, T.Plains, T.Forest, T.Sand, T.Hill]);

/** A person has arrived on a tile. */
export function walked(c: Ctx, x: number, y: number): void {
  c.st.traffic[y * c.world.w + x] += 1;
}

function covered(c: Ctx, i: number): boolean {
  const x = i % c.world.w;
  const y = (i / c.world.w) | 0;
  const inR = (r: { x: number; y: number; w: number; d: number }): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d;
  return c.st.buildings.some(inR) || c.st.plots.some(inR);
}

function setTerrain(c: Ctx, i: number, t: number): void {
  c.world.terrain[i] = t;
  if (t === c.baseTerrain[i]) delete c.st.ground[i];
  else c.st.ground[i] = t;
}

/** Once a day: traffic fades, busy tiles become roads, quiet roads go back to grass. */
export function roadsDay(c: Ctx): void {
  const R = BAL.roads;
  const tr = c.st.traffic;
  const quiet = c.st.quiet;
  for (let i = 0; i < tr.length; i++) {
    if (tr[i] === 0 && quiet[i] === 0) continue;
    let v = tr[i] * R.decay;
    if (v < 0.3) v = 0;
    tr[i] = v;
    const t = c.world.terrain[i];
    if (t === T.Dirt) {
      quiet[i] = v < R.off ? Math.min(255, quiet[i] + 1) : 0;
      if (quiet[i] >= R.quietDays && !covered(c, i)) {
        // a road of the map's own goes back to grass; one that was worn goes back to what it was
        setTerrain(c, i, c.baseTerrain[i] === T.Dirt ? T.Grass : c.baseTerrain[i]);
        quiet[i] = 0;
      }
    } else if (v >= R.on && WORN_FROM.has(t) && !covered(c, i) && c.world.objects[i] === 0) {
      setTerrain(c, i, T.Dirt);
      quiet[i] = 0;
    }
  }
}

/** Something is built on these tiles: the road under it is gone (the tile is given back to what the map had). */
export function clearRoads(c: Ctx, x: number, y: number, w: number, d: number): void {
  for (let ty = y; ty < y + d; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const i = ty * c.world.w + tx;
      if (c.st.ground[i] === undefined) continue;
      setTerrain(c, i, c.baseTerrain[i]);
      c.st.traffic[i] = 0;
      c.st.quiet[i] = 0;
    }
  }
}

/** The tiles whose ground differs from the map, in tile order, for the client. */
export function groundView(ground: Record<number, number>): GroundTile[] {
  return Object.keys(ground).map((k) => ({ i: Number(k), t: ground[Number(k)] }));
}

/** Put the saved ground back on the map (when a saved village is loaded). */
export function applyGround(terrain: Uint8Array, ground: Record<number, number>): void {
  for (const k of Object.keys(ground)) terrain[Number(k)] = ground[Number(k)];
}

/** What is saved of the traffic: the tiles with any, as [tile, traffic, quiet days]. */
export function trafficRows(traffic: Float32Array, quiet: Uint8Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < traffic.length; i++) if (traffic[i] > 0 || quiet[i] > 0) out.push([i, traffic[i], quiet[i]]);
  return out;
}
