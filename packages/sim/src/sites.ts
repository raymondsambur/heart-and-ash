/**
 * Sites: the concrete places actions resolve to (a house door, the store, the well, a stretch of forest, a field...). They are
 * derived from the map and the buildings, so they follow the village when M2 adds or removes buildings. The ids are stable
 * for a given map and building list, which lets people remember the sites they know.
 */
import { O, T, isPassable, reachableFrom, type BuildingDef, type PlaceKind, type PlotDef, type Point, type WorldData } from '@hearth/shared';
import type { Site } from './types';

/** Blight above this makes a place too dangerous to work at. */
const BLIGHT_LIMIT = 60;

/** Site ids of what the village builds for itself (M2) start here, so they never collide with the ids of the map and the starting buildings. */
export const DYN_BUILDING_SITE = 100000;
export const DYN_PLOT_SITE = 150000;
export const DYN_ORDER_SITE = 200000;

/** What a finished building offers people. */
const BUILDING_SITE: Partial<Record<BuildingDef['kind'], PlaceKind>> = { house: 'home', warehouse: 'store', shrine: 'shrine', well: 'water' };

export class SiteIndex {
  /** The sites people can use right now: the map and the starting village, plus what has been built since. */
  sites: Site[] = [];
  private byKind = new Map<PlaceKind, Site[]>();
  private byId = new Map<number, Site>();
  /** The sites of the map and the starting village, in the order that fixes their ids (never reordered). */
  private fixed: Site[] = [];

  constructor(
    readonly world: WorldData,
    buildings: BuildingDef[],
    plots: PlotDef[],
    orders: readonly { id: number; door: Point }[] = [],
  ) {
    const w = world;
    const { center, well } = w.start;
    const add = (kind: PlaceKind, x: number, y: number, extra: Partial<Site> = {}): void => {
      const s: Site = { id: this.fixed.length, kind, x, y, ...extra };
      this.fixed.push(s);
    };

    // The ids of the first sites follow the starting village, so a saved person's list of known places stays valid.
    for (const b of w.start.buildings) {
      if (b.kind === 'house') add('home', b.door.x, b.door.y, { building: b.id });
      else if (b.kind === 'warehouse') add('store', b.door.x, b.door.y, { building: b.id });
      else if (b.kind === 'shrine') add('shrine', b.door.x, b.door.y, { building: b.id });
    }
    for (const p of w.start.plots) add('field', p.x + (p.w >> 1), p.y + (p.d >> 1), { plot: p.id });
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
    this.sync(buildings, plots, orders);
  }

  /**
   * Bring the usable sites in line with what stands now: a starting building or field that is gone, or being raised or taken
   * down, offers nothing; a building the village has finished offers what its kind does; every order has a work site.
   */
  sync(buildings: readonly BuildingDef[], plots: readonly PlotDef[], orders: readonly { id: number; door: Point }[]): void {
    const live = new Map(buildings.map((b) => [b.id, b]));
    const livePlots = new Map(plots.map((p) => [p.id, p]));
    const list: Site[] = [];
    for (const s of this.fixed) {
      let on = true;
      if (s.building !== undefined) {
        const b = live.get(s.building);
        on = !!b && !b.con;
      } else if (s.kind === 'field' && s.plot !== undefined) {
        const p = livePlots.get(s.plot);
        on = !!p && !p.con;
      }
      if (on) list.push(s);
    }
    const startIds = new Set(this.world.start.buildings.map((b) => b.id));
    const startPlots = new Set(this.world.start.plots.map((p) => p.id));
    for (const b of buildings) {
      if (startIds.has(b.id) || b.con) continue;
      const kind = BUILDING_SITE[b.kind];
      if (kind) list.push({ id: DYN_BUILDING_SITE + b.id, kind, x: b.door.x, y: b.door.y, building: b.id });
    }
    for (const p of plots) {
      if (startPlots.has(p.id) || p.con) continue;
      list.push({ id: DYN_PLOT_SITE + p.id, kind: 'field', x: p.x + (p.w >> 1), y: p.y + (p.d >> 1), plot: p.id });
    }
    for (const o of orders) list.push({ id: DYN_ORDER_SITE + o.id, kind: 'buildsite', x: o.door.x, y: o.door.y, order: o.id });
    this.sites = list;
    this.byKind = new Map();
    this.byId = new Map();
    for (const s of list) {
      this.byId.set(s.id, s);
      const k = this.byKind.get(s.kind);
      if (k) k.push(s);
      else this.byKind.set(s.kind, [s]);
    }
  }

  ofKind(kind: PlaceKind): readonly Site[] {
    if (kind === 'water') return [...(this.byKind.get('water') ?? []), ...(this.byKind.get('stream') ?? [])];
    return this.byKind.get(kind) ?? [];
  }

  /** A usable site by id (undefined for one that is gone). */
  get(id: number): Site | undefined {
    return this.byId.get(id);
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
