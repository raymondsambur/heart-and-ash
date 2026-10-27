/**
 * The village host: one running sim per connected account, the tick loop that advances it at the chosen speed,
 * the five-times-a-second view updates, and persistence.
 *
 * - The sim only runs while its owner is connected (the away policy, milestone M4, is not built: see `Config.awayCapHours`).
 * - Speed is village state kept inside the sim (so it survives a restart); the client only asks for changes.
 * - Snapshots are written every `autosaveMs` while a village runs, and on pause, on disconnect and on shutdown.
 */
import {
  CLOSE_BAD_PROTOCOL,
  CLOSE_REPLACED,
  PROTOCOL_VERSION,
  SIM_STEP_MS,
  TICK_MS,
  VIEW_HZ,
  hash32,
  type C2S,
  type EntityUpdate,
  type EntityView,
  type FeedEntry,
  type OrderView,
  type WishView,
  type PersonBrief,
  type S2C,
  type VillageView,
} from '@hearth/shared';
import { Rng, villageName } from '@hearth/shared';
import { SNAPSHOT_VERSION, createSim, type Sim, type SimSnapshot } from '@hearth/sim';
import type { Config } from './config';
import type { Db, UserRow, VillageRow } from './db';
import type { Logger } from './log';

/** Maximum sim steps per tick, so a stalled event loop cannot trigger a long burst (the lost time is dropped). */
const MAX_STEPS_PER_TICK = 40;
/** A connection that has not said hello within this long is closed. */
const HELLO_TIMEOUT_MS = 5000;
/** How often a watched villager's sheet is sent, and the villager list at most. */
const SHEET_EVERY_MS = 1000;
const ROSTER_EVERY_MS = 2000;

export interface ClientConn {
  readonly id: number;
  readonly ip: string;
  readonly open: boolean;
  send(msg: S2C): void;
  close(code: number, reason: string): void;
}

/** The seed of an account's village. Fixed at creation and stored, so a changed WORLD_SEED never moves existing villages. */
export function villageSeed(worldSeed: number, userId: number): number {
  return hash32(worldSeed, userId, 0x7117) & 0x7fffffff;
}

interface Running {
  village: VillageRow;
  sim: Sim;
  conn: ClientConn | null;
  /** Speed-weighted real time not yet turned into sim steps (ms of game time). */
  acc: number;
  /** Real ms since the last view update. */
  sinceView: number;
  dirty: boolean;
  lastSaveAt: number;
  /** Entity ids the connected client knows, and the JSON of the slow-changing parts it last received. */
  known: Set<number>;
  sent: { buildings: string; plots: string; stock: string; roster: string; orders: string };
  /** The villager whose sheet the client is watching, and when it was last sent (real ms). */
  watch: number | null;
  sheetAt: number;
  rosterAt: number;
}

/** Handle the gateway keeps for one websocket. */
export interface Attached {
  readonly conn: ClientConn;
  readonly user: UserRow;
  ready: boolean;
  helloTimer: NodeJS.Timeout | null;
}

export interface HostStats {
  online: number;
  running: number;
  tickMs: number;
  snapshots: number;
}

export class VillageHost {
  private readonly running = new Map<number, Running>();
  private readonly attached = new Map<number, Attached>();
  private timer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private tickAvgMs = 0;
  private snapshots = 0;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  // ---- lifecycle ------------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.lastTick = this.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  /** Stop ticking, save every running village and drop the connections. */
  shutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const a of this.attached.values()) {
      if (a.helloTimer) clearTimeout(a.helloTimer);
      a.conn.close(1001, 'server shutting down');
    }
    for (const r of this.running.values()) this.save(r, 'shutdown');
    this.running.clear();
    this.attached.clear();
  }

  stats(): HostStats {
    return { online: this.attached.size, running: this.running.size, tickMs: Math.round(this.tickAvgMs * 10) / 10, snapshots: this.snapshots };
  }

  // ---- villages ---------------------------------------------------------------------

  /** The account's village row; created on first use (one village per account for now). */
  ensureVillage(userId: number): VillageRow {
    const existing = this.db.getVillage(userId);
    if (existing) return existing;
    const seed = villageSeed(this.config.worldSeed, userId);
    const name = villageName(new Rng(seed ^ 0xa11ce));
    const row = this.db.createVillage(userId, name, seed, this.now());
    this.log.info(`village created: ${row.name}`, { user: userId, seed });
    return row;
  }

  private load(village: VillageRow): Sim {
    let saved: SimSnapshot | null = null;
    if (village.snapshot) {
      try {
        saved = JSON.parse(village.snapshot) as SimSnapshot;
      } catch (err) {
        this.log.error(`village ${village.id}: snapshot is not valid JSON`, err);
      }
    }
    if (saved) {
      try {
        return createSim({ seed: village.seed, saved });
      } catch (err) {
        // Keep the broken snapshot for inspection and start the village over rather than locking the player out.
        this.log.error(`village ${village.id}: could not restore the snapshot; keeping a backup and starting over`, err);
        this.db.kvSet(`village.${village.id}.broken.${this.now()}`, village.snapshot ?? '');
      }
    }
    return createSim({ seed: village.seed });
  }

  // ---- connections ----------------------------------------------------------------------

  /** A websocket was accepted. Waits for the client's hello before sending anything. */
  attach(conn: ClientConn, user: UserRow): Attached {
    const prev = this.attached.get(user.id);
    if (prev) this.detach(prev, CLOSE_REPLACED, 'logged in elsewhere');
    const a: Attached = { conn, user, ready: false, helloTimer: null };
    a.helloTimer = setTimeout(() => {
      if (!a.ready) conn.close(CLOSE_BAD_PROTOCOL, 'hello expected');
    }, HELLO_TIMEOUT_MS);
    a.helloTimer.unref();
    this.attached.set(user.id, a);
    return a;
  }

  /** The websocket closed (or was replaced). Saves the village and stops simulating it. */
  disconnect(conn: ClientConn): void {
    for (const a of this.attached.values()) {
      if (a.conn === conn) {
        this.detach(a, null, '');
        return;
      }
    }
  }

  private detach(a: Attached, closeCode: number | null, reason: string): void {
    if (a.helloTimer) clearTimeout(a.helloTimer);
    a.helloTimer = null;
    if (this.attached.get(a.user.id) === a) this.attached.delete(a.user.id);
    const r = this.running.get(a.user.id);
    if (r && r.conn === a.conn) {
      this.save(r, 'disconnect');
      this.running.delete(a.user.id);
    }
    if (closeCode !== null) a.conn.close(closeCode, reason);
  }

  /** A validated message from a client. */
  receive(a: Attached, msg: C2S): void {
    switch (msg.t) {
      case 'hello':
        return this.hello(a, msg.v);
      case 'ping':
        a.conn.send({ t: 'pong', n: msg.n });
        return;
      case 'inspect': {
        if (!a.ready) return void a.conn.send({ t: 'err', code: 'no_hello', text: 'Say hello first.' });
        const r = this.running.get(a.user.id);
        if (!r) return;
        r.watch = msg.id;
        this.sendSheet(r, this.now());
        return;
      }
      case 'build':
      case 'demolish':
      case 'cancel': {
        if (!a.ready) return void a.conn.send({ t: 'err', code: 'no_hello', text: 'Say hello first.' });
        const r = this.running.get(a.user.id);
        if (!r) return;
        const res = r.sim.command(msg.t === 'build' ? { t: 'build', kind: msg.kind, x: msg.x, y: msg.y, rot: msg.rot } : msg.t === 'demolish' ? { t: 'demolish', building: msg.building, plot: msg.plot } : { t: 'cancel', order: msg.order });
        if (!res.ok) return void a.conn.send({ t: 'err', code: res.code, text: res.text });
        if (res.text) a.conn.send({ t: 'note', level: 'good', text: res.text });
        r.dirty = true;
        this.sendUpdate(r);
        return;
      }
      case 'speed': {
        if (!a.ready) return void a.conn.send({ t: 'err', code: 'no_hello', text: 'Say hello first.' });
        const r = this.running.get(a.user.id);
        if (!r) return;
        const res = r.sim.command({ t: 'speed', speed: msg.speed });
        if (!res.ok) return void a.conn.send({ t: 'err', code: res.code, text: res.text });
        r.dirty = true;
        if (msg.speed === 0) this.save(r, 'pause');
        r.acc = 0;
        this.sendUpdate(r);
        return;
      }
    }
  }

  private hello(a: Attached, v: number): void {
    if (a.ready) return;
    if (v !== PROTOCOL_VERSION) {
      a.conn.send({ t: 'err', code: 'bad_protocol', text: 'This client is out of date. Reload the page.' });
      a.conn.close(CLOSE_BAD_PROTOCOL, 'protocol mismatch');
      return;
    }
    if (a.helloTimer) clearTimeout(a.helloTimer);
    a.helloTimer = null;
    const village = this.ensureVillage(a.user.id);
    const sim = this.load(village);
    const r: Running = {
      village,
      sim,
      conn: a.conn,
      acc: 0,
      sinceView: 0,
      dirty: false,
      lastSaveAt: this.now(),
      known: new Set(),
      sent: { buildings: '', plots: '', stock: '', roster: '', orders: '' },
      watch: null,
      sheetAt: 0,
      rosterAt: 0,
    };
    this.running.set(a.user.id, r);
    a.ready = true;
    a.conn.send({ t: 'welcome', v: PROTOCOL_VERSION, user: { id: a.user.id, username: a.user.username }, village: { name: village.name, seed: village.seed } });
    sim.events();
    const view = sim.view();
    this.remember(r, view);
    a.conn.send({ t: 'view', view });
    this.log.info(`${a.user.username} entered ${village.name}`);
  }

  // ---- the tick loop --------------------------------------------------------------------------

  private tick(): void {
    const t = this.now();
    const real = Math.min(Math.max(0, t - this.lastTick), 1000);
    this.lastTick = t;
    const started = performance.now();
    for (const r of this.running.values()) {
      try {
        this.advance(r, real, t);
      } catch (err) {
        this.log.error(`village ${r.village.id}: tick failed`, err);
      }
    }
    const spent = performance.now() - started;
    this.tickAvgMs = this.tickAvgMs * 0.95 + spent * 0.05;
  }

  private advance(r: Running, real: number, t: number): void {
    const speed = r.sim.speed;
    if (speed > 0) {
      r.acc += real * speed;
      let steps = 0;
      while (r.acc >= SIM_STEP_MS && steps < MAX_STEPS_PER_TICK) {
        r.sim.step(SIM_STEP_MS);
        r.acc -= SIM_STEP_MS;
        steps++;
      }
      if (steps === MAX_STEPS_PER_TICK) r.acc = 0;
      if (steps > 0) r.dirty = true;
    }
    r.sinceView += real;
    if (r.sinceView >= 1000 / VIEW_HZ - TICK_MS / 2) {
      r.sinceView = 0;
      this.sendUpdate(r);
      if (r.watch !== null && t - r.sheetAt >= SHEET_EVERY_MS) this.sendSheet(r, t);
    }
    if (r.dirty && t - r.lastSaveAt >= this.config.autosaveMs) this.save(r, 'autosave');
  }

  // ---- views ---------------------------------------------------------------------------------------

  private remember(r: Running, view: VillageView): void {
    r.known = new Set(view.entities.map((e) => e.id));
    r.sent = { buildings: JSON.stringify(view.buildings), plots: JSON.stringify(view.plots), stock: JSON.stringify(view.stock), roster: JSON.stringify(view.roster), orders: JSON.stringify({ o: view.orders, w: view.wishes }) };
    r.rosterAt = this.now();
  }

  private sendUpdate(r: Running): void {
    const conn = r.conn;
    if (!conn || !conn.open) return;
    const v = r.sim.view();
    const ents: EntityUpdate[] = [];
    const add: EntityView[] = [];
    const seen = new Set<number>();
    for (const e of v.entities) {
      seen.add(e.id);
      if (!r.known.has(e.id)) add.push(e);
      ents.push({ id: e.id, x: e.x, y: e.y, nx: e.nx, ny: e.ny, step: e.step, route: e.route, face: e.face, state: e.state, act: e.act, carry: e.carry, hidden: e.hidden });
    }
    const del = [...r.known].filter((id) => !seen.has(id));
    r.known = seen;
    const msg: Extract<S2C, { t: 'upd' }> = { t: 'upd', time: v.time, speed: v.speed, population: v.population, ents };
    if (add.length) msg.add = add;
    if (del.length) msg.del = del;
    const b = JSON.stringify(v.buildings);
    if (b !== r.sent.buildings) (msg.buildings = v.buildings), (r.sent.buildings = b);
    const p = JSON.stringify(v.plots);
    if (p !== r.sent.plots) (msg.plots = v.plots), (r.sent.plots = p);
    const od = JSON.stringify({ o: v.orders, w: v.wishes });
    if (od !== r.sent.orders) {
      msg.orders = v.orders as OrderView[];
      msg.wishes = v.wishes as WishView[];
      r.sent.orders = od;
    }
    const s = JSON.stringify(v.stock);
    if (s !== r.sent.stock) (msg.stock = v.stock), (r.sent.stock = s);
    const t = this.now();
    if (t - r.rosterAt >= ROSTER_EVERY_MS) {
      r.rosterAt = t;
      const ro = JSON.stringify(v.roster);
      if (ro !== r.sent.roster) (msg.roster = v.roster as PersonBrief[]), (r.sent.roster = ro);
    }
    conn.send(msg);
    const lines: FeedEntry[] = [];
    for (const ev of r.sim.events()) if (ev.t === 'feed') lines.push({ ...ev.item });
    if (lines.length) conn.send({ t: 'feed', items: lines });
  }

  private sendSheet(r: Running, t: number): void {
    const conn = r.conn;
    if (!conn || !conn.open || r.watch === null) return;
    r.sheetAt = t;
    const sheet = r.sim.sheet(r.watch);
    conn.send({ t: 'sheet', sheet });
    if (!sheet) r.watch = null;
  }

  // ---- persistence --------------------------------------------------------------------------------------

  private save(r: Running, why: string): void {
    try {
      this.db.saveSnapshot(r.village.id, JSON.stringify(r.sim.serialize()), SNAPSHOT_VERSION, this.now());
      r.lastSaveAt = this.now();
      r.dirty = false;
      this.snapshots++;
      this.log.debug(`saved village ${r.village.id} (${why})`);
    } catch (err) {
      this.log.error(`village ${r.village.id}: snapshot failed (${why})`, err);
    }
  }
}
