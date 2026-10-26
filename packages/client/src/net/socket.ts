/**
 * Typed WebSocket client: `send(C2S)`, per-message-type listeners, the hello handshake, reconnect with
 * exponential backoff and ping/pong latency. (The old game's request/response queries are not needed here.)
 */
import { CLOSE_BAD_PROTOCOL, CLOSE_REPLACED, PROTOCOL_VERSION, WS_PATH, type C2S, type S2C } from '@hearth/shared';

/** Minimal surface of the browser WebSocket we use (the mock server provides a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export const browserSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

export function defaultSocketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${WS_PATH}`;
}

const OPEN = 1;

/** Reconnect delay for attempt n (0-based): exponential with +-25% jitter, capped. */
export function backoffDelay(attempt: number, base = 500, max = 15000, rand: () => number = Math.random): number {
  const raw = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  return Math.round(raw * (0.75 + rand() * 0.5));
}

export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
/** Why the socket closed for good: another login took the village, the session ended, the client is out of date, or we closed it. */
export type CloseReason = 'replaced' | 'auth' | 'outdated' | 'logout';

export interface ConnInfo {
  state: ConnState;
  attempt: number;
  /** Delay before the next reconnect attempt, ms. */
  retryIn?: number;
  reason?: CloseReason;
  code?: number;
}

type Handler<T extends S2C['t']> = (msg: Extract<S2C, { t: T }>) => void;

export interface GameSocketOptions {
  url?: string;
  factory?: SocketFactory;
  pingMs?: number;
  /** Give up reconnecting after this many attempts (default: never). */
  maxAttempts?: number;
}

export class GameSocket {
  private ws: SocketLike | null = null;
  private handlers = new Map<string, Set<(msg: S2C) => void>>();
  private stateHandlers = new Set<(info: ConnInfo) => void>();
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private info: ConnInfo = { state: 'idle', attempt: 0 };
  private readonly url: string;
  private readonly factory: SocketFactory;
  private readonly pingMs: number;
  private readonly maxAttempts: number;
  private pingSeq = 0;
  private pingSentAt = new Map<number, number>();

  /** Round-trip latency of the last ping, ms. */
  latency: number | null = null;

  constructor(opts: GameSocketOptions = {}) {
    this.url = opts.url ?? defaultSocketUrl();
    this.factory = opts.factory ?? browserSocketFactory;
    this.pingMs = opts.pingMs ?? 5000;
    this.maxAttempts = opts.maxAttempts ?? Infinity;
  }

  get state(): ConnInfo {
    return this.info;
  }

  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === OPEN && this.info.state === 'open';
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  /** Close for good (logout / screen teardown). */
  close(reason: CloseReason = 'logout'): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      try {
        ws.close(1000, reason);
      } catch {
        /* ignore */
      }
    }
    this.setState({ state: 'closed', attempt: 0, reason });
  }

  /** Force an immediate reconnect attempt (used by the "Retry now" button). */
  retryNow(): void {
    if (this.stopped || this.info.state === 'open' || this.info.state === 'connecting') return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.open();
  }

  send(msg: C2S): boolean {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  on<T extends S2C['t']>(t: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    const h = fn as (msg: S2C) => void;
    set.add(h);
    return () => set!.delete(h);
  }

  onState(fn: (info: ConnInfo) => void): () => void {
    this.stateHandlers.add(fn);
    return () => this.stateHandlers.delete(fn);
  }

  // -------------------------------------------------------------------------

  private setState(info: ConnInfo): void {
    this.info = info;
    for (const fn of this.stateHandlers) fn(info);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private open(): void {
    this.clearTimers();
    this.setState({ state: this.attempt === 0 ? 'connecting' : 'reconnecting', attempt: this.attempt });
    let ws: SocketLike;
    try {
      ws = this.factory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.setState({ state: 'open', attempt: 0 });
      // The handshake: the server answers with `welcome` and then the whole village in a `view`.
      this.send({ t: 'hello', v: PROTOCOL_VERSION });
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), this.pingMs);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.receive(ev.data);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.stopped) return;
      const reason = closeReason(ev.code);
      if (reason) {
        this.stopped = true;
        this.setState({ state: 'closed', attempt: 0, reason, code: ev.code });
        return;
      }
      this.scheduleReconnect(ev.code);
    };
  }

  private scheduleReconnect(code?: number): void {
    if (this.attempt >= this.maxAttempts) {
      this.stopped = true;
      this.setState({ state: 'closed', attempt: this.attempt, code });
      return;
    }
    const delay = backoffDelay(this.attempt);
    this.attempt++;
    this.setState({ state: 'reconnecting', attempt: this.attempt, retryIn: delay, code });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private ping(): void {
    const n = ++this.pingSeq;
    this.pingSentAt.set(n, performance.now());
    if (this.pingSentAt.size > 8) this.pingSentAt.delete(this.pingSentAt.keys().next().value!);
    this.send({ t: 'ping', n });
  }

  private receive(data: unknown): void {
    let msg: S2C;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data)) as S2C;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
    if (msg.t === 'pong') {
      const sent = this.pingSentAt.get(msg.n);
      if (sent !== undefined) {
        this.latency = Math.max(0, Math.round(performance.now() - sent));
        this.pingSentAt.delete(msg.n);
      }
    }
    const set = this.handlers.get(msg.t);
    if (set) for (const fn of set) fn(msg);
  }
}

export function closeReason(code: number): CloseReason | null {
  if (code === CLOSE_REPLACED) return 'replaced';
  if (code === CLOSE_BAD_PROTOCOL) return 'outdated';
  return null;
}
