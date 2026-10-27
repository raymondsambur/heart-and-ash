/**
 * What the village can build (docs/notes/balance-v0.md, section 5), as data: footprint, labour, the stages it goes through and
 * the materials each stage needs. The sim runs the orders from this table; the client reads the same table to draw the stage a
 * building is in and to preview a placement, so it holds no rules of its own.
 *
 * Labour is in person-hours of a builder at skill 4. A builder of skill `s` brings `skillSpeed(s) / skillSpeed(4)` units an hour.
 * Materials must be delivered to the plot before the stage that uses them starts.
 */
import type { Good } from './goods';
import { skillSpeed } from './skills';
import { O, T, type BuildingDef, type BuildingKind, type PlotDef, type WorldData } from '../terrain';

export const BUILD_KINDS = ['house', 'field', 'well', 'warehouse', 'workshop', 'shrine', 'watchpost', 'wall'] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];

/** `cleared`: the ground is dug and staked; `ploughed` is the last stage of a field. */
export type StageId = 'cleared' | 'foundation' | 'frame' | 'walls' | 'roof' | 'ploughed';

export interface StageDef {
  id: StageId;
  /** Share of the blueprint's labour. */
  share: number;
  /** Materials that must be on the plot before this stage starts, and are built into it. */
  needs: Partial<Record<Good, number>>;
}

export interface Blueprint {
  kind: BuildKind;
  /** The building kind the art draws (a field is a plot, not a building). */
  art: BuildingKind | 'field';
  label: string;
  blurb: string;
  w: number;
  d: number;
  /** A wall can be laid along either axis. */
  rotates?: boolean;
  labour: number;
  stages: StageDef[];
}

const st = (id: StageId, share: number, needs: Partial<Record<Good, number>> = {}): StageDef => ({ id, share, needs });

export const BLUEPRINTS: Record<BuildKind, Blueprint> = {
  house: {
    kind: 'house',
    art: 'house',
    label: 'House',
    blurb: 'Sleeps four. Villagers want a roof of their own.',
    w: 3,
    d: 3,
    labour: 120,
    stages: [st('cleared', 0.05), st('foundation', 0.15, { stone: 12 }), st('frame', 0.25, { planks: 12 }), st('walls', 0.3, { planks: 12 }), st('roof', 0.25, { planks: 6, thatch: 6 })],
  },
  field: {
    kind: 'field',
    art: 'field',
    label: 'Field',
    blurb: 'Cleared and ploughed; people sow and harvest it.',
    w: 5,
    d: 5,
    labour: 20,
    stages: [st('cleared', 0.4), st('ploughed', 0.6)],
  },
  well: {
    kind: 'well',
    art: 'well',
    label: 'Well',
    blurb: 'Clean water close to the houses.',
    w: 1,
    d: 1,
    labour: 30,
    stages: [st('cleared', 0.1), st('foundation', 0.4, { stone: 10 }), st('walls', 0.3, { stone: 10 }), st('roof', 0.2)],
  },
  warehouse: {
    kind: 'warehouse',
    art: 'warehouse',
    label: 'Storehouse',
    blurb: 'Another door to the village store.',
    w: 4,
    d: 3,
    labour: 100,
    stages: [st('cleared', 0.05), st('foundation', 0.15, { stone: 10 }), st('frame', 0.25, { planks: 16 }), st('walls', 0.3, { planks: 16 }), st('roof', 0.25, { planks: 8 })],
  },
  workshop: {
    kind: 'workshop',
    art: 'workshop',
    label: 'Workshop',
    blurb: 'A place to make tools and cloth.',
    w: 3,
    d: 3,
    labour: 140,
    stages: [st('cleared', 0.05), st('foundation', 0.15, { stone: 20 }), st('frame', 0.25, { planks: 20 }), st('walls', 0.3, { planks: 20 }), st('roof', 0.25, { planks: 10 })],
  },
  shrine: {
    kind: 'shrine',
    art: 'shrine',
    label: 'Shrine',
    blurb: 'A quiet place; people pray and marry here.',
    w: 2,
    d: 2,
    labour: 80,
    stages: [st('cleared', 0.05), st('foundation', 0.2, { stone: 25 }), st('frame', 0.25, { planks: 5 }), st('walls', 0.25, { planks: 5 }), st('roof', 0.25, { planks: 5 })],
  },
  watchpost: {
    kind: 'watchpost',
    art: 'watchpost',
    label: 'Watch post',
    blurb: 'A tower to look out from.',
    w: 2,
    d: 2,
    labour: 70,
    stages: [st('cleared', 0.05), st('foundation', 0.2, { stone: 10 }), st('frame', 0.25, { planks: 10 }), st('walls', 0.25, { planks: 10 }), st('roof', 0.25, { planks: 10 })],
  },
  wall: {
    kind: 'wall',
    art: 'wall',
    label: 'Wall segment',
    blurb: 'Four tiles of stone wall. People cannot walk through it.',
    w: 4,
    d: 1,
    rotates: true,
    labour: 60,
    stages: [st('cleared', 0.1), st('foundation', 0.3, { stone: 8 }), st('walls', 0.4, { stone: 8 }), st('roof', 0.2, { planks: 8 })],
  },
};

/** What a stage looks like in words ("laying the foundation"). */
export const STAGE_TEXT: Record<StageId, string> = {
  cleared: 'clearing the ground',
  foundation: 'laying the foundation',
  frame: 'raising the frame',
  walls: 'putting up the walls',
  roof: 'roofing',
  ploughed: 'ploughing',
};

export function isBuildKind(k: unknown): k is BuildKind {
  return typeof k === 'string' && (BUILD_KINDS as readonly string[]).includes(k);
}

/** The blueprint of a building kind (null for kinds the village cannot build). */
export function blueprintOfKind(kind: string): Blueprint | null {
  return isBuildKind(kind) ? BLUEPRINTS[kind] : null;
}

/** Labour (units) of one stage of a build. */
export function stageWork(bp: Blueprint, i: number): number {
  return bp.labour * (bp.stages[i]?.share ?? 0);
}

/** Pulling a stage down takes 40% of what raising it took. */
export const DEMOLISH_LABOUR = 0.4;
/** Clearing the rubble of a finished building, as a share of its build labour (at least `MIN_CLEAR_WORK`). */
export const CLEAR_SHARE = 0.05;
export const MIN_CLEAR_WORK = 2;
export function clearWork(bp: Blueprint): number {
  return Math.max(MIN_CLEAR_WORK, bp.labour * CLEAR_SHARE);
}

/** What comes back of a good when a stage is taken down: half, and less of what spoils or splinters. */
export function refundRate(good: Good): number {
  return good === 'planks' || good === 'thatch' ? 0.3 : 0.5;
}

/** Work units an hour from a builder of this skill level. */
export function buildRate(skillLevel: number): number {
  return skillSpeed(skillLevel) / skillSpeed(4);
}

/** Materials of the stages up to and including stage `i` (what must have been delivered to work on stage `i`). */
export function needsThrough(bp: Blueprint, i: number): Partial<Record<Good, number>> {
  const out: Partial<Record<Good, number>> = {};
  for (let k = 0; k <= i && k < bp.stages.length; k++) for (const [g, n] of Object.entries(bp.stages[k].needs) as [Good, number][]) out[g] = (out[g] ?? 0) + n;
  return out;
}

export function totalNeeds(bp: Blueprint): Partial<Record<Good, number>> {
  return needsThrough(bp, bp.stages.length - 1);
}

/** Size of a footprint, turned for a wall laid the other way. */
export function footprintOf(kind: BuildKind, rot: boolean): { w: number; d: number } {
  const bp = BLUEPRINTS[kind];
  return rot && bp.rotates ? { w: bp.d, d: bp.w } : { w: bp.w, d: bp.d };
}

/** The tile in front of a building, where people go in and where builders stand. */
export function doorTile(x: number, y: number, w: number, d: number): { x: number; y: number } {
  return { x: x + (w >> 1), y: y + d };
}

// ---------------------------------------------------------------------------------------------------
// Where things may be put
// ---------------------------------------------------------------------------------------------------

/** How far from the village green orders are accepted (the playable area is a bit larger than the cleared ground). */
export const BUILD_RADIUS = 30;
/** Blight density above which nothing is raised. */
export const BUILD_BLIGHT_LIMIT = 60;
/** At most this many orders at once. */
export const MAX_ORDERS = 24;

const OK_TERRAIN: ReadonlySet<number> = new Set([T.Grass, T.Plains, T.Dirt, T.Sand, T.Hill, T.Forest, T.Farm]);

export type PlaceCheck = { ok: true; w: number; d: number; door: { x: number; y: number } } | { ok: false; reason: string };

export interface PlaceWorld {
  world: Pick<WorldData, 'w' | 'h' | 'terrain' | 'objects' | 'blight'> & { start: Pick<WorldData['start'], 'center'> };
  buildings: readonly Pick<BuildingDef, 'x' | 'y' | 'w' | 'd' | 'door'>[];
  plots: readonly Pick<PlotDef, 'x' | 'y' | 'w' | 'd'>[];
}

const inRect = (r: { x: number; y: number; w: number; d: number }, x: number, y: number): boolean => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.d;

/**
 * Can this be put here? Pure, and the same on the client (to colour the preview) and in the sim (which checks again). Rules:
 * on open, buildable ground inside the radius, clear of other buildings and plots, off the Blight, not on a door, with the
 * tile in front free to walk on. (The sim also checks the front tile can be reached from the village green.)
 */
export function canPlace(pw: PlaceWorld, kind: BuildKind, x: number, y: number, rot = false): PlaceCheck {
  const { world, buildings, plots } = pw;
  const { w, d } = footprintOf(kind, rot);
  const door = doorTile(x, y, w, d);
  const covered = (tx: number, ty: number): boolean => buildings.some((b) => inRect(b, tx, ty)) || plots.some((p) => inRect(p, tx, ty));
  // An object that is a building tile of the starting village no longer counts once nothing stands there.
  const objectFree = (tx: number, ty: number): boolean => {
    const o = world.objects[ty * world.w + tx];
    return o === O.None || (o === O.Building && !buildings.some((b) => inRect(b, tx, ty)));
  };
  const c = world.start.center;
  for (let ty = y; ty < y + d; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (tx < 1 || ty < 1 || tx >= world.w - 1 || ty >= world.h - 1) return { ok: false, reason: 'Too close to the edge of the map.' };
      if (Math.max(Math.abs(tx - c.x), Math.abs(ty - c.y)) > BUILD_RADIUS) return { ok: false, reason: 'Too far from the village.' };
      const i = ty * world.w + tx;
      if (!OK_TERRAIN.has(world.terrain[i])) return { ok: false, reason: 'The ground is not fit to build on (water, rock, road or paving).' };
      if (!objectFree(tx, ty)) return { ok: false, reason: 'Something is in the way (a tree, a rock or a building).' };
      if (world.blight[i] > BUILD_BLIGHT_LIMIT) return { ok: false, reason: 'The Blight lies too thick here.' };
      if (covered(tx, ty)) return { ok: false, reason: 'Another building or field is already here.' };
      if (buildings.some((b) => b.door.x === tx && b.door.y === ty)) return { ok: false, reason: 'It would block a doorway.' };
    }
  }
  // The way in: the tile in front must be open ground that nothing covers.
  if (door.x < 1 || door.y < 1 || door.x >= world.w - 1 || door.y >= world.h - 1) return { ok: false, reason: 'No room in front for the door.' };
  const di = door.y * world.w + door.x;
  if (!(world.terrain[di] !== T.DeepWater && world.terrain[di] !== T.Water && world.terrain[di] !== T.Rock) || !objectFree(door.x, door.y) || covered(door.x, door.y)) return { ok: false, reason: 'The tile in front must be open ground to walk on.' };
  return { ok: true, w, d, door };
}
