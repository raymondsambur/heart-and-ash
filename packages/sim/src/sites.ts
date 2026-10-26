/**
 * Sites: the concrete places actions resolve to (a house door, the store, the well, a stretch of forest, a field...). They are
 * derived from the map and the buildings, so they follow the village when M2 adds or removes buildings. The ids are stable
 * for a given map and building list, which lets people remember the sites they know.
 */
import { O, T, isPassable, reachableFrom, type BuildingDef, type PlaceKind, type PlotDef, type Point, type WorldData } from '@hearth/shared';
import type { Site } from './types';

/** Blight above this makes a place too dangerous to work at. */
const BLIGHT_LIMIT = 60;

export class SiteIndex {
  readonly sites: Site[] = [];
  private readonly byKind = new Map<PlaceKind, Site[]>();

  constructor(
    readonly world: WorldData,
    buildings: BuildingDef[],
    plots: PlotDef[],
  ) {
    const w = world;
    const { center, well } = w.start;
    const add = (kind: PlaceKind, x: number, y: number, extra: Partial<Site> = {}): void => {
      const s: Site = { id: this.sites.length, kind, x, y, ...extra };
      this.sites.push(s);
      const list = this.byKind.get(kind);
      if (list) list.push(s);
      else this.byKind.set(kind, [s]);
    };

    for (const b of buildings) {
      if (b.kind === 'house') add('home', b.door.x, b.door.y, { building: b.id });
      else if (b.kind === 'warehouse') add('store', b.door.x, b.door.y, { building: b.id });
      else if (b.kind === 'shrine') add('shrine', b.door.x, b.door.y, { building: b.id });
    }
    for (const p of plots) add('field', p.x + (p.w >> 1), p.y + (p.d >> 1), { plot: p.id });
    // The well is an object on the map; people stand on the plaza tile south of it.
    if (w.objects[well.y * w.w + well.x] === O.Well) add('water', well.x, well.y + 1);
    add('plaza', center.x - 2, center.y + 1);
    add('plaza', center.x + 2, center.y - 1);
    add('plaza', center.x, center.y + 2);

    const seen = reachableFrom(w, center.x + 1, center.y);
    const ok = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w.w && y < w.h && seen[y * w.w + x] === 1 && w.blight[y * w.w + x] < BLIGHT_LIMIT && isPassable(w, x, y);
    const near = (x: number, y: number, pred: (t: number, o: number) => boolean, r = 1): boolean => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) continue;
          if (pred(w.terrain[yy * w.w + xx], w.objects[yy * w.w + xx])) return true;
        }
      return false;
    };
    // Scan the map in strides so the sites are spread out; the order is fixed, so the ids are too.
    const scan = (kind: PlaceKind, stride: number, max: number, pred: (x: number, y: number) => boolean, minFromCentre = 0): void => {
      let n = 0;
      for (let y = 2; y < w.h - 2 && n < max; y += stride)
        for (let x = 2; x < w.w - 2 && n < max; x += stride) {
          // look for a qualifying tile inside the stride cell
          let found: Point | null = null;
          for (let dy = 0; dy < stride && !found; dy++)
            for (let dx = 0; dx < stride && !found; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (ok(xx, yy) && Math.hypot(xx - center.x, yy - center.y) >= minFromCentre && pred(xx, yy)) found = { x: xx, y: yy };
            }
          if (found) {
            add(kind, found.x, found.y);
            n++;
          }
        }
    };
    scan('stream', 7, 14, (x, y) => near(x, y, (t) => t === T.Water));
    scan('forest', 6, 60, (x, y) => near(x, y, (_t, o) => o === O.Oak || o === O.Pine) && w.terrain[y * w.w + x] !== T.Sand, 12);
    scan('quarry', 4, 14, (x, y) => near(x, y, (t, o) => t === T.Rock || o === O.Boulder));
    scan('meadow', 6, 30, (x, y) => (w.terrain[y * w.w + x] === T.Grass || w.terrain[y * w.w + x] === T.Plains) && near(x, y, (_t, o) => o === O.Flowers || o === O.Bush), 9);
    // Where people arrive from the Outside and where they leave to: the far end of the main street.
    for (let x = w.w - 4; x > center.x + 20; x--) {
      if (ok(x, center.y)) {
        add('edge', x, center.y);
        break;
      }
    }
  }

  ofKind(kind: PlaceKind): readonly Site[] {
    if (kind === 'water') return [...(this.byKind.get('water') ?? []), ...(this.byKind.get('stream') ?? [])];
    return this.byKind.get(kind) ?? [];
  }

  get(id: number): Site | undefined {
    return this.sites[id];
  }

  /** Nearest site of a kind among the ones `known` (all of them when `known` is null), by straight distance. */
  nearest(kind: PlaceKind, x: number, y: number, known: ReadonlySet<number> | null): Site | null {
    let best: Site | null = null;
    let bd = Infinity;
    for (const s of this.ofKind(kind)) {
      if (known && !known.has(s.id)) continue;
      const d = Math.abs(s.x - x) + Math.abs(s.y - y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Sites within `r` tiles (Chebyshev) of a point. */
  within(x: number, y: number, r: number): Site[] {
    return this.sites.filter((s) => Math.abs(s.x - x) <= r && Math.abs(s.y - y) <= r);
  }
}
