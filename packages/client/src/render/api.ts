/**
 * Contract between the UI layer (src/ui, src/net, src/state, main.ts) and the world renderer (src/render, src/art).
 * The renderer owns the canvas; the UI never draws into it directly.
 *
 * The renderer draws `RenderEntity` values. The villagers of the sim become plain `npc` entities (see `net/adapt.ts`);
 * the optional fields (beasts, harvest nodes, gear, battle sides) are kept because later milestones bring wildlife and raiders back.
 */
import type { CharState, ToolKind } from '../art/anim';
import type { ActorState, BuildingDef, CarryKind, Dir, GearLook, Look, NodeKind, NpcAct, NpcRole, PlotDef, Speed, TimeView, WeaponType, WorldPayload } from '@hearth/shared';

/** World payload with its grids decoded from base64. */
export interface DecodedWorld {
  payload: WorldPayload;
  terrain: Uint8Array;
  objects: Uint8Array;
  blight: Uint8Array;
}

export type RenderEntityKind = 'npc' | 'monster' | 'node';
export type RenderState = ActorState;

export interface RenderEntity {
  id: number;
  kind: RenderEntityKind;
  name: string;
  x: number;
  y: number;
  /** Next tile and the duration (game ms) of the step in progress; omitted when standing still. */
  nx?: number;
  ny?: number;
  step?: number;
  /** The tiles after (nx, ny), flat [x, y, ...]. */
  route?: number[];
  face: Dir;
  state: RenderState;
  look?: Look;
  role?: NpcRole;
  act?: NpcAct;
  /** A load in their hands. */
  carry?: CarryKind;
  /** Sprite key for monsters and nodes, e.g. 'wolf', 'bandit', 'herb'. */
  sprite?: string;
  nodeKind?: NodeKind;
  weapon?: WeaponType;
  gear?: GearLook;
  /** Colour of a banner or sash (CSS), if any. */
  faction?: string;
  /** 0 normal, 1 elite, 2 boss. */
  elite?: 0 | 1 | 2;
  /** A title shown above the name ("Elder"). */
  tag?: string;
  /** Level shown before the name (monsters, later). */
  lv?: number;
  hp?: number;
  maxHp?: number;
  rank?: number;
  /** Raid sides, for later milestones. */
  side?: 'raid' | 'def';
  flag?: 1;
  /** Indoors: not drawn. */
  hidden?: boolean;
  /** A child: drawn smaller. */
  child?: boolean;
}

export type RenderEntityPatch = Partial<Omit<RenderEntity, 'id' | 'kind'>> & { id: number };

export interface PickResult {
  /** Tile under the pointer. */
  x: number;
  y: number;
  /** Entity under the pointer (nearest, topmost), or null. */
  entityId: number | null;
}

export type PickGesture = 'tap' | 'context' | 'hover';

/** A footprint shown on the ground while the player lays out a building or points at one to take down. */
export interface Placement {
  /** Top-left tile and size in tiles. */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Green (can be put here), red (cannot) or a warm red wash (the thing that would come down). */
  tone: 'ok' | 'bad' | 'demolish';
  /** The tile in front of the door, marked when given. */
  door?: { x: number; y: number };
}

export interface GameViewApi {
  /** Begin the render loop (requestAnimationFrame). */
  start(): void;
  stop(): void;
  /** Call when the canvas element's CSS size changes. Handles devicePixelRatio. */
  resize(): void;

  loadWorld(world: DecodedWorld): void;
  /** Finished buildings and plots (sent whole whenever they change). */
  setBuildings(list: BuildingDef[]): void;
  setPlots(list: PlotDef[]): void;
  applyEntities(delta: { add?: RenderEntity[]; upd?: RenderEntityPatch[]; del?: number[] }): void;
  clearEntities(): void;

  setTime(time: TimeView): void;
  /**
   * The time-control speed (0 pauses). Walking and work animations run on a clock that moves at this speed, so pausing
   * freezes the people and 4x makes them move four times faster; the camera, weather and water keep real time.
   */
  setSpeed(speed: Speed): void;

  /** Highlight an entity as the current selection. */
  setSelected(entityId: number | null): void;
  /** Pointer events resolved to tiles/entities. Mouse: tap=left click, context=right click. Touch: tap, context=long press. */
  onPick(cb: (pick: PickResult, gesture: PickGesture) => void): void;
  /** Show (or with null hide) a footprint on the ground. */
  setPlacement(p: Placement | null): void;

  centerOn(x: number, y: number, instant?: boolean): void;
  /** 0.5 .. 2.5. */
  setZoom(zoom: number): void;
  getZoom(): number;

  /** Latest known state of an entity. */
  getEntity(id: number): RenderEntity | undefined;
}

export interface LookPreviewOptions {
  dir?: Dir;
  weapon?: WeaponType;
  /** Pixel scale of the sprite pixels. Default 6. */
  scale?: number;
  /** Walk/idle animation time in ms; omit for a still pose. */
  time?: number;
  state?: CharState;
  /** Draw a soft ground shadow and backdrop. Default true. */
  backdrop?: boolean;
  gear?: GearLook;
  /** Attack animation variant (0-3). */
  variant?: number;
  tool?: ToolKind;
  /** Fixed frame instead of `time`. */
  frame?: number;
}

/** Implemented in src/render/index.ts. */
export interface RenderModule {
  createGameView(canvas: HTMLCanvasElement): GameViewApi;
  /** Draw a single person into a small canvas (villager sheet). */
  drawLookPreview(canvas: HTMLCanvasElement, look: Look, opts?: LookPreviewOptions): void;
  /** Number of values for each appearance option, for building pickers. Mirrors LOOK_RANGES. */
  lookSwatches: {
    skin: string[];
    hair: string[];
    outfit: string[];
    sash: string[];
  };
}
