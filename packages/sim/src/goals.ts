/**
 * Where a person's day comes from (docs/notes/m1-agent-brain-spec.md, section 6): goals from needs, the job board, ambitions
 * and leisure, scored and compared. Within a source `score = base * urgency * traitFit * skillFit / (1 + distance / 20)`;
 * a goal is kept for about 20 game minutes and only replaced by one that beats it by 25%.
 */
import { ACTIONS, NEEDS, NEED_CRITICAL, traitMod, urgency, type NeedId } from '@hearth/shared';
import { ambitionCands, active } from './ambitions';
import type { Ctx } from './ctx';
import { MIN } from './ctx';
import { ageOf, COMING_OF_AGE } from './people';
import { worstGrudge } from './memory';
import { priorityMult } from './policy';
import type { Cand, Goal, Job, Person } from './types';
import { compat, isFree, nearbyPeople, peekRel } from './util';

export const KEEP_MS = 20 * MIN;
export const SWITCH_RATIO = 1.25;

/** Hours of the night for this person (their rhythm shifts it by up to an hour and a half). */
export function isNight(c: Ctx, p: Person): boolean {
  const h = (c.hour - p.rhythm + 24) % 24;
  return h >= 22 || h < 6;
}

function workHours(c: Ctx, p: Person): boolean {
  const h = (c.hour - p.rhythm + 24) % 24;
  return h >= 6.5 && h < 20.5;
}

/** Distance from the person to the nearest known site of the kind a goal needs, in tiles (0 if it needs none). */
function distanceTo(c: Ctx, p: Person, g: Goal): number {
  const kind = g.kind === 'act' ? ACTIONS[g.action]?.at : g.kind === 'stock' ? (g.good === 'wood' ? 'forest' : g.good === 'stone' ? 'quarry' : g.good === 'herb' || g.good === 'ration' ? 'meadow' : 'store') : undefined;
  if (!kind || kind === 'here' || kind === 'person') return 0;
  if (g.kind === 'act' && g.order !== undefined) {
    const s = c.sites.ofKind('buildsite').find((x) => x.order === g.order);
    return s ? Math.abs(s.x - p.x) + Math.abs(s.y - p.y) : 20;
  }
  if (g.kind === 'act' && g.plot !== undefined) {
    const s = c.sites.ofKind('field').find((x) => x.plot === g.plot);
    return s ? Math.abs(s.x - p.x) + Math.abs(s.y - p.y) : 20;
  }
  const known = new Set(p.known);
  const s = kind === 'home' ? c.sites.ofKind('home').find((x) => x.building === p.home) : c.sites.nearest(kind, p.x, p.y, known);
  return s ? Math.abs(s.x - p.x) + Math.abs(s.y - p.y) : 30;
}

const NEED_GOAL: Partial<Record<NeedId, string>> = {
  food: 'get something to eat',
  water: 'get a drink',
  rest: 'get some sleep',
  warmth: 'warm up',
  safety: 'feel safe again',
  company: 'find some company',
};

function needCands(c: Ctx, p: Person): Cand[] {
  const out: Cand[] = [];
  const night = isNight(c, p);
  for (const id of ['food', 'water', 'rest', 'warmth', 'safety', 'company'] as const) {
    const v = p.needs[id];
    // At night people go to bed even when they are not yet worn out.
    if (v >= (id === 'rest' && night ? 92 : 62)) continue;
    let score = urgency(v);
    if (id === 'rest') score = night ? Math.max(score * 1.8, 0.9) : score * (v > 40 ? 0.25 : 1);
    if (id === 'company') {
      score *= 1 + Math.max(0, traitMod(p.traits, 'social')) * 0.6;
      if (night) score *= 0.2;
      if (!c.people.some((o) => o.id !== p.id && isFree(o))) continue;
    }
    if (id === 'safety' && v >= 50) continue;
    if (id === 'warmth' && v >= 50 && !night) score *= 0.7;
    // Only what can kill beats everything else; loneliness never does.
    if (v < NEED_CRITICAL && id !== 'company') score += id === 'water' ? 56 : id === 'food' ? 55 : id === 'warmth' ? 53 : 50;
    out.push({ goal: { kind: 'need', need: id, label: NEED_GOAL[id] ?? NEEDS[id].label }, source: 'need', score, label: NEED_GOAL[id] ?? NEEDS[id].label });
  }
  return out;
}

/** The chance someone takes a job (docs spec 9): loyalty, mood and traits against the risk and any dream that competes. */
export function compliance(c: Ctx, p: Person, job: Job): number {
  const risk = job.risky ? Math.max(0, 0.25 - traitMod(p.traits, 'risk') * 0.4) : 0;
  const conflict = active(p).some((a) => a.progress > 0.3 && !a.stuck) ? 0.05 : 0;
  const v = 0.25 + p.loyalty / 150 + p.mood / 300 + traitMod(p.traits, 'comply') - risk - conflict;
  return Math.max(0.05, Math.min(0.98, v));
}

function jobCands(c: Ctx, p: Person, age: number): Cand[] {
  if (age < COMING_OF_AGE || !workHours(c, p)) return [];
  const out: Cand[] = [];
  const elder = age >= 60;
  for (const job of c.st.jobs) {
    const mine = p.job === job.id;
    if (!mine && job.claimed.length >= job.slots) continue;
    if (job.minSkill && job.skill && p.skills[job.skill].lv < job.minSkill) continue;
    if (elder && job.risky) continue;
    const refused = p.counters[`refuse:${job.id}`];
    if (refused !== undefined && refused > c.day) continue;
    const lv = job.skill ? p.skills[job.skill].lv : 0;
    const dist = distanceTo(c, p, job.goal);
    let score = (job.priority / 3) * (0.7 + 0.06 * lv) * Math.max(0.3, 1 + traitMod(p.traits, 'work')) * (1 / (1 + dist / 40));
    score *= priorityMult(c, job);
    if (mine) score *= 1.25;
    if (p.needs.rest < 30) score *= 0.6;
    if (p.mood < 30) score *= 0.7;
    if (elder) score *= 0.7;
    if (p.ambitions.some((a) => a.kind === 'earn_trust' && !a.ended)) score *= 1.2;
    out.push({ goal: job.goal, source: 'job', score, label: job.label, jobId: job.id });
  }
  return out;
}

/** A person to talk to: someone awake and free, preferably a friend, not an enemy. */
export function pickCompany(c: Ctx, p: Person, wantRomance = false): Person | null {
  let best: Person | null = null;
  let bs = -Infinity;
  for (const o of c.people) {
    if (o.id === p.id || !isFree(o) || o.hidden || ageOf(o, c.day) < 3) continue;
    const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
    if (d > 40) continue;
    const r = peekRel(p, o.id);
    let s = compat(p, o) * 0.6 + (r?.fam ?? 0) / 100 + (r?.aff ?? 0) / 100 - d / 60 + c.rng.next() * 0.3;
    if (wantRomance && o.sex === p.sex) s -= 1;
    if (r && r.aff < -25) s -= 1;
    if (s > bs) {
      bs = s;
      best = o;
    }
  }
  return best;
}

function leisureCands(c: Ctx, p: Person, age: number): Cand[] {
  const out: Cand[] = [];
  const night = isNight(c, p);
  if (night) return out;
  const social = 1 + traitMod(p.traits, 'social');
  const child = age < COMING_OF_AGE;
  if (child) {
    out.push({ goal: { kind: 'act', action: 'play', label: 'play with the others' }, source: 'leisure', score: 0.7, label: 'play with the others' });
  }
  const mate = pickCompany(c, p);
  if (mate) {
    const lonely = 1 + (100 - p.needs.company) / 60;
    out.push({ goal: { kind: 'act', action: 'chat', who: mate.id, label: `have a chat with ${mate.name}` }, source: 'leisure', score: 0.22 * Math.max(0.2, social) * lonely * (child ? 1.5 : 1), label: `have a chat with ${mate.name}` });
  }
  const faith = traitMod(p.traits, 'faith');
  if (!child) out.push({ goal: { kind: 'act', action: 'pray', label: 'pray at the shrine' }, source: 'leisure', score: 0.12 + Math.max(0, faith) * 0.5, label: 'pray at the shrine' });
  out.push({ goal: { kind: 'act', action: 'wander', label: 'wander about' }, source: 'leisure', score: 0.1 * (1 + Math.max(0, traitMod(p.traits, 'curious'))) + (child ? 0.15 : 0), label: 'wander about' });
  // The idle and the sullen slack off when they are not pressed.
  const lazy = Math.max(0, -traitMod(p.traits, 'work'));
  if (!child && lazy > 0 && workHours(c, p)) out.push({ goal: { kind: 'act', action: 'neglect_duty', label: 'slack off' }, source: 'leisure', score: 0.25 * lazy * 2, label: 'slack off' });
  // Kind people look after the downhearted.
  if (traitMod(p.traits, 'kind') > 0.3) {
    for (const o of nearbyPeople(c, p.x, p.y, 15, p.id)) {
      if (o.mood < 30 && isFree(o)) {
        out.push({ goal: { kind: 'act', action: 'comfort', who: o.id, label: `comfort ${o.name}` }, source: 'leisure', score: 0.6 * traitMod(p.traits, 'kind'), label: `comfort ${o.name}` });
        break;
      }
    }
  }
  // Grudges come out in a quarrel now and then.
  const g = worstGrudge(p);
  if (g && g.who !== undefined && traitMod(p.traits, 'temper') > 0.2 && c.rng.chance(0.15)) {
    const o = c.person(g.who);
    // Not the same row again within three days.
    if (o && isFree(o) && (p.counters[`quarrelAt:${o.id}`] ?? -99) < c.day - 3) out.push({ goal: { kind: 'act', action: 'quarrel', who: o.id, label: `have it out with ${o.name}` }, source: 'leisure', score: 0.3 * traitMod(p.traits, 'temper'), label: `have it out with ${o.name}` });
  }
  // A hungry thief with nothing to do goes to the store.
  if (!child && traitMod(p.traits, 'crime') > 0.3 && p.needs.food < 35 && (c.st.stock.ration ?? 0) > 5) out.push({ goal: { kind: 'act', action: 'steal', label: 'take food from the store' }, source: 'leisure', score: 0.5 * traitMod(p.traits, 'crime'), label: 'take food from the store' });
  return out;
}

export function candidates(c: Ctx, p: Person): Cand[] {
  const age = ageOf(p, c.day);
  const needs = needCands(c, p);
  // A critical need beats everything.
  if (needs.some((n) => n.score > 40)) return needs.filter((n) => n.score > 40);
  const out = [...needs];
  const calm = p.needs.food > 35 && p.needs.water > 35 && p.needs.rest > 30;
  if (!isNight(c, p) && calm) {
    out.push(...jobCands(c, p, age));
    if (age >= COMING_OF_AGE) out.push(...ambitionCands(c, p));
  }
  out.push(...leisureCands(c, p, age));
  return out;
}

export function goalKeyOf(g: Goal): string {
  return g.kind === 'need' ? `n:${g.need}` : g.kind === 'stock' ? `s:${g.good}` : `a:${g.action}:${g.who ?? ''}:${g.plot ?? ''}:${g.order ?? ''}:${g.good ?? ''}`;
}

/**
 * Pick the goal: the best score, unless the current goal is still fresh and no new one beats it by 25%.
 * Returns the sorted list so the caller can fall through to the next when a goal has no plan.
 */
export function rank(c: Ctx, p: Person, cands: Cand[]): Cand[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const cur = p.goal;
  if (cur && c.now - p.goalSince < KEEP_MS) {
    const key = goalKeyOf(cur);
    const same = sorted.find((x) => goalKeyOf(x.goal) === key);
    if (same && sorted[0] && sorted[0].score < same.score * SWITCH_RATIO) return [same, ...sorted.filter((x) => x !== same)];
  }
  return sorted;
}
