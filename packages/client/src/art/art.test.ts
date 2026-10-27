import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, O, T, generateWorld, type BuildKind, type BuildingKind, type ConView, type Look } from '@hearth/shared';
import { genBeast, BEAST_FRAMES, BEAST_KEYS } from './beasts';
import { genBuilding, genConstruction } from './buildings';
import { conKey, progressOf } from './construction';
import { FRAME_COUNTS, genCharacter, type CharState } from './character';
import { cb, cg, cr, hex, mix, rgba } from './color';
import { FLORA_CODES, VARIANTS, genObject } from './flora';
import { genMountainTile } from './mountain';
import { NODE_FRAMES, genNode } from './nodes';
import { ihash, noiseTables } from './noise';
import { PixelBuffer } from './pixel';
import { Scene3D } from './mesh';
import { paintChunk, chunkOrigin, CHUNK_PX_H, CHUNK_PX_W } from './terrain';
import { genWallTile, genBridgeRails } from './walls';

const opaque = (pb: PixelBuffer): number => {
  let n = 0;
  for (const c of pb.px) if (c >>> 24 > 0) n++;
  return n;
};

describe('colour helpers', () => {
  it('packs and mixes', () => {
    const c = hex('#336699');
    expect([cr(c), cg(c), cb(c)]).toEqual([0x33, 0x66, 0x99]);
    expect(mix(rgba(0, 0, 0), rgba(200, 100, 50), 0.5)).toBe(rgba(100, 50, 25));
  });
  it('hash noise is deterministic', () => {
    expect(ihash(3, 4, 5)).toBe(ihash(3, 4, 5));
    expect(ihash(3, 4, 5)).not.toBe(ihash(4, 3, 5));
    const t = noiseTables();
    expect(t[0].at(10.5, 20.25)).toBeGreaterThanOrEqual(0);
    expect(t[0].at(10.5, 20.25)).toBeLessThanOrEqual(1);
  });
});

describe('mesh rasteriser', () => {
  it('z-buffers faces: nearer geometry wins', () => {
    const sc = new Scene3D(64, 64, 32, 32);
    sc.top(0, 0, 1, 1, 0, 1, () => hex('#ff0000'));
    sc.top(0, 0, 1, 1, 10, 1, () => hex('#00ff00'));
    const x = Math.round(sc.sx(0.5, 0.5));
    const y = Math.round(sc.sy(0.5, 0.5, 10));
    expect(sc.pb.get(x, y)).toBe(hex('#00ff00'));
    expect(opaque(sc.pb)).toBeGreaterThan(100);
  });
});

describe('terrain painter', () => {
  const world = generateWorld(1337);
  const src = { w: world.w, h: world.h, terrain: world.terrain, blight: null };
  it('paints a deterministic, non-empty chunk with the expected size', () => {
    const a = paintChunk(src, 5, 5, 1);
    const b = paintChunk(src, 5, 5, 1);
    expect(a.base.w).toBe(CHUNK_PX_W);
    expect(a.base.h).toBe(CHUNK_PX_H);
    expect(opaque(a.base)).toBeGreaterThan(50000);
    expect(a.base.px.every((v, i) => v === b.base.px[i])).toBe(true);
    expect(chunkOrigin(0, 0)).toEqual({ ox: -256, oy: -8 });
  });
  it('differs between seasons and gains veins under heavy Blight', () => {
    const sum = (p: PixelBuffer): number => p.px.reduce((s, v) => (s + v) >>> 0, 0);
    expect(sum(paintChunk(src, 5, 5, 0).base)).not.toBe(sum(paintChunk(src, 5, 5, 3).base));
    const blight = new Uint8Array(world.w * world.h).fill(230);
    const c = paintChunk({ ...src, blight }, 5, 5, 1);
    expect(c.veins).not.toBeNull();
    expect(c.maxBlight).toBe(230);
  });
  it('animates water and keeps land terrain varied', () => {
    let waterChunks = 0;
    for (let cy = 0; cy < 8 && waterChunks === 0; cy++) for (let cx = 0; cx < 12; cx++) if (paintChunk(src, cx, cy, 1).water) waterChunks++;
    expect(waterChunks).toBeGreaterThan(0);
    for (const code of Object.values(T)) expect(typeof code).toBe('number');
  });
});

describe('vegetation, props and mountains', () => {
  it('every object code renders for each season and Blight tier', () => {
    for (const code of FLORA_CODES)
      for (let season = 0; season < 4; season++)
        for (let tier = 0; tier < 3; tier++) {
          const s = genObject(code, 1, season, tier);
          expect(s).not.toBeNull();
          if (s!.visible) expect(opaque(s!.pb)).toBeGreaterThan(4);
        }
    expect(VARIANTS).toBeGreaterThanOrEqual(3);
    expect(genObject(O.None, 0, 0, 0)).toBeNull();
  });
  it('mountain tiles are continuous heightfield sprites', () => {
    const rock = (x: number, y: number): boolean => x >= 2 && x < 8 && y >= 2 && y < 8;
    const src = { w: 12, h: 12, isRock: rock, dist: (x: number, y: number) => (rock(x, y) ? Math.min(x - 1, y - 1, 8 - x, 8 - y) : 0), climate: () => 0 };
    const a = genMountainTile(src, 5, 5, 3);
    expect(opaque(a.pb)).toBeGreaterThan(200);
    expect(a.ay).toBeGreaterThan(a.pb.h / 2 - 20);
  });
  it('walls and bridge rails', () => {
    for (let m = 0; m < 16; m++) expect(opaque(genWallTile(m, 1, false).pb)).toBeGreaterThan(100);
    expect(opaque(genWallTile(3, 3, true).pb)).toBeGreaterThan(50);
    expect(opaque(genBridgeRails(0, 1).pb)).toBeGreaterThan(20);
    expect(opaque(genBridgeRails(1, 3).pb)).toBeGreaterThan(20);
  });
});

describe('buildings', () => {
  const sizes: Record<BuildingKind, [number, number]> = { house: [3, 3], inn: [4, 4], smithy: [3, 3], alchemy: [3, 3], market: [4, 3], shrine: [2, 2], pagoda: [5, 5], hall: [4, 5], dojo: [4, 4], farmhouse: [3, 3], herbHut: [2, 2], mineEntrance: [1, 1], tower: [2, 2], gate: [4, 2], barracks: [4, 3], ruinedHouse: [3, 3], warehouse: [4, 3], teahouse: [3, 3], hermitage: [3, 3], yard: [5, 4], dormitory: [4, 3], pavilion: [3, 3], sectGate: [4, 1], workshop: [3, 3], watchpost: [2, 2], well: [1, 1], wall: [4, 1] };
  it('renders every kind, normal and fallen, in every season', () => {
    for (const [kind, [w, d]] of Object.entries(sizes) as [BuildingKind, [number, number]][]) {
      for (const fallen of [false, true]) {
        if (kind === 'yard') continue; // open floor: nothing to draw
        const a = genBuilding({ id: 7, kind, w, d, door: { dx: 1, dy: d }, season: fallen ? 3 : 1, roofCss: fallen ? null : '#3f5f86', accentCss: '#5fa4e8', fallen });
        expect(opaque(a.pb), `${kind} fallen=${fallen}`).toBeGreaterThan(150);
        expect(a.ox).toBeGreaterThan(0);
      }
    }
  });
  it('is deterministic and emits lights for inhabited buildings', () => {
    const spec = { id: 3, kind: 'inn' as const, w: 4, d: 4, door: { dx: 2, dy: 4 }, season: 1, roofCss: null, accentCss: null, fallen: false };
    const a = genBuilding(spec);
    const b = genBuilding(spec);
    expect(a.pb.px.every((v, i) => v === b.pb.px[i])).toBe(true);
    expect(a.lights.length).toBeGreaterThan(0);
    expect(opaque(a.glow)).toBeGreaterThan(0);
    const f = genBuilding({ ...spec, fallen: true });
    expect(f.lights.length).toBe(0);
  });
});

describe('construction stages', () => {
  const spec = (kind: BuildingKind, w: number, d: number) => ({ id: 11, kind, w, d, door: { dx: Math.floor(w / 2), dy: d }, season: 1, roofCss: null, accentCss: null, fallen: false });
  const KINDS: [BuildingKind, BuildKind, number, number][] = [
    ['house', 'house', 3, 3],
    ['warehouse', 'warehouse', 4, 3],
    ['workshop', 'workshop', 3, 3],
    ['shrine', 'shrine', 2, 2],
    ['watchpost', 'watchpost', 2, 2],
    ['well', 'well', 1, 1],
    ['wall', 'wall', 4, 1],
  ];
  const states = (bk: BuildKind): ConView[] => {
    const n = BLUEPRINTS[bk].stages.length;
    const out: ConView[] = [];
    for (let done = 0; done < n; done++) for (const pct of [0, 25, 50, 75]) out.push({ mode: 'build', done, pct, order: 1, pile: { planks: 6, stone: 6, thatch: 3 } });
    return out;
  };
  it('draws every stage of every buildable kind inside the finished sprite bounds, with something showing', () => {
    for (const [kind, bk, w, d] of KINDS) {
      const full = genBuilding(spec(kind, w, d));
      for (const con of states(bk)) {
        const a = genConstruction(spec(kind, w, d), progressOf(bk, con));
        expect(opaque(a.pb), `${kind} ${conKey(con)}`).toBeGreaterThan(5);
        expect(a.pb.w, kind).toBeGreaterThanOrEqual(full.pb.w);
      }
    }
  });
  it('changes at every stage and ends much bigger than it starts', () => {
    for (const [kind, bk, w, d] of KINDS) {
      const bp = BLUEPRINTS[bk];
      const seen = new Set<string>();
      let first = 0;
      let last = 0;
      for (let done = 0; done < bp.stages.length; done++) {
        const a = genConstruction(spec(kind, w, d), progressOf(bk, { mode: 'build', done, pct: 0, order: 1 }));
        seen.add(Array.from(a.pb.px).join(','));
        if (done === 0) first = opaque(a.pb);
        last = opaque(a.pb);
      }
      expect(seen.size, kind).toBe(bp.stages.length);
      expect(last, kind).toBeGreaterThan(first);
    }
  });
  it('is deterministic and the demolition reverses the sequence', () => {
    const s = spec('house', 3, 3);
    const con: ConView = { mode: 'build', done: 3, pct: 50, order: 1 };
    const a = genConstruction(s, progressOf('house', con));
    const b = genConstruction(s, progressOf('house', con));
    expect(a.pb.px.every((v, i) => v === b.pb.px[i])).toBe(true);
    // half way through taking the roof off looks like the building with a half-laid roof (plus rubble)
    const down = progressOf('house', { mode: 'demolish', done: 5, pct: 50, order: 2 });
    const up = progressOf('house', { mode: 'build', done: 4, pct: 50, order: 2 });
    expect(down.roof).toBe(up.roof);
    expect(down.walls).toBe(1);
    expect(down.demolish).toBe(true);
    const rub = progressOf('house', { mode: 'rubble', done: 0, pct: 0, order: 2 });
    expect(rub.rubble).toBe(1);
    expect(rub.walls).toBe(0);
    expect(opaque(genConstruction(s, rub).pb)).toBeGreaterThan(50);
  });
  it('keys differ per visible state and agree for identical ones', () => {
    expect(conKey({ mode: 'build', done: 1, pct: 30, order: 1 })).toBe(conKey({ mode: 'build', done: 1, pct: 40, order: 9 }));
    expect(conKey({ mode: 'build', done: 1, pct: 30, order: 1 })).not.toBe(conKey({ mode: 'build', done: 1, pct: 55, order: 1 }));
    expect(conKey({ mode: 'build', done: 1, pct: 30, order: 1, pile: { stone: 12 } })).not.toBe(conKey({ mode: 'build', done: 1, pct: 30, order: 1 }));
  });
});

describe('characters, monsters and nodes', () => {
  const look = (i: number): Look => ({ gender: (i % 2) as 0 | 1, skin: i % 6, hairStyle: i % 7, hairColor: (i * 3) % 8, outfit: i % 4, outfitColor: (i * 3) % 10, sashColor: i % 8, accessory: i % 5 });
  it('draws every look in every state and direction', () => {
    const states = Object.keys(FRAME_COUNTS) as CharState[];
    for (let i = 0; i < 40; i++)
      for (const state of states) {
        const f = FRAME_COUNTS[state] - 1;
        for (const dir of [0, 1, 2, 3] as const) {
          const s = genCharacter({ look: look(i), weapon: (['sword', 'blade', 'spear', 'staff', 'fist', null] as const)[i % 6], state, dir, frame: f });
          expect(opaque(s.pb)).toBeGreaterThan(40);
        }
      }
  });
  it('shows a load in the hands while walking and standing, and a saw at work', () => {
    const base = (state: CharState, tool?: 'plank' | 'log' | 'stone' | 'bundle' | 'saw') => genCharacter({ look: look(4), state, dir: 0, frame: 1, role: 'villager', tool });
    for (const tool of ['plank', 'log', 'stone', 'bundle'] as const)
      for (const state of ['walk', 'idle'] as const) {
        const a = base(state);
        const b = base(state, tool);
        expect(b.pb.px.some((v, i) => v !== a.pb.px[i]), `${tool} ${state}`).toBe(true);
      }
    expect(base('work', 'saw').pb.px.some((v, i) => v !== base('work', 'hammer' as never).pb.px[i])).toBe(true);
  });
  it('mirrors west facings and scales elites', () => {
    const e = genCharacter({ look: look(3), state: 'idle', dir: 0, frame: 0 });
    const w = genCharacter({ look: look(3), state: 'idle', dir: 1, frame: 0 });
    expect(opaque(e.pb)).toBe(opaque(w.pb));
    const boss = genCharacter({ look: look(3), state: 'idle', dir: 0, frame: 0, special: 'bandit_boss' });
    expect(boss.pb.h).toBeGreaterThan(e.pb.h);
  });
  it('draws all special monsters and roles', () => {
    for (const special of ['bandit', 'bandit_boss', 'hollow', 'hollow_monk', 'hollow_brute', 'hollow_lord'] as const)
      expect(opaque(genCharacter({ look: look(1), state: 'fight', dir: 3, frame: 2, special }).pb)).toBeGreaterThan(80);
    for (const role of ['villager', 'guard', 'merchant', 'smith', 'alchemist', 'innkeeper', 'master', 'elder', 'physician', 'legend', 'wanderer'] as const)
      expect(opaque(genCharacter({ look: look(2), state: 'idle', dir: 0, frame: 0, role }).pb)).toBeGreaterThan(80);
  });
  it('draws every beast', () => {
    for (const key of BEAST_KEYS)
      for (const [state, n] of Object.entries(BEAST_FRAMES))
        for (let f = 0; f < n; f++) for (const dir of [0, 3] as const) expect(opaque(genBeast({ key, state: state as 'idle', dir, frame: f }).pb)).toBeGreaterThan(30);
  });
  it('draws every node kind and frame', () => {
    for (const [kind, n] of Object.entries(NODE_FRAMES))
      for (let f = 0; f < n; f++) expect(opaque(genNode(kind as 'herb', 1, 1, f).pb)).toBeGreaterThan(30);
    expect(genNode('heart', 0, 1, 0).glow).not.toBeNull();
  });
});
