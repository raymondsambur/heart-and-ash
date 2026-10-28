import { describe, expect, it } from 'vitest';
import { SKILL_IDS, type BuildingDef } from '@hearth/shared';
import { dutyPlan, dutySite, isDutyJob } from './duty';
import { candidates } from './goals';
import { refreshJobs } from './jobs';
import { isGuard } from './people';
import { kit, addPerson, setStock, type Kit } from './testkit';
import type { Person, Step } from './types';
import { titleOf } from './views';

/** A finished building put somewhere clear, with its door where a person can stand. */
function raise(k: Kit, kind: BuildingDef['kind'], x: number, y: number): BuildingDef {
  const b: BuildingDef = { id: k.st.nextBuildingId++, kind, x, y, w: 2, d: 2, door: { x, y: y + 2 } };
  k.st.buildings.push(b);
  k.c.sites.sync(k.st.buildings, k.st.plots, k.st.orders);
  return b;
}

function guard(k: Kit): Person {
  const p = addPerson(k);
  for (const s of SKILL_IDS) p.skills[s].lv = 0;
  p.skills.fighting.lv = 4;
  return p;
}

const step = (a: string): Step => ({ a, at: 'plaza' });

describe('who is a guard', () => {
  it('is whoever the villager list calls a Guard: best at fighting, and good at it', () => {
    const k = kit();
    const p = guard(k);
    expect(isGuard(p)).toBe(true);
    expect(titleOf(p, k.c.day)).toBe('Guard');
    p.skills.fighting.lv = 2;
    expect(isGuard(p)).toBe(false);
    p.skills.fighting.lv = 4;
    p.skills.woodcraft.lv = 5;
    expect(isGuard(p)).toBe(false);
    for (const q of k.st.people) expect(isGuard(q), q.name).toBe(titleOf(q, k.c.day) === 'Guard');
  });
});

describe('where the watch stands', () => {
  it('is at the gate and the watch posts, and at the plaza only while there is neither', () => {
    const k = kit();
    const p = k.st.people[0];
    expect(dutySite(k.c, p, step('stand_watch'))).toBeUndefined();
    const gate = raise(k, 'gateway', 30, 30);
    const tower = raise(k, 'watchpost', 40, 40);
    expect(k.c.sites.ofKind('post').map((s) => s.building).sort()).toEqual([gate.id, tower.id].sort());
    expect(dutySite(k.c, p, step('stand_watch'))!.building).toBe(gate.id);
  });

  it('puts a second watcher on the next post, not on top of the first', () => {
    const k = kit();
    const [a, b] = k.st.people;
    const gate = raise(k, 'gateway', 30, 30);
    const tower = raise(k, 'watchpost', 40, 40);
    const first = dutySite(k.c, a, step('stand_watch'))!;
    expect(first.building).toBe(gate.id);
    a.plan = [{ ...step('stand_watch'), site: first.id }];
    a.planIdx = 0;
    expect(dutySite(k.c, b, step('stand_watch'))!.building).toBe(tower.id);
  });

  it('sends a patrol round the gate, the posts and the green, one after the other', () => {
    const k = kit();
    const p = k.st.people[0];
    const gate = raise(k, 'gateway', 30, 30);
    const tower = raise(k, 'watchpost', 40, 40);
    const stops = [0, 1, 2, 3, 4, 5].map((i) => {
      k.c.now += 1000 * (i + 1);
      return dutySite(k.c, p, step('patrol'))!;
    });
    const kinds = new Set(stops.slice(0, 3).map((s) => (s.building === gate.id ? 'gate' : s.building === tower.id ? 'tower' : 'plaza')));
    expect(kinds).toEqual(new Set(['gate', 'tower', 'plaza']));
    // and then it goes round again
    expect(stops[3].id).toBe(stops[0].id);
  });
});

describe('the duty jobs', () => {
  it('post a watch at a gate, a patrol once there are two guards, and keep it to a share of the adults', () => {
    const k = kit();
    refreshJobs(k.c);
    expect(k.st.jobs.some((j) => isDutyJob(j))).toBe(false);
    raise(k, 'gateway', 30, 30);
    const plan = dutyPlan(k.c, isGuard);
    expect(plan.stand).toBe(1);
    expect(plan.patrol).toBe(0);
    guard(k);
    guard(k);
    raise(k, 'watchpost', 40, 40);
    const more = dutyPlan(k.c, isGuard);
    expect(more.patrol).toBe(1);
    refreshJobs(k.c);
    const watch = k.st.jobs.find((j) => j.key === 'watch:duty')!;
    expect(watch.slots).toBe(more.stand);
    expect(k.st.jobs.find((j) => j.key === 'patrol:round')!.slots).toBe(2); // widened to the two guards
    const adults = k.c.people.length;
    expect(more.stand + more.patrol).toBeLessThanOrEqual(Math.max(2 + 1, Math.floor(adults * 0.5) + 2));
  });
});

describe('a guard and the day', () => {
  function topJob(k: Kit, p: Person): string | undefined {
    k.c.hour = 9;
    p.needs.food = 90;
    p.needs.water = 90;
    p.needs.rest = 90;
    p.needs.warmth = 90;
    p.needs.safety = 90;
    p.needs.company = 90;
    p.mood = 80;
    return candidates(k.c, p)
      .filter((x) => x.source === 'job')
      .sort((x, y) => y.score - x.score)[0]?.label;
  }

  it('leans towards keeping watch and patrolling over cutting wood or foraging, while the village is not in want', () => {
    const k = kit();
    raise(k, 'gateway', 30, 30);
    raise(k, 'watchpost', 40, 40);
    const g = guard(k);
    guard(k);
    setStock(k, { ration: 400, wood: 600 });
    refreshJobs(k.c);
    expect(['stand watch', 'patrol the village']).toContain(topJob(k, g));
  });

  it('goes back to the work the village needs when there is no firewood or little food', () => {
    const k = kit();
    raise(k, 'gateway', 30, 30);
    raise(k, 'watchpost', 40, 40);
    const g = guard(k);
    guard(k);
    setStock(k, { ration: 400, wood: 0 });
    refreshJobs(k.c);
    expect(['stand watch', 'patrol the village']).not.toContain(topJob(k, g));
    setStock(k, { ration: 2, wood: 600 });
    refreshJobs(k.c);
    expect(['stand watch', 'patrol the village']).not.toContain(topJob(k, g));
  });
});
