import { describe, expect, it } from 'vitest';
import { CARETAKER_RULES, GAME_DAY_MS, GAME_HOUR_MS, JOB_GROUPS, MAX_RULES, PRIORITY_MULT, groupOfJob, type RuleDef } from '@hearth/shared';
import { directorDay } from './director';
import { refreshJobs } from './jobs';
import { autoSpot, condHolds, describeRule, metricOf, priorityMult, runRules } from './policy';
import { baseOf, dayReport, seasonReport } from './reports';
import type { SimSnapshot } from './serialize';
import { createSim } from './sim';
import { kit, setStock, type Kit } from './testkit';

function at(k: Kit, day: number, hour: number): void {
  k.c.day = day;
  k.c.hour = hour;
  k.c.season = Math.floor(day / 24) % 4;
  k.c.now = day * GAME_DAY_MS + hour * GAME_HOUR_MS;
}

const rule = (r: Partial<RuleDef> & Pick<RuleDef, 'cond' | 'act'>): RuleDef => ({ id: 0, enabled: true, ...r });

describe('priorities', () => {
  it('belong to every kind of work on the board', () => {
    for (const t of ['plant', 'tend', 'harvest', 'forage', 'fish', 'hunt', 'cook', 'wood', 'planks', 'stone', 'haul', 'build', 'demolish', 'rubble', 'watch', 'herbs', 'funeral', 'cloth', 'tool']) {
      expect(groupOfJob(t), t).not.toBeNull();
    }
    const k = kit();
    refreshJobs(k.c);
    for (const j of k.st.jobs) expect(groupOfJob(j.type), j.key).not.toBeNull();
  });

  it('scale how attractive a job is: normal is 1, off is nearly nothing, urgent more than doubles it', () => {
    const k = kit();
    refreshJobs(k.c);
    const wood = k.st.jobs.find((j) => j.type === 'wood')!;
    expect(priorityMult(k.c, wood)).toBe(1);
    expect(k.sim.command({ t: 'priority', group: 'wood', level: 4 }).ok).toBe(true);
    expect(priorityMult(k.c, wood)).toBe(PRIORITY_MULT[4]);
    expect(PRIORITY_MULT[4]).toBeGreaterThan(2);
    k.sim.command({ t: 'priority', group: 'wood', level: 0 });
    expect(priorityMult(k.c, wood)).toBeLessThan(0.2);
    expect(k.sim.command({ t: 'priority', group: 'wood', level: 9 }).ok).toBe(false);
    expect(k.sim.command({ t: 'priority', group: 'sport' as 'wood', level: 1 }).ok).toBe(false);
    expect(k.sim.view().policy.priorities).toHaveLength(JOB_GROUPS.length);
  });

  it('move the village: urgent wood puts more people on wood than off wood', { timeout: 60_000 }, () => {
    const run = (level: number): number => {
      const sim = createSim({ seed: 21 });
      sim.step(GAME_HOUR_MS);
      sim.command({ t: 'priority', group: 'wood', level });
      sim.step(3 * GAME_DAY_MS);
      return sim.inspect().stats.stored_wood ?? 0;
    };
    expect(run(4)).toBeGreaterThan(run(0));
  });
});

describe('rules', () => {
  it('look at the village: food days, wood, houses, mood, season and the raid', () => {
    const k = kit();
    setStock(k, { ration: 60, wood: 90, stone: 12 });
    expect(metricOf(k.c, 'foodDays')).toBeCloseTo(60 / k.c.people.length, 3);
    expect(metricOf(k.c, 'wood')).toBe(90);
    expect(metricOf(k.c, 'stone')).toBe(12);
    expect(metricOf(k.c, 'population')).toBe(k.c.people.length);
    expect(metricOf(k.c, 'houses')).toBe(k.st.buildings.filter((b) => b.kind === 'house').length);
    expect(metricOf(k.c, 'raid')).toBe(0);
    k.st.dir.raid = { day: 9, size: 3, warned: true };
    expect(metricOf(k.c, 'raid')).toBe(1);
    at(k, 80, 9);
    expect(metricOf(k.c, 'season')).toBe(3);
    expect(condHolds(k.c, { metric: 'season', op: '=', value: 3 })).toBe(true);
    expect(condHolds(k.c, { metric: 'wood', op: '>', value: 100 })).toBe(false);
    expect(condHolds(k.c, { metric: 'wood', op: '<', value: 100 })).toBe(true);
  });

  it('are added, changed and removed by command, and refuse nonsense and too many', () => {
    const k = kit();
    const add = k.sim.command({ t: 'rule', rule: rule({ cond: { metric: 'foodDays', op: '<', value: 7 }, act: { t: 'ration', level: 1 } }) });
    expect(add.ok).toBe(true);
    const id = k.st.rules[0].id;
    expect(id).toBeGreaterThan(0);
    expect(k.sim.command({ t: 'rule', rule: rule({ id, enabled: false, cond: { metric: 'foodDays', op: '<', value: 5 }, act: { t: 'ration', level: 2 } }) }).ok).toBe(true);
    expect(k.st.rules[0]).toMatchObject({ enabled: false, cond: { value: 5 }, act: { level: 2 } });
    expect(k.sim.command({ t: 'rule', rule: rule({ id: 999, cond: { metric: 'wood', op: '<', value: 1 }, act: { t: 'ration', level: 0 } }) }).ok).toBe(false);
    const bad: RuleDef[] = [
      rule({ cond: { metric: 'luck' as 'wood', op: '<', value: 1 }, act: { t: 'ration', level: 0 } }),
      rule({ cond: { metric: 'wood', op: '~' as '<', value: 1 }, act: { t: 'ration', level: 0 } }),
      rule({ cond: { metric: 'wood', op: '<', value: Infinity }, act: { t: 'ration', level: 0 } }),
      rule({ cond: { metric: 'wood', op: '<', value: 1 }, act: { t: 'ration', level: 5 as 0 } }),
      rule({ cond: { metric: 'wood', op: '<', value: 1 }, act: { t: 'priority', group: 'wood', level: 9 } }),
      rule({ cond: { metric: 'wood', op: '<', value: 1 }, act: { t: 'build', kind: 'castle' as 'house' } }),
    ];
    for (const b of bad) expect(k.sim.command({ t: 'rule', rule: b }).ok).toBe(false);
    expect(k.sim.command({ t: 'rule_del', id }).ok).toBe(true);
    expect(k.sim.command({ t: 'rule_del', id }).ok).toBe(false);
    for (let i = 0; i < MAX_RULES; i++) expect(k.sim.command({ t: 'rule', rule: rule({ cond: { metric: 'wood', op: '<', value: i }, act: { t: 'ration', level: 0 } }) }).ok).toBe(true);
    expect(k.sim.command({ t: 'rule', rule: rule({ cond: { metric: 'wood', op: '<', value: 99 }, act: { t: 'ration', level: 0 } }) }).ok).toBe(false);
  });

  it('set the rations while their condition holds, say so once in the feed, and leave a disabled rule alone', () => {
    const k = kit();
    k.sim.command({ t: 'rule', rule: rule({ cond: { metric: 'foodDays', op: '<', value: 7 }, act: { t: 'ration', level: 1 } }) });
    setStock(k, { ration: 500 });
    runRules(k.c);
    expect(k.st.rationing).toBe(0);
    setStock(k, { ration: 20 });
    runRules(k.c);
    expect(k.st.rationing).toBe(1);
    const said = k.st.feed.filter((f) => f.kind === 'rule').length;
    expect(said).toBe(1);
    runRules(k.c);
    runRules(k.c);
    expect(k.st.feed.filter((f) => f.kind === 'rule').length).toBe(1);
    expect(k.st.stats.rules_fired).toBe(1);
    k.st.rationing = 0;
    k.st.rules[0].enabled = false;
    runRules(k.c);
    expect(k.st.rationing).toBe(0);
    expect(describeRule(k.st.rules[0])).toContain('tight');
  });

  it('set priorities, in order, so a later rule can answer an earlier one', () => {
    const k = kit();
    k.sim.command({ t: 'rule', rule: rule({ cond: { metric: 'raid', op: '=', value: 1 }, act: { t: 'priority', group: 'defence', level: 4 } }) });
    k.sim.command({ t: 'rule', rule: rule({ cond: { metric: 'season', op: '=', value: 2 }, act: { t: 'priority', group: 'wood', level: 3 } }) });
    k.st.dir.raid = { day: 5, size: 3, warned: true };
    at(k, 60, 9);
    runRules(k.c);
    expect(k.st.priorities[JOB_GROUPS.indexOf('defence')]).toBe(4);
    expect(k.st.priorities[JOB_GROUPS.indexOf('wood')]).toBe(3);
  });

  it('order a building on a good spot when the condition holds, one at a time, and not again at once', () => {
    const k = kit();
    const spot = autoSpot(k.c, 'house');
    expect(spot).not.toBeNull();
    k.sim.command({ t: 'rule', rule: rule({ cond: { metric: 'population', op: '>', value: 1 }, act: { t: 'build', kind: 'house' } }) });
    at(k, 10, 9);
    runRules(k.c);
    expect(k.st.orders.filter((o) => o.kind === 'house')).toHaveLength(1);
    // another hour later, with the first still being raised: nothing more
    runRules(k.c);
    expect(k.st.orders.filter((o) => o.kind === 'house')).toHaveLength(1);
    // done and a day later: the cooldown still holds; a few days on, the next one
    k.st.orders.length = 0;
    at(k, 11, 9);
    runRules(k.c);
    expect(k.st.orders).toHaveLength(0);
    at(k, 14, 9);
    runRules(k.c);
    expect(k.st.orders.filter((o) => o.kind === 'house')).toHaveLength(1);
  });

  it('keep the village alive on their own: a tight-rations rule saves food over a thin stretch', { timeout: 60_000 }, () => {
    const run = (withRule: boolean): number => {
      const sim = createSim({ seed: 11 });
      sim.step(2 * GAME_HOUR_MS);
      const st = sim.inspect() as { stock: Record<string, number> };
      st.stock.ration = 60;
      st.stock.meal = 0;
      if (withRule) sim.command({ t: 'rule', rule: rule({ cond: { metric: 'foodDays', op: '<', value: 7 }, act: { t: 'ration', level: 2 } }) });
      sim.step(3 * GAME_DAY_MS);
      return st.stock.ration + st.stock.meal + (sim.inspect().stats.stored_ration ?? 0) * 0;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });
});

describe('the suggested rules', () => {
  it('are all valid and fit in a village, and a village left to them for two months does not fall apart', { timeout: 240_000 }, () => {
    expect(CARETAKER_RULES.length).toBeLessThanOrEqual(MAX_RULES);
    const sim = createSim({ seed: 31 });
    (sim.inspect() as { tier: number }).tier = 2;
    for (const r of CARETAKER_RULES) expect(sim.command({ t: 'rule', rule: { ...r, id: 0 } }).ok).toBe(true);
    expect(sim.view().policy.rules).toHaveLength(CARETAKER_RULES.length);
    sim.command({ t: 'away', on: true });
    sim.step(60 * GAME_DAY_MS);
    const v = sim.view();
    expect(v.policy.crisis).toBeNull();
    expect(v.population).toBeGreaterThanOrEqual(10);
    expect(v.status.foodDays).toBeGreaterThan(3);
    expect(sim.inspect().stats.rules_fired).toBeGreaterThan(2);
    // while away nothing hostile came
    expect(sim.inspect().stats.raids ?? 0).toBe(0);
    sim.command({ t: 'away', on: false });
    expect(sim.view().reports.find((r) => r.kind === 'away')!.lines.some((l) => /Your rules acted/.test(l.text))).toBe(true);
  });
});

describe('reports', () => {
  it('say what happened to the people, the food and the wood in plain words, with the reasons', () => {
    const k = kit();
    at(k, 5, 0);
    k.st.dayBase = baseOf(k.c);
    // a day happens: food comes in and is eaten, wood burns, a child is born, someone dies
    k.st.stock.ration -= 30;
    k.st.stats.food_eaten = (k.st.stats.food_eaten ?? 0) + 34;
    k.st.stats.stored_ration = (k.st.stats.stored_ration ?? 0) + 6;
    k.st.stats.food_spoiled = (k.st.stats.food_spoiled ?? 0) + 1;
    k.st.stats.wood_burned = (k.st.stats.wood_burned ?? 0) + 12;
    k.st.stock.wood -= 12;
    k.st.stats.births = (k.st.stats.births ?? 0) + 1;
    k.st.graves.push({ id: 99, name: 'Old Han', died: 5, cause: 'old age', age: 71, buried: false });
    k.st.stats.jobs_done = (k.st.stats.jobs_done ?? 0) + 40;
    at(k, 6, 0);
    dayReport(k.c);
    const r = k.st.reports.at(-1)!;
    expect(r.kind).toBe('day');
    expect(r.unread).toBe(true);
    const text = r.lines.map((l) => l.text).join('\n');
    expect(text).toMatch(/People: \d+/);
    expect(text).toMatch(/1 born/);
    expect(text).toMatch(/Deaths: Old Han \(old age\)/);
    expect(text).toMatch(/Food: \d+ to \d+ \(-30\)/);
    expect(text, text).toMatch(/\+6 brought in, -34 eaten, -1 spoiled/);
    expect(text).toMatch(/Wood: .*-12 burned in the hearths/);
    expect(text).toMatch(/40 jobs done/);
    expect(text).toMatch(/Mood averages/);
    // the next day starts from now
    expect(k.st.dayBase.day).toBe(6);
  });

  it('give the events of the period, tone them by how bad they are, and keep only the latest few', () => {
    const k = kit();
    at(k, 5, 0);
    k.st.dayBase = baseOf(k.c);
    k.st.feed.push({ id: k.st.nextFeedId++, day: 5, hour: 20, kind: 'raid', text: '4 raiders hit the village.', people: [] });
    for (let d = 6; d < 30; d++) {
      at(k, d, 0);
      dayReport(k.c);
    }
    expect(k.st.reports.filter((r) => r.kind === 'day').length).toBeLessThanOrEqual(14);
    const first = k.st.reports.find((r) => r.day === 5);
    expect(first).toBeUndefined();
    const k2 = kit();
    at(k2, 5, 0);
    k2.st.dayBase = baseOf(k2.c);
    k2.st.feed.push({ id: k2.st.nextFeedId++, day: 5, hour: 20, kind: 'raid', text: '4 raiders hit the village.', people: [] });
    at(k2, 6, 0);
    dayReport(k2.c);
    expect(k2.st.reports.at(-1)!.lines.find((l) => l.text.includes('raiders'))!.tone).toBe('bad');
  });

  it('close a season with its own report when the season changes', () => {
    const sim = createSim({ seed: 4 });
    sim.step(25 * GAME_DAY_MS);
    const seasons = sim.view().reports.filter((r) => r.kind === 'season');
    expect(seasons).toHaveLength(1);
    expect(seasons[0].title).toBe('End of Spring, year 1');
    expect(sim.view().reports.filter((r) => r.kind === 'day').length).toBeGreaterThan(5);
    void seasonReport;
  });

  it('can be marked read', () => {
    const sim = createSim({ seed: 4 });
    sim.step(3 * GAME_DAY_MS);
    const r = sim.view().reports.at(-1)!;
    expect(r.unread).toBe(true);
    sim.command({ t: 'read', report: r.id });
    expect(sim.view().reports.find((x) => x.id === r.id)!.unread).toBe(false);
  });
});

describe('being away', () => {
  it('runs on the rules, keeps the director mild (no raid or plague until the manager is back) and decides offers itself', () => {
    const k = kit(3, 12);
    k.sim.command({ t: 'away', on: true });
    expect(k.sim.view().policy.away).toBe(true);
    at(k, 50, 0);
    k.st.dir.nextRaid = 50;
    directorDay(k.c);
    expect(k.st.dir.raid).toBeNull();
    expect(k.st.dir.nextRaid).toBe(51);
    k.st.dir.raid = { day: 50, size: 4, warned: true };
    directorDay(k.c);
    expect(k.st.dir.raid!.day).toBe(51);
    expect(k.st.stats.raids ?? 0).toBe(0);
    expect(k.st.stats.plagues ?? 0).toBe(0);
  });

  it('writes the "while you were away" report on return, with what the rules did and what the village decided', { timeout: 120_000 }, () => {
    const sim = createSim({ seed: 9 });
    sim.step(2 * GAME_DAY_MS);
    sim.command({ t: 'rule', rule: rule({ cond: { metric: 'foodDays', op: '<', value: 100 }, act: { t: 'priority', group: 'food', level: 3 } }) });
    sim.command({ t: 'away', on: true });
    sim.step(6 * GAME_DAY_MS);
    sim.command({ t: 'away', on: false });
    const view = sim.view();
    const rep = view.reports.filter((r) => r.kind === 'away');
    expect(rep).toHaveLength(1);
    expect(rep[0].title).toBe('While you were away');
    expect(rep[0].unread).toBe(true);
    const text = rep[0].lines.map((l) => l.text).join('\n');
    expect(text).toMatch(/You were away for [4-7] game days/);
    expect(text).toMatch(/Food: /);
    expect(text).toMatch(/Your rules acted 1 time/);
    expect(view.policy.away).toBe(false);
    expect(view.policy.crisis).toBeNull();
  });

  it('parks the village in a crisis state instead of letting it die unseen, and starts again when the manager returns', () => {
    const sim = createSim({ seed: 9 });
    sim.step(2 * GAME_DAY_MS);
    sim.command({ t: 'away', on: true });
    // nearly everybody dies (through the real path, so the sim knows; babies are not ticked, so one or two may remain)
    for (const p of (sim.inspect() as { people: { hp: number }[] }).people) p.hp = -1000;
    sim.step(1.2 * GAME_DAY_MS);
    const v = sim.view();
    expect(v.policy.crisis).toMatch(/only \d+ people are left|nobody is left/);
    expect(v.speed).toBe(0);
    expect(v.feed.at(-1)!.kind).toBe('crisis');
    sim.command({ t: 'away', on: false });
    expect(sim.view().policy.crisis).toBeNull();
    expect(sim.view().reports.find((r) => r.kind === 'away')!.lines[0].text).toMatch(/stopped itself/);
    expect(sim.view().speed).toBe(0);
  });
});

describe('saves', () => {
  it('keep priorities, rules, reports and the away state through a round trip, and a version 4 save loads', () => {
    const sim = createSim({ seed: 12 });
    sim.step(3 * GAME_DAY_MS);
    sim.command({ t: 'priority', group: 'stone', level: 4 });
    sim.command({ t: 'rule', rule: rule({ cond: { metric: 'wood', op: '<', value: 50 }, act: { t: 'priority', group: 'wood', level: 4 } }) });
    sim.command({ t: 'away', on: true });
    const snap = JSON.parse(JSON.stringify(sim.serialize())) as SimSnapshot;
    expect(snap.v).toBe(6);
    const back = createSim({ seed: 12, saved: snap });
    const v = back.view();
    expect(v.policy.priorities[JOB_GROUPS.indexOf('stone')]).toBe(4);
    expect(v.policy.rules).toHaveLength(1);
    expect(v.policy.away).toBe(true);
    expect(v.reports.length).toBe(sim.view().reports.length);
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(snap));
    raw.v = 4;
    for (const key of ['priorities', 'rules', 'nextRuleId', 'offers', 'nextOfferId', 'reports', 'nextReportId', 'dayBase', 'seasonBase', 'away', 'crisis']) delete raw[key];
    const old = createSim({ seed: 12, saved: raw as unknown as SimSnapshot });
    old.step(2 * GAME_DAY_MS);
    expect(old.view().policy.rules).toEqual([]);
    expect(old.view().policy.priorities.every((p) => p === 2)).toBe(true);
    expect(old.view().reports.length).toBeGreaterThanOrEqual(1);
  });

  it('continue exactly after a save and load with rules and an away stretch in the middle', { timeout: 120_000 }, () => {
    const make = () => {
      const sim = createSim({ seed: 13 });
      sim.command({ t: 'rule', rule: rule({ cond: { metric: 'foodDays', op: '<', value: 9 }, act: { t: 'ration', level: 1 } }) });
      sim.step(2 * GAME_DAY_MS);
      sim.command({ t: 'away', on: true });
      return sim;
    };
    const a = make();
    a.step(1.5 * GAME_DAY_MS);
    const saved = JSON.parse(JSON.stringify(a.serialize())) as SimSnapshot;
    const b = createSim({ seed: 13, saved });
    a.step(2 * GAME_DAY_MS);
    b.step(2 * GAME_DAY_MS);
    expect(JSON.parse(JSON.stringify(b.serialize()))).toEqual(JSON.parse(JSON.stringify(a.serialize())));
  });
});
