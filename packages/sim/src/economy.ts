/**
 * The village economy (M3): hearths that burn the winter's wood, spoilage, rationing, and the aims the standing jobs work towards
 * (docs/notes/balance-v0.md sections 2 to 4, docs/notes/m3.md). Everything is stock in the village store; people move goods in and
 * out through the job board, and this file only decides what the village uses up and what it wants more of.
 */
import { BAL, DAYS_PER_SEASON, GAME_HOUR_MS, type VillageStatus } from '@hearth/shared';
import type { Ctx } from './ctx';
import { pushFeed } from './feed';
import { stat } from './util';

/** Houses that are finished and have somebody living in them. */
export function warmHouses(c: Ctx): number[] {
  const out: number[] = [];
  for (const b of c.st.buildings) {
    if (b.kind !== 'house' || b.con) continue;
    if (c.st.people.some((p) => p.home === b.id && !p.away)) out.push(b.id);
  }
  return out;
}

/** Days of food in the store for the people who are here (raw food and cooked meals, a meal counts a little more). */
export function foodDaysOf(c: Ctx): number {
  const people = Math.max(1, c.people.length);
  return ((c.st.stock.ration ?? 0) + (c.st.stock.meal ?? 0) * 1.15) / people;
}

/** Wood a winter day costs the village with the houses it has now. */
export function winterBurn(c: Ctx): number {
  return warmHouses(c).length * BAL.heat.woodPerHouse[3];
}

/** Days the wood in the store would heat the village through winter. */
export function fuelDaysOf(c: Ctx): number {
  const burn = winterBurn(c);
  return burn > 0 ? (c.st.stock.wood ?? 0) / burn : 99;
}

/** Tiles of Blight that reach the village once the shrines' ward is taken off. */
export function blightReach(c: Ctx): number {
  const wards = c.st.buildings.filter((b) => b.kind === 'shrine' && !b.con).length;
  return Math.max(0, c.st.dir.blight - wards * 2);
}

/** Light the hearths of the houses people live in; they burn through the night and use the village's wood. Once an evening. */
export function lightHearths(c: Ctx): void {
  if (c.hour < BAL.heat.lightHour || c.st.hearthDay === c.day) return;
  c.st.hearthDay = c.day;
  const per = BAL.heat.woodPerHouse[c.season] ?? 0;
  if (per <= 0) return;
  let short = 0;
  for (const id of warmHouses(c)) {
    const have = c.st.stock.wood ?? 0;
    const share = Math.min(1, have / per);
    c.st.stock.wood = have - per * share;
    if (share < 0.25) short++;
    if (share > 0) c.st.fires[id] = Math.max(c.st.fires[id] ?? 0, c.now + BAL.heat.burnHours * share * GAME_HOUR_MS);
    stat(c, 'wood_burned', per * share);
  }
  if (short > 0) {
    stat(c, 'cold_nights', short);
    if ((c.st.dir.last.nowood ?? -9) < c.day - 3) {
      c.st.dir.last.nowood = c.day;
      pushFeed(c.st, c.pending, 'cold', short === 1 ? 'There is no firewood left for one of the hearths.' : `There is no firewood left for ${short} of the hearths.`);
    }
  }
}

/** Spoilage, once a day. Cold keeps food, a second storehouse is a cold store, and the Blight's reach spoils it faster. */
export function spoil(c: Ctx): void {
  const stores = c.st.buildings.filter((b) => b.kind === 'warehouse' && !b.con).length;
  const f = (c.season === 3 ? BAL.spoil.winter : 1) * (stores >= 2 ? BAL.spoil.storehouse : 1) * (1 + BAL.spoil.perBlight * blightReach(c));
  const s = c.st.stock;
  const before = (s.ration ?? 0) + (s.meal ?? 0);
  s.ration = (s.ration ?? 0) * (1 - BAL.spoil.ration * f);
  s.meal = (s.meal ?? 0) * (1 - BAL.spoil.meal * f);
  stat(c, 'food_spoiled', before - s.ration - s.meal);
  s.herb = (s.herb ?? 0) * (1 - BAL.spoil.herb * f);
}

/** What the person who eats is given and what it does for them at the village's rationing level. */
export function rationOf(c: Ctx): { portion: number; points: number; mood: number } {
  const l = c.st.rationing;
  return { portion: BAL.ration.portion[l], points: BAL.ration.points[l], mood: BAL.ration.mood[l] };
}

/** Days left of the season we are in, counting today. */
function daysLeftInSeason(c: Ctx): number {
  return DAYS_PER_SEASON - (c.day % DAYS_PER_SEASON);
}

/** How much wood the village wants in the store now, and how badly. Autumn is for the winter's wood. */
export function woodGoal(c: Ctx): { target: number; priority: number } {
  const burn = Math.max(winterBurn(c), 4 * 6);
  const ahead = BAL.winter.woodDaysAhead[c.season];
  // In winter itself the aim is what is left of the season, plus a margin.
  const target = c.season === 3 ? burn * daysLeftInSeason(c) + 40 : Math.max(120, burn * ahead);
  const have = c.st.stock.wood ?? 0;
  const ratio = have / Math.max(1, target);
  const priority = have < 60 ? 5 : ratio < 0.4 ? 5 : ratio < 0.75 ? 4 : 3;
  return { target, priority };
}

export function statusOf(c: Ctx): VillageStatus {
  const d = c.st.dir;
  const alert = d.raid ? (d.raid.warned ? 'raid' : null) : c.people.some((p) => p.ills.some((i) => i.id === 'plague')) ? 'plague' : null;
  return {
    foodDays: Math.round(foodDaysOf(c) * 10) / 10,
    fuelDays: Math.round(Math.min(99, fuelDaysOf(c)) * 10) / 10,
    rationing: c.st.rationing,
    tier: c.st.tier,
    silver: Math.round(c.st.silver * 10) / 10,
    blight: blightReach(c),
    alert,
  };
}
