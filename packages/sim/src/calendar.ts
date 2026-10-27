/**
 * Calendar math. Time is one number: game milliseconds since the village began (dawn of day 0).
 * 24 hours a day, 24 days a season, 96 days a year (docs/notes/balance-v0.md).
 */
import { DAYS_PER_SEASON, DAYS_PER_YEAR, GAME_DAY_MS, GAME_HOUR_MS, HOURS_PER_DAY, START_HOUR } from '@hearth/shared';

export interface Clock {
  /** Hour of the day, 0 up to 24. */
  hours: number;
  /** Day count since the start (day 0 is the first, which begins at dawn). */
  day: number;
  /** Day inside the season, 1 based. */
  dayOfSeason: number;
  /** 0 Spring .. 3 Winter. */
  season: number;
  year: number;
}

export function clockOf(totalMs: number): Clock {
  const shifted = totalMs + START_HOUR * GAME_HOUR_MS;
  const day = Math.floor(shifted / GAME_DAY_MS);
  const hours = (shifted - day * GAME_DAY_MS) / GAME_HOUR_MS;
  return {
    hours: Math.min(hours, HOURS_PER_DAY - 1e-9),
    day,
    dayOfSeason: (day % DAYS_PER_SEASON) + 1,
    season: Math.floor(day / DAYS_PER_SEASON) % 4,
    year: Math.floor(day / DAYS_PER_YEAR),
  };
}

/** Day number that contains the instant `totalMs` (midnight to midnight). */
export function dayOf(totalMs: number): number {
  return Math.floor((totalMs + START_HOUR * GAME_HOUR_MS) / GAME_DAY_MS);
}
