/**
 * A scripted "reasonable manager" for the soak and the bench: once a game day it looks at the village and places the orders a
 * sensible player would (a house when people have no roof, a field when food runs short, a well, a storehouse, a shrine for
 * those who wish for one) and, later on, takes one old building down. It only uses `sim.command`, like the client does.
 */
import { BLUEPRINTS, BUILD_RADIUS, GAME_DAY_MS, canPlace, footprintOf, type BuildKind } from '@hearth/shared';
import type { Sim } from '@hearth/sim';

interface Spot {
  x: number;
  y: number;
}

/** Nearest valid spot to the village green, keeping a tile of room around it (so doors and paths stay clear). */
export function findSpot(sim: Sim, kind: BuildKind, rot = false): Spot | null {
  const v = sim.view();
  const c = sim.world.start.center;
  const { w, d } = footprintOf(kind, rot);
  const pw = { world: sim.world, buildings: v.buildings, plots: v.plots };
  const rects = [...v.buildings, ...v.plots];
  const roomy = (x: number, y: number): boolean => !rects.some((b) => x - 1 < b.x + b.w && x + w + 1 > b.x && y - 1 < b.y + b.d && y + d + 1 > b.y);
  let best: Spot | null = null;
  let bd = Infinity;
  for (let y = c.y - BUILD_RADIUS; y <= c.y + BUILD_RADIUS; y++) {
    for (let x = c.x - BUILD_RADIUS; x <= c.x + BUILD_RADIUS; x++) {
      const dd = Math.abs(x - c.x) + Math.abs(y - c.y);
      if (dd >= bd || dd < 4) continue;
      if (!canPlace(pw, kind, x, y, rot).ok || !roomy(x, y)) continue;
      best = { x, y };
      bd = dd;
    }
  }
  return best;
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
    const r = sim.command({ t: 'build', kind, x: spot.x, y: spot.y });
    if (r.ok) placed[kind] = (placed[kind] ?? 0) + 1;
    return r.ok;
  };
  return {
    placed,
    day(sim) {
      const v = sim.view();
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
      if (!raising('watchpost') && count('watchpost') < 1 && day >= 150) return void order(sim, 'watchpost');
      if (!raising('wall') && count('wall') < 2 && day >= 220) return void order(sim, 'wall');
      // Once, late on, an old wall segment comes down again (to try demolition and the rubble).
      const old = v.buildings.find((b) => b.kind === 'wall' && !b.con);
      if (old && day >= 300 && !v.orders.length && tornDown < 1 && sim.command({ t: 'demolish', building: old.id }).ok) tornDown++;
    },
  };
}

export { BLUEPRINTS };
