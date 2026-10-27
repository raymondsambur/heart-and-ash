/** Helpers for tests: a real small village, a context over it, and people made to order. Not part of the library API. */
import { Rng, type Good } from '@hearth/shared';
import type { Ctx } from './ctx';
import { newPerson, type NewPersonOpts } from './people';
import { createSim, type Sim } from './sim';
import { SiteIndex } from './sites';
import { temperature } from './needs';
import type { Person, SimState } from './types';

export interface Kit {
  sim: Sim;
  st: SimState;
  c: Ctx;
}

/** A village at 09:00 on its first day (the job board is up), with a context over its (mutable) state. */
export function kit(seed = 1, population = 12): Kit {
  const sim = createSim({ seed, population });
  sim.step(3 * 15000);
  const st = sim.inspect() as SimState;
  const world = sim.world;
  const sites = new SiteIndex(world, st.buildings, st.plots);
  const rng = new Rng(seed ^ 0x7e57);
  const byId = (): Map<number, Person> => new Map(st.people.map((p) => [p.id, p]));
  const c: Ctx = {
    st,
    world,
    grid: undefined as never,
    sites,
    rng,
    pending: [],
    now: st.totalMs,
    day: 0,
    hour: 9,
    season: 0,
    temp: temperature(0, 9, 'clear'),
    weather: 'clear',
    person: (id) => byId().get(id),
    get people() {
      return st.people.filter((p) => !p.away);
    },
    dirty() {},
  };
  return { sim, st, c };
}

/** A grown villager at home with everything they need to know, added to the village. */
export function addPerson(k: Kit, o: Partial<NewPersonOpts> = {}): Person {
  const home = k.st.buildings.find((b) => b.kind === 'house')!;
  const known = k.c.sites.sites.map((s) => s.id);
  const p = newPerson({ id: k.st.nextId++, rng: k.c.rng, age: 30, day: k.c.day, home: home.id, x: home.door.x, y: home.door.y, known, ...o });
  k.st.people.push(p);
  return p;
}

export function setStock(k: Kit, stock: Partial<Record<Good, number>>): void {
  for (const g of Object.keys(k.st.stock) as Good[]) k.st.stock[g] = stock[g] ?? 0;
}
