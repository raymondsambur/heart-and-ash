/**
 * GameSession: the live link between the socket, the store and the world renderer. Feeds server messages into the
 * store and the renderer, and exposes the few things the UI may ask for (speed).
 */
import type { BuildKind, C2S, JobGroup, NoteLevel, RuleDef, Speed, VillageView } from '@hearth/shared';

/** The feed keeps this many lines on the client. */
const FEED_KEEP = 120;
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

  /** Dev mode: run the village this many game days ahead (0 stops a skip in progress). */
  devSkip(days: number): void {
    this.send({ t: 'dev_skip', days });
  }

  /** Dev mode: put the village back as it was before the last skip. */
  devUndo(): void {
    this.send({ t: 'dev_undo' });
  }

  /** Select a villager (or nobody): highlights them in the world and asks the server for their sheet. */
  select(id: number | null): void {
    const { store, view } = this.o;
    if (store.get('selected') === id) return;
    store.patch({ selected: id, sheet: null, follow: false });
    view.setSelected(id);
    this.send({ t: 'inspect', id });
  }

  /** Keep the camera on the selected villager. */
  setFollow(on: boolean): void {
    this.o.store.set('follow', on && this.o.store.get('selected') !== null);
  }

  /** Order a building raised (the server checks the spot again and answers with a note or an error). */
  build(kind: BuildKind, x: number, y: number, rot = false): void {
    this.send({ t: 'build', kind, x, y, ...(rot ? { rot: true } : {}) });
  }

  demolish(target: { building?: number; plot?: number }): void {
    this.send({ t: 'demolish', ...target });
  }

  cancelOrder(order: number): void {
    this.send({ t: 'cancel', order });
  }

  setPriority(group: JobGroup, level: number): void {
    this.send({ t: 'priority', group, level });
  }

  /** Add a rule (`id` 0) or change one. */
  saveRule(rule: RuleDef): void {
    this.send({ t: 'rule', rule });
  }

  deleteRule(id: number): void {
    this.send({ t: 'rule_del', id });
  }

  answer(offer: number, option: string): void {
    this.send({ t: 'answer', offer, option });
  }

  markRead(report: number): void {
    this.send({ t: 'read', report });
  }

  /** How much of a portion each person is given: 0 normal, 1 tight, 2 strict. */
  setRation(level: 0 | 1 | 2): void {
    this.send({ t: 'ration', level });
  }

  private send(msg: C2S): boolean {
    const ok = this.o.socket.send(msg);
    if (!ok) this.o.onNotConnected();
    return ok;
  }

  start(): void {
    const { store, socket, view, hooks } = this.o;

    this.offs.push(
      socket.on('welcome', (m) => store.patch({ village: m.village, dev: m.dev === true })),

      socket.on('dev', (m) => store.patch({ devSkip: m.skip, devUndo: m.undo })),

      socket.on('view', (m) => {
        // A (re)connect brings the whole village again: replace what the renderer knows.
        const v: VillageView = m.view;
        view.clearEntities();
        view.setBuildings(v.buildings);
        view.setPlots(v.plots);
        view.setFlora(v.flora);
        view.setGround(v.ground);
        view.applyEntities({ add: v.entities.map(toRenderEntity) });
        view.setSpeed(v.speed);
        view.setTime(v.time);
        store.patch({ time: v.time, speed: v.speed, population: v.population, stock: v.stock, buildings: v.buildings, plots: v.plots, roster: v.roster, feed: v.feed.slice(-FEED_KEEP), orders: v.orders, wishes: v.wishes, status: v.status, policy: v.policy, reports: v.reports, outside: v.outside });
        // After a reconnect the server forgets whom we were watching.
        const sel = store.get('selected');
        if (sel !== null) this.send({ t: 'inspect', id: sel });
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
        if (m.flora) view.setFlora(m.flora);
        if (m.ground) view.setGround(m.ground);
        view.setSpeed(m.speed);
        view.setTime(m.time);
        const patch: Parameters<Store['patch']>[0] = { time: m.time, speed: m.speed, population: m.population };
        if (m.stock) patch.stock = m.stock;
        if (m.buildings) patch.buildings = m.buildings;
        if (m.plots) patch.plots = m.plots;
        if (m.roster) patch.roster = m.roster;
        if (m.orders) patch.orders = m.orders;
        if (m.wishes) patch.wishes = m.wishes;
        if (m.status) patch.status = m.status;
        if (m.policy) patch.policy = m.policy;
        if (m.reports) patch.reports = m.reports;
        if (m.outside) patch.outside = m.outside;
        store.patch(patch);
        const sel = store.get('selected');
        if (sel !== null && store.get('follow')) {
          const e = view.getEntity(sel);
          if (e) view.centerOn(e.x, e.y);
        }
      }),

      socket.on('feed', (m) => store.set('feed', [...store.get('feed'), ...m.items].slice(-FEED_KEEP))),

      socket.on('sheet', (m) => {
        if (m.sheet) store.set('sheet', m.sheet);
        else if (store.get('selected') !== null) {
          // They are gone (died or left the village).
          store.patch({ selected: null, sheet: null, follow: false });
          view.setSelected(null);
        }
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
