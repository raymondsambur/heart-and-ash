/**
 * The social, caring and conflict acts: what happens between two people when a joint action ends (and the few acts aimed at
 * the village rather than a person). Relations, memories, mood and gossip all change here, and the feed hears about the big things.
 */
import { SKILL_IDS, traitMod, type SkillId } from '@hearth/shared';
import type { Done } from './actions';
import type { Ctx } from './ctx';
import { clamp } from './needs';
import { MARRIAGE_AGE, ageOf } from './people';
import { gainXp } from './skills';
import { addMood, bond, bump, compat, feedAbout, give, mem, nearbyPeople, peekRel, relOf, stat } from './util';
import type { Person } from './types';

type Handler = (d: Done) => void;

/** Share up to two sites each way: talking is how knowledge spreads. */
function shareKnowledge(c: Ctx, a: Person, b: Person): void {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const have = new Set(y.known);
    const gift = x.known.filter((s) => !have.has(s));
    for (let i = 0; i < 2 && gift.length; i++) {
      const k = c.rng.int(0, gift.length - 1);
      y.known.push(gift[k]);
      gift.splice(k, 1);
    }
  }
}

/** A rumour travels from teller to listener, a little weaker, with the teller named as its source. */
export function gossipTo(c: Ctx, teller: Person, listener: Person): boolean {
  const pool = teller.memory.filter((m) => m.who !== undefined && m.who !== listener.id && m.who !== teller.id && Math.abs(m.val) >= 0.3 && m.w > 0.25);
  if (!pool.length) return false;
  const m = pool[c.rng.int(0, pool.length - 1)];
  const subject = c.person(m.who!);
  mem(c, listener, `heard:${m.kind}`, m.from === undefined ? m.what : m.what, m.val * 0.8, m.who, teller.id);
  // What the listener thinks of the subject moves a little, by how much they trust the teller.
  if (subject) {
    const trust = clamp(0.3 + (peekRel(listener, teller.id)?.aff ?? 0) / 100, 0.1, 1);
    const r = relOf(listener, subject.id);
    r.aff = clamp(r.aff + m.val * 8 * trust, -100, 100);
  }
  stat(c, 'gossips');
  return true;
}

function loser(c: Ctx, a: Person, b: Person): { win: Person; lose: Person } {
  const sa = a.skills.fighting.lv * 3 + a.hp / 10 + c.rng.float(0, 10) + traitMod(a.traits, 'vigor') * 10;
  const sb = b.skills.fighting.lv * 3 + b.hp / 10 + c.rng.float(0, 10) + traitMod(b.traits, 'vigor') * 10;
  return sa >= sb ? { win: a, lose: b } : { win: b, lose: a };
}

function hurt(c: Ctx, p: Person, amount: number): void {
  p.hp = Math.max(1, p.hp - amount);
  if (p.hp < p.maxHp * 0.4 && !p.ills.some((i) => i.id === 'wound')) p.ills.push({ id: 'wound', since: c.day });
}

/** Settling the score once is the whole of a revenge ambition. */
function avenged(p: Person, t: Person): void {
  if (p.ambitions.some((a) => a.kind === 'take_revenge' && !a.ended && a.who === t.id)) p.counters.revenge = 1;
}

export const SOCIAL: Record<string, Handler> = {
  chat(d) {
    const { c, p, t } = d;
    if (!t) return;
    const k = compat(p, t);
    for (const x of [p, t]) x.needs.company = clamp(x.needs.company + 25 * (1 + Math.max(0, traitMod(x.traits, 'social')) * 0.5));
    bond(c, p, t, 3, k * 3 + 1, p.partner === t.id ? 1 : 0);
    shareKnowledge(c, p, t);
    if (k > 0.25) {
      addMood(c, p, `a good talk with ${t.name}`, 2, 3);
      addMood(c, t, `a good talk with ${p.name}`, 2, 3);
    } else if (k < -0.3) {
      addMood(c, p, `an awkward talk with ${t.name}`, -2, 3);
      addMood(c, t, `an awkward talk with ${p.name}`, -2, 3);
    }
    if (c.rng.chance(0.3)) gossipTo(c, p, t);
    if (c.rng.chance(0.3)) gossipTo(c, t, p);
    stat(c, 'chats');
  },
  gossip(d) {
    const { c, p, t } = d;
    if (!t) return;
    gossipTo(c, p, t);
    gossipTo(c, t, p);
    bond(c, p, t, 1, 1);
    for (const x of [p, t]) x.needs.company = clamp(x.needs.company + 15);
  },
  help_with_work(d) {
    const { c, p, t } = d;
    if (!t) return;
    bond(c, p, t, 3, 4);
    p.needs.purpose = clamp(p.needs.purpose + 5);
    addMood(c, t, `${p.name} lent a hand`, 2, 6);
    gainXp(p, 'farming', 3 * d.hours, c.day);
    stat(c, 'helped');
  },
  court(d) {
    const { c, p, t } = d;
    if (!t) return;
    const k = compat(p, t);
    const dRom = Math.max(1, 6 * (1 + traitMod(p.traits, 'romance') * 0.6) + k * 5);
    if (k < -0.35) {
      bond(c, p, t, 1, -3, 0);
      addMood(c, p, `${t.name} is cold to them`, -3, 12);
    } else {
      bond(c, p, t, 2, 3, dRom);
      addMood(c, p, `thinking of ${t.name}`, 2, 8);
      addMood(c, t, `courted by ${p.name}`, 1, 8);
    }
    p.needs.company = clamp(p.needs.company + 12);
    t.needs.company = clamp(t.needs.company + 12);
    stat(c, 'courtships');
  },
  propose(d) {
    const { c, p, t } = d;
    if (!t) return;
    const rt = relOf(t, p.id);
    const chance = clamp(0.15 + rt.rom / 150 + rt.aff / 300 + compat(t, p) * 0.2, 0.02, 0.95);
    if (t.partner !== null || p.partner !== null || ageOf(t, c.day) < MARRIAGE_AGE || rt.rom < 35 || !c.rng.chance(chance)) {
      addMood(c, p, `${t.name} turned them down`, -10, 48);
      bond(c, p, t, 0, -5, -10);
      mem(c, p, 'rejected', `was turned down by ${t.name}`, -0.6, t.id);
      mem(c, t, 'rejected-other', `turned down ${p.name}`, -0.1, p.id);
      p.counters.rejected = (p.counters.rejected ?? 0) + 1;
      feedAbout(c, 'love', `${p.name} proposed to ${t.name} and was turned down.`, p, t);
      return;
    }
    p.counters.engaged = t.id;
    t.counters.engaged = p.id;
    addMood(c, p, `engaged to ${t.name}`, 12, 72);
    addMood(c, t, `engaged to ${p.name}`, 12, 72);
    mem(c, p, 'engaged', `became engaged to ${t.name}`, 0.9, t.id);
    mem(c, t, 'engaged', `became engaged to ${p.name}`, 0.9, p.id);
    feedAbout(c, 'love', `${p.name} and ${t.name} are engaged.`, p, t);
  },
  marry(d) {
    const { c, p, t } = d;
    if (!t || p.counters.engaged !== t.id || t.counters.engaged !== p.id) return;
    p.partner = t.id;
    t.partner = p.id;
    delete p.counters.engaged;
    delete t.counters.engaged;
    // The one without a roof moves in with the other.
    if (p.home === null) p.home = t.home;
    else if (t.home === null) t.home = p.home;
    for (const x of [p, t]) {
      addMood(c, x, 'wedding day', 20, 72);
      bond(c, p, t, 20, 15, 20);
    }
    mem(c, p, 'married', `married ${t.name}`, 1, t.id);
    mem(c, t, 'married', `married ${p.name}`, 1, p.id);
    for (const o of nearbyPeople(c, p.x, p.y, 8)) if (o.id !== p.id && o.id !== t.id) addMood(c, o, `${p.name} and ${t.name} wed`, 3, 12);
    feedAbout(c, 'love', `${p.name} and ${t.name} were married at the shrine.`, p, t);
    stat(c, 'marriages');
  },
  quarrel(d) {
    const { c, p, t } = d;
    if (!t) return;
    bond(c, p, t, 0, -8);
    addMood(c, p, `quarrelled with ${t.name}`, -4, 6);
    addMood(c, t, `quarrelled with ${p.name}`, -4, 6);
    mem(c, p, 'quarrel', `quarrelled with ${t.name}`, -0.5, t.id);
    mem(c, t, 'quarrel', `quarrelled with ${p.name}`, -0.5, p.id);
    p.counters.quarrels = (p.counters.quarrels ?? 0) + 1;
    p.counters[`quarrelAt:${t.id}`] = c.day;
    stat(c, 'quarrels');
    if (c.rng.chance(0.35)) feedAbout(c, 'quarrel', `${p.name} and ${t.name} quarrelled.`, p, t);
  },
  apologise(d) {
    const { c, p, t } = d;
    if (!t) return;
    const k = clamp(0.5 + compat(p, t) * 0.3, 0.2, 0.9);
    if (c.rng.chance(k)) {
      bond(c, p, t, 1, 10);
      addMood(c, p, `made up with ${t.name}`, 3, 12);
      addMood(c, t, `${p.name} apologised`, 3, 12);
      mem(c, t, 'apology', `${p.name} apologised`, 0.4, p.id);
      p.counters.apologies = (p.counters.apologies ?? 0) + 1;
    } else {
      bond(c, p, t, 0, 1);
      mem(c, p, 'refused', `${t.name} would not hear their apology`, -0.2, t.id);
    }
    stat(c, 'apologies');
  },
  gift(d) {
    const { c, p, t } = d;
    if (!t) return;
    if (p.carrying) p.carrying.qty -= 1;
    else if (p.silver >= 3) p.silver -= 3;
    else return;
    if (p.carrying && p.carrying.qty < 0.01) p.carrying = null;
    bond(c, p, t, 2, 8, 3);
    addMood(c, t, `a gift from ${p.name}`, 3, 12);
    mem(c, t, 'gift', `${p.name} gave them a gift`, 0.6, p.id);
    p.counters.gifts = (p.counters.gifts ?? 0) + 1;
    stat(c, 'gifts');
  },
  barter(d) {
    const { c, p, t } = d;
    if (!t) return;
    const goods = p.counters.stall ?? 0;
    const price = 4;
    if (goods >= 1 && t.silver >= price) {
      p.counters.stall = goods - 1;
      p.counters.sold = (p.counters.sold ?? 0) + 1;
      p.silver += price;
      t.silver -= price;
      t.needs.food = clamp(t.needs.food + 25);
      addMood(c, t, 'a tasty dish from a stall', 2, 4);
      addMood(c, p, 'made a sale', 2, 6);
      gainXp(p, 'trading', 10, c.day);
      bond(c, p, t, 1, 2);
      stat(c, 'sales');
    } else {
      // plain barter: a chat over prices
      gainXp(p, 'trading', 3, c.day);
      bond(c, p, t, 1, 1);
    }
  },
  tell_story(d) {
    const { c, p } = d;
    p.needs.purpose = clamp(p.needs.purpose + 6);
    p.needs.company = clamp(p.needs.company + 10);
    bump(p, 'stories');
    const listeners = nearbyPeople(c, p.x, p.y, 6, p.id);
    for (const o of listeners) {
      o.needs.company = clamp(o.needs.company + 10);
      addMood(c, o, `${p.name}'s story`, 2, 4);
      bond(c, p, o, 1, 1.5);
    }
    stat(c, 'stories');
  },
  celebrate(d) {
    const { c, p } = d;
    p.needs.company = clamp(p.needs.company + 20);
    p.needs.purpose = clamp(p.needs.purpose + 4);
    for (const o of nearbyPeople(c, p.x, p.y, 8, p.id)) {
      o.needs.company = clamp(o.needs.company + 15);
      addMood(c, o, 'a celebration', 3, 8);
      bond(c, p, o, 1, 2);
    }
    stat(c, 'celebrations');
  },
  comfort(d) {
    const { c, p, t } = d;
    if (!t) return;
    t.needs.safety = clamp(t.needs.safety + 20);
    addMood(c, t, `${p.name} comforted them`, 4, 8);
    bond(c, p, t, 2, 5);
    mem(c, t, 'comfort', `${p.name} comforted them`, 0.5, p.id);
    p.needs.purpose = clamp(p.needs.purpose + 3);
    stat(c, 'comforts');
  },

  // ---- care --------------------------------------------------------------------------------------------------
  heal(d) {
    const { c, p, t } = d;
    if (!t) return;
    const herb = p.carrying?.good === 'herb' && p.carrying.qty >= 1;
    if (herb) p.carrying!.qty -= 1;
    if (p.carrying && p.carrying.qty < 0.01) p.carrying = null;
    const success = clamp(0.4 + 0.04 * p.skills.healing.lv + (herb ? 0.25 : 0), 0.1, 0.97);
    t.hp = Math.min(t.maxHp, t.hp + 10 + p.skills.healing.lv * 2);
    if (c.rng.chance(success)) {
      const before = t.ills.length;
      t.ills = t.ills.filter((i) => i.id === 'frailty');
      if (before > t.ills.length) {
        mem(c, t, 'healed', `${p.name} healed them`, 0.8, p.id);
        addMood(c, t, `healed by ${p.name}`, 5, 24);
        bump(p, 'healed');
        feedAbout(c, 'care', `${p.name} healed ${t.name}.`, p, t);
      }
    }
    bond(c, p, t, 3, 5);
    gainXp(p, 'healing', 14, c.day);
    stat(c, 'treatments');
  },
  nurse_sick(d) {
    const { c, p, t } = d;
    if (!t) return;
    t.hp = Math.min(t.maxHp, t.hp + 6);
    t.needs.rest = clamp(t.needs.rest + 10);
    addMood(c, t, `${p.name} sat with them`, 3, 8);
    bond(c, p, t, 2, 4);
    gainXp(p, 'healing', 8, c.day);
    bump(p, 'nursed');
  },
  teach(d) {
    const { c, p, t } = d;
    if (!t) return;
    let best: SkillId | null = null;
    for (const s of SKILL_IDS) if (p.skills[s].lv >= t.skills[s].lv + 2 && (!best || p.skills[s].lv > p.skills[best].lv)) best = s;
    if (!best) return;
    const lv = gainXp(t, best, 28 * d.hours, c.day, true);
    gainXp(p, 'teaching', 6, c.day);
    bond(c, p, t, 4, 3);
    bump(p, 'taught');
    mem(c, t, 'taught', `${p.name} taught them ${best}`, 0.5, p.id);
    if (lv && lv >= 5) feedAbout(c, 'skill', `${t.name} reached level ${lv} in ${best}, taught by ${p.name}.`, t, p);
    p.needs.purpose = clamp(p.needs.purpose + 5);
    stat(c, 'lessons');
  },

  // ---- conflict ----------------------------------------------------------------------------------------------------
  brawl(d) {
    const { c, p, t } = d;
    if (!t) return;
    avenged(p, t);
    const { win, lose } = loser(c, p, t);
    hurt(c, win, c.rng.int(3, 8));
    hurt(c, lose, c.rng.int(8, 18));
    bond(c, p, t, 0, -15);
    for (const x of [p, t]) {
      x.needs.safety = clamp(x.needs.safety - 15);
      mem(c, x, 'brawl', `came to blows with ${x === p ? t.name : p.name}`, -0.8, x === p ? t.id : p.id);
    }
    addMood(c, lose, 'lost a fight', -6, 24);
    addMood(c, win, 'won a fight', 2, 12);
    gainXp(win, 'fighting', 12, c.day);
    p.counters.brawls = (p.counters.brawls ?? 0) + 1;
    feedAbout(c, 'fight', `${p.name} and ${t.name} came to blows; ${win.name} came off better.`, p, t);
    stat(c, 'brawls');
  },
  duel(d) {
    const { c, p, t } = d;
    if (!t) return;
    const { win, lose } = loser(c, p, t);
    hurt(c, win, c.rng.int(2, 6));
    hurt(c, lose, c.rng.int(4, 10));
    bond(c, p, t, 2, -3);
    addMood(c, win, 'won a duel of honour', 10, 48);
    addMood(c, lose, 'lost a duel', -8, 48);
    bump(win, 'duelsWon');
    // The same two do not meet again for a month.
    win.counters[`duelWith:${lose.id}`] = c.day;
    lose.counters[`duelWith:${win.id}`] = c.day;
    gainXp(win, 'fighting', 14, c.day);
    gainXp(lose, 'fighting', 10, c.day);
    mem(c, win, 'duel', `beat ${lose.name} in a duel`, 0.7, lose.id);
    mem(c, lose, 'duel', `lost a duel to ${win.name}`, -0.4, win.id);
    feedAbout(c, 'fight', `${win.name} won a duel of honour against ${lose.name}.`, win, lose);
    stat(c, 'duels');
  },
  steal(d) {
    const { c, p } = d;
    const st = c.st;
    const good = (st.stock.ration ?? 0) > 5 ? 'ration' : (st.stock.tool ?? 0) > 1 ? 'tool' : null;
    if (!good) return;
    st.stock[good] = (st.stock[good] ?? 0) - 1;
    if (good === 'tool') p.inv.tool++;
    else give(p, 'ration', 1);
    p.counters.thefts = (p.counters.thefts ?? 0) + 1;
    p.needs.purpose = clamp(p.needs.purpose + 2);
    if (traitMod(p.traits, 'crime') < -0.2) addMood(c, p, 'guilty conscience', -6, 24);
    let seenBy: Person | null = null;
    for (const o of nearbyPeople(c, p.x, p.y, 7, p.id)) {
      if (o.act?.step.a === 'sleep') continue;
      if (c.rng.chance(0.2 + Math.max(0, traitMod(o.traits, 'curious')) * 0.5)) {
        seenBy = o;
        break;
      }
    }
    stat(c, 'thefts');
    if (seenBy) {
      mem(c, seenBy, 'theft', `saw ${p.name} steal from the store`, -0.8, p.id);
      bond(c, seenBy, p, 0, -12);
      // An honest witness reports it.
      if (traitMod(seenBy.traits, 'crime') <= 0.2 && c.rng.chance(0.6)) {
        p.loyalty = clamp(p.loyalty - 15, 0, 100);
        p.counters.caught = (p.counters.caught ?? 0) + 1;
        // The village wants it paid back: a debt that interest slowly grows.
        p.debt += 6;
        addMood(c, p, 'caught stealing', -8, 72);
        feedAbout(c, 'crime', `${p.name} was caught stealing from the store by ${seenBy.name}.`, p, seenBy);
        stat(c, 'caught');
        for (const o of c.people) if (o.id !== p.id && c.rng.chance(0.4)) gossipTo(c, seenBy, o);
      }
    }
  },
  deceive(d) {
    const { c, p, t } = d;
    if (!t) return;
    const take = Math.min(t.silver, c.rng.int(3, 6));
    t.silver -= take;
    p.silver += take;
    p.counters.cheated = (p.counters.cheated ?? 0) + 1;
    stat(c, 'deceptions');
    if (c.rng.chance(0.25 + Math.max(0, traitMod(t.traits, 'curious')) * 0.6)) {
      bond(c, p, t, 0, -20);
      mem(c, t, 'cheated', `was cheated by ${p.name}`, -0.8, p.id);
      addMood(c, t, `cheated by ${p.name}`, -5, 48);
      feedAbout(c, 'crime', `${t.name} found out that ${p.name} had cheated them.`, t, p);
      p.counters.caught = (p.counters.caught ?? 0) + 1;
      p.loyalty = clamp(p.loyalty - 5, 0, 100);
    }
  },
  threaten(d) {
    const { c, p, t } = d;
    if (!t) return;
    avenged(p, t);
    t.needs.safety = clamp(t.needs.safety - 20);
    bond(c, p, t, 0, -10);
    addMood(c, t, `threatened by ${p.name}`, -4, 12);
    mem(c, t, 'threat', `was threatened by ${p.name}`, -0.6, p.id);
    stat(c, 'threats');
  },
  sabotage(d) {
    const { c, p } = d;
    if (p.ambitions.some((a) => a.kind === 'take_revenge' && !a.ended)) p.counters.revenge = 1;
    const f = c.st.fields.find((x) => x.state === 'growing' || x.state === 'ripe');
    if (!f) return;
    f.damage = Math.min(0.6, f.damage + 0.15);
    p.counters.sabotage = (p.counters.sabotage ?? 0) + 1;
    stat(c, 'sabotage');
    for (const o of nearbyPeople(c, p.x, p.y, 7, p.id)) {
      if (c.rng.chance(0.3)) {
        mem(c, o, 'sabotage', `saw ${p.name} spoil the crops`, -0.7, p.id);
        feedAbout(c, 'crime', `${o.name} saw ${p.name} spoiling the crops.`, o, p);
        break;
      }
    }
  },
};
