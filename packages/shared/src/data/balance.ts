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
    wallCap: 6,
    perRaider: 3.4,
    /** At or above this ratio of defence to attack the raiders are driven off; below `overrun` they break in. */
    repel: 1.15,
    overrun: 0.6,
  },
} as const;

/** The size of the standing watch the village keeps when there is a watch post, and while a raid is expected. */
export function watchSlots(posts: number, warned: boolean): number {
  return Math.min(6, (warned ? 2 : 0) + posts * 2);
}
