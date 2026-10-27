/**
 * HTTP API (Fastify 5): accounts, the static world payload, health, and the
 * built client (with SPA fallback). The websocket shares the underlying `app.server`
 * (see net/gateway.ts).
 *
 * Errors are always `{error: string}` with a meaningful status; internals are never leaked.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { generateWorld, type MeResponse, type WorldData, type WorldPayload } from '@hearth/shared';
import { SESSION_COOKIE, parseCookies, type AuthService, type SessionInfo } from './auth';
import type { Config } from './config';
import type { Db, UserRow } from './db';
import type { VillageHost } from './host';
import type { Logger } from './log';
import { clientIp, originAllowed } from './net/ip';
import { WindowLimiter } from './net/ratelimit';

export const REGISTER_LIMIT_PER_MIN = 10;
export const LOGIN_LIMIT_PER_MIN = 10;
export const API_LIMIT_PER_MIN = 240;
export const BODY_LIMIT_BYTES = 8 * 1024;

export interface HealthInfo {
  ok: true;
  uptimeSec: number;
  online: number;
  running: number;
  tickMs: number;
}

export interface HttpDeps {
  config: Config;
  db: Db;
  auth: AuthService;
  host: VillageHost;
  log: Logger;
  now: () => number;
  health: () => HealthInfo;
}

// ---------------------------------------------------------------------------
// Static world payload (identical for every client of one village)
// ---------------------------------------------------------------------------

export interface WorldBlob {
  json: Buffer;
  gzip: Buffer;
  etag: string;
}

export function buildWorldPayload(world: WorldData): WorldPayload {
  const b64 = (a: Uint8Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
  return { seed: world.seed, w: world.w, h: world.h, terrain: b64(world.terrain), objects: b64(world.objects), blight: b64(world.blight), center: { ...world.start.center } };
}

export function buildWorldBlob(world: WorldData): WorldBlob {
  const json = Buffer.from(JSON.stringify(buildWorldPayload(world)));
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 16);
  return { json, gzip: zlib.gzipSync(json, { level: 9 }), etag: `"w${world.seed}-${hash}"` };
}

/** Maps are rebuilt per seed on demand; a handful are kept so repeat loads are free. */
class WorldBlobCache {
  private readonly blobs = new Map<string, WorldBlob>();
  constructor(private readonly max = 16) {}
  get(seed: number, size = 96): WorldBlob {
    const key = `${seed}:${size}`;
    let b = this.blobs.get(key);
    if (b) {
      this.blobs.delete(key);
    } else {
      b = buildWorldBlob(generateWorld(seed, size, size));
      if (this.blobs.size >= this.max) this.blobs.delete(this.blobs.keys().next().value!);
    }
    this.blobs.set(key, b);
    return b;
  }
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(config: Config): Record<string, string> {
  const h: Record<string, string> = {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
  if (config.cookieSecure) h['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bodyObject(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

const ASSET_EXT = /\.[A-Za-z0-9]{1,8}$/;

export async function buildHttp(deps: HttpDeps): Promise<FastifyInstance> {
  const { config, db, auth, host, log, now } = deps;
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT_BYTES, trustProxy: false, connectionTimeout: 30000, keepAliveTimeout: 65000 });

  const secHeaders = securityHeaders(config);
  const registerLimiter = new WindowLimiter(REGISTER_LIMIT_PER_MIN, 60000);
  const loginLimiter = new WindowLimiter(LOGIN_LIMIT_PER_MIN, 60000);
  const apiLimiter = new WindowLimiter(API_LIMIT_PER_MIN, 60000);
  const ipOf = (req: FastifyRequest) => clientIp(req.raw, config.trustProxy);
  const worlds = new WorldBlobCache();

  const tooMany = (reply: FastifyReply, retryAfterMs: number) =>
    reply
      .code(429)
      .header('retry-after', String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
      .send({ error: 'Too many requests. Please slow down and try again shortly.' });

  /** The logged-in user for this request, or null. Renews the cookie when the session was extended. */
  const sessionOf = (req: FastifyRequest, reply: FastifyReply): SessionInfo | null => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const info = auth.session(token);
    if (!info) return null;
    if (info.user.banned) return null;
    if (info.renewed && token) reply.header('set-cookie', auth.sessionCookie(token));
    return info;
  };

  /** The account's village is created on first use, so every logged-in user has one. */
  const meResponse = (user: UserRow): MeResponse => {
    const v = host.ensureVillage(user.id);
    return { user: { id: user.id, username: user.username }, village: { name: v.name, seed: v.seed } };
  };

  // ---- global hooks ---------------------------------------------------------------

  app.addHook('onRequest', async (req, reply) => {
    for (const [k, v] of Object.entries(secHeaders)) reply.header(k, v);
    const isApi = req.url.startsWith('/api/');
    if (isApi) {
      const lim = apiLimiter.hit(ipOf(req), now());
      if (!lim.ok) return tooMany(reply, lim.retryAfterMs);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (!originAllowed(req.headers, config)) return reply.code(403).send({ error: 'Cross-origin request blocked.' });
        // Bodies must be JSON (this also keeps browsers' "simple" cross-site form posts out).
        const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
        if (hasBody && !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return reply.code(415).send({ error: 'Unsupported content type; send JSON.' });
      }
    }
    return undefined;
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) {
      log.error(`unhandled error on ${req.method} ${req.url.split('?')[0]}`, err);
      return reply.code(500).send({ error: 'Internal server error.' });
    }
    const error =
      status === 413
        ? 'Request body too large.'
        : status === 415
          ? 'Unsupported content type; send JSON.'
          : status === 429
            ? 'Too many requests.'
            : /json/i.test(err.code ?? '') || err instanceof SyntaxError
              ? 'Malformed JSON.'
              : 'Bad request.';
    return reply.code(status).send({ error });
  });

  // ---- accounts ----------------------------------------------------------------------

  app.post('/api/register', async (req, reply) => {
    const lim = registerLimiter.hit(ipOf(req), now());
    if (!lim.ok) return tooMany(reply, lim.retryAfterMs);
    const body = bodyObject(req.body);
    const out = await auth.register(body.username, body.password);
    if (!out.ok) return reply.code(out.status).send({ error: out.error });
    reply.header('set-cookie', auth.sessionCookie(out.token));
    return reply.code(201).send(meResponse(out.user));
  });

  app.post('/api/login', async (req, reply) => {
    const lim = loginLimiter.hit(ipOf(req), now());
    if (!lim.ok) return tooMany(reply, lim.retryAfterMs);
    const body = bodyObject(req.body);
    const out = await auth.login(body.username, body.password);
    if (!out.ok) return reply.code(out.status).send({ error: out.error });
    reply.header('set-cookie', auth.sessionCookie(out.token));
    return reply.send(meResponse(out.user));
  });

  app.post('/api/logout', async (req, reply) => {
    auth.logout(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    reply.header('set-cookie', auth.clearCookie());
    return reply.send({ ok: true });
  });

  app.get('/api/me', async (req, reply) => {
    const info = sessionOf(req, reply);
    if (!info) return reply.code(401).send({ error: 'Not logged in.' });
    return reply.send(meResponse(info.user));
  });

  // ---- world + health -----------------------------------------------------------------------

  app.get('/api/world', async (req, reply) => {
    const info = sessionOf(req, reply);
    if (!info) return reply.code(401).send({ error: 'Not logged in.' });
    const village$ = host.ensureVillage(info.user.id);
    const world$ = worlds.get(village$.seed, host.sizeOf(village$));
    reply.header('etag', world$.etag).header('cache-control', 'private, no-cache').header('vary', 'Accept-Encoding, Cookie');
    if (req.headers['if-none-match'] === world$.etag) return reply.code(304).send();
    reply.type('application/json; charset=utf-8');
    if (String(req.headers['accept-encoding'] ?? '').includes('gzip')) return reply.header('content-encoding', 'gzip').send(world$.gzip);
    return reply.send(world$.json);
  });

  app.get('/api/health', async (_req, reply) => reply.send(deps.health()));

  // ---- built client + SPA fallback --------------------------------------------------------------

  const hasClient = fs.existsSync(path.join(config.staticDir, 'index.html'));
  if (hasClient) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      index: 'index.html',
      cacheControl: false,
      setHeaders(res, filePath) {
        const rel = filePath.replace(/\\/g, '/');
        res.header('cache-control', rel.endsWith('/index.html') ? 'no-cache' : /\/assets\//.test(rel) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if (url === '/ws' || url.startsWith('/ws/')) return reply.code(426).header('upgrade', 'websocket').send({ error: 'Upgrade Required.' });
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    if (hasClient && isRead && !url.startsWith('/api/') && !ASSET_EXT.test(url)) {
      return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found.' });
  });

  return app;
}
