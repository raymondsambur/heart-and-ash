/**
 * Buildings under construction and demolition. The sim reports a `ConView` (stage done, % of the stage, material on the plot);
 * `progressOf` turns it into what stands (`ConProgress`) and `staged` draws exactly that into the building's Scene3D:
 * stakes and cord, cleared ground, a footing that rises, a timber frame, walls from the footing up, a roof laid row by row,
 * bamboo scaffolding while the walls and roof go up, and piles of the material that has been brought. Demolition is the same
 * sequence run backwards, ending in a heap of rubble. Pure (node-testable).
 */
import { BLUEPRINTS, isBuildKind, type ConView } from '@hearth/shared';
import { addLight, doorPlacement, windowsFor, type ConProgress, type Ctx } from './bctx';
import { hex, mix, scale, type Col } from './color';
import { hf } from './draw';
import { GLOW_WARM, LACQUER, LACQUER_D, crenellate, door, flatShader, lc, pillar, plinth, roof, stoneTop, walls, wallShader, type RoofOpts, type WallKind } from './arch';
import type { Shader } from './mesh';
import * as P from './props';

// ---------------------------------------------------------------------------
// ConView -> what stands
// ---------------------------------------------------------------------------

/** Sub-steps drawn per stage (the sim reports progress in 5% steps; the sprites change every quarter). */
export const SUB_STEPS = 4;

const quarter = (pct: number): number => Math.min(1, Math.floor(pct / (100 / SUB_STEPS)) / SUB_STEPS);

const level = (n: number | undefined, hi: number): number => (!n || n <= 0 ? 0 : n <= hi / 3 ? 1 : n <= (2 * hi) / 3 ? 2 : 3);

/** Everything that stands for a given state of the order. `kind` is the blueprint kind ('house', 'field', ...). */
export function progressOf(kind: string, con: ConView): ConProgress {
  const bp = isBuildKind(kind) ? BLUEPRINTS[kind] : null;
  const ids = bp ? bp.stages.map((s) => s.id) : [];
  const n = ids.length;
  const present = (i: number): number => {
    if (i < 0) return 0;
    if (con.mode === 'rubble') return 0;
    if (con.mode === 'build') return i < con.done ? 1 : i === con.done ? quarter(con.pct) : 0;
    return i < con.done - 1 ? 1 : i === con.done - 1 ? 1 - quarter(con.pct) : 0;
  };
  const part = (id: string): number => present(ids.indexOf(id as never));
  const pile = con.pile ?? {};
  const demolish = con.mode !== 'build';
  const rubble = con.mode === 'rubble' ? 1 - quarter(con.pct) : con.mode === 'demolish' ? Math.min(0.6, (0.6 * (n - con.done)) / Math.max(1, n)) : 0;
  const ground = con.mode === 'rubble' ? 1 : part('cleared');
  const foundation = part('foundation');
  return {
    foundation,
    frame: part('frame'),
    walls: part('walls'),
    roof: part('roof'),
    pile: { planks: level(pile.planks, 12), stone: level(pile.stone, 12), thatch: level(pile.thatch, 6) },
    ground,
    staked: foundation === 0,
    demolish,
    rubble,
  };
}

/** Cache key of a state: two `ConView`s with the same key draw the same sprite. */
export function conKey(con: ConView | undefined): string {
  if (!con) return '-';
  const p = con.pile ?? {};
  return `${con.mode[0]}${con.done}.${Math.min(SUB_STEPS - 1, Math.floor(con.pct / (100 / SUB_STEPS)))}.${level(p.planks, 12)}${level(p.stone, 12)}${level(p.thatch, 6)}`;
}

/** Everything standing, nothing else (the look of a finished wall or well drawn through the same code). */
export const FULL: ConProgress = { foundation: 1, frame: 1, walls: 1, roof: 1, pile: { planks: 0, stone: 0, thatch: 0 }, ground: 1, staked: false, demolish: false, rubble: 0 };

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

const NEW_WOOD = hex('#b88c54');
const NEW_WOOD_D = hex('#8f6a3c');
const BAMBOO = hex('#c7b25e');
const BAMBOO_D = hex('#8f7f3a');
const DIRT = hex('#8a6c4a');
const CORD = hex('#e3d6b0');

interface Look {
  inset: number;
  ph: number;
  H: number;
  kind: WallKind;
  base?: Col;
  post: number;
  timber?: Col;
  doorH: number;
  doorW: number;
  doorColor?: Col;
  windows: boolean;
  windowH?: number;
  roof: Partial<RoofOpts> & { rise: number };
  roofColor?: Col;
  stoneBase?: boolean;
}

const LOOK: Record<string, Look> = {
  house: { inset: 0.42, ph: 3, H: 30, kind: 'plaster', post: 11, doorH: 20, doorW: 0.8, windows: true, roof: { rise: 12, over: 0.4, up: 4 } },
  warehouse: { inset: 0.4, ph: 3, H: 22, kind: 'plank', base: hex('#85684a'), post: 0, timber: hex('#3e2a1e'), doorH: 20, doorW: 1.0, doorColor: hex('#5e4430'), windows: true, windowH: 4, roof: { rise: 16, over: 0.36, up: 2, gable: 'u', curve: 1 } },
  workshop: { inset: 0.4, ph: 5, H: 24, kind: 'dark', base: hex('#5a4a40'), post: 0, doorH: 20, doorW: 0.9, windows: false, stoneBase: true, roof: { rise: 15, over: 0.36, up: 5 } },
  shrine: { inset: 0.32, ph: 3, H: 13, kind: 'plaster', base: mix(LACQUER, hex('#e6dcc6'), 0.85), post: 8, timber: LACQUER_D, doorH: 12, doorW: 0.6, doorColor: hex('#7a3a2a'), windows: false, roof: { rise: 9, over: 0.24, up: 4 }, roofColor: hex('#3c3a44') },
  watchpost: { inset: 0.28, ph: 5, H: 41, kind: 'stone', post: 0, doorH: 20, doorW: 0.7, doorColor: hex('#4a3a30'), windows: false, stoneBase: true, roof: { rise: 11, over: 0.4, up: 5 } },
};

/** Soil trodden bare: a flat patch over the footprint (or scattered patches while it is being cleared). */
function dirt(c: Ctx, u0: number, v0: number, u1: number, v1: number, g: number): void {
  const { sc } = c;
  const sh: Shader = (_s, _t, lit, x, y) => lc(hf(x, y, 3) < 0.12 ? scale(DIRT, 0.85) : hf(x, y, 4) < 0.1 ? scale(DIRT, 1.1) : DIRT, lit);
  if (g >= 1) {
    sc.top(u0 - 0.15, v0 - 0.15, u1 + 0.15, v1 + 0.15, 0.25, 1, sh);
    return;
  }
  const n = Math.ceil(g * 9);
  for (let i = 0; i < n; i++) {
    const u = u0 + (u1 - u0) * c.rnd(20 + i);
    const v = v0 + (v1 - v0) * c.rnd(40 + i);
    sc.blob(u, v, 0.2, 5 + c.rnd(60 + i) * 6, 2.6 + c.rnd(80 + i) * 2.4, (nx, ny, x, y) => (hf(x, y, 6) < 0.15 ? scale(DIRT, 0.82) : scale(DIRT, 1 - ny * 0.12 - nx * 0.05)));
  }
}

/** Four stakes at the corners and a cord drawn tight between them. */
function stakes(c: Ctx, u0: number, v0: number, u1: number, v1: number): void {
  const { sc, st } = c;
  const o = 0.14;
  const pts: [number, number][] = [
    [u0 - o, v0 - o],
    [u1 + o, v0 - o],
    [u1 + o, v1 + o],
    [u0 - o, v1 + o],
  ];
  const seg = (a: [number, number], b: [number, number]): void => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 18);
    for (let i = 0; i <= n; i++) sc.plot(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 6, i % 5 === 4 ? scale(CORD, 0.8) : CORD);
  };
  for (let i = 0; i < 4; i++) seg(pts[i], pts[(i + 1) % 4]);
  for (const [u, v] of pts) pillar(sc, st, u, v, 0, 8, NEW_WOOD, 0.045);
}

function timberBox(c: Ctx, ua: number, va: number, ub: number, vb: number, z0: number, z1: number, col: Col = NEW_WOOD): void {
  c.sc.box(ua, va, z0, ub, vb, z1, flatShader(scale(col, 1.08), c.st, 0.05), flatShader(col, c.st, 0.06), flatShader(scale(col, 0.82), c.st, 0.06));
}

/** The posts and beams of a frame, `f` of the way up. */
function frame(c: Ctx, u0: number, v0: number, u1: number, v1: number, ph: number, H: number, f: number): void {
  const { sc, st } = c;
  const hh = H * f;
  const z1 = ph + hh;
  const nu = Math.max(1, Math.round((u1 - u0) / 1.25));
  const nv = Math.max(1, Math.round((v1 - v0) / 1.25));
  const post = (u: number, v: number): void => pillar(sc, st, u, v, ph, z1, NEW_WOOD, 0.07);
  // back edges first, then the front ones, so the front posts read in front
  for (let i = 0; i <= nu; i++) post(u0 + ((u1 - u0) * i) / nu, v0);
  for (let i = 1; i <= nv; i++) post(u0, v0 + ((v1 - v0) * i) / nv);
  const beam = (z: number): void => {
    timberBox(c, u0, v0 - 0.05, u1, v0 + 0.05, z, z + 2.4);
    timberBox(c, u0 - 0.05, v0, u0 + 0.05, v1, z, z + 2.4);
    timberBox(c, u0, v1 - 0.05, u1, v1 + 0.05, z, z + 2.4);
    timberBox(c, u1 - 0.05, v0, u1 + 0.05, v1, z, z + 2.4);
  };
  for (let i = 1; i <= nu; i++) post(u0 + ((u1 - u0) * i) / nu, v1);
  for (let i = 1; i < nv; i++) post(u1, v0 + ((v1 - v0) * i) / nv);
  post(u1, v1);
  if (hh > H * 0.45) beam(ph + H * 0.5);
  if (f >= 0.7) beam(z1 - 2.4);
}

/** Bamboo scaffolding along the two visible faces, reaching a little above `top`. */
function scaffold(c: Ctx, u0: number, v0: number, u1: number, v1: number, top: number): void {
  const { sc } = c;
  const off = 0.3;
  const r = 0.035;
  const pole = (u: number, v: number, z1: number): void => {
    const sh = (k: number): Shader => (_s, _t, lit, x, y) => lc(scale(hf(x, y, 7) < 0.1 ? BAMBOO_D : BAMBOO, k), lit);
    sc.box(u - r, v - r, 0, u + r, v + r, z1, flatShader(BAMBOO, c.st, 0), sh(1), sh(0.82));
  };
  const nu = Math.max(2, Math.round((u1 - u0) / 1.3));
  const nv = Math.max(2, Math.round((v1 - v0) / 1.3));
  const zt = top + 9;
  for (let i = 0; i <= nu; i++) pole(u0 + ((u1 - u0) * i) / nu, v1 + off, zt);
  for (let i = 0; i < nv; i++) pole(u1 + off, v0 + ((v1 - v0) * i) / nv, zt);
  for (let z = 11; z < zt; z += 14) {
    sc.box(u0, v1 + off - 0.03, z, u1 + off, v1 + off + 0.03, z + 1.4, flatShader(BAMBOO, c.st, 0), flatShader(BAMBOO, c.st, 0), flatShader(BAMBOO_D, c.st, 0));
    sc.box(u1 + off - 0.03, v0, z, u1 + off + 0.03, v1 + off, z + 1.4, flatShader(BAMBOO, c.st, 0), flatShader(BAMBOO_D, c.st, 0), flatShader(BAMBOO_D, c.st, 0));
  }
  // the working deck, just under the top
  const zd = Math.max(11, Math.floor((zt - 12) / 14) * 14 + 11);
  timberBox(c, u0 - 0.1, v1 + 0.1, u1 + off, v1 + off + 0.1, zd, zd + 1.4, NEW_WOOD_D);
  timberBox(c, u1 + 0.1, v0 - 0.1, u1 + off + 0.1, v1 + off, zd, zd + 1.4, NEW_WOOD_D);
}

/** A stack of planks: layers alternate direction. */
function plankPile(c: Ctx, u: number, v: number, lv: number): void {
  const layers = lv * 2;
  for (let i = 0; i < layers; i++) {
    const z = i * 1.9;
    if (i % 2 === 0) timberBox(c, u, v, u + 0.6, v + 0.34, z, z + 1.9, i % 4 === 0 ? NEW_WOOD : mix(NEW_WOOD, NEW_WOOD_D, 0.4));
    else timberBox(c, u + 0.05, v - 0.05, u + 0.4, v + 0.4, z, z + 1.9, NEW_WOOD_D);
  }
}

/** Hewn stone blocks and rubble. */
function stonePile(c: Ctx, u: number, v: number, lv: number): void {
  const { st, sc } = c;
  const n = lv * 2 + 1;
  for (let i = 0; i < n; i++) {
    const du = (c.rnd(100 + i) - 0.5) * 0.5;
    const dv = (c.rnd(120 + i) - 0.5) * 0.5;
    const z = i >= 3 ? 3.5 : 0;
    const sh: Shader = (_s, _t, lit, x, y) => lc(scale(st.stone, hf(x, y, 5) < 0.2 ? 0.8 : 1), lit);
    sc.box(u + 0.2 + du - 0.12, v + 0.2 + dv - 0.12, z, u + 0.2 + du + 0.12, v + 0.2 + dv + 0.12, z + 3.5, sh, sh, (s, t, lit, x, y) => scale(sh(s, t, lit, x, y), 0.85));
  }
}

function thatchPile(c: Ctx, u: number, v: number, lv: number): void {
  const h = P.haystack();
  for (let i = 0; i < lv; i++) c.sc.sprite(h.pb, h.ax, h.ay, u + 0.25 + i * 0.12, v + 0.2 + (i % 2) * 0.25, i >= 2 ? 3 : 0, 4);
}

function piles(c: Ctx, pr: ConProgress, d: number): void {
  const { planks, stone, thatch } = pr.pile;
  const step = Math.max(0.5, (d - 0.9) / 2);
  const at = (i: number): [number, number] => [-0.7, 0.3 + i * step];
  if (stone) stonePile(c, ...at(1), stone);
  if (planks) plankPile(c, ...at(0), planks);
  if (thatch) thatchPile(c, ...at(2), thatch);
}

/** A heap of broken stone and splintered planks over the footprint. */
function rubbleHeap(c: Ctx, u0: number, v0: number, u1: number, v1: number, amount: number): void {
  const { sc, st } = c;
  const n = Math.ceil(amount * 16);
  for (let i = 0; i < n; i++) {
    const u = u0 + (u1 - u0) * (0.12 + 0.76 * c.rnd(200 + i));
    const v = v0 + (v1 - v0) * (0.12 + 0.76 * c.rnd(220 + i));
    if (i % 3 === 0) {
      const a = 0.18 + c.rnd(240 + i) * 0.3;
      const col = mix(NEW_WOOD_D, hex('#4a3a28'), 0.5);
      sc.box(u, v, 0.5, u + a, v + 0.09, 1.6, flatShader(col, st, 0.1), flatShader(col, st, 0.1), flatShader(scale(col, 0.8), st, 0.1));
    } else {
      const rx = 2.5 + c.rnd(260 + i) * 3.5 * Math.max(0.5, amount);
      sc.blob(u, v, 0.8 + c.rnd(280 + i) * 1.5, rx, rx * 0.62, (nx, ny, x, y) => scale(st.stone, (hf(x, y, 9) < 0.18 ? 0.78 : 0.95) - ny * 0.14 - nx * 0.05));
    }
  }
}

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/** A timber-framed building (house, storehouse, workshop, shrine, watch post) with what has been built so far. */
function stagedBasic(c: Ctx, pr: ConProgress, look: Look): void {
  const { sc, st, w, d } = c;
  const u0 = look.inset;
  const u1 = w - look.inset;
  const v0 = look.inset;
  const v1 = d - look.inset;
  const { ph, H } = look;
  const stt = look.timber ? { ...st, timber: look.timber } : st;
  c.metrics.eave = (ph + H) * sc.zk;
  c.metrics.door = look.doorH * sc.zk;
  if (pr.ground > 0 && pr.foundation < 1) dirt(c, u0, v0, u1, v1, pr.ground);
  if (pr.foundation > 0) {
    const z = Math.max(1.2, ph * pr.foundation);
    plinth(sc, st, u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, z, look.stoneBase ? scale(st.stone, 0.92) : st.stone);
  }
  if (pr.frame > 0 && pr.walls < 1) frame(c, u0, v0, u1, v1, ph, H, pr.frame);
  if (pr.walls > 0) {
    const z1 = ph + H * pr.walls;
    walls(sc, stt, u0, v0, u1, v1, ph, z1, { kind: look.kind, base: look.base ?? st.wall, post: look.post, ruin: 0, eave: pr.walls >= 1 ? 5 : 0 });
    if (z1 - ph >= look.doorH + 1) {
      const dp = doorPlacement(c.spec);
      door(sc, stt, dp.face, dp.face === 'left' ? v1 : u1, dp.center, look.doorW, ph, look.doorH, look.doorColor);
    }
    if (pr.walls >= 1 && look.windows && pr.roof >= 1) windowsFor(c, u0, u1, v0, v1, ph + (H > 20 ? 9 : 7), look.windowH ?? 7, GLOW_WARM);
  }
  if (pr.roof > 0 && pr.walls >= 1) {
    roof(sc, st, u0, v0, u1, v1, { zEave: ph + H, over: 0.38, up: 5, color: look.roofColor ?? c.roofColor, cover: pr.roof, ...look.roof });
    if (pr.roof >= 1) {
      const dp = doorPlacement(c.spec);
      addLight(c, dp.face === 'left' ? dp.center : u1 + 0.1, dp.face === 'left' ? v1 + 0.1 : dp.center, ph + 9, 28, GLOW_WARM);
    }
  }
  const top = pr.roof > 0 ? ph + H + look.roof.rise * 0.4 : pr.walls > 0 ? ph + H * pr.walls : pr.frame > 0 ? ph + H * pr.frame : 0;
  if ((pr.walls > 0 && pr.roof < 1) || (pr.roof > 0 && pr.roof < 1)) scaffold(c, u0, v0, u1, v1, top);
  if (pr.staked && pr.foundation === 0) stakes(c, u0, v0, u1, v1);
}

/** A well: a stone ring, then posts and a small roof over it. */
function wellStaged(c: Ctx, pr: ConProgress): void {
  const { sc, st } = c;
  const u0 = 0.12;
  const u1 = 0.88;
  if (pr.ground > 0 && pr.foundation < 1) dirt(c, u0, u0, u1, u1, pr.ground);
  const hRing = pr.walls > 0 ? 5 + 6 * pr.walls : pr.foundation > 0 ? Math.max(1.2, 5 * pr.foundation) : 0;
  if (hRing > 0) {
    const side = (off: number): Shader => wallShader(st, { kind: 'stone', base: scale(st.stone, 0.95), H: hRing, eave: 0, off });
    const strip = (a: number, b: number, e: number, f: number): void => sc.box(a, b, 0, e, f, hRing, stoneTop(st, st.stone), side(0), side(5));
    strip(u0, u0, u1, 0.3);
    strip(u0, 0.7, u1, u1);
    strip(u0, 0.3, 0.3, 0.7);
    strip(0.7, 0.3, u1, 0.7);
    sc.top(0.3, 0.3, 0.7, 0.7, Math.min(3, hRing - 1), 1, (_s, _t, lit) => lc(hex('#1d3a52'), lit));
  }
  if (pr.roof > 0) {
    const zp = 11 + 22 * Math.min(1, pr.roof * 2);
    pillar(sc, st, 0.18, 0.5, 11, zp, NEW_WOOD, 0.06);
    pillar(sc, st, 0.82, 0.5, 11, zp, NEW_WOOD, 0.06);
    if (pr.roof >= 0.5) {
      timberBox(c, 0.14, 0.46, 0.86, 0.54, zp - 2.4, zp);
      roof(sc, st, 0.08, 0.1, 0.92, 0.9, { zEave: zp, rise: 6, over: 0.1, up: 2, color: hex('#6b4a3a'), gable: 'v', cover: (pr.roof - 0.5) * 2, rows: 4 });
    }
  }
  if (pr.staked && pr.foundation === 0) stakes(c, u0, u0, u1, u1);
  c.metrics.eave = 33 * sc.zk;
}

/**
 * The gate in the village wall: two stone towers at the ends of the four tiles and a timber lintel with a small roof across the top, with the
 * middle left open to walk through. Built like a wall: footing, towers, then the lintel and roof (and battlements on the towers when done).
 */
export function gateStaged(c: Ctx, pr: ConProgress): void {
  const { sc, st, w, d } = c;
  const alongU = w >= d;
  const len = alongU ? w : d;
  const thick = alongU ? d : w;
  const tower = 1.05;
  const e = 0.08;
  // a box between two stations along the gate (a0..a1) and across it, whichever way the gate lies
  const span = (a0: number, a1: number, z0: number, z1: number, top: Shader, s1: Shader, s2: Shader): void => {
    if (alongU) sc.box(a0, e, z0, a1, thick - e, z1, top, s1, s2);
    else sc.box(e, a0, z0, thick - e, a1, z1, top, s1, s2);
  };
  const timber = (a0: number, a1: number, z0: number, z1: number): void => {
    if (alongU) timberBox(c, a0, e, a1, thick - e, z0, z1);
    else timberBox(c, e, a0, thick - e, a1, z0, z1);
  };
  if (pr.ground > 0 && pr.foundation < 1) {
    if (alongU) dirt(c, 0, 0, w, d, pr.ground);
    else dirt(c, 0, 0, w, d, pr.ground);
  }
  const base = pr.foundation > 0 ? Math.max(1.2, 4 * pr.foundation) : 0;
  const top = 4 + 26 * pr.walls;
  const ends: [number, number][] = [[e, tower], [len - tower, len - e]];
  if (base > 0 && pr.walls <= 0) {
    const side = (off: number): Shader => wallShader(st, { kind: 'stone', base: scale(st.stone, 0.9), H: base, eave: 0, off });
    for (const [a0, a1] of ends) span(a0, a1, 0, base, stoneTop(st, st.stone), side(0), side(5));
  }
  if (pr.walls > 0) {
    const side = (off: number): Shader => wallShader(st, { kind: 'stone', base: scale(st.stone, 0.98), H: top, eave: 0, off });
    for (const [a0, a1] of ends) span(a0, a1, 0, top, stoneTop(st, scale(st.stone, 1.05)), side(0), side(6));
  }
  // the lintel laid across the opening, then a small roof over it
  if (pr.walls >= 1 && pr.roof > 0) {
    const reach = (len - 2 * tower) * Math.min(1, pr.roof * 2);
    timber(tower, tower + reach, top - 5, top - 2.5);
    if (pr.roof > 0.5) {
      const r = Math.min(1, (pr.roof - 0.5) * 2);
      timber(e, len - e, top - 2.5, top - 2.5 + 3.5 * r);
    }
  }
  if (pr.walls >= 1 && pr.roof >= 1) {
    if (alongU) {
      crenellate(sc, st, ends[0][0], e, ends[0][1], thick - e, top, 3);
      crenellate(sc, st, ends[1][0], e, ends[1][1], thick - e, top, 3);
    } else {
      crenellate(sc, st, e, ends[0][0], thick - e, ends[0][1], top, 3);
      crenellate(sc, st, e, ends[1][0], thick - e, ends[1][1], top, 3);
    }
  }
  if (pr.walls > 0 && pr.walls < 1) scaffold(c, alongU ? e : e, alongU ? e : e, alongU ? tower : thick - e, alongU ? thick - e : tower, top);
  if (pr.staked && pr.foundation === 0) stakes(c, e, e, w - e, d - e);
  c.metrics.eave = 30 * sc.zk;
}

/** A stretch of stone wall along u (4×1) or v (1×4): footing, wall, then boards laid along the top and, when finished, battlements. */
export function wallStaged(c: Ctx, pr: ConProgress): void {
  const { sc, st, w, d } = c;
  const u0 = 0.08;
  const v0 = 0.08;
  const u1 = w - 0.08;
  const v1 = d - 0.08;
  if (pr.ground > 0 && pr.foundation < 1) dirt(c, 0, 0, w, d, pr.ground);
  const base = pr.foundation > 0 ? Math.max(1.2, 4 * pr.foundation) : 0;
  const top = 4 + 20 * pr.walls;
  if (base > 0 && pr.walls <= 0) {
    const side = (off: number): Shader => wallShader(st, { kind: 'stone', base: scale(st.stone, 0.9), H: base, eave: 0, off });
    sc.box(u0, v0, 0, u1, v1, base, stoneTop(st, st.stone), side(0), side(5));
  }
  if (pr.walls > 0) {
    const side = (off: number): Shader => wallShader(st, { kind: 'stone', base: scale(st.stone, 0.98), H: top, eave: 0, off });
    sc.box(u0, v0, 0, u1, v1, top, stoneTop(st, scale(st.stone, 1.05)), side(0), side(6));
  }
  if (pr.walls > 0 && pr.roof > 0 && pr.roof < 1) {
    // boards laid along the top, from the near end
    const alongU = w >= d;
    const len = (alongU ? u1 - u0 : v1 - v0) * pr.roof;
    if (alongU) timberBox(c, u0, v0, u0 + len, v1, top, top + 1.4);
    else timberBox(c, u0, v0, u1, v0 + len, top, top + 1.4);
  }
  if (pr.walls >= 1 && pr.roof >= 1) crenellate(sc, st, u0, v0, u1, v1, top, 5);
  if (pr.walls > 0 && pr.walls < 1) {
    // a short length of scaffold at the working end
    scaffold(c, Math.max(u0, u1 - 1.4), v0, u1, v1, top);
  }
  if (pr.staked && pr.foundation === 0) stakes(c, u0, v0, u1, v1);
  c.metrics.eave = 24 * sc.zk;
}

/** Draw what stands of a building under construction or demolition into `c`'s scene. */
export function staged(c: Ctx, pr: ConProgress): void {
  c.con = pr;
  const kind = c.spec.kind;
  if (kind === 'well') wellStaged(c, pr);
  else if (kind === 'wall') wallStaged(c, pr);
  else if (kind === 'gateway') gateStaged(c, pr);
  else stagedBasic(c, pr, LOOK[kind] ?? LOOK.house);
  if (pr.rubble > 0) rubbleHeap(c, 0.2, 0.2, c.w - 0.2, c.d - 0.2, pr.rubble);
  piles(c, pr, c.d);
}

/** The stakes and cord of a plot that is not yet a building (a field being laid out). */
export function plotMarks(c: Ctx, w: number, d: number): void {
  stakes(c, 0.2, 0.2, w - 0.2, d - 0.2);
}
