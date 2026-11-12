import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface DbOptions {
  connectionString?: string;
  max?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
}

export function createPool(opts: DbOptions = {}): pg.Pool {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? 'f1archive',
    statement_timeout: opts.statementTimeoutMs ?? 0,
  });
  pool.on('error', (err) => {
    console.error('[db] idle client error', err);
  });
  return pool;
}

function migrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
    join(process.cwd(), 'migrations'),
    join(process.cwd(), 'packages', 'db', 'migrations'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      if (readdirSync(c).some((f) => f.endsWith('.sql'))) return c;
    } catch {
      /* try next */
    }
  }
  throw new Error(`Migrations directory not found (tried ${candidates.join(', ')})`);
}

export async function migrate(pool: pg.Pool, log: (m: string) => void = console.log): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const dir = migrationsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      log(`[db] applying migration ${f}`);
      const sql = readFileSync(join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined);
    client.release();
  }
}

export async function withTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function telemetryPartition(year: number): string {
  if (!Number.isInteger(year) || year < 1950 || year > 2200) throw new Error(`bad year ${year}`);
  return `telemetry_y${year}`;
}

export async function ensureTelemetryPartition(c: pg.Pool | pg.PoolClient, year: number): Promise<void> {
  const name = telemetryPartition(year);
  await c.query(`CREATE TABLE IF NOT EXISTS ${name} PARTITION OF telemetry FOR VALUES IN (${year})`);
}

export { pg };
export * from './exports.js';
