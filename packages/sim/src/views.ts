/** What the client is shown: entity views, the villager list, the sheet and the plain-words explanations. */
import { ACTIONS, AMBITIONS, NEEDS, NEED_IDS, SKILL_IDS, SKILL_LABEL, TRAITS, xpToNext, GOOD_LABEL, type EntityView, type NpcAct, type PersonBrief, type PersonSheet, type SheetRelation, type SkillId } from '@hearth/shared';
import { describe } from './ambitions';
import type { Ctx } from './ctx';
import { needPhrase, lowestNeed, computeMood } from './needs';
import { ageOf, COMING_OF_AGE, roleOf } from './people';
import type { Person } from './types';

const SOURCE_WORD: Record<string, string> = {
  need: 'a need',
  job: 'work for the village',
  ambition: 'a personal dream',
  leisure: 'free time',
  duty: 'duty',
  social: 'someone else',
  danger: 'danger',
};

/** How an action looks to the renderer while the person stands still. */
const ACT_VIEW: Record<string, NpcAct> = {
  eat: 'eat',
  sleep: 'rest',
  warm_up: 'shelter',
  seek_shelter: 'shelter',
  light_fire: 'brew',
  pray: 'pray',
  mourn: 'mourn',
  bury_dead: 'mourn',
  marry: 'celebrate',
  celebrate: 'celebrate',
  tell_story: 'chat',
  chat: 'chat',
  gossip: 'chat',
  court: 'chat',
  propose: 'chat',
  comfort: 'chat',
  apologise: 'chat',
  gift: 'chat',
  quarrel: 'chat',
  help_with_work: 'chat',
  barter: 'trade',
  teach: 'serve',
  heal: 'serve',
  nurse_sick: 'serve',
  plant: 'farm',
  tend_crops: 'farm',
  harvest: 'farm',
  forage: 'gather',
  gather_herbs: 'gather',
  fish: 'gather',
  hunt: 'gather',
  chop_wood: 'mine',
  quarry_stone: 'mine',
  mine_ore: 'mine',
  saw_planks: 'sweep',
  build: 'build',
  demolish: 'build',
  clear_rubble: 'dig',
  cut_thatch: 'farm',
  cook: 'brew',
  brew_wine: 'brew',
  weave_cloth: 'brew',
  sew_clothing: 'brew',
  make_tool: 'forge',
  smith_blade: 'forge',
  repair_tool: 'forge',
  study: 'meditate',
  patrol: 'guard',
  stand_watch: 'guard',
  duel: 'train',
  brawl: 'train',
  play: 'celebrate',
  steal: 'sweep',
};

export function viewAct(p: Person): NpcAct | undefined {
  const a = p.act?.step.a;
  if (a) return ACT_VIEW[a];
  if (p.talk) return 'chat';
  return undefined;
}

export function entityView(c: Ctx, p: Person): EntityView {
  const moving = p.stepMs > 0;
  const act = p.act?.step.a;
  const def = act ? ACTIONS[act] : undefined;
  const e: EntityView = {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    face: p.face,
    state: moving ? 'walk' : act === 'sleep' ? 'rest' : def?.tags.includes('work') ? 'work' : 'idle',
    look: p.look,
    role: roleOf(p, c.day),
  };
  if (moving) {
    e.nx = p.nx;
    e.ny = p.ny;
    e.step = p.stepMs;
    const n = Math.min(6, p.path.length);
    if (n > 0) {
      const route: number[] = [];
      for (let i = 0; i < n; i++) route.push(p.path[i].x, p.path[i].y);
      e.route = route;
    }
  } else {
    const a = viewAct(p);
    if (a) e.act = a;
  }
  if (p.hidden) e.hidden = true;
  if (ageOf(p, c.day) < COMING_OF_AGE) e.child = true;
  return e;
}

const SKILL_TITLE: Record<SkillId, string> = {
  farming: 'Farmer',
  foraging: 'Forager',
  hunting: 'Hunter',
  woodcraft: 'Woodcutter',
  mining: 'Quarryman',
  building: 'Builder',
  smithing: 'Smith',
  cooking: 'Cook',
  crafting: 'Craftsperson',
  healing: 'Healer',
  teaching: 'Teacher',
  trading: 'Trader',
  fighting: 'Guard',
  scholarship: 'Scholar',
  leadership: 'Speaker',
};

/** What a person is mostly known for: their best skill, or their age. */
export function titleOf(p: Person, day: number): string {
  const age = ageOf(p, day);
  if (age < COMING_OF_AGE) return age < 3 ? 'Baby' : 'Child';
  let best: SkillId = 'farming';
  for (const s of SKILL_IDS) if (p.skills[s].lv > p.skills[best].lv) best = s;
  const base = p.skills[best].lv >= 3 ? SKILL_TITLE[best] : 'Villager';
  return age >= 60 ? `Elder ${base.toLowerCase()}` : base;
}

export function doingText(p: Person): string {
  if (p.act) {
    const def = ACTIONS[p.act.step.a];
    return def?.verb ?? 'busy';
  }
  if (p.talk) return 'talking';
  if (p.stepMs > 0 || p.path.length > 0) {
    const g = p.goal;
    // Hauling is what they do when the load is the point of the trip, not when a drink or a meal is.
    const next = p.plan[p.planIdx]?.a;
    if (p.carrying && p.carrying.qty >= 0.3 && (g?.kind === 'stock' || next === 'store_item')) return `hauling ${GOOD_LABEL[p.carrying.good]}`;
    return g ? `on the way: ${g.label}` : 'walking';
  }
  return p.goal ? p.goal.label : 'standing about';
}

export function briefOf(c: Ctx, p: Person): PersonBrief {
  const flags: string[] = [];
  if (p.ills.length) flags.push('ill');
  if (p.pregnant) flags.push('pregnant');
  if (p.blocked && p.goal === null) flags.push('stuck');
  const low = lowestNeed(p);
  return { id: p.id, name: p.name, age: ageOf(p, c.day), sex: p.sex, title: titleOf(p, c.day), doing: doingText(p), mood: p.mood, lowest: { need: low.id, v: Math.round(low.v) }, flags };
}

export function moodWord(m: number): string {
  if (m >= 80) return 'delighted';
  if (m >= 65) return 'content';
  if (m >= 50) return 'fine';
  if (m >= 35) return 'low';
  if (m >= 20) return 'miserable';
  return 'desperate';
}

function relationKind(c: Ctx, p: Person, o: Person | undefined, id: number): string {
  if (p.partner === id) return 'partner';
  if (p.parents.includes(id)) return 'parent';
  if (p.children.includes(id)) return 'child';
  if (o && o.parents.some((x) => p.parents.includes(x))) return 'sibling';
  const r = p.relations[id];
  if (!r) return 'acquaintance';
  if (r.rom >= 50) return 'sweetheart';
  if (r.aff >= 30) return 'friend';
  if (r.aff <= -25) return 'rival';
  return 'acquaintance';
}

export function sheetOf(c: Ctx, p: Person): PersonSheet {
  const low = lowestNeed(p);
  const { mood, causes } = computeMood(p, c.now);
  const needs = NEED_IDS.map((id) => {
    const v = Math.round(p.needs[id]);
    return { id, label: NEEDS[id].label, value: v, state: v < 30 ? (v < 10 ? NEEDS[id].critical : NEEDS[id].low) : undefined };
  });
  const relIds = new Set<number>([...(p.partner !== null ? [p.partner] : []), ...p.parents, ...p.children, ...Object.keys(p.relations).map(Number)]);
  const relations: SheetRelation[] = [];
  for (const id of relIds) {
    const o = c.person(id);
    const r = p.relations[id];
    if (!o && !r) continue;
    relations.push({ id, name: o?.name ?? c.st.graves.find((g) => g.id === id)?.name ?? 'someone', kind: relationKind(c, p, o, id), aff: Math.round(r?.aff ?? 0), fam: Math.round(r?.fam ?? 0), rom: Math.round(r?.rom ?? 0) });
  }
  const weight = (r: SheetRelation): number => (['partner', 'parent', 'child', 'sibling'].includes(r.kind) ? 1000 : 0) + Math.abs(r.aff) + r.rom * 0.5 + r.fam * 0.3;
  relations.sort((a, b) => weight(b) - weight(a));
  const home = p.home !== null ? `House ${c.st.buildings.findIndex((b) => b.id === p.home) + 1}` : 'no home';
  const why = p.why;
  const block = p.blocked && p.goal === null ? p.blocked.reason : why.blocked;
  const recent = [...p.memory].sort((a, b) => b.day - a.day || b.w - a.w).slice(0, 8);
  return {
    id: p.id,
    name: p.name,
    age: ageOf(p, c.day),
    sex: p.sex,
    look: p.look,
    title: titleOf(p, c.day),
    home,
    needs,
    needNote: low.v < 55 ? `${capitalise(needPhrase(low.id, low.v))}${block && low.v < 40 ? `: ${block}` : ''}` : 'Nothing pressing',
    mood,
    moodWord: moodWord(mood),
    moodCauses: causes,
    hp: Math.round(p.hp),
    maxHp: p.maxHp,
    ills: p.ills.map((i) => (i.id === 'fever' ? 'a fever' : i.id)),
    skills: SKILL_IDS.filter((s) => p.skills[s].lv > 0 || p.skills[s].xp > 0)
      .sort((a, b) => p.skills[b].lv - p.skills[a].lv)
      .map((s) => ({ id: s, label: SKILL_LABEL[s], lv: p.skills[s].lv, pct: Math.round((p.skills[s].xp / xpToNext(p.skills[s].lv)) * 100) })),
    traits: p.traits.map((t) => ({ id: t, label: TRAITS[t].label, desc: TRAITS[t].desc })),
    ambitions: p.ambitions.map((a) => ({
      label: AMBITIONS[a.kind].label,
      text: describe(c, p, a),
      progress: Math.round(a.progress * 100) / 100,
      stuck: a.ended ? undefined : a.stuck,
      ended: a.ended ? `${a.ended.how}${a.ended.why ? `: ${a.ended.why}` : ''}` : undefined,
    })),
    relations: relations.slice(0, 8),
    loyalty: Math.round(p.loyalty),
    doing: doingText(p),
    why: { goal: why.goal, source: SOURCE_WORD[why.source] ?? why.source, top: why.top.map((t) => ({ label: t.label, source: SOURCE_WORD[t.source] ?? t.source, score: t.score })), plan: why.plan, blocked: block },
    memories: recent.map((m) => ({ text: m.from !== undefined ? `${c.person(m.from)?.name ?? 'someone'} said they ${m.what}` : m.what, day: m.day, val: Math.round(m.val * 100) / 100 })),
    carrying: p.carrying ? `${Math.round(p.carrying.qty * 10) / 10} ${GOOD_LABEL[p.carrying.good]}` : 'nothing',
    silver: Math.round(p.silver),
    tools: p.inv.tool,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
