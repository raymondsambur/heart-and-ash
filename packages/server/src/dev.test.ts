/**
 * Dev mode on the host: the fast-forward, its progress, stopping it, undoing it, and the switch that keeps it off in production.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_SKIP_DAYS, PROTOCOL_VERSION, TICK_MS, type S2C } from '@hearth/shared';
import { loadConfig } from './config';
import { openDb, type Db, type UserRow } from './db';
import { VillageHost, type ClientConn } from './host';
import { nullLogger } from './log';
import { parseClientMessage } from './net/schemas';

let dir: string;
let db: Db;
let clock: number;
let user: UserRow;

class FakeConn implements ClientConn {
  open = true;
  sent: S2C[] = [];
  readonly ip = '127.0.0.1';
  constructor(readonly id: number) {}
  send(msg: S2C): void {
    this.sent.push(msg);
  }
  close(): void {
    this.open = false;
  }
  of<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] {
    return this.sent.filter((m): m is Extract<S2C, { t: T }> => m.t === t);
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-dev-'));
  db = openDb(path.join(dir, 'h.db'));
  clock = 1_000_000;
  user = db.createUser('dev', 'hash', 'salt', clock)!;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function make(devMode: boolean): VillageHost {
  const config = loadConfig({}, { dbPath: path.join(dir, 'h.db'), logLevel: 'silent', autosaveMs: 100_000, devMode });
  return new VillageHost(db, config, nullLogger, () => clock);
}

function enter(host: VillageHost) {
  const conn = new FakeConn(1);
  const att = host.attach(conn, user);
  host.receive(att, { t: 'hello', v: PROTOCOL_VERSION });
  return { conn, att };
}

/** Let real time pass, a tick at a time, until `done` or `max` ticks. */
function runUntil(host: VillageHost, done: () => boolean, max = 4000): void {
  for (let i = 0; i < max && !done(); i++) {
    clock += TICK_MS;
    (host as unknown as { tick(): void }).tick();
  }
}

const lastDev = (c: FakeConn) => c.of('dev').at(-1)!;
const dayOf = (c: FakeConn) => {
  const upd = c.of('upd').at(-1);
  return upd ? upd.time.day : c.of('view')[0].view.time.day;
};

describe('dev mode', () => {
  it('is on outside production and off in production unless asked for', () => {
    expect(loadConfig({}).devMode).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production' }).devMode).toBe(false);
    expect(loadConfig({ NODE_ENV: 'production', DEV_MODE: '1' }).devMode).toBe(true);
    expect(loadConfig({ DEV_MODE: '0' }).devMode).toBe(false);
  });

  it('refuses the dev messages, and does not offer them, when it is off', () => {
    const host = make(false);
    const { conn, att } = enter(host);
    expect(conn.of('welcome')[0].dev).toBeUndefined();
    expect(conn.of('dev')).toHaveLength(0);
    host.receive(att, { t: 'dev_skip', days: 5 });
    host.receive(att, { t: 'dev_undo' });
    expect(conn.of('err').map((e) => e.code)).toEqual(['dev_off', 'dev_off']);
    runUntil(host, () => false, 20);
    expect(dayOf(conn)).toBe(conn.of('view')[0].view.time.day);
  });

  it('runs the village days ahead in slices, reports the progress, and keeps the village alive', () => {
    const host = make(true);
    const { conn, att } = enter(host);
    expect(conn.of('welcome')[0].dev).toBe(true);
    expect(lastDev(conn)).toEqual({ t: 'dev', skip: null, undo: false });
    const day0 = conn.of('view')[0].view.time.day;
    host.receive(att, { t: 'dev_skip', days: 3 });
    expect(lastDev(conn).skip).toEqual({ left: 3, total: 3 });
    expect(lastDev(conn).undo).toBe(true);
    runUntil(host, () => lastDev(conn).skip === null);
    expect(lastDev(conn)).toEqual({ t: 'dev', skip: null, undo: true });
    expect(dayOf(conn)).toBeGreaterThanOrEqual(day0 + 3);
    expect(conn.of('dev').some((m) => m.skip !== null && m.skip.left < 3)).toBe(true);
    expect(conn.of('note').some((n) => n.text.startsWith('Fast-forwarded 3'))).toBe(true);
    // the result is saved
    expect(db.getVillage(user.id)!.snapshot).toContain('"totalMs"');
  });

  it('can be stopped part of the way, and a second ask adds to the first', () => {
    const host = make(true);
    const { conn, att } = enter(host);
    host.receive(att, { t: 'dev_skip', days: 30 });
    host.receive(att, { t: 'dev_skip', days: 10 });
    expect(lastDev(conn).skip).toEqual({ left: 40, total: 40 });
    runUntil(host, () => (lastDev(conn).skip?.left ?? 99) < 39, 50);
    host.receive(att, { t: 'dev_skip', days: 0 });
    expect(lastDev(conn).skip).toBeNull();
    const day = dayOf(conn);
    runUntil(host, () => false, 20);
    expect(dayOf(conn)).toBe(day);
    expect(conn.of('note').some((n) => n.text.startsWith('Fast-forward stopped'))).toBe(true);
  });

  it('undoes the last skip: the village is back as it was and the client is sent it whole', () => {
    const host = make(true);
    const { conn, att } = enter(host);
    const before = conn.of('view')[0].view;
    host.receive(att, { t: 'dev_skip', days: 2 });
    runUntil(host, () => lastDev(conn).skip === null);
    expect(dayOf(conn)).toBeGreaterThanOrEqual(before.time.day + 2);
    host.receive(att, { t: 'dev_undo' });
    const views = conn.of('view');
    expect(views).toHaveLength(2);
    expect(views[1].view.time.day).toBe(before.time.day);
    expect(views[1].view.population).toBe(before.population);
    expect(lastDev(conn)).toEqual({ t: 'dev', skip: null, undo: false });
    // nothing more to undo
    host.receive(att, { t: 'dev_undo' });
    expect(conn.of('err').at(-1)!.code).toBe('no_backup');
    // and the village goes on from there
    host.receive(att, { t: 'speed', speed: 4 });
    runUntil(host, () => false, 30);
    expect(dayOf(conn)).toBeGreaterThanOrEqual(before.time.day);
  });
});

describe('the dev messages', () => {
  it('are checked: whole days from 0 to the cap', () => {
    for (const days of [0, 1, 50, MAX_SKIP_DAYS]) expect(parseClientMessage(JSON.stringify({ t: 'dev_skip', days })), String(days)).toEqual({ ok: true, msg: { t: 'dev_skip', days } });
    for (const days of [-1, 1.5, MAX_SKIP_DAYS + 1, '5', null, undefined, NaN]) expect(parseClientMessage(JSON.stringify({ t: 'dev_skip', days })).ok, String(days)).toBe(false);
    expect(parseClientMessage(JSON.stringify({ t: 'dev_undo' }))).toEqual({ ok: true, msg: { t: 'dev_undo' } });
  });
});
