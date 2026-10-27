/**
 * Where a building should go when nobody has pointed at the ground: the choice a standing rule makes for the manager. Each kind of
 * building has its own idea of a good place, scored from what already stands: fields huddle together out of the square, houses
 * gather near the green and each other, watch posts and walls face the road the raiders come along, a second well sits among the
 * houses and away from the first, and so on. Pure, so the sim and the soak's scripted manager use the same one.
 */
import { BLUEPRINTS, BUILD_RADIUS, canPlace, footprintOf, type BuildKind, type PlaceWorld } from './blueprints';
import type { BuildingDef, PlotDef } from '../terrain';
import { planRing, reservedSlots, wallCandidates, type WallRing } from './walls';

export interface Placement {
  x: number;
  y: number;
  /** A wall laid the other way (one tile wide, four deep). */
  rot: boolean;
  /** Lower is better. */
  cost: number;
}

export interface PlacementWorld extends PlaceWorld {
  buildings: readonly BuildingDef[];
  plots: readonly PlotDef[];
  /** The map's own well is an object, not a building: when the world carries it, a second well keeps its distance from it. */
  world: PlaceWorld['world'] & { start: PlaceWorld['world']['start'] & { well?: { x: number; y: number } } };
}

export interface PlacementHints {
  /** Where trouble comes from (the far end of the main street); east of the green when not given. */
  approach?: { x: number; y: number } | null;
  /** The wall's planned loop, once there is one (walls and gates follow it). */
  ring?: WallRing | null;
}

/** How near the green a thing may stand: the plaza and the well keep clear. */
const MIN_FROM_GREEN: Partial<Record<BuildKind, number>> = { field: 9, wall: 8, watchpost: 10 };
const DEFAULT_MIN = 5;
/** Kinds that go inside the wall when there is room (a penalty keeps them out of the open otherwise). */
const INSIDE_THE_WALL: ReadonlySet<BuildKind> = new Set(['house', 'well', 'warehouse', 'workshop', 'shrine']);

interface Pt {
  x: number;
  y: number;
}
const mid = (r: { x: number; y: number; w: number; d: number }): Pt => ({ x: r.x + r.w / 2, y: r.y + r.d / 2 });
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const nearest = (list: readonly Pt[], p: Pt): number => list.reduce((m, q) => Math.min(m, dist(p, q)), Infinity);
const centroid = (list: readonly Pt[], fallback: Pt): Pt => (list.length ? { x: list.reduce((s, p) => s + p.x, 0) / list.length, y: list.reduce((s, p) => s + p.y, 0) / list.length } : fallback);

/** The best places for a kind of building, best first (at most `limit`). Empty when there is no room. */
export function placementsFor(pw0: PlacementWorld, kind: BuildKind, hints: PlacementHints = {}, limit = 8): Placement[] {
  let pw = pw0;
  // The wall is one loop with a gate, planned as a whole: its pieces are not scored one by one.
  if (kind === 'wall' || kind === 'gate') {
    const ring = hints.ring ?? planRing(pw, hints.approach ?? null);
    if (!ring) return [];
    return wallCandidates(pw, kind, ring).slice(0, limit).map((s, i) => ({ x: s.x, y: s.y, rot: s.rot, cost: i }));
  }
  // The empty slots of the wall are kept free of everything else.
  if (hints.ring) pw = { ...pw0, buildings: [...pw0.buildings, ...reservedSlots(pw0, hints.ring)] as unknown as PlacementWorld['buildings'] };
  const { world, buildings, plots } = pw;
  const bp = BLUEPRINTS[kind];
  const green: Pt = world.start.center;
  const approach: Pt = hints.approach ?? { x: green.x + 40, y: green.y };
  const ofArt = (art: string): Pt[] => buildings.filter((b) => b.kind === art).map(mid);
  const houses = ofArt('house');
  const fields = plots.filter((p) => p.kind === 'field').map(mid);
  const posts = ofArt(BLUEPRINTS.watchpost.art);
  const shrines = ofArt(BLUEPRINTS.shrine.art);
  const stores = ofArt(BLUEPRINTS.warehouse.art);
  const wells = [...ofArt(BLUEPRINTS.well.art), ...(world.start.well ? [world.start.well] : [])];
  const rects: { x: number; y: number; w: number; d: number; isWall: boolean }[] = [...buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, d: b.d, isWall: b.kind === BLUEPRINTS.wall.art })), ...plots.map((p) => ({ x: p.x, y: p.y, w: p.w, d: p.d, isWall: false }))];
  const homes = centroid([...houses, ...fields], green);
  const houseHub = centroid(houses, green);
  const minFrom = MIN_FROM_GREEN[kind] ?? DEFAULT_MIN;
  const out: Placement[] = [];

  for (const rot of bp.rotates ? [false, true] : [false]) {
    const { w, d } = footprintOf(kind, rot);
    // A tile of room around everything, so doors and paths stay clear.
    const roomy = (x: number, y: number): boolean => !rects.some((r) => x - 1 < r.x + r.w && x + w + 1 > r.x && y - 1 < r.y + r.d && y + d + 1 > r.y);
    for (let y = Math.round(green.y) - BUILD_RADIUS; y <= Math.round(green.y) + BUILD_RADIUS; y++) {
      for (let x = Math.round(green.x) - BUILD_RADIUS; x <= Math.round(green.x) + BUILD_RADIUS; x++) {
        const p: Pt = { x: x + w / 2, y: y + d / 2 };
        const r = Math.max(Math.abs(p.x - green.x), Math.abs(p.y - green.y));
        if (r < minFrom) continue;
        if (!canPlace(pw, kind, x, y, rot).ok || !roomy(x, y)) continue;
        let blight = 0;
        for (let ty = y; ty < y + d; ty++) for (let tx = x; tx < x + w; tx++) blight += world.blight[ty * world.w + tx];
        let cost = (blight / (w * d)) * 0.1;
        const toApproach = dist(p, approach);
        switch (kind) {
          case 'house':
            cost += Math.abs(r - 8) + Math.max(0, nearest(houses, p) - 4) * 0.8 + (nearest(fields, p) < 5 ? 6 : 0);
            break;
          case 'field':
            cost += 0.5 * Math.abs(r - 13) + Math.max(0, nearest(fields, p) - 6) * 1.5;
            break;
          case 'well':
            cost += dist(p, houseHub) + Math.max(0, 10 - nearest(wells, p)) * 4;
            break;
          case 'warehouse':
            cost += Math.abs(r - 7) + 0.4 * dist(p, homes) + (nearest(stores, p) < 8 ? 8 : 0);
            break;
          case 'workshop':
            cost += Math.abs(r - 10) + 0.5 * Math.min(40, nearest(stores, p)) + (nearest(houses, p) < 4 ? 4 : 0);
            break;
          case 'shrine':
            cost += Math.abs(r - 12) + Math.max(0, 8 - nearest(shrines, p)) * 3;
            break;
          case 'watchpost':
            cost += Math.abs(r - 17) + 0.7 * toApproach + Math.max(0, 10 - nearest(posts, p)) * 3;
            break;
        }
        // Once the wall is planned, what the village needs to keep safe goes inside it when there is room; fields and posts may stand outside.
        const ring = hints.ring;
        const inside = !ring || (x > ring.x0 + 1 && x + w - 1 < ring.x1 - 1 && y > ring.y0 + 1 && y + d - 1 < ring.y1 - 1);
        if (!inside && INSIDE_THE_WALL.has(kind)) cost += 40;
        out.push({ x, y, rot, cost: Math.round(cost * 100) / 100 });
      }
    }
  }
  out.sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
  return out.slice(0, limit);
}
