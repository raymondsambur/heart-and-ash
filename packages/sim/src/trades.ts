/**
 * Trades: people work the jobs of their own trade. A job that asks for a skill goes only to someone whose trade it is, or to a
 * person with no trade yet (who may take any job, and so finds one). When no one of the trade is free for a job, others help. Famine and cold are the exception for food and firewood, and a raid for the watch.
 * When the village has too few people in a trade its jobs need, the best-suited adult from a trade with people to spare is given it.
 */
import type { SkillId } from '@hearth/shared';
import type { Ctx } from './ctx';
import { isDutyJob } from './duty';
import { foodDaysOf, fuelDaysOf } from './economy';
import { COMING_OF_AGE, ageOf, tradeOf } from './people';
import type { Job, Person } from './types';
import { feedAbout } from './util';
import { SKILL_TITLE } from './views';

/** Jobs that put food on the table, which anyone takes up when the store is nearly empty. */
const FOOD_JOBS: ReadonlySet<string> = new Set(['forage', 'fish', 'hunt', 'harvest']);
/** Days of food and of firewood below which the trades give way. */
export const FAMINE_DAYS = 3;
export const COLD_DAYS = 0.75;
/** Elders are not given a new trade. */
const ELDER_AGE = 60;

/** The village is out of food (for a food job) or firewood (for wood), or a raid is on (for the watch), so anyone may take the work. */
export function pinched(c: Ctx, job: Job): boolean {
  if (isDutyJob(job)) return !!c.st.dir.raid;
  if (FOOD_JOBS.has(job.type)) return foodDaysOf(c) < FAMINE_DAYS;
  if (job.type === 'wood') return fuelDaysOf(c) < COLD_DAYS;
  return false;
}

/** Whether this person may take this job: it needs no skill, or it is their trade, or they have none, or no one of the trade is free, or the village is pinched. */
export function mayTake(c: Ctx, p: Person, job: Job): boolean {
  if (!job.skill) return true;
  const t = tradeOf(p);
  return t === null || t === job.skill || !!job.help || pinched(c, job);
}

/**
 * Mark the jobs with more places open than there are free people of their trade (none at all, or all busy at something else): others
 * may help with those, and only those. Run on each refresh, after the claims are settled.
 */
export function markHelp(c: Ctx, jobs: readonly Job[]): void {
  const free = new Map<SkillId, number>();
  for (const p of adults(c)) {
    const t = tradeOf(p);
    if (t && p.job === null) free.set(t, (free.get(t) ?? 0) + 1);
  }
  for (const j of jobs) {
    if (!j.skill) continue;
    // Those already helping do not count as the trade's own, or the job would close on them and open again each hour.
    const own = j.claimed.filter((id) => {
      const t = c.person(id) ? tradeOf(c.person(id)!) : null;
      return t === null || t === j.skill;
    }).length;
    j.help = j.slots - own > (free.get(j.skill) ?? 0);
  }
}

function adults(c: Ctx): Person[] {
  return c.people.filter((p) => !p.counters.dead && ageOf(p, c.day) >= COMING_OF_AGE);
}

/**
 * Work for the people of a trade: where the board posts a job, it has room for everyone who has that trade (up to six), so a trade is
 * not left idle with work waiting. Only skilled work is widened, and only upwards.
 */
export function widenSlots<T extends { skill?: SkillId; slots: number }>(c: Ctx, drafts: T[]): T[] {
  const held = new Map<SkillId, number>();
  for (const p of adults(c)) {
    const t = tradeOf(p);
    if (t) held.set(t, (held.get(t) ?? 0) + 1);
  }
  for (const d of drafts) if (d.skill) d.slots = Math.max(d.slots, Math.min(6, held.get(d.skill) ?? 0));
  return drafts;
}

/** The most people the board's work in one trade is allowed to claim for itself. */
const MAX_HOLDERS = 3;

/**
 * Give the trades the job board asks for to enough people. A trade is short when fewer people have it than half the places its
 * jobs offer (up to three); the adult best at it is given it, taking from a trade with more people than its jobs need, or from one
 * with no jobs at all, and sparing the only one of their trade. Nothing is done while anyone is free of a trade, since they take
 * that work and find a trade by it. One trade per call, so the change is gradual, and nobody is given a trade twice.
 */
export function fillTrades(c: Ctx, jobs: readonly Job[]): void {
  const all = adults(c);
  if (all.some((p) => tradeOf(p) === null)) return;
  const asked = new Map<SkillId, number>();
  for (const j of jobs) if (j.skill) asked.set(j.skill, (asked.get(j.skill) ?? 0) + j.slots);
  const need = (s: SkillId): number => Math.min(MAX_HOLDERS, Math.ceil((asked.get(s) ?? 0) / 2));
  const held = new Map<SkillId, number>();
  for (const p of all) {
    const t = tradeOf(p);
    if (t) held.set(t, (held.get(t) ?? 0) + 1);
  }
  for (const [skill] of asked) {
    if ((held.get(skill) ?? 0) >= need(skill)) continue;
    let best: Person | null = null;
    let bs = -Infinity;
    for (const p of all) {
      if (ageOf(p, c.day) >= ELDER_AGE || p.trade !== undefined) continue;
      const own = tradeOf(p);
      if (own === skill) continue;
      const have = own ? (held.get(own) ?? 0) : 0;
      // only from a trade with people to spare
      if (own && have <= Math.max(1, need(own))) continue;
      const score = p.skills[skill].lv * 10 - p.id * 1e-6;
      if (score > bs) {
        bs = score;
        best = p;
      }
    }
    if (!best) continue;
    best.trade = skill;
    feedAbout(c, 'work', `${best.name} took up the work of ${SKILL_TITLE[skill].toLowerCase()}, as the village needed more.`, best);
    return;
  }
}
