// Throwaway feasibility test: one house at several construction stages. Not committed.
import fs from 'node:fs';
import { AHW } from '../packages/client/src/render/iso';
import { BUILDING_ZK } from '../packages/client/src/art/scale';
import { hex } from '../packages/client/src/art/color';
import { Scene3D } from '../packages/client/src/art/mesh';
import { PixelBuffer } from '../packages/client/src/art/pixel';
import { door, flatShader, pillar, plinth, roof, walls, type Style } from '../packages/client/src/art/arch';
import { genBuilding } from '../packages/client/src/art/buildings';
import { encodePng, packedToRgba } from '../packages/client/src/art/png';

const w = 3;
const d = 3;
const zk = BUILDING_ZK;
const maxZ = 70 * zk;
const oy = Math.ceil(maxZ) + 14;
const ox = d * AHW + 14;
const W = (w + d) * AHW + 28;
const H = (w + d) * 8 + oy + 10;
const st: Style = { roof: hex('#5b6572'), accent: hex('#a8302a'), wall: hex('#e6dcc6'), timber: hex('#5a3a26'), stone: hex('#8e8a82'), season: 1, fallen: false, seed: 7919 * 3 + 13, soot: hex('#2a2226'), zk };
const ph = 3;
const WALL_H = 30;
const ins = 0.42;
const u0 = ins, u1 = w - ins, v0 = ins, v1 = d - ins;
const wallSpec = { kind: 'plaster' as const, base: st.wall, post: 11, ruin: 0, eave: 5 };
const timber = st.timber;
const bamboo = flatShader(hex('#b9a45a'), st, 0.07);
const plank = flatShader(hex('#9a7b4a'), st, 0.06);

function stakes(sc: Scene3D): void {
  for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]) pillar(sc, st, u, v, 0, 9, timber, 0.06);
}
function foundation(sc: Scene3D): void {
  plinth(sc, st, u0 - 0.06, v0 - 0.06, u1 + 0.06, v1 + 0.06, ph);
}
function pile(sc: Scene3D): void {
  // stacked timber beside the plot
  for (let i = 0; i < 4; i++) sc.box(w + 0.15, 0.6 + i * 0.0, 0 + i * 2.2, w + 0.55, 2.4, 2.2 + i * 2.2, plank, bamboo, bamboo);
}
function frame(sc: Scene3D, p: number): void {
  const z = ph + WALL_H * p;
  for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1], [(u0 + u1) / 2, v1], [u1, (v0 + v1) / 2]]) pillar(sc, st, u, v, ph, z, timber, 0.075);
  if (p > 0.85) {
    // top beams
    sc.box(u0, v1 - 0.06, z - 1.5, u1, v1 + 0.06, z, plank, plank, plank);
    sc.box(u1 - 0.06, v0, z - 1.5, u1 + 0.06, v1, z, plank, plank, plank);
  }
}
function wallsTo(sc: Scene3D, p: number): void {
  walls(sc, st, u0, v0, u1, v1, ph, ph + WALL_H * p, wallSpec);
}
function scaffold(sc: Scene3D, top: number): void {
  const eu = u1 + 0.42;
  const ev = v1 + 0.42;
  for (let i = 0; i <= 3; i++) {
    const u = u0 + ((u1 - u0 + 0.4) * i) / 3;
    pillar(sc, st, u, ev, 0, top, hex('#b9a45a'), 0.045);
    const v = v0 + ((v1 - v0 + 0.4) * i) / 3;
    pillar(sc, st, eu, v, 0, top, hex('#b9a45a'), 0.045);
  }
  for (let z = 9; z <= top; z += 10) {
    sc.box(u0, ev - 0.03, z, eu, ev + 0.03, z + 1.2, bamboo, bamboo, bamboo);
    sc.box(eu - 0.03, v0, z, eu + 0.03, ev, z + 1.2, bamboo, bamboo, bamboo);
    if (z === 19) {
      sc.box(u0, ev - 0.34, z + 1.2, eu, ev, z + 2.2, plank, plank, plank);
    }
  }
}
function roofAt(sc: Scene3D, holes: number): void {
  roof(sc, st, u0, v0, u1, v1, { zEave: ph + WALL_H, rise: 12, over: 0.4, up: 4, color: st.roof, holes });
}

type Stage = { name: string; draw: (sc: Scene3D) => void };
const stages: Stage[] = [
  { name: '1 staked', draw: (sc) => stakes(sc) },
  { name: '2 foundation', draw: (sc) => { foundation(sc); pile(sc); } },
  { name: '3 frame', draw: (sc) => { foundation(sc); frame(sc, 1); scaffold(sc, 36); } },
  { name: '4 walls 40%', draw: (sc) => { foundation(sc); wallsTo(sc, 0.4); frame(sc, 1); scaffold(sc, 36); } },
  { name: '5 walls 100%', draw: (sc) => { foundation(sc); wallsTo(sc, 1); frame(sc, 1); door(sc, st, 'left', v1, w / 2, 0.8, ph, 20); scaffold(sc, 36); } },
  { name: '6 roof 60% open', draw: (sc) => { foundation(sc); wallsTo(sc, 1); door(sc, st, 'left', v1, w / 2, 0.8, ph, 20); roofAt(sc, 0.6); scaffold(sc, 36); } },
  { name: '7 roof 20% open', draw: (sc) => { foundation(sc); wallsTo(sc, 1); door(sc, st, 'left', v1, w / 2, 0.8, ph, 20); roofAt(sc, 0.2); } },
  { name: '8 finished', draw: () => undefined },
];

const sheet = new PixelBuffer(W * stages.length, H);
stages.forEach((s, i) => {
  if (s.name.startsWith('8')) {
    const art = genBuilding({ id: 3, kind: 'house', w, d, door: { dx: 1, dy: d }, season: 1, roofCss: null, accentCss: null, fallen: false });
    sheet.blit(art.pb, i * W + (W - art.pb.w) / 2, H - art.pb.h);
    return;
  }
  const sc = new Scene3D(W, H, ox, oy);
  sc.zk = zk;
  s.draw(sc);
  sc.pb.outline(undefined, 0.3);
  sheet.blit(sc.pb, i * W, 0);
});

// paper background and 2x nearest-neighbour upscale
const S = 2;
const out = new Uint8Array(sheet.w * S * sheet.h * S * 4);
const rgba = packedToRgba(sheet.px);
for (let y = 0; y < sheet.h * S; y++) {
  for (let x = 0; x < sheet.w * S; x++) {
    const si = ((y / S | 0) * sheet.w + (x / S | 0)) * 4;
    const a = rgba[si + 3] / 255;
    const bg = [92, 118, 84];
    const di = (y * sheet.w * S + x) * 4;
    for (let k = 0; k < 3; k++) out[di + k] = Math.round(rgba[si + k] * a + bg[k] * (1 - a));
    out[di + 3] = 255;
  }
}
const png = await encodePng({ w: sheet.w * S, h: sheet.h * S, data: out });
const target = process.argv[2];
fs.writeFileSync(target, png);
console.log(`wrote ${target} (${sheet.w * S}x${sheet.h * S}), stage width ${W}, height ${H}`);
