import 'server-only';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Database access.
 *
 *   DATABASE_URL set   → node-postgres pool (Supabase / Neon / any Postgres)
 *   DATABASE_URL empty → embedded Postgres (PGlite) persisted in KEPT_DATA_DIR
 *
 * Two ways in, on purpose:
 *   asUser(userId, fn)  every product query. Runs inside a transaction as the `authenticated`
 *                       role with the user's id in request.jwt.claims — exactly what Supabase does
 *                       for a signed-in client. Row-level security is therefore enforced by
 *                       Postgres itself: a missing WHERE clause returns nothing, not everything.
 *   asSystem(fn)        auth, migrations, seeding. Owner privileges; never reachable from user input.
 */

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** multi-statement SQL without parameters (migrations) */
  exec?(sql: string): Promise<void>;
}

interface Driver extends Queryable {
  kind: 'pglite' | 'pg';
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const OIDS = { INT8: 20, DATE: 1082, NUMERIC: 1700 };

export function dataDir(): string {
  const dir = process.env.KEPT_DATA_DIR?.trim() || path.join(/*turbopackIgnore: true*/ process.cwd(), '.data');
  return path.resolve(/*turbopackIgnore: true*/ dir);
}

/**
 * The embedded database is single-process: two servers on one data folder can corrupt it.
 * A pid lock makes the second one fail loudly instead.
 */
function takeDataLock(): void {
  const lock = path.join(/*turbopackIgnore: true*/ dataDir(), 'kept.lock');
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  try {
    writeFileSync(/*turbopackIgnore: true*/ lock, String(process.pid), { flag: 'wx' });
  } catch {
    const holder = Number(readFileSync(/*turbopackIgnore: true*/ lock, 'utf8'));
    if (holder && holder !== process.pid && alive(holder)) {
      throw new Error(`LevelUp is already running (process ${holder}) on ${dataDir()}. Close that one first.`);
    }
    writeFileSync(/*turbopackIgnore: true*/ lock, String(process.pid));
  }
  const release = () => {
    try {
      if (readFileSync(/*turbopackIgnore: true*/ lock, 'utf8') === String(process.pid)) unlinkSync(/*turbopackIgnore: true*/ lock);
    } catch {
      /* already gone */
    }
  };
  // A lock left behind by a crash is harmless: the next start sees its process is gone and takes over.
  process.once('exit', release);
}

async function createPglite(): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(/*turbopackIgnore: true*/ dataDir(), 'pg');
  mkdirSync(dir, { recursive: true });
  takeDataLock();
  const db = new PGlite(dir, {
    parsers: {
      [OIDS.DATE]: (v: string) => v,
      [OIDS.INT8]: (v: string) => Number(v),
      [OIDS.NUMERIC]: (v: string) => Number(v),
    },
  });
  await db.waitReady;
  return {
    kind: 'pglite',
    async query<T>(sql: string, params?: unknown[]) {
      return (await db.query<T>(sql, params as never[])).rows;
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      return db.transaction(async (tx) =>
        fn({
          query: async <R,>(sql: string, params?: unknown[]) => (await tx.query<R>(sql, params as never[])).rows,
          exec: async (sql: string) => {
            await tx.exec(sql);
          },
        }),
      );
    },
    close: () => db.close(),
  };
}

async function createPg(url: string): Promise<Driver> {
  const pg = await import('pg');
  const { Pool, types } = pg.default ?? pg;
  types.setTypeParser(OIDS.DATE, (v: string) => v);
  types.setTypeParser(OIDS.INT8, (v: string) => Number(v));
  types.setTypeParser(OIDS.NUMERIC, (v: string) => Number(v));
  const pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  return {
    kind: 'pg',
    async query<T>(sql: string, params?: unknown[]) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({ query: async <R,>(sql: string, params?: unknown[]) => (await client.query(sql, params)).rows as R[] });
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// ───────────────────────────────────────────── migrations

function migrationFiles(sub: string): { name: string; sql: string }[] {
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'db', sub);
  let names: string[] = [];
  try {
    names = readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }
  return names.map((name) => ({ name: `${sub}/${name}`, sql: readFileSync(/*turbopackIgnore: true*/ path.join(dir, name), 'utf8') }));
}

async function migrate(d: Driver): Promise<string[]> {
  await d.query(`create schema if not exists kept_meta`);
  await d.query(`create table if not exists kept_meta.migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await d.query<{ name: string }>(`select name from kept_meta.migrations`)).map((r) => r.name));
  const files = [...(d.kind === 'pglite' ? migrationFiles('local') : []), ...migrationFiles('migrations')];
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f.name)) continue;
    await d.transaction(async (q) => {
      // multi-statement file: PGlite needs exec(); node-postgres runs it via the simple protocol
      if (q.exec) await q.exec(f.sql);
      else await q.query(f.sql);
      await q.query(`insert into kept_meta.migrations (name) values ($1)`, [f.name]);
    });
    applied.push(f.name);
  }
  return applied;
}

// ───────────────────────────────────────────── singleton (survives dev hot reloads)

const g = globalThis as unknown as { __keptDb?: Promise<Driver> };

async function init(): Promise<Driver> {
  const url = process.env.DATABASE_URL?.trim();
  const d = url ? await createPg(url) : await createPglite();
  // Embedded database: migrate on boot. Hosted Postgres: migrations are a deploy step
  // (`npm run db:migrate`), unless KEPT_AUTO_MIGRATE=1 opts back in.
  if (!url || process.env.KEPT_AUTO_MIGRATE === '1') {
    const applied = await migrate(d);
    if (applied.length) console.info(`[kept] applied migrations: ${applied.join(', ')}`);
  }
  return d;
}

function driver(): Promise<Driver> {
  if (!g.__keptDb) {
    g.__keptDb = init().catch((e) => {
      g.__keptDb = undefined;
      throw e;
    });
  }
  return g.__keptDb;
}

/** Apply pending migrations now (deploy step / CLI). Returns the names applied. */
export async function migrateNow(): Promise<string[]> {
  return migrate(await driver());
}

export async function closeDb(): Promise<void> {
  if (!g.__keptDb) return;
  const d = await g.__keptDb;
  g.__keptDb = undefined;
  await d.close();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run `fn` as the given user, with row-level security enforced by Postgres. */
export async function asUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error('asUser: invalid user id');
  const d = await driver();
  return d.transaction(async (q) => {
    await q.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await q.query(`set local role authenticated`);
    return fn(q);
  });
}

/** Owner access for auth, migrations and seeding. Never pass user-controlled SQL here. */
export async function asSystem<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const d = await driver();
  return d.transaction(fn);
}

export async function dbKind(): Promise<'pglite' | 'pg'> {
  return (await driver()).kind;
}
