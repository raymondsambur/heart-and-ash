/**
 * Mock server for UI work (`?mock=1`): answers the HTTP API in memory and runs the real simulation library inside the page,
 * so the client can be developed and demonstrated without the Node server. Nothing here ships in normal flows: `main.ts`
 * loads this file only for `?mock=1`.
 *
 * - Accounts: one fake account, remembered in localStorage (any username and password of valid shape works).
 * - The village: `createSim` with the seed from `?seed=` (default 1337). The snapshot is kept in localStorage.
 * - The socket speaks the same protocol as the server: hello -> welcome + view, then `upd` five times a second.
 */
import { GAME_DAY_MS, GAME_HOUR_MS, MAP_SIZE, PROTOCOL_VERSION, SIM_STEP_MS, generateWorld, hash32, type C2S, type EntityUpdate, type FeedEntry, type MeResponse, type S2C, type WorldPayload } from '@hearth/shared';
import { createSim, type Sim, type SimSnapshot } from '@hearth/sim';
import { encodeBase64 } from './base64';
import type { HttpResponse, HttpTransport } from './api';
import type { SocketFactory, SocketLike } from './socket';

const KEY_USER = 'hearth.mock.user';
const KEY_SNAPSHOT = 'hearth.mock.snapshot';

export interface MockOptions {
  seed?: number;
}

export interface MockServer {
  transport: HttpTransport;
  socketFactory: SocketFactory;
  /** The running sim (for tests and the console). */
  sim(): Sim;
}

function store(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function installMock(opts: MockOptions = {}): MockServer {
  const seed = opts.seed ?? 1337;
  let sim: Sim | null = null;
  const ls = store();

  const load = (): Sim => {
    if (sim) return sim;
    let saved: SimSnapshot | null = null;
    try {
      const raw = ls?.getItem(KEY_SNAPSHOT);
      if (raw) saved = JSON.parse(raw) as SimSnapshot;
    } catch {
      saved = null;
    }
    try {
      sim = createSim({ seed, saved: saved && saved.seed === seed ? saved : null, size: MAP_SIZE });
    } catch {
      sim = createSim({ seed, size: MAP_SIZE });
    }
    return sim;
  };
  const save = (): void => {
    try {
      if (sim) ls?.setItem(KEY_SNAPSHOT, JSON.stringify(sim.serialize()));
    } catch {
      /* storage full or blocked: the mock just forgets */
    }
  };

  const user = (): string | null => ls?.getItem(KEY_USER) ?? null;
  const me = (name: string): MeResponse => ({ user: { id: 1 + (hash32(name.length, name.charCodeAt(0) || 0) % 1000), username: name }, village: { name: load().serialize().villageName, seed } });

  const transport: HttpTransport = {
    async request(method, path, body): Promise<HttpResponse> {
      const b = (body ?? {}) as { username?: string; password?: string };
      if (path === '/api/me' && method === 'GET') {
        const u = user();
        return u ? { status: 200, body: me(u) } : { status: 401, body: { error: 'Not logged in.' } };
      }
      if ((path === '/api/login' || path === '/api/register') && method === 'POST') {
        if (typeof b.username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(b.username) || typeof b.password !== 'string' || b.password.length < 8) return { status: 400, body: { error: 'Invalid username or password.' } };
        ls?.setItem(KEY_USER, b.username);
        return { status: path === '/api/register' ? 201 : 200, body: me(b.username) };
      }
      if (path === '/api/logout') {
        ls?.removeItem(KEY_USER);
        return { status: 200, body: { ok: true } };
      }
      if (path === '/api/world' && method === 'GET') {
        if (!user()) return { status: 401, body: { error: 'Not logged in.' } };
        // the map the in-page village is on: a saved one keeps the size it was made with
        const size = load().world.w;
        const w = generateWorld(seed, size, size);
        const payload: WorldPayload = { seed, w: w.w, h: w.h, terrain: encodeBase64(w.terrain), objects: encodeBase64(w.objects), blight: encodeBase64(w.blight), center: { ...w.start.center } };
        return { status: 200, body: payload };
      }
      return { status: 404, body: { error: 'Not found.' } };
    },
  };

  const socketFactory: SocketFactory = () => new MockSocket(load, save, (s) => (sim = s));
  return { transport, socketFactory, sim: load };
}

class MockSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private known = new Set<number>();
  private last = 0;
  private acc = 0;
  private sinceView = 0;
  private sinceSave = 0;
  private watch: number | null = null;
  private sheetAt = 0;
  private rosterJson = '';
  private ordersJson = '';
  private rosterAt = 0;
  private sim: Sim | null = null;
  /** Dev tools: a fast-forward in progress (game ms) and the village as it was before the last one. */
  private skip: { left: number; total: number } | null = null;
  private backup: SimSnapshot | null = null;

  constructor(
    private readonly load: () => Sim,
    private readonly save: () => void,
    private readonly replace: (s: Sim) => void,
  ) {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 30);
  }

  private emit(msg: S2C): void {
    if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) });
  }

  send(data: string): void {
    const msg = JSON.parse(data) as C2S;
    if (msg.t === 'ping') return this.emit({ t: 'pong', n: msg.n });
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) return this.close(4005, 'protocol mismatch');
      this.sim = this.load();
      const view = this.sim.view();
      this.known = new Set(view.entities.map((e) => e.id));
      this.sim.events();
      this.rosterJson = JSON.stringify(view.roster);
      this.ordersJson = JSON.stringify({ o: view.orders, w: view.wishes });
      this.emit({ t: 'welcome', v: PROTOCOL_VERSION, user: { id: 1, username: 'mock' }, village: { name: this.sim.serialize().villageName, seed: this.sim.seed }, dev: true });
      this.emit({ t: 'view', view });
      this.sendDev();
      this.last = performance.now();
      this.timer = setInterval(() => this.tick(), 100);
      return;
    }
    if (msg.t === 'inspect' && this.sim) {
      this.watch = msg.id;
      this.sendSheet();
      return;
    }
    if ((msg.t === 'ration' || msg.t === 'priority' || msg.t === 'rule' || msg.t === 'rule_del' || msg.t === 'answer' || msg.t === 'read') && this.sim) {
      const res = this.sim.command(msg);
      if (!res.ok) this.emit({ t: 'err', code: res.code, text: res.text });
      else if (res.text && msg.t !== 'read') this.emit({ t: 'note', level: 'info', text: res.text });
      this.update();
      return;
    }
    if ((msg.t === 'build' || msg.t === 'demolish' || msg.t === 'cancel') && this.sim) {
      const res = this.sim.command(msg.t === 'build' ? { t: 'build', kind: msg.kind, x: msg.x, y: msg.y, rot: msg.rot } : msg.t === 'demolish' ? { t: 'demolish', building: msg.building, plot: msg.plot } : { t: 'cancel', order: msg.order });
      if (!res.ok) this.emit({ t: 'err', code: res.code, text: res.text });
      else if (res.text) this.emit({ t: 'note', level: 'good', text: res.text });
      this.update();
      return;
    }
    if (msg.t === 'dev_skip' && this.sim) {
      if (msg.days <= 0) return this.finishSkip();
      const ms = msg.days * GAME_DAY_MS;
      if (this.skip) {
        this.skip.left += ms;
        this.skip.total += ms;
      } else {
        this.backup = JSON.parse(JSON.stringify(this.sim.serialize())) as SimSnapshot;
        this.skip = { left: ms, total: ms };
      }
      this.acc = 0;
      this.sendDev();
      return;
    }
    if (msg.t === 'dev_undo' && this.sim) {
      if (!this.backup) return this.emit({ t: 'err', code: 'no_backup', text: 'There is no skip to undo.' });
      this.skip = null;
      this.sim = createSim({ seed: this.sim.seed, saved: this.backup });
      this.replace(this.sim);
      this.backup = null;
      this.acc = 0;
      this.save();
      this.sim.events();
      const view = this.sim.view();
      this.known = new Set(view.entities.map((e) => e.id));
      this.seen = {};
      this.emit({ t: 'view', view });
      this.sendDev();
      this.emit({ t: 'note', level: 'info', text: 'Back to before the last fast-forward.' });
      return;
    }
    if (msg.t === 'speed' && this.sim) {
      this.sim.command({ t: 'speed', speed: msg.speed });
      if (msg.speed === 0) this.save();
      this.update();
    }
  }

  private tick(): void {
    const sim = this.sim;
    if (!sim) return;
    const now = performance.now();
    const real = Math.min(1000, now - this.last);
    this.last = now;
    if (this.skip) {
      const until = performance.now() + 50;
      do {
        const dt = Math.min(GAME_HOUR_MS, this.skip.left);
        sim.step(dt);
        this.skip.left -= dt;
      } while (this.skip.left > 0 && performance.now() < until);
      if (this.skip.left <= 0) this.finishSkip();
    }
    this.acc += this.skip ? 0 : real * sim.speed;
    let steps = 0;
    while (this.acc >= SIM_STEP_MS && steps < 40) {
      sim.step(SIM_STEP_MS);
      this.acc -= SIM_STEP_MS;
      steps++;
    }
    this.sinceView += real;
    if (this.sinceView >= 190) {
      this.sinceView = 0;
      this.update();
      if (this.skip) this.sendDev();
    }
    this.sheetAt += real;
    if (this.sheetAt >= 1000) this.sendSheet();
    this.sinceSave += real;
    if (this.sinceSave >= 5000) {
      this.sinceSave = 0;
      this.save();
    }
  }

  private sendDev(): void {
    const skip = this.skip ? { left: Math.round((Math.max(0, this.skip.left) / GAME_DAY_MS) * 10) / 10, total: Math.round((this.skip.total / GAME_DAY_MS) * 10) / 10 } : null;
    this.emit({ t: 'dev', skip, undo: this.backup !== null });
  }

  private finishSkip(): void {
    const skip = this.skip;
    this.skip = null;
    this.acc = 0;
    this.save();
    this.update();
    this.sendDev();
    if (skip) {
      const days = Math.round(((skip.total - Math.max(0, skip.left)) / GAME_DAY_MS) * 10) / 10;
      this.emit({ t: 'note', level: 'info', text: skip.left <= 0 ? `Fast-forwarded ${days} days.` : `Fast-forward stopped after ${days} days.` });
    }
  }

  private seen: Record<string, string> = {};
  /** Whether a slow-changing part of the view differs from what the client last got. */
  private changed(key: string, value: unknown): boolean {
    const j = JSON.stringify(value);
    if (this.seen[key] === j) return false;
    this.seen[key] = j;
    return true;
  }

  private update(): void {
    const sim = this.sim;
    if (!sim) return;
    const v = sim.view();
    const ents: EntityUpdate[] = v.entities.map((e) => ({ id: e.id, x: e.x, y: e.y, nx: e.nx, ny: e.ny, step: e.step, route: e.route, face: e.face, state: e.state, act: e.act, carry: e.carry, hidden: e.hidden }));
    const add = v.entities.filter((e) => !this.known.has(e.id));
    const seen = new Set(v.entities.map((e) => e.id));
    const del = [...this.known].filter((id) => !seen.has(id));
    this.known = seen;
    const ro = JSON.stringify(v.roster);
    const roster = ro !== this.rosterJson && performance.now() - this.rosterAt > 2000;
    if (roster) {
      this.rosterJson = ro;
      this.rosterAt = performance.now();
    }
    const od = JSON.stringify({ o: v.orders, w: v.wishes });
    const orders = od !== this.ordersJson;
    if (orders) this.ordersJson = od;
    this.emit({ t: 'upd', time: v.time, speed: v.speed, population: v.population, ents, ...(add.length ? { add } : {}), ...(del.length ? { del } : {}), stock: v.stock, status: v.status, ...(this.changed('policy', v.policy) ? { policy: v.policy } : {}), ...(this.changed('reports', v.reports) ? { reports: v.reports } : {}), ...(this.changed('outside', v.outside) ? { outside: v.outside } : {}), ...(this.changed('flora', v.flora) ? { flora: v.flora } : {}), ...(this.changed('ground', v.ground) ? { ground: v.ground } : {}), buildings: v.buildings, plots: v.plots, ...(roster ? { roster: v.roster } : {}), ...(orders ? { orders: v.orders, wishes: v.wishes } : {}) });
    const lines: FeedEntry[] = [];
    for (const ev of sim.events()) if (ev.t === 'feed') lines.push({ ...ev.item });
    if (lines.length) this.emit({ t: 'feed', items: lines });
  }

  private sendSheet(): void {
    this.sheetAt = 0;
    if (!this.sim || this.watch === null) return;
    const sheet = this.sim.sheet(this.watch);
    this.emit({ t: 'sheet', sheet });
    if (!sheet) this.watch = null;
  }

  close(code = 1000, reason = ''): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.save();
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }
}

