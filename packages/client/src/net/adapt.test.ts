import { describe, expect, it } from 'vitest';
import type { EntityView } from '@hearth/shared';
import { toRenderEntity, toRenderPatch } from './adapt';

const look = { gender: 0, skin: 1, hairStyle: 2, hairColor: 3, outfit: 0, outfitColor: 4, sashColor: 5, accessory: 0 } as const;
const base: EntityView = { id: 7, name: 'Han Gyeom', x: 3, y: 4, face: 1, state: 'idle', look, role: 'villager' };

describe('adapt', () => {
  it('turns a villager into a plain npc entity', () => {
    const r = toRenderEntity(base);
    expect(r).toMatchObject({ id: 7, kind: 'npc', name: 'Han Gyeom', x: 3, y: 4, face: 1, state: 'idle', role: 'villager' });
    expect(r.tag).toBeUndefined();
    expect(toRenderEntity({ ...base, role: 'elder' }).tag).toBe('Elder');
  });

  it('carries the walk, the route and the act', () => {
    const r = toRenderEntity({ ...base, state: 'walk', nx: 4, ny: 4, step: 420, route: [5, 4, 6, 4] });
    expect(r).toMatchObject({ state: 'walk', nx: 4, ny: 4, step: 420, route: [5, 4, 6, 4] });
    expect(toRenderEntity({ ...base, state: 'work', act: 'farm' }).act).toBe('farm');
  });

  it('shows sleeping people as idle with the rest act (the pose comes from the act)', () => {
    const r = toRenderEntity({ ...base, state: 'rest', act: 'rest' });
    expect(r.state).toBe('idle');
    expect(r.act).toBe('rest');
  });

  it('a patch clears fields the person no longer has', () => {
    const p = toRenderPatch({ id: 7, x: 5, y: 4, face: 0, state: 'idle' });
    expect(p).toMatchObject({ id: 7, x: 5, y: 4 });
    expect('nx' in p && p.nx === undefined).toBe(true);
    expect('act' in p && p.act === undefined).toBe(true);
  });
});
