/**
 * Village-sized world generator (96 x 96 tiles), adapted from the old game's generator: the same height and moisture
 * noise, stream carving and object scatter, but one map instead of a continent, no settlement network and no roads between
 * towns. The starting village is hand-placed (see `placeVillage`: five houses, a storehouse, a shrine, two fields and a well) so every seed begins with the same recognisable layout;
 * the seed changes the land around it: where the forest is thick, how the stream bends, where the stone lies and how far the Blight has crept in.
 */
import { Rng } from './rng';
import { fbm, smoothstep } from './noise';
import { VILLAGE_H, VILLAGE_W } from './constants';
import { O, T, objectBlocks, type BuildingDef, type BuildingKind, type PlotDef, type StartVillage, type WorldData } from './terrain';
import { reachableFrom } from './worldgrid';

interface Ctx {
  w: number;
  h: number;
  seed: number;
  rng: Rng;
  terrain: Uint8Array;
  objects: Uint8Array;
  blight: Uint8Array;
  /** Stream centre column for every row. */
  streamX: Float32Array;
}

const ix = (c: { w: number }, x: number, y: number) => y * c.w + x;
const inB = (c: { w: number; h: number }, x: number, y: number) => x >= 0 && y >= 0 && x < c.w && y < c.h;
const isWaterT = (t: number) => t === T.DeepWater || t === T.Water;

/** Centre of the starting village and the clearing kept around it. */
export const VILLAGE_CENTER = { x: 42, y: 52 };
const CLEAR_RX = 19;
const CLEAR_RY = 15;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function makeTerrain(c: Ctx): void {
  const { w, h, seed } = c;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hh = fbm(x / 26, y / 26, seed, 4);
      const moist = fbm(x / 18 + 100, y / 18 + 100, seed + 77, 4);
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      // A thick treeline towards the map edge, thinner inside.
      const treeBias = smoothstep(26, 2, edge) * 0.22;
      let t: number;
      if (hh > 0.7) t = T.Hill;
      else if (moist + treeBias > 0.56) t = T.Forest;
      else if (moist > 0.42) t = T.Grass;
      else t = T.Plains;
      c.terrain[ix(c, x, y)] = t;
    }
  }
}

function carveStream(c: Ctx): void {
  const { w, h, seed } = c;
  const phase = (seed % 628) / 100;
  for (let y = 0; y < h; y++) {
    const x = 67 + 5 * Math.sin(y / 11 + phase) + (fbm(y / 8, 3.3, seed + 21, 3) - 0.5) * 7;
    c.streamX[y] = x;
    const x0 = Math.round(x);
    for (let dx = 0; dx <= 1; dx++) {
      const xx = x0 + dx;
      if (xx >= 0 && xx < w) {
        c.terrain[ix(c, xx, y)] = T.Water;
        c.objects[ix(c, xx, y)] = O.None;
      }
    }
  }
  // Sandy banks.
  const copy = c.terrain.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w - 1; x++) {
      const t = copy[ix(c, x, y)];
      if (t === T.Water || t === T.Rock) continue;
      if (isWaterT(copy[ix(c, x - 1, y)]) || isWaterT(copy[ix(c, x + 1, y)])) c.terrain[ix(c, x, y)] = T.Sand;
    }
  }
}

function placeOutcrops(c: Ctx): void {
  const { rng } = c;
  const spots = [
    { x: 21, y: 22 },
    { x: 24, y: 76 },
    { x: 81, y: 34 },
    { x: 79, y: 74 },
  ];
  for (const s of spots) {
    const cx = s.x + rng.int(-3, 3);
    const cy = s.y + rng.int(-3, 3);
    const r = rng.int(3, 5);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!inB(c, x, y)) continue;
        const d = Math.hypot(x - cx, y - cy) + (fbm(x / 3, y / 3, c.seed + 5, 2) - 0.5) * 2.2;
        const i = ix(c, x, y);
        if (d > r || isWaterT(c.terrain[i]) || c.terrain[i] === T.Sand) continue;
        c.terrain[i] = d < 1.3 ? T.Rock : T.Hill;
        c.objects[i] = d >= 1.3 && rng.chance(0.35) ? O.Boulder : O.None;
      }
    }
  }
}

function scatterObjects(c: Ctx): void {
  const { w, h, seed, rng } = c;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ix(c, x, y);
      const t = c.terrain[i];
      const r = rng.next();
      if (c.objects[i] !== O.None) continue;
      let o: number = O.None;
      if (t === T.Forest) {
        const dens = fbm(x / 9, y / 9, seed + 5, 3);
        if (r < 0.22 + dens * 0.45) o = rng.chance(0.55) ? O.Oak : O.Pine;
        else if (r < 0.5) o = O.Bush;
      } else if (t === T.Grass) {
        if (r < 0.03) o = O.Oak;
        else if (r < 0.1) o = O.Bush;
        else if (r < 0.15) o = O.Flowers;
      } else if (t === T.Plains) {
        if (r < 0.02) o = O.Boulder;
        else if (r < 0.06) o = O.Bush;
      } else if (t === T.Hill) {
        if (r < 0.09) o = O.Boulder;
        else if (r < 0.14) o = O.Pine;
      } else if (t === T.Sand) {
        if (r < 0.15) o = O.Reeds;
      }
      c.objects[i] = o;
    }
  }
}

/** Blight creeps in from the edges, strongest in the north-west (where it comes from) and ragged where the noise pushes it in. */
function spreadBlight(c: Ctx): void {
  const { w, h, seed } = c;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const front = smoothstep(15, 0, edge);
      if (front <= 0) continue;
      const bias = 0.55 + 0.5 * (1 - (x + y) / (w + h - 2));
      const ragged = 0.35 + fbm(x / 7, y / 7, seed + 303, 3) * 1.1;
      const v = Math.min(1, front * bias * ragged);
      const b = v < 0.14 ? 0 : Math.round(v * 255);
      c.blight[ix(c, x, y)] = b;
      if (b > 150 && c.objects[ix(c, x, y)] !== O.None && !isWaterT(c.terrain[ix(c, x, y)])) {
        const o = c.objects[ix(c, x, y)];
        if (o === O.Oak || o === O.Pine || o === O.Bamboo) c.objects[ix(c, x, y)] = O.DeadTree;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The starting village (hand placed)
// ---------------------------------------------------------------------------

function setTile(c: Ctx, x: number, y: number, t: number): void {
  if (!inB(c, x, y)) return;
  c.terrain[ix(c, x, y)] = t;
  if (objectBlocks(c.objects[ix(c, x, y)]) || c.objects[ix(c, x, y)] !== O.None) c.objects[ix(c, x, y)] = O.None;
}

function house(id: number, kind: BuildingKind, x: number, y: number, w: number, d: number, door: 'S' | 'E'): BuildingDef {
  return { id, kind, x, y, w, d, door: door === 'S' ? { x: x + 1, y: y + d } : { x: x + w, y: y + 1 } };
}

function placeVillage(c: Ctx): StartVillage {
  const { x: cx, y: cy } = VILLAGE_CENTER;

  // Clear a meadow, softer towards its edge.
  for (let y = cy - CLEAR_RY - 2; y <= cy + CLEAR_RY + 2; y++) {
    for (let x = cx - CLEAR_RX - 2; x <= cx + CLEAR_RX + 2; x++) {
      if (!inB(c, x, y)) continue;
      const d = Math.hypot((x - cx) / CLEAR_RX, (y - cy) / CLEAR_RY);
      const i = ix(c, x, y);
      if (isWaterT(c.terrain[i])) continue;
      if (d <= 1) {
        c.terrain[i] = fbm(x / 6, y / 6, c.seed + 9, 2) > 0.5 ? T.Grass : T.Plains;
        c.objects[i] = d > 0.8 && c.rng.chance(0.12) ? O.Bush : O.None;
        c.blight[i] = 0;
      } else if (d <= 1.15 && objectBlocks(c.objects[i]) && c.rng.chance(0.5)) {
        c.objects[i] = O.None;
      }
    }
  }

  // Streets: a north-south road through the plaza, an east-west road (to the bridge) and a southern lane.
  for (let y = cy - 12; y <= cy + 12; y++) setTile(c, cx, y, T.Dirt);
  for (let x = cx - 14; x <= cx + 26; x++) if (!isWaterT(c.terrain[ix(c, x, cy)])) setTile(c, x, cy, T.Dirt);
  for (let x = cx - 8; x <= cx + 10; x++) setTile(c, x, cy + 7, T.Dirt);
  // The plaza and the well.
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) setTile(c, x, y, T.Plaza);
  c.objects[ix(c, cx, cy)] = O.Well;
  c.terrain[ix(c, cx, cy)] = T.Plaza;

  const buildings: BuildingDef[] = [
    // Four houses on the north side of the main street, doors on it.
    house(1, 'house', cx - 12, cy - 3, 3, 3, 'S'),
    house(2, 'house', cx - 8, cy - 3, 3, 3, 'S'),
    house(3, 'house', cx + 4, cy - 3, 3, 3, 'S'),
    house(4, 'house', cx + 8, cy - 3, 3, 3, 'S'),
    // South of the lane: the storehouse and a fifth house.
    house(5, 'warehouse', cx - 7, cy + 4, 4, 3, 'S'),
    house(6, 'house', cx + 3, cy + 4, 3, 3, 'S'),
    // The shrine at the end of the southern lane (M1: people pray, mourn and marry there).
    house(7, 'shrine', cx + 8, cy + 4, 2, 2, 'S'),
  ];
  for (const b of buildings) {
    for (let y = b.y; y < b.y + b.d; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        setTile(c, x, y, T.Grass);
        c.objects[ix(c, x, y)] = O.Building;
      }
    }
    setTile(c, b.door.x, b.door.y, T.Dirt);
  }

  // The field north-west of the plaza, ploughed.
  const plots: PlotDef[] = [
    { id: 1, kind: 'field', x: cx - 11, y: cy - 12, w: 9, d: 6 },
    { id: 2, kind: 'field', x: cx + 4, y: cy - 12, w: 9, d: 6 },
  ];
  for (const p of plots) for (let y = p.y; y < p.y + p.d; y++) for (let x = p.x; x < p.x + p.w; x++) setTile(c, x, y, T.Farm);

  // A bridge where the main street meets the stream.
  const bridgeRows = [cy];
  for (const y of bridgeRows) for (let x = cx; x < c.w; x++) if (c.terrain[ix(c, x, y)] === T.Water) c.terrain[ix(c, x, y)] = T.Bridge;
  // Make sure the street climbs out of the sand on the far bank.
  for (let x = cx + 26; x < c.w - 4; x++) if (c.terrain[ix(c, x, cy)] !== T.Bridge && !isWaterT(c.terrain[ix(c, x, cy)])) setTile(c, x, cy, T.Dirt);

  return { center: { x: cx, y: cy }, buildings, plots, well: { x: cx, y: cy } };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generateWorld(seed: number, w = VILLAGE_W, h = VILLAGE_H): WorldData {
  const c: Ctx = {
    w,
    h,
    seed,
    rng: new Rng(seed ^ 0x5eed),
    terrain: new Uint8Array(w * h),
    objects: new Uint8Array(w * h),
    blight: new Uint8Array(w * h),
    streamX: new Float32Array(h),
  };
  makeTerrain(c);
  carveStream(c);
  placeOutcrops(c);
  scatterObjects(c);
  spreadBlight(c);
  const start = placeVillage(c);
  return { seed, w, h, terrain: c.terrain, objects: c.objects, blight: c.blight, start };
}

/** True when every door of the starting village can be reached from the plaza and the far bank of the stream is reachable too. */
export function villageConnected(world: WorldData): boolean {
  const seen = reachableFrom(world, world.start.center.x + 1, world.start.center.y);
  for (const b of world.start.buildings) if (!seen[b.door.y * world.w + b.door.x]) return false;
  const far = Math.min(world.w - 3, world.start.center.x + 30);
  return seen[world.start.center.y * world.w + far] === 1;
}
