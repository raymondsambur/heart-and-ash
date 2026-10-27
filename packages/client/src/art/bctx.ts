/** Shared building-generation context and helpers (kept separate to avoid import cycles). */
import type { BuildingKind } from '@hearth/shared';
import { type Col } from './color';
import type { PixelBuffer } from './pixel';
import type { Scene3D } from './mesh';
import { GLOW_WARM, windowDecal, type FaceId, type Style } from './arch';

export interface BuildingSpec {
  id: number;
  kind: BuildingKind;
  w: number;
  d: number;
  /** Door tile relative to the building origin. */
  door: { dx: number; dy: number };
  season: number;
  /** Controlling faction tint for roofs (CSS) or null. */
  roofCss: string | null;
  /** Faction accent (banners, ridge) or null. */
  accentCss: string | null;
  fallen: boolean;
}

/**
 * How far along a building under construction (or demolition) is, as what stands: each part from 0 (not there) to 1 (finished).
 * `genConstruction` builds this from the sim's `ConView`; `basic()` and the staged kinds draw only what the fractions allow.
 */
export interface ConProgress {
  /** The footing: rises from the ground. */
  foundation: number;
  /** The posts and beams. */
  frame: number;
  /** The walls, from the footing up. */
  walls: number;
  /** How much of the roof is laid, row by row from the eave. */
  roof: number;
  /** Material on the plot: 0 none, 1 a few, 2 some, 3 a lot, by good. */
  pile: { planks: number; stone: number; thatch: number };
  /** The ground cleared and trodden bare: 0 untouched, 1 done. */
  ground: number;
  /** Stakes and cord mark the plot (until the walls rise). */
  staked: boolean;
  /** Pulling it down rather than putting it up. */
  demolish: boolean;
  /** Rubble left on the plot: 0 none, up to 1 a full heap (shrinks as it is cleared). */
  rubble: number;
}

export interface LightDef {
  x: number;
  y: number;
  r: number;
  c: Col;
}

export interface SmokeDef {
  x: number;
  y: number;
  kind: 'chimney' | 'alchemy' | 'fire' | 'smolder';
}

export interface BuildingArt {
  pb: PixelBuffer;
  glow: PixelBuffer;
  /** Sprite pixel of the footprint's top vertex (local u = v = 0, z = 0). */
  ox: number;
  oy: number;
  lights: LightDef[];
  smoke: SmokeDef[];
  /** Door height and main eave height in screen px (set by the kinds that define them; used by the scale test). */
  metrics?: { door: number; eave: number };
}

/** Everything a kind-builder needs. */
export interface Ctx {
  sc: Scene3D;
  st: Style;
  spec: BuildingSpec;
  w: number;
  d: number;
  roofColor: Col;
  accent: Col | null;
  lights: LightDef[];
  smoke: SmokeDef[];
  /** Pseudo-random in [0,1) for this building. */
  rnd(k: number): number;
  /** Set while a building under construction or demolition is drawn. */
  con?: ConProgress;
  metrics: { door: number; eave: number };
}

export function doorPlacement(spec: BuildingSpec): { face: FaceId; center: number } {
  const { dx, dy } = spec.door;
  const { w, d } = spec;
  if (dy >= d) return { face: 'left', center: Math.min(w - 0.7, Math.max(0.7, dx + 0.5)) };
  if (dx >= w) return { face: 'right', center: Math.min(d - 0.7, Math.max(0.7, dy + 0.5)) };
  return { face: 'left', center: w / 2 };
}

export function addLight(c: Ctx, u: number, v: number, z: number, r: number, col: Col = GLOW_WARM): void {
  if (c.st.fallen) return;
  c.lights.push({ x: c.sc.sx(u, v), y: c.sc.sy(u, v, z), r, c: col });
}

export function addSmoke(c: Ctx, u: number, v: number, z: number, kind: SmokeDef['kind'] = 'chimney'): void {
  c.smoke.push({ x: c.sc.sx(u, v), y: c.sc.sy(u, v, z), kind });
}

function addLightIf(c: Ctx, u: number, v: number, z: number, r: number, col: Col): void {
  // Window light pools are only registered for some windows to keep the night render cheap.
  if (c.rnd(Math.floor(u * 10)) < 0.6) addLight(c, u + 0.1, v + 0.1, z - 6, r, col);
}

/** Windows distributed on both faces, skipping the door. */
export function windowsFor(c: Ctx, u0: number, u1: number, v0: number, v1: number, z0: number, h: number, glow: Col = GLOW_WARM, opts?: { round?: boolean; wide?: number }): void {
  const dp = doorPlacement(c.spec);
  const wide = opts?.wide ?? 0.46;
  const nL = Math.max(1, Math.round((u1 - u0) / 1.25));
  for (let i = 0; i < nL; i++) {
    const cu = u0 + ((u1 - u0) * (i + 0.5)) / nL;
    if (dp.face === 'left' && Math.abs(cu - dp.center) < 0.62) continue;
    windowDecal(c.sc, c.st, 'left', v1, cu, wide, z0, h, glow, opts?.round);
    addLightIf(c, cu, v1, z0 + h / 2, 22, glow);
  }
  const nR = Math.max(1, Math.round((v1 - v0) / 1.25));
  for (let i = 0; i < nR; i++) {
    const cv = v0 + ((v1 - v0) * (i + 0.5)) / nR;
    if (dp.face === 'right' && Math.abs(cv - dp.center) < 0.62) continue;
    windowDecal(c.sc, c.st, 'right', u1, cv, wide, z0, h, glow, opts?.round);
  }
}
