/**
 * Persistence layer. Everything outside this file talks to the `Db` interface only, so the
 * SQLite implementation (node:sqlite, synchronous) can be swapped for Postgres later.
 *
 * Schema changes: append a new SQL string to `migrations` (never edit an applied one).
 * Other modules that need their own tables call `db.migrateModule('name', [...])`; each module's
 * list is versioned independently in `schema_version`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type SqlValue = null | number | bigint | string | Uint8Array;

/** Core schema. Index + 1 is the schema version. Append only. */
export const migrations: string[] = [
  // 1: accounts, sessions, villages (one per account for now: `slot` leaves room for several saves), key/value store
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    banned INTEGER NOT NULL DEFAULT 0,
    last_login INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expiry ON sessions(expires_at);
  CREATE TABLE villages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    seed INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    saved_at INTEGER NOT NULL DEFAULT 0,
    snapshot_version INTEGER NOT NULL DEFAULT 0,
    snapshot TEXT,
    UNIQUE (user_id, slot)
  );
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export interface UserRow {
  id: number;
  username: string;
  passHash: string;
  salt: string;
  createdAt: number;
  banned: boolean;
  lastLogin: number;
}

export interface SessionRow {
  tokenHash: string;
  userId: number;
  expiresAt: number;
}

export interface VillageRow {
  id: number;
  userId: number;
  slot: number;
  name: string;
  seed: number;
  createdAt: number;
  savedAt: number;
  snapshotVersion: number;
  /** The sim snapshot as JSON text, or null before the first save. */
  snapshot: string | null;
}

export interface Db {
  // ---- users ----------------------------------------------------------------
  /** Returns null when the username is taken (case-insensitive). */
  createUser(username: string, passHash: string, salt: string, now: number): UserRow | null;
  getUserById(id: number): UserRow | undefined;
  getUserByName(username: string): UserRow | undefined;
  setUserLastLogin(id: number, now: number): void;
  setUserBanned(id: number, banned: boolean): void;

  // ---- sessions (only SHA-256 of the token is stored) -------------------------
  createSession(tokenHash: string, userId: number, expiresAt: number): void;
  getSession(tokenHash: string): SessionRow | undefined;
  extendSession(tokenHash: string, expiresAt: number): void;
  deleteSession(tokenHash: string): void;
  deleteUserSessions(userId: number): void;
  purgeExpiredSessions(now: number): number;

  // ---- villages -----------------------------------------------------------------
  getVillage(userId: number, slot?: number): VillageRow | undefined;
  /** Creates the village row, or returns the existing one for that user and slot. */
  createVillage(userId: number, name: string, seed: number, now: number, slot?: number): VillageRow;
  /** Replace the stored snapshot (a full, versioned sim state as JSON text). */
  saveSnapshot(villageId: number, snapshot: string, version: number, now: number): void;

  // ---- key/value store -----------------------------------------------------------------
  kvGet(key: string): string | undefined;
  kvSet(key: string, value: string): void;
  kvDelete(key: string): void;

  schemaVersion(name?: string): number;
  migrateModule(name: string, moduleMigrations: readonly string[]): void;
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number };
  get<T extends object>(sql: string, ...params: SqlValue[]): T | undefined;
  all<T extends object>(sql: string, ...params: SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
  close(): void;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

type Row = Record<string, SqlValue>;

const num = (v: SqlValue | undefined): number => (typeof v === 'bigint' ? Number(v) : (v as number));

function isUniqueViolation(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { errcode?: number }).errcode;
  return code === 2067 || code === 1555 || /UNIQUE constraint failed/i.test(err.message);
}

function toUser(r: Row): UserRow {
  return {
    id: num(r.id),
    username: r.username as string,
    passHash: r.pass_hash as string,
    salt: r.salt as string,
    createdAt: num(r.created_at),
    banned: num(r.banned) !== 0,
    lastLogin: num(r.last_login),
  };
}

function toVillage(r: Row): VillageRow {
  return {
    id: num(r.id),
    userId: num(r.user_id),
    slot: num(r.slot),
    name: r.name as string,
    seed: num(r.seed),
    createdAt: num(r.created_at),
    savedAt: num(r.saved_at),
    snapshotVersion: num(r.snapshot_version),
    snapshot: (r.snapshot as string | null) ?? null,
  };
}

export class SqliteDb implements Db {
  private readonly db: DatabaseSync;
  private readonly stmts = new Map<string, StatementSync>();
  private txDepth = 0;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (name TEXT PRIMARY KEY, version INTEGER NOT NULL);');
    this.applyMigrations('core', migrations);
  }

  // ---- internals ----------------------------------------------------------------

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private row(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.stmt(sql).get(...params) as Row | undefined;
  }

  private rows(sql: string, ...params: SqlValue[]): Row[] {
    return this.stmt(sql).all(...params) as Row[];
  }

  private applyMigrations(name: string, list: readonly string[]): void {
    const current = this.schemaVersion(name);
    for (let v = current; v < list.length; v++) {
      this.transaction(() => {
        this.db.exec(list[v]);
        this.stmt('INSERT INTO schema_version (name, version) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version').run(name, v + 1);
      });
    }
  }

  // ---- generic -------------------------------------------------------------------

  schemaVersion(name = 'core'): number {
    const r = this.row('SELECT version FROM schema_version WHERE name = ?', name);
    return r ? num(r.version) : 0;
  }

  migrateModule(name: string, moduleMigrations: readonly string[]): void {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(name) || name === 'core') throw new Error(`db: invalid migration module name "${name}"`);
    this.applyMigrations(name, moduleMigrations);
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: num(r.changes), lastInsertRowid: num(r.lastInsertRowid) };
  }

  get<T extends object>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.row(sql, ...params) as T | undefined;
  }

  all<T extends object>(sql: string, ...params: SqlValue[]): T[] {
    return this.rows(sql, ...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  close(): void {
    this.stmts.clear();
    if (this.db.isOpen) this.db.close();
  }

  // ---- users ------------------------------------------------------------------------

  createUser(username: string, passHash: string, salt: string, now: number): UserRow | null {
    try {
      const r = this.run('INSERT INTO users (username, pass_hash, salt, created_at, last_login) VALUES (?, ?, ?, ?, ?)', username, passHash, salt, now, now);
      return this.getUserById(r.lastInsertRowid) ?? null;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  getUserById(id: number): UserRow | undefined {
    const r = this.row('SELECT * FROM users WHERE id = ?', id);
    return r ? toUser(r) : undefined;
  }

  getUserByName(username: string): UserRow | undefined {
    const r = this.row('SELECT * FROM users WHERE username = ? COLLATE NOCASE', username);
    return r ? toUser(r) : undefined;
  }

  setUserLastLogin(id: number, now: number): void {
    this.run('UPDATE users SET last_login = ? WHERE id = ?', now, id);
  }

  setUserBanned(id: number, banned: boolean): void {
    this.run('UPDATE users SET banned = ? WHERE id = ?', banned ? 1 : 0, id);
  }

  // ---- sessions ----------------------------------------------------------------------

  createSession(tokenHash: string, userId: number, expiresAt: number): void {
    this.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', tokenHash, userId, expiresAt);
  }

  getSession(tokenHash: string): SessionRow | undefined {
    const r = this.row('SELECT * FROM sessions WHERE token_hash = ?', tokenHash);
    return r ? { tokenHash: r.token_hash as string, userId: num(r.user_id), expiresAt: num(r.expires_at) } : undefined;
  }

  extendSession(tokenHash: string, expiresAt: number): void {
    this.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', expiresAt, tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  deleteUserSessions(userId: number): void {
    this.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  purgeExpiredSessions(now: number): number {
    return this.run('DELETE FROM sessions WHERE expires_at <= ?', now).changes;
  }

  // ---- villages ------------------------------------------------------------------------

  getVillage(userId: number, slot = 0): VillageRow | undefined {
    const r = this.row('SELECT * FROM villages WHERE user_id = ? AND slot = ?', userId, slot);
    return r ? toVillage(r) : undefined;
  }

  createVillage(userId: number, name: string, seed: number, now: number, slot = 0): VillageRow {
    return this.transaction(() => {
      const existing = this.getVillage(userId, slot);
      if (existing) return existing;
      this.run('INSERT INTO villages (user_id, slot, name, seed, created_at) VALUES (?, ?, ?, ?, ?)', userId, slot, name, seed, now);
      return this.getVillage(userId, slot)!;
    });
  }

  saveSnapshot(villageId: number, snapshot: string, version: number, now: number): void {
    this.run('UPDATE villages SET snapshot = ?, snapshot_version = ?, saved_at = ? WHERE id = ?', snapshot, version, now, villageId);
  }

  // ---- key/value ----------------------------------------------------------------------------

  kvGet(key: string): string | undefined {
    const r = this.row('SELECT value FROM kv WHERE key = ?', key);
    return r ? (r.value as string) : undefined;
  }

  kvSet(key: string, value: string): void {
    this.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  kvDelete(key: string): void {
    this.run('DELETE FROM kv WHERE key = ?', key);
  }
}

export function openDb(file: string): Db {
  return new SqliteDb(file);
}
