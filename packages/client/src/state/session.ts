/**
 * GameSession: the live link between the socket, the store and the world renderer. Feeds server messages into the
 * store and the renderer, and exposes the few things the UI may ask for (speed).
 */
import type { C2S, NoteLevel, Speed, VillageView } from '@hearth/shared';
import { toRenderEntity, toRenderPatch } from '../net/adapt';
import type { ConnInfo, GameSocket } from '../net/socket';
import type { GameViewApi } from '../render/api';
import type { Store } from './store';

export interface SessionHooks {
  note(level: NoteLevel, text: string): void;
  error(code: string, text: string): void;
}

export interface GameSessionOptions {
  store: Store;
  socket: GameSocket;
  view: GameViewApi;
  hooks: SessionHooks;
  onNotConnected(): void;
}

export class GameSession {
  private offs: (() => void)[] = [];
  private latencyTimer: ReturnType<typeof setInterval> | null = null;
  /** The first full view of this connection has been drawn (the camera centres on the village once). */
  private centered = false;

  constructor(private o: GameSessionOptions) {}

  /** Ask the server to change the time-control speed. The store changes when the server confirms. */
  setSpeed(speed: Speed): void {
    this.send({ t: 'speed', speed });
  }

  private send(msg: C2S): boolean {
    const ok = this.o.socket.send(msg);
    if (!ok) this.o.onNotConnected();
    return ok;
  }

  start(): void {
    const { store, socket, view, hooks } = this.o;

    this.offs.push(
      socket.on('welcome', (m) => store.patch({ village: m.village })),

      socket.on('view', (m) => {
        // A (re)connect brings the whole village again: replace what the renderer knows.
        const v: VillageView = m.view;
        view.clearEntities();
        view.setBuildings(v.buildings);
        view.setPlots(v.plots);
        view.applyEntities({ add: v.entities.map(toRenderEntity) });
        view.setSpeed(v.speed);
        view.setTime(v.time);
        store.patch({ time: v.time, speed: v.speed, population: v.population, stock: v.stock, buildings: v.buildings, plots: v.plots });
        if (!this.centered) {
          this.centered = true;
          const c = villageCentre(v);
          view.centerOn(c.x, c.y, true);
        }
      }),

      socket.on('upd', (m) => {
        view.applyEntities({ add: m.add?.map(toRenderEntity), upd: m.ents.map(toRenderPatch), del: m.del });
        if (m.buildings) view.setBuildings(m.buildings);
        if (m.plots) view.setPlots(m.plots);
        view.setSpeed(m.speed);
        view.setTime(m.time);
        const patch: Parameters<Store['patch']>[0] = { time: m.time, speed: m.speed, population: m.population };
        if (m.stock) patch.stock = m.stock;
        if (m.buildings) patch.buildings = m.buildings;
        if (m.plots) patch.plots = m.plots;
        store.patch(patch);
      }),

      socket.on('note', (m) => hooks.note(m.level, m.text)),
      socket.on('err', (m) => hooks.error(m.code, m.text)),
      socket.onState((info: ConnInfo) => store.set('conn', info)),
    );
    // Latency changes with every pong; the store is only told when the number moves.
    this.latencyTimer = setInterval(() => store.set('latency', socket.latency), 2000);
    socket.connect();
  }

  stop(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.latencyTimer) clearInterval(this.latencyTimer);
    this.latencyTimer = null;
    this.o.socket.close('logout');
  }
}

/** The middle of the buildings, or of the people when there are none. */
export function villageCentre(v: VillageView): { x: number; y: number } {
  const pts = v.buildings.length ? v.buildings.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.d / 2 })) : v.entities.map((e) => ({ x: e.x, y: e.y }));
  if (!pts.length) return { x: 48, y: 48 };
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}
