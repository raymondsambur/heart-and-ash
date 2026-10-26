/**
 * Appearance and visual vocabulary shared by the renderer, the procedural art and the sim.
 * Trimmed from the old game: no stats, items, tactics or missions live here.
 */

/** 0 = facing south-east (screen down-right), 1 = south-west, 2 = north-west, 3 = north-east. */
export type Dir = 0 | 1 | 2 | 3;

/** Looks are only visual cues for the art: what a person wears and carries. */
export type NpcRole = 'villager' | 'guard' | 'merchant' | 'smith' | 'alchemist' | 'innkeeper' | 'master' | 'elder' | 'physician' | 'legend' | 'wanderer' | 'disciple';

/** What the sprite shows a person doing. */
export type ActorState = 'idle' | 'walk' | 'fight' | 'work' | 'meditate' | 'craft' | 'dead';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

/** Harvest points the art can draw (herbs, ore veins, shrines, Blight hearts). */
export type NodeKind = 'herb' | 'rareHerb' | 'ore' | 'shrine' | 'heart';

/**
 * What a person is doing right now. The renderer plays a matching in-place animation while they stand still.
 * Absent = no cue (the renderer may use ambient fidgets).
 */
export type NpcAct =
  | 'work'
  | 'farm'
  | 'forge'
  | 'brew'
  | 'gather'
  | 'mine'
  | 'guard'
  | 'eat'
  | 'chat'
  | 'pray'
  | 'sweep'
  | 'rest'
  | 'patrol'
  | 'trade'
  | 'train'
  | 'shelter'
  | 'mourn'
  | 'celebrate'
  | 'meditate'
  | 'spar'
  | 'serve'
  | 'loot';

export type WeaponType = 'sword' | 'blade' | 'spear' | 'staff' | 'fist';
export const WEAPON_TYPES: WeaponType[] = ['sword', 'blade', 'spear', 'staff', 'fist'];

export const STAT_KEYS = ['might', 'agility', 'vitality', 'spirit', 'insight', 'fortune'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export type Rarity = 0 | 1 | 2 | 3 | 4;
export const RARITY_COLORS = ['#b9b2a0', '#7ec26b', '#5fa4e8', '#b87ae6', '#f0a43a'] as const;

/** Visible equipment summary: tier (1-5) and rarity (0-4) per slot, so sprites can show finery. */
export interface GearLook {
  w?: { t: number; r: number };
  o?: { t: number; r: number };
  a?: { k: StatKey; t: number; r: number };
}

/** Appearance indices; the client turns these into colours and shapes. */
export interface Look {
  gender: 0 | 1;
  skin: number;
  hairStyle: number;
  hairColor: number;
  outfit: number;
  outfitColor: number;
  sashColor: number;
  accessory: number;
}

export const LOOK_RANGES = {
  skin: 6,
  hairStyle: 7,
  hairColor: 8,
  outfit: 4,
  outfitColor: 10,
  sashColor: 8,
  accessory: 5,
} as const;
