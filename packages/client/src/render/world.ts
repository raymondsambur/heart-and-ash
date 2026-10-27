/**
 * Renderer-side model of the static map plus the dynamic layers (buildings, Blight).
 * Pure data and lookups (unit tested); the renderer reads from it every frame.
 */
import { O, T, type BuildingDef, type ConView, type FloraTile, type GroundTile, type PlotDef } from '@hearth/shared';
import type { DecodedWorld } from './api';

/** Wall connection bits (tile-axis neighbours): NE = y-1, SE = x+1, SW = y+1, NW = x-1. */
export const W_NE = 1;
export const W_SE = 2;
export const W_SW = 4;
export const W_NW = 8;

export interface BuildingInfo {
  def: BuildingDef;
  /** Depth key used for painter sorting (front-most tile + bias). */
  depth: number;
}

export class WorldModel {
  readonly w: number;
  readonly h: number;
  readonly terrain: Uint8Array;
  readonly objects: Uint8Array;
  readonly blight: Uint8Array;
  buildings: BuildingInfo[] = [];
  plots: PlotDef[] = [];
  /** Plots with something under way, drawn like buildings (stakes and cord). */
  plotMarks: BuildingInfo[] = [];
  /** Called for every tile whose ground changed (the chunk painter repaints around it). */
  onTileChange: ((x: number, y: number) => void) | null = null;
  private readonly baseTerrain: Uint8Array;
  /** The map's own objects, so cut trees and picked bushes can be put back when the sim says they grew again. */
  private readonly baseObjects: Uint8Array;
  private flora: FloraTile[] = [];
  /** Roads worn by feet and grass where a road was (M6), tile to terrain: under the fields, over the map's own ground. */
  private worn = new Map<number, number>();
  private readonly baseFarm: number[] = [];
  private overlaid = new Map<number, number>();
  /** Building id + 1 per footprint tile, 0 where none. */
  readonly footprint: Int16Array;
  /** Distance to the nearest non-rock tile for Rock tiles (0 elsewhere), capped. */
  readonly rockDist: Uint8Array;
  readonly seed: number;
  readonly payload: DecodedWorld['payload'];

  constructor(world: DecodedWorld) {
    this.payload = world.payload;
    this.w = world.payload.w;
    this.h = world.payload.h;
    this.seed = world.payload.seed;
    this.terrain = world.terrain;
    this.baseTerrain = world.terrain.slice();
    for (let i = 0; i < this.baseTerrain.length; i++) if (this.baseTerrain[i] === T.Farm) this.baseFarm.push(i);
    this.objects = world.objects;
    this.baseObjects = world.objects.slice();
    this.blight = new Uint8Array(this.w * this.h);
    this.blight.set(world.blight.subarray(0, this.blight.length));
    this.footprint = new Int16Array(this.w * this.h);
    this.rockDist = computeRockDist(this.terrain, this.w, this.h);
  }

  /** Replace the building list (the sim sends it whole whenever it changes). */
  setBuildings(list: BuildingDef[]): void {
    this.footprint.fill(0);
    this.buildings = list.map((b) => ({ def: b, depth: b.x + b.w - 1 + (b.y + b.d - 1) + 0.9 }));
    for (const b of list)
      for (let yy = b.y; yy < b.y + b.d; yy++)
        for (let xx = b.x; xx < b.x + b.w; xx++) if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) this.footprint[yy * this.w + xx] = b.id + 1;
    this.buildings.sort((a, b) => a.depth - b.depth);
  }

  /**
   * The plots changed: field ground follows them. Cleared ground is bare dirt, ploughing turns it to furrows tile by tile, a
   * finished field is farmland, and farmland of the starting map that no plot covers any more (a field taken down) is grass.
   * The map's own grid is kept in `baseTerrain`; only tiles that differ are touched.
   */
  setPlots(list: PlotDef[]): void {
    this.plots = list;
    const w = this.w;
    const want = new Map<number, number>();
    const ground = (i: number): number => (this.baseTerrain[i] === T.Farm ? T.Grass : this.baseTerrain[i]);
    for (const [i, t] of this.worn) want.set(i, t);
    for (const i of this.baseFarm) want.set(i, T.Grass);
    this.plotMarks = [];
    for (const p of list) {
      const n = p.w * p.d;
      for (let k = 0; k < n; k++) {
        const x = p.x + (k % p.w);
        const y = p.y + ((k / p.w) | 0);
        if (x < 0 || y < 0 || x >= w || y >= this.h) continue;
        const i = y * w + x;
        want.set(i, plotGround(p.con, k / n, ground(i)));
      }
      if (p.con) this.plotMarks.push({ def: { id: 150000 + p.id, kind: 'yard', x: p.x, y: p.y, w: p.w, d: p.d, door: { x: p.x, y: p.y + p.d }, con: p.con }, depth: p.x + p.w - 1 + (p.y + p.d - 1) + 0.5 });
    }
    this.plotMarks.sort((a, b) => a.depth - b.depth);
    const touch = (i: number, v: number): void => {
      if (this.terrain[i] === v) return;
      this.terrain[i] = v;
      this.onTileChange?.(i % w, (i / w) | 0);
    };
    for (const i of this.overlaid.keys()) if (!want.has(i)) touch(i, this.baseTerrain[i]);
    for (const [i, v] of want) if (v !== this.baseTerrain[i] || this.overlaid.has(i)) touch(i, v);
    this.overlaid = new Map([...want].filter(([i, v]) => v !== this.baseTerrain[i]));
  }

  /** Roads worn by feet appear, and roads nobody walks any more grow over. */
  setGround(list: GroundTile[]): void {
    this.worn = new Map(list.map((g) => [g.i, g.t]));
    this.setPlots(this.plots);
  }

  /** The ground the village has changed: trees cut and bushes picked show as stumps, saplings and bare bushes until they grow back. */
  setFlora(list: FloraTile[]): void {
    for (const f of this.flora) this.objects[f.i] = this.baseObjects[f.i];
    this.flora = list;
    for (const f of list) if (f.i >= 0 && f.i < this.objects.length) this.objects[f.i] = f.code;
  }

  inb(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  terrainAt(x: number, y: number): number {
    return this.inb(x, y) ? this.terrain[y * this.w + x] : T.DeepWater;
  }

  objectAt(x: number, y: number): number {
    return this.inb(x, y) ? this.objects[y * this.w + x] : 0;
  }

  blightAt(x: number, y: number): number {
    return this.inb(x, y) ? this.blight[y * this.w + x] : 0;
  }

  /** Wall neighbours mask for the wall tile at (x, y). Towers/gates (building tiles) also connect. */
  wallMask(x: number, y: number): number {
    let m = 0;
    if (this.connects(x, y - 1)) m |= W_NE;
    if (this.connects(x + 1, y)) m |= W_SE;
    if (this.connects(x, y + 1)) m |= W_SW;
    if (this.connects(x - 1, y)) m |= W_NW;
    return m;
  }

  /** Neighbour mask for a palisade or fence tile: it connects to its own kind (a wall opening or building ends the run). */
  linkMask(x: number, y: number, code: number): number {
    let m = 0;
    if (this.objectAt(x, y - 1) === code) m |= W_NE;
    if (this.objectAt(x + 1, y) === code) m |= W_SE;
    if (this.objectAt(x, y + 1) === code) m |= W_SW;
    if (this.objectAt(x - 1, y) === code) m |= W_NW;
    return m;
  }

  private connects(x: number, y: number): boolean {
    if (!this.inb(x, y)) return false;
    const o = this.objects[y * this.w + x];
    return o === O.Wall || (o === O.Building && this.isWallBuilding(x, y));
  }

  private isWallBuilding(x: number, y: number): boolean {
    const id = this.footprint[y * this.w + x] - 1;
    if (id < 0) return false;
    const b = this.buildings.find((bi) => bi.def.id === id);
    return !!b && (b.def.kind === 'tower' || b.def.kind === 'gate');
  }
}

/** Manhattan-ish distance (8-connected chamfer) from every Rock tile to the nearest non-rock tile, capped at 15. */
export function computeRockDist(terrain: Uint8Array, w: number, h: number): Uint8Array {
  const d = new Uint8Array(w * h);
  const INF = 255;
  for (let i = 0; i < w * h; i++) d[i] = terrain[i] === T.Rock ? INF : 0;
  // two-pass chamfer (cost 1 for all 8 neighbours = Chebyshev distance)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      for (let oy = -1; oy <= 0; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (oy === 0 && ox >= 0) break;
          const nx = x + ox;
          const ny = y + oy;
          const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : d[ny * w + nx];
          if (v + 1 < m) m = v + 1;
        }
      d[i] = m;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      for (let oy = 0; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          if (oy === 0 && ox <= 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          const v = nx < 0 || ny < 0 || nx >= w || ny >= h ? 0 : d[ny * w + nx];
          if (v + 1 < m) m = v + 1;
        }
      d[i] = m > 15 ? 15 : m;
    }
  return d;
}

/** Ground of one tile of a field: `at` is its place (0..1) in the order the plot is worked, `ground` what lies there untouched. */
function plotGround(con: ConView | undefined, at: number, ground: number): number {
  if (!con) return T.Farm;
  const f = con.pct / 100;
  if (con.mode === 'rubble') return T.Dirt;
  // stages of a field: 0 cleared, 1 ploughed
  if (con.mode === 'build') {
    if (con.done === 0) return at < f ? T.Dirt : ground;
    return at < f ? T.Farm : T.Dirt;
  }
  // taking it down: the furrows go first, then the cleared ground itself
  if (con.done >= 2) return at < 1 - f ? T.Farm : T.Dirt;
  return at < 1 - f ? T.Dirt : ground;
}
