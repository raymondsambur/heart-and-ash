/** The rules of the build tool that do not need a DOM: where a footprint goes, what it is called, how an order reads. Pure (unit tested). */
import { BLUEPRINTS, STAGE_TEXT, type StageId, blueprintOfKind, canPlace, footprintOf, totalNeeds, type BuildKind, type BuildingDef, type OrderView, type PlaceWorld, type PlotDef } from '@hearth/shared';
import type { Placement } from '../../render/api';
import type { Focus } from '../../state/store';

/** The top-left tile that puts the footprint's middle under the pointer. */
export function originFor(kind: BuildKind, rot: boolean, tile: { x: number; y: number }): { x: number; y: number; w: number; d: number } {
  const { w, d } = footprintOf(kind, rot);
  return { x: tile.x - ((w - 1) >> 1), y: tile.y - ((d - 1) >> 1), w, d };
}

export interface Preview {
  placement: Placement;
  ok: boolean;
  /** Why not, in words. */
  reason?: string;
}

/** What the ground looks like with this building laid at this tile (checked with the same rules the sim applies). */
export function previewFor(pw: PlaceWorld, kind: BuildKind, rot: boolean, tile: { x: number; y: number }): Preview {
  const o = originFor(kind, rot, tile);
  const r = canPlace(pw, kind, o.x, o.y, rot);
  const door = { x: o.x + (o.w >> 1), y: o.y + o.d };
  return r.ok ? { placement: { ...o, tone: 'ok', door }, ok: true } : { placement: { ...o, tone: 'bad', door }, ok: false, reason: r.reason };
}

/** The building or field standing on a tile, if any. */
export function structureAt(buildings: readonly BuildingDef[], plots: readonly PlotDef[], x: number, y: number): Focus | null {
  const inside = (r: { x: number; y: number; w: number; d: number }): boolean => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.d;
  const b = buildings.find(inside);
  if (b) return { building: b.id };
  const p = plots.find(inside);
  return p ? { plot: p.id } : null;
}

export function footprintOfFocus(f: Focus, buildings: readonly BuildingDef[], plots: readonly PlotDef[]): { x: number; y: number; w: number; d: number; kind: string; door?: { x: number; y: number }; con: boolean } | null {
  if (f.building !== undefined) {
    const b = buildings.find((x) => x.id === f.building);
    return b ? { x: b.x, y: b.y, w: b.w, d: b.d, kind: b.kind, door: b.door, con: !!b.con } : null;
  }
  const p = plots.find((x) => x.id === f.plot);
  return p ? { x: p.x, y: p.y, w: p.w, d: p.d, kind: 'field', con: !!p.con } : null;
}

/** "House" for a kind of building or plot the village can build; the plain kind name otherwise. */
export function kindLabel(kind: string): string {
  const bp = blueprintOfKind(kind);
  return bp ? bp.label : kind.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/** The materials of a whole build as "12 stone, 30 planks". */
export function costText(kind: BuildKind): string {
  return Object.entries(totalNeeds(BLUEPRINTS[kind]))
    .map(([g, n]) => `${n} ${g}`)
    .join(', ');
}

export interface OrderText {
  title: string;
  /** What is happening, in words. */
  status: string;
}

const DEMOLISH_TEXT: Record<StageId, string> = {
  cleared: 'levelling the ground',
  foundation: 'pulling up the footing',
  frame: 'taking down the frame',
  walls: 'taking down the walls',
  roof: 'stripping the roof',
  ploughed: 'levelling the furrows',
};

export function orderText(o: OrderView): OrderText {
  const bp = BLUEPRINTS[o.kind];
  if (o.mode === 'rubble') return { title: o.label, status: 'clearing the rubble' };
  if (o.mode === 'demolish') {
    const id = bp.stages[Math.max(0, o.done - 1)]?.id;
    return { title: o.label, status: id ? DEMOLISH_TEXT[id] : 'taking it down' };
  }
  const id = bp.stages[Math.min(o.done, bp.stages.length - 1)]?.id;
  return { title: o.label, status: id ? STAGE_TEXT[id] : 'finishing' };
}
