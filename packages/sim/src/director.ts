/**
 * The events director (M3): the Blight's creep, bad harvests, plague, refugees, a travelling master and bandit raids
 * (docs/notes/balance-v0.md section 7, docs/notes/m3.md). It runs once a game day. Events are spaced with minimum gaps and
 * scaled to how strong the village is, and nothing hostile comes at a village too small to survive it. The sim makes no
 * choices for the manager here: it announces what is coming and lets the villagers and the buildings answer it.
 */
import { BAL, DAYS_PER_YEAR, GAME_DAY_MS, personName, type Rng, type SkillId } from '@hearth/shared';
import type { Ctx } from './ctx';
import { blightReach, foodDaysOf } from './economy';
import { pushFeed } from './feed';
import { isClosed } from './walls';
import { arrive, die, leave } from './life';
import { ageOf } from './people';
import { refugeeOffer } from './offers';
import { gainXp } from './skills';
import type { DirectorState, Person } from './types';
import { addMood, clamp, feedAbout, mem, stat } from './util';

export function newDirector(rng: Rng): DirectorState {
  const R = BAL.director.raid;
  return { blight: 0, blightDay: BAL.director.blight.everyDays, raid: null, nextRaid: R.first + rng.int(0, R.spread * 2), raidBonus: 0, last: {}, master: null };
}

/** The director of a save: the saved one, or for a village from before M3 a fresh one whose clocks start at `day`. */
export function ensureDirector(d: Partial<DirectorState> | undefined, rng: Rng, day: number): DirectorState {
  if (!d) {
    const fresh = newDirector(rng.fork('director'));
    fresh.nextRaid += day;
    fresh.blightDay += day;
    return fresh;
  }
  return { blight: d.blight ?? 0, blightDay: d.blightDay ?? day + BAL.director.blight.everyDays, raid: d.raid ?? null, nextRaid: d.nextRaid ?? day + BAL.director.raid.first, raidBonus: d.raidBonus ?? 0, last: { ...(d.last ?? {}) }, master: d.master ?? null };
}

const TITLE: Partial<Record<SkillId, string>> = {
  farming: 'farmer',
  hunting: 'huntsman',
  woodcraft: 'carpenter',
  mining: 'mason',
  building: 'master builder',
  smithing: 'smith',
  cooking: 'cook',
  crafting: 'weaver',
  healing: 'physician',
  fighting: 'swordmaster',
  scholarship: 'scholar',
};
const MASTER_SKILLS = Object.keys(TITLE) as SkillId[];

function gapOk(c: Ctx, kind: string, gap: number): boolean {
  return c.day - (c.st.dir.last[kind] ?? -1e9) >= gap;
}

function adults(c: Ctx): Person[] {
  return c.people.filter((p) => ageOf(p, c.day) >= 16);
}

// ---------------------------------------------------------------------------------------------------
// The harvest
// ---------------------------------------------------------------------------------------------------

/** The share of a ripening crop that is worth anything this time; most of the time all of it. */
export function harvestKeeps(c: Ctx): { keeps: number; why?: string } {
  const B = BAL.director.badHarvest;
  if (c.day < B.from || !c.rng.chance(B.chance)) return { keeps: 1 };
  const why = c.rng.pick(['hail flattened part of the crop', 'mildew took the grain', 'a dry spell stunted the crop', 'the damp rotted part of it']);
  stat(c, 'bad_harvests');
  return { keeps: B.keeps, why };
}

// ---------------------------------------------------------------------------------------------------
// Illness
// ---------------------------------------------------------------------------------------------------

export function startPlague(c: Ctx): void {
  const P = BAL.director.plague;
  const pool = c.people.filter((p) => !p.ills.some((i) => i.id === 'plague'));
  const n = Math.max(P.min, Math.min(P.max, Math.round(c.people.length * c.rng.float(P.share[0], P.share[1]))));
  const sick: Person[] = [];
  for (let i = 0; i < n && pool.length; i++) sick.push(pool.splice(c.rng.int(0, pool.length - 1), 1)[0]);
  for (const p of sick) {
    p.ills.push({ id: 'plague', since: c.day });
    addMood(c, p, 'sick with the plague', -10, 24 * 6);
  }
  c.st.dir.last.plague = c.day;
  stat(c, 'plagues');
  pushFeed(c.st, c.pending, 'plague', `A sickness has come to the village: ${sick.length} people are down with it.`, sick.map((p) => p.id));
}

/** Each day the sick may pass it on to the house they share, and may get better; the dying are counted in `tickPerson`. */
export function plagueDay(c: Ctx): void {
  const sick = c.people.filter((p) => p.ills.some((i) => i.id === 'plague'));
  if (!sick.length) return;
  for (const p of sick) {
    const ill = p.ills.find((i) => i.id === 'plague')!;
    // the household
    for (const o of c.people) {
      if (o.id === p.id || o.home === null || o.home !== p.home || o.ills.some((i) => i.id === 'plague')) continue;
      if (c.rng.chance(BAL.director.plague.spread)) {
        o.ills.push({ id: 'plague', since: c.day });
        addMood(c, o, 'sick with the plague', -10, 24 * 6);
        pushFeed(c.st, c.pending, 'plague', `${o.name} caught the sickness from ${p.name}.`, [o.id, p.id]);
        stat(c, 'plague_cases');
      }
    }
    const nursed = c.people.some((o) => o.id !== p.id && o.act?.who === p.id && (o.act.step.a === 'heal' || o.act.step.a === 'nurse_sick'));
    if (c.day - ill.since >= 3 && c.rng.chance(0.22 + (nursed ? 0.25 : 0) + (p.needs.food > 40 && p.needs.warmth > 40 ? 0.05 : 0))) {
      p.ills = p.ills.filter((i) => i.id !== 'plague');
      stat(c, 'plague_recoveries');
      pushFeed(c.st, c.pending, 'illness', `${p.name} got over the sickness.`, [p.id]);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Visitors
// ---------------------------------------------------------------------------------------------------

export function refugees(c: Ctx): void {
  const R = BAL.director.refugees;
  const n = c.rng.int(R.count[0], R.count[1]);
  c.st.dir.last.refugees = c.day;
  // The manager decides (or, unanswered or away, the village does what a careful keeper would).
  refugeeOffer(c, n);
}

function masterDay(c: Ctx): void {
  const M = BAL.director.master;
  const d = c.st.dir;
  if (!d.master) {
    if (c.day >= M.from && gapOk(c, 'master', M.gap) && c.people.length >= 6 && c.rng.chance(M.chance)) {
      const skill = c.rng.pick(MASTER_SKILLS);
      d.master = { name: personName(c.rng), skill, until: c.day + M.stay };
      d.last.master = c.day;
      pushFeed(c.st, c.pending, 'master', `A travelling ${TITLE[skill]}, ${d.master.name}, has come to the village and will teach for ${M.stay} days.`);
    }
    return;
  }
  if (c.day >= d.master.until) {
    pushFeed(c.st, c.pending, 'master', `${d.master.name} moved on.`);
    d.master = null;
    return;
  }
  // The ones with the most to learn sit with the master.
  const skill = d.master.skill;
  const students = adults(c)
    .sort((a, b) => a.skills[skill].lv - b.skills[skill].lv || a.id - b.id)
    .slice(0, M.students);
  for (const p of students) {
    const lv = gainXp(p, skill, M.xpPerDay, c.day, true);
    if (lv) feedAbout(c, 'skill', `${p.name} reached level ${lv} in ${skill}, learning from ${d.master.name}.`, p);
    p.needs.purpose = clamp(p.needs.purpose + 4, 0, 100);
  }
}

// ---------------------------------------------------------------------------------------------------
// Raids
// ---------------------------------------------------------------------------------------------------

/** What stands against a raid: the people who can fight (more for those on watch), the watch posts and the walls. */
export function defenceOf(c: Ctx): number {
  const D = BAL.defence;
  let total = 0;
  for (const p of adults(c)) {
    if (p.hp < 40) continue;
    const onWatch = (p.counters.watchAt ?? -1e12) > c.now - GAME_DAY_MS || p.act?.step.a === 'stand_watch' || p.act?.step.a === 'patrol';
    const sick = p.ills.length > 0 ? 0.5 : 1;
    total += (D.base + D.perFighting * p.skills.fighting.lv) * (onWatch ? D.onWatch : 1) * sick;
  }
  const posts = c.st.buildings.filter((b) => b.kind === 'watchpost' && !b.con).length;
  const walls = c.st.buildings.filter((b) => b.kind === 'wall' && !b.con).length;
  return total + Math.min(5, posts) * D.watchpost + Math.min(D.wallCap, walls * D.wall) + (isClosed(c) ? D.loop : 0);
}

function hurt(c: Ctx, p: Person, dmg: number, lethal: boolean): boolean {
  p.needs.safety = clamp(p.needs.safety - 25, 0, 100);
  mem(c, p, 'wound', 'was hurt fighting the raiders', -0.6);
  if (!p.ills.some((i) => i.id === 'wound')) p.ills.push({ id: 'wound', since: c.day });
  p.hp -= dmg;
  stat(c, 'wounds');
  if (p.hp <= 0) {
    if (lethal) {
      die(c, p, 'raiders');
      return true;
    }
    p.hp = 1;
  }
  return false;
}

function loot(c: Ctx, share: number, goods: readonly (keyof typeof c.st.stock)[]): string {
  const taken: string[] = [];
  for (const g of goods) {
    const have = c.st.stock[g] ?? 0;
    const n = Math.floor(have * share);
    if (n <= 0) continue;
    c.st.stock[g] = have - n;
    taken.push(`${n} ${g === 'ration' ? 'food' : g}`);
    stat(c, 'loot', n);
  }
  return taken.join(', ');
}

function resolveRaid(c: Ctx, size: number): void {
  const D = BAL.defence;
  const attack = size * D.perRaider;
  const defence = defenceOf(c);
  const ratio = defence / attack;
  const here = adults(c);
  const watchers = here.filter((p) => (p.counters.watchAt ?? -1e12) > c.now - GAME_DAY_MS || p.act?.step.a === 'stand_watch');
  stat(c, 'raids');
  c.st.dir.last.raid = c.day;
  if (ratio >= D.repel) {
    stat(c, 'raids_repelled');
    for (const p of watchers) gainXp(p, 'fighting', 18, c.day);
    for (const p of here) addMood(c, p, 'drove off the raiders', 4, 24 * 3);
    pushFeed(c.st, c.pending, 'raid', `${size} raiders came out of the night and were driven off by the village.`, watchers.slice(0, 3).map((p) => p.id));
    if (c.rng.chance(0.3) && here.length) hurt(c, c.rng.pick(here), c.rng.int(10, 20), false);
    return;
  }
  const kinds = ['ration', 'meal', 'wood', 'planks', 'cloth', 'tool'] as const;
  if (ratio >= D.overrun) {
    stat(c, 'raids_skirmish');
    const taken = loot(c, 0.07, kinds);
    const hit = Math.min(here.length, c.rng.int(1, 3));
    const pool = here.slice();
    for (let i = 0; i < hit; i++) hurt(c, pool.splice(c.rng.int(0, pool.length - 1), 1)[0], c.rng.int(20, 34), false);
    for (const p of here) addMood(c, p, 'the raid', -4, 24 * 3);
    for (const p of watchers) gainXp(p, 'fighting', 10, c.day);
    pushFeed(c.st, c.pending, 'raid', `${size} raiders hit the village. They were beaten back, but took ${taken || 'a little'} and ${hit} ${hit === 1 ? 'person was' : 'people were'} hurt.`);
    return;
  }
  stat(c, 'raids_overrun');
  const taken = loot(c, c.rng.float(0.3, 0.45), kinds);
  const hit = Math.min(here.length, c.rng.int(2, 4) + Math.floor(size / 5));
  const pool = here.slice();
  let dead = 0;
  for (let i = 0; i < hit; i++) if (hurt(c, pool.splice(c.rng.int(0, pool.length - 1), 1)[0], c.rng.int(40, 90), true)) dead++;
  for (const p of c.people) {
    addMood(c, p, 'the raid', -10, 24 * 6);
    p.needs.safety = clamp(p.needs.safety - 30, 0, 100);
    p.loyalty = clamp(p.loyalty - 8, 0, 100);
  }
  // Some who have lost faith in the village go: the less they hold to it, the likelier, at most a few at a time.
  let gone = 0;
  for (const p of adults(c)) {
    if (gone >= 3 || p.loyalty >= 50 || !c.rng.chance(0.3)) continue;
    leave(c, p, false, 'in fear after the raid');
    gone++;
  }
  pushFeed(c.st, c.pending, 'raid', `${size} raiders broke into the village and took ${taken || 'what they could carry'}. ${hit} ${hit === 1 ? 'person was' : 'people were'} hurt${dead ? `, ${dead} did not live` : ''}${gone ? `, and ${gone} left in fear` : ''}.`);
}

function raidDay(c: Ctx): void {
  const R = BAL.director.raid;
  const d = c.st.dir;
  // The director is mild while the manager is away: raiders wait until they are back.
  if (c.st.away) {
    if (d.raid) d.raid.day = Math.max(d.raid.day, c.day + 1);
    else if (c.day >= d.nextRaid) d.nextRaid = c.day + 1;
    return;
  }
  if (d.raid) {
    if (c.day >= d.raid.day) {
      const size = d.raid.size;
      d.raid = null;
      resolveRaid(c, size);
      d.nextRaid = c.day + R.gap + c.rng.int(-R.spread, R.spread);
    }
    return;
  }
  if (c.day < d.nextRaid) return;
  // A village too small to survive a raid is left alone for a while, and a hungry one gets smaller raiders.
  if (c.people.length < 6) {
    d.nextRaid = c.day + 12;
    return;
  }
  let size = c.rng.int(R.size[0], R.size[1]) + Math.floor((c.day / DAYS_PER_YEAR) * R.perYear) + d.raidBonus;
  d.raidBonus = 0;
  if (foodDaysOf(c) < 8) size = Math.max(2, size - 1);
  d.raid = { day: c.day + R.warnDays, size, warned: true };
  pushFeed(c.st, c.pending, 'raid', `Smoke on the ridge: about ${size} raiders are coming. They will be here by tomorrow night.`);
}

// ---------------------------------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------------------------------

/** Run once a game day, after the daily life. */
export function directorDay(c: Ctx): void {
  const d = c.st.dir;
  const day = c.day;

  // the Blight creeps in
  if (day >= d.blightDay) {
    d.blight++;
    d.blightDay += BAL.director.blight.everyDays;
    if (d.blight === 1 || d.blight % 3 === 0) {
      pushFeed(c.st, c.pending, 'blight', blightReach(c) > 0 ? 'The Blight has crept closer. Foragers say the ground at the edge is sick, and food keeps less well.' : 'The Blight has crept closer, but the shrines hold it at the edge.');
    }
  }

  plagueDay(c);
  masterDay(c);
  raidDay(c);

  const P = BAL.director.plague;
  if (!c.st.away && c.people.length >= 8 && day >= P.from && gapOk(c, 'plague', P.gap) && c.rng.chance(P.chance)) startPlague(c);
  const R = BAL.director.refugees;
  if (day >= R.from && gapOk(c, 'refugees', R.gap) && c.rng.chance(R.chance)) refugees(c);
}
