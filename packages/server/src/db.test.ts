import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrations, openDb } from './db';

describe('migrations', () => {
  it('applies all core migrations once and tracks the version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-db-'));
    const file = path.join(dir, 'nested', 'test.db');
    const a = openDb(file);
    expect(a.schemaVersion()).toBe(migrations.length);
    a.kvSet('k', 'v');
    a.close();
    const b = openDb(file);
    expect(b.schemaVersion()).toBe(migrations.length);
    expect(b.kvGet('k')).toBe('v');
    b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the documented tables with foreign keys on', () => {
    const db = openDb(':memory:');
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const t of ['users', 'sessions', 'villages', 'kv', 'schema_version']) expect(tables).toContain(t);
    expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
    db.close();
  });

  it('lets modules append their own versioned migrations', () => {
    const db = openDb(':memory:');
    db.migrateModule('reports', ['CREATE TABLE reports (id INTEGER PRIMARY KEY, title TEXT)']);
    expect(db.schemaVersion('reports')).toBe(1);
    db.migrateModule('reports', ['CREATE TABLE reports (id INTEGER PRIMARY KEY, title TEXT)', 'ALTER TABLE reports ADD COLUMN day INTEGER']);
    expect(db.schemaVersion('reports')).toBe(2);
    db.run('INSERT INTO reports (title, day) VALUES (?, ?)', 'Winter', 3);
    expect(db.get<{ day: number }>('SELECT day FROM reports')?.day).toBe(3);
    expect(() => db.migrateModule('core', [])).toThrow();
    expect(() => db.migrateModule('Bad Name!', [])).toThrow();
    db.close();
  });

  it('rolls back a failing migration step', () => {
    const db = openDb(':memory:');
    expect(() => db.migrateModule('broken', ['CREATE TABLE ok1 (a INTEGER); CREATE TABLE ok1 (a INTEGER);'])).toThrow();
    expect(db.schemaVersion('broken')).toBe(0);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'ok1'")).toBeUndefined();
    db.close();
  });
});

describe('repositories', () => {
  it('users are unique case-insensitively', () => {
    const db = openDb(':memory:');
    const u = db.createUser('Alice', 'h', 's', 5)!;
    expect(u.username).toBe('Alice');
    expect(db.createUser('ALICE', 'h', 's', 5)).toBeNull();
    expect(db.getUserByName('aLiCe')?.id).toBe(u.id);
    db.setUserBanned(u.id, true);
    expect(db.getUserById(u.id)).toMatchObject({ banned: true });
    db.close();
  });

  it('sessions expire and are purged', () => {
    const db = openDb(':memory:');
    const u = db.createUser('Bob', 'h', 's', 5)!;
    db.createSession('aaa', u.id, 100);
    db.createSession('bbb', u.id, 300);
    expect(db.purgeExpiredSessions(200)).toBe(1);
    expect(db.getSession('aaa')).toBeUndefined();
    db.extendSession('bbb', 900);
    expect(db.getSession('bbb')?.expiresAt).toBe(900);
    db.deleteUserSessions(u.id);
    expect(db.getSession('bbb')).toBeUndefined();
    db.close();
  });

  it('villages: one per user and slot, snapshots round-trip', () => {
    const db = openDb(':memory:');
    const u1 = db.createUser('One', 'h', 's', 5)!;
    const u2 = db.createUser('Two', 'h', 's', 5)!;
    expect(db.getVillage(u1.id)).toBeUndefined();
    const v = db.createVillage(u1.id, 'Jade Ford', 77, 10);
    expect(v).toMatchObject({ userId: u1.id, slot: 0, name: 'Jade Ford', seed: 77, snapshot: null, snapshotVersion: 0 });
    // Creating again returns the same village instead of a second one.
    expect(db.createVillage(u1.id, 'Other', 99, 11).id).toBe(v.id);
    expect(db.createVillage(u1.id, 'Second save', 5, 11, 1).id).not.toBe(v.id);
    expect(db.createVillage(u2.id, 'Mine', 5, 11).id).not.toBe(v.id);
    db.saveSnapshot(v.id, '{"v":1}', 1, 50);
    expect(db.getVillage(u1.id)).toMatchObject({ snapshot: '{"v":1}', snapshotVersion: 1, savedAt: 50 });
    db.close();
  });

  it('kv upserts', () => {
    const db = openDb(':memory:');
    db.kvSet('a', '1');
    db.kvSet('a', '2');
    expect(db.kvGet('a')).toBe('2');
    db.kvDelete('a');
    expect(db.kvGet('a')).toBeUndefined();
    db.close();
  });

  it('deleting a user cascades to sessions and villages', () => {
    const db = openDb(':memory:');
    const u = db.createUser('Gone', 'h', 's', 5)!;
    db.createSession('t', u.id, 999);
    db.createVillage(u.id, 'Gone Village', 1, 1);
    db.run('DELETE FROM users WHERE id = ?', u.id);
    expect(db.getSession('t')).toBeUndefined();
    expect(db.getVillage(u.id)).toBeUndefined();
    db.close();
  });

  it('nested transactions join the outer one and roll back together', () => {
    const db = openDb(':memory:');
    expect(() =>
      db.transaction(() => {
        db.kvSet('x', '1');
        db.transaction(() => db.kvSet('y', '2'));
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(db.kvGet('x')).toBeUndefined();
    expect(db.kvGet('y')).toBeUndefined();
    db.transaction(() => db.kvSet('z', '3'));
    expect(db.kvGet('z')).toBe('3');
    db.close();
  });
});
