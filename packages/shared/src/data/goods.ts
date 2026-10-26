/** Things that can sit in the village store or be carried. Silver is separate (each person's purse). */
export const GOODS = ['ration', 'meal', 'wood', 'planks', 'stone', 'thatch', 'herb', 'cloth', 'tool', 'ore', 'blade', 'wine', 'medicine'] as const;
export type Good = (typeof GOODS)[number];

export const GOOD_LABEL: Record<Good, string> = {
  ration: 'raw food',
  meal: 'cooked food',
  wood: 'wood',
  planks: 'planks',
  stone: 'stone',
  thatch: 'thatch',
  herb: 'herbs',
  cloth: 'cloth',
  tool: 'tools',
  ore: 'ore',
  blade: 'blades',
  wine: 'wine',
  medicine: 'medicine',
};

/** A ration is one adult's food for one day (docs/notes/balance-v0.md); a meal is a third of one. */
export const MEAL_PORTION = 1 / 3;
/** Food need points one portion of raw food gives, and the extra a cooked one gives. */
export const RAW_MEAL_POINTS = 32;
export const COOKED_MEAL_POINTS = 37;

/** The starting village store (docs/notes/balance-v0.md, plus a few tools, cloth and herbs). */
export const START_STOCK: Partial<Record<Good, number>> = { ration: 130, wood: 70, stone: 50, planks: 20, thatch: 10, herb: 6, cloth: 8, tool: 4 };

/** What the village store is kept above, per good, before people stop working for it (a person-day of food is 1 ration). */
export const STOCK_GOALS: Partial<Record<Good, number>> = { ration: 300, wood: 400, stone: 120, planks: 60, herb: 20, cloth: 20, tool: 8, medicine: 6 };
