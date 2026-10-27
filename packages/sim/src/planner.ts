/**
 * The planner: GOAP-lite (docs/notes/m1-agent-brain-spec.md, section 9). Given a goal it searches sequences of action
 * templates (depth at most 6, at most 200 nodes expanded) over an abstract state: where the person is (as a kind of place),
 * what is in their hands, whether they have a tool, what the village store holds and what they know exists. Preconditions
 * that fail become sub-goals by search: no food in the store, so forage, so go to the meadow I know about.
 *
 * Plans are cached by (goal, coarse state) and the executor re-validates each step when it starts it.
 */
import { ACTION_LIST, ACTIONS, GOODS, MEAL_PORTION, STEP_MS, GAME_HOUR_MS, type ActionDef, type Good, type NeedId, type PlaceKind } from '@hearth/shared';
import type { SiteIndex } from './sites';
import type { Field, Goal, Person, SimState, Step } from './types';
import { actionHour } from '@hearth/shared';

export const MAX_DEPTH = 6;
export const MAX_NODES = 200;
/** Game minutes to walk one tile. */
const MIN_PER_TILE = STEP_MS / (GAME_HOUR_MS / 60);

export interface PlanWorld {
  st: Pick<SimState, 'stock' | 'fields'>;
  sites: SiteIndex;
  hour: number;
  season: number;
}

export interface PlanResult {
  steps: Step[];
  cost: number;
}

export type PlanFailure = { blocked: string };

interface PS {
  at: PlaceKind;
  holds: Good | null;
  tool: boolean;
  need: number;
  gained: number;
  done: boolean;
  /** What is in the hands came out of the village store (so putting it back does not add to the stock). */
  fetched: boolean;
}

interface Node {
  s: PS;
  cost: number;
  depth: number;
  prev: Node | null;
  step: Step | null;
}

/** What the person may do right now: active actions with a plan, enough skill, the right season and hour. */
function usable(p: Person, w: PlanWorld, extra?: string): ActionDef[] {
  const out: ActionDef[] = [];
  for (const d of ACTION_LIST) {
    if (!d.active) continue;
    if (!d.plan && d.id !== extra) continue;
    // The builders' acts belong to their orders: only a goal that names one may use it (not "empty my hands").
    if (d.group === 'construction' && d.id !== extra) continue;
    if (d.at === 'person') continue;
    if (d.skill && d.minSkill && p.skills[d.skill].lv < d.minSkill) continue;
    if (d.seasons && !d.seasons.includes(w.season)) continue;
    if (!actionHour(d, w.hour)) continue;
    out.push(d);
  }
  return out;
}

function fieldFlags(fields: readonly Field[], known: ReadonlySet<number>, sites: SiteIndex): { ripe: boolean; fallow: boolean; growing: boolean } {
  const f = { ripe: false, fallow: false, growing: false };
  for (const s of sites.ofKind('field')) {
    if (!known.has(s.id)) continue;
    const fl = fields.find((x) => x.plot === s.plot);
    if (!fl) continue;
    if (fl.state === 'ripe' && fl.left > 1) f.ripe = true;
    else if (fl.state === 'fallow') f.fallow = true;
    else if (fl.state === 'growing') f.growing = true;
  }
  return f;
}

/**
 * Representative site of each kind for travel estimates: the one nearest the plaza. Deliberately independent of who is
 * asking and where they stand, so a plan depends only on its cache key (plans are shared between people and survive a
 * save and load unchanged).
 */
const REPS = new WeakMap<SiteIndex, Map<PlaceKind, { x: number; y: number }>>();
function reps(w: PlanWorld): Map<PlaceKind, { x: number; y: number }> {
  let m = REPS.get(w.sites);
  if (m) return m;
  m = new Map();
  const c = w.sites.world.start.center;
  const kinds: PlaceKind[] = ['home', 'store', 'field', 'water', 'stream', 'forest', 'quarry', 'meadow', 'plaza', 'shrine', 'edge'];
  for (const k of kinds) {
    const s = w.sites.nearest(k, c.x, c.y, null);
    if (s) m.set(k, { x: s.x, y: s.y });
  }
  REPS.set(w.sites, m);
  return m;
}

function portionFor(next: ActionDef | undefined, good: Good): number {
  if (!next) return 5;
  switch (next.id) {
    case 'eat':
      return MEAL_PORTION;
    case 'cook':
    case 'brew_wine':
      return 3;
    case 'light_fire':
      return 2;
    case 'saw_planks':
      return 5;
    case 'make_tool':
    case 'weave_cloth':
    case 'sew_clothing':
    case 'dress_cold':
    case 'treat_wound':
      return 1;
    default:
      return good === 'herb' ? 2 : 5;
  }
}

/** The goal as a stable key for the cache. */
export function goalKey(g: Goal): string {
  switch (g.kind) {
    case 'need':
      return `n:${g.need}`;
    case 'stock':
      return `s:${g.good}`;
    case 'act':
      return `a:${g.action}:${g.good ?? ''}`;
  }
}

const cache = new Map<string, PlanResult | PlanFailure>();
const CACHE_MAX = 4000;

export function clearPlanCache(): void {
  cache.clear();
}

/** The executor writes into steps (the tile, the person), so every caller gets its own copy of a cached plan. */
function copy(r: PlanResult | PlanFailure): PlanResult | PlanFailure {
  return 'steps' in r ? { steps: r.steps.map((s) => ({ ...s })), cost: r.cost } : r;
}

export function plan(p: Person, goal: Goal, w: PlanWorld): PlanResult | PlanFailure {
  const known = new Set(p.known);
  // Acts aimed at a person, and acts with no preconditions, need no search: one step.
  if (goal.kind === 'act') {
    const def = ACTIONS[goal.action];
    if (def && (!def.plan || def.at === 'person')) {
      if (!def.active) return { blocked: 'that is not possible yet' };
      if (def.skill && def.minSkill && p.skills[def.skill].lv < def.minSkill) return { blocked: `needs ${def.skill} level ${def.minSkill}` };
      if (def.seasons && !def.seasons.includes(w.season)) return { blocked: 'not the season for it' };
      const placeKnown = def.at === 'here' || def.at === 'person' || def.at === 'buildsite' || (def.at === 'home' ? p.home !== null : w.sites.ofKind(def.at).some((s) => known.has(s.id)));
      if (!placeKnown) return { blocked: def.at === 'home' ? 'has no home' : 'does not know where to go for it' };
      return { steps: [{ a: def.id, at: def.at, who: goal.who, plot: goal.plot, site: goal.site, order: goal.order }], cost: def.minutes };
    }
  }
  // Bed is bed: going to sleep needs no search, and it must work even when they are not yet worn out (night time).
  if (goal.kind === 'need' && goal.need === 'rest' && p.home !== null) return { steps: [{ a: 'sleep', at: 'home' }], cost: ACTIONS.sleep.minutes };
  const kindKnown = (k: PlaceKind): boolean => k === 'here' || k === 'buildsite' || (k === 'home' ? p.home !== null : w.sites.ofKind(k).some((s) => known.has(s.id)));
  const extra = goal.kind === 'act' ? goal.action : undefined;
  const acts = usable(p, w, extra);
  const ff = fieldFlags(w.st.fields, known, w.sites);
  const store = (g: Good): boolean => (w.st.stock[g] ?? 0) >= (g === 'ration' || g === 'meal' ? 0.5 : 1);
  const startKind = ((): PlaceKind => {
    for (const s of w.sites.sites) if (Math.abs(s.x - p.x) <= 1 && Math.abs(s.y - p.y) <= 1 && (s.kind !== 'field' || true)) return s.kind === 'stream' ? 'water' : s.kind;
    return 'here';
  })();
  const key = [
    goalKey(goal),
    startKind,
    p.carrying?.good ?? '-',
    p.inv.tool > 0 ? 1 : 0,
    GOODS.map((g) => (store(g) ? 1 : 0)).join(''),
    ff.ripe ? 1 : 0,
    ff.fallow ? 1 : 0,
    ff.growing ? 1 : 0,
    acts.map((a) => a.id).join(','),
    [...new Set(w.sites.sites.filter((s) => known.has(s.id)).map((s) => s.kind))].sort().join(''),
    p.home !== null ? 1 : 0,
    goal.kind === 'need' ? Math.floor(p.needs[goal.need] / 25) : 0,
  ].join('|');
  const hit = cache.get(key);
  if (hit) return copy(hit);

  const res = search(p, goal, w, acts, ff, store, kindKnown, startKind, known);
  if (cache.size > CACHE_MAX) cache.clear();
  cache.set(key, res);
  return copy(res);
}

function search(p: Person, goal: Goal, w: PlanWorld, acts: ActionDef[], ff: { ripe: boolean; fallow: boolean; growing: boolean }, store: (g: Good) => boolean, kindKnown: (k: PlaceKind) => boolean, startKind: PlaceKind, known: ReadonlySet<number>): PlanResult | PlanFailure {
  const rep = reps(w);
  const travel = (from: PlaceKind, to: PlaceKind): number => {
    if (to === 'here' || from === to) return 0;
    // Somewhere unplaced ("here") is taken to be a short walk from anything.
    if (from === 'here') return 8 * MIN_PER_TILE;
    const a = rep.get(from);
    const b = rep.get(to);
    if (!a || !b) return 12;
    return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * MIN_PER_TILE;
  };
  const needTarget = goal.kind === 'need' ? 70 : 0;
  // The need level is taken at the same coarse step the cache key uses, so a plan is the same for everyone with that key.
  const start: PS = { at: startKind, holds: p.carrying?.good ?? null, tool: p.inv.tool > 0, need: goal.kind === 'need' ? Math.floor(p.needs[goal.need] / 25) * 25 : 0, gained: 0, done: false, fetched: false };
  const isGoal = (s: PS): boolean => (goal.kind === 'need' ? s.need >= needTarget : goal.kind === 'stock' ? s.gained >= 1 : s.done);
  if (isGoal(start)) return { steps: [], cost: 0 };

  const keyOf = (s: PS): string => `${s.at}|${s.holds}|${s.tool ? 1 : 0}|${Math.floor(s.need / 10)}|${s.gained}|${s.done ? 1 : 0}|${s.fetched ? 1 : 0}`;
  const open: Node[] = [{ s: start, cost: 0, depth: 0, prev: null, step: null }];
  const best = new Map<string, number>([[keyOf(start), 0]]);
  let expanded = 0;

  while (open.length && expanded < MAX_NODES) {
    // cheapest first (the open list is small)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].cost < open[bi].cost) bi = i;
    const node = open.splice(bi, 1)[0];
    if (isGoal(node.s)) return finish(node, acts);
    if (node.depth >= MAX_DEPTH) continue;
    expanded++;
    const s = node.s;

    const push = (step: Step, def: ActionDef, ns: PS, minutes: number): void => {
      const cost = node.cost + travel(s.at, def.at) + minutes;
      const k = keyOf(ns);
      const prev = best.get(k);
      if (prev !== undefined && prev <= cost) return;
      best.set(k, cost);
      open.push({ s: ns, cost, depth: node.depth + 1, prev: node, step });
    };

    for (const d of acts) {
      const pl = d.plan;
      if (!kindKnown(d.at)) continue;
      const minutes = Math.max(1, d.minutes);

      if (d.id === 'take_item') {
        // fetch a good (or a tool) from the store; one variant per good
        for (const g of GOODS) {
          if (!store(g)) continue;
          // Fetching for a building site: only the good that is wanted.
          if (goal.kind === 'act' && goal.good && g !== goal.good) continue;
          if (g === 'tool') {
            if (s.tool) continue;
            push({ a: 'take_item', at: 'store', good: 'tool', n: 1 }, d, { ...s, at: 'store', tool: true }, minutes);
            continue;
          }
          if (s.holds !== null) continue;
          push({ a: 'take_item', at: 'store', good: g, n: 5 }, d, { ...s, at: 'store', holds: g, fetched: true, done: s.done || (goal.kind === 'act' && goal.action === 'take_item' && g === 'ration') }, minutes);
        }
        continue;
      }

      // preconditions
      if (pl?.holds) {
        if (pl.holds === 'empty' && s.holds !== null) continue;
        if (pl.holds === 'any' && s.holds === null) continue;
        if (pl.holds === 'food' && s.holds !== 'ration' && s.holds !== 'meal') continue;
        if (pl.holds !== 'empty' && pl.holds !== 'any' && pl.holds !== 'food' && s.holds !== pl.holds) continue;
      }
      if (pl?.tool && !s.tool) continue;
      if (pl?.field === 'ripe' && !ff.ripe) continue;
      if (pl?.field === 'fallow' && !ff.fallow) continue;
      if (pl?.field === 'growing' && !ff.growing) continue;

      // effects
      const ns: PS = { ...s, at: d.at === 'here' ? s.at : d.at };
      if (d.at === 'water') ns.at = 'water';
      const heldBefore = s.holds;
      // A fetched load is several meals: eating takes a portion and the rest stays in the hands.
      if (pl?.gives !== undefined && d.id !== 'eat') {
        ns.holds = pl.gives === 'empty' ? null : pl.gives;
        ns.fetched = false;
      }
      if (pl?.stores && heldBefore && goal.kind === 'stock' && heldBefore === goal.good && !s.fetched) ns.gained = s.gained + 1;
      if (goal.kind === 'need' && pl?.need && pl.need[goal.need] !== undefined) {
        let gain = pl.need[goal.need]!;
        if (d.id === 'eat' && heldBefore === 'meal') gain += 5;
        ns.need = Math.min(100, s.need + gain);
      }
      if (goal.kind === 'act' && d.id === goal.action) ns.done = true;
      // no-ops are not steps
      if (ns.at === s.at && ns.holds === s.holds && ns.tool === s.tool && ns.need === s.need && ns.gained === s.gained && ns.done === s.done && ns.fetched === s.fetched) continue;
      // production steps only help when they make something the goal can use: prune dead ends cheaply
      push({ a: d.id, at: d.at }, d, ns, minutes);
    }
  }
  return { blocked: blockReason(p, goal, w, ff, store, kindKnown) };
}

function finish(node: Node, acts: ActionDef[]): PlanResult {
  const steps: Step[] = [];
  for (let n: Node | null = node; n && n.step; n = n.prev) steps.push({ ...n.step });
  steps.reverse();
  // size the loads by what comes next
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.a === 'take_item' && st.good && st.good !== 'tool') {
      const next = steps[i + 1] ? acts.find((a) => a.id === steps[i + 1].a) ?? ACTIONS[steps[i + 1].a] : undefined;
      st.n = portionFor(next, st.good);
      // Several meals in a row are fetched in one go.
      if (next?.id === 'eat') {
        let eats = 0;
        while (steps[i + 1 + eats]?.a === 'eat') eats++;
        st.n *= Math.max(1, eats);
      }
    }
  }
  return { steps, cost: node.cost };
}

/** Why there is no plan, in a sentence a player can read. */
function blockReason(p: Person, goal: Goal, w: PlanWorld, ff: { ripe: boolean; fallow: boolean; growing: boolean }, store: (g: Good) => boolean, kindKnown: (k: PlaceKind) => boolean): string {
  if (goal.kind === 'need') {
    switch (goal.need) {
      case 'food':
        if (!store('ration') && !store('meal') && !kindKnown('meadow') && !kindKnown('stream') && !kindKnown('forest') && !ff.ripe) return 'no food in the store and no known place to find any';
        return 'no known way to get food right now';
      case 'water':
        return 'no known source of water';
      case 'warmth':
        return p.home === null ? 'nowhere warm to go' : 'no way to get warm: no wood for the hearth';
      case 'rest':
        return p.home === null ? 'no bed to sleep in' : 'cannot get to bed';
      default:
        return 'no way to feel better about it';
    }
  }
  if (goal.kind === 'stock') return `no known way to bring in ${goal.good}`;
  const def = ACTIONS[goal.action];
  if (def?.skill && def.minSkill && p.skills[def.skill].lv < def.minSkill) return `needs ${def.skill} level ${def.minSkill}`;
  if (def?.seasons && !def.seasons.includes(w.season)) return 'not the season for it';
  if (def && !kindKnown(def.at)) return `does not know where to go for it`;
  return `no way to do it with what they know`;
}

/** The steps in words, for the explanation. */
export function planText(steps: readonly Step[], from = 0): string {
  const parts: string[] = [];
  for (let i = from; i < steps.length; i++) {
    const s = steps[i];
    const d = ACTIONS[s.a];
    parts.push(s.a === 'take_item' ? `fetch ${s.good}` : d ? d.verb : s.a);
  }
  return parts.join(', then ');
}

export type { NeedId };
