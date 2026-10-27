/**
 * Guard duty: where the watch stands and who takes it. Watchers are posted at the gate and the watch posts (the plaza only when
 * the village has neither), a patrol goes round them and across the green, and a guard (someone whose best skill is fighting)
 * leans towards this work over foraging and wood cutting, unless the village is short of food or firewood.
 */
import { watchSlots } from '@hearth/shared';
import type { Ctx } from './ctx';
import { foodDaysOf, fuelDaysOf } from './economy';
import { COMING_OF_AGE, ageOf } from './people';
import type { Job, Person, Site, Step } from './types';

const DUTY_ACTIONS: ReadonlySet<string> = new Set(['stand_watch', 'patrol']);

/** How much more a guard wants duty than other work, in calm times. */
export const GUARD_DUTY = 2.2;
/** Calm means at least this many days of food and of firewood in the store. */
const CALM_FOOD_DAYS = 6;
const CALM_FUEL_DAYS = 1.5;
/** Outside a raid, at most this share of the adults are on duty because of the gate and the patrol. */
const DUTY_SHARE = 0.5;

export function isDutyJob(job: Job): boolean {
  return job.goal.kind === 'act' && DUTY_ACTIONS.has(job.goal.action);
}

/** The village is not short of food or firewood, so a guard may leave the work to others. */
export function calm(c: Ctx): boolean {
  return foodDaysOf(c) >= CALM_FOOD_DAYS && fuelDaysOf(c) >= CALM_FUEL_DAYS;
}

/** How many stand watch and how many patrol. */
export function dutyPlan(c: Ctx, isGuard: (p: Person) => boolean): { stand: number; patrol: number } {
  const st = c.st;
  const towers = st.buildings.filter((b) => b.kind === 'watchpost' && !b.con).length;
  const gates = st.buildings.filter((b) => b.kind === 'gateway' && !b.con).length;
  const raid = !!st.dir.raid;
  const base = watchSlots(towers, raid);
  const adults = c.people.filter((p) => ageOf(p, c.day) >= COMING_OF_AGE);
  const guards = adults.filter(isGuard).length;
  let room = raid ? 99 : Math.max(0, Math.floor(adults.length * DUTY_SHARE) - base);
  const gate = gates > 0 && room >= 1 ? 1 : 0;
  room -= gate;
  const wantPatrol = towers + gates > 0 && guards >= 2 ? (guards >= 4 ? 2 : 1) : 0;
  return { stand: Math.min(6, base + gate), patrol: Math.min(wantPatrol, Math.max(0, room)) };
}

function watching(o: Person, siteId: number): boolean {
  const s = o.plan[o.planIdx];
  return !!s && s.site === siteId && DUTY_ACTIONS.has(s.a);
}

/**
 * The place a watcher goes: the gate first, then the watch posts, taking the one with the fewest others already on it. A patrol
 * goes to the one it visited longest ago, the green included, so it walks a round. Undefined when the village has no gate or post.
 */
export function dutySite(c: Ctx, p: Person, step: Step): Site | undefined {
  const posts = c.sites.ofKind('post');
  if (posts.length === 0) return undefined;
  const gateOf = (s: Site): boolean => c.st.buildings.find((b) => b.id === s.building)?.kind === 'gateway';
  const dist = (s: Site): number => Math.abs(s.x - p.x) + Math.abs(s.y - p.y);
  let best: Site | undefined;
  let bs = Infinity;
  if (step.a === 'patrol') {
    const round = [...posts, ...c.sites.ofKind('plaza').slice(0, 1)];
    for (const s of round) {
      const seen = p.counters[`patrol:${s.id}`] ?? -1e12;
      const score = seen + dist(s) * 1000;
      if (score < bs) {
        bs = score;
        best = s;
      }
    }
    if (best) p.counters[`patrol:${best.id}`] = c.now;
    return best;
  }
  for (const s of posts) {
    const others = c.people.filter((o) => o.id !== p.id && watching(o, s.id)).length;
    const score = others * 100 + (gateOf(s) ? 0 : 10) + dist(s) * 0.1;
    if (score < bs) {
      bs = score;
      best = s;
    }
  }
  return best;
}
