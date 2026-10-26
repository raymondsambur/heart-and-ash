import { describe, expect, it } from 'vitest';
import { ACTION_LIST, ACTIONS, AMBITIONS, AMBITION_KINDS, GAME_HOUR_MS, GOODS, NEED_IDS, SKILL_IDS, SKILL_LABEL, TRAITS, TRAIT_IDS, MAX_SKILL, skillSpeed, urgency, xpToNext, traitMod } from '@hearth/shared';
import { HANDLERS, type Done } from './actions';
import { active, drawAmbitions, finish, reviewAmbitions } from './ambitions';
import { MIN } from './ctx';
import { candidates, compliance, goalKeyOf, KEEP_MS, rank } from './goals';
import { decayMemories, HALF_LIFE_DAYS, MAX_MEMORIES, remember, worstGrudge } from './memory';
import { computeMood, tickNeeds } from './needs';
import { ageOf, COMING_OF_AGE } from './people';
import { plan, planText } from './planner';
import { gainXp, learnRate, speedOf } from './skills';
import { addPerson, kit, setStock } from './testkit';
import type { Cand, Job } from './types';
import { bond, peekRel, relOf } from './util';

const planWorld = (k: ReturnType<typeof kit>) => ({ st: k.st, sites: k.c.sites, hour: k.c.hour, season: k.c.season });
const calm = { sleeping: false, indoors: false, fire: false, company: 0 };

describe('needs', () => {
  it('fall by their own rate per game hour, slower asleep, and never below zero', () => {
    const k = kit();
    const p = addPerson(k);
    p.needs.food = 80;
    p.needs.water = 80;
    tickNeeds(p, GAME_HOUR_MS, k.c.day, 12, calm);
    expect(p.needs.food).toBeCloseTo(76, 5);
    expect(p.needs.water).toBeCloseTo(75, 5);
    const q = addPerson(k);
    q.needs.food = 80;
    tickNeeds(q, GAME_HOUR_MS, k.c.day, 12, { ...calm, sleeping: true });
    expect(q.needs.food).toBeGreaterThan(p.needs.food);
    p.needs.food = 1;
    tickNeeds(p, 10 * GAME_HOUR_MS, k.c.day, 12, calm);
    expect(p.needs.food).toBe(0);
  });

  it('cost health when food or water run out, and mend it when they are fine', () => {
    const k = kit();
    const p = addPerson(k);
    p.needs.water = 0;
    const r = tickNeeds(p, GAME_HOUR_MS, k.c.day, 12, calm);
    expect(r.cause).toBe('thirst');
    expect(p.hp).toBeLessThan(p.maxHp);
    const q = addPerson(k);
    q.hp = q.maxHp - 10;
    tickNeeds(q, GAME_HOUR_MS, k.c.day, 12, calm);
    expect(q.hp).toBeGreaterThan(q.maxHp - 10);
  });

  it('chill a person outdoors in winter but not by a fire', () => {
    const k = kit();
    const out = addPerson(k);
    const warm = addPerson(k);
    out.needs.warmth = warm.needs.warmth = 60;
    tickNeeds(out, GAME_HOUR_MS, k.c.day, -8, calm);
    tickNeeds(warm, GAME_HOUR_MS, k.c.day, -8, { ...calm, indoors: true, fire: true });
    expect(out.needs.warmth).toBeLessThan(60);
    expect(warm.needs.warmth).toBeGreaterThan(60);
  });

  it('turn into a mood with the three biggest causes named', () => {
    const k = kit();
    const p = addPerson(k);
    for (const n of NEED_IDS) p.needs[n] = 70;
    p.needs.food = 5;
    p.moodEvents.push({ text: 'a lovely wedding', v: 12, until: k.c.now + GAME_HOUR_MS });
    const { mood, causes } = computeMood(p, k.c.now);
    expect(causes.length).toBeLessThanOrEqual(3);
    expect(causes.map((c) => c.text).join(' ')).toContain('starving');
    expect(causes.some((c) => c.text === 'a lovely wedding')).toBe(true);
    p.moodEvents = [];
    expect(computeMood(p, k.c.now).mood).toBeLessThan(mood + 1);
    expect(mood).toBeGreaterThanOrEqual(0);
    expect(mood).toBeLessThanOrEqual(100);
  });

  it('call louder the lower they are', () => {
    expect(urgency(100)).toBe(0);
    expect(urgency(50)).toBeCloseTo(0.75, 5);
    expect(urgency(0)).toBe(3);
    expect(urgency(20)).toBeGreaterThan(urgency(40));
  });
});

describe('skills', () => {
  it('need more experience for each level and make people faster', () => {
    expect(xpToNext(1)).toBeGreaterThan(xpToNext(0));
    expect(xpToNext(0)).toBeCloseTo(40, 5);
    expect(skillSpeed(0)).toBe(1);
    expect(skillSpeed(5)).toBeCloseTo(1.4, 5);
  });

  it('level up from use, faster with a teacher, and stop at the cap', () => {
    const k = kit();
    const a = addPerson(k);
    const b = addPerson(k);
    a.skills.farming = { lv: 0, xp: 0 };
    b.skills.farming = { lv: 0, xp: 0 };
    expect(gainXp(a, 'farming', 41, k.c.day)).toBe(1);
    expect(a.skills.farming.lv).toBe(1);
    gainXp(b, 'farming', 30, k.c.day, true);
    expect(b.skills.farming.lv).toBe(1);
    b.skills.farming = { lv: MAX_SKILL, xp: 0 };
    expect(gainXp(b, 'farming', 1e6, k.c.day)).toBeNull();
    expect(b.skills.farming.lv).toBe(MAX_SKILL);
  });

  it('are learned quicker when young and slower when very old', () => {
    const k = kit();
    const young = addPerson(k, { age: 16 });
    const old = addPerson(k, { age: 72 });
    young.traits = [];
    old.traits = [];
    expect(learnRate(young, k.c.day, false)).toBeGreaterThan(learnRate(old, k.c.day, false));
    const p = addPerson(k);
    p.skills.mining.lv = 4;
    expect(speedOf(p, 'mining')).toBeGreaterThan(speedOf(p, 'smithing') - 0.001);
    expect(speedOf(p, undefined)).toBe(1);
  });
});

describe('goals', () => {
  it('put the sharpest need first, and a critical one alone', () => {
    const k = kit();
    const p = addPerson(k);
    for (const n of NEED_IDS) p.needs[n] = 90;
    p.needs.water = 8;
    p.needs.company = 2;
    const cands = candidates(k.c, p);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => c.source === 'need')).toBe(true);
    const top = rank(k.c, p, cands)[0];
    expect(top.goal).toMatchObject({ kind: 'need', need: 'water' });
  });

  it('never let loneliness outrank thirst or hunger', () => {
    const k = kit();
    const p = addPerson(k);
    for (const n of NEED_IDS) p.needs[n] = 90;
    p.needs.company = 0;
    p.needs.food = 9;
    const top = rank(k.c, p, candidates(k.c, p))[0];
    expect(top.goal).toMatchObject({ need: 'food' });
  });

  it('offer jobs from the board to a rested, fed adult by day', () => {
    const k = kit();
    const p = addPerson(k);
    for (const n of NEED_IDS) p.needs[n] = 90;
    k.c.hour = 10;
    expect(k.st.jobs.length).toBeGreaterThan(0);
    expect(candidates(k.c, p).some((c) => c.source === 'job')).toBe(true);
    // Children do not take jobs.
    const kid = addPerson(k, { age: 8 });
    for (const n of NEED_IDS) kid.needs[n] = 90;
    expect(candidates(k.c, kid).some((c) => c.source === 'job')).toBe(false);
  });

  it('keep the current goal for a while unless something is 25% better', () => {
    const k = kit();
    const p = addPerson(k);
    const mk = (label: string, score: number): Cand => ({ goal: { kind: 'act', action: 'wander', label }, source: 'leisure', score, label });
    const a: Cand = { goal: { kind: 'act', action: 'pray', label: 'pray' }, source: 'leisure', score: 1, label: 'pray' };
    p.goal = a.goal;
    p.goalSince = k.c.now - 5 * MIN;
    expect(rank(k.c, p, [a, mk('other', 1.2)])[0].goal).toBe(a.goal);
    expect(rank(k.c, p, [a, mk('other', 1.3)])[0].label).toBe('other');
    p.goalSince = k.c.now - KEEP_MS - 1;
    expect(rank(k.c, p, [a, mk('other', 1.1)])[0].label).toBe('other');
    expect(goalKeyOf(a.goal)).toBe('a:pray::');
  });
});

describe('planner', () => {
  it('plans to fetch food and eat when the store has some', () => {
    const k = kit();
    const p = addPerson(k);
    setStock(k, { ration: 50 });
    p.needs.food = 20;
    const r = plan(p, { kind: 'need', need: 'food', label: 'eat' }, planWorld(k));
    expect('steps' in r).toBe(true);
    if ('steps' in r) {
      expect(r.steps.map((s) => s.a).slice(0, 2)).toEqual(['take_item', 'eat']);
      expect(planText(r.steps)).toContain('eating');
    }
  });

  it('falls back to finding its own food when the store is empty', () => {
    const k = kit();
    const p = addPerson(k);
    setStock(k, {});
    p.needs.food = 20;
    const r = plan(p, { kind: 'need', need: 'food', label: 'eat' }, planWorld(k));
    expect('steps' in r).toBe(true);
    if ('steps' in r) expect(r.steps.some((s) => ['forage', 'fish', 'hunt', 'harvest'].includes(s.a))).toBe(true);
  });

  it('says why when there is no way: nothing in the store and nowhere known to look', () => {
    const k = kit();
    const p = addPerson(k, { known: k.c.sites.ofKind('home').map((s) => s.id) });
    setStock(k, {});
    p.needs.food = 20;
    const r = plan(p, { kind: 'need', need: 'food', label: 'eat' }, planWorld(k));
    expect('blocked' in r).toBe(true);
    if ('blocked' in r) expect(r.blocked).toMatch(/food|know/);
  });

  it('is blocked on a goal that needs a place the person has never heard of', () => {
    const k = kit();
    const p = addPerson(k, { known: k.c.sites.ofKind('home').map((s) => s.id) });
    const r = plan(p, { kind: 'stock', good: 'wood', label: 'cut wood' }, planWorld(k));
    expect('blocked' in r).toBe(true);
    if ('blocked' in r) expect(r.blocked.length).toBeGreaterThan(5);
  });

  it('does not count taking something out of the store and putting it back as bringing it in', () => {
    const k = kit();
    const p = addPerson(k);
    setStock(k, { wood: 100 });
    const r = plan(p, { kind: 'stock', good: 'wood', label: 'cut wood' }, planWorld(k));
    expect('steps' in r).toBe(true);
    if ('steps' in r) {
      expect(r.steps.map((s) => s.a)).toContain('chop_wood');
      expect(r.steps[0].a).not.toBe('take_item');
    }
  });

  it('hands every caller its own copy of a cached plan', () => {
    const k = kit();
    const p = addPerson(k);
    setStock(k, { ration: 50 });
    p.needs.food = 20;
    const g = { kind: 'need', need: 'food', label: 'eat' } as const;
    const a = plan(p, g, planWorld(k));
    const b = plan(p, g, planWorld(k));
    if ('steps' in a && 'steps' in b) {
      a.steps[0].tx = 99;
      expect(b.steps[0].tx).toBeUndefined();
    } else throw new Error('expected plans');
  });

  it('refuses inactive actions and acts above the person skill', () => {
    const k = kit();
    const p = addPerson(k);
    const inactive = ACTION_LIST.find((a) => !a.active && !a.plan)!;
    expect(inactive).toBeDefined();
    expect(plan(p, { kind: 'act', action: inactive.id, label: 'x' }, planWorld(k))).toHaveProperty('blocked');
    const hard = ACTION_LIST.find((a) => a.active && a.minSkill && a.minSkill > 0 && !a.plan)!;
    if (hard?.skill) {
      p.skills[hard.skill].lv = 0;
      expect(plan(p, { kind: 'act', action: hard.id, label: 'x' }, planWorld(k))).toHaveProperty('blocked');
    }
  });
});

describe('compliance', () => {
  const job = (o: Partial<Job> = {}): Job => ({ id: 1, key: 'wood:stock', type: 'wood', goal: { kind: 'stock', good: 'wood', label: 'cut wood' }, priority: 3, slots: 1, claimed: [], label: 'cut wood', ...o });

  it('stays between five and ninety-eight percent', () => {
    const k = kit();
    const p = addPerson(k);
    p.loyalty = 100;
    p.mood = 100;
    p.traits = [];
    expect(compliance(k.c, p, job())).toBeLessThanOrEqual(0.98);
    p.loyalty = 0;
    p.mood = 0;
    expect(compliance(k.c, p, job({ risky: true }))).toBeGreaterThanOrEqual(0.05);
  });

  it('rises with loyalty and mood and falls with risk', () => {
    const k = kit();
    const p = addPerson(k);
    p.traits = [];
    p.loyalty = 30;
    p.mood = 40;
    const low = compliance(k.c, p, job());
    p.loyalty = 90;
    p.mood = 80;
    const high = compliance(k.c, p, job());
    expect(high).toBeGreaterThan(low);
    expect(compliance(k.c, p, job({ risky: true }))).toBeLessThan(high);
  });

  it('is shaped by traits', () => {
    const k = kit();
    const p = addPerson(k);
    p.traits = [];
    const base = compliance(k.c, p, job());
    const withTrait = TRAIT_IDS.find((t) => TRAITS[t].mods.comply && TRAITS[t].mods.comply > 0.1);
    if (withTrait) {
      p.traits = [withTrait];
      expect(compliance(k.c, p, job())).toBeGreaterThan(base);
    }
  });
});

describe('relationships', () => {
  it('are kept on both sides, bounded, and stamped with the day', () => {
    const k = kit();
    const a = addPerson(k);
    const b = addPerson(k);
    expect(peekRel(a, b.id)).toBeUndefined();
    bond(k.c, a, b, 30, 40, 10);
    expect(relOf(a, b.id)).toMatchObject({ fam: 30, aff: 40, rom: 10, last: k.c.day });
    expect(relOf(b, a.id)).toMatchObject({ fam: 30, aff: 40, rom: 10 });
    bond(k.c, a, b, 500, -500, 500);
    expect(relOf(a, b.id)).toMatchObject({ fam: 100, aff: -100, rom: 100 });
  });
});

describe('memory', () => {
  it('reinforces a repeat instead of piling up, and is bounded', () => {
    const k = kit();
    const p = addPerson(k);
    p.memory = [];
    remember(p, { what: 'was helped', kind: 'help', who: 5, day: 1, val: 0.5 });
    remember(p, { what: 'was helped', kind: 'help', who: 5, day: 2, val: 0.5 });
    expect(p.memory).toHaveLength(1);
    expect(p.memory[0].w).toBeGreaterThan(1);
    for (let i = 0; i < 100; i++) remember(p, { what: `thing ${i}`, kind: `k${i}`, who: i, day: i, val: (i % 10) / 10 - 0.5 });
    expect(p.memory.length).toBeLessThanOrEqual(MAX_MEMORIES);
  });

  it('halves every twenty days and then fades away', () => {
    const k = kit();
    const p = addPerson(k);
    p.memory = [];
    remember(p, { what: 'a slight', kind: 'slight', who: 3, day: 0, val: -0.6 });
    for (let d = 0; d < HALF_LIFE_DAYS; d++) decayMemories(p);
    expect(p.memory[0].w).toBeCloseTo(0.5, 2);
    for (let d = 0; d < 100; d++) decayMemories(p);
    expect(p.memory).toHaveLength(0);
  });

  it('keeps track of the worst grudge', () => {
    const k = kit();
    const p = addPerson(k);
    p.memory = [];
    remember(p, { what: 'was robbed', kind: 'theft', who: 4, day: 1, val: -0.9 });
    remember(p, { what: 'was teased', kind: 'tease', who: 6, day: 1, val: -0.4 });
    remember(p, { what: 'was thanked', kind: 'thanks', who: 7, day: 1, val: 0.8 });
    expect(worstGrudge(p)?.who).toBe(4);
  });
});

describe('ambitions', () => {
  it('are drawn only for those old enough, at most two, never the same twice', () => {
    const k = kit();
    const kid = addPerson(k, { age: 6 });
    kid.ambitions = [];
    drawAmbitions(k.c, kid);
    expect(kid.ambitions).toHaveLength(0);
    const adult = addPerson(k, { age: 30 });
    adult.ambitions = [];
    for (let i = 0; i < 6; i++) drawAmbitions(k.c, adult);
    expect(active(adult).length).toBeLessThanOrEqual(2);
    expect(new Set(active(adult).map((a) => a.kind)).size).toBe(active(adult).length);
    for (const a of adult.ambitions) expect(ageOf(adult, k.c.day)).toBeGreaterThanOrEqual(AMBITIONS[a.kind].minAge);
  });

  it('end with a recorded outcome and a feed line, fulfilled or given up with the reason', () => {
    const k = kit();
    const p = addPerson(k);
    p.ambitions = [{ kind: 'get_rich', progress: 0.5, startedDay: 0 }, { kind: 'storyteller', progress: 0.2, startedDay: 0 }];
    const before = k.st.feed.length;
    finish(k.c, p, p.ambitions[0], 'fulfilled');
    finish(k.c, p, p.ambitions[1], 'abandoned', 'nobody listens');
    expect(p.ambitions[0].ended).toMatchObject({ how: 'fulfilled', day: k.c.day });
    expect(p.ambitions[1].ended).toMatchObject({ how: 'abandoned', why: 'nobody listens' });
    expect(k.st.feed.length).toBe(before + 2);
    expect(k.st.feed.at(-1)!.text).toContain('nobody listens');
  });

  it('are abandoned, with the reason, after a long time stuck', () => {
    const k = kit();
    const p = addPerson(k);
    p.ambitions = [{ kind: 'own_house', progress: 0.1, startedDay: k.c.day, stuck: 'waiting for a building plot' }];
    for (let d = 0; d < 45; d++) reviewAmbitions(k.c, p);
    expect(p.ambitions[0].ended?.how).toBe('abandoned');
    expect(p.ambitions[0].ended?.why).toContain('waiting for a building plot');
  });

  it('have a table row and a sentence for every kind', () => {
    for (const kind of AMBITION_KINDS) {
      expect(AMBITIONS[kind].label.length).toBeGreaterThan(3);
      expect(AMBITIONS[kind].desc.length).toBeGreaterThan(10);
    }
  });
});

describe('data tables', () => {
  it('give every action a place, a verb and sane numbers', () => {
    expect(ACTION_LIST.length).toBeGreaterThanOrEqual(60);
    for (const a of ACTION_LIST) {
      expect(ACTIONS[a.id]).toBe(a);
      expect(a.verb.length).toBeGreaterThan(2);
      // Life events (birth, death, falling ill) and hauling take no time of their own.
      expect(a.minutes).toBeGreaterThanOrEqual(0);
      if (a.plan) expect(a.minutes).toBeGreaterThan(0);
      if (a.skill) expect(SKILL_IDS).toContain(a.skill);
      if (a.plan?.gives && a.plan.gives !== 'empty') expect(GOODS).toContain(a.plan.gives);
    }
  });

  it('keep traits symmetric and skills labelled', () => {
    for (const id of TRAIT_IDS) {
      const o = TRAITS[id].opposite;
      if (o) expect(TRAITS[o].opposite).toBe(id);
      expect(TRAITS[id].desc.length).toBeGreaterThan(5);
    }
    for (const s of SKILL_IDS) expect(SKILL_LABEL[s]).toBeTruthy();
    expect(traitMod([], 'work')).toBe(0);
  });

  it('keep the age of coming of age where the rest of the sim expects it', () => {
    expect(COMING_OF_AGE).toBe(14);
  });
});

describe('leaving and the road', () => {
  const done = (k: ReturnType<typeof kit>, p: ReturnType<typeof addPerson>, step: Done['step']): Done => ({ c: k.c, p, step, act: { step, startedAt: k.c.now, endsAt: k.c.now }, hours: 1, q: 1, t: undefined });

  it('packs rations for a journey instead of carrying them around', () => {
    const k = kit();
    const p = addPerson(k);
    setStock(k, { ration: 20 });
    p.ambitions = [{ kind: 'see_outside', progress: 0.1, startedDay: 0 }];
    p.goal = { kind: 'act', action: 'take_item', label: 'pack supplies for the road' };
    HANDLERS.take_item(done(k, p, { a: 'take_item', at: 'store', good: 'ration', n: 5 }));
    expect(p.counters.supplied).toBe(1);
    expect(p.carrying).toBeNull();
    expect(k.st.stock.ration).toBe(17);
  });

  it('takes someone off the map for the Outside, with a line in the feed and their paths cleared', () => {
    const k = kit();
    const p = addPerson(k);
    p.ambitions = [{ kind: 'see_outside', progress: 0.6, startedDay: 0 }];
    const before = k.st.feed.length;
    HANDLERS.leave_village(done(k, p, { a: 'leave_village', at: 'edge' }));
    expect(p.away).toMatchObject({ returns: true });
    expect(k.c.people.includes(p)).toBe(false);
    expect(k.st.feed.length).toBe(before + 1);
    expect(k.st.feed.at(-1)!.text).toContain('see the Outside');
  });

  it('is for good when no dream calls them back', () => {
    const k = kit();
    const p = addPerson(k);
    p.ambitions = [];
    HANDLERS.leave_village(done(k, p, { a: 'leave_village', at: 'edge' }));
    expect(p.away?.returns).toBe(false);
  });
});
