/**
 * A scripted "reasonable manager" for the soak and the bench: once a game day it looks at the village and places the orders a
 * sensible player would (a house when people have no roof, a field when food runs short, a well, a storehouse, a shrine for
 * those who wish for one) and, later on, takes one old building down. It only uses `sim.command`, like the client does.
 */
import { BLUEPRINTS, GAME_DAY_MS, placementsFor, type BuildKind } from '@hearth/shared';
import type { Sim } from '@hearth/sim';

interface Spot {
  x: number;
  y: number;
  rot: boolean;
}

/** The best place for a kind of building: the same choice a standing rule makes (shared/data/placement.ts). */
export function findSpot(sim: Sim, kind: BuildKind): Spot | null {
  const v = sim.view();
  const best = placementsFor({ world: sim.world, buildings: v.buildings, plots: v.plots }, kind, {}, 1)[0];
  return best ? { x: best.x, y: best.y, rot: best.rot } : null;
}

export interface Manager {
  /** Call once a game day. */
  day(sim: Sim): void;
  /** Orders placed so far, by kind. */
  placed: Record<string, number>;
}

export function createManager(): Manager {
  const placed: Record<string, number> = {};
  let tornDown = 0;
  const order = (sim: Sim, kind: BuildKind): boolean => {
    const spot = findSpot(sim, kind);
    if (!spot) return false;
    const r = sim.command({ t: 'build', kind, x: spot.x, y: spot.y, ...(spot.rot ? { rot: true } : {}) });
    if (r.ok) placed[kind] = (placed[kind] ?? 0) + 1;
    return r.ok;
  };
  return {
    placed,
    day(sim) {
      const v = sim.view();
      // Rations: tighten when the store is thin, ease off when it is comfortable again.
      const level = v.status.rationing;
      if (level === 0 && v.status.foodDays < 7) sim.command({ t: 'ration', level: 1 });
      else if (level === 1 && v.status.foodDays < 3.5) sim.command({ t: 'ration', level: 2 });
      else if (level > 0 && v.status.foodDays > 14) sim.command({ t: 'ration', level: 0 });
      if (v.orders.filter((o) => o.mode !== 'rubble').length >= 3) return;
      const day = Math.floor(sim.inspect().totalMs / GAME_DAY_MS);
      const count = (kind: string): number => v.buildings.filter((b) => b.kind === kind).length;
      const pop = v.population;
      const raising = (kind: BuildKind): boolean => v.orders.some((o) => o.kind === kind && o.mode === 'build');
      if (!raising('house') && (v.wishes.some((w) => w.wish.includes('house')) || count('house') * 4 < pop + 1)) return void order(sim, 'house');
      if (!raising('field') && v.plots.length * 5 < pop) return void order(sim, 'field');
      if (!raising('shrine') && v.wishes.some((w) => w.wish.includes('shrine'))) return void order(sim, 'shrine');
      if (!raising('well') && count('well') < 1 && pop >= 16) return void order(sim, 'well');
      if (!raising('warehouse') && count('warehouse') < 2 && pop >= 22) return void order(sim, 'warehouse');
      if (!raising('workshop') && count('workshop') < 1 && pop >= 18) return void order(sim, 'workshop');
      // Defence grows with the village and with the raids: a post for every ten people (up to three) and a wall for every eight (up to four).
      if (!raising('watchpost') && count('watchpost') < Math.min(3, Math.max(1, Math.floor(pop / 10))) && day >= 45) return void order(sim, 'watchpost');
      if (!raising('wall') && count('wall') < Math.min(4, Math.max(2, Math.floor(pop / 8))) && day >= 120) return void order(sim, 'wall');
      // Once, late on, an old wall segment comes down again (to try demolition and the rubble).
      const old = v.buildings.find((b) => b.kind === 'wall' && !b.con);
      if (old && day >= 300 && !v.orders.length && tornDown < 1 && sim.command({ t: 'demolish', building: old.id }).ok) tornDown++;
    },
  };
}

export { BLUEPRINTS };
