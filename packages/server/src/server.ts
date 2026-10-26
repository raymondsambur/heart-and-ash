/**
 * Server assembly: config -> database -> village host -> HTTP + WebSocket.
 * `main.ts` calls `startServer()` and wires process signals; tests call it directly.
 */
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { AuthService } from './auth';
import { loadConfig, type Config } from './config';
import { openDb, type Db } from './db';
import { VillageHost } from './host';
import { buildHttp } from './http';
import { createLogger, type Logger } from './log';
import { Gateway } from './net/gateway';

export interface StartOptions {
  /** Environment to read the config from (default: process.env). */
  env?: Record<string, string | undefined>;
  /** Config overrides applied after the environment. */
  config?: Partial<Config>;
  log?: Logger;
  /** Clock override (tests). */
  now?: () => number;
}

export interface RunningServer {
  config: Config;
  port: number;
  host: string;
  log: Logger;
  db: Db;
  villages: VillageHost;
  gateway: Gateway;
  app: FastifyInstance;
  /** Graceful shutdown: save every running village, close sockets and the database. */
  close(): Promise<void>;
}

export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const config = loadConfig(opts.env ?? process.env, opts.config);
  const log = opts.log ?? createLogger(config.logLevel);
  const now = opts.now ?? Date.now;
  const startedAt = now();

  const db = openDb(config.dbPath);
  let app: FastifyInstance | null = null;
  try {
    const villages = new VillageHost(db, config, log.child('village'), now);
    const auth = new AuthService(db, config, now);
    app = await buildHttp({
      config,
      db,
      auth,
      host: villages,
      log: log.child('http'),
      now,
      health: () => {
        const s = villages.stats();
        return { ok: true, uptimeSec: Math.round((now() - startedAt) / 1000), online: s.online, running: s.running, tickMs: s.tickMs };
      },
    });
    const gateway = new Gateway({ server: app.server, host: villages, auth, config, log: log.child('ws'), now });

    await app.listen({ port: config.port, host: config.host });
    const address = app.server.address() as AddressInfo;
    villages.start();
    log.info(`listening on http://${config.host}:${address.port} (base seed ${config.worldSeed}, db ${config.dbPath})`);

    const liveApp = app;
    let closing: Promise<void> | null = null;
    return {
      config,
      port: address.port,
      host: config.host,
      log,
      db,
      villages,
      gateway,
      app: liveApp,
      close(): Promise<void> {
        closing ??= (async () => {
          log.info('shutting down');
          villages.shutdown();
          await gateway.close();
          await liveApp.close();
          db.close();
          log.info('shutdown complete');
        })();
        return closing;
      },
    };
  } catch (err) {
    // Boot failed: release what was opened so the process (or test) can exit cleanly.
    try {
      await app?.close();
    } catch {
      /* ignore */
    }
    try {
      db.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}
