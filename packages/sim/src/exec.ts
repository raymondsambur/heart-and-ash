/**
 * Living a step: the loop that runs every person every sim step. Needs tick, then the person walks, works, talks or decides.
 * Decisions happen when a plan runs out, when a need turns critical, or every ten game minutes (staggered by id).
 */
import { ACTIONS, GAME_HOUR_MS, SLEEP_RECOVERY, traitMod, type Good } from '@hearth/shared';
import { HANDLERS, type Done } from './actions';
import type { Ctx } from './ctx';
import { HOUR, MIN } from './ctx';
import { pushFeed } from './feed';
import { candidates, goalKeyOf, pickCompany, rank } from './goals';
import { die } from './life';
import { advanceMove, dist, isMoving, spotNear, stop, walkTo } from './move';
import { clamp, computeMood, tickNeeds } from './needs';
import { ageOf } from './people';
import { plan, planText } from './planner';
import { compliance } from './goals';
import { speedOf } from './skills';
import type { Act, Cand, Goal, Job, Person, Step } from './types';
import { shortfall, stageReady } from './construct';
import { addMood, mem, stat } from './util';

const IDLE_RECHECK = 30 * MIN;
const DECIDE_EVERY = 10 * MIN;

function stagger(p: Person): number {
  return (p.id * 37) % 5000;
}

// ---------------------------------------------------------------------------------------------------
// The per-step tick
// ---------------------------------------------------------------------------------------------------

/** Is what they are doing already about food or water? */
function servesBody(p: Person): boolean {
  const g = p.goal;
  return !!g && g.kind === 'need' && (g.need === 'food' || g.need === 'water');
}

export function tickPerson(c: Ctx, p: Person, dt: number): void {
  if (p.away) return;
  const age = ageOf(p, c.day);
  if (age < 3) {
    // Babies stay indoors with their family.
    p.hidden = true;
    p.needs.food = 80;
    p.needs.water = 80;
    p.needs.rest = 80;
    return;
  }
  const h = dt / GAME_HOUR_MS;
  const sleeping = p.act?.step.a === 'sleep';
  const home = p.home !== null ? c.sites.ofKind('home').find((s) => s.building === p.home) : undefined;
  const atHome = !!home && p.hidden;
  const fire = atHome && (c.st.fires[p.home!] ?? 0) > c.now;
  const res = tickNeeds(p, dt, c.day, c.temp, { sleeping, indoors: atHome, fire, company: p.talk ? 1 : 0 });
  if (sleeping) p.needs.rest = clamp(p.needs.rest + SLEEP_RECOVERY * h);
  const fever = p.ills.some((i) => i.id === 'fever');
  if (fever) p.hp -= (age >= 60 ? 1.1 : age < 6 ? 0.8 : 0.4) * h;
  if (p.hp <= 0) return void die(c, p, res.cause || (fever ? 'fever' : p.ills.some((i) => i.id === 'wound') ? 'wounds' : 'exhaustion'));

  if (c.now >= (p.counters.moodAt ?? 0)) {
    p.mood = computeMood(p, c.now).mood;
    p.counters.moodAt = c.now + HOUR + stagger(p);
    p.moodEvents = p.moodEvents.filter((e) => e.until > c.now);
  }

  // a critical hunger or thirst wakes and interrupts anything but the plan that serves it, a conversation included
  if ((p.needs.food < 10 || p.needs.water < 10) && !servesBody(p)) {
    p.act = null;
    p.talk = null;
    p.plan = [];
    p.planIdx = 0;
    p.goal = null;
    p.nextDecide = 0;
  }

  // in a conversation: wait it out (the one who started it ends it)
  if (p.talk) {
    if (c.now >= p.talk.until + 5 * MIN) p.talk = null;
    return;
  }

  if (isMoving(p)) {
    const arrived = advanceMove(c, p, dt);
    if (arrived && (p.counters.walks = (p.counters.walks ?? 0) + 1) % 6 === 0) discover(c, p);
    if (arrived && jointNear(c, p)) {
      stop(p);
    }
    return;
  }

  // collapse where they stand
  if (p.needs.rest <= 3 && !sleeping) {
    p.act = { step: { a: 'sleep', at: 'here' }, startedAt: c.now, endsAt: c.now + 4 * HOUR };
    p.plan = [];
    p.goal = null;
    p.why = { ...p.why, goal: 'Collapsed from exhaustion', source: 'need' };
    mem(c, p, 'collapse', 'collapsed from exhaustion', -0.4);
    stat(c, 'collapses');
    return;
  }

  if (p.act) return void progress(c, p, dt);

  if (p.goal === null || p.planIdx >= p.plan.length || c.now >= p.nextDecide) {
    if (p.goal !== null && p.planIdx >= p.plan.length) completeGoal(c, p);
    else decide(c, p);
    if (p.plan.length === 0) {
      // nothing to do: stand about, and look again soon
      return;
    }
  }
  runStep(c, p);
}

// ---------------------------------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------------------------------

function planWorld(c: Ctx) {
  return { st: c.st, sites: c.sites, hour: c.hour, season: c.season };
}

function claim(c: Ctx, p: Person, job: Job | undefined): void {
  if (p.job !== null && p.job !== job?.id) {
    const old = c.st.jobs.find((j) => j.id === p.job);
    if (old) old.claimed = old.claimed.filter((id) => id !== p.id);
  }
  p.job = job?.id ?? null;
  if (job && !job.claimed.includes(p.id)) job.claimed.push(p.id);
}

export function decide(c: Ctx, p: Person): void {
  const cands = candidates(c, p);
  const ranked = rank(c, p, cands);
  p.why.top = ranked.slice(0, 3).map((x) => ({ label: x.label, source: x.source, score: Math.round(x.score * 100) / 100 }));
  p.nextDecide = c.now + DECIDE_EVERY + stagger(p);
  let tries = 0;
  let firstBlock: string | undefined;
  for (const cand of ranked) {
    if (tries++ >= 5) break;
    const key = goalKeyOf(cand.goal);
    if ((p.counters[`ban:${key}`] ?? 0) > c.now) continue;
    const job = cand.jobId !== undefined ? c.st.jobs.find((j) => j.id === cand.jobId) : undefined;
    if (job && p.job !== job.id) {
      const chance = compliance(c, p, job);
      if (!c.rng.chance(chance)) {
        p.counters[`refuse:${job.id}`] = c.day + 0.3;
        const why = p.loyalty < 35 ? 'resents the manager' : p.needs.rest < 40 ? 'exhausted' : p.mood < 35 ? 'in no mood for it' : job.risky ? 'too risky for their taste' : 'would rather not';
        p.blocked = { reason: `refused to ${job.label}: ${why}`, since: c.now };
        stat(c, 'refusals');
        firstBlock ??= p.blocked.reason;
        continue;
      }
    }
    const res = plan(p, cand.goal, planWorld(c));
    if ('blocked' in res) {
      p.counters[`ban:${key}`] = c.now + 3 * HOUR;
      firstBlock ??= `cannot ${cand.label}: ${res.blocked}`;
      p.fails++;
      continue;
    }
    if (res.steps.length === 0) {
      p.counters[`ban:${key}`] = c.now + HOUR;
      continue;
    }
    claim(c, p, job);
    // A load for a building site is only as big as what is still missing.
    const cg = cand.goal;
    if (cg.kind === 'act' && cg.action === 'deliver_material' && cg.order !== undefined) {
      const o = c.st.orders.find((x) => x.id === cg.order);
      for (const s of res.steps) if (s.a === 'take_item' && s.good && o) s.n = Math.max(1, Math.min(5, Math.ceil(shortfall(o, s.good))));
    }
    const last = res.steps.length - 1;
    const g = cand.goal;
    if (g.kind === 'act') {
      const st = res.steps[last];
      if (st.a === g.action) {
        st.who = g.who ?? st.who;
        st.plot = g.plot ?? st.plot;
        st.site = g.site ?? st.site;
        st.order = g.order ?? st.order;
      }
    }
    p.goal = g;
    p.source = cand.source;
    p.goalSince = c.now;
    p.plan = res.steps;
    p.planIdx = 0;
    p.fails = 0;
    p.blocked = firstBlock ? { reason: firstBlock, since: c.now } : null;
    p.why.goal = cand.label;
    p.why.source = cand.source;
    p.why.plan = planText(res.steps);
    p.why.blocked = firstBlock;
    return;
  }
  // nothing workable
  if (p.job !== null) claim(c, p, undefined);
  p.goal = null;
  p.plan = [];
  p.planIdx = 0;
  p.nextDecide = c.now + IDLE_RECHECK;
  p.why.goal = firstBlock ? 'Looking for something to do' : 'Nothing pressing';
  p.why.plan = '';
  p.why.blocked = firstBlock;
  if (firstBlock) {
    p.blocked = { reason: firstBlock, since: p.blocked?.since ?? c.now };
    // A person who stays blocked for days shows up in the feed with the reason.
    if (c.now - p.blocked.since > 3 * 24 * HOUR && (p.counters.blockedFeed ?? -9) < c.day - 3) {
      p.counters.blockedFeed = c.day;
      pushFeed(c.st, c.pending, 'stuck', `${p.name} has been stuck for days: ${firstBlock}.`, [p.id]);
    }
  } else p.blocked = null;
}

function completeGoal(c: Ctx, p: Person): void {
  const g = p.goal;
  // Leftover goods go back to the store.
  if (p.carrying && p.carrying.qty >= 0.05) {
    const store = c.sites.nearest('store', p.x, p.y, new Set(p.known));
    if (store) {
      p.plan = [{ a: 'store_item', at: 'store' }];
      p.planIdx = 0;
      p.goal = { kind: 'act', action: 'store_item', label: 'put things away' };
      p.why.goal = 'Putting things away';
      return;
    }
  }
  p.carrying = null;
  if (g?.kind === 'act' || g?.kind === 'stock') {
    if (p.source === 'job') {
      p.needs.purpose = clamp(p.needs.purpose + 4);
      stat(c, 'jobs_done');
    }
  }
  p.goal = null;
  p.plan = [];
  p.planIdx = 0;
  p.nextDecide = 0;
}

function failStep(c: Ctx, p: Person, reason: string): void {
  const g = p.goal;
  if (g) p.counters[`ban:${goalKeyOf(g)}`] = c.now + 2 * HOUR;
  p.blocked = { reason, since: c.now };
  p.why.blocked = reason;
  p.fails++;
  p.goal = null;
  p.plan = [];
  p.planIdx = 0;
  p.act = null;
  p.nextDecide = c.now + 2 * MIN;
  stat(c, 'step_failures');
  if (p.fails === 3 && (p.counters.failFeed ?? -9) < c.day - 1) {
    p.counters.failFeed = c.day;
    pushFeed(c.st, c.pending, 'stuck', `${p.name} keeps failing at something: ${reason}.`, [p.id]);
  }
}

// ---------------------------------------------------------------------------------------------------
// Running a step
// ---------------------------------------------------------------------------------------------------

function discover(c: Ctx, p: Person): void {
  const have = new Set(p.known);
  for (const s of c.sites.within(p.x, p.y, 6)) if (!have.has(s.id)) p.known.push(s.id);
}

/** Close enough to the person a joint step is aimed at: stop walking. */
function jointNear(c: Ctx, p: Person): boolean {
  const s = p.plan[p.planIdx];
  if (!s || s.who === undefined || ACTIONS[s.a]?.at !== 'person') return false;
  const t = c.person(s.who);
  return !!t && dist(p.x, p.y, t.x, t.y) <= 2;
}

function resolveSite(c: Ctx, p: Person, step: Step): boolean {
  const def = ACTIONS[step.a];
  if (step.tx !== undefined && step.ty !== undefined) return true;
  let site = step.site !== undefined ? c.sites.get(step.site) : undefined;
  const known = new Set(p.known);
  if (!site) {
    switch (step.at) {
      case 'home':
        site = c.sites.ofKind('home').find((s) => s.building === p.home);
        break;
      case 'field': {
        const wantPlot = step.plot;
        const fields = c.sites.ofKind('field').filter((s) => known.has(s.id) && (wantPlot === undefined || s.plot === wantPlot));
        // pick one in the state the action needs
        const need = def?.plan?.field;
        const match = fields.filter((s) => {
          const f = c.st.fields.find((x) => x.plot === s.plot);
          return !need || (f && (need === 'ripe' ? f.state === 'ripe' && f.left > 1 : f.state === (need === 'fallow' ? 'fallow' : 'growing')));
        });
        let best = null as (typeof fields)[number] | null;
        let bd = Infinity;
        for (const s of match.length ? match : fields) {
          const d = dist(p.x, p.y, s.x, s.y);
          if (d < bd) {
            bd = d;
            best = s;
          }
        }
        site = best ?? undefined;
        break;
      }
      case 'buildsite':
        site = c.sites.ofKind('buildsite').find((s) => s.order === step.order);
        break;
      default:
        site = c.sites.nearest(step.at, p.x, p.y, known) ?? undefined;
    }
  }
  if (!site) return false;
  step.site = site.id;
  if (step.at === 'field' && site.plot !== undefined) {
    const plot = c.st.plots.find((x) => x.id === site!.plot);
    if (plot) {
      step.plot = plot.id;
      step.tx = plot.x + c.rng.int(0, plot.w - 1);
      step.ty = plot.y + c.rng.int(0, plot.d - 1);
      return true;
    }
  }
  const spot = step.at === 'forest' || step.at === 'quarry' || step.at === 'buildsite' || step.at === 'meadow' || step.at === 'stream' || step.at === 'water' || step.at === 'plaza' ? spotNear(c, site.x, site.y, 1) : { x: site.x, y: site.y };
  step.tx = spot.x;
  step.ty = spot.y;
  return true;
}

function preconditionsOk(c: Ctx, p: Person, step: Step): string | null {
  const def = ACTIONS[step.a];
  if (!def) return 'unknown action';
  const pl = def.plan;
  const held = p.carrying?.good ?? null;
  if (step.a === 'take_item') {
    const g = step.good;
    if (!g) return step.a === 'take_item' && p.ambitions.some((a) => a.kind === 'see_outside' && !a.ended) ? null : 'nothing to fetch';
    if ((c.st.stock[g] ?? 0) < (g === 'ration' || g === 'meal' ? 0.3 : 1)) return `the store has no ${g}`;
    if (g !== 'tool' && held !== null) return 'hands are full';
    return null;
  }
  if (pl?.holds) {
    if (pl.holds === 'empty' && held !== null) return 'hands are full';
    if (pl.holds === 'any' && held === null) return 'carrying nothing';
    if (pl.holds === 'food' && held !== 'ration' && held !== 'meal') return 'no food to eat';
    if (!['empty', 'any', 'food'].includes(pl.holds) && held !== pl.holds) return `needs ${pl.holds} in hand`;
  }
  if (pl?.tool && p.inv.tool < 1) return 'no tool';
  if (pl?.field) {
    const f = c.st.fields.find((x) => x.plot === step.plot) ?? c.st.fields.find((x) => (pl.field === 'ripe' ? x.state === 'ripe' : pl.field === 'fallow' ? x.state === 'fallow' : x.state === 'growing'));
    if (!f) return 'no field in the right state';
    const ok = pl.field === 'ripe' ? f.state === 'ripe' && f.left > 1 : pl.field === 'fallow' ? f.state === 'fallow' : f.state === 'growing';
    if (!ok) return 'the field is not ready for that';
  }
  if (step.a === 'light_fire' && p.home === null) return 'no hearth';
  if (step.a === 'build' || step.a === 'demolish' || step.a === 'clear_rubble' || step.a === 'deliver_material') {
    const o = c.st.orders.find((x) => x.id === step.order);
    if (!o) return 'that job is done';
    if (step.a === 'build' && (o.mode !== 'build' || !stageReady(o))) return o.mode === 'build' ? (o.note ?? 'waiting for material') : 'that job has changed';
    if (step.a === 'demolish' && o.mode !== 'demolish') return 'that job has changed';
    if (step.a === 'clear_rubble' && o.mode !== 'rubble') return 'that job has changed';
    if (step.a === 'deliver_material' && o.mode !== 'build') return 'that job has changed';
  }
  return null;
}

function runStep(c: Ctx, p: Person): void {
  const step = p.plan[p.planIdx];
  if (!step) return;
  const def = ACTIONS[step.a];
  if (!def) return failStep(c, p, 'unknown action');

  // The order this step was for is finished or cancelled: nothing to fail, just look for something else to do.
  if (step.order !== undefined && !c.st.orders.some((o) => o.id === step.order)) {
    p.plan = [];
    p.planIdx = 0;
    p.goal = null;
    p.nextDecide = c.now;
    return;
  }

  // person-aimed steps
  if (def.at === 'person') return runJoint(c, p, step);

  if (def.at !== 'here' && !resolveSite(c, p, step)) {
    return failStep(c, p, step.at === 'home' ? 'has no home to go to' : `does not know where to find ${step.at === 'water' ? 'water' : `a ${step.at}`}`);
  }
  if (def.at !== 'here' && step.tx !== undefined && step.ty !== undefined) {
    const arrived = step.at === 'field' ? inPlot(c, p, step.plot) : p.x === step.tx && p.y === step.ty;
    if (!arrived) {
      if (!walkTo(c, p, step.tx, step.ty)) {
        // Unreachable: forget that site and try again with what is left.
        if (step.site !== undefined) p.known = p.known.filter((s) => s !== step.site);
        return failStep(c, p, 'cannot get there');
      }
      return;
    }
  }
  const bad = preconditionsOk(c, p, step);
  if (bad) {
    // Something changed since the plan was made (the store ran out, the field is taken): plan again.
    p.plan = [];
    p.planIdx = 0;
    p.goal = null;
    p.fails++;
    p.counters.replans = (p.counters.replans ?? 0) + 1;
    p.nextDecide = c.now + (p.fails > 2 ? 10 * MIN : 1);
    if (p.fails > 2) p.blocked = { reason: bad, since: c.now };
    return;
  }
  discover(c, p);
  if (step.who !== undefined && def.at !== 'here') {
    // Ceremonies and duels: both people have to be at the place.
    const ready = rendezvous(c, p, step);
    if (ready === 'fail') return failStep(c, p, 'the other person did not come');
    if (ready === 'wait') return;
    return beginAct(c, p, step, step.who);
  }
  beginAct(c, p, step);
}

/** Call the other person to the place (a wedding, a duel) and wait for them. */
function rendezvous(c: Ctx, p: Person, step: Step): 'ready' | 'wait' | 'fail' {
  const t = c.person(step.who!);
  if (!t || t.away) return 'fail';
  if (dist(p.x, p.y, t.x, t.y) <= 4 && !t.talk && !t.hidden) {
    p.counters.jwait = 0;
    const def = ACTIONS[step.a];
    const ms = Math.max(MIN, (def.minutes / speedOf(p, def.skill)) * MIN);
    stop(t);
    t.act = null;
    t.talk = { with: p.id, until: c.now + ms, kind: step.a };
    return 'ready';
  }
  p.counters.jwait ||= c.now;
  if (c.now - p.counters.jwait > 4 * HOUR) {
    p.counters.jwait = 0;
    return 'fail';
  }
  const called = t.goal?.kind === 'act' && t.goal.action === step.a && t.goal.who === p.id;
  if (!called && !t.talk) {
    claim(c, t, undefined);
    t.goal = { kind: 'act', action: step.a, who: p.id, label: step.a === 'marry' ? `go to the wedding with ${p.name}` : `answer ${p.name}'s challenge` };
    t.source = 'social';
    t.goalSince = c.now;
    t.plan = [{ a: step.a, at: step.at, who: p.id, site: step.site, tx: step.tx, ty: step.ty }];
    t.planIdx = 0;
    t.act = null;
    t.why.goal = t.goal.label;
    t.why.source = 'social';
    t.why.plan = planText(t.plan);
    t.nextDecide = c.now + 6 * HOUR;
  }
  return 'wait';
}

function inPlot(c: Ctx, p: Person, plot: number | undefined): boolean {
  const pl = c.st.plots.find((x) => x.id === plot);
  return !!pl && p.x >= pl.x && p.x < pl.x + pl.w && p.y >= pl.y && p.y < pl.y + pl.d;
}

function beginAct(c: Ctx, p: Person, step: Step, who?: number): void {
  const def = ACTIONS[step.a];
  let ms: number;
  if (step.a === 'sleep') ms = 9 * HOUR;
  else if (def.minutes <= 0) ms = MIN;
  else ms = Math.max(MIN, (def.minutes / speedOf(p, def.skill)) * MIN);
  if (step.a === 'sleep' && p.hidden === false && def.at === 'home') p.hidden = true;
  else if (def.at === 'home' && p.home !== null) p.hidden = true;
  p.act = { step, startedAt: c.now, endsAt: c.now + ms, who };
  p.lastAct = def.verb;
}

function progress(c: Ctx, p: Person, dt: number): void {
  const a = p.act!;
  void dt;
  if (a.step.a === 'sleep') {
    // wake when rested enough, or after the night
    const wake = p.needs.rest >= 98 || c.now >= a.endsAt;
    if (!wake) return;
  } else if (c.now < a.endsAt) return;
  finishAct(c, p, a);
}

function finishAct(c: Ctx, p: Person, a: Act): void {
  const step = a.step;
  const def = ACTIONS[step.a];
  const t = a.who !== undefined ? c.person(a.who) : undefined;
  const hours = Math.max(0.05, (c.now - a.startedAt) / HOUR);
  const lv = def?.skill ? p.skills[def.skill].lv : 0;
  const d: Done = { c, p, step, act: a, hours, q: 0.6 + 0.1 * lv, t };
  const h = HANDLERS[step.a];
  if (h) h(d);
  else if (def?.plan?.need) for (const [k, v] of Object.entries(def.plan.need)) p.needs[k as keyof typeof p.needs] = clamp(p.needs[k as keyof typeof p.needs] + (v as number));
  if (def?.tags.includes('work')) p.needs.purpose = clamp(p.needs.purpose + 0.5 * hours);
  p.act = null;
  p.planIdx++;
  // a joint act frees the other side and moves their plan past the same step
  if (t) {
    t.talk = null;
    const ts = t.plan[t.planIdx];
    if (ts && ts.a === step.a && ts.who === p.id) t.planIdx++;
  }
  p.talk = null;
  const next = p.plan[p.planIdx];
  if (p.hidden && !(next && (next.at === 'home' || next.at === 'here'))) p.hidden = false;
  if (step.a === 'sleep') p.hidden = false;
}

// ---------------------------------------------------------------------------------------------------
// Joint acts
// ---------------------------------------------------------------------------------------------------

/** Acts with another person: walk to them, wait if they are busy, then talk (or fight) for the duration. */
function runJoint(c: Ctx, p: Person, step: Step): void {
  const def = ACTIONS[step.a];
  // A goal like "ask around" names nobody: pick someone to talk to now.
  if (step.who === undefined) {
    const mate = pickCompany(c, p);
    if (!mate) return failStep(c, p, 'there is nobody around to talk to');
    step.who = mate.id;
  }
  const t = c.person(step.who);
  if (!t || t.away) return failStep(c, p, 'the person they wanted is gone');
  if (step.at === 'person' && (p.counters.jwait ?? 0) > 0 && c.now - p.counters.jwait > 3 * HOUR) {
    p.counters.jwait = 0;
    return failStep(c, p, `${t.name} was never free`);
  }
  const d = dist(p.x, p.y, t.x, t.y);
  if (d > 2) {
    p.counters.jwait ||= c.now;
    if (!walkTo(c, p, t.x, t.y)) return failStep(c, p, `cannot reach ${t.name}`);
    return;
  }
  // Care for the sick goes ahead even when they are hungry; a chat does not pull away someone who needs a meal.
  const hungry = t.needs.food <= 25 || t.needs.water <= 25;
  const busy = !!t.talk || t.act?.step.a === 'sleep' || t.hidden || t.away || (hungry && !def.tags.includes('care'));
  if (busy) {
    p.counters.jwait ||= c.now;
    return;
  }
  p.counters.jwait = 0;
  stop(p);
  stop(t);
  const ms = Math.max(MIN, (def.minutes / speedOf(p, def.skill)) * MIN);
  // The other person's own plan waits.
  t.act = null;
  p.talk = { with: t.id, until: c.now + ms, kind: step.a };
  t.talk = { with: p.id, until: c.now + ms, kind: step.a };
  t.hidden = false;
  p.face = d === 0 ? p.face : faceTo(p, t);
  t.face = faceTo(t, p);
  p.act = { step, startedAt: c.now, endsAt: c.now + ms, who: t.id };
  p.lastAct = def.verb;
  // The initiator ends the talk through `progress` (their act), so their `talk` must not block that.
  p.talk = null;
}

function faceTo(a: Person, b: Person): 0 | 1 | 2 | 3 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sx = dx - dy;
  const sy = dx + dy;
  if (sy >= 0) return sx >= 0 ? 0 : 1;
  return sx >= 0 ? 3 : 2;
}

export type { Cand, Goal, Good };
export { traitMod, addMood };
