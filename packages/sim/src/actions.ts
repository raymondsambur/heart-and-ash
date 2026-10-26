/**
 * What happens when an action ends: the handlers of the action library (the table is in `shared/data/actions.ts`).
 * Plain effects (a need rising, a good appearing in the hands) are here; the social and conflict acts are in `social.ts`.
 */
import { ACTIONS, COOKED_MEAL_POINTS, GAME_HOUR_MS, MEAL_PORTION, RAW_MEAL_POINTS, traitMod, type Good } from '@hearth/shared';
import { leave } from './life';
import type { Ctx } from './ctx';
import { clamp } from './needs';
import { gainXp } from './skills';
import { addMood, bump, feedAbout, give, mem, stat, takeCarry } from './util';
import type { Act, Field, Person, Step } from './types';
import { SOCIAL } from './social';

export interface Done {
  c: Ctx;
  p: Person;
  step: Step;
  act: Act;
  /** Hours the action took, and the person's quality factor for it (0.6 + 0.1 * skill level). */
  hours: number;
  q: number;
  /** The other person of a joint act. */
  t?: Person;
}

type Handler = (d: Done) => void;

export const FIELD_PLANT_HOURS = 14;
export const GROW_DAYS = 30;
/** Hours of tending a crop needs over its growth for a full yield. */
export const TEND_HOURS = 9;
export const FIELD_YIELD = 150;

export function newField(plot: number): Field {
  return { plot, state: 'fallow', plantWork: FIELD_PLANT_HOURS, plantedDay: 0, grown: 0, tended: 0, left: 0, skill: 0, damage: 0 };
}

function weatherFactor(c: Ctx): number {
  switch (c.weather) {
    case 'rain':
      return 0.8;
    case 'storm':
      return 0.5;
    case 'snow':
      return 0.4;
    case 'fog':
      return 0.9;
    default:
      return 1;
  }
}

function xp(d: Done, skill: Parameters<typeof gainXp>[1] | undefined, amount: number): void {
  if (!skill) return;
  const lv = gainXp(d.p, skill, amount * d.hours, d.c.day);
  if (lv && (lv === 5 || lv === 10 || lv === 15)) feedAbout(d.c, 'skill', `${d.p.name} reached level ${lv} in ${skill}.`, d.p);
}

function fieldFor(d: Done): Field | undefined {
  const plot = d.step.plot ?? (d.step.site !== undefined ? d.c.sites.get(d.step.site)?.plot : undefined);
  return d.c.st.fields.find((f) => f.plot === plot);
}

/** Gathered goods: rate per hour of base time, scaled by skill quality, the season and the weather. */
function gather(d: Done, good: Good, ratePerHour: number, o: { outdoor?: boolean; skillName?: Parameters<typeof gainXp>[1] } = {}): number {
  const def = ACTIONS[d.step.a];
  const baseHours = def.minutes / 60;
  const vig = 1 + traitMod(d.p.traits, 'vigor') * 0.3;
  const qty = ratePerHour * baseHours * d.q * (o.outdoor === false ? 1 : weatherFactor(d.c)) * vig;
  give(d.p, good, qty);
  xp(d, def.skill, 6);
  return qty;
}

/** Spoken for by the social code. */
export const HANDLERS: Record<string, Handler> = {
  // ---- survival ----------------------------------------------------------------------------------
  eat(d) {
    const good = d.p.carrying?.good;
    if (good !== 'meal' && good !== 'ration') return;
    const took = takeCarry(d.p, MEAL_PORTION + 0.01);
    if (took <= 0) return;
    d.p.needs.food = clamp(d.p.needs.food + (good === 'meal' ? COOKED_MEAL_POINTS : RAW_MEAL_POINTS));
    if (good === 'meal') addMood(d.c, d.p, 'a hot meal', 3, 5);
    stat(d.c, 'meals');
  },
  drink(d) {
    d.p.needs.water = clamp(d.p.needs.water + 40);
  },
  sleep(d) {
    // rest is restored hour by hour while sleeping (see exec.ts)
    d.p.hidden = false;
  },
  warm_up(d) {
    const fire = d.p.home !== null && (d.c.st.fires[d.p.home] ?? 0) > d.c.now;
    d.p.needs.warmth = clamp(d.p.needs.warmth + (fire ? 40 : 12));
  },
  light_fire(d) {
    if (d.p.home === null) return;
    const wood = takeCarry(d.p, 2);
    if (wood < 1) return;
    d.c.st.fires[d.p.home] = d.c.now + 6 * GAME_HOUR_MS;
    d.p.needs.warmth = clamp(d.p.needs.warmth + 10);
    stat(d.c, 'fires');
  },
  seek_shelter(d) {
    d.p.needs.warmth = clamp(d.p.needs.warmth + 25);
    d.p.needs.safety = clamp(d.p.needs.safety + 20);
  },
  dress_cold(d) {
    if (takeCarry(d.p, 1) < 1) return;
    d.p.inv.clothes = 1;
    d.p.needs.warmth = clamp(d.p.needs.warmth + 10);
  },
  treat_wound(d) {
    if (takeCarry(d.p, 1) < 1) return;
    d.p.hp = Math.min(d.p.maxHp, d.p.hp + 25);
    d.p.ills = d.p.ills.filter((i) => i.id !== 'wound');
  },

  // ---- food and materials ------------------------------------------------------------------------------
  plant(d) {
    const f = fieldFor(d);
    if (!f || f.state !== 'fallow') return;
    f.plantWork -= d.hours * (d.q / 0.6);
    f.skill = f.skill ? (f.skill + d.p.skills.farming.lv) / 2 : d.p.skills.farming.lv;
    xp(d, 'farming', 6);
    if (f.plantWork <= 0) {
      f.state = 'growing';
      f.plantedDay = d.c.day;
      f.grown = 0;
      f.tended = 0;
      f.damage = 0;
      feedAbout(d.c, 'farm', `The ${fieldName(d.c, f)} field has been sown.`, d.p);
    }
  },
  tend_crops(d) {
    const f = fieldFor(d);
    if (!f || f.state !== 'growing') return;
    f.tended += d.hours * (d.q / 0.6);
    xp(d, 'farming', 5);
    d.p.needs.purpose = clamp(d.p.needs.purpose + 2);
  },
  harvest(d) {
    const f = fieldFor(d);
    if (!f || f.state !== 'ripe') return;
    const take = Math.min(f.left, 12 * (d.q / 0.6));
    f.left -= take;
    give(d.p, 'ration', take);
    xp(d, 'farming', 6);
    if (f.left < 0.5) {
      f.state = 'fallow';
      f.plantWork = FIELD_PLANT_HOURS;
      f.left = 0;
      feedAbout(d.c, 'farm', `The ${fieldName(d.c, f)} field has been harvested.`, d.p);
    }
  },
  forage(d) {
    const season = d.c.season === 2 ? 0.8 : 1;
    gather(d, 'ration', 0.4 * season);
  },
  gather_herbs(d) {
    gather(d, 'herb', 0.5);
  },
  hunt(d) {
    gather(d, 'ration', 0.9);
    // Hunting is risky: a wound now and then, less with fighting skill and courage.
    const risk = 0.05 - d.p.skills.fighting.lv * 0.002 - traitMod(d.p.traits, 'risk') * 0.02;
    if (d.c.rng.chance(Math.max(0.01, risk))) wound(d, 'a boar caught them');
  },
  fish(d) {
    gather(d, 'ration', 0.5);
  },
  chop_wood(d) {
    gather(d, 'wood', 1.75);
  },
  saw_planks(d) {
    const c = d.p.carrying;
    if (!c || c.good !== 'wood') return;
    const n = c.qty * 0.6;
    d.p.carrying = null;
    give(d.p, 'planks', n);
    xp(d, 'woodcraft', 5);
  },
  quarry_stone(d) {
    gather(d, 'stone', 1);
  },
  mine_ore(d) {
    gather(d, 'ore', 0.5);
    if (d.c.rng.chance(0.03)) wound(d, 'a rockfall hurt them');
  },
  store_item(d) {
    const c = d.p.carrying;
    if (!c) return;
    d.c.st.stock[c.good] = (d.c.st.stock[c.good] ?? 0) + c.qty;
    // The village pays a few coppers for what is brought in (silver in the purse is how ambitions measure wealth).
    const pay = Math.round(c.qty * (c.good === 'meal' || c.good === 'ration' ? 0.18 : 0.1) * 10) / 10;
    d.p.silver = Math.round((d.p.silver + pay) * 10) / 10;
    if (d.p.debt > 0) {
      const r = Math.min(d.p.debt, d.p.silver * 0.5);
      d.p.debt -= r;
      d.p.silver -= r;
    }
    d.p.carrying = null;
    d.p.needs.purpose = clamp(d.p.needs.purpose + 3);
    stat(d.c, `stored_${c.good}`, c.qty);
  },
  take_item(d) {
    const g = d.step.good;
    if (!g) return;
    const have = d.c.st.stock[g] ?? 0;
    if (g === 'tool') {
      if (have < 1) return;
      d.c.st.stock.tool = have - 1;
      d.p.inv.tool++;
      return;
    }
    // Packing for a journey: the rations go in the bag (counted, not carried around the village).
    if (d.p.goal?.kind === 'act' && d.p.goal.action === 'take_item') {
      const bag = Math.min(3, have);
      if (bag < 1) return;
      d.c.st.stock[g] = have - bag;
      d.p.counters.supplied = 1;
      return;
    }
    const n = Math.min(d.step.n ?? 5, have);
    if (n <= 0 || d.p.carrying) return;
    d.c.st.stock[g] = have - n;
    give(d.p, g, n);
  },

  // ---- crafting ----------------------------------------------------------------------------------------------
  cook(d) {
    const c = d.p.carrying;
    if (!c || c.good !== 'ration') return;
    d.p.carrying = null;
    const qty = c.qty;
    // A cook working toward their own stall keeps the dishes for it.
    if (d.p.ambitions.some((a) => a.kind === 'open_stall' && !a.ended) && (d.p.counters.stall ?? 0) < 8) {
      d.p.counters.stall = (d.p.counters.stall ?? 0) + qty;
      stat(d.c, 'stall_dishes', qty);
    } else give(d.p, 'meal', qty);
    xp(d, 'cooking', 8);
    bump(d.p, 'cooked');
  },
  brew_wine(d) {
    const c = d.p.carrying;
    if (!c || c.good !== 'ration') return;
    d.p.carrying = null;
    give(d.p, 'wine', c.qty * 0.5);
    xp(d, 'cooking', 7);
  },
  make_tool(d) {
    if (takeCarry(d.p, 1) < 1) return;
    d.p.inv.tool++;
    xp(d, 'crafting', 8);
  },
  smith_blade(d) {
    const c = d.p.carrying;
    if (!c || c.good !== 'ore') return;
    d.p.carrying = null;
    give(d.p, 'blade', Math.max(1, c.qty / 3));
    xp(d, 'smithing', 8);
  },
  weave_cloth(d) {
    const c = d.p.carrying;
    if (!c || c.good !== 'herb') return;
    d.p.carrying = null;
    give(d.p, 'cloth', Math.max(1, c.qty * 0.6));
    xp(d, 'crafting', 7);
  },
  sew_clothing(d) {
    if (takeCarry(d.p, 1) < 1) return;
    d.p.inv.clothes = 1;
    xp(d, 'crafting', 6);
  },
  repair_tool(d) {
    xp(d, 'crafting', 4);
  },

  // ---- learning and faith ---------------------------------------------------------------------------------------
  study(d) {
    xp(d, 'scholarship', 8);
    d.p.needs.purpose = clamp(d.p.needs.purpose + 6);
    bump(d.p, 'studied');
  },
  pray(d) {
    d.p.needs.purpose = clamp(d.p.needs.purpose + 8);
    d.p.needs.safety = clamp(d.p.needs.safety + 12);
    const faith = traitMod(d.p.traits, 'faith');
    if (faith > 0) addMood(d.c, d.p, 'a quiet hour at the shrine', 2 + faith * 2, 8);
    bump(d.p, 'prayed');
  },
  mourn(d) {
    d.p.needs.safety = clamp(d.p.needs.safety + 6);
    d.p.moodEvents = d.p.moodEvents.filter((e) => !e.text.startsWith('grief for'));
    addMood(d.c, d.p, 'at peace after mourning', 2, 24);
    bump(d.p, 'prayed');
  },
  bury_dead(d) {
    const g = d.c.st.graves.find((x) => !x.buried);
    if (!g) return;
    g.buried = true;
    d.p.needs.purpose = clamp(d.p.needs.purpose + 6);
    feedAbout(d.c, 'death', `${g.name} was buried at the shrine.`, d.p);
    for (const o of d.c.people) {
      if (o.memory.some((m) => m.kind === 'death' && m.what.includes(g.name))) addMood(d.c, o, `${g.name} was laid to rest`, 2, 24);
    }
  },

  // ---- play and idleness -----------------------------------------------------------------------------------------
  wander(d) {
    d.p.needs.purpose = clamp(d.p.needs.purpose + 1);
  },
  play(d) {
    d.p.needs.company = clamp(d.p.needs.company + 15);
    d.p.needs.purpose = clamp(d.p.needs.purpose + 6);
    for (const s of ['farming', 'foraging', 'woodcraft'] as const) if (d.c.rng.chance(0.2)) gainXp(d.p, s, 3, d.c.day);
  },
  neglect_duty(d) {
    d.p.needs.rest = clamp(d.p.needs.rest + 6);
    d.p.needs.purpose = clamp(d.p.needs.purpose - 3);
    stat(d.c, 'slacking');
  },
  patrol(d) {
    xp(d, 'fighting', 5);
    d.p.needs.purpose = clamp(d.p.needs.purpose + 6);
    bump(d.p, 'watch', d.hours);
  },
  stand_watch(d) {
    xp(d, 'fighting', 4);
    d.p.needs.purpose = clamp(d.p.needs.purpose + 6);
    bump(d.p, 'watch', d.hours);
  },
  report_for_work() {
    /* the step itself is the point: it shows up in the explanation */
  },
  flee(d) {
    d.p.needs.safety = clamp(d.p.needs.safety + 10);
  },
  leave_village(d) {
    const dream = d.p.ambitions.find((a) => !a.ended && (a.kind === 'see_outside' || a.kind === 'find_kin'));
    d.p.counters.leftDay = d.c.day;
    delete d.p.counters.supplied;
    leave(d.c, d.p, !!dream, dream ? (dream.kind === 'see_outside' ? 'to see the Outside' : 'to look for their kin') : 'for good');
  },

  ...SOCIAL,
};

export function fieldName(c: Ctx, f: Field): string {
  const idx = c.st.fields.indexOf(f);
  return idx === 0 ? 'west' : idx === 1 ? 'east' : `no. ${idx + 1}`;
}

function wound(d: Done, how: string): void {
  d.p.hp = Math.max(1, d.p.hp - 20);
  if (!d.p.ills.some((i) => i.id === 'wound')) d.p.ills.push({ id: 'wound', since: d.c.day });
  d.p.needs.safety = clamp(d.p.needs.safety - 25);
  mem(d.c, d.p, 'wound', `was hurt: ${how}`, -0.5);
  feedAbout(d.c, 'wound', `${d.p.name} was hurt: ${how}.`, d.p);
  stat(d.c, 'wounds');
}

