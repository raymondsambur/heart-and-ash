import { describe, expect, it } from 'vitest';
import { O, T, type BuildingDef, type OrderView, type PlotDef } from '@hearth/shared';
import { costText, originFor, orderText, previewFor, structureAt } from './buildLogic';

const w = 40;
const h = 40;
const world = (): { w: number; h: number; terrain: Uint8Array; objects: Uint8Array; blight: Uint8Array; start: { center: { x: number; y: number } } } => ({ w, h, terrain: new Uint8Array(w * h).fill(T.Grass), objects: new Uint8Array(w * h), blight: new Uint8Array(w * h), start: { center: { x: 20, y: 20 } } });

describe('build tool rules', () => {
  it('puts the middle of the footprint under the pointer', () => {
    expect(originFor('house', false, { x: 10, y: 10 })).toEqual({ x: 9, y: 9, w: 3, d: 3 });
    expect(originFor('wall', false, { x: 10, y: 10 })).toEqual({ x: 9, y: 10, w: 4, d: 1 });
    expect(originFor('wall', true, { x: 10, y: 10 })).toEqual({ x: 10, y: 9, w: 1, d: 4 });
  });

  it('marks a spot green or red with the reason, using the same rules as the sim', () => {
    const wd = world();
    const pw = { world: wd, buildings: [] as BuildingDef[], plots: [] as PlotDef[] };
    const ok = previewFor(pw, 'house', false, { x: 20, y: 20 });
    expect(ok.ok).toBe(true);
    expect(ok.placement.tone).toBe('ok');
    expect(ok.placement.door).toEqual({ x: 20, y: 22 });
    wd.objects[20 * w + 20] = O.Oak;
    const tree = previewFor(pw, 'house', false, { x: 20, y: 20 });
    expect(tree.ok).toBe(false);
    expect(tree.placement.tone).toBe('bad');
    expect(tree.reason).toMatch(/in the way/);
    expect(previewFor(pw, 'house', false, { x: 38, y: 20 }).reason).toMatch(/edge|far/i);
    wd.terrain[25 * w + 25] = T.Water;
    expect(previewFor(pw, 'house', false, { x: 25, y: 25 }).ok).toBe(false);
  });

  it('finds the building or field under a tile', () => {
    const b = { id: 3, kind: 'house', x: 5, y: 5, w: 3, d: 3, door: { x: 6, y: 8 } } as BuildingDef;
    const p = { id: 9, kind: 'field', x: 10, y: 10, w: 5, d: 5 } as PlotDef;
    expect(structureAt([b], [p], 6, 6)).toEqual({ building: 3 });
    expect(structureAt([b], [p], 12, 14)).toEqual({ plot: 9 });
    expect(structureAt([b], [p], 0, 0)).toBeNull();
  });

  it('reads costs and order states in words', () => {
    expect(costText('house')).toBe('stone: 12, planks: 30, thatch: 6'.replace(/(\w+): (\d+)/g, '$2 $1'));
    const o = (patch: Partial<OrderView>): OrderView => ({ id: 1, mode: 'build', kind: 'house', label: 'House', x: 0, y: 0, w: 3, d: 3, done: 0, stages: 5, overall: 0, needs: [], workers: 0, day: 0, by: 'you', ...patch });
    expect(orderText(o({ done: 2 })).status).toBe('raising the frame');
    expect(orderText(o({ mode: 'demolish', done: 5 })).status).toBe('stripping the roof');
    expect(orderText(o({ mode: 'rubble', done: 0 })).status).toBe('clearing the rubble');
  });
});
