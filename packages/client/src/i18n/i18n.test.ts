import { describe, expect, it } from 'vitest';
import { addStrings, hasKey, interpolate, t, tn } from './index';

// Every UI source file (not tests, the renderer, art or the dictionaries themselves) as raw text.
const SOURCES = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../render/**', '!../art/**', '!../i18n/en*.ts', '!../net/mock*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('i18n', () => {
  it('interpolates params and leaves unknown placeholders visible', () => {
    expect(interpolate('Hello {name}, {n} left', { name: 'Han', n: 3 })).toBe('Hello Han, 3 left');
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
  });

  it('picks plural forms and falls back to the key for missing strings', () => {
    addStrings({ 'test.item.one': '{n} item', 'test.item.other': '{n} items' });
    expect(tn('test.item', 1)).toBe('1 item');
    expect(tn('test.item', 4)).toBe('4 items');
    expect(t('definitely.not.a.key')).toBe('definitely.not.a.key');
    expect(hasKey('test.item.one')).toBe(true);
  });

  it('lets parts of the UI register their own strings', () => {
    addStrings({ 'mypanel.title': 'My panel' });
    expect(t('mypanel.title')).toBe('My panel');
  });

  it('has an English string for every literal key used in the UI source', () => {
    const KEY = /['"`]((?:val|err|auth|conn|clock|weather|boot|game|common|season|time|village|stock|app|people|sheet|feed|build)\.[A-Za-z0-9.]+)['"`]/g;
    const missing = new Set<string>();
    expect(Object.keys(SOURCES).length).toBeGreaterThan(15);
    for (const [file, text] of Object.entries(SOURCES)) {
      for (const m of text.matchAll(KEY)) if (!hasKey(m[1])) missing.add(`${m[1]}  (${file})`);
    }
    expect([...missing]).toEqual([]);
  });

  it('covers the dynamic key families (enums turned into keys at runtime)', () => {
    const families: Record<string, string[]> = {
      weather: ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'],
      clock: ['dawn', 'day', 'dusk', 'night'],
      season: ['spring', 'summer', 'autumn', 'winter'],
      stock: ['ration', 'wood', 'planks', 'stone', 'cloth', 'thatch'],
      'people.flag': ['ill', 'pregnant', 'stuck'],
      'people.sort': ['mood', 'job', 'age', 'name'],
    };
    const missing: string[] = [];
    for (const [prefix, names] of Object.entries(families)) for (const n of names) if (!hasKey(`${prefix}.${n}`)) missing.push(`${prefix}.${n}`);
    expect(missing).toEqual([]);
  });
});
