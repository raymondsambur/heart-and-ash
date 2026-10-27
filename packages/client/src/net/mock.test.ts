import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type S2C } from '@hearth/shared';
import { installMock } from './mock';

describe('mock server', () => {
  it('answers the HTTP API like the real server', async () => {
    const { transport } = installMock({ seed: 5 });
    // localStorage does not exist in node: the mock still works, it just forgets.
    expect((await transport.request('GET', '/api/me')).status).toBe(401);
    expect((await transport.request('POST', '/api/register', { username: 'x', password: 'short' })).status).toBe(400);
    expect((await transport.request('GET', '/api/nope')).status).toBe(404);
  });

  it('speaks the socket protocol: hello, then welcome, view and updates', async () => {
    vi.useFakeTimers();
    const { socketFactory } = installMock({ seed: 5 });
    const ws = socketFactory('ws://mock');
    const got: S2C[] = [];
    ws.onmessage = (ev) => got.push(JSON.parse(String(ev.data)));
    vi.advanceTimersByTime(50);
    expect(ws.readyState).toBe(1);
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
    expect(got.map((m) => m.t)).toEqual(['welcome', 'view']);
    ws.send(JSON.stringify({ t: 'speed', speed: 4 }));
    expect(got.at(-1)).toMatchObject({ t: 'upd', speed: 4 });
    vi.advanceTimersByTime(1000);
    expect(got.filter((m) => m.t === 'upd').length).toBeGreaterThan(3);
    ws.close();
    vi.useRealTimers();
  });
});
