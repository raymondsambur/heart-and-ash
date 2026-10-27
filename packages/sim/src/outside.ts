/**
 * The Outside (M5): the town beyond the map. It is not drawn; it is a small state (its name, how well it does, what it thinks of the
 * village) and a source of events: caravans that buy the village's surplus and sell what it lacks, envoys who ask for tribute or offer a
 * trade pact, rumours that move prices and raids, newcomers who come when the village is liked and fed, and emigrants who go when it is
 * unhappy. The village has silver, which only the Outside gives and takes. Settlement tiers (hamlet, village, town) live here too:
 * they rise with people and houses and decide what may be built and how many rules and orders a manager can keep.
 */
import { BAL, DAYS_PER_SEASON, DAYS_PER_YEAR, STOCK_GOALS, TIER_NAMES, TIER_UNLOCK, villageName, type BuildKind, type Good, type OutsideView, type Rng } from '@hearth/shared';
import type { Ctx } from './ctx';
import { foodDaysOf, winterBurn } from './economy';
import { pushFeed } from './feed';
import { leave } from './life';
import { openOffer } from './offers';
import type { Offer, OutsideState, Person } from './types';
import { addMood, stat } from './util';

type Priced = keyof typeof BAL.outside.price;
const TRADED = Object.keys(BAL.outside.price) as Priced[];
const r1 = (x: number): number => Math.round(x * 10) / 10;

export function newOutside(rng: Rng): OutsideState {
  const R = BAL.outside.caravan;
  return { name: villageName(rng), regard: 0, wealth: 50, pact: false, caravanDay: R.first + rng.int(0, R.spread), envoyDay: 0, mods: {}, news: [] };
}

/** An older save has no Outside yet: it gets a fresh one whose clocks start at `day`. */
export function ensureOutside(o: Partial<OutsideState> | undefined, rng: Rng, day: number): OutsideState {
  const fresh = newOutside(rng.fork('outside'));
  if (!o) return { ...fresh, caravanDay: fresh.caravanDay + day, envoyDay: day };
  return { name: o.name ?? fresh.name, regard: o.regard ?? 0, wealth: o.wealth ?? 50, pact: !!o.pact, caravanDay: o.caravanDay ?? day + BAL.outside.caravan.first, envoyDay: o.envoyDay ?? day, mods: { ...(o.mods ?? {}) }, news: [...(o.news ?? [])] };
}

// ---------------------------------------------------------------------------------------------------
// Prices and deals
// ---------------------------------------------------------------------------------------------------

/** What the town pays for a good today, silver a unit: the base price, the town's wealth and any rumour's shock. */
export function priceOf(c: Ctx, good: Priced): number {
  const o = c.st.outside;
  const mod = o.mods[good];
  const shock = mod && mod.until > c.day ? mod.x : 1;
  return BAL.outside.price[good] * shock * (1 + (o.wealth - 50) / 400) * (1 + Math.max(-0.1, Math.min(0.1, o.regard / 500)));
}

/** What the village could spare: food beyond 18 days, wood beyond the winter's burn, stone and planks beyond a reserve; half of the surplus. */
function surplus(c: Ctx): Partial<Record<Priced, number>> {
  const s = c.st.stock;
  const half = (have: number, keep: number, cap: number): number => Math.max(0, Math.min(cap, Math.floor((have - keep) * 0.5)));
  return {
    ration: half((s.ration ?? 0) + (s.meal ?? 0), c.people.length * 18, 150),
    wood: half(s.wood ?? 0, Math.max(winterBurn(c), 24) * 26 + 60, 200),
    stone: half(s.stone ?? 0, 150, 80),
    planks: half(s.planks ?? 0, 100, 60),
  };
}

/** What the village would buy: up to its stock goals for planks, tools, cloth and stone. */
function wants(c: Ctx): Partial<Record<Priced, number>> {
  const s = c.st.stock;
  const gap = (g: Good, goal: number, cap: number): number => Math.max(0, Math.min(cap, Math.ceil(goal - (s[g] ?? 0))));
  return { planks: gap('planks', STOCK_GOALS.planks ?? 60, 40), tool: gap('tool', STOCK_GOALS.tool ?? 8, 6), cloth: gap('cloth', STOCK_GOALS.cloth ?? 20, 12), stone: gap('stone', 120, 40) };
}

export interface Deal {
  sell: Partial<Record<Priced, number>>;
  buy: Partial<Record<Priced, number>>;
  income: number;
  cost: number;
}

/** The deal a caravan offers right now: `sell` the surplus, `buy` with what that brings and the treasury (keeping a little in hand). */
export function dealOf(c: Ctx, sells: boolean, buys: boolean): Deal {
  const sell: Deal['sell'] = {};
  let income = 0;
  if (sells) {
    for (const [g, n] of Object.entries(surplus(c)) as [Priced, number][]) {
      if (n <= 0) continue;
      sell[g] = n;
      income += n * priceOf(c, g) * BAL.outside.buyShare;
    }
  }
  const buy: Deal['buy'] = {};
  let cost = 0;
  if (buys) {
    let purse = c.st.silver + income - 5;
    for (const [g, n] of Object.entries(wants(c)) as [Priced, number][]) {
      const unit = priceOf(c, g) * BAL.outside.sellMark;
      const k = Math.min(n, Math.floor(purse / unit));
      if (k <= 0) continue;
      buy[g] = k;
      purse -= k * unit;
      cost += k * unit;
    }
  }
  return { sell, buy, income: r1(income), cost: r1(cost) };
}

const label = (g: Priced): string => (g === 'ration' ? 'food' : g === 'tool' ? 'tools' : g);
const list = (m: Partial<Record<Priced, number>>): string => (Object.entries(m) as [Priced, number][]).map(([g, n]) => `${n} ${label(g)}`).join(', ');

function caravanOffer(c: Ctx): void {
  const o = c.st.outside;
  const sellOnly = dealOf(c, true, false);
  const both = dealOf(c, true, true);
  const worth = sellOnly.income > 4 || Object.keys(both.buy).length > 0;
  const parts = [Object.keys(sellOnly.sell).length ? `They would buy ${list(sellOnly.sell)} for about ${Math.round(sellOnly.income)} silver.` : 'The village has little to spare for them.', Object.keys(both.buy).length ? `They sell ${list(both.buy)} for about ${Math.round(both.cost)} silver.` : '', `The village has ${Math.round(c.st.silver)} silver.`].filter(Boolean);
  openOffer(c, {
    kind: 'trader',
    title: `A caravan from ${o.name}`,
    text: parts.join(' '),
    options: [
      { id: 'trade', label: 'Sell and buy', note: 'Sell the surplus, then buy what the village lacks with the silver.' },
      { id: 'sell', label: 'Only sell', note: 'Keep the silver.' },
      { id: 'decline', label: 'Send them on', note: 'Nothing changes hands.' },
    ],
    fallback: worth ? 'trade' : 'decline',
    n: 0,
  });
}

function settleCaravan(c: Ctx, option: string): void {
  const o = c.st.outside;
  if (option === 'decline') {
    pushFeed(c.st, c.pending, 'trade', `The caravan from ${o.name} moved on without trading.`);
    return;
  }
  const deal = dealOf(c, true, option === 'trade');
  for (const [g, n] of Object.entries(deal.sell) as [Priced, number][]) {
    // food leaves as raw food first, then cooked
    let left = n;
    if (g === 'ration') {
      const raw = Math.min(left, c.st.stock.ration ?? 0);
      c.st.stock.ration = (c.st.stock.ration ?? 0) - raw;
      left -= raw;
      c.st.stock.meal = Math.max(0, (c.st.stock.meal ?? 0) - left);
    } else c.st.stock[g] = Math.max(0, (c.st.stock[g] ?? 0) - n);
  }
  for (const [g, n] of Object.entries(deal.buy) as [Priced, number][]) c.st.stock[g] = (c.st.stock[g] ?? 0) + n;
  c.st.silver = r1(c.st.silver + deal.income - deal.cost);
  o.regard = Math.min(100, o.regard + 2);
  stat(c, 'trades');
  stat(c, 'silver_earned', deal.income);
  stat(c, 'silver_spent', deal.cost);
  const sold = Object.keys(deal.sell).length ? `sold ${list(deal.sell)} for ${Math.round(deal.income)} silver` : '';
  const bought = Object.keys(deal.buy).length ? `bought ${list(deal.buy)} for ${Math.round(deal.cost)} silver` : '';
  pushFeed(c.st, c.pending, 'trade', `The caravan from ${o.name}: the village ${[sold, bought].filter(Boolean).join(' and ') || 'traded nothing'}.`);
}

// ---------------------------------------------------------------------------------------------------
// Envoys
// ---------------------------------------------------------------------------------------------------

/** The tribute an envoy asks, in silver. */
function tributeAsked(c: Ctx): number {
  return Math.round(8 + c.people.length * 1.2 + (c.day / DAYS_PER_YEAR) * 4);
}

/** Pay silver, then goods at the town's prices for the rest. False when the village cannot pay it all (it pays nothing). */
function pay(c: Ctx, silver: number): boolean {
  const s = c.st.stock;
  const goodsValue = (s.ration ?? 0) * priceOf(c, 'ration') * 0.5 + (s.wood ?? 0) * priceOf(c, 'wood') * 0.5;
  if (c.st.silver + goodsValue < silver) return false;
  const fromSilver = Math.min(c.st.silver, silver);
  c.st.silver = r1(c.st.silver - fromSilver);
  let rest = silver - fromSilver;
  if (rest > 0) {
    const wood = Math.min(s.wood ?? 0, Math.ceil(rest / (priceOf(c, 'wood') * 0.5) / 2));
    s.wood = (s.wood ?? 0) - wood;
    rest -= wood * priceOf(c, 'wood') * 0.5;
    if (rest > 0) s.ration = Math.max(0, (s.ration ?? 0) - Math.ceil(rest / (priceOf(c, 'ration') * 0.5)));
  }
  return true;
}

function envoyOffer(c: Ctx): void {
  const o = c.st.outside;
  o.envoyDay = c.day;
  const tribute = o.regard >= 0 && c.rng.chance(0.5) ? 0 : tributeAsked(c);
  if (tribute > 0) {
    openOffer(c, {
      kind: 'envoy',
      title: `An envoy from ${o.name} asks for tribute`,
      text: `The Warden of ${o.name} says the roads are kept safe for those who pay: ${tribute} silver (or its worth in goods). The village has ${Math.round(c.st.silver)} silver. Refusing will not be forgotten, and the roads may turn dangerous.`,
      options: [
        { id: 'pay', label: `Pay ${tribute} silver`, note: 'The Warden thinks well of you.' },
        { id: 'bargain', label: 'Bargain', note: 'Even odds of paying half; if it fails it counts as a refusal.' },
        { id: 'refuse', label: 'Refuse', note: 'The Warden thinks less of you, and raiders may come in greater numbers.' },
      ],
      fallback: c.st.silver >= tribute ? 'pay' : 'refuse',
      n: 0,
      data: { tribute },
    });
  } else {
    openOffer(c, {
      kind: 'envoy',
      title: `An envoy from ${o.name} proposes a trade pact`,
      text: `The Warden of ${o.name} would send caravans more often, for a gift of 10 days' food for the envoy's party.`,
      options: [
        { id: 'accept', label: 'Agree', note: 'Caravans come sooner. Costs about 10 food.' },
        { id: 'decline', label: 'Decline', note: 'Nothing changes.' },
      ],
      fallback: foodDaysOf(c) >= 10 ? 'accept' : 'decline',
      n: 0,
      data: { tribute: 0 },
    });
  }
}

function settleEnvoy(c: Ctx, offer: Offer, option: string): void {
  const o = c.st.outside;
  const tribute = offer.data?.tribute ?? 0;
  const say = (text: string): void => void pushFeed(c.st, c.pending, 'envoy', text);
  if (tribute === 0) {
    if (option === 'accept' && (c.st.stock.ration ?? 0) + (c.st.stock.meal ?? 0) >= 10) {
      c.st.stock.ration = Math.max(0, (c.st.stock.ration ?? 0) - 10);
      o.pact = true;
      o.regard = Math.min(100, o.regard + 15);
      say(`A trade pact with ${o.name}: caravans will come more often.`);
    } else {
      o.regard -= 2;
      say(`The envoy from ${o.name} left without a pact.`);
    }
    return;
  }
  if (option === 'pay' || (option === 'bargain' && c.rng.chance(0.5))) {
    const sum = option === 'pay' ? tribute : Math.ceil(tribute / 2);
    if (pay(c, sum)) {
      o.regard = Math.min(100, o.regard + (option === 'pay' ? 8 : 3));
      stat(c, 'tribute_paid', sum);
      say(`The village paid ${sum} silver to ${o.name}. The Warden thinks well of it.`);
      return;
    }
  }
  o.regard = Math.max(-100, o.regard - 15);
  c.st.dir.raidBonus += 1;
  stat(c, 'tribute_refused');
  say(`The envoy from ${o.name} left angry. The roads will be less safe.`);
}

/** Called by `offers.ts` when a decision of the Outside is settled. */
export function settleOutsideOffer(c: Ctx, offer: Offer, option: string): void {
  if (offer.kind === 'trader') settleCaravan(c, option);
  else if (offer.kind === 'envoy') settleEnvoy(c, offer, option);
}

// ---------------------------------------------------------------------------------------------------
// Rumours
// ---------------------------------------------------------------------------------------------------

interface Rumour {
  text: string;
  when?: (c: Ctx) => boolean;
  run(c: Ctx): void;
}

const shock = (c: Ctx, g: Priced, x: number): void => void (c.st.outside.mods[g] = { x, until: c.day + BAL.outside.news.shock });

const RUMOURS: Rumour[] = [
  { text: 'A famine in the lowlands: grain is dear in the markets.', run: (c) => shock(c, 'ration', 1.8) },
  { text: 'A bumper harvest in the lowlands: grain is cheap in the markets.', run: (c) => shock(c, 'ration', 0.6) },
  { text: 'Timber is scarce in town: wood fetches a good price.', run: (c) => shock(c, 'wood', 1.8) },
  { text: 'A new smithy has opened in town: tools are cheap.', run: (c) => shock(c, 'tool', 0.6) },
  { text: 'Merchants say bandits are growing bolder on the roads.', run: (c) => void (c.st.dir.raidBonus += 1) },
  { text: 'Sickness in the lowlands: caravans are keeping away for a while.', run: (c) => void (c.st.outside.caravanDay += 12) },
  { text: 'The Warden is raising a levy; an envoy may come soon.', run: (c) => void (c.st.outside.envoyDay -= 25) },
  { text: 'A caravan master praised the village’s honest dealing in the town.', when: (c) => c.st.outside.regard > 10, run: (c) => void (c.st.outside.regard = Math.min(100, c.st.outside.regard + 5)) },
];

/** A piece of news from beyond the map, with what it does. Returns its text. */
export function hearNews(c: Ctx): string {
  const pool = RUMOURS.filter((r) => !r.when || r.when(c));
  const r = c.rng.pick(pool);
  r.run(c);
  const o = c.st.outside;
  o.news.push(r.text);
  if (o.news.length > 5) o.news.shift();
  return r.text;
}

/** Someone comes home from the Outside: they bring news, and sometimes goods. */
export function cameHome(c: Ctx, p: Person): string {
  const text = hearNews(c);
  let goods = '';
  if (c.rng.chance(0.4)) {
    const g: Good = c.rng.chance(0.5) ? 'cloth' : 'tool';
    const n = g === 'cloth' ? c.rng.int(3, 8) : c.rng.int(1, 2);
    c.st.stock[g] = (c.st.stock[g] ?? 0) + n;
    goods = ` and brought ${n} ${g === 'tool' ? (n === 1 ? 'tool' : 'tools') : 'cloth'}`;
  }
  addMood(c, p, 'home again with news', 2, 24);
  return `${p.name} came home with news${goods}: ${text}`;
}

// ---------------------------------------------------------------------------------------------------
// People coming and going
// ---------------------------------------------------------------------------------------------------

/** How many newcomers the Outside sends this season: more when the village is fed and liked, fewer when it is not. */
export function newcomerCount(c: Ctx): number {
  const fed = foodDaysOf(c);
  let n = fed > 20 ? c.rng.int(1, 2) : fed > 8 ? c.rng.int(0, 1) : 0;
  const regard = c.st.outside.regard;
  if (regard >= 25) n += 1;
  if (regard <= -25) n -= 1;
  if (c.st.tier >= 1 && fed > 20) n += 1;
  return Math.max(0, Math.min(n, c.st.pool));
}

/** At the end of a season, if people are unhappy, one or two of the least loyal go to the Outside for good. */
function emigrate(c: Ctx): void {
  if (c.people.length <= 8) return;
  const mood = c.people.reduce((s, p) => s + p.mood, 0) / c.people.length;
  if (mood >= 52) return;
  const gone = c.people.filter((p) => p.loyalty < 45 && p.home !== null).sort((a, b) => a.loyalty - b.loyalty || a.id - b.id).slice(0, c.rng.int(1, 2));
  for (const p of gone) {
    leave(c, p, false, `for ${c.st.outside.name}, hoping for a better life`);
    stat(c, 'emigrants');
  }
}

// ---------------------------------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------------------------------

export function houses(c: Ctx): number {
  return c.st.buildings.filter((b) => b.kind === 'house' && !b.con).length;
}

/** What the next tier asks for, in words, or null in a town. */
export function nextTierText(c: Ctx): string | null {
  const T = BAL.tiers;
  if (c.st.tier === 0) return `A village: ${T.village.people} people and ${T.village.houses} houses.`;
  if (c.st.tier === 1) return `A town: ${T.town.people} people, ${T.town.houses} houses and a watch post.`;
  return null;
}

/** The tier the village has earned: it only goes up. */
function tierDay(c: Ctx): void {
  const T = BAL.tiers;
  const n = c.people.length;
  const h = houses(c);
  const posts = c.st.buildings.filter((b) => b.kind === 'watchpost' && !b.con).length;
  let tier: 0 | 1 | 2 = c.st.tier;
  if (tier < 1 && n >= T.village.people && h >= T.village.houses) tier = 1;
  if (tier < 2 && n >= T.town.people && h >= T.town.houses && posts >= T.town.watchposts) tier = 2;
  if (tier > c.st.tier) {
    c.st.tier = tier;
    pushFeed(c.st, c.pending, 'tier', `${c.st.villageName} has grown into a ${TIER_NAMES[tier]}. ${tier === 1 ? 'Workshops and a second storehouse may be built, and a manager can have more orders in hand.' : 'More orders may be in hand.'}`);
  }
}

/** Why a kind of building is not yet allowed, or null. */
export function tierReason(kind: BuildKind, tier: number): string | null {
  const need = TIER_UNLOCK[kind] ?? 0;
  return tier >= need ? null : `A ${TIER_NAMES[need]} is needed to raise this (the settlement is a ${TIER_NAMES[tier]}).`;
}

// ---------------------------------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------------------------------

/** Run once a game day, after the daily life and the director. */
export function outsideDay(c: Ctx): void {
  const o = c.st.outside;
  const day = c.day;
  c.st.peak = Math.max(c.st.peak, c.people.length);
  tierDay(c);

  o.regard = Math.abs(o.regard) <= BAL.outside.regardFade ? 0 : o.regard - Math.sign(o.regard) * BAL.outside.regardFade;
  o.wealth = Math.max(20, Math.min(90, o.wealth + c.rng.float(-1.2, 1.2) + (50 - o.wealth) * 0.01));
  for (const [g, m] of Object.entries(o.mods)) if (m.until <= day) delete o.mods[g];

  if (day > 0 && day % DAYS_PER_YEAR === 0) c.st.pool = Math.min(BAL.outside.poolCap, c.st.pool + BAL.outside.poolPerYear);
  if (day > 0 && day % DAYS_PER_SEASON === 0) emigrate(c);

  // rumours come by themselves, and a village the Outside has heard of hears more
  if (c.rng.chance(BAL.outside.news.chance)) pushFeed(c.st, c.pending, 'news', hearNews(c));

  // the caravan; the manager's absence does not stop it, the village's fallback deals
  if (day >= o.caravanDay && !c.st.offers.some((x) => x.kind === 'trader') && o.regard > -30) {
    const R = BAL.outside.caravan;
    o.caravanDay = day + Math.round((R.gap + c.rng.int(-R.spread, R.spread)) * (o.pact ? R.pactFactor : 1));
    caravanOffer(c);
    if (c.st.away) {
      const offer = c.st.offers.find((x) => x.kind === 'trader');
      if (offer) settleOutsideOfferAuto(c, offer);
    }
  } else if (day >= o.caravanDay) o.caravanDay = day + 3;

  // the envoy
  const E = BAL.outside.envoy;
  if (day >= E.from && day - o.envoyDay >= E.gap && !c.st.offers.some((x) => x.kind === 'envoy') && c.rng.chance(E.chance)) {
    envoyOffer(c);
    if (c.st.away) {
      const offer = c.st.offers.find((x) => x.kind === 'envoy');
      if (offer) settleOutsideOfferAuto(c, offer);
    }
  }
}

/** The manager is away: the decision is taken by its fallback at once (the same path as an unanswered one). */
function settleOutsideOfferAuto(c: Ctx, offer: Offer): void {
  c.st.offers = c.st.offers.filter((o) => o.id !== offer.id);
  stat(c, 'offers_auto');
  settleOutsideOffer(c, offer, offer.fallback);
}

export function outsideView(c: Ctx): OutsideView {
  const o = c.st.outside;
  const prices: Record<string, number> = {};
  for (const g of TRADED) prices[g] = r1(priceOf(c, g) * BAL.outside.buyShare);
  return {
    name: o.name,
    regard: Math.round(o.regard),
    wealth: Math.round(o.wealth),
    silver: Math.round(c.st.silver * 10) / 10,
    pact: o.pact,
    caravanIn: Math.max(0, o.caravanDay - c.day),
    news: [...o.news],
    nextTier: nextTierText(c),
    prices,
  };
}
