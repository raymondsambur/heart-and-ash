/**
 * The village host with a fake clock and fake connections: what happens to a village while its manager is away
 * (keeps living at 1x, the cap, the report on return, the rules doing the managing).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_REPLACED, GAME_HOUR_MS, PROTOCOL_VERSION, TICK_MS, type S2C } from '@hearth/shared';
import { loadConfig } from './config';
import { openDb, type Db, type UserRow } from './db';
import { VillageHost, type ClientConn } from './host';
import { nullLogger } from './log';

let dir: string;
let db: Db;
let clock: number;
let user: UserRow;

class FakeConn implements ClientConn {
  open = true;
  sent: S2C[] = [];
  closed: [number, string] | null = null;
  constructor(readonly id: number) {}
  readonly ip = '127.0.0.1';
  send(msg: S2C): void {
    this.sent.push(msg);
  }
  close(code: number, reason: string): void {
    this.open = false;
    this.closed = [code, reason];
  }
  of<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] {
    return this.sent.filter((m): m is Extract<S2C, { t: T }> => m.t === t);
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-host-'));
  db = openDb(path.join(dir, 'h.db'));
  clock = 1_000_000;
  user = db.createUser('manager', 'hash', 'salt', clock)!;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function make(awayCapHours: number): VillageHost {
  const config = loadConfig({}, { dbPath: path.join(dir, 'h.db'), logLevel: 'silent', autosaveMs: 100_000, awayCapHours });
  return new VillageHost(db, config, nullLogger, () => clock);
}

/** Enter the village and say hello. */
function enter(host: VillageHost, id: number): { conn: FakeConn; att: ReturnType<VillageHost['attach']> } {
  const conn = new FakeConn(id);
  const att = host.attach(conn, user);
  host.receive(att, { t: 'hello', v: PROTOCOL_VERSION });
  return { conn, att };
}

/** Let `ms` of real time pass, in ticks. */
function pass(host: VillageHost, ms: number): void {
  for (let t = 0; t < ms; t += TICK_MS) {
    clock += TICK_MS;
    (host as unknown as { tick(): void }).tick();
  }
}

describe('a village while its manager is away', () => {
  it('keeps living at 1x after the manager leaves, and writes the report when they come back', () => {
    const host = make(8);
    const a = enter(host, 1);
    host.receive(a.att, { t: 'speed', speed: 4 });
    const view = a.conn.of('view')[0].view;
    expect(view.policy.away).toBe(false);
    const day0 = view.time.day;
    host.disconnect(a.conn);
    expect(host.stats().running).toBe(1);
    // an hour of game time at 1x is 15 s of real time x 60 = 900 s; use a shorter stretch and check that the clock moved at 1x, not 4x
    const before = (host as unknown as { running: Map<number, { sim: { inspect(): { totalMs: number } } }> }).running.get(user.id)!.sim.inspect().totalMs;
    pass(host, 20_000);
    const after = (host as unknown as { running: Map<number, { sim: { inspect(): { totalMs: number } } }> }).running.get(user.id)!.sim.inspect().totalMs;
    expect(after - before).toBeGreaterThan(18_000);
    expect(after - before).toBeLessThan(22_000);
    const b = enter(host, 2);
    const back = b.conn.of('view')[0].view;
    expect(back.policy.away).toBe(false);
    const away = back.reports.filter((r) => r.kind === 'away');
    expect(away).toHaveLength(1);
    expect(away[0].unread).toBe(true);
    expect(back.time.day).toBeGreaterThanOrEqual(day0);
    host.shutdown();
  });

  it('lets the rules manage while away: a rule set before leaving acts on its own', () => {
    const host = make(8);
    const a = enter(host, 1);
    host.receive(a.att, { t: 'rule', rule: { id: 0, enabled: true, cond: { metric: 'foodDays', op: '<', value: 1000 }, act: { t: 'ration', level: 1 } } });
    expect(a.conn.of('err')).toHaveLength(0);
    host.receive(a.att, { t: 'priority', group: 'wood', level: 4 });
    host.disconnect(a.conn);
    // the rules run once a game hour: 15 s of real time at 1x
    pass(host, GAME_HOUR_MS * 2 + 1000);
    const b = enter(host, 2);
    const v = b.conn.of('view')[0].view;
    expect(v.status.rationing).toBe(1);
    expect(v.policy.priorities[1]).toBe(4);
    expect(v.policy.rules).toHaveLength(1);
    expect(v.feed.some((f) => f.kind === 'rule' && f.text.includes('while you were away'))).toBe(true);
    host.shutdown();
  });

  it('stops at the cap: the village waits (paused) and is let go from memory, and the report is there on return from the save', () => {
    const host = make(1);
    const a = enter(host, 1);
    host.disconnect(a.conn);
    pass(host, 5000);
    expect(host.stats().running).toBe(1);
    clock += 3_600_000;
    pass(host, TICK_MS * 2);
    expect(host.stats().running).toBe(0);
    const b = enter(host, 2);
    const v = b.conn.of('view')[0].view;
    expect(v.speed).toBe(0);
    expect(v.policy.away).toBe(false);
    expect(v.reports.filter((r) => r.kind === 'away')).toHaveLength(1);
    host.shutdown();
  });

  it('picks up a village that was away when the server stopped, and lets one that was paused wait', () => {
    const first = make(8);
    const a = enter(first, 1);
    first.disconnect(a.conn);
    first.shutdown();
    const second = make(8);
    second.start();
    expect(second.stats().running).toBe(1);
    pass(second, 3000);
    const b = enter(second, 2);
    expect(b.conn.of('view')[0].view.reports.filter((r) => r.kind === 'away')).toHaveLength(1);
    // paused before leaving: nothing to resume
    const c = enter(second, 3);
    second.receive(c.att, { t: 'speed', speed: 0 });
    second.disconnect(c.conn);
    second.shutdown();
    const third = make(8);
    third.start();
    expect(third.stats().running).toBe(0);
    third.shutdown();
  });

  it('is off with an away cap of zero: the village is saved and let go at once', () => {
    const host = make(0);
    const a = enter(host, 1);
    host.disconnect(a.conn);
    expect(host.stats().running).toBe(0);
    host.shutdown();
  });

  it('is not kept when the same account logs in somewhere else', () => {
    const host = make(8);
    const a = enter(host, 1);
    const b = enter(host, 2);
    expect(a.conn.closed?.[0]).toBe(CLOSE_REPLACED);
    expect(b.conn.of('view')).toHaveLength(1);
    expect(host.stats().running).toBe(1);
    host.shutdown();
  });

  it('answers decisions and marks reports as read through the socket', () => {
    const host = make(8);
    const a = enter(host, 1);
    host.receive(a.att, { t: 'answer', offer: 999, option: 'accept' });
    expect(a.conn.of('err').some((e) => e.code === 'no_offer')).toBe(true);
    host.receive(a.att, { t: 'read', report: 1 });
    host.receive(a.att, { t: 'rule_del', id: 5 });
    expect(a.conn.of('err').some((e) => e.code === 'no_rule')).toBe(true);
    host.shutdown();
  });
});
