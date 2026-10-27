import { describe, expect, it } from 'vitest';
import { BAL, CARETAKER_RULES, GAME_DAY_MS, GAME_HOUR_MS, MAX_RULES, TIER_UNLOCK, type BuildingDef, type RuleDef } from '@hearth/shared';
import { arrive } from './life';
import { expireOffers } from './offers';
import { cameHome, dealOf, hearNews, newcomerCount, outsideDay, outsideView, priceOf, tierReason } from './outside';
import { autoSpot } from './policy';
import type { SimSnapshot } from './serialize';
import { createSim } from './sim';
import { kit, setStock, type Kit } from './testkit';

function at(k: Kit, day: number, hour: number): void {
  k.c.day = day;
  k.c.hour = hour;
  k.c.season = Math.floor(day / 24) % 4;
  k.c.now = day * GAME_DAY_MS + hour * GAME_HOUR_MS;
}

function addBuilding(k: Kit, kind: BuildingDef['kind'], n = 1): void {
  for (let i = 0; i < n; i++) {
    const id = k.st.nextBuildingId++;
    k.st.buildings.push({ id, kind, x: 2 + i * 4, y: 2, w: 2, d: 2, door: { x: 2 + i * 4, y: 4 } });
  }
}

const rule = (r: Pick<RuleDef, 'cond' | 'act'>): RuleDef => ({ id: 0, enabled: true, ...r });

describe('prices and deals', () => {
  it('follow the base price, the town’s wealth, its regard for the village and any rumour', () => {
    const k = kit();
    const base = priceOf(k.c, 'ration');
    expect(base).toBeCloseTo(BAL.outside.price.ration, 1);
    k.st.outside.wealth = 90;
    expect(priceOf(k.c, 'ration')).toBeGreaterThan(base);
    k.st.outside.wealth = 50;
    k.st.outside.mods.ration = { x: 2, until: k.c.day + 5 };
    expect(priceOf(k.c, 'ration')).toBeCloseTo(base * 2, 1);
    k.st.outside.mods.ration = { x: 2, until: k.c.day };
    expect(priceOf(k.c, 'ration')).toBeCloseTo(base, 1);
    k.st.outside.regard = 100;
    expect(priceOf(k.c, 'ration')).toBeGreaterThan(base);
  });

  it('sell only a surplus, and buy only what is wanted and can be paid for', () => {
    const k = kit();
    setStock(k, { ration: 100, wood: 100, stone: 40, planks: 20, tool: 1, cloth: 2 });
    k.st.silver = 50;
    expect(Object.keys(dealOf(k.c, true, false).sell)).toEqual([]);
    setStock(k, { ration: 900, wood: 3000, stone: 400, planks: 300, tool: 1, cloth: 2 });
    const sell = dealOf(k.c, true, false);
    expect(sell.sell.ration).toBeGreaterThan(50);
    expect(sell.sell.wood).toBeGreaterThan(50);
    expect(sell.income).toBeGreaterThan(50);
    expect(sell.cost).toBe(0);
    const both = dealOf(k.c, true, true);
    expect(both.buy.tool).toBeGreaterThan(0);
    expect(both.buy.cloth).toBeGreaterThan(0);
    expect(both.cost).toBeLessThanOrEqual(k.st.silver + both.income - 5 + 1e-6);
    k.st.silver = 0;
    setStock(k, { ration: 100, wood: 100, tool: 0, cloth: 0 });
    expect(dealOf(k.c, false, true).buy).toEqual({});
  });
});

describe('caravans', () => {
  const caravanDay = (k: Kit, day = 40): void => {
    at(k, day, 0);
    k.st.outside.caravanDay = day;
    outsideDay(k.c);
  };

  it('come on their day with a decision, and fix the next one a few weeks on', () => {
    const k = kit(5, 12);
    setStock(k, { ration: 900, wood: 2000, planks: 300 });
    caravanDay(k);
    const offer = k.st.offers.find((o) => o.kind === 'trader')!;
    expect(offer).toBeDefined();
    expect(offer.title).toContain(k.st.outside.name);
    expect(offer.fallback).toBe('trade');
    expect(offer.options.map((o) => o.id)).toEqual(['trade', 'sell', 'decline']);
    expect(k.st.outside.caravanDay).toBeGreaterThanOrEqual(40 + BAL.outside.caravan.gap - BAL.outside.caravan.spread);
    expect(k.st.feed.at(-1)!.kind).toBe('offer');
  });

  it('sell the surplus and buy with the silver when the manager says so', () => {
    const k = kit(5, 12);
    setStock(k, { ration: 900, wood: 2000, planks: 300, tool: 0, cloth: 0 });
    k.st.silver = 10;
    caravanDay(k);
    const offer = k.st.offers.find((o) => o.kind === 'trader')!;
    const food0 = k.st.stock.ration;
    expect(k.sim.command({ t: 'answer', offer: offer.id, option: 'trade' }).ok).toBe(true);
    expect(k.st.stock.ration).toBeLessThan(food0);
    expect(k.st.stock.tool).toBeGreaterThan(0);
    expect(k.st.silver).toBeGreaterThan(10);
    expect(k.st.stats.trades).toBe(1);
    expect(k.st.stats.silver_earned).toBeGreaterThan(50);
    expect(k.st.outside.regard).toBeGreaterThan(0);
    expect(k.st.feed.at(-1)!.kind).toBe('trade');
  });

  it('can be sent on, or only sold to', () => {
    const a = kit(5, 12);
    setStock(a, { ration: 900, wood: 2000, tool: 0 });
    caravanDay(a);
    const wood0 = a.st.stock.wood;
    a.sim.command({ t: 'answer', offer: a.st.offers[0].id, option: 'decline' });
    expect(a.st.stock.wood).toBe(wood0);
    expect(a.st.silver).toBe(BAL.outside.startSilver);
    const b = kit(5, 12);
    setStock(b, { ration: 900, wood: 2000, tool: 0 });
    caravanDay(b);
    b.sim.command({ t: 'answer', offer: b.st.offers[0].id, option: 'sell' });
    expect(b.st.stock.tool).toBe(0);
    expect(b.st.silver).toBeGreaterThan(BAL.outside.startSilver);
  });

  it('are settled by their fallback when nobody answers, and at once while the manager is away', () => {
    const k = kit(5, 12);
    setStock(k, { ration: 900, wood: 2000 });
    caravanDay(k);
    expect(k.st.offers).toHaveLength(1);
    at(k, 44, 0);
    expireOffers(k.c);
    expect(k.st.offers).toHaveLength(0);
    expect(k.st.stats.trades).toBe(1);
    const away = kit(5, 12);
    setStock(away, { ration: 900, wood: 2000 });
    away.sim.command({ t: 'away', on: true });
    caravanDay(away, 41);
    expect(away.st.offers).toHaveLength(0);
    expect(away.st.stats.trades).toBe(1);
    expect(away.st.stats.offers_auto).toBe(1);
  });

  it('keep away from a town that thinks badly of the village', () => {
    const k = kit(5, 12);
    k.st.outside.regard = -60;
    caravanDay(k);
    expect(k.st.offers).toHaveLength(0);
    expect(k.st.outside.caravanDay).toBe(43);
  });
});

describe('envoys', () => {
  const envoy = (k: Kit, tribute: boolean): void => {
    at(k, 100, 0);
    k.st.outside.envoyDay = 0;
    k.st.outside.caravanDay = 999;
    k.st.outside.regard = tribute ? -5 : 20;
    // the envoy comes by chance: try days until one does
    for (let d = 100; d < 500 && !k.st.offers.some((o) => o.kind === 'envoy'); d++) {
      at(k, d, 0);
      outsideDay(k.c);
    }
  };

  it('ask for tribute: paying pleases the town, refusing angers it and sends more raiders', () => {
    const paid = kit(7, 12);
    paid.st.silver = 200;
    envoy(paid, true);
    const offer = paid.st.offers.find((o) => o.kind === 'envoy')!;
    expect(offer.data!.tribute).toBeGreaterThan(8);
    const r0 = paid.st.outside.regard;
    expect(paid.sim.command({ t: 'answer', offer: offer.id, option: 'pay' }).ok).toBe(true);
    expect(paid.st.silver).toBe(200 - offer.data!.tribute);
    expect(paid.st.outside.regard).toBeGreaterThan(r0);
    expect(paid.st.dir.raidBonus).toBe(0);
    const refused = kit(7, 12);
    envoy(refused, true);
    const o2 = refused.st.offers.find((o) => o.kind === 'envoy')!;
    const r1 = refused.st.outside.regard;
    refused.sim.command({ t: 'answer', offer: o2.id, option: 'refuse' });
    expect(refused.st.outside.regard).toBeLessThan(r1);
    expect(refused.st.dir.raidBonus).toBe(1);
  });

  it('are settled by the village when unanswered: it pays if it can, and refuses if it cannot', () => {
    const rich = kit(7, 12);
    rich.st.silver = 500;
    envoy(rich, true);
    expect(rich.st.offers.find((o) => o.kind === 'envoy')!.fallback).toBe('pay');
    const poor = kit(7, 12);
    poor.st.silver = 0;
    envoy(poor, true);
    expect(poor.st.offers.find((o) => o.kind === 'envoy')!.fallback).toBe('refuse');
  });

  it('can propose a pact: caravans then come sooner', () => {
    const k = kit(8, 12);
    setStock(k, { ration: 500 });
    let found = false;
    for (let seed = 8; seed < 60 && !found; seed++) {
      const t = kit(seed, 12);
      setStock(t, { ration: 500 });
      envoy(t, false);
      const offer = t.st.offers.find((o) => o.kind === 'envoy');
      if (offer && offer.data!.tribute === 0) {
        found = true;
        const food0 = t.st.stock.ration;
        t.sim.command({ t: 'answer', offer: offer.id, option: 'accept' });
        expect(t.st.outside.pact).toBe(true);
        expect(t.st.stock.ration).toBeLessThan(food0);
        expect(t.st.outside.regard).toBeGreaterThan(20);
      }
    }
    expect(found).toBe(true);
  });
});

describe('rumours and travellers', () => {
  it('move prices, the raids and the regard, and keep the last few', () => {
    const k = kit(3, 12);
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) seen.add(hearNews(k.c));
    expect(seen.size).toBeGreaterThanOrEqual(6);
    expect(k.st.outside.news.length).toBe(5);
    expect(k.st.dir.raidBonus).toBeGreaterThan(0);
    expect(Object.keys(k.st.outside.mods).length).toBeGreaterThan(0);
  });

  it('are brought home by someone who went to see the Outside, with news and sometimes goods', () => {
    const k = kit(3, 12);
    const p = k.c.people[0];
    let goods = 0;
    for (let i = 0; i < 30; i++) {
      const before = k.st.stock.cloth + k.st.stock.tool;
      const text = cameHome(k.c, p);
      expect(text).toContain(p.name);
      if (k.st.stock.cloth + k.st.stock.tool > before) goods++;
    }
    expect(goods).toBeGreaterThan(3);
    expect(goods).toBeLessThan(25);
  });
});

describe('people coming and going', () => {
  it('newcomers come more when the village is fed and liked, and fewer when it is not', () => {
    const k = kit(4, 12);
    k.st.pool = 8;
    setStock(k, { ration: 2000 });
    const count = (): number => {
      let s = 0;
      for (let i = 0; i < 60; i++) s += newcomerCount(k.c);
      return s / 60;
    };
    k.st.outside.regard = 40;
    const liked = count();
    k.st.outside.regard = -40;
    const disliked = count();
    expect(liked).toBeGreaterThan(disliked + 0.8);
    setStock(k, { ration: 10 });
    k.st.outside.regard = 0;
    expect(count()).toBe(0);
    k.st.pool = 0;
    setStock(k, { ration: 2000 });
    k.st.outside.regard = 40;
    expect(newcomerCount(k.c)).toBe(0);
  });

  it('the yearly pool of newcomers fills up again, to a cap', () => {
    const k = kit(4, 12);
    k.st.pool = 0;
    at(k, 96, 0);
    outsideDay(k.c);
    expect(k.st.pool).toBe(BAL.outside.poolPerYear);
    k.st.pool = BAL.outside.poolCap - 1;
    at(k, 192, 0);
    outsideDay(k.c);
    expect(k.st.pool).toBe(BAL.outside.poolCap);
  });

  it('unhappy people with little loyalty leave for the Outside at a season’s end', () => {
    const k = kit(4, 14);
    for (const p of k.c.people) {
      p.mood = 30;
      p.loyalty = 20;
    }
    at(k, 48, 0);
    const n = k.c.people.length;
    outsideDay(k.c);
    expect(k.c.people.length).toBeLessThan(n);
    expect(k.st.stats.emigrants).toBeGreaterThanOrEqual(1);
    const happy = kit(4, 14);
    for (const p of happy.c.people) p.mood = 80;
    at(happy, 48, 0);
    outsideDay(happy.c);
    expect(happy.st.stats.emigrants ?? 0).toBe(0);
  });
});

describe('settlement tiers', () => {
  it('start as a hamlet, become a village with enough people and houses, and a town with more and a watch post, and never go back', () => {
    const k = kit(2, 12);
    k.st.tier = 0;
    at(k, 5, 0);
    outsideDay(k.c);
    expect(k.st.tier).toBe(0);
    addBuilding(k, 'house', BAL.tiers.village.houses);
    arrive(k.c, BAL.tiers.village.people - k.c.people.length, [20, 30]);
    expect(k.c.people.length).toBeGreaterThanOrEqual(BAL.tiers.village.people);
    at(k, 6, 0);
    outsideDay(k.c);
    expect(k.st.tier).toBe(1);
    expect(k.st.feed.find((f) => f.kind === 'tier')!.text).toContain('has grown into a village');
    // a town needs more people, more houses and a watch post
    arrive(k.c, BAL.tiers.town.people - k.c.people.length, [20, 30]);
    addBuilding(k, 'house', BAL.tiers.town.houses);
    at(k, 7, 0);
    outsideDay(k.c);
    expect(k.st.tier).toBe(1);
    addBuilding(k, 'watchpost');
    at(k, 8, 0);
    outsideDay(k.c);
    expect(k.st.tier).toBe(2);
    expect(k.st.feed.filter((f) => f.kind === 'tier')).toHaveLength(2);
    // people leave: the tier stays
    k.st.people.length = 4;
    at(k, 9, 0);
    outsideDay(k.c);
    expect(k.st.tier).toBe(2);
    expect(k.st.peak).toBeGreaterThanOrEqual(BAL.tiers.town.people);
  });

  it('decide what may be built: a hamlet cannot raise a workshop or a second storehouse', () => {
    const k = kit(2, 12);
    k.st.tier = 0;
    expect(TIER_UNLOCK.workshop).toBe(1);
    expect(tierReason('house', 0)).toBeNull();
    expect(tierReason('workshop', 0)).toMatch(/village is needed/);
    for (const kind of ['workshop', 'warehouse'] as const) {
      const spot = autoSpot(k.c, kind) ?? { x: 10, y: 10 };
      const res = k.sim.command({ t: 'build', kind, x: spot.x, y: spot.y });
      expect(res.ok, kind).toBe(false);
      if (!res.ok) expect(res.code).toBe('tier');
    }
    const spot = autoSpot(k.c, 'house')!;
    expect(k.sim.command({ t: 'build', kind: 'house', x: spot.x, y: spot.y }).ok).toBe(true);
    k.st.tier = 1;
    const spot2 = autoSpot(k.c, 'workshop')!;
    expect(k.sim.command({ t: 'build', kind: 'workshop', x: spot2.x, y: spot2.y }).ok).toBe(true);
  });

  it('decide how many orders may be in hand, and the suggested rules fit a hamlet', () => {
    const k = kit(2, 12);
    k.st.tier = 0;
    expect(CARETAKER_RULES.length).toBeLessThanOrEqual(BAL.tiers.maxRules[0]);
    for (let i = 0; i < CARETAKER_RULES.length; i++) expect(k.sim.command({ t: 'rule', rule: rule({ cond: { metric: 'wood', op: '<', value: i }, act: { t: 'ration', level: 0 } }) }).ok).toBe(true);
    expect(k.sim.view().policy.maxRules).toBe(MAX_RULES);
    // orders: put the cap's worth of fields in the books, then one more is refused for the settlement's size
    const cap = BAL.tiers.maxOrders[0];
    k.st.orders.length = 0;
    for (let i = 0; i < cap; i++) k.st.orders.push({ id: 900 + i, mode: 'build', kind: 'house', x: 1, y: 1, w: 1, d: 1, door: { x: 1, y: 2 }, done: 0, work: 0, delivered: {}, placedDay: 0, by: null, labourBy: {} });
    const spot = autoSpot(k.c, 'house')!;
    const full = k.sim.command({ t: 'build', kind: 'house', x: spot.x, y: spot.y });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.text).toMatch(/settlement of this size/);
    k.st.tier = 2;
    expect(BAL.tiers.maxOrders[0]).toBeLessThan(BAL.tiers.maxOrders[2]);
    expect(k.sim.command({ t: 'build', kind: 'house', x: spot.x, y: spot.y }).ok).toBe(true);
  });
});

describe('the Outside in the view and the save', () => {
  it('shows the town, the silver, the tier and the next step', () => {
    const k = kit(2, 12);
    k.st.tier = 0;
    const v = k.sim.view();
    expect(v.outside.name).toBe(k.st.outside.name);
    expect(v.outside.silver).toBe(BAL.outside.startSilver);
    expect(v.outside.nextTier).toMatch(/A village: 16 people and 5 houses/);
    expect(v.outside.prices.ration).toBeGreaterThan(0.5);
    expect(v.status.tier).toBe(0);
    expect(v.status.silver).toBe(BAL.outside.startSilver);
    k.st.tier = 2;
    expect(outsideView(k.c).nextTier).toBeNull();
  });

  it('survive a round trip, and a version 5 save loads with a fresh Outside', { timeout: 120_000 }, () => {
    const sim = createSim({ seed: 14 });
    sim.step(30 * GAME_DAY_MS);
    const st = sim.inspect() as { silver: number; tier: number; outside: { regard: number; news: string[] } };
    st.silver = 77;
    st.outside.regard = 33;
    st.outside.news.push('A rumour.');
    const snap = JSON.parse(JSON.stringify(sim.serialize())) as SimSnapshot;
    expect(snap.v).toBe(7);
    const back = createSim({ seed: 14, saved: snap });
    expect(back.inspect().silver).toBe(77);
    expect(back.inspect().outside.regard).toBe(33);
    expect(back.view().outside.news).toContain('A rumour.');
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(snap));
    raw.v = 5;
    for (const key of ['silver', 'tier', 'peak', 'outside']) delete raw[key];
    const old = createSim({ seed: 14, saved: raw as unknown as SimSnapshot });
    expect(old.inspect().silver).toBe(BAL.outside.startSilver);
    expect(old.inspect().outside.caravanDay).toBeGreaterThanOrEqual(30);
    old.step(2 * GAME_DAY_MS);
    expect(old.view().outside.name.length).toBeGreaterThan(3);
  });

  it('continue exactly after a save and load with a caravan decision waiting', { timeout: 120_000 }, () => {
    const make = () => {
      const sim = createSim({ seed: 15 });
      const st = sim.inspect() as { outside: { caravanDay: number }; stock: Record<string, number> };
      st.outside.caravanDay = 2;
      st.stock.wood = 3000;
      return sim;
    };
    const a = make();
    a.step(3.2 * GAME_DAY_MS);
    expect(a.view().policy.offers.some((o) => o.kind === 'trader')).toBe(true);
    const saved = JSON.parse(JSON.stringify(a.serialize())) as SimSnapshot;
    const b = createSim({ seed: 15, saved });
    a.step(5 * GAME_DAY_MS);
    b.step(5 * GAME_DAY_MS);
    expect(JSON.parse(JSON.stringify(b.serialize()))).toEqual(JSON.parse(JSON.stringify(a.serialize())));
  });
});
