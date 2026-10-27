import { describe, expect, it, vi } from 'vitest';
import { Store } from './store';

describe('Store', () => {
  it('starts empty and holds values', () => {
    const s = new Store();
    expect(s.get('time')).toBeNull();
    expect(s.get('speed')).toBe(1);
    s.set('speed', 4);
    expect(s.get('speed')).toBe(4);
  });

  it('notifies only subscribers of the changed keys, and only on a real change', () => {
    const s = new Store();
    const speed = vi.fn();
    const pop = vi.fn();
    const all = vi.fn();
    s.subscribe('speed', speed);
    s.subscribe(['population', 'stock'], pop);
    s.subscribe(null, all);
    s.set('speed', 2);
    s.set('speed', 2);
    expect(speed).toHaveBeenCalledTimes(1);
    expect(pop).not.toHaveBeenCalled();
    s.set('population', 12);
    expect(pop).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(2);
  });

  it('patch() runs each subscriber once for several changed keys', () => {
    const s = new Store();
    const fn = vi.fn();
    s.subscribe(['speed', 'population'], fn);
    s.patch({ speed: 0, population: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
    s.patch({ speed: 0, population: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes and resets', () => {
    const s = new Store();
    const fn = vi.fn();
    const off = s.subscribe('speed', fn);
    off();
    s.set('speed', 4);
    expect(fn).not.toHaveBeenCalled();
    const after = vi.fn();
    s.subscribe('speed', after);
    s.reset();
    expect(s.get('speed')).toBe(1);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
