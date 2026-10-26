import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@hearth/shared';
import { MAX_MESSAGE_BYTES, parseClientMessage } from './schemas';

const ok = (m: unknown) => parseClientMessage(JSON.stringify(m));

describe('client message validation', () => {
  it('accepts the M0 messages', () => {
    expect(ok({ t: 'hello', v: PROTOCOL_VERSION })).toEqual({ ok: true, msg: { t: 'hello', v: PROTOCOL_VERSION } });
    for (const speed of [0, 1, 2, 4]) expect(ok({ t: 'speed', speed })).toEqual({ ok: true, msg: { t: 'speed', speed } });
    expect(ok({ t: 'ping', n: 7 })).toEqual({ ok: true, msg: { t: 'ping', n: 7 } });
  });

  it('accepts watching a villager, or nobody', () => {
    expect(ok({ t: 'inspect', id: 7 })).toEqual({ ok: true, msg: { t: 'inspect', id: 7 } });
    expect(ok({ t: 'inspect', id: null })).toEqual({ ok: true, msg: { t: 'inspect', id: null } });
    for (const id of [-1, 1.5, '3', undefined, 2 ** 40]) expect(ok({ t: 'inspect', id }).ok, String(id)).toBe(false);
  });

  it('strips unknown fields', () => {
    expect(ok({ t: 'speed', speed: 2, admin: true })).toEqual({ ok: true, msg: { t: 'speed', speed: 2 } });
  });

  it('rejects bad speeds', () => {
    for (const speed of [3, 5, -1, 1.5, '2', null, undefined, 8, 0.5, NaN, Infinity]) expect(ok({ t: 'speed', speed }).ok, String(speed)).toBe(false);
  });

  it('rejects unknown types, wrong shapes and non-objects', () => {
    for (const m of [{ t: 'chat', text: 'hi' }, { t: 'hello' }, { t: 'hello', v: 'x' }, { t: 'ping', n: -1 }, { speed: 1 }, [], 5, null, 'speed', {}]) expect(ok(m).ok, JSON.stringify(m)).toBe(false);
  });

  it('rejects malformed JSON and oversize frames', () => {
    expect(parseClientMessage('{nope')).toMatchObject({ ok: false, error: 'not valid JSON' });
    expect(parseClientMessage('')).toMatchObject({ ok: false });
    expect(parseClientMessage(JSON.stringify({ t: 'ping', n: 1, pad: 'x'.repeat(MAX_MESSAGE_BYTES) }))).toMatchObject({ ok: false, error: 'message too large' });
  });

  it('survives prototype-pollution style input', () => {
    expect(ok(JSON.parse('{"t":"speed","speed":1,"__proto__":{"x":1}}')).ok).toBe(true);
    expect(({} as { x?: number }).x).toBeUndefined();
  });
});
