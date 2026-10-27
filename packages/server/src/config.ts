/**
 * Server configuration, read once from the environment at boot.
 * Invalid values fail fast with a clear message instead of running half-configured.
 */
import path from 'node:path';
import { LOG_LEVELS, type LogLevel } from './log';

export interface Config {
  /** HTTP + WebSocket port (PORT, default 3100). */
  port: number;
  /** Bind address (HOST, default 0.0.0.0 in production, 127.0.0.1 otherwise). */
  host: string;
  /** SQLite file (DB_PATH, default ./data/hearth.db). Its directory is created on boot. */
  dbPath: string;
  /** Base seed; each village's seed is derived from it and the account id (WORLD_SEED, default 1337). */
  worldSeed: number;
  /** Mark the session cookie Secure and send HSTS (COOKIE_SECURE=1 behind HTTPS). */
  cookieSecure: boolean;
  /** Session lifetime in days (SESSION_DAYS, default 14). */
  sessionDays: number;
  nodeEnv: string;
  isProd: boolean;
  logLevel: LogLevel;
  /** Built client served by the HTTP server (STATIC_DIR, default dist/client). */
  staticDir: string;
  /** Trust X-Forwarded-For from a reverse proxy (TRUST_PROXY=1). */
  trustProxy: boolean;
  /** Extra browser origins allowed to open the websocket / call the API (ALLOWED_ORIGINS=https://a.example,https://b.example). */
  allowedOrigins: string[];
  /** Snapshot interval for a running village (AUTOSAVE_MS, default 30000). */
  autosaveMs: number;
  /**
   * STUB (milestone M4, the away policy): real hours a village would keep living at 1x after the last client
   * leaves (AWAY_CAP_HOURS, default 8). Read and validated, but nothing uses it yet: in M0 a village is only
   * simulated while a client is connected, and its snapshot is saved on disconnect.
   */
  awayCapHours: number;
  /**
   * Dev tools for whoever is logged in: fast-forward the village, undo it (DEV_MODE=1). On by default outside production, off in
   * production: they change a real village, so a deployed server has to be told.
   */
  devMode: boolean;
}

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, def: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`config: ${key} must be an integer in [${min}, ${max}], got "${raw}"`);
  return n;
}

function bool(env: Env, key: string, def: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return def;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`config: ${key} must be a boolean (1/0/true/false), got "${env[key]}"`);
}

export function loadConfig(env: Env = process.env, overrides: Partial<Config> = {}): Config {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const isProd = nodeEnv === 'production';
  const logLevelRaw = (env.LOG_LEVEL?.trim().toLowerCase() || 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevelRaw)) throw new Error(`config: LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  const cfg: Config = {
    port: int(env, 'PORT', 3100, 0, 65535),
    host: env.HOST?.trim() || (isProd ? '0.0.0.0' : '127.0.0.1'),
    dbPath: path.resolve(env.DB_PATH?.trim() || './data/hearth.db'),
    worldSeed: int(env, 'WORLD_SEED', 1337, 0, 0x7fffffff),
    cookieSecure: bool(env, 'COOKIE_SECURE', false),
    sessionDays: int(env, 'SESSION_DAYS', 14, 1, 365),
    nodeEnv,
    isProd,
    logLevel: logLevelRaw,
    staticDir: path.resolve(env.STATIC_DIR?.trim() || 'dist/client'),
    trustProxy: bool(env, 'TRUST_PROXY', false),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    autosaveMs: int(env, 'AUTOSAVE_MS', 30000, 100, 3600000),
    awayCapHours: int(env, 'AWAY_CAP_HOURS', 8, 0, 24 * 14),
    devMode: bool(env, 'DEV_MODE', !isProd),
  };
  return { ...cfg, ...overrides };
}
