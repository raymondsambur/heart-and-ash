/** Isometric tile footprint in world pixels (2:1 diamond). Art is drawn at half size (32 x 16 art px). */
export const TILE_W = 64;
export const TILE_H = 32;

/** The playable map is one village-sized area. */
export const VILLAGE_W = 96;
export const VILLAGE_H = 96;
/** The size of the map a new village gets (M6): the first 96 x 96 map was too small. A village from before keeps the size it was made with. */
export const MAP_SIZE = 160;

/** Calendar. */
export const HOURS_PER_DAY = 24;
export const DAYS_PER_SEASON = 24;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export type SeasonName = (typeof SEASONS)[number];

/** One game day lasts about 6 real minutes at 1x (to tune). */
export const GAME_DAY_MS = 6 * 60 * 1000;
export const GAME_HOUR_MS = GAME_DAY_MS / HOURS_PER_DAY;
/** The game starts at dawn of day 0. */
export const START_HOUR = 6;

/** The server advances the sim in constant slices of game time; speed only changes how many slices run per real second. */
export const SIM_STEP_MS = 100;
/** Real milliseconds between server ticks. */
export const TICK_MS = 100;
/** Updates to the client per real second. */
export const VIEW_HZ = 5;

/** Time controls: 0 = pause. */
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Game time to walk one tile at terrain speed 1. */
export const STEP_MS = 420;
