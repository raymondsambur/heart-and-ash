/**
 * Life events: ageing, illness, death and mourning, pregnancy and birth, newcomers and people leaving. Most of it runs once a
 * game day (`dailyLife`); deaths can also happen any step when health runs out.
 */
import { DAYS_PER_SEASON, DAYS_PER_YEAR, SKILL_IDS } from '@hearth/shared';
import { drawAmbitions, finish } from './ambitions';
import type { Ctx } from './ctx';
import { pushFeed } from './feed';
import { decayMemories } from './memory';
import { stop } from './move';
import { clamp } from './needs';
import { COMING_OF_AGE, MARRIAGE_AGE, ageOf, newPerson, TRADE_ROTA } from './people';
import { emptiestHome } from './construct';
import { addMood, bond, feedAbout, mem, relOf, stat } from './util';
import { GROW_DAYS, TEND_HOURS, FIELD_YIELD } from './actions';
import type { Person } from './types';

/** Yearly death risk by age (docs/notes/balance-v0.md, section 6). */
export function yearlyDeathRisk(age: number): number {
  // Accidents and the small illnesses the sim does not model one by one: the very young and the grown carry a little risk.
  if (age < 5) return 0.03;
  if (age < 60) return 0.006;
  if (age < 70) return 0.05 + ((age - 60) / 10) * 0.1;
  if (age < 80) return 0.15 + ((age - 70) / 10) * 0.25;
  return 0.4 + Math.min(0.4, (age - 80) * 0.04);
}

export function foodDays(c: Ctx): number {
  const people = Math.max(1, c.people.length);
  return ((c.st.stock.ration ?? 0) + (c.st.stock.meal ?? 0) * 1.15) / people;
}

/** Take a person off the map for good, with everything that follows: the grave, the mourners, the widowed. */
export function die(c: Ctx, p: Person, cause: string): void {
  const age = ageOf(p, c.day);
  p.counters.dead = 1;
  c.st.graves.push({ id: p.id, name: p.name, died: c.day, cause, age, buried: false });
  c.st.people = c.st.people.filter((x) => x.id !== p.id);
  c.dirty();
  stat(c, 'deaths');
  stat(c, `death_${cause}`);
  for (const j of c.st.jobs) j.claimed = j.claimed.filter((id) => id !== p.id);
  pushFeed(c.st, c.pending, 'death', `${p.name} died${age >= 60 ? ' of old age' : cause === 'old age' ? '' : ` of ${cause}`}, aged ${age}.`, [p.id]);
  const kin = new Set<number>([...p.parents, ...p.children, ...(p.partner !== null ? [p.partner] : [])]);
  for (const o of c.st.people) {
    const r = o.relations[p.id];
    const close = kin.has(o.id) || (r && r.fam > 30 && r.aff > 15);
    if (!close) continue;
    addMood(c, o, `grief for ${p.name}`, kin.has(o.id) ? -18 : -8, kin.has(o.id) ? 24 * 6 : 24 * 3);
    mem(c, o, 'death', `${p.name} died`, -0.9, undefined);
    o.needs.company = clamp(o.needs.company - 10);
    if (o.partner === p.id) {
      o.partner = null;
      delete o.counters.engaged;
    }
    // Someone who was being taught or looked after remembers it.
  }
  for (const o of c.st.people) {
    if (o.talk?.with === p.id) o.talk = null;
    for (const a of o.ambitions) if (a.who === p.id && !a.ended) a.ended = { how: 'abandoned', day: c.day, why: `${p.name} died` };
  }
}

/** Someone sets out for the Outside. `returns` says whether they come back one day, with news. */
export function leave(c: Ctx, p: Person, returns: boolean, why: string): void {
  stop(p);
  p.plan = [];
  p.planIdx = 0;
  p.goal = null;
  p.act = null;
  p.talk = null;
  p.carrying = null;
  p.hidden = false;
  p.away = { since: c.day, returns };
  for (const j of c.st.jobs) j.claimed = j.claimed.filter((id) => id !== p.id);
  c.dirty();
  stat(c, 'departures');
  pushFeed(c.st, c.pending, 'leave', `${p.name} left the village ${why}.`, [p.id]);
  for (const o of c.people) {
    const r = o.relations[p.id];
    if (r && r.fam > 25) {
      addMood(c, o, `${p.name} has gone`, -4, 24 * 2);
      mem(c, o, 'left', `${p.name} left the village`, -0.4, p.id);
    }
  }
}

function returnHome(c: Ctx, p: Person): void {
  const edge = c.sites.ofKind('edge')[0];
  p.away = null;
  p.x = p.nx = edge?.x ?? p.x;
  p.y = p.ny = edge?.y ?? p.y;
  p.needs.food = 70;
  p.needs.water = 80;
  p.needs.rest = 60;
  p.counters.returned = c.day;
  p.plan = [];
  p.planIdx = 0;
  p.goal = null;
  c.dirty();
  stat(c, 'returns');
  pushFeed(c.st, c.pending, 'arrive', `${p.name} came back to the village after ${c.day - (p.counters.leftDay ?? c.day)} days.`, [p.id]);
  // They bring news: a rumour, and a story for the plaza.
  p.silver += c.rng.int(5, 40);
  addMood(c, p, 'home again', 6, 48);
  for (const a of [...p.ambitions]) {
    if (a.ended) continue;
    if (a.kind === 'see_outside') finish(c, p, a, 'fulfilled');
    if (a.kind === 'find_kin') (c.rng.chance(0.5) ? finish(c, p, a, 'fulfilled') : finish(c, p, a, 'abandoned', 'found no trace of them'));
  }
}

/** Children: a baby is born to `mother` (the sim already knows the father). */
function giveBirth(c: Ctx, mother: Person): void {
  const father = mother.pregnant ? c.person(mother.pregnant.father) : undefined;
  mother.pregnant = null;
  const parents = father ? [mother, father] : [mother];
  const baby = newPerson({ id: c.st.nextId++, rng: c.rng, age: 0, day: c.day, parents, home: mother.home, x: mother.x, y: mother.y, known: mother.known.slice(0, 20), trade: TRADE_ROTA[c.rng.int(0, TRADE_ROTA.length - 1)] });
  baby.born = c.day;
  baby.hidden = true;
  baby.inv = { tool: 0, clothes: 1 };
  baby.silver = 0;
  baby.loyalty = 60;
  for (const s of SKILL_IDS) baby.skills[s] = { lv: 0, xp: 0 };
  mother.children.push(baby.id);
  father?.children.push(baby.id);
  c.st.people.push(baby);
  c.dirty();
  for (const x of father ? [mother, father] : [mother]) {
    addMood(c, x, `a new child, ${baby.name}`, 15, 24 * 6);
    bond(c, x, baby, 100, 90);
    x.needs.purpose = clamp(x.needs.purpose + 20);
    mem(c, x, 'birth', `${baby.name} was born`, 1, baby.id);
  }
  for (const o of c.people) if (o.id !== mother.id && o.id !== father?.id && relOf(o, mother.id).fam > 40) addMood(c, o, `${baby.name} was born`, 3, 24 * 2);
  stat(c, 'births');
  pushFeed(c.st, c.pending, 'birth', `${baby.name} was born to ${mother.name}${father ? ` and ${father.name}` : ''}.`, [baby.id, mother.id, ...(father ? [father.id] : [])]);
}

function arrive(c: Ctx, n: number): void {
  const edge = c.sites.ofKind('edge')[0];
  if (!edge) return;
  const basic = c.sites.sites.filter((s) => s.kind === 'store' || s.kind === 'plaza' || s.kind === 'water' || s.kind === 'shrine' || s.kind === 'field').map((s) => s.id);
  for (let i = 0; i < n; i++) {
    const age = c.rng.int(17, 46);
    const home = emptiestHome(c);
    const p = newPerson({ id: c.st.nextId++, rng: c.rng, age, day: c.day, home, x: edge.x, y: edge.y, known: basic, trade: TRADE_ROTA[c.rng.int(0, TRADE_ROTA.length - 1)] });
    p.counters.newcomer = c.day;
    p.silver = c.rng.int(5, 30);
    p.loyalty = 40;
    p.needs.food = 45;
    p.needs.water = 50;
    p.needs.rest = 45;
    drawAmbitions(c, p);
    c.st.people.push(p);
    c.dirty();
    c.st.pool--;
    stat(c, 'arrivals');
    pushFeed(c.st, c.pending, 'arrive', `${p.name} arrived from the Outside, looking for work and a roof.`, [p.id]);
  }
}

/** Run once at the start of every game day. */
export function dailyLife(c: Ctx): void {
  const day = c.day;
  const st = c.st;

  // fields grow (frozen in winter) and ripen
  for (const f of st.fields) {
    if (f.state !== 'growing') continue;
    if (c.season < 3) f.grown++;
    if (f.grown >= GROW_DAYS) {
      const tendF = 0.6 + 0.4 * Math.min(1, f.tended / TEND_HOURS);
      f.state = 'ripe';
      f.left = Math.round(FIELD_YIELD * (0.6 + 0.1 * f.skill) * tendF * (1 - f.damage));
      stat(c, 'harvest_ripe', f.left);
      pushFeed(st, c.pending, 'farm', `A field is ripe: about ${f.left} rations are standing in it.`, []);
    }
  }
  // spoilage
  st.stock.ration = (st.stock.ration ?? 0) * 0.996;
  st.stock.meal = (st.stock.meal ?? 0) * 0.992;
  st.stock.herb = (st.stock.herb ?? 0) * 0.99;

  const people = [...st.people];
  for (const p of people) {
    if (p.away) {
      if (p.away.returns && day - p.away.since >= 12 && c.rng.chance(0.08)) returnHome(c, p);
      continue;
    }
    decayMemories(p);
    const age = ageOf(p, day);
    // coming of age
    if (age >= COMING_OF_AGE && !p.counters.grown && p.born > day - (COMING_OF_AGE + 1) * DAYS_PER_YEAR) {
      p.counters.grown = 1;
      p.inv.tool = Math.max(p.inv.tool, 1);
      p.silver += 3;
      drawAmbitions(c, p);
      feedAbout(c, 'life', `${p.name} came of age.`, p);
      addMood(c, p, 'came of age', 8, 48);
    }
    // old age
    const risk = yearlyDeathRisk(age);
    if (risk > 0 && c.rng.chance(1 - Math.pow(1 - risk, 1 / DAYS_PER_YEAR))) {
      die(c, p, age >= 60 ? 'old age' : 'illness');
      continue;
    }
    // illness: a fever now and then, more in winter and among the cold and hungry
    if (!p.ills.some((i) => i.id === 'fever')) {
      let ch = 0.0015 + (c.season === 3 ? 0.004 : 0) + (p.needs.warmth < 30 ? 0.01 : 0) + (p.needs.food < 20 ? 0.006 : 0) + (age >= 60 ? 0.003 : 0);
      if (age < 6) ch += 0.002;
      if (c.rng.chance(ch)) {
        p.ills.push({ id: 'fever', since: day });
        addMood(c, p, 'down with a fever', -8, 24 * 5);
        stat(c, 'illnesses');
        pushFeed(st, c.pending, 'illness', `${p.name} fell ill with a fever.`, [p.id]);
      }
    } else {
      const ill = p.ills.find((i) => i.id === 'fever')!;
      const nursed = c.people.some((o) => o.id !== p.id && o.act?.who === p.id && (o.act.step.a === 'heal' || o.act.step.a === 'nurse_sick'));
      if (day - ill.since >= 3 && c.rng.chance(0.25 + (nursed ? 0.2 : 0))) {
        p.ills = p.ills.filter((i) => i.id !== 'fever');
        stat(c, 'recoveries');
        pushFeed(st, c.pending, 'illness', `${p.name} recovered from the fever.`, [p.id]);
      }
    }
    // loyalty drifts with how life is going
    if (p.needs.food > 50 && p.needs.warmth > 40 && p.mood > 55) p.loyalty = clamp(p.loyalty + 0.4, 0, 100);
    else if (p.needs.food < 25 || p.mood < 35) p.loyalty = clamp(p.loyalty - 1, 0, 100);
    if (p.debt > 0) p.debt = Math.round(p.debt * 1.01 * 10) / 10;
    // pregnancy and birth
    if (p.pregnant) {
      if (day >= p.pregnant.due) giveBirth(c, p);
    } else if (p.sex === 1 && p.partner !== null && age >= MARRIAGE_AGE && age <= 42 && p.children.length < 5 && p.home !== null) {
      const father = c.person(p.partner);
      if (father && father.sex === 0 && !father.away && foodDays(c) > 8) {
        const boost = p.ambitions.some((a) => a.kind === 'raise_children' && !a.ended) ? 2 : 1;
        if (c.rng.chance(boost / 118)) p.pregnant = { due: day + 72, father: father.id };
      }
    }
  }

  // newcomers: a few each season, more when the village is fed and safe
  if (day > 0 && day % DAYS_PER_SEASON === 0 && st.pool > 0) {
    const fed = foodDays(c);
    const n = fed > 20 ? c.rng.int(1, 2) : fed > 8 ? c.rng.int(0, 1) : 0;
    if (n > 0) arrive(c, Math.min(n, st.pool));
  }
}
