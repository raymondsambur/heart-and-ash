import { describe, expect, it } from 'vitest';
import { spotNear } from './move';
import { addPerson, kit } from './testkit';

describe('where people stand at a site', () => {
  it('is a different tile for each person, so no one stands on another, and the same tile again for the same person', () => {
    const k = kit();
    const people = [0, 1, 2, 3, 4, 5].map(() => addPerson(k));
    const x = 40;
    const y = 40;
    const seen = new Set<string>();
    for (const p of people) {
      const s = spotNear(k.c, x, y, 1, p.id);
      expect(spotNear(k.c, x, y, 1, p.id)).toEqual(s);
      expect(seen.has(`${s.x},${s.y}`), `${s.x},${s.y}`).toBe(false);
      seen.add(`${s.x},${s.y}`);
      // the next person is not sent to where this one is going
      p.plan = [{ a: 'stand_watch', at: 'plaza', tx: s.x, ty: s.y }];
      p.planIdx = 0;
    }
    expect(seen.size).toBe(6);
  });

  it('avoids a tile someone is standing on', () => {
    const k = kit();
    const a = addPerson(k);
    const b = addPerson(k);
    const first = spotNear(k.c, 40, 40, 1, a.id);
    b.x = first.x;
    b.y = first.y;
    expect(spotNear(k.c, 40, 40, 1, a.id)).not.toEqual(first);
  });
});
