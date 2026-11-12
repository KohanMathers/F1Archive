import { createWriteStream, mkdirSync, renameSync, rmSync, statSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import archiver from 'archiver';
import Database from 'better-sqlite3';
import parquet from '@dsnp/parquetjs';
import QueryStream from 'pg-query-stream';
import { CATEGORIES, buildQuery, columnsFor, createPool, estimateExport, resolveSessionKeys, type ExportColumn, type Pool } from '@f1archive/db';
import type { ExportCategory, ExportRequest } from '@f1archive/shared';
import { TRADEMARK_NOTICE } from '@f1archive/shared';

export interface RunnerOptions {
  exportDir: string;
  concurrency: number;
  ttlHours: number;
  log?: (m: string) => void;
}

interface JobRow {
  id: string;
  request: ExportRequest;
}

export async function runExportWorker(opts: RunnerOptions): Promise<never> {
  const log = opts.log ?? ((m: string) => console.log(`[export] ${m}`));
  const pool = createPool({ max: opts.concurrency + 3, applicationName: 'f1archive-export' });
  mkdirSync(opts.exportDir, { recursive: true });
  await pool.query(
    `UPDATE export_jobs SET status = 'failed', error = 'The export worker restarted while this job was running. Please start the export again.', finished_at = now()
     WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < now() - interval '2 minutes')`,
  );
  let active = 0;
  let lastCleanup = 0;
  log(`ready (concurrency ${opts.concurrency}, dir ${opts.exportDir})`);
  for (; ;) {
    if (Date.now() - lastCleanup > 10 * 60_000) {
      lastCleanup = Date.now();
      await cleanup(pool, opts.exportDir, log).catch((e) => log(`cleanup failed: ${(e as Error).message}`));
    }
    if (active < opts.concurrency) {
      const job = (
        await pool.query<JobRow>(
          `UPDATE export_jobs SET status = 'running', started_at = now(), heartbeat_at = now(), stage = 'starting'
           WHERE id = (SELECT id FROM export_jobs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
           RETURNING id, request`,
        )
      ).rows[0];
      if (job) {
        active++;
        runJob(pool, job, opts, log)
          .catch((e) => log(`job ${job.id} crashed: ${(e as Error).stack}`))
          .finally(() => active--);
        continue;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function cleanup(pool: Pool, dir: string, log: (m: string) => void) {
  const expired = await pool.query<{ id: string; file_name: string | null }>(
    `UPDATE export_jobs SET status = 'expired' WHERE status = 'done' AND expires_at < now() RETURNING id, file_name`,
  );
  for (const j of expired.rows) {
    if (j.file_name) rmSync(join(dir, j.file_name), { force: true });
    log(`expired ${j.id}`);
  }
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('work-')) continue;
    const p = join(dir, f);
    if (Date.now() - statSync(p).mtimeMs > 86_400_000) rmSync(p, { recursive: true, force: true });
  }
}

async function runJob(pool: Pool, job: JobRow, opts: RunnerOptions, log: (m: string) => void) {
  const req = job.request;
  const work = join(opts.exportDir, `work-${job.id}`);
  const heartbeat = setInterval(() => {
    pool.query(`UPDATE export_jobs SET heartbeat_at = now() WHERE id = $1`, [job.id]).catch(() => undefined);
  }, 15_000);
  let rowsWritten = 0;
  const progress = async (stage: string) => {
    await pool.query(`UPDATE export_jobs SET rows_written = $2, stage = $3, heartbeat_at = now() WHERE id = $1`, [job.id, rowsWritten, stage]);
  };
  try {
    const estimate = await estimateExport(pool, req);
    if (!estimate.within_limits) throw new Error(estimate.limit_reason ?? 'Export exceeds limits');
    await pool.query(`UPDATE export_jobs SET estimate = $2, rows_total = $3 WHERE id = $1`, [job.id, JSON.stringify(estimate), estimate.total_rows]);
    const { ids } = await resolveSessionKeys(pool, req.sessions);
    mkdirSync(work, { recursive: true });

    const categories = [...new Set<ExportCategory>(['sessions', ...req.categories])];
    const files: string[] = [];
    let sqlite: Database.Database | null = null;
    if (req.format === 'sqlite') {
      sqlite = new Database(join(work, 'f1archive.sqlite'));
      sqlite.pragma('journal_mode = OFF');
      sqlite.pragma('synchronous = OFF');
      files.push('f1archive.sqlite');
    }

    for (const key of categories) {
      const cat = CATEGORIES[key];
      const cols = columnsFor(cat, req);
      const q = buildQuery(cat, req, ids);
      await progress(`exporting ${cat.label.toLowerCase()}`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const stream = client.query(new QueryStream(q.text, q.values, { batchSize: 5000 }));
        let lastReport = Date.now();
        const onRow = async () => {
          rowsWritten++;
          if (Date.now() - lastReport > 2000) {
            lastReport = Date.now();
            await progress(`exporting ${cat.label.toLowerCase()}`);
          }
        };
        if (sqlite) {
          await writeSqliteTable(sqlite, key, cols, stream, onRow);
        } else if (req.format === 'parquet') {
          const name = `${key}.parquet`;
          await writeParquetFile(join(work, name), cols, stream, onRow);
          files.push(name);
        } else {
          const ext = req.format === 'csv' ? 'csv' : req.format === 'jsonl' ? 'jsonl' : 'json';
          const name = `${key}.${ext}`;
          await writeTextFile(join(work, name), req.format, cols, stream, onRow);
          files.push(name);
        }
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }

    const schema = Object.fromEntries(categories.map((k) => [k, { label: CATEGORIES[k].label, description: CATEGORIES[k].description, columns: columnsFor(CATEGORIES[k], req).map(docCol) }]));
    const runs = (await pool.query(`SELECT id, started_at, finished_at, source_kind, source_info, app_version FROM ingest_runs WHERE status = 'succeeded' ORDER BY id DESC LIMIT 5`)).rows;
    const provenance = {
      generated_utc: new Date().toISOString(),
      generator: 'F1Archive (f1archive.org)',
      request: req,
      rows_written: rowsWritten,
      source: 'Original F1 telemetry archive (SQLite), synchronised into F1Archive by the ingestion pipeline.',
      upstream_sources: [
        'F1 live timing archive (livetiming.formula1.com): laps, telemetry, weather, race control, team radio, track status',
        'Jolpica (Ergast successor): results, standings, pit stops, reference data',
        'MultiViewer: circuit corners and marshal positions',
      ],
      ingest_runs: runs,
      resolution: 'original (no downsampling)',
    };
    writeFileSync(join(work, 'schema.json'), JSON.stringify(schema, null, 2));
    writeFileSync(join(work, 'provenance.json'), JSON.stringify(provenance, null, 2));
    writeFileSync(join(work, 'README.md'), readme(req, schema, rowsWritten));
    files.push('schema.json', 'provenance.json', 'README.md');

    if (sqlite) {
      writeSqliteMeta(sqlite, schema, provenance);
      sqlite.close();
    }

    await progress('compressing');
    const fileName = `f1archive-export-${job.id.slice(0, 8)}-${req.format}.zip`;
    const tmpZip = join(opts.exportDir, `${fileName}.part`);
    await zipFiles(work, files, tmpZip);
    renameSync(tmpZip, join(opts.exportDir, fileName));
    const bytes = statSync(join(opts.exportDir, fileName)).size;
    await pool.query(
      `UPDATE export_jobs SET status = 'done', stage = 'done', rows_written = $2, file_name = $3, file_bytes = $4, finished_at = now(),
         expires_at = now() + make_interval(hours => $5) WHERE id = $1`,
      [job.id, rowsWritten, fileName, bytes, opts.ttlHours],
    );
    log(`job ${job.id} done: ${rowsWritten} rows, ${bytes} bytes`);
  } catch (e) {
    log(`job ${job.id} failed: ${(e as Error).message}`);
    await pool.query(`UPDATE export_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [job.id, (e as Error).message]);
  } finally {
    clearInterval(heartbeat);
    rmSync(work, { recursive: true, force: true });
  }
}

function docCol(c: ExportColumn) {
  return { name: c.name, type: c.type, unit: c.unit ?? null, description: c.description, derived: c.derived ?? false };
}

function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function jsonValue(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

async function writeTextFile(
  path: string,
  format: ExportRequest['format'],
  cols: ExportColumn[],
  stream: AsyncIterable<Record<string, unknown>>,
  onRow: () => Promise<void>,
) {
  const out = createWriteStream(path);
  const write = async (s: string) => {
    if (!out.write(s)) await once(out, 'drain');
  };
  const names = cols.map((c) => c.name);
  if (format === 'csv') await write(names.join(',') + '\n');
  if (format === 'json') await write('[\n');
  let first = true;
  for await (const row of stream) {
    if (format === 'csv') await write(names.map((n) => csvField(row[n])).join(',') + '\n');
    else {
      const obj: Record<string, unknown> = {};
      for (const n of names) obj[n] = jsonValue(row[n]);
      const line = JSON.stringify(obj);
      if (format === 'json') await write((first ? '  ' : ',\n  ') + line);
      else await write(line + '\n');
    }
    first = false;
    await onRow();
  }
  if (format === 'json') await write(first ? ']\n' : '\n]\n');
  out.end();
  await once(out, 'finish');
}

const PARQUET_TYPE: Record<ExportColumn['type'], 'UTF8' | 'INT64' | 'DOUBLE' | 'BOOLEAN' | 'TIMESTAMP_MILLIS'> = {
  text: 'UTF8',
  integer: 'INT64',
  real: 'DOUBLE',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMP_MILLIS',
};

export async function writeParquetFile(path: string, cols: ExportColumn[], stream: AsyncIterable<Record<string, unknown>>, onRow: () => Promise<void>) {
  const schema = new parquet.ParquetSchema(
    Object.fromEntries(cols.map((c) => [c.name, { type: PARQUET_TYPE[c.type], optional: true, compression: 'SNAPPY' as const }])),
  );
  const writer = await parquet.ParquetWriter.openFile(schema, path);
  writer.setRowGroupSize(50_000);
  try {
    for await (const row of stream) {
      const out: Record<string, unknown> = {};
      for (const c of cols) {
        const v = row[c.name];
        if (v === null || v === undefined) continue;
        if (c.type === 'timestamp') out[c.name] = v instanceof Date ? v : new Date(String(v));
        else if (c.type === 'integer') out[c.name] = typeof v === 'number' ? v : Number(v);
        else if (c.type === 'real') out[c.name] = Number(v);
        else out[c.name] = v;
      }
      await writer.appendRow(out);
      await onRow();
    }
  } finally {
    await writer.close();
  }
}

const SQLITE_TYPE: Record<ExportColumn['type'], string> = { text: 'TEXT', integer: 'INTEGER', real: 'REAL', boolean: 'INTEGER', timestamp: 'TEXT' };

async function writeSqliteTable(
  db: Database.Database,
  table: ExportCategory,
  cols: ExportColumn[],
  stream: AsyncIterable<Record<string, unknown>>,
  onRow: () => Promise<void>,
) {
  db.exec(`CREATE TABLE "${table}" (${cols.map((c) => `"${c.name}" ${SQLITE_TYPE[c.type]}`).join(', ')})`);
  const ins = db.prepare(`INSERT INTO "${table}" VALUES (${cols.map(() => '?').join(', ')})`);
  const flush = db.transaction((batch: unknown[][]) => {
    for (const b of batch) ins.run(...b);
  });
  let batch: unknown[][] = [];
  for await (const row of stream) {
    batch.push(
      cols.map((c) => {
        const v = row[c.name];
        if (v === null || v === undefined) return null;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (v instanceof Date) return v.toISOString();
        return v;
      }),
    );
    if (batch.length >= 10_000) {
      flush(batch);
      batch = [];
    }
    await onRow();
  }
  if (batch.length) flush(batch);
  const idx: string[] = [];
  if (cols.some((c) => c.name === 'session_key')) idx.push('session_key');
  if (cols.some((c) => c.name === 'driver_number')) idx.push('driver_number');
  if (cols.some((c) => c.name === 'ts_ns')) idx.push('ts_ns');
  else if (cols.some((c) => c.name === 'lap')) idx.push('lap');
  if (idx.length) db.exec(`CREATE INDEX "${table}_lookup" ON "${table}" (${idx.map((i) => `"${i}"`).join(', ')})`);
}

function writeSqliteMeta(db: Database.Database, schema: Record<string, { columns: ReturnType<typeof docCol>[]; description: string }>, provenance: unknown) {
  db.exec(`CREATE TABLE _columns (table_name TEXT, column_name TEXT, type TEXT, unit TEXT, derived INTEGER, description TEXT)`);
  const ins = db.prepare(`INSERT INTO _columns VALUES (?, ?, ?, ?, ?, ?)`);
  for (const [t, def] of Object.entries(schema)) for (const c of def.columns) ins.run(t, c.name, c.type, c.unit, c.derived ? 1 : 0, c.description);
  db.exec(`CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)`);
  db.prepare(`INSERT INTO _metadata VALUES ('provenance', ?)`).run(JSON.stringify(provenance));
  db.prepare(`INSERT INTO _metadata VALUES ('units', ?)`).run('Durations and session times are integer nanoseconds (_ns). Session time is time since the start of the session data stream. NULL means missing, never zero.');
}

function readme(req: ExportRequest, schema: Record<string, { label: string; description: string; columns: ReturnType<typeof docCol>[] }>, rows: number): string {
  const lines = [
    '# F1Archive dataset export',
    '',
    `Generated ${new Date().toISOString()} by F1Archive (f1archive.org), an independent and unofficial archive. Not affiliated with Formula 1, the FIA or any team.`,
    TRADEMARK_NOTICE,
    '',
    `Format: ${req.format}. Sessions: ${req.sessions.length}. Rows: ${rows.toLocaleString('en-GB')}.`,
    '',
    '## Conventions',
    '',
    '- Durations and session times are integer nanoseconds (columns ending `_ns`). Divide by 1e9 for seconds.',
    '- A session time is the time since the start of that session\'s data stream; it is not wall-clock time.',
    '- Empty / null means the value is missing. A `0` is a real measured zero.',
    '- Telemetry is original resolution. Car data and position data share one timeline, so a row can have one half empty.',
    '- Columns marked *derived* are computed by F1Archive, not published by the source.',
    '- `session_key` (e.g. `2021-abu-dhabi-race`) is a stable identifier you can use to join files.',
    ...(req.format === 'parquet'
      ? ['- Parquet files: Snappy-compressed; integers are INT64, decimals DOUBLE, times TIMESTAMP_MILLIS (UTC); every column is nullable. Read with `pandas.read_parquet`, Polars, DuckDB or Spark.']
      : []),
    '',
    'See `schema.json` for every column with type and unit, and `provenance.json` for where the data came from.',
    '',
    '## Files',
    '',
  ];
  for (const [k, d] of Object.entries(schema)) {
    lines.push(`### ${k} — ${d.label}`, '', d.description, '', '| Column | Type | Unit | Description |', '|---|---|---|---|');
    for (const c of d.columns) lines.push(`| ${c.name} | ${c.type} | ${c.unit ?? ''} | ${c.description}${c.derived ? ' *(derived)*' : ''} |`);
    lines.push('');
  }
  lines.push(
    '## Licensing',
    '',
    'The underlying data originates from Formula 1 timing feeds, Jolpica and MultiViewer. Check the terms of those sources before redistributing this data.',
  );
  return lines.join('\n');
}

async function zipFiles(dir: string, files: string[], dest: string) {
  const out = createWriteStream(dest);
  const zip = archiver('zip', { zlib: { level: 6 }, forceZip64: true });
  const done = once(out, 'close');
  zip.pipe(out);
  for (const f of files) if (existsSync(join(dir, f))) zip.file(join(dir, f), { name: f });
  await zip.finalize();
  await done;
}
