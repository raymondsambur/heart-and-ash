/**
 * End-to-end test against the real server: Fastify + ws + SQLite (a temp file) with clients speaking the actual
 * HTTP and WebSocket protocol: register, log in, connect, change speed, restart the server, village identical.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { CLOSE_REPLACED, GAME_HOUR_MS, canPlace, PROTOCOL_VERSION, TICK_MS, type C2S, type EntityView, type MeResponse, type S2C, type TimeView, type WorldPayload } from '@hearth/shared';
import { SNAPSHOT_VERSION } from '@hearth/sim';
import { AuthService, SESSION_COOKIE } from './auth';
import { nullLogger } from './log';
import { startServer, type RunningServer } from './server';

let dir: string;
let server: RunningServer;
let base: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, timeoutMs = 4000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

async function boot(): Promise<RunningServer> {
  const s = await startServer({
    env: {},
    config: { port: 0, host: '127.0.0.1', dbPath: path.join(dir, 'hearth.db'), logLevel: 'silent', autosaveMs: 200, staticDir: path.join(dir, 'no-client') },
    log: nullLogger,
  });
  base = `http://127.0.0.1:${s.port}`;
  return s;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface Http<T = unknown> {
  status: number;
  body: T;
  cookie?: string;
}

async function http<T = unknown>(method: string, url: string, opts: { body?: unknown; cookie?: string; raw?: string } = {}): Promise<Http<T>> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: string | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
    headers['content-type'] = 'application/json';
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(base + url, { method, headers, body });
  } catch {
    // A pooled keep-alive socket can be dead after a server restart.
    res = await fetch(base + url, { method, headers, body });
  }
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  const set = res.headers.getSetCookie().find((c) => c.startsWith('hearth_session='));
  return { status: res.status, body: parsed as T, cookie: set ? set.split(';')[0] : undefined };
}

/** Creates an account straight through the auth service (the HTTP register route is rate limited per IP) and returns its cookie. */
async function signup(name: string): Promise<string> {
  const out = await new AuthService(server.db, server.config).register(name, 'a-good-password');
  if (!out.ok) throw new Error(out.error);
  return `${SESSION_COOKIE}=${out.token}`;
}

// ---------------------------------------------------------------------------
// A websocket client that records everything it receives
// ---------------------------------------------------------------------------

class Bot {
  readonly msgs: S2C[] = [];
  closeCode: number | null = null;
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString()) as S2C));
    ws.on('close', (code) => (this.closeCode = code));
  }

  static async connect(cookie: string): Promise<Bot> {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } });
    const bot = new Bot(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return bot;
  }

  send(msg: C2S | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  of<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] {
    return this.msgs.filter((m): m is Extract<S2C, { t: T }> => m.t === t);
  }

  last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | undefined {
    return this.of(t).at(-1);
  }

  /** Enter the village: say hello and wait for the full view. */
  async enter(): Promise<Extract<S2C, { t: 'view' }>> {
    this.send({ t: 'hello', v: PROTOCOL_VERSION });
    await until(() => this.of('view').length > 0, 4000, 'view');
    return this.of('view')[0];
  }

  async close(): Promise<void> {
    if (this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
      await until(() => this.closeCode !== null, 3000, 'socket close');
    }
  }
}

const gameMs = (t: TimeView): number => (t.day * 24 + t.hours) * GAME_HOUR_MS;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-it-'));
  server = await boot();
});

afterAll(async () => {
  await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('http', () => {
  it('serves health', async () => {
    const r = await http<{ ok: boolean; online: number }>('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, online: 0 });
  });

  it('registers, rejects bad input, logs in and out', async () => {
    const reg = await http<MeResponse>('POST', '/api/register', { body: { username: 'Alice_1', password: 'a-good-password' } });
    expect(reg.status).toBe(201);
    expect(reg.body.user.username).toBe('Alice_1');
    expect(reg.body.village.name).toMatch(/\w+ \w+/);
    expect(reg.cookie).toMatch(/^hearth_session=/);

    expect((await http('POST', '/api/register', { body: { username: 'alice_1', password: 'a-good-password' } })).status).toBe(409);
    expect((await http('POST', '/api/register', { body: { username: 'x', password: 'a-good-password' } })).status).toBe(400);
    expect((await http('POST', '/api/register', { body: { username: 'Bob_2', password: 'short' } })).status).toBe(400);
    expect((await http('POST', '/api/register', { raw: '{not json' })).status).toBe(400);
    expect((await http('POST', '/api/login', { body: { username: 'Alice_1', password: 'wrong-password' } })).status).toBe(401);

    const login = await http<MeResponse>('POST', '/api/login', { body: { username: 'ALICE_1', password: 'a-good-password' } });
    expect(login.status).toBe(200);
    // One village per account: the same village comes back.
    expect(login.body.village).toEqual(reg.body.village);

    expect((await http('GET', '/api/me')).status).toBe(401);
    const me = await http<MeResponse>('GET', '/api/me', { cookie: login.cookie });
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('Alice_1');

    const out = await http('POST', '/api/logout', { cookie: login.cookie });
    expect(out.status).toBe(200);
    expect((await http('GET', '/api/me', { cookie: login.cookie })).status).toBe(401);
  });

  it('serves the village map to its owner only', async () => {
    expect((await http('GET', '/api/world')).status).toBe(401);
    const cookie = await signup('Mapper');
    const r = await http<WorldPayload>('GET', '/api/world', { cookie });
    expect(r.status).toBe(200);
    expect(r.body.w).toBe(96);
    expect(r.body.h).toBe(96);
    for (const grid of [r.body.terrain, r.body.objects, r.body.blight]) expect(Buffer.from(grid, 'base64').length).toBe(96 * 96);
  });
});

describe('websocket', () => {
  it('refuses a connection without a session', async () => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const status = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => resolve(-1));
    });
    expect(status).toBe(401);
  });

  it('sends welcome and the full view after hello', async () => {
    const cookie = await signup('Viewer');
    const bot = await Bot.connect(cookie);
    const view = await bot.enter();
    const welcome = bot.last('welcome')!;
    expect(welcome).toMatchObject({ v: PROTOCOL_VERSION, user: { username: 'Viewer' } });
    expect(view.view.population).toBe(12);
    expect(view.view.entities).toHaveLength(12);
    expect(view.view.buildings.length).toBeGreaterThanOrEqual(6);
    expect(view.view.plots).toHaveLength(2);
    expect(view.view.speed).toBe(1);
    expect(view.view.time.season).toBe(0);
    expect(Object.keys(view.view.stock).length).toBeGreaterThan(0);
    // Updates follow about five times a second.
    await until(() => bot.of('upd').length >= 3, 3000, 'updates');
    const upd = bot.of('upd')[0];
    expect(upd.ents).toHaveLength(12);
    expect(upd.buildings).toBeUndefined();
    await bot.close();
  });

  it('sends the villager list, a watched villager sheet about once a second, and the feed', async () => {
    const bot = await Bot.connect(await signup('Watcher'));
    const { view } = await bot.enter();
    expect(view.roster).toHaveLength(12);
    const id = view.roster[0].id;
    bot.send({ t: 'inspect', id });
    await until(() => bot.of('sheet').length >= 1, 3000, 'a sheet');
    const sheet = bot.of('sheet')[0].sheet!;
    expect(sheet.id).toBe(id);
    expect(sheet.needs).toHaveLength(7);
    expect(sheet.why.goal.length).toBeGreaterThan(0);
    // Then about one a second while watched.
    await until(() => bot.of('sheet').length >= 3, 4000, 'repeated sheets');
    // Stop watching: no more sheets.
    bot.send({ t: 'inspect', id: null });
    await sleep(TICK_MS * 3);
    const n = bot.of('sheet').length;
    await sleep(1300);
    expect(bot.of('sheet').length).toBe(n);
    // Somebody who is not there gets a null sheet once.
    bot.send({ t: 'inspect', id: 99999 });
    await until(() => bot.of('sheet').some((m) => m.sheet === null), 3000, 'an empty sheet');
    await bot.close();
  });

  it('takes build and cancel orders, refuses bad ones with a reason, and sends the order list', async () => {
    const cookie = await signup('Builder');
    const bot = await Bot.connect(cookie);
    const { view } = await bot.enter();
    const wr = (await http<WorldPayload>('GET', '/api/world', { cookie })).body;
    const dec = (b: string): Uint8Array => new Uint8Array(Buffer.from(b, 'base64'));
    const world = { w: wr.w, h: wr.h, terrain: dec(wr.terrain), objects: dec(wr.objects), blight: dec(wr.blight), start: { center: wr.center } };
    const pw = { world, buildings: view.buildings, plots: view.plots };
    let spot: { x: number; y: number } | null = null;
    for (let r = 6; r < 20 && !spot; r++)
      for (let dx = -r; dx <= r && !spot; dx++) if (canPlace(pw, 'house', wr.center.x + dx, wr.center.y + r).ok) spot = { x: wr.center.x + dx, y: wr.center.y + r };
    expect(spot).not.toBeNull();
    bot.send({ t: 'build', kind: 'house', x: spot!.x, y: spot!.y });
    await until(() => bot.of('upd').some((u) => (u.orders?.length ?? 0) === 1), 3000, 'the order in an update');
    expect(bot.of('note').some((n) => /ordered/i.test(n.text))).toBe(true);
    const upd = bot.of('upd').find((u) => u.orders?.length === 1)!;
    expect(upd.orders![0]).toMatchObject({ kind: 'house', mode: 'build', done: 0, x: spot!.x, y: spot!.y });
    expect(upd.buildings!.find((b) => b.x === spot!.x && b.y === spot!.y)?.con).toMatchObject({ mode: 'build', done: 0 });
    // the same spot again, and the edge of the map: refused with a reason
    bot.send({ t: 'build', kind: 'house', x: spot!.x, y: spot!.y });
    bot.send({ t: 'build', kind: 'house', x: 0, y: 0 });
    await until(() => bot.of('err').length >= 2, 3000, 'two refusals');
    expect(bot.of('err').every((e) => e.text.length > 10)).toBe(true);
    // an order nobody has touched goes away when cancelled
    bot.send({ t: 'cancel', order: upd.orders![0].id });
    await until(() => bot.of('upd').some((u) => u.orders !== undefined && u.orders.length === 0), 3000, 'the order list empty');
    // a message the schema does not know is refused
    bot.send({ t: 'build', kind: 'castle', x: 5, y: 5 });
    await until(() => bot.of('err').some((e) => e.code === 'bad_message'), 3000, 'bad_message');
    await bot.close();
  });

  it('validates every client message', async () => {
    const cookie = await signup('Fuzzer');
    const bot = await Bot.connect(cookie);
    // Speed before hello is refused.
    bot.send({ t: 'speed', speed: 2 });
    await until(() => bot.of('err').length >= 1, 2000, 'err');
    expect(bot.of('err')[0].code).toBe('no_hello');
    await bot.enter();
    for (const bad of [{ t: 'speed', speed: 3 }, { t: 'speed' }, { t: 'nope' }, { t: 'speed', speed: '2' }]) bot.send(bad);
    bot.ws.send('{broken');
    bot.ws.send(Buffer.from([1, 2, 3]));
    await until(() => bot.of('err').filter((e) => e.code === 'bad_message').length >= 6, 3000, 'bad_message errors');
    // The village is untouched.
    expect(bot.last('upd')?.speed ?? 1).toBe(1);
    await bot.close();
  });

  it('closes a client that speaks another protocol version', async () => {
    const cookie = await signup('Oldclient');
    const bot = await Bot.connect(cookie);
    bot.send({ t: 'hello', v: PROTOCOL_VERSION + 1 });
    await until(() => bot.closeCode !== null, 3000, 'close');
    expect(bot.of('err')[0].code).toBe('bad_protocol');
    expect(bot.of('view')).toHaveLength(0);
  });

  it('answers pings', async () => {
    const bot = await Bot.connect(await signup('Pinger'));
    bot.send({ t: 'ping', n: 41 });
    await until(() => bot.of('pong').length === 1);
    expect(bot.of('pong')[0].n).toBe(41);
    await bot.close();
  });

  it('lets a second login take over the village', async () => {
    const cookie = await signup('Twice');
    const a = await Bot.connect(cookie);
    await a.enter();
    const b = await Bot.connect(cookie);
    await b.enter();
    await until(() => a.closeCode !== null, 3000, 'first socket closed');
    expect(a.closeCode).toBe(CLOSE_REPLACED);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);
    await b.close();
  });

  it('changes speed end to end: pause freezes the village, 4x runs faster than 1x', async () => {
    const cookie = await signup('Timekeeper');
    const bot = await Bot.connect(cookie);
    const { view } = await bot.enter();
    const t0 = gameMs(view.time);

    // 1x for about a second of real time.
    await until(() => bot.of('upd').length >= 6, 3000);
    const at1 = gameMs(bot.last('upd')!.time) - t0;
    expect(at1).toBeGreaterThan(300);
    expect(at1).toBeLessThan(2500);

    // 4x.
    bot.send({ t: 'speed', speed: 4 });
    await until(() => bot.last('upd')?.speed === 4, 2000, 'speed 4');
    const a = gameMs(bot.last('upd')!.time);
    const startedAt = Date.now();
    await sleep(1000);
    await until(() => bot.of('upd').length > 0 && Date.now() - startedAt >= 1000);
    const b = gameMs(bot.last('upd')!.time);
    const per4 = (b - a) / ((Date.now() - startedAt) / 1000);
    expect(per4).toBeGreaterThan(2000);
    expect(per4).toBeLessThan(6000);

    // Pause: the clock and the people stop.
    bot.send({ t: 'speed', speed: 0 });
    await until(() => bot.last('upd')?.speed === 0, 2000, 'pause');
    await sleep(2 * TICK_MS * 3);
    const frozen = bot.last('upd')!;
    const n = bot.of('upd').length;
    await until(() => bot.of('upd').length >= n + 4, 2000);
    const later = bot.last('upd')!;
    expect(gameMs(later.time)).toBe(gameMs(frozen.time));
    expect(JSON.stringify(later.ents)).toBe(JSON.stringify(frozen.ents));
    await bot.close();
  });
});

describe('persistence', () => {
  it('survives a server restart with the village intact', async () => {
    const cookie = await signup('Survivor');
    const bot = await Bot.connect(cookie);
    const { view } = await bot.enter();
    const ids = view.entities.map((e) => e.id);

    // Let the village live for a bit at 4x, then pause it.
    bot.send({ t: 'speed', speed: 4 });
    await until(() => (bot.last('upd')?.time ? gameMs(bot.last('upd')!.time) - gameMs(view.time) > 20_000 : false), 8000, 'some game time to pass');
    bot.send({ t: 'speed', speed: 0 });
    await until(() => bot.last('upd')?.speed === 0, 2000, 'pause');
    await sleep(TICK_MS * 3);
    const before = bot.last('upd')!;
    // The stock the player last saw: the first view, then any update that carried a new one.
    const stockSeen = [...bot.of('upd')].reverse().find((u) => u.stock)?.stock ?? view.stock;
    await bot.close();
    // The disconnect wrote a snapshot.
    const row = server.db.getVillage(server.db.getUserByName('Survivor')!.id)!;
    expect(row.snapshot).toBeTruthy();
    expect(row.snapshotVersion).toBe(SNAPSHOT_VERSION);
    expect(row.savedAt).toBeGreaterThan(0);

    await server.close();
    server = await boot();

    const login = await http<MeResponse>('POST', '/api/login', { body: { username: 'Survivor', password: 'a-good-password' } });
    expect(login.status).toBe(200);
    const again = await Bot.connect(login.cookie!);
    const after = (await again.enter()).view;

    expect(after.speed).toBe(0);
    expect(after.time).toEqual(before.time);
    expect(after.entities.map((e) => e.id)).toEqual(ids);
    const byId = new Map<number, EntityView>(after.entities.map((e) => [e.id, e]));
    for (const e of before.ents) {
      const f = byId.get(e.id)!;
      expect({ x: f.x, y: f.y, nx: f.nx, ny: f.ny, step: f.step, face: f.face, state: f.state, act: f.act }).toEqual({ x: e.x, y: e.y, nx: e.nx, ny: e.ny, step: e.step, face: e.face, state: e.state, act: e.act });
    }
    expect(after.buildings.length).toBe(view.buildings.length);
    expect(after.stock).toEqual(stockSeen);

    // And it carries on from there.
    again.send({ t: 'speed', speed: 2 });
    await until(() => again.last('upd')?.speed === 2, 2000, 'speed 2');
    await until(() => gameMs(again.last('upd')!.time) > gameMs(after.time) + 500, 4000, 'time to advance');
    await again.close();
  });

  it('saves a running village periodically, not only on disconnect', async () => {
    const cookie = await signup('Autosaver');
    const bot = await Bot.connect(cookie);
    await bot.enter();
    const id = server.db.getUserByName('Autosaver')!.id;
    await until(() => (server.db.getVillage(id)?.savedAt ?? 0) > 0, 3000, 'an autosave while connected');
    expect(server.villages.stats().running).toBeGreaterThanOrEqual(1);
    await bot.close();
    expect(server.villages.stats().running).toBe(0);
  });
});
