/**
 * Contact sheet of the construction art: the stages of each kind left to right, wrapped (each at 0% and 50%), then the finished
 * building and the demolition run backwards. Writes a PNG (default docs/notes/img/m2-stages.png).
 *   tsx --tsconfig scripts/tsconfig.json scripts/stages.ts [out.png] [kind,kind,...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BLUEPRINTS, type BuildingKind, type BuildKind, type ConView } from '@hearth/shared';
import { genBuilding, genConstruction, type BuildingArt } from '../packages/client/src/art/buildings';
import { progressOf } from '../packages/client/src/art/construction';
import { encodePng, packedToRgba } from '../packages/client/src/art/png';

const out = process.argv[2] ?? 'docs/notes/img/m2-stages.png';
const only = process.argv[3]?.split(',');
const KINDS: [BuildKind, BuildingKind, number, number][] = [
  ['house', 'house', 3, 3],
  ['warehouse', 'warehouse', 4, 3],
  ['workshop', 'workshop', 3, 3],
  ['shrine', 'shrine', 2, 2],
  ['watchpost', 'watchpost', 2, 2],
  ['well', 'well', 1, 1],
  ['wall', 'wall', 4, 1],
];
const SCALE = 2;
const PER_ROW = 7;
const GRASS = [0x6d, 0x93, 0x4c];
const spec = (kind: BuildingKind, w: number, d: number) => ({ id: 11, kind, w, d, door: { dx: Math.floor(w / 2), dy: d }, season: 1, roofCss: null, accentCss: null, fallen: false });

interface Cell {
  art: BuildingArt;
}
const rows: Cell[][] = [];
for (const [bk, kind, w, d] of KINDS) {
  if (only && !only.includes(bk)) continue;
  const bp = BLUEPRINTS[bk];
  const n = bp.stages.length;
  const row: Cell[] = [];
  const add = (con: ConView): void => void row.push({ art: genConstruction(spec(kind, w, d), progressOf(bk, con)) });
  for (let done = 0; done < n; done++) for (const pct of done === 0 ? [0, 50] : [0, 50]) add({ mode: 'build', done, pct, order: 1, pile: done < n ? { planks: 8, stone: 8, thatch: 4 } : undefined });
  row.push({ art: genBuilding(spec(kind, w, d)) });
  add({ mode: 'demolish', done: n, pct: 50, order: 2 });
  add({ mode: 'demolish', done: 2, pct: 50, order: 2 });
  add({ mode: 'rubble', done: 0, pct: 0, order: 2 });
  for (let i = 0; i < row.length; i += PER_ROW) rows.push(row.slice(i, i + PER_ROW));
}
const cw = Math.max(...rows.flat().map((c) => c.art.pb.w));
const ch = Math.max(...rows.flat().map((c) => c.art.pb.h));
const cols = Math.max(...rows.map((r) => r.length));
const W = cols * cw * SCALE;
const H = rows.length * ch * SCALE;
const rgba = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  rgba[i * 4] = GRASS[0];
  rgba[i * 4 + 1] = GRASS[1];
  rgba[i * 4 + 2] = GRASS[2];
  rgba[i * 4 + 3] = 255;
}
rows.forEach((row, r) =>
  row.forEach((cell, c) => {
    const px = packedToRgba(cell.art.pb.px);
    const { w, h } = cell.art.pb;
    const x0 = (c * cw + ((cw - w) >> 1)) * SCALE;
    const y0 = (r * ch + (ch - h)) * SCALE;
    for (let y = 0; y < h * SCALE; y++)
      for (let x = 0; x < w * SCALE; x++) {
        const s = ((y / SCALE) | 0) * w + ((x / SCALE) | 0);
        const a = px[s * 4 + 3] / 255;
        if (a === 0) continue;
        const o = ((y0 + y) * W + x0 + x) * 4;
        for (let k = 0; k < 3; k++) rgba[o + k] = Math.round(px[s * 4 + k] * a + rgba[o + k] * (1 - a));
      }
  }),
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await encodePng({ w: W, h: H, data: rgba }));
console.log(`${out}: ${rows.length} rows x ${cols} columns, cell ${cw}x${ch} px, ${W}x${H}`);
