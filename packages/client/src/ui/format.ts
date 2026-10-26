/** Formatting helpers for numbers and game time. Pure. */
import { SEASONS, type WeatherKind } from '@hearth/shared';
import { t } from '../i18n';

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 1234 -> "1.2k" for tight spaces. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm';
  if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return fmtInt(n);
}

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export function dayPhase(hours: number): DayPhase {
  if (hours >= 5 && hours < 7.5) return 'dawn';
  if (hours >= 7.5 && hours < 17.5) return 'day';
  if (hours >= 17.5 && hours < 20) return 'dusk';
  return 'night';
}

/** Icon names (see icons.ts) for the time of day and the weather. */
export const PHASE_ICON: Record<DayPhase, string> = { dawn: 'dawn', day: 'sun', dusk: 'dusk', night: 'moon' };
export const WEATHER_ICON: Record<WeatherKind, string> = { clear: 'sun', cloudy: 'cloud', rain: 'rain', storm: 'storm', fog: 'fog', snow: 'snow' };

/** "HH:MM" of an hour value in [0, 24). */
export function clockText(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function seasonName(season: number): string {
  return t(`season.${SEASONS[((season % 4) + 4) % 4].toLowerCase()}`);
}

/** Icon and label for the goods in the stockpile summary. Unknown goods fall back to a plain bag. */
export const STOCK_ICON: Record<string, string> = { grain: 'grain', firewood: 'logs', timber: 'board', stone: 'ore', cloth: 'cloth' };
