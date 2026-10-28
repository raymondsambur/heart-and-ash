import { describe, expect, it } from 'vitest';
import { SKILL_IDS, type SkillId } from '@hearth/shared';
import { candidates } from './goals';
import { refreshJobs } from './jobs';
import { isGuard, tradeOf } from './people';
import { kit, addPerson, setStock, type Kit } from './testkit';
import { mayTake } from './trades';
import type { Person } from './types';
import { titleOf } from './views';

/** An adult whose only skill is `skill` at `lv`. */
function hand(k: Kit, skill: SkillId | null, lv = 5): Person {
  const p = addPerson(k);
  for (const s of SKILL_IDS) p.skills[s].lv = 0;
  if (skill) p.skills[skill].lv = lv;
  return p;
}

function jobLabels(k: Kit, p: Person): string[] {
  k.c.hour = 9;
  for (const n of ['food', 'water', 'rest', 'warmth', 'safety', 'company'] as const) p.needs[n] = 90;
  p.mood = 80;
  return candidates(k.c, p).filter((x) => x.source === 'job').map((x) => x.label);
}

/** The village with only these people, so nobody else counts as a trade or a free hand. */
function village(...skills: (SkillId | null)[]): { k: Kit; people: Person[] } {
  const k = kit();
  k.st.people.length = 0;
  k.c.people.length = 0;
  const people = skills.map((s) => hand(k, s));
  return { k, people };
}

describe('a trade', () => {
  it('is the best skill when it is good, none before, and the one the village gave when there is a note of it', () => {
    const k = kit();
    const p = hand(k, 'farming', 5);
    expect(tradeOf(p)).toBe('farming');
    expect(titleOf(p, k.c.day)).toBe('Farmer');
    p.skills.farming.lv = 2;
    expect(tradeOf(p)).toBeNull();
    expect(titleOf(p, k.c.day)).toBe('Villager');
    p.trade = 'building';
    expect(tradeOf(p)).toBe('building');
    expect(titleOf(p, k.c.day)).toBe('Builder');
    expect(isGuard(p)).toBe(false);
    p.trade = 'fighting';
    expect(isGuard(p)).toBe(true);
  });
});

describe('who may take a job', () => {
  it('keeps a farmer off the wood, a woodcutter off the watch and a guard off the fields', () => {
    const { k, people } = village('farming', 'woodcraft', 'woodcraft', 'fighting', 'foraging');
    const [farmer, cutter, , guard, forager] = people;
    setStock(k, { ration: 400, wood: 80 });
    k.st.buildings.push({ id: k.st.nextBuildingId++, kind: 'gateway', x: 30, y: 30, w: 2, d: 2, door: { x: 30, y: 32 } });
    k.c.sites.sync(k.st.buildings, k.st.plots, k.st.orders);
    refreshJobs(k.c);
    const types = (p: Person): string[] => k.st.jobs.filter((j) => mayTake(k.c, p, j)).map((j) => j.type);
    expect(types(cutter)).toContain('wood');
    expect(types(farmer)).not.toContain('wood');
    expect(types(guard)).not.toContain('wood');
    expect(types(guard)).toContain('watch');
    expect(types(cutter)).not.toContain('watch');
    expect(types(farmer)).not.toContain('watch');
    expect(types(forager)).not.toContain('watch');
    expect(jobLabels(k, farmer)).not.toContain('cut wood');
    expect(jobLabels(k, guard)).not.toContain('cut wood');
  });

  it('lets someone with no trade take any job, and anyone take food or firewood work when the village is pinched', () => {
    const { k, people } = village('farming', null, 'fighting', 'woodcraft', 'woodcraft', 'woodcraft', 'woodcraft', 'woodcraft');
    const [farmer, free, guard] = people;
    setStock(k, { ration: 400, wood: 80 });
    refreshJobs(k.c);
    const wood = k.st.jobs.find((j) => j.type === 'wood')!;
    expect(mayTake(k.c, free, wood)).toBe(true);
    expect(mayTake(k.c, farmer, wood)).toBe(false);
    // no firewood to speak of: the wood job opens to all
    setStock(k, { ration: 400, wood: 80 });
    k.st.stock.wood = 0;
    expect(mayTake(k.c, guard, wood)).toBe(true);
    setStock(k, { ration: 2000, wood: 5000 });
    expect(mayTake(k.c, guard, wood)).toBe(false);
    // famine opens the forage work
    setStock(k, { ration: 0, wood: 5000 });
    refreshJobs(k.c);
    const forage = k.st.jobs.find((j) => j.type === 'forage')!;
    expect(mayTake(k.c, guard, forage)).toBe(true);
    expect(mayTake(k.c, farmer, forage)).toBe(true);
  });

  it('drops a claim on a job that is not for their trade', () => {
    const { k, people } = village('farming', 'woodcraft', 'woodcraft');
    const [farmer] = people;
    setStock(k, { ration: 400, wood: 80 });
    refreshJobs(k.c);
    const wood = k.st.jobs.find((j) => j.type === 'wood')!;
    farmer.job = wood.id;
    wood.claimed.push(farmer.id);
    refreshJobs(k.c);
    expect(farmer.job).toBeNull();
    expect(k.st.jobs.find((j) => j.type === 'wood')!.claimed).not.toContain(farmer.id);
  });
});

describe('when no one of the trade is free', () => {
  it('opens the job to others, and closes it again once one is', () => {
    const { k, people } = village('farming', 'woodcraft', 'woodcraft', 'woodcraft', 'woodcraft', 'woodcraft');
    const [farmer, ...cutters] = people;
    // given their trades, so the village does not move spare woodcutters to other work
    farmer.trade = 'farming';
    for (const cutter of cutters) cutter.trade = 'woodcraft';
    setStock(k, { ration: 400, wood: 80 });
    refreshJobs(k.c);
    const wood = () => k.st.jobs.find((j) => j.type === 'wood')!;
    // the woodcutters are free, so the farmer keeps off
    expect(wood().help).toBe(false);
    expect(mayTake(k.c, farmer, wood())).toBe(false);
    // the woodcutters are busy at something else: the farmer may help
    for (const cutter of cutters) cutter.job = k.st.jobs.find((j) => j.type !== 'wood')!.id;
    refreshJobs(k.c);
    expect(wood().help).toBe(true);
    expect(mayTake(k.c, farmer, wood())).toBe(true);
  });
});

describe('the watch', () => {
  it('is never opened to others just because the guards are busy', () => {
    const { k, people } = village('fighting', 'farming', 'farming');
    const [guard, farmer] = people;
    guard.trade = 'fighting';
    farmer.trade = 'farming';
    k.st.buildings.push({ id: k.st.nextBuildingId++, kind: 'gateway', x: 30, y: 30, w: 4, d: 1, door: { x: 30, y: 31 } } as never);
    k.st.buildings.push({ id: k.st.nextBuildingId++, kind: 'watchpost', x: 40, y: 40, w: 2, d: 2, door: { x: 40, y: 42 } } as never);
    k.c.sites.sync(k.st.buildings, k.st.plots, k.st.orders);
    setStock(k, { ration: 400, wood: 400 });
    refreshJobs(k.c);
    const watch = k.st.jobs.find((j) => j.type === 'watch')!;
    // the guard is busy at something else, and there are more places than guards
    guard.job = k.st.jobs.find((j) => j.type !== 'watch')!.id;
    refreshJobs(k.c);
    expect(watch.slots).toBeGreaterThan(0);
    expect(k.st.jobs.find((j) => j.type === 'watch')!.help).toBe(false);
    expect(mayTake(k.c, farmer, k.st.jobs.find((j) => j.type === 'watch')!)).toBe(false);
  });
});

describe('a trade nobody has', () => {
  it('is given to the adult best at it, sparing the only one of another trade', () => {
    const { k, people } = village('farming', 'farming', 'woodcraft');
    const [a, b, lone] = people;
    a.skills.building = { lv: 2, xp: 0 };
    b.skills.building = { lv: 3, xp: 0 };
    lone.skills.building = { lv: 4, xp: 0 };
    k.st.orders.push({ id: 1, kind: 'house', x: 20, y: 20, w: 3, d: 3, ox: 20, oy: 20, stages: [], stage: 0, state: 'active' } as never);
    setStock(k, { ration: 400, wood: 400 });
    refreshJobs(k.c);
    const builders = k.c.people.filter((p) => tradeOf(p) === 'building');
    if (k.st.jobs.some((j) => j.skill === 'building')) {
      expect(builders).toHaveLength(1);
      expect(builders[0].id).toBe(b.id);
      expect(k.st.feed.some((f) => f.text.includes('took up the work of builder'))).toBe(true);
    }
  });

  it('is left to those with no trade when there are any', () => {
    const { k, people } = village('farming', null);
    setStock(k, { ration: 400, wood: 80 });
    refreshJobs(k.c);
    expect(people.every((p) => p.trade === undefined)).toBe(true);
  });
});
