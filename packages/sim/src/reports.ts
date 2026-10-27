/**
 * Reports (M4): a daily and a seasonal report, and the "While you were away" report. A report compares the village with a base
 * taken when the period began, and says what changed and why in plain words: stock flows from the counters the systems keep
 * (food brought in, eaten, spoiled; wood cut, burned), the people who came and went, the events of the feed, the work done.
 */
import { SEASONS, type ReportLine, type ReportTone } from '@hearth/shared';
import type { Ctx } from './ctx';
import { foodDaysOf, fuelDaysOf } from './economy';
import type { Base, Report } from './types';

export const KEEP_DAY_REPORTS = 14;
export const KEEP_SEASON_REPORTS = 6;
export const KEEP_AWAY_REPORTS = 3;

const n0 = (x: number): number => Math.round(x);
const sign = (x: number): string => (x >= 0 ? '+' : '-') + Math.abs(n0(x));

export function emptyBase(): Base {
  return { day: -1, totalMs: 0, stats: {}, stock: {}, people: 0, houses: 0, feedId: 0 };
}

export function baseOf(c: Ctx): Base {
  return {
    day: c.day,
    totalMs: c.now,
    stats: { ...c.st.stats },
    stock: { ...c.st.stock },
    people: c.people.length,
    houses: c.st.buildings.filter((b) => b.kind === 'house' && !b.con).length,
    feedId: c.st.nextFeedId,
  };
}

const TONE_OF_FEED: Record<string, ReportTone> = { raid: 'bad', plague: 'bad', cold: 'warn', harvest: 'warn', blight: 'warn', crisis: 'bad', refugees: 'info', master: 'good', rule: 'info', offer: 'info', death: 'bad' };
/** The feed kinds worth a line in a report (births, chats and the like are counted instead). */
const NOTABLE = ['raid', 'plague', 'cold', 'harvest', 'blight', 'refugees', 'master', 'crisis'];

function linesFor(c: Ctx, base: Base): ReportLine[] {
  const st = c.st;
  const s = (k: string): number => (st.stats[k] ?? 0) - (base.stats[k] ?? 0);
  const out: ReportLine[] = [];
  const line = (text: string, tone: ReportTone = 'info'): void => void out.push({ text, tone });

  // people
  const people = c.people.length;
  const born = s('births');
  const arrived = s('arrivals') + s('refugees');
  const left = s('departures');
  const back = s('returns');
  const parts = [born ? `${n0(born)} born` : '', arrived ? `${n0(arrived)} arrived` : '', left ? `${n0(left)} left` : '', back ? `${n0(back)} came back` : ''].filter(Boolean);
  line(`People: ${people}${base.people !== people ? ` (was ${base.people})` : ''}${parts.length ? `. ${parts.join(', ')}.` : '.'}`, people < base.people ? 'warn' : people > base.people ? 'good' : 'info');
  const dead = st.graves.filter((g) => g.died >= base.day);
  if (dead.length) line(`Deaths: ${dead.slice(0, 4).map((g) => `${g.name} (${g.cause})`).join(', ')}${dead.length > 4 ? ` and ${dead.length - 4} more` : ''}.`, 'bad');

  // food, with the reason it moved
  const food = (st.stock.ration ?? 0) + (st.stock.meal ?? 0);
  const food0 = (base.stock.ration ?? 0) + (base.stock.meal ?? 0);
  const inFood = s('stored_ration') + s('stored_meal');
  const eaten = s('food_eaten');
  const spoilt = s('food_spoiled');
  const lost = s('loot');
  const days = foodDaysOf(c);
  const bits = [inFood > 0.5 ? `${sign(inFood)} brought in` : '', eaten > 0.5 ? `${sign(-eaten)} eaten` : '', spoilt > 0.5 ? `${sign(-spoilt)} spoiled` : ''].filter(Boolean);
  line(`Food: ${n0(food0)} to ${n0(food)} (${sign(food - food0)})${bits.length ? `: ${bits.join(', ')}` : ''}. ${days.toFixed(0)} days at the present rations${st.rationing ? ` (${['', 'tight', 'strict'][st.rationing]})` : ''}.`, days < 7 ? 'bad' : days < 14 ? 'warn' : food >= food0 ? 'good' : 'info');
  if (lost > 0.5) line(`Raiders carried off ${n0(lost)} goods.`, 'bad');

  // wood
  const wood = st.stock.wood ?? 0;
  const wood0 = base.stock.wood ?? 0;
  const cut = s('stored_wood');
  const burned = s('wood_burned');
  const other = cut - burned - (wood - wood0);
  if (Math.abs(wood - wood0) > 0.5 || burned > 0.5) {
    const wb = [cut > 0.5 ? `${sign(cut)} cut` : '', burned > 0.5 ? `${sign(-burned)} burned in the hearths` : '', Math.abs(other) > 1 ? `${sign(-other)} used for planks and building` : ''].filter(Boolean);
    const fuel = fuelDaysOf(c);
    line(`Wood: ${n0(wood0)} to ${n0(wood)} (${sign(wood - wood0)})${wb.length ? `: ${wb.join(', ')}` : ''}.${c.season >= 2 ? ` Enough to heat ${Math.min(99, fuel).toFixed(0)} winter days.` : ''}`, c.season >= 2 && fuel < 8 ? 'bad' : 'info');
  }
  if (s('cold_nights') > 0) line(`${n0(s('cold_nights'))} hearths went cold for want of wood.`, 'warn');

  // work and building
  const jobs = s('jobs_done');
  const built = s('buildings_finished');
  const removed = s('buildings_removed');
  if (jobs > 0 || built > 0) line(`Work: ${n0(jobs)} jobs done${built ? `, ${n0(built)} ${built === 1 ? 'building' : 'buildings'} finished` : ''}${removed ? `, ${n0(removed)} taken down` : ''}.`);
  if (s('rules_fired') > 0) line(`Your rules acted ${n0(s('rules_fired'))} ${s('rules_fired') === 1 ? 'time' : 'times'}.`);
  if (s('offers_auto') > 0) line(`${n0(s('offers_auto'))} ${s('offers_auto') === 1 ? 'decision was' : 'decisions were'} settled by the village without you.`, 'info');

  // the events of the period
  const seen = new Set<string>();
  for (const f of st.feed) {
    if (f.id < base.feedId || !NOTABLE.includes(f.kind)) continue;
    const key = `${f.kind}:${f.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size <= 6) line(f.text, TONE_OF_FEED[f.kind] ?? 'info');
  }

  // mood
  if (people) {
    const mood = c.people.reduce((a, p) => a + p.mood, 0) / people;
    line(`Mood averages ${n0(mood)}${mood < 50 ? ': people are unhappy' : mood > 75 ? ': people are content' : ''}.`, mood < 50 ? 'warn' : mood > 75 ? 'good' : 'info');
  }
  return out;
}

function push(c: Ctx, r: Omit<Report, 'id'>): Report {
  const rep: Report = { ...r, id: c.st.nextReportId++ };
  c.st.reports.push(rep);
  const keep = r.kind === 'day' ? KEEP_DAY_REPORTS : r.kind === 'season' ? KEEP_SEASON_REPORTS : KEEP_AWAY_REPORTS;
  const same = c.st.reports.filter((x) => x.kind === r.kind);
  if (same.length > keep) {
    const drop = new Set(same.slice(0, same.length - keep).map((x) => x.id));
    c.st.reports = c.st.reports.filter((x) => !drop.has(x.id));
  }
  return rep;
}

/** The report of the day that has just ended (called at midnight, before the new day's work starts). */
export function dayReport(c: Ctx): void {
  const base = c.st.dayBase;
  if (base.day >= 0 && base.day < c.day) {
    const dayOfSeason = (base.day % 24) + 1;
    push(c, { kind: 'day', day: base.day, title: `Day ${dayOfSeason} of ${SEASONS[Math.floor(base.day / 24) % 4]}`, lines: linesFor(c, base), unread: true });
  }
  c.st.dayBase = baseOf(c);
}

/** The report of the season that has just ended. */
export function seasonReport(c: Ctx, season: number, year: number): void {
  const base = c.st.seasonBase;
  if (base.day >= 0) push(c, { kind: 'season', day: c.day - 1, title: `End of ${SEASONS[season]}, year ${year + 1}`, lines: linesFor(c, base), unread: true });
  c.st.seasonBase = baseOf(c);
}

/** The manager is back: what happened while the village ran without them. */
export function awayReport(c: Ctx): void {
  const away = c.st.away;
  if (!away) return;
  const days = Math.max(0, c.day - away.since);
  const lines: ReportLine[] = [];
  if (c.st.crisis) lines.push({ text: `The village stopped itself: ${c.st.crisis}`, tone: 'bad' });
  lines.push({ text: days > 0 ? `You were away for ${days} game ${days === 1 ? 'day' : 'days'}.` : 'You were away for a short while.', tone: 'info' });
  lines.push(...linesFor(c, away.base));
  push(c, { kind: 'away', day: c.day, title: 'While you were away', lines, unread: true });
}

export function markRead(c: Ctx, id: number): void {
  const r = c.st.reports.find((x) => x.id === id);
  if (r) r.unread = false;
}
