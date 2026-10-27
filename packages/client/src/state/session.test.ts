import { describe, expect, it } from 'vitest';
import type { C2S, S2C, VillageView } from '@hearth/shared';
import { GameSocket, type SocketLike } from '../net/socket';
import type { GameViewApi, RenderEntity } from '../render/api';
import { GameSession, villageCentre } from './session';
import { Store } from './store';

class FakeWs implements SocketLike {
  readyState = 0;
  sent: C2S[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(m: S2C) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

function fakeView() {
  const calls: string[] = [];
  const entities = new Map<number, RenderEntity>();
  const api: Partial<GameViewApi> = {
    clearEntities: () => (entities.clear(), void calls.push('clear')),
    setBuildings: (b) => void calls.push(`buildings:${b.length}`),
    setPlots: (p) => void calls.push(`plots:${p.length}`),
    applyEntities: (d) => {
      for (const e of d.add ?? []) entities.set(e.id, e);
      for (const id of d.del ?? []) entities.delete(id);
      calls.push(`entities:+${d.add?.length ?? 0}/~${d.upd?.length ?? 0}/-${d.del?.length ?? 0}`);
    },
    setSpeed: (s) => void calls.push(`speed:${s}`),
    setTime: () => void calls.push('time'),
    centerOn: (x, y) => void calls.push(`center:${Math.round(x)},${Math.round(y)}`),
  };
  return { api: api as GameViewApi, calls, entities };
}

const time = { hours: 6, day: 0, dayOfSeason: 1, season: 0, year: 0, weather: 'clear', hourMs: 15000 } as const;
const look = { gender: 0, skin: 0, hairStyle: 0, hairColor: 0, outfit: 0, outfitColor: 0, sashColor: 0, accessory: 0 } as const;
const village: VillageView = {
  time,
  speed: 1,
  population: 2,
  entities: [
    { id: 1, name: 'A', x: 10, y: 10, face: 0, state: 'idle', look },
    { id: 2, name: 'B', x: 12, y: 10, face: 0, state: 'idle', look },
  ],
  buildings: [{ id: 1, kind: 'house', x: 10, y: 10, w: 2, d: 2, door: { x: 10, y: 12 } }],
  plots: [],
  stock: { grain: 5 },
};

function setup() {
  const store = new Store();
  let ws!: FakeWs;
  const socket = new GameSocket({ url: 'ws://t', factory: () => (ws = new FakeWs()), pingMs: 1e9 });
  const v = fakeView();
  const notes: string[] = [];
  const session = new GameSession({ store, socket, view: v.api, hooks: { note: (_l, t) => notes.push(t), error: (_c, t) => notes.push(`err:${t}`) }, onNotConnected: () => notes.push('offline') });
  session.start();
  ws.open();
  return { store, ws, v, notes, session, socket };
}

describe('GameSession', () => {
  it('loads the whole village from the first view and centres on it once', () => {
    const { store, ws, v } = setup();
    ws.receive({ t: 'welcome', v: 1, user: { id: 1, username: 'a' }, village: { name: 'Jade Ford', seed: 9 } });
    ws.receive({ t: 'view', view: village });
    expect(store.get('village')?.name).toBe('Jade Ford');
    expect(store.get('population')).toBe(2);
    expect(store.get('stock')).toEqual({ grain: 5 });
    expect(v.calls).toEqual(['clear', 'buildings:1', 'plots:0', 'entities:+2/~0/-0', 'speed:1', 'time', 'center:11,11']);
    ws.receive({ t: 'view', view: village });
    expect(v.calls.filter((c) => c.startsWith('center')).length).toBe(1);
  });

  it('applies updates to the renderer and the store; slow parts only when sent', () => {
    const { store, ws, v } = setup();
    ws.receive({ t: 'view', view: village });
    ws.receive({ t: 'upd', time: { ...time, hours: 7 }, speed: 4, population: 3, ents: [{ id: 1, x: 11, y: 10, face: 0, state: 'idle' }], add: [{ id: 3, name: 'C', x: 1, y: 1, face: 0, state: 'idle', look }], del: [2] });
    expect(store.get('speed')).toBe(4);
    expect(store.get('population')).toBe(3);
    expect(store.get('time')?.hours).toBe(7);
    expect(store.get('stock')).toEqual({ grain: 5 });
    expect([...v.entities.keys()].sort()).toEqual([1, 3]);
    ws.receive({ t: 'upd', time, speed: 4, population: 3, ents: [], stock: { grain: 4 } });
    expect(store.get('stock')).toEqual({ grain: 4 });
  });

  it('asks the server for a speed and waits for the answer to show it', () => {
    const { store, ws, session } = setup();
    session.setSpeed(2);
    expect(ws.sent.at(-1)).toEqual({ t: 'speed', speed: 2 });
    expect(store.get('speed')).toBe(1);
  });

  it('reports a request made while offline', () => {
    const { ws, notes, session } = setup();
    ws.readyState = 3;
    session.setSpeed(0);
    expect(notes).toEqual(['offline']);
  });

  it('shows server notes and errors', () => {
    const { ws, notes } = setup();
    ws.receive({ t: 'note', level: 'good', text: 'Hello' });
    ws.receive({ t: 'err', code: 'x', text: 'Nope' });
    expect(notes).toEqual(['Hello', 'err:Nope']);
  });
});

describe('villageCentre', () => {
  it('is the middle of the buildings, falling back to the people', () => {
    expect(villageCentre(village)).toEqual({ x: 11, y: 11 });
    expect(villageCentre({ ...village, buildings: [] })).toEqual({ x: 11, y: 10 });
    expect(villageCentre({ ...village, buildings: [], entities: [] })).toEqual({ x: 48, y: 48 });
  });
});
