/**
 * Places a placeholder villager can walk to. Derived from the buildings, plots and the well, so they follow
 * the village when M2 adds or removes buildings.
 */
import { O, type BuildingDef, type NpcAct, type PlotDef, type Point, type WorldData } from '@hearth/shared';

export interface Place {
  kind: 'house' | 'storehouse' | 'field' | 'well' | 'plaza';
  /** Tile to stand on (for a field: a tile of it, picked at random by the caller). */
  at: Point;
  act: NpcAct;
  building?: number;
  plot?: PlotDef;
}

export function placesOf(world: WorldData, buildings: BuildingDef[], plots: PlotDef[]): Place[] {
  const out: Place[] = [];
  const { center, well } = world.start;
  out.push({ kind: 'plaza', at: { x: center.x - 2, y: center.y + 1 }, act: 'chat' });
  out.push({ kind: 'plaza', at: { x: center.x + 2, y: center.y - 1 }, act: 'chat' });
  // The well is an object on the map; people stand on the plaza tile south of it.
  if (world.objects[well.y * world.w + well.x] === O.Well) out.push({ kind: 'well', at: { x: well.x, y: well.y + 1 }, act: 'gather' });
  for (const b of buildings) {
    if (b.kind === 'warehouse') out.push({ kind: 'storehouse', at: b.door, act: 'sweep', building: b.id });
    else out.push({ kind: 'house', at: b.door, act: 'chat', building: b.id });
  }
  for (const p of plots) out.push({ kind: 'field', at: { x: p.x + (p.w >> 1), y: p.y + (p.d >> 1) }, act: 'farm', plot: p });
  return out;
}

/** How likely a daytime visit to each kind of place is. */
export const PLACE_WEIGHT: Record<Place['kind'], number> = { field: 3, well: 2, plaza: 2, storehouse: 2, house: 1 };
