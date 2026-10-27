import { describe, expect, it } from 'vitest';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, GAME_DAY_MS, GAME_HOUR_MS, START_HOUR } from '@hearth/shared';
import { clockOf, dayOf } from './calendar';

describe('calendar', () => {
  it('starts at dawn of the first day of spring', () => {
    const c = clockOf(0);
    expect(c).toMatchObject({ hours: START_HOUR, day: 0, dayOfSeason: 1, season: 0, year: 0 });
  });

  it('rolls over to the next day at midnight', () => {
    const midnight = (24 - START_HOUR) * GAME_HOUR_MS;
    expect(dayOf(midnight - 1)).toBe(0);
    expect(dayOf(midnight)).toBe(1);
    expect(clockOf(midnight).hours).toBe(0);
  });

  it('walks through the four seasons and into the next year', () => {
    const dayStart = (d: number) => d * GAME_DAY_MS - START_HOUR * GAME_HOUR_MS;
    expect(clockOf(dayStart(DAYS_PER_SEASON)).season).toBe(1);
    expect(clockOf(dayStart(DAYS_PER_SEASON * 2)).season).toBe(2);
    expect(clockOf(dayStart(DAYS_PER_SEASON * 3)).season).toBe(3);
    expect(clockOf(dayStart(DAYS_PER_SEASON * 3) - 1).season).toBe(2);
    const y = clockOf(dayStart(DAYS_PER_YEAR));
    expect(y).toMatchObject({ season: 0, year: 1, dayOfSeason: 1 });
  });

  it('never reports 24 hours', () => {
    for (const ms of [GAME_DAY_MS - 1, GAME_DAY_MS * 3 - START_HOUR * GAME_HOUR_MS - 1]) expect(clockOf(ms).hours).toBeLessThan(24);
  });
});
