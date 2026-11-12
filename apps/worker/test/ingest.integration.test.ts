import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runIngest } from '../src/ingest/ingest.js';

const DEV_DB = resolve(__dirname, '../../../data/dev/f1-telem-dev.db');
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const enabled = !!ADMIN_URL && existsSync(DEV_DB);
const dbName = `f1archive_test_${process.pid}`;

let fixture = '';
let testUrl = '';

function buildFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'f1a-fixture-'));
  const out = join(dir, 'fixture.db');
  const tables = execFileSync('sqlite3', [`file:${DEV_DB}?immutable=1`, "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 't\\_%' ESCAPE '\\'"])
    .toString()
    .trim()
    .split('\n');
  const keep = `(_year IS NULL OR (_year = 2018 AND _round IN (1, 2)) OR (_year = 2021 AND _round = 22))`;
  const sql = [
    `ATTACH 'file:${DEV_DB}?immutable=1' AS src;`,
    ...execFileSync('sqlite3', [`file:${DEV_DB}?immutable=1`, "SELECT sql || ';' FROM sqlite_master WHERE type='table'"]).toString().split('\n'),
    ...tables.map((t) => `INSERT INTO main."${t}" SELECT * FROM src."${t}" WHERE ${keep};`),
    `INSERT INTO main.telemetry SELECT * FROM src.telemetry WHERE year = 2021 AND round = 22 AND session = 'Race' AND driver = '33' ORDER BY ts LIMIT 3000;`,
    `INSERT INTO main.telemetry SELECT * FROM src.telemetry WHERE year = 2021 AND round = 22 AND session = 'Race' AND driver = '44' ORDER BY ts LIMIT 3000;`,
    `INSERT INTO main._subset_manifest VALUES (2021, 22, 'Abu Dhabi Grand Prix', 'Race'), (2018, 2, 'Bahrain Grand Prix', 'Race');`,
    ...execFileSync('sqlite3', [`file:${DEV_DB}?immutable=1`, "SELECT sql || ';' FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"]).toString().split('\n'),
  ].join('\n');
  execFileSync('sqlite3', [out], { input: sql });
  return out;
}

describe.skipIf(!enabled)('ingestion (integration)', () => {
  let db: pg.Pool;
  beforeAll(async () => {
    fixture = buildFixture();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    testUrl = u.toString();
    process.env.DATABASE_URL = testUrl;
    db = new pg.Pool({ connectionString: testUrl });
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    if (!ADMIN_URL) return;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  it('ingests the fixture and records provenance', async () => {
    const before = statSync(fixture).mtimeMs;
    const s = await runIngest({ source: fixture, log: () => undefined });
    expect(s.sessions_ingested).toBeGreaterThan(0);
    expect(s.telemetry_rows).toBe(6000);
    expect(statSync(fixture).mtimeMs).toBe(before);
    const run = (await db.query(`SELECT status, source_kind FROM ingest_runs ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(run).toEqual({ status: 'succeeded', source_kind: 'subset' });
  }, 300_000);

  it('is idempotent: a second run changes nothing', async () => {
    const counts = async () => (await db.query(`SELECT (SELECT count(*) FROM laps) l, (SELECT count(*) FROM telemetry) t, (SELECT count(*) FROM team_radio) r`)).rows[0];
    const a = await counts();
    const s = await runIngest({ source: fixture, log: () => undefined });
    expect(s.sessions_ingested).toBe(0);
    expect(s.telemetry_rows).toBe(0);
    expect(await counts()).toEqual(a);
  }, 300_000);

  it('keeps exact row counts per feed', async () => {
    const src = Number(
      execFileSync('sqlite3', [fixture, "SELECT count(*) FROM t_session_laps WHERE _year=2021 AND _round=22 AND _session='Race' AND _no_data=0"]).toString(),
    );
    const dst = (await db.query(`SELECT count(*)::int n FROM laps l JOIN sessions s ON s.id = l.session_id JOIN events e ON e.id = s.event_id WHERE e.year = 2021 AND e.slug = 'abu-dhabi' AND s.slug = 'race'`)).rows[0].n;
    expect(dst).toBe(src);
  });

  it('marks the documented missing sessions as missing, not archived', async () => {
    const r = await db.query(`SELECT s.source_name, s.status FROM sessions s JOIN events e ON e.id = s.event_id WHERE e.year = 2018 AND e.round = 2 ORDER BY s.scheduled_start_utc`);
    const byName = Object.fromEntries(r.rows.map((x) => [x.source_name, x.status]));
    expect(byName['Practice 1']).toBe('missing');
    expect(byName['Qualifying']).toBe('missing');
    expect(byName['Race']).toBe('archived');
  });

  it('distinguishes placeholders, missing feeds and data not imported', async () => {
    const state = async (year: number, slug: string, session: string, feed: string, driver = '') =>
      (
        await db.query(
          `SELECT fa.state FROM feed_availability fa JOIN sessions s ON s.id = fa.scope_id JOIN events e ON e.id = s.event_id
           WHERE fa.scope = 'session' AND e.year = $1 AND e.slug = $2 AND s.slug = $3 AND fa.feed = $4 AND fa.driver = $5`,
          [year, slug, session, feed, driver],
        )
      ).rows[0]?.state;
    expect(await state(2021, 'abu-dhabi', 'practice-1', 'pit_stops')).toBe('no_data');
    expect(await state(2018, 'bahrain', 'race', 'telemetry')).toBe('no_data');
    expect(await state(2021, 'abu-dhabi', 'qualifying', 'telemetry')).toBe('not_imported');
    expect(await state(2021, 'abu-dhabi', 'race', 'telemetry', '33')).toBe('present');
  });

  it('never stores a measured value where the source had none', async () => {
    const src = Number(execFileSync('sqlite3', [fixture, "SELECT count(*) FROM telemetry WHERE x IS NULL"]).toString());
    const dst = (await db.query(`SELECT count(*)::int n FROM telemetry WHERE x IS NULL`)).rows[0].n;
    expect(dst).toBe(src);
  });
});
