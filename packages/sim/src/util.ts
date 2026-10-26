/** Small helpers the systems share: mood events, relations, carrying goods, counters, feed lines. */
import { GAME_HOUR_MS, TRAITS, traitMod, type Good } from '@hearth/shared';
import type { Ctx } from './ctx';
import { pushFeed } from './feed';
import { ageOf } from './people';
import { remember } from './memory';
import type { Memory, Person, Relation } from './types';

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function addMood(c: Ctx, p: Person, text: string, v: number, hours: number): void {
  const e = p.moodEvents.find((x) => x.text === text);
  if (e) {
    e.until = Math.max(e.until, c.now + hours * GAME_HOUR_MS);
    return;
  }
  p.moodEvents.push({ text, v, until: c.now + hours * GAME_HOUR_MS });
  if (p.moodEvents.length > 12) p.moodEvents.shift();
}

export function relOf(p: Person, other: number): Relation {
  let r = p.relations[other];
  if (!r) {
    r = { fam: 0, aff: 0, rom: 0, last: 0 };
    p.relations[other] = r;
  }
  return r;
}

export function peekRel(p: Person, other: number): Relation | undefined {
  return p.relations[other];
}

/** How well two people suit each other, -1..1, from their traits (a gregarious and a solitary clash; two kind people drift together). */
export function compat(a: Person, b: Person): number {
  let s = 0;
  const sa = traitMod(a.traits, 'social');
  const sb = traitMod(b.traits, 'social');
  s -= Math.abs(sa - sb) * 0.5;
  s += Math.min(traitMod(a.traits, 'kind'), traitMod(b.traits, 'kind')) * 0.8;
  s -= Math.max(0, traitMod(a.traits, 'temper')) * Math.max(0, traitMod(b.traits, 'temper')) * 1.2;
  for (const t of a.traits) {
    if (b.traits.includes(t)) s += 0.12;
    const o = TRAITS[t].opposite;
    if (o && b.traits.includes(o)) s -= 0.2;
  }
  if (traitMod(a.traits, 'crime') < -0.3 && traitMod(b.traits, 'crime') > 0.3) s -= 0.3;
  // A little personal taste, fixed by the pair.
  const taste = (((a.id * 73856093) ^ (b.id * 19349663)) >>> 0) % 100;
  s += (taste - 50) / 250;
  return clamp(s, -1, 1);
}

/** Change how two people feel about each other (both ways, with their own compat shading). */
export function bond(c: Ctx, a: Person, b: Person, dFam: number, dAff: number, dRom = 0): void {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const r = relOf(x, y.id);
    r.fam = clamp(r.fam + dFam, 0, 100);
    r.aff = clamp(r.aff + dAff, -100, 100);
    r.rom = clamp(r.rom + dRom, 0, 100);
    r.last = c.day;
  }
}

export function give(p: Person, good: Good, qty: number): void {
  if (p.carrying && p.carrying.good === good) p.carrying.qty += qty;
  else p.carrying = { good, qty };
}

export function takeCarry(p: Person, qty: number): number {
  if (!p.carrying) return 0;
  const t = Math.min(qty, p.carrying.qty);
  p.carrying.qty -= t;
  if (p.carrying.qty < 0.01) p.carrying = null;
  return t;
}

export function stat(c: Ctx, key: string, n = 1): void {
  c.st.stats[key] = (c.st.stats[key] ?? 0) + n;
}

export function bump(p: Person, key: string, n = 1): number {
  p.counters[key] = (p.counters[key] ?? 0) + n;
  return p.counters[key];
}

export function feedAbout(c: Ctx, kind: string, text: string, ...people: Person[]): void {
  pushFeed(c.st, c.pending, kind, text, people.map((p) => p.id));
}

export function mem(c: Ctx, p: Person, kind: string, what: string, val: number, who?: number, from?: number): void {
  const m: Omit<Memory, 'w'> = { kind, what, val, day: c.day, who, from };
  remember(p, m);
}

export function firstName(p: Person): string {
  return p.name;
}

/** People close to a tile, awake and on the map. */
export function nearbyPeople(c: Ctx, x: number, y: number, r: number, except?: number): Person[] {
  const out: Person[] = [];
  for (const o of c.people) if (o.id !== except && Math.abs(o.x - x) <= r && Math.abs(o.y - y) <= r && !o.hidden) out.push(o);
  return out;
}

export function isAdult(p: Person, day: number): boolean {
  return ageOf(p, day) >= 16;
}

/** Awake and free to talk: not asleep, not already in a conversation, not away. */
export function isFree(p: Person): boolean {
  // Someone who is hungry or thirsty is not free to be pulled into a chat.
  return !p.away && !p.talk && !(p.act && p.act.step.a === 'sleep') && p.needs.rest > 8 && p.needs.food > 25 && p.needs.water > 25;
}
