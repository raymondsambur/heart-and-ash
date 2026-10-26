import type { BuildingDef, Dir, EntityAct, Look, NpcRole, PlotDef, Point, Speed, WeatherKind } from '@hearth/shared';

/** A placeholder villager. M1 replaces these with real agents (needs, skills, traits, ambitions); the view they produce stays the same. */
export interface Villager {
  id: number;
  name: string;
  look: Look;
  role: NpcRole;
  /** Building id of the house they sleep in. */
  home: number;
  /** Tile they stand on. */
  x: number;
  y: number;
  /** Tiles still to walk (after the step in progress). */
  path: Point[];
  /** The step in progress: target tile, full duration and time left (game ms). stepMs 0 means standing still. */
  nx: number;
  ny: number;
  stepMs: number;
  stepLeft: number;
  face: Dir;
  /** What they are doing where they stand, and for how long they linger (game ms). */
  act: EntityAct | null;
  wait: number;
  /** Where they are heading: a place index (see places.ts), or -1 when they have nowhere to go. */
  goal: number;
}

export type SimCommand = { t: 'speed'; speed: Speed };

export type CommandResult = { ok: true } | { ok: false; code: string; text: string };

export type SimEvent =
  | { t: 'day'; day: number }
  | { t: 'season'; season: number; year: number }
  | { t: 'weather'; kind: WeatherKind };

/** The mutable state of a running sim. */
export interface SimState {
  seed: number;
  /** Game ms since the village began. */
  totalMs: number;
  /** Game ms not yet consumed by a whole step (so chunking of `step` calls never changes the result). */
  carryMs: number;
  speed: Speed;
  weather: WeatherKind;
  nextId: number;
  villageName: string;
  stock: Record<string, number>;
  buildings: BuildingDef[];
  plots: PlotDef[];
  villagers: Villager[];
}
