/**
 * The living ground (M6): trees that are cut and grow back, bushes that are picked and bear again. The map's own objects are the
 * starting state; what differs from it is a short list the sim keeps and sends (`FloraTile`), so the client can show it.
 */
import { O } from '../terrain';

/** What can be chopped for wood. */
export const TREE_CODES: ReadonlySet<number> = new Set([O.Pine, O.Oak, O.Bamboo]);
/** What a forager may pick from: a bush gives the most, flowers give herbs. */
export const FORAGE_CODES: ReadonlySet<number> = new Set([O.Bush, O.Flowers]);

export const FLORA = {
  /** Chops (acts of chopping) a standing tree takes before it falls. */
  chopsPerTree: 4,
  /** Growing days (spring to autumn; nothing grows in winter) from a stump to a sapling, and from a sapling to a tree again. */
  stumpDays: 12,
  saplingDays: 30,
  /** Growing days before a picked bush bears again, and picked flowers bloom again. */
  bushDays: 10,
  /** How far from a person the nearest tree or bush is looked for. */
  reach: 30,
} as const;

/** One tile whose ground differs from the map's: the terrain now showing there (a worn road, or grass where a road was). */
export interface GroundTile {
  i: number;
  t: number;
}

/** One tile whose object differs from the map's own: the object now showing there (0 for none) and the one it will become again. */
export interface FloraTile {
  i: number;
  code: number;
  was: number;
}
