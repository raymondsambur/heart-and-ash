/** Terrain and object codes stored in the world grids (one byte per tile). */

export const T = {
  DeepWater: 0,
  Water: 1,
  Grass: 2,
  Plains: 3,
  Forest: 4,
  Dirt: 5,
  Road: 6,
  Plaza: 7,
  Rock: 8,
  Hill: 9,
  Sand: 10,
  Snow: 11,
  Bridge: 12,
  Farm: 13,
  Ruin: 14,
} as const;

export const TERRAIN_COUNT = 15;

export interface TerrainInfo {
  name: string;
  passable: boolean;
  /** Movement speed multiplier. */
  speed: number;
}

export const TERRAIN_INFO: readonly TerrainInfo[] = [
  { name: 'Deep Water', passable: false, speed: 0 },
  { name: 'Water', passable: false, speed: 0 },
  { name: 'Grassland', passable: true, speed: 1 },
  { name: 'Plains', passable: true, speed: 1 },
  { name: 'Forest', passable: true, speed: 0.85 },
  { name: 'Dirt Road', passable: true, speed: 1.2 },
  { name: 'Stone Road', passable: true, speed: 1.25 },
  { name: 'Plaza', passable: true, speed: 1.25 },
  { name: 'Mountain', passable: false, speed: 0 },
  { name: 'Highlands', passable: true, speed: 0.75 },
  { name: 'Sand', passable: true, speed: 0.9 },
  { name: 'Snowfield', passable: true, speed: 0.8 },
  { name: 'Bridge', passable: true, speed: 1.1 },
  { name: 'Farmland', passable: true, speed: 0.95 },
  { name: 'Ruins', passable: true, speed: 0.9 },
];

export const O = {
  None: 0,
  Pine: 1,
  Oak: 2,
  Bamboo: 3,
  Boulder: 4,
  Bush: 5,
  Reeds: 6,
  DeadTree: 7,
  Bones: 8,
  Flowers: 9,
  Banner: 10,
  /** A village well (blocks). */
  Well: 11,
  /** A stone street lantern (decoration, walkable). */
  Lantern: 12,
  /** A straw training dummy in a drill yard (blocks). */
  Dummy: 13,
  /** A weapon rack in a drill yard (blocks). */
  Rack: 14,
  /** A standard on its pole (blocks). */
  Standard: 15,
  /** Tile occupied by a building footprint. */
  Building: 200,
  /** Wall segment. */
  Wall: 201,
  /** Timber palisade segment, connects like a wall. */
  Palisade: 202,
  /** Low rail fence segment, connects like a wall. */
  Fence: 203,
} as const;

export function objectBlocks(o: number): boolean {
  return o === O.Pine || o === O.Oak || o === O.Bamboo || o === O.Boulder || o === O.DeadTree || o === O.Building || o === O.Wall || o === O.Palisade || o === O.Fence || o === O.Well || o === O.Dummy || o === O.Rack || o === O.Standard;
}

/** Every building shape the procedural art can draw. Which of them the game offers is decided by the sim. */
export type BuildingKind =
  | 'house'
  | 'inn'
  | 'smithy'
  | 'alchemy'
  | 'market'
  | 'shrine'
  | 'pagoda'
  | 'hall'
  | 'dojo'
  | 'farmhouse'
  | 'herbHut'
  | 'mineEntrance'
  | 'tower'
  | 'gate'
  | 'barracks'
  | 'ruinedHouse'
  | 'warehouse'
  | 'teahouse'
  | 'hermitage'
  | 'yard'
  | 'dormitory'
  | 'pavilion'
  | 'sectGate'
  /** M2: the kinds a village can build for itself (the others are drawn by the art for later milestones). */
  | 'workshop'
  | 'watchpost'
  | 'well'
  | 'wall';

/**
 * Construction state of a building or a plot, as the client draws it. `done` counts finished stages (of the blueprint's
 * stage list); `pct` is the progress of the stage being worked on, 0..100. While demolishing, `done` counts the stages still
 * standing and `pct` how far the next one is taken down; `rubble` is what is left until it is cleared.
 */
export interface ConView {
  mode: 'build' | 'demolish' | 'rubble';
  done: number;
  pct: number;
  /** The order behind it. */
  order: number;
  /** Material delivered to the site and not yet built in, by good (whole numbers). */
  pile?: Record<string, number>;
}

/** A building as the sim reports it: finished, or under construction or demolition (`con`). */
export interface BuildingDef {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  w: number;
  d: number;
  /** Tile where people go in and out (in front of the door). */
  door: { x: number; y: number };
  con?: ConView;
}

/** A designated rectangle of ground: a field being worked, later any plot for a building order. */
export type PlotKind = 'field';

export interface PlotDef {
  id: number;
  kind: PlotKind;
  x: number;
  y: number;
  w: number;
  d: number;
  con?: ConView;
}

/** The static part of the map: identical on every boot for a given seed. */
export interface WorldData {
  seed: number;
  w: number;
  h: number;
  terrain: Uint8Array;
  objects: Uint8Array;
  /** Blight density 0..255 per tile (creeps in from the edges; the sim owns how it spreads later). */
  blight: Uint8Array;
  /** Where the starting village stands. */
  start: StartVillage;
}

export interface StartVillage {
  /** Centre of the village green. */
  center: { x: number; y: number };
  buildings: BuildingDef[];
  plots: PlotDef[];
  /** The well (an object on the map). */
  well: { x: number; y: number };
}
