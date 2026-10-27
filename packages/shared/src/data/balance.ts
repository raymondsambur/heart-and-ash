/**
 * The numbers that decide how hard the village's life is (docs/notes/balance-v0.md and docs/notes/m3.md). One file, so the soak
 * script can sweep them. Units are in the comments; days are game days (24 a season, 96 a year).
 */
export const BAL = {
  /** Share of stored goods lost to spoilage per day. */
  spoil: {
    ration: 0.004,
    meal: 0.008,
    herb: 0.01,
    /** Cold weather keeps food: multiplier in winter, and with a storehouse built (the cold store). */
    winter: 0.5,
    storehouse: 0.6,
    /** Each tile the Blight has crept past the shrines' ward adds this much to the rate (a fraction of the base). */
    perBlight: 0.12,
  },

  /** Heating: wood the village burns per occupied house per day, by season (spring, summer, autumn, winter). */
  heat: {
    woodPerHouse: [2, 0, 2, 6],
    /** The hearths are lit at this hour and burn for the night. */
    lightHour: 17,
    burnHours: 14,
  },

  /** Rationing levels: the share of a normal portion a person is given, and the share of the meal's points that gives them. */
  ration: {
    portion: [1, 0.8, 0.6],
    points: [1, 0.9, 0.78],
    mood: [0, -3, -8],
  },

  /** The winter plan the standing jobs work towards: wood for the whole winter by its first day, food too. */
  winter: {
    woodDaysAhead: [8, 14, 26, 0],
    /** Autumn food aim in days of food per person; below it the foragers, hunters and fishers get busier. */
    foodDays: 22,
    /** What hunting and fishing give in winter, against the rest of the year (game is scarce, the stream is half frozen). */
    huntFactor: 0.3,
    fishFactor: 0.45,
    /** How much of the cold gets into a house with no fire lit (the rest is kept out by the walls). */
    indoorCold: 0.5,
  },

  /** The events director (docs/notes/balance-v0.md, section 7). */
  director: {
    /** A bad harvest: one ripening in this many is spoiled, from this day on, and keeps this share of the yield. */
    badHarvest: { chance: 0.2, from: 48, keeps: 0.7 },
    /** Plague: chance per day from this day on, how long to leave between plagues, how many fall sick (share of the village), and health lost an hour (the body mends 0.6 an hour on its own, so the plague wins by the difference). */
    plague: { chance: 1 / 560, from: 96, gap: 160, share: [0.2, 0.45], min: 3, max: 6, hpPerHour: 1.2, spread: 0.05 },
    /** Refugees: chance per day, gap in days, how many come. */
    refugees: { chance: 1 / 120, from: 20, gap: 90, count: [2, 5] },
    /** A travelling master teaches for some days. */
    master: { chance: 1 / 130, from: 30, gap: 60, stay: 12, students: 3, xpPerDay: 14 },
    /** The Blight's edge: tiles per this many days, from the start. */
    blight: { everyDays: 30 },
    /** Raids: first day they may come, the gap between them in days (plus or minus the spread), and the raiders. */
    raid: { first: 40, gap: 26, spread: 7, size: [3, 5], perYear: 1, warnDays: 1 },
  },

  /** What stands against a raid: points per defender and per building, and what one raider counts for. */
  defence: {
    base: 0.3,
    perFighting: 0.25,
    onWatch: 1.7,
    watchpost: 4,
    wall: 1.5,
    wallCap: 9,
    /** A wall round the whole village, closed, with its gate standing: an extra stand against a raid. */
    loop: 10,
    perRaider: 3.4,
    /** At or above this ratio of defence to attack the raiders are driven off; below `overrun` they break in. */
    repel: 1.15,
    overrun: 0.6,
  },

  /** The Outside: the town beyond the map (docs/notes/m5.md). Prices are in silver per unit. */
  outside: {
    price: { ration: 1.2, wood: 0.5, planks: 1.4, stone: 0.9, cloth: 3, tool: 6 },
    /** A caravan buys at this share of the price and sells at this multiple of it. */
    buyShare: 0.7,
    sellMark: 1.3,
    /** Caravans: the first, then the gap in days (plus or minus the spread; a trade pact shortens it). */
    caravan: { first: 25, gap: 28, spread: 8, pactFactor: 0.7 },
    /** Envoys: not before this day, at least this many days apart, then a chance a day. */
    envoy: { from: 60, gap: 70, chance: 1 / 30 },
    /** Rumours from beyond the map: a chance a day, and how long a price shock lasts. */
    news: { chance: 1 / 14, shock: 30 },
    startSilver: 20,
    /** Regard (how the Outside thinks of the village) fades towards nothing by this much a day. */
    regardFade: 0.05,
    /** Newcomers still to come each year are topped up by this many, to at most the cap. */
    poolPerYear: 2,
    poolCap: 8,
  },

  /** Roads worn by feet (M6): traffic fades by `decay` a day; a tile with at least `on` becomes a road, and a road under `off` for `quietDays` days is given back to the grass. */
  roads: { on: 55, off: 18, decay: 0.96, quietDays: 10 },

  /** Settlement tiers: what a hamlet must have to be a village, and a village to be a town; and what each tier allows. */
  tiers: {
    village: { people: 16, houses: 5 },
    town: { people: 36, houses: 10, watchposts: 1 },
    /** The suggested rules need all twelve from the start, so the rule cap does not depend on the tier (the field is kept to tune). */
    maxRules: [16, 16, 16],
    maxOrders: [8, 14, 24],
  },
} as const;

/** The size of the standing watch the village keeps when there is a watch post, and while a raid is expected. */
export function watchSlots(posts: number, warned: boolean): number {
  return Math.min(6, (warned ? 2 : 0) + posts * 2);
}
