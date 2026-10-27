/**
 * The job board (docs/notes/m1-agent-brain-spec.md, section 9): open work posted from the village's standing production and
 * its needs. A job has a goal, a priority, a number of places and a list of the people who claimed it. People score open jobs
 * by skill, distance, priority and traits and claim one (see goals.ts). M2 adds build and demolish orders, M4 the manager's
 * priority sliders as multipliers per job type.
 */
import { ACTIONS, STOCK_GOALS, type SkillId } from '@hearth/shared';
import { GROW_DAYS, TEND_HOURS, fieldName } from './actions';
import { constructionJobs, outstanding } from './construct';
import type { Ctx } from './ctx';
import type { Goal, Job } from './types';

export interface Draft {
  key: string;
  type: string;
  goal: Goal;
  priority: number;
  slots: number;
  minSkill?: number;
  skill?: SkillId;
  risky?: boolean;
  label: string;
}

export function draft(key: string, goal: Goal, priority: number, slots: number, o: Partial<Draft> = {}): Draft {
  const place = goal.kind === 'act' ? ACTIONS[goal.action]?.at : undefined;
  return { key, type: key.split(':')[0], goal, priority, slots, label: goal.label, ...o, ...(place ? {} : {}) };
}

/** What the village needs doing now. */
export function wanted(c: Ctx): Draft[] {
  const st = c.st;
  const out: Draft[] = [];
  const eaters = Math.max(1, c.people.length);
  const food = (st.stock.ration ?? 0) + (st.stock.meal ?? 0) * 1.15;
  const days = food / eaters;
  const season = c.season;

  // fields
  for (const f of st.fields) {
    const name = fieldName(c, f);
    if (f.state === 'fallow' && season < 2) out.push(draft(`plant:${f.plot}`, { kind: 'act', action: 'plant', plot: f.plot, label: `plant the ${name} field` }, 4, 3, { skill: 'farming' }));
    if (f.state === 'growing' && f.tended < (TEND_HOURS * (f.grown + 4)) / GROW_DAYS && season < 3) out.push(draft(`tend:${f.plot}`, { kind: 'act', action: 'tend_crops', plot: f.plot, label: `tend the ${name} field` }, 2, 1, { skill: 'farming' }));
    if (f.state === 'ripe' && f.left > 1) out.push(draft(`harvest:${f.plot}`, { kind: 'act', action: 'harvest', plot: f.plot, label: `bring in the ${name} harvest` }, 5, 6, { skill: 'farming' }));
  }

  // food from the wild
  if (days < 22) {
    const need = days < 8 ? 5 : days < 14 ? 4 : 3;
    const slots = Math.min(4, Math.max(1, Math.ceil((22 - days) / 5)));
    if (season < 3) out.push(draft('forage:food', { kind: 'stock', good: 'ration', label: 'forage for food' }, need, slots, { skill: 'foraging' }));
    out.push(draft('fish:food', { kind: 'act', action: 'fish', label: 'fish in the stream' }, Math.max(2, need - 1), Math.min(2, slots), { skill: 'foraging' }));
    out.push(draft('hunt:food', { kind: 'act', action: 'hunt', label: 'hunt in the forest' }, Math.max(2, need - 1), Math.min(2, slots), { skill: 'hunting', risky: true }));
  }
  // wood
  const woodTarget = season === 3 ? 150 : season === 2 ? 600 : 400;
  const wood = st.stock.wood ?? 0;
  if (wood < woodTarget) out.push(draft('wood:stock', { kind: 'stock', good: 'wood', label: 'cut wood' }, wood < 100 ? 5 : season === 2 ? 4 : 3, Math.min(4, Math.max(1, Math.ceil((woodTarget - wood) / 120))), { skill: 'woodcraft' }));
  // What the builders still need counts on top of the usual stock, so a house that waits for planks makes planks.
  const owed = outstanding(c);
  const stoneGoal = (STOCK_GOALS.stone ?? 100) + (owed.stone ?? 0);
  const planksGoal = (STOCK_GOALS.planks ?? 60) + (owed.planks ?? 0);
  if ((st.stock.stone ?? 0) < stoneGoal) out.push(draft('stone:stock', { kind: 'stock', good: 'stone', label: 'quarry stone' }, (owed.stone ?? 0) > (st.stock.stone ?? 0) ? 4 : 2, (owed.stone ?? 0) > 0 ? 2 : 1, { skill: 'mining' }));
  if ((st.stock.planks ?? 0) < planksGoal && wood > 40) out.push(draft('planks:stock', { kind: 'act', action: 'saw_planks', label: 'saw planks' }, (owed.planks ?? 0) > (st.stock.planks ?? 0) ? 4 : 2, (owed.planks ?? 0) > 0 ? 2 : 1, { skill: 'woodcraft' }));
  if (season < 3 && (st.stock.thatch ?? 0) < 12 + (owed.thatch ?? 0)) out.push(draft('thatch:stock', { kind: 'stock', good: 'thatch', label: 'cut thatch' }, (owed.thatch ?? 0) > (st.stock.thatch ?? 0) ? 4 : 2, 1, { skill: 'foraging' }));
  if ((st.stock.herb ?? 0) < 12 && season < 3) out.push(draft('herbs:stock', { kind: 'stock', good: 'herb', label: 'gather herbs' }, 2, 1, { skill: 'foraging' }));
  if ((st.stock.herb ?? 0) >= 3 && (st.stock.cloth ?? 0) < 12) out.push(draft('cloth:stock', { kind: 'act', action: 'weave_cloth', label: 'weave cloth' }, 2, 1, { skill: 'crafting' }));
  if ((st.stock.tool ?? 0) < 3 && wood >= 3) out.push(draft('tool:stock', { kind: 'act', action: 'make_tool', label: 'make tools' }, 3, 1, { skill: 'crafting' }));
  // cooking
  if ((st.stock.ration ?? 0) >= 2 && (st.stock.meal ?? 0) < eaters * 1.2) out.push(draft('cook:meals', { kind: 'act', action: 'cook', label: 'cook for the village' }, 3, 2, { skill: 'cooking' }));
  // the dead
  if (st.graves.some((g) => !g.buried)) out.push(draft('funeral:dead', { kind: 'act', action: 'bury_dead', label: 'bury the dead' }, 5, 3));
  // the village's builders
  out.push(...constructionJobs(c, draft));
  return out;
}

/** Reconcile the board with what is wanted, keeping ids and claims of jobs that continue. */
export function refreshJobs(c: Ctx): void {
  const st = c.st;
  const want = wanted(c);
  const old = new Map<string, Job>();
  for (const j of st.jobs) old.set(j.key, j);
  const next: Job[] = [];
  for (const d of want) {
    const prev = old.get(d.key);
    const claimed = prev ? prev.claimed.filter((id) => c.person(id) && c.person(id)!.job === prev.id) : [];
    next.push({
      id: prev?.id ?? st.nextJobId++,
      key: d.key,
      type: d.type,
      goal: d.goal,
      priority: d.priority,
      slots: d.slots,
      claimed,
      minSkill: d.minSkill,
      skill: d.skill,
      risky: d.risky,
      label: d.label,
    });
  }
  st.jobs = next;
  // anyone whose job disappeared is free again
  const ids = new Set(next.map((j) => j.id));
  for (const p of c.people) if (p.job !== null && !ids.has(p.job)) p.job = null;
}
