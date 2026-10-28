/** Making people: names, looks, traits, skills, the starting households, and age. */
import {
  DAYS_PER_YEAR,
  LOOK_RANGES,
  NEED_IDS,
  SKILL_IDS,
  TRAITS,
  TRAIT_IDS,
  personName,
  type BuildingDef,
  type Look,
  type NpcRole,
  type Rng,
  type SkillId,
  type TraitId,
} from '@hearth/shared';
import type { Person } from './types';

export const COMING_OF_AGE = 14;
export const MARRIAGE_AGE = 16;

/** What a person is best at: their top skill (the first of equals, in the order of `SKILL_IDS`, farming when they have none). */
export function bestSkill(p: Person): SkillId {
  let best: SkillId = 'farming';
  for (const s of SKILL_IDS) if (p.skills[s].lv > p.skills[best].lv) best = s;
  return best;
}

/**
 * A person's trade, the work they keep to: the one the village gave them (`trade`), else their best skill once it is good (level 3).
 * Null for someone with no trade yet, who may take any job and so finds one.
 */
export function tradeOf(p: Person): SkillId | null {
  if (p.trade !== undefined) return p.trade;
  const best = bestSkill(p);
  return p.skills[best].lv >= 3 ? best : null;
}

/** A guard: the villager list calls them "Guard". */
export function isGuard(p: Person): boolean {
  return tradeOf(p) === 'fighting';
}

export function ageOf(p: Pick<Person, 'born'>, day: number): number {
  return Math.floor((day - p.born) / DAYS_PER_YEAR);
}

export function isChild(p: Pick<Person, 'born'>, day: number): boolean {
  return ageOf(p, day) < COMING_OF_AGE;
}

export function isElder(p: Pick<Person, 'born'>, day: number): boolean {
  return ageOf(p, day) >= 60;
}

/** The label the renderer dresses them by. */
export function roleOf(p: Pick<Person, 'born'>, day: number): NpcRole {
  return isElder(p, day) ? 'elder' : 'villager';
}

export function randomLook(rng: Rng, sex: 0 | 1, child: boolean, elder: boolean): Look {
  return {
    gender: sex,
    skin: rng.int(0, LOOK_RANGES.skin - 1),
    hairStyle: rng.int(0, LOOK_RANGES.hairStyle - 1),
    hairColor: elder ? rng.pick([5, 6]) : rng.int(0, LOOK_RANGES.hairColor - 1),
    outfit: 0,
    outfitColor: rng.int(0, LOOK_RANGES.outfitColor - 1),
    sashColor: rng.int(0, LOOK_RANGES.sashColor - 1),
    accessory: !child && rng.chance(0.25) ? rng.int(1, LOOK_RANGES.accessory - 1) : 0,
  };
}

/** Two to five traits, none of them opposites; children lean towards their parents' traits. */
export function drawTraits(rng: Rng, parents: readonly Pick<Person, 'traits'>[] = []): TraitId[] {
  const n = rng.weighted([[2, 3], [3, 4], [4, 2], [5, 1]] as const);
  const out: TraitId[] = [];
  const blocked = new Set<TraitId>();
  const take = (id: TraitId): void => {
    out.push(id);
    blocked.add(id);
    const o = TRAITS[id].opposite;
    if (o) blocked.add(o);
  };
  for (const par of parents) for (const id of par.traits) if (out.length < n && !blocked.has(id) && rng.chance(0.3)) take(id);
  let guard = 0;
  while (out.length < n && guard++ < 100) {
    const id = rng.weighted(TRAIT_IDS.filter((x) => !blocked.has(x)).map((x) => [x, TRAITS[x].weight] as const));
    take(id);
  }
  return out;
}

export function emptySkills(): Person['skills'] {
  return Object.fromEntries(SKILL_IDS.map((s) => [s, { lv: 0, xp: 0 }])) as Person['skills'];
}

/** The trades a household hands down: the first ones listed are given out first so the village can feed and warm itself. */
export const TRADE_ROTA: readonly SkillId[] = ['farming', 'woodcraft', 'cooking', 'hunting', 'farming', 'foraging', 'healing', 'crafting', 'mining', 'trading', 'farming', 'smithing', 'woodcraft', 'foraging'];

export function startingSkills(rng: Rng, trade: SkillId, age: number): Person['skills'] {
  const s = emptySkills();
  if (age < COMING_OF_AGE) {
    // Children play at the family trade.
    s[trade].lv = rng.int(0, 1);
    return s;
  }
  const grow = Math.min(1, (age - 14) / 14);
  s[trade].lv = Math.round(2 + 4 * grow * rng.float(0.6, 1));
  const extras = rng.int(1, 2);
  for (let i = 0; i < extras; i++) {
    const sk = rng.pick(SKILL_IDS);
    if (sk !== trade && sk !== 'leadership') s[sk].lv = Math.max(s[sk].lv, rng.int(1, Math.max(2, Math.round(4 * grow))));
  }
  // Everybody can at least forage a little and swing a tool.
  s.foraging.lv = Math.max(s.foraging.lv, 1);
  s.woodcraft.lv = Math.max(s.woodcraft.lv, 1);
  return s;
}

export interface NewPersonOpts {
  id: number;
  rng: Rng;
  sex?: 0 | 1;
  /** Age in years; the birth day is derived from `day`. */
  age: number;
  day: number;
  trade?: SkillId;
  parents?: Person[];
  home: number | null;
  x: number;
  y: number;
  /** Known sites (ids). */
  known: number[];
}

export function newPerson(o: NewPersonOpts): Person {
  const { rng } = o;
  const sex = o.sex ?? (rng.int(0, 1) as 0 | 1);
  const parents = o.parents ?? [];
  const child = o.age < COMING_OF_AGE;
  const elder = o.age >= 60;
  const traits = drawTraits(rng, parents);
  const trade = o.trade ?? rng.pick(TRADE_ROTA);
  const vigor = TRAIT_IDS.filter((t) => traits.includes(t)).reduce((s, t) => s + (TRAITS[t].mods.vigor ?? 0), 0);
  const maxHp = Math.round((child ? 60 : 100) * (1 + vigor));
  const needs = Object.fromEntries(NEED_IDS.map((n) => [n, Math.round(rng.float(65, 95))])) as Person['needs'];
  needs.warmth = 90;
  needs.safety = 85;
  const person: Person = {
    id: o.id,
    name: personName(rng),
    look: randomLook(rng, sex, child, elder),
    sex,
    born: o.day - o.age * DAYS_PER_YEAR - rng.int(0, DAYS_PER_YEAR - 1),
    parents: parents.map((p) => p.id),
    partner: null,
    children: [],
    home: o.home,
    x: o.x,
    y: o.y,
    path: [],
    nx: o.x,
    ny: o.y,
    stepMs: 0,
    stepLeft: 0,
    face: 0,
    hidden: false,
    needs,
    hp: maxHp,
    maxHp,
    ills: [],
    skills: startingSkills(rng, trade, o.age),
    traits,
    ambitions: [],
    loyalty: Math.round(rng.float(45, 70)),
    mood: 70,
    moodEvents: [],
    relations: {},
    memory: [],
    known: o.known.slice(),
    carrying: null,
    silver: child ? 0 : rng.int(2, 25),
    inv: { tool: child ? 0 : 1, clothes: 1 },
    rhythm: Math.round(rng.float(-1.5, 1.5) * 10) / 10,
    goal: null,
    source: null,
    goalSince: 0,
    plan: [],
    planIdx: 0,
    act: null,
    talk: null,
    job: null,
    why: { goal: 'Settling in', source: 'leisure', top: [], plan: '' },
    nextDecide: 0,
    fails: 0,
    blocked: null,
    lastAct: '',
    pregnant: null,
    debt: 0,
    stall: false,
    away: null,
    counters: {},
  };
  return person;
}

/** The households of a new village: a pattern of couples with children, single adults and elders, filled to `population`. */
export interface Household {
  adults: { sex: 0 | 1; age: number }[];
  kids: number[];
  elders: { sex: 0 | 1; age: number }[];
}

export function planHouseholds(rng: Rng, population: number): Household[] {
  const out: Household[] = [];
  let left = population;
  const pattern = ['couple', 'single', 'couple', 'elder', 'couple', 'single'] as const;
  for (let i = 0; left > 0; i++) {
    const kind = pattern[i % pattern.length];
    const h: Household = { adults: [], kids: [], elders: [] };
    if (kind === 'couple' && left >= 2) {
      h.adults.push({ sex: 0, age: rng.int(22, 44) }, { sex: 1, age: rng.int(21, 42) });
      left -= 2;
      const kids = Math.min(left, rng.int(0, 2));
      for (let k = 0; k < kids; k++) h.kids.push(rng.int(1, 12));
      left -= kids;
    } else if (kind === 'elder' && left >= 1) {
      h.elders.push({ sex: rng.int(0, 1) as 0 | 1, age: rng.int(60, 72) });
      left -= 1;
    } else {
      h.adults.push({ sex: rng.int(0, 1) as 0 | 1, age: rng.int(18, 50) });
      left -= 1;
    }
    out.push(h);
  }
  return out;
}

export function houseOrder(buildings: BuildingDef[]): BuildingDef[] {
  return buildings.filter((b) => b.kind === 'house');
}
