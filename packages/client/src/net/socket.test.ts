import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_BAD_PROTOCOL, CLOSE_REPLACED, PROTOCOL_VERSION, type S2C } from '@hearth/shared';
import { GameSocket, backoffDelay, closeReason, type SocketLike } from './socket';

class FakeWs implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
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
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  last(): { t: string; [k: string]: unknown } {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

describe('backoffDelay', () => {
  it('grows exponentially, is capped, and stays within +-25% jitter', () => {
    const mid = () => 0.5;
    expect(backoffDelay(0, 500, 15000, mid)).toBe(500);
    expect(backoffDelay(1, 500, 15000, mid)).toBe(1000);
    expect(backoffDelay(3, 500, 15000, mid)).toBe(4000);
    expect(backoffDelay(20, 500, 15000, mid)).toBe(15000);
    expect(backoffDelay(2, 500, 15000, () => 0)).toBe(1500);
    expect(backoffDelay(2, 500, 15000, () => 1)).toBe(2500);
  });
});

describe('GameSocket', () => {
  let sockets: FakeWs[];
  const make = (extra = {}) => {
    sockets = [];
    return new GameSocket({
      url: 'ws://test/ws',
      factory: () => {
        const w = new FakeWs();
        sockets.push(w);
        return w;
      },
      pingMs: 100000,
      ...extra,
    });
  };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects, says hello first, sends typed messages and routes S2C by type', () => {
    const s = make();
    const upds: number[] = [];
    s.on('upd', (m) => upds.push(m.population));
    s.connect();
    expect(s.send({ t: 'speed', speed: 2 })).toBe(false); // not open yet
    sockets[0].open();
    expect(s.isOpen).toBe(true);
    // The first frame on every connection is the handshake.
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ t: 'hello', v: PROTOCOL_VERSION });
    expect(s.send({ t: 'speed', speed: 4 })).toBe(true);
    expect(sockets[0].last()).toEqual({ t: 'speed', speed: 4 });
    sockets[0].receive({ t: 'upd', time: { hours: 6, day: 0, dayOfSeason: 1, season: 0, year: 0, weather: 'clear', hourMs: 15000 }, speed: 1, population: 12, ents: [] });
    expect(upds).toEqual([12]);
  });

  it('says hello again after a reconnect', () => {
    const s = make();
    s.connect();
    sockets[0].open();
    sockets[0].drop(1006);
    vi.advanceTimersByTime(2000);
    sockets[1].open();
    expect(JSON.parse(sockets[1].sent[0])).toEqual({ t: 'hello', v: PROTOCOL_VERSION });
  });

  it('reconnects with backoff after an unexpected close and resets the counter on open', () => {
    const s = make();
    const states: string[] = [];
    s.onState((i) => states.push(i.state));
    s.connect();
    sockets[0].open();
    sockets[0].drop(1006);
    expect(s.state.state).toBe('reconnecting');
    expect(s.state.retryIn).toBeGreaterThan(0);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(s.state).toMatchObject({ state: 'open', attempt: 0 });
    expect(states).toContain('reconnecting');
  });

  it('does not reconnect when the village was opened elsewhere or the client is out of date', () => {
    const s = make();
    s.connect();
    sockets[0].open();
    sockets[0].drop(CLOSE_REPLACED);
    expect(s.state).toMatchObject({ state: 'closed', reason: 'replaced' });
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);

    const k = make();
    k.connect();
    sockets[0].open();
    sockets[0].drop(CLOSE_BAD_PROTOCOL);
    expect(k.state).toMatchObject({ state: 'closed', reason: 'outdated' });
  });

  it('close() stops reconnecting for good and retryNow() skips the wait', () => {
    const s = make();
    s.connect();
    sockets[0].drop(1006);
    s.retryNow();
    expect(sockets).toHaveLength(2);
    s.close('logout');
    expect(s.state).toMatchObject({ state: 'closed', reason: 'logout' });
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(2);
  });

  it('ping/pong updates latency; garbage frames are ignored', () => {
    const s = make();
    s.connect();
    sockets[0].open();
    const ping = sockets[0].sent.map((x) => JSON.parse(x)).find((m) => m.t === 'ping');
    expect(ping).toBeTruthy();
    sockets[0].onmessage?.({ data: 'not json' });
    sockets[0].onmessage?.({ data: '{"nope":1}' });
    expect(s.latency).toBeNull();
    sockets[0].receive({ t: 'pong', n: ping.n });
    expect(s.latency).not.toBeNull();
  });

  it('maps close codes to reasons', () => {
    expect(closeReason(4001)).toBe('replaced');
    expect(closeReason(4005)).toBe('outdated');
    expect(closeReason(1006)).toBeNull();
  });
});
