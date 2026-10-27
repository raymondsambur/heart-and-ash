/**
 * The manager's levers (M4): priorities per kind of work, and standing rules. Priorities scale how attractive a job is to the
 * people who choose among the jobs on the board (see `goals.ts`); rules look at the village once a game hour and act while their
 * condition holds, which is how the village is looked after while the manager is away.
 */
import {
  BLUEPRINTS,
  BUILD_RULE_COOLDOWN,
  MAX_RULES,
  DEFAULT_PRIORITY,
  JOB_GROUPS,
  BAL,
  METRIC_LABEL,
  PRIORITY_LABEL,
  PRIORITY_MULT,
  RULE_METRICS,
  groupOfJob,
  placementsFor,
  type BuildKind,
  type JobGroup,
  type RuleAct,
  type RuleCond,
  type RuleDef,
  type RuleMetric,
} from '@hearth/shared';
import { placeOrder } from './construct';
import type { Ctx } from './ctx';
import { foodDaysOf, fuelDaysOf } from './economy';
import { pushFeed } from './feed';
import type { CommandResult, Job, Rule } from './types';
import { stat } from './util';

const fail = (code: string, text: string): CommandResult => ({ ok: false, code, text });

export function defaultPriorities(): number[] {
  return JOB_GROUPS.map(() => DEFAULT_PRIORITY);
}

/** How much the manager's priority scales a job: 1 for work that belongs to no group. */
export function priorityMult(c: Ctx, job: Job): number {
  const g = groupOfJob(job.type);
  if (!g) return 1;
  const level = c.st.priorities[JOB_GROUPS.indexOf(g)] ?? DEFAULT_PRIORITY;
  return PRIORITY_MULT[Math.max(0, Math.min(PRIORITY_MULT.length - 1, level))];
}

export function setPriority(c: Ctx, group: JobGroup, level: number): CommandResult {
  const i = JOB_GROUPS.indexOf(group);
  if (i < 0) return fail('bad_group', 'That kind of work is not known.');
  if (!Number.isInteger(level) || level < 0 || level >= PRIORITY_MULT.length) return fail('bad_level', 'Priorities go from off to urgent.');
  c.st.priorities[i] = level;
  return { ok: true, text: `${groupLabel(group)}: ${PRIORITY_LABEL[level].toLowerCase()}.` };
}

function groupLabel(g: JobGroup): string {
  return g === 'wood' ? 'Wood' : g === 'care' ? 'Care' : g === 'crafts' ? 'Crafts' : g[0].toUpperCase() + g.slice(1);
}

// ---------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------

export function metricOf(c: Ctx, m: RuleMetric): number {
  const st = c.st;
  switch (m) {
    case 'foodDays':
      return foodDaysOf(c);
    case 'fuelDays':
      return Math.min(99, fuelDaysOf(c));
    case 'population':
      return c.people.length;
    case 'houses':
      return st.buildings.filter((b) => b.kind === 'house' && !b.con).length;
    case 'fields':
      return st.plots.filter((p) => p.kind === 'field' && !p.con).length;
    case 'shrines':
    case 'watchposts':
    case 'walls': {
      const kind = m === 'shrines' ? 'shrine' : m === 'watchposts' ? 'watchpost' : 'wall';
      return st.buildings.filter((b) => b.kind === kind && !b.con).length;
    }
    case 'wood':
    case 'stone':
    case 'planks':
      return st.stock[m] ?? 0;
    case 'mood':
      return c.people.length ? c.people.reduce((s, p) => s + p.mood, 0) / c.people.length : 0;
    case 'sick':
      return c.people.filter((p) => p.ills.some((i) => i.id === 'fever' || i.id === 'plague')).length;
    case 'season':
      return c.season;
    case 'raid':
      return st.dir.raid ? 1 : 0;
  }
}

export function condHolds(c: Ctx, cond: RuleCond): boolean {
  const v = metricOf(c, cond.metric);
  return cond.op === '<' ? v < cond.value : cond.op === '>' ? v > cond.value : Math.abs(v - cond.value) < 0.5;
}

export function describeAct(act: RuleAct): string {
  switch (act.t) {
    case 'ration':
      return `set the rations to ${['normal', 'tight', 'strict'][act.level]}`;
    case 'priority':
      return `set ${groupLabel(act.group).toLowerCase()} to ${PRIORITY_LABEL[act.level]?.toLowerCase() ?? '?'}`;
    case 'build':
      return `order a ${BLUEPRINTS[act.kind]?.label?.toLowerCase() ?? act.kind}`;
  }
}

export function describeRule(r: RuleDef): string {
  return `if ${METRIC_LABEL[r.cond.metric]} ${r.cond.op} ${r.cond.value}, ${describeAct(r.act)}`;
}

/** Where raiders and strangers come from: the far end of the main street. */
function approachOf(c: Ctx): { x: number; y: number } | null {
  const e = c.sites.ofKind('edge')[0];
  return e ? { x: e.x, y: e.y } : null;
}

/** The best place for a kind of building (see `shared/data/placement.ts`), or null when there is no room. */
export function autoSpot(c: Ctx, kind: BuildKind): { x: number; y: number; rot: boolean } | null {
  const best = placementsFor({ world: c.world, buildings: c.st.buildings, plots: c.st.plots }, kind, { approach: approachOf(c) }, 1)[0];
  return best ? { x: best.x, y: best.y, rot: best.rot } : null;
}

/** Apply a rule's action. Returns whether something changed. */
function apply(c: Ctx, r: Rule): boolean {
  const act = r.act;
  if (act.t === 'ration') {
    if (c.st.rationing === act.level) return false;
    c.st.rationing = act.level;
    return true;
  }
  if (act.t === 'priority') {
    const i = JOB_GROUPS.indexOf(act.group);
    if (i < 0 || c.st.priorities[i] === act.level) return false;
    c.st.priorities[i] = act.level;
    return true;
  }
  // build: one at a time, and not more often than every few days
  if (c.day - r.last < BUILD_RULE_COOLDOWN) return false;
  if (c.st.orders.some((o) => o.kind === act.kind && o.mode === 'build')) return false;
  // The best places first; one the builders could not reach from the green is dropped and the next tried.
  const spots = placementsFor({ world: c.world, buildings: c.st.buildings, plots: c.st.plots }, act.kind, { approach: approachOf(c) }, 6);
  for (const spot of spots) {
    if (!placeOrder(c, act.kind, spot.x, spot.y, spot.rot, null).ok) continue;
    r.last = c.day;
    return true;
  }
  return false;
}

/** Look at every rule; called once a game hour. A rule speaks in the feed when it starts to hold or when it changes something. */
export function runRules(c: Ctx): void {
  for (const r of c.st.rules) {
    if (!r.enabled) {
      r.active = false;
      continue;
    }
    const holds = condHolds(c, r.cond);
    const was = r.active;
    r.active = holds;
    if (!holds) continue;
    const changed = apply(c, r);
    if (changed || !was) {
      if (changed) {
        stat(c, 'rules_fired');
        pushFeed(c.st, c.pending, 'rule', `Rule: ${describeRule(r)}.${c.st.away ? ' (while you were away)' : ''}`);
      }
    }
  }
}

function valid(rule: RuleDef): string | null {
  const m = rule.cond?.metric;
  if (!RULE_METRICS.includes(m)) return 'That condition is not known.';
  if (!['<', '>', '='].includes(rule.cond.op)) return 'That comparison is not known.';
  if (!Number.isFinite(rule.cond.value) || Math.abs(rule.cond.value) > 100000) return 'That number is out of range.';
  const a = rule.act;
  if (!a) return 'A rule needs an action.';
  if (a.t === 'ration' && ![0, 1, 2].includes(a.level)) return 'Rations go from normal to strict.';
  if (a.t === 'priority' && (!JOB_GROUPS.includes(a.group) || !Number.isInteger(a.level) || a.level < 0 || a.level >= PRIORITY_MULT.length)) return 'That priority is not known.';
  if (a.t === 'build' && !BLUEPRINTS[a.kind]) return 'The village cannot build that.';
  if (!['ration', 'priority', 'build'].includes(a.t)) return 'That action is not known.';
  return null;
}

/** Add a rule (`id` 0) or replace one. */
export function setRule(c: Ctx, rule: RuleDef): CommandResult {
  const bad = valid(rule);
  if (bad) return fail('bad_rule', bad);
  const st = c.st;
  if (rule.id === 0) {
    const cap = Math.min(MAX_RULES, BAL.tiers.maxRules[st.tier]);
    if (st.rules.length >= cap) return fail('too_many_rules', `A settlement of this size can keep ${cap} rules. Remove one first.`);
    st.rules.push({ id: st.nextRuleId++, enabled: rule.enabled !== false, cond: { ...rule.cond }, act: { ...rule.act } as RuleAct, active: false, last: -1e9 });
    return { ok: true, text: 'Rule added.' };
  }
  const old = st.rules.find((r) => r.id === rule.id);
  if (!old) return fail('no_rule', 'That rule is gone.');
  old.enabled = rule.enabled !== false;
  old.cond = { ...rule.cond };
  old.act = { ...rule.act } as RuleAct;
  old.active = false;
  return { ok: true, text: 'Rule changed.' };
}

export function deleteRule(c: Ctx, id: number): CommandResult {
  const i = c.st.rules.findIndex((r) => r.id === id);
  if (i < 0) return fail('no_rule', 'That rule is gone.');
  c.st.rules.splice(i, 1);
  return { ok: true, text: 'Rule removed.' };
}
