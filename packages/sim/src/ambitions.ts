/**
 * Ambitions: what a villager dreams of and how they go after it (docs/notes/m1-agent-brain-spec.md, section 10). Each kind
 * turns the person's situation into the next goal (a chat, a court, a lesson, a trip to the quarry) or into a reason it is
 * stuck, and measures progress from milestones. Ambition goals compete with jobs in spare time.
 */
import { AMBITIONS, AMBITION_KINDS, DAYS_PER_YEAR, SKILL_IDS, traitMod, type Ambition, type AmbitionKind, type SkillId } from '@hearth/shared';
import type { Ctx } from './ctx';
import { pushFeed } from './feed';
import { worstGrudge } from './memory';
import { clamp } from './needs';
import { COMING_OF_AGE, MARRIAGE_AGE, ageOf, isChild } from './people';
import type { Cand, Goal, Person } from './types';
import { addMood, compat, isAdult, isFree, mem, peekRel, relOf, stat } from './util';

export const MAX_ACTIVE = 2;

export function active(p: Person): Ambition[] {
  return p.ambitions.filter((a) => !a.ended);
}

// ---------------------------------------------------------------------------------------------------
// Drawing ambitions
// ---------------------------------------------------------------------------------------------------

function weightOf(c: Ctx, p: Person, kind: AmbitionKind): number {
  const d = AMBITIONS[kind];
  const age = ageOf(p, c.day);
  if (age < d.minAge) return 0;
  if (active(p).some((a) => a.kind === kind)) return 0;
  let w = d.weight;
  for (const t of p.traits) w += d.likes[t] ?? 0;
  if (d.skills?.some((s) => p.skills[s].lv >= 3)) w *= 1.6;
  switch (kind) {
    case 'marry':
      if (p.partner !== null) return 0;
      break;
    case 'see_outside':
    case 'find_kin':
      // One trip is enough for anyone.
      if (p.counters.returned !== undefined) return 0;
      break;
    case 'raise_children':
      if (p.partner === null || p.children.length >= 3) return 0;
      break;
    case 'court_person':
      if (p.partner !== null || !pickLove(c, p)) return 0;
      break;
    case 'take_revenge':
      if (!worstGrudge(p)) return 0;
      break;
    case 'reconcile':
      if (!pickRival(c, p)) return 0;
      break;
    case 'take_apprentice':
      if (!SKILL_IDS.some((s) => p.skills[s].lv >= 7) || age < 24) return 0;
      break;
    case 'find_kin':
      if (p.parents.length > 0 && p.counters.newcomer === undefined) return 0;
      break;
    case 'escape_debt':
      return p.debt > 0 ? 3 : 0;
    case 'own_house':
      if (p.home === null) w *= 2;
      break;
    case 'heal_sick':
      if (p.skills.healing.lv < 2) w *= 0.3;
      break;
    case 'protect_village':
      if (p.skills.fighting.lv < 1) w *= 0.6;
      break;
    default:
      break;
  }
  return Math.max(0, w);
}

export function drawAmbitions(c: Ctx, p: Person): void {
  const want = MAX_ACTIVE - active(p).length;
  if (want <= 0) return;
  const n = Math.min(want, c.rng.weighted([[0, 1], [1, 5], [2, 3]] as const));
  for (let i = 0; i < n; i++) {
    const pool = AMBITION_KINDS.map((k) => [k, weightOf(c, p, k)] as const).filter(([, w]) => w > 0);
    if (!pool.length) return;
    const kind = c.rng.weighted(pool);
    const a: Ambition = { kind, progress: 0, startedDay: c.day };
    if (kind === 'master_skill') a.skill = bestSkill(c, p);
    if (kind === 'court_person') a.who = pickLove(c, p)?.id;
    if (kind === 'reconcile') a.who = pickRival(c, p)?.id;
    if (kind === 'take_revenge') a.who = worstGrudge(p)?.who;
    p.ambitions.push(a);
    mem(c, p, 'dream', `dreams of: ${describe(c, p, a)}`, 0.3);
  }
  // Keep the list of finished ones short.
  const ended = p.ambitions.filter((a) => a.ended);
  if (ended.length > 4) p.ambitions = p.ambitions.filter((a) => !a.ended || ended.slice(-4).includes(a));
}

function bestSkill(c: Ctx, p: Person): SkillId {
  const sk = SKILL_IDS.filter((s) => s !== 'building' && s !== 'leadership');
  return c.rng.weighted(sk.map((s) => [s, 1 + p.skills[s].lv * 2] as const));
}

function pickLove(c: Ctx, p: Person): Person | null {
  let best: Person | null = null;
  let bs = 0.05;
  for (const o of c.people) {
    if (o.id === p.id || o.partner !== null || o.sex === p.sex || ageOf(o, c.day) < MARRIAGE_AGE || kin(p, o)) continue;
    if (Math.abs(ageOf(o, c.day) - ageOf(p, c.day)) > 14) continue;
    const s = compat(p, o) + (peekRel(p, o.id)?.fam ?? 0) / 100 + (peekRel(p, o.id)?.rom ?? 0) / 100;
    if (s > bs) {
      bs = s;
      best = o;
    }
  }
  return best;
}

function pickRival(c: Ctx, p: Person): Person | null {
  let worst: Person | null = null;
  let ws = -20;
  for (const [id, r] of Object.entries(p.relations)) {
    const o = c.person(Number(id));
    if (o && r.aff < ws) {
      ws = r.aff;
      worst = o;
    }
  }
  return worst;
}

function kin(a: Person, b: Person): boolean {
  return a.parents.includes(b.id) || b.parents.includes(a.id) || a.children.includes(b.id) || b.children.includes(a.id) || a.parents.some((x) => b.parents.includes(x));
}

export function describe(c: Ctx, p: Person, a: Ambition): string {
  const d = AMBITIONS[a.kind];
  const who = a.who !== undefined ? c.person(a.who)?.name ?? c.st.graves.find((g) => g.id === a.who)?.name ?? 'someone' : 'someone';
  return d.desc.replace('{skill}', a.skill ?? 'a craft').replace('{who}', who);
}

// ---------------------------------------------------------------------------------------------------
// Pursuing them
// ---------------------------------------------------------------------------------------------------

interface Pursuit {
  goal?: Goal;
  label?: string;
  stuck?: string;
  progress?: number;
  fulfilled?: boolean;
  drop?: string;
}

const act = (action: string, label: string, extra: Partial<Extract<Goal, { kind: 'act' }>> = {}): Goal => ({ kind: 'act', action, label, ...extra });

function fieldGoal(c: Ctx, verb: 'tend' | 'any'): Goal | null {
  const f = c.st.fields.find((x) => x.state === 'ripe' && x.left > 1) ?? c.st.fields.find((x) => x.state === 'growing') ?? c.st.fields.find((x) => x.state === 'fallow' && c.season < 2);
  if (!f) return null;
  if (verb === 'tend' && f.state !== 'growing') return null;
  const action = f.state === 'ripe' ? 'harvest' : f.state === 'growing' ? 'tend_crops' : 'plant';
  return act(action, `${action === 'harvest' ? 'harvest' : action === 'plant' ? 'plant' : 'tend'} the fields`, { plot: f.plot });
}

/** What practising a skill looks like as a goal. */
function practise(c: Ctx, p: Person, skill: SkillId): Pursuit {
  switch (skill) {
    case 'farming': {
      const g = fieldGoal(c, 'any');
      return g ? { goal: g } : { stuck: 'no field needs work this season' };
    }
    case 'foraging':
      return c.season < 3 ? { goal: act('forage', 'forage in the meadows') } : { stuck: 'nothing grows in winter' };
    case 'hunting':
      return { goal: act('hunt', 'go hunting') };
    case 'woodcraft':
      return { goal: act('chop_wood', 'chop wood') };
    case 'mining':
      return { goal: act(p.skills.mining.lv >= 3 ? 'mine_ore' : 'quarry_stone', 'work the quarry') };
    case 'building':
      return { stuck: 'there is nothing to build yet' };
    case 'smithing':
      return (c.st.stock.ore ?? 0) >= 1 || p.skills.mining.lv >= 3 ? { goal: act('smith_blade', 'forge a blade') } : { stuck: 'there is no ore to forge' };
    case 'cooking':
      return { goal: act('cook', 'cook for the village') };
    case 'crafting':
      return (c.st.stock.herb ?? 0) >= 1 ? { goal: act('weave_cloth', 'weave cloth') } : { goal: act('make_tool', 'make a tool') };
    case 'healing': {
      const sick = c.people.find((o) => o.id !== p.id && (o.ills.length > 0 || o.hp < o.maxHp * 0.6));
      return sick ? { goal: act('heal', `heal ${sick.name}`, { who: sick.id }) } : { goal: act('gather_herbs', 'gather healing herbs') };
    }
    case 'teaching': {
      const pupil = pickPupil(c, p);
      return pupil ? { goal: act('teach', `teach ${pupil.name}`, { who: pupil.id }) } : { stuck: 'there is no one to teach' };
    }
    case 'trading':
      return { goal: act('chat', 'chat with people at the plaza') };
    case 'fighting':
      return { goal: act('stand_watch', 'stand watch') };
    case 'scholarship':
      return { goal: act('study', 'study') };
    case 'leadership':
      return { goal: act('tell_story', 'speak to the people') };
  }
}

function pickPupil(c: Ctx, p: Person): Person | null {
  let best: Person | null = null;
  let bs = -1;
  for (const o of c.people) {
    if (o.id === p.id || !isFree(o)) continue;
    const age = ageOf(o, c.day);
    if (age < 8 || age > 30) continue;
    const gap = Math.max(...SKILL_IDS.map((s) => p.skills[s].lv - o.skills[s].lv));
    if (gap < 2) continue;
    const s = (peekRel(p, o.id)?.fam ?? 0) / 50 + (1 + traitMod(o.traits, 'curious')) + (o.id === p.counters.pupil ? 1 : 0) + (isChild(o, c.day) ? 0 : 0.3);
    if (s > bs) {
      bs = s;
      best = o;
    }
  }
  return best;
}

function pursue(c: Ctx, p: Person, a: Ambition): Pursuit {
  const day = c.day;
  switch (a.kind) {
    case 'own_house':
      return { progress: Math.min(0.5, p.silver / 80), stuck: 'waiting for a building plot (houses are raised in a later update)' };
    case 'build_shrine':
      return { progress: 0, stuck: 'waiting for the means to build (a later update)' };
    case 'be_left_alone':
      return { progress: 0, stuck: 'no hut at the edge of the village yet (a later update)' };

    case 'marry': {
      if (p.partner !== null) return { fulfilled: true, progress: 1 };
      let t = a.who !== undefined ? c.person(a.who) : undefined;
      if (!t || t.partner !== null || t.away) {
        t = pickLove(c, p) ?? undefined;
        a.who = t?.id;
      }
      if (!t) return { stuck: 'no one suitable to marry', progress: 0.05 };
      return courtship(c, p, t);
    }
    case 'court_person': {
      if (p.partner !== null) return { fulfilled: true, progress: 1 };
      const t = a.who !== undefined ? c.person(a.who) : undefined;
      if (!t) return { drop: 'they are gone' };
      if (t.partner !== null && t.partner !== p.id) return { drop: `${t.name} is spoken for` };
      if ((p.counters.rejected ?? 0) >= 2) return { drop: `${t.name} said no, twice` };
      return courtship(c, p, t);
    }
    case 'raise_children':
      if (p.partner === null) return { stuck: 'needs a partner first', progress: 0.1 };
      if (p.children.length >= 2) return { fulfilled: true, progress: 1 };
      return { progress: 0.3 + p.children.length * 0.3, goal: act('chat', 'spend time with their partner', { who: p.partner }), stuck: p.pregnant ? undefined : (c.st.stock.ration ?? 0) / Math.max(1, c.people.length) < 8 ? 'the village is too short of food for another mouth' : undefined };

    case 'open_stall': {
      const sold = p.counters.sold ?? 0;
      const progress = Math.min(1, sold / 12);
      if (progress >= 1) return { fulfilled: true, progress };
      if ((p.counters.stall ?? 0) >= 1) {
        const buyer = pickBuyer(c, p);
        return buyer ? { progress, goal: act('barter', 'sell dishes at the plaza', { who: buyer.id }) } : { progress, goal: act('tell_story', 'call out their wares at the plaza') };
      }
      return { progress, goal: act('cook', 'cook dishes for the stall') };
    }
    case 'master_skill': {
      const sk = a.skill ?? 'farming';
      const target = 12;
      const lv = p.skills[sk].lv;
      const progress = Math.min(1, lv / target) * 0.85 + (p.counters.taught ? 0.15 : 0);
      if (lv >= target && (p.counters.taught ?? 0) >= 1) return { fulfilled: true, progress: 1 };
      if (lv >= target) {
        const pupil = pickPupil(c, p);
        return pupil ? { progress, goal: act('teach', `pass the craft to ${pupil.name}`, { who: pupil.id }) } : { progress, stuck: 'no apprentice to pass it to' };
      }
      const r = practise(c, p, sk);
      return { ...r, progress };
    }
    case 'take_apprentice': {
      const taught = p.counters.taught ?? 0;
      const progress = Math.min(1, taught / 8);
      if (progress >= 1) return { fulfilled: true, progress };
      const pupil = pickPupil(c, p);
      return pupil ? { progress, goal: act('teach', `teach ${pupil.name}`, { who: pupil.id }) } : { progress, stuck: 'no willing youth to teach' };
    }
    case 'protect_village': {
      const hours = p.counters.watch ?? 0;
      const progress = Math.min(1, hours / 40 + p.skills.fighting.lv / 40);
      if (hours >= 40 && p.skills.fighting.lv >= 5) return { fulfilled: true, progress: 1 };
      return { progress, goal: act(c.rng.chance(0.5) ? 'patrol' : 'stand_watch', 'watch over the village') };
    }
    case 'get_rich': {
      const progress = Math.min(1, p.silver / 150);
      if (p.silver >= 150) return { fulfilled: true, progress: 1 };
      // The village pays a little for every load brought in, so the way to be rich is work.
      return { progress, goal: act('report_for_work', 'take on extra work to earn') };
    }
    case 'see_outside': {
      const ready = (p.counters.supplied ?? 0) >= 1 || (p.carrying?.good === 'ration' && p.carrying.qty >= 1);
      if (!ready) return { progress: 0.1, goal: act('take_item', 'pack supplies for the road', { }) };
      return { progress: 0.6, goal: act('leave_village', 'set out for the Outside') };
    }
    case 'find_kin':
      if (day - a.startedDay < 20) return { progress: 0.1, goal: act('chat', 'ask around for news of their kin') };
      return { progress: 0.4, goal: act('leave_village', 'go looking for their kin') };
    case 'take_revenge': {
      const t = a.who !== undefined ? c.person(a.who) : undefined;
      const g = worstGrudge(p);
      if (!t) return { drop: 'the one who wronged them is gone' };
      if (!g || g.w < 0.2) return { drop: 'time softened the anger' };
      if ((p.counters.revenge ?? 0) >= 1) return { fulfilled: true, progress: 1 };
      if (traitMod(p.traits, 'crime') > 0.3 && c.rng.chance(0.4)) return { progress: 0.5, goal: act('sabotage', `spoil what ${t.name} depends on`) };
      return { progress: 0.4, goal: act(traitMod(p.traits, 'temper') > 0.3 ? 'brawl' : 'threaten', `settle the score with ${t.name}`, { who: t.id }) };
    }
    case 'win_honour': {
      const won = p.counters.duelsWon ?? 0;
      if (won >= 1) return { fulfilled: true, progress: 1 };
      const foe = c.people.find((o) => o.id !== p.id && isAdult(o, c.day) && isFree(o) && o.skills.fighting.lv >= Math.max(0, p.skills.fighting.lv - 3) && o.id !== p.partner && (p.counters[`duelWith:${o.id}`] ?? -99) < day - 30 && (o.counters[`duelWith:${p.id}`] ?? -99) < day - 30);
      const progress = Math.min(0.8, p.skills.fighting.lv / 8);
      if (p.skills.fighting.lv < 4) return { progress, goal: act('stand_watch', 'train with the watch') };
      return foe ? { progress, goal: act('duel', `challenge ${foe.name} to a duel`, { who: foe.id }) } : { progress, stuck: 'no worthy opponent' };
    }
    case 'heal_sick': {
      const healed = p.counters.healed ?? 0;
      const progress = Math.min(1, healed / 2 + p.skills.healing.lv / 24);
      if (healed >= 2 && p.skills.healing.lv >= 4) return { fulfilled: true, progress: 1 };
      return { ...practise(c, p, 'healing'), progress };
    }
    case 'reconcile': {
      const t = a.who !== undefined ? c.person(a.who) : undefined;
      if (!t) return { drop: 'the other person is gone' };
      const aff = peekRel(p, t.id)?.aff ?? 0;
      if (aff >= 10) return { fulfilled: true, progress: 1 };
      const progress = clamp((aff + 40) / 50, 0.05, 0.95);
      return { progress, goal: act(c.rng.chance(0.5) ? 'apologise' : 'gift', `make peace with ${t.name}`, { who: t.id }) };
    }
    case 'perfect_recipe': {
      const cooked = p.counters.cooked ?? 0;
      const progress = Math.min(1, cooked / 20 * 0.5 + p.skills.cooking.lv / 20);
      if (cooked >= 20 && p.skills.cooking.lv >= 8) return { fulfilled: true, progress: 1 };
      return { progress, goal: act('cook', 'cook and refine a dish') };
    }
    case 'tend_garden': {
      const tended = p.skills.farming.lv;
      const progress = Math.min(1, tended / 10);
      if (tended >= 10) return { fulfilled: true, progress: 1 };
      const g = fieldGoal(c, 'any');
      return g ? { progress, goal: g } : { progress, stuck: 'no field needs work this season' };
    }
    case 'keep_faith': {
      const prayed = p.counters.prayed ?? 0;
      const progress = Math.min(1, prayed / 30);
      if (prayed >= 30) return { fulfilled: true, progress: 1 };
      const grave = c.st.graves.find((g) => !g.buried);
      return { progress, goal: act(grave ? 'mourn' : 'pray', grave ? `mourn ${grave.name}` : 'pray at the shrine') };
    }
    case 'cure_blight': {
      const studied = p.counters.studied ?? 0;
      const progress = Math.min(1, studied / 12 + p.skills.scholarship.lv / 30);
      if (studied >= 12 && p.skills.scholarship.lv >= 4) return { fulfilled: true, progress: 1 };
      return { progress, goal: act('study', 'study the Blight') };
    }
    case 'earn_trust': {
      if (p.loyalty >= 85) return { fulfilled: true, progress: 1 };
      return { progress: p.loyalty / 100, goal: act('report_for_work', 'report for work and be useful') };
    }
    case 'escape_debt': {
      if (p.debt <= 0) return { fulfilled: true, progress: 1 };
      return { progress: clamp(1 - p.debt / 40, 0, 0.95), goal: act('forage', 'work off the debt') };
    }
    case 'storyteller': {
      const n = p.counters.stories ?? 0;
      const progress = Math.min(1, n / 15);
      if (n >= 15) return { fulfilled: true, progress: 1 };
      const evening = c.hour >= 17 && c.hour < 22;
      return evening ? { progress, goal: act('tell_story', 'tell a story at the plaza') } : { progress, stuck: 'waiting for the evening' };
    }
    case 'cheat_system': {
      const n = p.counters.thefts ?? 0;
      if ((p.counters.caught ?? 0) >= 2) return { drop: 'they were caught too often' };
      if (n >= 6) return { fulfilled: true, progress: 1 };
      return { progress: Math.min(0.9, n / 6), goal: act('steal', 'take what they can from the store') };
    }
  }
}

/** Chat, court, propose, marry: the steps towards a partner. */
function courtship(c: Ctx, p: Person, t: Person): Pursuit {
  const r = relOf(p, t.id);
  if (r.aff < -20) return { drop: `${t.name} and they do not get on` };
  if (!isFree(t) && t.talk) return { progress: 0.2, stuck: undefined };
  if (r.fam < 15) return { progress: 0.1, goal: act('chat', `get to know ${t.name}`, { who: t.id }) };
  if (r.rom < 45) return { progress: 0.2 + r.rom / 150, goal: act('court', `court ${t.name}`, { who: t.id }) };
  if (p.counters.engaged !== t.id) {
    if ((p.counters.rejected ?? 0) >= 2) return { drop: `${t.name} turned them down more than once` };
    return { progress: 0.6, goal: act('propose', `propose to ${t.name}`, { who: t.id }) };
  }
  return { progress: 0.85, goal: act('marry', `marry ${t.name} at the shrine`, { who: t.id }) };
}

function pickBuyer(c: Ctx, p: Person): Person | null {
  let best: Person | null = null;
  let bs = -1;
  for (const o of c.people) {
    if (o.id === p.id || !isFree(o) || o.silver < 4) continue;
    const s = (100 - o.needs.food) / 100 + (peekRel(p, o.id)?.fam ?? 0) / 200;
    if (s > bs) {
      bs = s;
      best = o;
    }
  }
  return best;
}

/** The ambition goals a person could pursue now (spare time only is decided by the caller). */
export function ambitionCands(c: Ctx, p: Person): Cand[] {
  const out: Cand[] = [];
  const evening = c.hour >= 17 && c.hour < 22 ? 1.5 : 1;
  for (const a of active(p)) {
    const r = pursue(c, p, a);
    a.stuck = r.stuck;
    if (r.progress !== undefined) a.progress = Math.max(a.progress, r.progress);
    if (r.fulfilled) {
      finish(c, p, a, 'fulfilled');
      continue;
    }
    if (r.drop) {
      finish(c, p, a, 'abandoned', r.drop);
      continue;
    }
    if (!r.goal) continue;
    const score = 0.75 * (1 + traitMod(p.traits, 'ambition') * 0.8) * evening * (0.7 + a.progress * 0.5);
    out.push({ goal: r.goal, source: 'ambition', score, label: `${r.goal.label} (${AMBITIONS[a.kind].label.toLowerCase()})` });
  }
  return out;
}

/** An ambition ends: a feed line, a memory, a mood swing, and sometimes a new dream. */
export function finish(c: Ctx, p: Person, a: Ambition, how: 'fulfilled' | 'abandoned', why?: string): void {
  a.ended = { how, day: c.day, why };
  const text = describe(c, p, a);
  if (how === 'fulfilled') {
    addMood(c, p, 'a dream come true', 25, 24 * 5);
    p.loyalty = clamp(p.loyalty + 5, 0, 100);
    p.needs.purpose = clamp(p.needs.purpose + 30);
    mem(c, p, 'fulfilled', `a dream came true: ${text}`, 1);
    stat(c, 'ambitions_fulfilled');
    stat(c, `fulfilled_${a.kind}`);
    pushFeed(c.st, c.pending, 'ambition', `${p.name} fulfilled a dream (${AMBITIONS[a.kind].label.toLowerCase()}).`, [p.id]);
    if (c.rng.chance(0.6)) drawAmbitions(c, p);
  } else {
    addMood(c, p, 'gave up a dream', -8, 24 * 3);
    mem(c, p, 'abandoned', `gave up on: ${text}${why ? ` (${why})` : ''}`, -0.4);
    stat(c, 'ambitions_abandoned');
    stat(c, `abandoned_${a.kind}`);
    pushFeed(c.st, c.pending, 'ambition', `${p.name} gave up on a dream (${AMBITIONS[a.kind].label.toLowerCase()})${why ? `: ${why}` : ''}.`, [p.id]);
    if (c.rng.chance(0.4)) drawAmbitions(c, p);
  }
}

/** Once a day: ambitions that have been stuck for too long end with a reason. */
export function reviewAmbitions(c: Ctx, p: Person): void {
  for (const a of active(p)) {
    const age = c.day - a.startedDay;
    if (a.stuck) a.n = (a.n ?? 0) + 1;
    else a.n = 0;
    if ((a.n ?? 0) > 40) finish(c, p, a, 'abandoned', `it never seemed to happen: ${a.stuck}`);
    else if (age > 2 * DAYS_PER_YEAR && a.progress < 0.15) finish(c, p, a, 'abandoned', 'no progress in two years');
  }
  // Owing the village something becomes a wish to be rid of it.
  if (p.debt > 0 && active(p).length < MAX_ACTIVE && !active(p).some((x) => x.kind === 'escape_debt')) p.ambitions.push({ kind: 'escape_debt', progress: 0, startedDay: c.day });
  if (ageOf(p, c.day) >= COMING_OF_AGE && active(p).length === 0 && c.rng.chance(0.02)) drawAmbitions(c, p);
}
