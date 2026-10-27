/**
 * Soak run: several game years on several seeds, with a report on how the village lived.
 *
 * Usage: npm run soak [-- --years 4 --seeds 1,2,3 --pop 12 --quiet]
 *
 * Prints, per seed: population at the end and at its low point, births, deaths by cause, marriages, ambitions fulfilled,
 * abandoned and still stuck, the longest time anybody was stuck with no way forward, the feed by kind, and the
 * average mood. A village that starves, freezes or goes silent shows up here before it shows up in play.
 */
import { AMBITION_KINDS, CARETAKER_RULES, DAYS_PER_YEAR, MAP_SIZE, GAME_DAY_MS, GAME_HOUR_MS } from '@hearth/shared';
import { createSim } from '@hearth/sim';
import { createManager } from './manager';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? def) : def;
}

const YEARS = Number(arg('years', '4'));
const SEEDS = arg('seeds', '1,2,3').split(',').map(Number);
const POP = Number(arg('pop', '12'));
/** The map the villages are made on: the game's own, or `--size 96` for the first small one. */
const SIZE = Number(arg('size', String(MAP_SIZE)));
const quiet = process.argv.includes('--quiet');
/** The scripted manager places orders once a game day; `--no-manager` leaves the village to itself. */
const rulesMode = process.argv.includes('--rules');
const manage = !process.argv.includes('--no-manager') && !rulesMode;

interface Result {
  seed: number;
  end: number;
  low: number;
  lowDay: number;
  stats: Record<string, number>;
  feed: Record<string, number>;
  stuckMax: number;
  idleMax: number;
  stuckAmbitions: number;
  moodAvg: number;
  moodMin: number;
  foodMin: number;
  ms: number;
  placed: Record<string, number>;
  standing: Record<string, number>;
  orders: number;
  /** Population at the end of each game year (index 0 is year 1). */
  byYear: number[];
  tier: number;
  silver: number;
  peak: number;
  /** First year the village fell below `COLLAPSE` people, or 0. */
  collapsedYear: number;
}

/** A village with fewer people than this has collapsed: too few to farm, guard and raise children. */
const COLLAPSE = 6;

function standingOf(list: readonly { kind: string; con?: unknown }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of list) if (!b.con) out[b.kind] = (out[b.kind] ?? 0) + 1;
  return out;
}

function run(seed: number): Result {
  const sim = createSim({ seed, population: POP, size: SIZE });
  const manager = createManager();
  // `--rules`: nobody places orders; the village runs on the suggested standing rules alone (what it does while you are away).
  if (rulesMode) for (const r of CARETAKER_RULES) sim.command({ t: 'rule', rule: { ...r, id: 0 } });
  const t0 = performance.now();
  let low = POP;
  let lowDay = 0;
  let stuckMax = 0;
  let idleMax = 0;
  const idle = new Map<number, number>();
  let moodSum = 0;
  let moodN = 0;
  let moodMin = 100;
  let foodMin = Infinity;
  const feed: Record<string, number> = {};
  const byYear: number[] = [];
  let collapsedYear = 0;
  const days = YEARS * DAYS_PER_YEAR;
  // Sample at noon (the village starts at 06:00), when everyone able should be at something.
  sim.step(6 * GAME_HOUR_MS);
  for (let d = 1; d <= days; d++) {
    sim.step(GAME_DAY_MS);
    if (manage) manager.day(sim);
    const st = sim.inspect();
    const n = st.people.filter((p) => !p.away).length;
    if (n < low) {
      low = n;
      lowDay = d;
    }
    const fd = ((st.stock.ration ?? 0) + (st.stock.meal ?? 0) * 1.15) / Math.max(1, n);
    foodMin = Math.min(foodMin, fd);
    for (const p of st.people) {
      if (p.away) continue;
      moodSum += p.mood;
      moodN++;
      moodMin = Math.min(moodMin, p.mood);
      // Idle at the daily sample: nothing to do and nothing chosen (people who are only waiting out the night do not count).
      const sleeping = p.act?.step.a === 'sleep';
      const baby = (st.totalMs / GAME_DAY_MS - p.born) / DAYS_PER_YEAR < 3;
      const nothing = !baby && !p.act && !p.goal && p.stepMs === 0 && !p.talk && !sleeping;
      const run = nothing ? (idle.get(p.id) ?? 0) + 1 : 0;
      idle.set(p.id, run);
      idleMax = Math.max(idleMax, run);
      if (p.blocked) stuckMax = Math.max(stuckMax, (st.totalMs - p.blocked.since) / GAME_DAY_MS);
    }
    for (const e of sim.events()) if (e.t === "feed") { feed[e.item.kind] = (feed[e.item.kind] ?? 0) + 1; if (process.env.SOAK_DEATHS && e.item.kind === "death") console.log("   ", e.item.text); }
    if (d % DAYS_PER_YEAR === 0) {
      byYear.push(n);
      if (!collapsedYear && n < COLLAPSE) collapsedYear = d / DAYS_PER_YEAR;
    }
    if (n === 0) {
      while (byYear.length < YEARS) byYear.push(0);
      collapsedYear ||= Math.ceil(d / DAYS_PER_YEAR);
      break;
    }
  }
  const st = sim.inspect();
  const stuckAmbitions = st.people.reduce((s, p) => s + p.ambitions.filter((a) => !a.ended && a.stuck).length, 0);
  return { seed, end: st.people.filter((p) => !p.away).length, low, lowDay, stats: st.stats, feed, stuckMax, idleMax, stuckAmbitions, moodAvg: moodSum / Math.max(1, moodN), moodMin, foodMin, ms: performance.now() - t0, placed: manager.placed, standing: standingOf(st.buildings), orders: st.orders.length, byYear, collapsedYear, tier: st.tier, silver: st.silver, peak: st.peak };
}

const total: Record<string, number> = {};
const results: Result[] = [];
console.log(`soak: ${YEARS} game years (${YEARS * DAYS_PER_YEAR} days) on seeds ${SEEDS.join(', ')}, starting population ${POP}`);
for (const seed of SEEDS) {
  const r = run(seed);
  results.push(r);
  const s = r.stats;
  for (const [k, v] of Object.entries(s)) total[k] = (total[k] ?? 0) + v;
  const deaths = Object.entries(s).filter(([k]) => k.startsWith('death_')).map(([k, v]) => `${k.slice(6)} ${v}`).join(', ') || 'none';
  console.log(`\nseed ${r.seed}: ${(r.ms / 1000).toFixed(1)} s of CPU`);
  console.log(`  people: ${POP} at start, ${r.end} at the end, lowest ${r.low} (day ${r.lowDay}); arrivals ${s.arrivals ?? 0}, births ${s.births ?? 0}, deaths ${s.deaths ?? 0} (${deaths}), left ${s.departures ?? 0}, came back ${s.returns ?? 0}`);
  console.log(`  food: lowest stock ${r.foodMin.toFixed(1)} person-days; collapses ${s.collapses ?? 0}, illnesses ${s.illnesses ?? 0}`);
  console.log(`  mood: average ${r.moodAvg.toFixed(1)}, lowest ${r.moodMin.toFixed(0)}`);
  console.log(`  social: marriages ${s.marriages ?? 0}, courtships ${s.courtships ?? 0}, chats ${s.chats ?? 0}, gossips ${s.gossips ?? 0}, quarrels ${s.quarrels ?? 0}, brawls ${s.brawls ?? 0}, thefts ${s.thefts ?? 0}`);
  console.log(`  ambitions: fulfilled ${s.ambitions_fulfilled ?? 0}, abandoned ${s.ambitions_abandoned ?? 0}, stuck at the end ${r.stuckAmbitions}`);
  console.log(`  building: ${manage ? `orders placed ${Object.entries(r.placed).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; ` : ''}finished ${s.buildings_finished ?? 0}, taken down ${s.buildings_removed ?? 0}, still in hand ${r.orders}; standing ${Object.entries(r.standing).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  longest stuck with no way forward: ${r.stuckMax.toFixed(1)} game days; longest run of idle daily samples: ${r.idleMax} days`);
  console.log(`  winter and events: wood burned ${Math.round(s.wood_burned ?? 0)}, cold nights ${s.cold_nights ?? 0}, bad harvests ${s.bad_harvests ?? 0}, plagues ${s.plagues ?? 0} (cases ${s.plague_cases ?? 0}, recovered ${s.plague_recoveries ?? 0}), refugees taken ${s.refugees_taken ?? 0} / turned away ${s.refugees_turned_away ?? 0}`);
  console.log(`  outside: tier at the end ${['hamlet', 'village', 'town'][r.tier]}, peak ${r.peak} people, silver ${Math.round(r.silver)}; caravans ${s.trades ?? 0} (earned ${Math.round(s.silver_earned ?? 0)}, spent ${Math.round(s.silver_spent ?? 0)}), tribute paid ${Math.round(s.tribute_paid ?? 0)} / refused ${s.tribute_refused ?? 0}, emigrants ${s.emigrants ?? 0}, refugees taken ${s.refugees_taken ?? 0}`);
  console.log(`  rules acted ${s.rules_fired ?? 0} times; decisions settled by the village ${s.offers_auto ?? 0}`);
  console.log(`  raids: ${s.raids ?? 0} (repelled ${s.raids_repelled ?? 0}, skirmish ${s.raids_skirmish ?? 0}, overrun ${s.raids_overrun ?? 0}), goods lost ${Math.round(s.loot ?? 0)}, wounds ${s.wounds ?? 0}`);
  console.log(`  population at the end of each year: ${r.byYear.join(', ')}${r.collapsedYear ? ` (collapsed in year ${r.collapsedYear})` : ''}`);
  console.log(`  work: jobs done ${s.jobs_done ?? 0}, refusals ${s.refusals ?? 0}, step failures ${s.step_failures ?? 0}`);
  if (!quiet) console.log(`  feed: ${Object.entries(r.feed).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

// Survival across seeds (docs/notes/balance-v0.md section 8).
const survival = (y: number): string => {
  if (y > YEARS) return 'n/a';
  const alive = results.filter((r) => !r.collapsedYear || r.collapsedYear > y);
  return `${Math.round((100 * alive.length) / results.length)}% (${alive.length}/${results.length})`;
};
console.log(`
survival (population of at least ${COLLAPSE} at the end of the year): year 1 ${survival(1)}, year 3 ${survival(3)}, year 5 ${survival(5)}`);
const ends = results.filter((r) => !r.collapsedYear).map((r) => r.end);
if (ends.length) console.log(`population at the end, survivors: ${ends.join(', ')} (average ${(ends.reduce((a, b) => a + b, 0) / ends.length).toFixed(1)})`);
const starved = results.map((r) => r.stats.death_hunger ?? 0);
console.log(`deaths from hunger, per seed: ${starved.join(', ')}`);

// Across all seeds: which kinds of ambition came true, which were given up, and which never happened at all.
console.log('\nambitions by kind, all seeds (fulfilled / abandoned):');
const never: string[] = [];
for (const k of AMBITION_KINDS) {
  const f = total[`fulfilled_${k}`] ?? 0;
  const a = total[`abandoned_${k}`] ?? 0;
  console.log(`  ${k.padEnd(16)} ${f} / ${a}`);
  if (f === 0) never.push(k);
}
console.log(never.length ? `never fulfilled: ${never.join(', ')}` : 'every kind of ambition was fulfilled at least once');
