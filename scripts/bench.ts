/**
 * Simulation cost: milliseconds of CPU per game day at 12, 60, 150 and 300 people.
 *
 * Usage: npm run bench [-- --days 3]
 *
 * The people are the real M1 agents (needs, planner, job board, talk, ambitions, life events). Everyone starts at home on
 * day 0, so the first days include the morning rush on the planner; the numbers are an honest middle of the road, not a
 * best case. The architecture budget is under 20 ms of simulation per real second of 1x time, i.e. under
 * 20 * 360 = 7200 ms per game day (a day is 6 real minutes).
 */
import { GAME_DAY_MS, SIM_STEP_MS } from '@hearth/shared';
import { createSim } from '@hearth/sim';

const argDays = process.argv.indexOf('--days');
const DAYS = argDays > 0 ? Math.max(1, Number(process.argv[argDays + 1]) || 3) : 3;
const SIZES = [12, 60, 150, 300];
const BUDGET_MS_PER_REAL_SECOND = 20;
const REAL_SECONDS_PER_DAY = GAME_DAY_MS / 1000;

console.log(`bench: ${DAYS} game days per size, step ${SIM_STEP_MS} ms, budget ${BUDGET_MS_PER_REAL_SECOND} ms per real second at 1x (= ${BUDGET_MS_PER_REAL_SECOND * REAL_SECONDS_PER_DAY} ms per game day)`);
console.log('people | ms per game day | ms per real second at 1x | ms per tick | within budget');

for (const people of SIZES) {
  const sim = createSim({ seed: 1337, population: people });
  // Warm up the JIT with a short run that is not measured.
  sim.step(20_000);
  const ticks = (DAYS * GAME_DAY_MS) / SIM_STEP_MS;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) sim.step(SIM_STEP_MS);
  const ms = performance.now() - t0;
  const perDay = ms / DAYS;
  const perRealSecond = perDay / REAL_SECONDS_PER_DAY;
  const ok = perRealSecond <= BUDGET_MS_PER_REAL_SECOND;
  console.log(`${String(people).padStart(6)} | ${perDay.toFixed(1).padStart(15)} | ${perRealSecond.toFixed(2).padStart(24)} | ${(ms / ticks).toFixed(4).padStart(11)} | ${ok ? 'yes' : 'NO'}`);
}
