/** Needs and mood (docs/notes/m1-agent-brain-spec.md, section 3). */
import { GAME_HOUR_MS, NEEDS, NEED_IDS, TRAITS, traitMod, type NeedId, type WeatherKind } from '@hearth/shared';
import { ageOf, COMING_OF_AGE } from './people';
import type { Person } from './types';

export const clamp = (v: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, v));

/** Outdoor temperature in degrees (rough): the season, the hour and the weather. */
export function temperature(season: number, hour: number, weather: WeatherKind): number {
  const base = [10, 22, 9, -4][season] ?? 10;
  const cycle = Math.cos(((hour - 15) / 24) * Math.PI * 2) * 4;
  const w = weather === 'snow' ? -3 : weather === 'rain' || weather === 'storm' ? -2 : weather === 'fog' ? -1 : weather === 'clear' ? 1 : 0;
  return base + cycle + w;
}

export interface Climate {
  temp: number;
}

/** What each need does to health when it runs out. */
export interface NeedTickResult {
  /** Health lost per game hour this step (starvation, thirst, cold). */
  harm: number;
  cause: string;
}

/** Hunger and thirst fall more slowly in children and the old; the need rates are per game hour. */
function metabolism(age: number): number {
  return age < COMING_OF_AGE ? 0.6 : age >= 60 ? 0.8 : 1;
}

/**
 * Advance a person's needs by `dt` game ms. `sleeping` people recover rest and use less food and water; `indoors` shelters
 * from the cold; `fire` heats the room; `company` is the number of other people close by (safety recovers near others).
 */
export function tickNeeds(p: Person, dt: number, day: number, temp: number, state: { sleeping: boolean; indoors: boolean; fire: boolean; company: number }): NeedTickResult {
  const h = dt / GAME_HOUR_MS;
  const age = ageOf(p, day);
  const meta = metabolism(age);
  const n = p.needs;
  const slow = state.sleeping ? 0.5 : 1;
  n.food = clamp(n.food - NEEDS.food.fall * meta * slow * h);
  n.water = clamp(n.water - NEEDS.water.fall * meta * slow * h);
  if (!state.sleeping) n.rest = clamp(n.rest - NEEDS.rest.fall * (1 + traitMod(p.traits, 'rest') * 0.2 + (age >= 60 ? 0.2 : 0)) * h);
  n.company = clamp(n.company - NEEDS.company.fall * (1 + traitMod(p.traits, 'social')) * (state.sleeping ? 0.3 : 1) * h);
  n.purpose = clamp(n.purpose - NEEDS.purpose.fall * (state.sleeping ? 0.3 : 1) * h);
  // warmth
  const cold = Math.max(0, 8 - temp) * 0.5;
  if (state.indoors && state.fire) n.warmth = clamp(n.warmth + 15 * h);
  else if (state.indoors) n.warmth = clamp(n.warmth + (cold > 0 ? -cold * 0.35 * (p.inv.clothes > 0 ? 0.5 : 1) : 4) * h);
  else n.warmth = clamp(n.warmth + (cold > 0 ? -cold * (p.inv.clothes > 0 ? 0.5 : 1) : 5) * h);
  // safety recovers indoors and among other people
  if (n.safety < 100) n.safety = clamp(n.safety + (state.indoors || state.company > 0 ? 3 : 0.5) * h);
  // health
  let harm = 0;
  let cause = '';
  if (n.food < 10) {
    harm += n.food <= 0 ? 4 : 1.5;
    cause = 'hunger';
  }
  if (n.water < 10) {
    harm += n.water <= 0 ? 5 : 2;
    cause = 'thirst';
  }
  if (n.warmth < 10) {
    harm += 1.2;
    cause = 'cold';
  }
  if (harm > 0) p.hp -= harm * h;
  else if (p.hp < p.maxHp && n.food > 30 && n.water > 30) p.hp = Math.min(p.maxHp, p.hp + 0.6 * h);
  return { harm, cause };
}

export interface MoodCause {
  text: string;
  v: number;
}

/** Mood = a weighted mean of needs plus recent mood events, with the biggest causes (docs spec 3). */
export function computeMood(p: Person, now: number): { mood: number; causes: MoodCause[] } {
  let sumW = 0;
  let sum = 0;
  const parts: MoodCause[] = [];
  for (const id of NEED_IDS) {
    const w = NEEDS[id].weight;
    sumW += w;
    sum += p.needs[id] * w;
  }
  const mean = sum / sumW;
  for (const id of NEED_IDS) {
    const dev = ((p.needs[id] - 70) * NEEDS[id].weight) / sumW;
    if (Math.abs(dev) >= 1.5) parts.push({ text: needPhrase(id, p.needs[id]), v: Math.round(dev * 10) / 10 });
  }
  let events = 0;
  for (const e of p.moodEvents) {
    if (e.until > now) {
      events += e.v;
      parts.push({ text: e.text, v: e.v });
    }
  }
  const mood = clamp(mean + events);
  parts.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  return { mood: Math.round(mood), causes: parts.slice(0, 3) };
}

export function needPhrase(id: NeedId, v: number): string {
  const d = NEEDS[id];
  if (v < 10) return d.critical;
  if (v < 30) return d.low;
  if (v < 55) return `${d.label.toLowerCase()} is getting low`;
  if (v > 80) return `well supplied with ${d.label.toLowerCase()}`;
  return `${d.label.toLowerCase()} is fine`;
}

/** The lowest need and what to call it, for the sheet. */
export function lowestNeed(p: Person): { id: NeedId; v: number } {
  let best: NeedId = 'food';
  for (const id of NEED_IDS) if (p.needs[id] < p.needs[best]) best = id;
  return { id: best, v: p.needs[best] };
}

export function hasTrait(p: Person, ...ids: (keyof typeof TRAITS)[]): boolean {
  return ids.some((i) => p.traits.includes(i));
}
