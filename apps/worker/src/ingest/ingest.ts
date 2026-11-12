import {
  createPool,
  ensureTelemetryPartition,
  migrate,
  withTransaction,
  type Pool,
  type PoolClient,
} from '@f1archive/db';
import { eventSlug, isTestingEvent, parseDriverNumber, sessionKind, sessionSlug, type FeedKey, type FeedState } from '@f1archive/shared';
import { convert, ConversionError } from './convert.js';
import { copyRows } from './copy.js';
import { ctxKey, openSource, readSubset, tableColumns, tableExists, type SqliteDb, type SubsetInfo } from './source.js';
import { EVENT_TABLES, REFERENCE_TABLES, SESSION_TABLES, type ColMap } from './tables.js';
import { rebuildSearchIndex } from './search.js';

export interface IngestOptions {
  source: string;
  force?: boolean;
  skipTelemetry?: boolean;
  years?: number[];
  log?: (msg: string) => void;
  appVersion?: string;
}

interface Summary {
  sessions_seen: number;
  sessions_ingested: number;
  sessions_skipped: number;
  telemetry_sessions: number;
  telemetry_rows: number;
  rows: Record<string, number>;
  anomalies: string[];
  unmapped_columns: Record<string, string[]>;
  missing_columns: Record<string, string[]>;
}

type Row = Record<string, unknown>;

export async function runIngest(opts: IngestOptions): Promise<Summary> {
  const log = opts.log ?? ((m: string) => console.log(`[ingest] ${m}`));
  const pool = createPool({ max: 4, applicationName: 'f1archive-ingest' });
  await migrate(pool, log);

  const src = openSource(opts.source);
  const tsrc = openSource(opts.source);
  const subset = readSubset(src);
  log(`source ${opts.source} (${subset ? 'development subset' : 'full archive'})`);

  const summary: Summary = {
    sessions_seen: 0,
    sessions_ingested: 0,
    sessions_skipped: 0,
    telemetry_sessions: 0,
    telemetry_rows: 0,
    rows: {},
    anomalies: [],
    unmapped_columns: {},
    missing_columns: {},
  };

  const runId = (
    await pool.query<{ id: number }>(
      `INSERT INTO ingest_runs (status, source_path, source_kind, source_info, options, app_version)
       VALUES ('running', $1, $2, $3, $4, $5) RETURNING id`,
      [opts.source, subset ? 'subset' : 'full', JSON.stringify(subset?.info ?? {}), JSON.stringify({ ...opts, log: undefined }), opts.appVersion ?? null],
    )
  ).rows[0]!.id;

  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
    log('interrupt received: finishing the current session, then stopping');
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    checkColumns(src, summary);
    await ingestReference(pool, src, runId, summary);
    const years = seasonYears(src).filter((y) => !opts.years || opts.years.includes(y));
    for (const year of years) {
      await ingestSeason(pool, src, year, runId);
      const events = await ingestEventsAndSchedule(pool, src, year, runId, summary);
      for (const ev of events) {
        await ingestEventFeeds(pool, src, ev, runId, opts.force ?? false, summary);
        for (const s of ev.sessions) {
          if (interrupted) throw new Interrupted();
          summary.sessions_seen++;
          if (s.status !== 'archived') continue;
          const changed = await ingestSession(pool, src, tsrc, subset, ev, s, runId, opts, summary, log);
          if (changed) summary.sessions_ingested++;
          else summary.sessions_skipped++;
        }
      }
      log(`season ${year} done`);
    }
    await postProcess(pool, log);
    await rebuildSearchIndex(pool);
    await pool.query(`UPDATE ingest_runs SET status = 'succeeded', finished_at = now(), summary = $2 WHERE id = $1`, [runId, JSON.stringify(summary)]);
    log(`done: ${summary.sessions_ingested} sessions ingested, ${summary.sessions_skipped} unchanged, ${summary.telemetry_rows} telemetry rows`);
    if (summary.anomalies.length) log(`${summary.anomalies.length} anomalies recorded in ingest_runs.summary`);
    return summary;
  } catch (e) {
    const status = e instanceof Interrupted ? 'interrupted' : 'failed';
    await pool.query(`UPDATE ingest_runs SET status = $2, finished_at = now(), summary = $3, error = $4 WHERE id = $1`, [
      runId,
      status,
      JSON.stringify(summary),
      e instanceof Error ? e.stack ?? e.message : String(e),
    ]);
    throw e;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    src.close();
    tsrc.close();
    await pool.end();
  }
}

class Interrupted extends Error {
  constructor() {
    super('ingestion interrupted');
  }
}

const CONTEXT_COLS = new Set(['_year', '_round', '_event', '_session', '_driver', '_no_data']);

function checkColumns(src: SqliteDb, summary: Summary) {
  const specs: { source: string; cols: ColMap[] }[] = [...SESSION_TABLES.filter((s) => s.cols.length), ...EVENT_TABLES, ...REFERENCE_TABLES];
  for (const spec of specs) {
    if (!tableExists(src, spec.source)) {
      summary.missing_columns[spec.source] = ['(table missing)'];
      continue;
    }
    const have = new Set(tableColumns(src, spec.source));
    const mapped = new Set(spec.cols.map((c) => c[0]));
    const missing = [...mapped].filter((c) => !have.has(c));
    const unmapped = [...have].filter((c) => !mapped.has(c) && !CONTEXT_COLS.has(c));
    if (missing.length) summary.missing_columns[spec.source] = missing;
    if (unmapped.length) summary.unmapped_columns[spec.source] = unmapped;
  }
}

function availableCols(src: SqliteDb, source: string, cols: ColMap[]): ColMap[] {
  const have = new Set(tableColumns(src, source));
  return cols.filter((c) => have.has(c[0]));
}

function convertRow(r: Row, cols: ColMap[], table: string): (string | number | boolean | null)[] {
  return cols.map(([s, , conv]) => convert(r[s], conv, table, s));
}

async function ingestReference(pool: Pool, src: SqliteDb, runId: number, summary: Summary) {
  for (const spec of REFERENCE_TABLES) {
    if (!tableExists(src, spec.source)) continue;
    const cols = availableCols(src, spec.source, spec.cols);
    const rows = src.prepare(`SELECT * FROM ${spec.source} WHERE _no_data = 0`).all() as Row[];
    await withTransaction(pool, async (c) => {
      await c.query(`DELETE FROM ${spec.target}`);
      const seen = new Set<unknown>();
      const out = [];
      for (const r of rows) {
        const vals = convertRow(r, cols, spec.source);
        const key = vals[0];
        if (seen.has(key)) {
          summary.anomalies.push(`${spec.source}: duplicate key ${String(key)} (first kept)`);
          continue;
        }
        seen.add(key);
        out.push([...vals, runId]);
      }
      await copyRows(c, spec.target, [...cols.map((x) => x[1]), 'ingest_run_id'], out);
      summary.rows[spec.target] = out.length;
    });
  }
}

function seasonYears(src: SqliteDb): number[] {
  const rows = src
    .prepare(
      `SELECT DISTINCT _year AS y FROM t_season_events WHERE _year IS NOT NULL
       UNION SELECT DISTINCT _year FROM t_event_info WHERE _year IS NOT NULL
       UNION SELECT DISTINCT _year FROM t_session_info WHERE _year IS NOT NULL ORDER BY 1`,
    )
    .all() as { y: number }[];
  return rows.map((r) => r.y);
}

async function ingestSeason(pool: Pool, src: SqliteDb, year: number, runId: number) {
  const teams = src.prepare(`SELECT Key, ShortName, Colors FROM t_season_teams WHERE _year = ? AND _no_data = 0`).all(year) as Row[];
  const compounds = src.prepare(`SELECT value FROM t_season_compounds WHERE _year = ? AND _no_data = 0`).all(year) as Row[];
  const teamPlaceholder = !!src.prepare(`SELECT 1 FROM t_season_teams WHERE _year = ? LIMIT 1`).get(year);
  await withTransaction(pool, async (c) => {
    await c.query(`INSERT INTO seasons (year) VALUES ($1) ON CONFLICT DO NOTHING`, [year]);
    await c.query(`DELETE FROM season_teams WHERE year = $1`, [year]);
    for (const t of teams) {
      const coloursRaw = convert(t.Colors, 'json', 't_season_teams', 'Colors') as string | null;
      const colours = coloursRaw ? (JSON.parse(coloursRaw) as Record<string, string>) : {};
      await c.query(
        `INSERT INTO season_teams (year, key, short_name, colour_official, colour_fastf1, colours_raw, ingest_run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (year, key) DO NOTHING`,
        [year, convert(t.Key, 'text', 't_season_teams', 'Key'), convert(t.ShortName, 'text', 't_season_teams', 'ShortName'), colours.Official ?? null, colours.FastF1 ?? null, coloursRaw, runId],
      );
    }
    await c.query(`DELETE FROM season_compounds WHERE year = $1`, [year]);
    for (const r of compounds) {
      await c.query(`INSERT INTO season_compounds (year, compound, ingest_run_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
        year,
        convert(r.value, 'text', 't_season_compounds', 'value'),
        runId,
      ]);
    }
    await setAvail(c, 'season', year, 'season_teams', '', teams.length ? 'present' : teamPlaceholder ? 'no_data' : 'missing', teams.length, null, null, runId);
    await setAvail(c, 'season', year, 'season_compounds', '', compounds.length ? 'present' : 'no_data', compounds.length, null, null, runId);
  });
}

interface SessionPlan {
  id: number;
  sourceName: string;
  status: 'archived' | 'missing' | 'upcoming';
}
interface EventPlan {
  id: number;
  year: number;
  round: number;
  sourceName: string;
  sessions: SessionPlan[];
}

interface SchedSession {
  name: string;
  startUtc: string | null;
  startLocal: string | null;
  path: string | null;
}

function toUtcIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function ingestEventsAndSchedule(pool: Pool, src: SqliteDb, year: number, runId: number, summary: Summary): Promise<EventPlan[]> {
  const infos = src.prepare(`SELECT * FROM t_event_info WHERE _year = ? AND _no_data = 0 ORDER BY _round, _event`).all(year) as Row[];
  const seasonEvents = src.prepare(`SELECT * FROM t_season_events WHERE _year = ? AND _no_data = 0 ORDER BY RoundNumber`).all(year) as Row[];

  interface EvSrc {
    round: number;
    sourceName: string;
    name: string;
    row: Row;
    scheduleOnly: boolean;
  }
  const evs: EvSrc[] = infos.map((r) => ({
    round: Number(r._round),
    sourceName: String(r._event),
    name: String(r.EventName ?? r._event),
    row: r,
    scheduleOnly: false,
  }));
  for (const se of seasonEvents) {
    const matched = infos.some((i) => Number(i.RoundNumber) === Number(se.RoundNumber) && i.EventName === se.EventName);
    if (!matched) evs.push({ round: Number(se.RoundNumber), sourceName: String(se.EventName), name: String(se.EventName), row: se, scheduleOnly: true });
  }
  evs.sort((a, b) => a.round - b.round || a.sourceName.localeCompare(b.sourceName));

  const plans: EventPlan[] = [];
  const now = Date.now();
  await withTransaction(pool, async (c) => {
    for (const ev of evs) {
      const meetingRow = src
        .prepare(`SELECT Meeting FROM t_session_info WHERE _year = ? AND _round = ? AND _event = ? AND _no_data = 0 AND Meeting IS NOT NULL LIMIT 1`)
        .get(year, ev.round, ev.sourceName) as { Meeting: string } | undefined;
      let meeting: { Key?: number; Circuit?: { Key?: number; ShortName?: string } } = {};
      if (meetingRow?.Meeting) meeting = JSON.parse(convert(meetingRow.Meeting, 'json', 't_session_info', 'Meeting') as string);

      let slug = eventSlug(ev.sourceName);
      const clash = (
        await c.query(`SELECT 1 FROM events WHERE year = $1 AND slug = $2 AND NOT (round = $3 AND source_name = $4)`, [year, slug, ev.round, ev.sourceName])
      ).rowCount;
      if (clash) slug = `${slug}-r${ev.round}`;

      const r = ev.row;
      const id = (
        await c.query<{ id: number }>(
          `INSERT INTO events (year, round, source_name, slug, name, official_name, country, location, format, circuit_key,
                               circuit_short_name, meeting_key, is_testing, schedule_only, ingest_run_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (year, round, source_name) DO UPDATE SET
             slug = EXCLUDED.slug, name = EXCLUDED.name, official_name = EXCLUDED.official_name, country = EXCLUDED.country,
             location = EXCLUDED.location, format = EXCLUDED.format, circuit_key = EXCLUDED.circuit_key,
             circuit_short_name = COALESCE(EXCLUDED.circuit_short_name, events.circuit_short_name),
             meeting_key = COALESCE(EXCLUDED.meeting_key, events.meeting_key), is_testing = EXCLUDED.is_testing,
             schedule_only = EXCLUDED.schedule_only, ingest_run_id = EXCLUDED.ingest_run_id
           RETURNING id`,
          [
            year,
            ev.round,
            ev.sourceName,
            slug,
            ev.name,
            convert(r.OfficialEventName, 'text', 'events', 'OfficialEventName'),
            convert(r.Country, 'text', 'events', 'Country'),
            convert(r.Location, 'text', 'events', 'Location'),
            convert(r.EventFormat, 'text', 'events', 'EventFormat'),
            convert(r.CircuitKey, 'int', 'events', 'CircuitKey') ?? meeting.Circuit?.Key ?? null,
            meeting.Circuit?.ShortName ?? null,
            meeting.Key ?? null,
            isTestingEvent(ev.sourceName, ev.round),
            ev.scheduleOnly,
            runId,
          ],
        )
      ).rows[0]!.id;

      let sched: SchedSession[];
      if (!ev.scheduleOnly) {
        sched = (
          src.prepare(`SELECT SessionType, StartDate, StartDateUtc, Path FROM t_event_sessions WHERE _year = ? AND _round = ? AND _event = ? AND _no_data = 0`).all(year, ev.round, ev.sourceName) as Row[]
        ).map((s) => ({
          name: String(s.SessionType ?? ''),
          startUtc: toUtcIso(s.StartDateUtc as string),
          startLocal: (s.StartDate as string) ?? null,
          path: (s.Path as string) ?? null,
        }));
      } else {
        const parsed = r.Sessions ? (JSON.parse(String(r.Sessions)) as { SessionType?: string; StartDate?: string; StartDateUtc?: string; Path?: string }[]) : [];
        sched = parsed.map((s) => ({ name: s.SessionType ?? '', startUtc: toUtcIso(s.StartDateUtc), startLocal: s.StartDate ?? null, path: s.Path ?? null }));
      }

      const infoRows = ev.scheduleOnly
        ? []
        : (src.prepare(`SELECT * FROM t_session_info WHERE _year = ? AND _round = ? AND _event = ? AND _no_data = 0`).all(year, ev.round, ev.sourceName) as Row[]);
      const infoByName = new Map(infoRows.map((i) => [String(i._session), i]));

      const candidates = new Map<string, number>();
      for (const s of sched) if (s.name && s.startUtc) candidates.set(s.name, Date.parse(s.startUtc));
      for (const i of infoRows) {
        const t = toUtcIso(i.StartDate as string);
        if (t && !candidates.has(String(i._session))) candidates.set(String(i._session), Date.parse(t));
      }
      const scheduledNames = new Set(sched.filter((s) => s.name).map((s) => s.name));
      for (const s of sched.filter((x) => !x.name)) {
        const t = s.startUtc ? Date.parse(s.startUtc) : NaN;
        let best: string | undefined;
        let bestD = Infinity;
        for (const [name, ct] of candidates) {
          const d = Math.abs(ct - t);
          if (d < bestD) {
            bestD = d;
            best = name;
          }
        }
        if (best && bestD <= 3 * 3600_000) {
          if (scheduledNames.has(best)) {
            s.name = '__duplicate__';
            summary.anomalies.push(`${year} R${ev.round}: blank schedule entry at ${s.startUtc} is a duplicate of "${best}" (dropped)`);
          } else {
            s.name = best;
            scheduledNames.add(best);
            summary.anomalies.push(`${year} R${ev.round}: blank schedule entry at ${s.startUtc} matched to "${best}"`);
          }
        }
      }
      sched = sched.filter((s) => s.name !== '__duplicate__');

      const merged = new Map<string, SchedSession>();
      for (const s of sched) if (s.name) merged.set(s.name, s);
      for (const [name, i] of infoByName) {
        if (!merged.has(name)) merged.set(name, { name, startUtc: toUtcIso(i.StartDate as string), startLocal: (i.StartDate as string) ?? null, path: (i.Path as string) ?? null });
      }
      const unnamed = sched.filter((s) => !s.name);
      unnamed.forEach((s, idx) => {
        summary.anomalies.push(`${year} R${ev.round}: schedule entry at ${s.startUtc} has no session type and could not be matched`);
        merged.set(`Unnamed session ${idx + 1}`, { ...s, name: `Unnamed session ${idx + 1}` });
      });

      const sessions: SessionPlan[] = [];
      const ordered = [...merged.values()].sort((a, b) => (a.startUtc ?? '').localeCompare(b.startUtc ?? ''));
      for (const s of ordered) {
        const info = infoByName.get(s.name);
        const start = s.startUtc ? Date.parse(s.startUtc) : NaN;
        const status: SessionPlan['status'] = info ? 'archived' : Number.isFinite(start) && start > now ? 'upcoming' : 'missing';
        const archiveStatus = info?.ArchiveStatus ? safeJsonField(String(info.ArchiveStatus), 'Status') : null;
        const sid = (
          await c.query<{ id: number }>(
            `INSERT INTO sessions (event_id, source_name, slug, kind, scheduled_start_utc, start_local, end_local, end_utc, gmt_offset,
                                   f1_key, archive_path, archive_status, status, ingest_run_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (event_id, slug) DO UPDATE SET
               source_name = EXCLUDED.source_name, kind = EXCLUDED.kind, scheduled_start_utc = EXCLUDED.scheduled_start_utc,
               start_local = EXCLUDED.start_local, end_local = EXCLUDED.end_local, end_utc = EXCLUDED.end_utc,
               gmt_offset = EXCLUDED.gmt_offset, f1_key = EXCLUDED.f1_key, archive_path = EXCLUDED.archive_path,
               archive_status = EXCLUDED.archive_status, status = EXCLUDED.status
             RETURNING id`,
            [
              id,
              s.name,
              sessionSlug(s.name),
              sessionKind(s.name),
              s.startUtc,
              (info?.StartDate as string) ?? s.startLocal,
              (info?.EndDate as string) ?? null,
              toUtcIso(info?.EndDate as string),
              info?.GmtOffset !== undefined && info?.GmtOffset !== null ? String(info.GmtOffset) : null,
              info ? convert(info.Key, 'int', 't_session_info', 'Key') : null,
              (info?.Path as string) ?? s.path,
              archiveStatus,
              status,
              runId,
            ],
          )
        ).rows[0]!.id;
        sessions.push({ id: sid, sourceName: s.name, status });
        await setAvail(c, 'session', sid, 'session_info', '', info ? 'present' : status === 'upcoming' ? 'upcoming' : 'missing', info ? 1 : 0, null, null, runId);
      }

      const stale = await c.query<{ source_name: string }>(
        `DELETE FROM sessions WHERE event_id = $1 AND NOT (id = ANY($2::int[])) AND status <> 'archived' RETURNING source_name`,
        [id, sessions.map((x) => x.id)],
      );
      for (const r of stale.rows) summary.anomalies.push(`${year} R${ev.round}: removed stale schedule entry "${r.source_name}"`);

      const startUtc = ordered.map((s) => s.startUtc).filter(Boolean).sort()[0] ?? null;
      const endUtc = ordered.map((s) => s.startUtc).filter(Boolean).sort().at(-1) ?? null;
      await c.query(`UPDATE events SET start_utc = $2, end_utc = $3 WHERE id = $1`, [id, startUtc, endUtc]);
      await setAvail(c, 'event', id, 'event_info', '', ev.scheduleOnly ? 'upcoming' : 'present', 1, null, null, runId);
      plans.push({ id, year, round: ev.round, sourceName: ev.sourceName, sessions });
    }
  });
  return plans;
}

function safeJsonField(s: string, field: string): string | null {
  try {
    const v = (JSON.parse(s) as Record<string, unknown>)[field];
    return v === undefined || v === null ? null : String(v);
  } catch {
    return s;
  }
}

async function setAvail(
  c: PoolClient,
  scope: 'season' | 'event' | 'session',
  scopeId: number,
  feed: FeedKey,
  driver: string,
  state: FeedState,
  rows: number | null,
  fingerprint: string | null,
  detail: string | null,
  runId: number,
) {
  await c.query(
    `INSERT INTO feed_availability (scope, scope_id, feed, driver, state, rows, fingerprint, detail, ingest_run_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (scope, scope_id, feed, driver) DO UPDATE SET state = EXCLUDED.state, rows = EXCLUDED.rows,
       fingerprint = EXCLUDED.fingerprint, detail = EXCLUDED.detail, ingest_run_id = EXCLUDED.ingest_run_id, updated_at = now()`,
    [scope, scopeId, feed, driver, state, rows, fingerprint, detail, runId],
  );
}

async function storedFingerprint(c: Pool | PoolClient, scope: string, scopeId: number, feed: string, driver = ''): Promise<string | null> {
  const r = await c.query<{ fingerprint: string | null }>(
    `SELECT fingerprint FROM feed_availability WHERE scope = $1 AND scope_id = $2 AND feed = $3 AND driver = $4`,
    [scope, scopeId, feed, driver],
  );
  return r.rows[0]?.fingerprint ?? null;
}

async function ingestEventFeeds(pool: Pool, src: SqliteDb, ev: EventPlan, runId: number, force: boolean, summary: Summary) {
  for (const spec of EVENT_TABLES) {
    const where = `_year = ? AND _round = ? AND _event = ?`;
    const fp = src.prepare(`SELECT count(*) AS n, max(rowid) AS m, sum(_no_data) AS p FROM ${spec.source} WHERE ${where}`).get(ev.year, ev.round, ev.sourceName) as {
      n: number;
      m: number | null;
      p: number | null;
    };
    const fingerprint = `${fp.n}:${fp.m ?? 0}`;
    if (!force && (await storedFingerprint(pool, 'event', ev.id, spec.feed)) === fingerprint) continue;
    const cols = availableCols(src, spec.source, spec.cols);
    const rows = src.prepare(`SELECT * FROM ${spec.source} WHERE ${where} AND _no_data = 0 ORDER BY rowid`).all(ev.year, ev.round, ev.sourceName) as Row[];
    await withTransaction(pool, async (c) => {
      const constNames = Object.keys(spec.constants ?? {});
      const constVals = Object.values(spec.constants ?? {});
      if (spec.target === 'circuit_points') await c.query(`DELETE FROM circuit_points WHERE event_id = $1 AND kind = $2`, [ev.id, spec.constants!.kind]);
      else await c.query(`DELETE FROM ${spec.target} WHERE event_id = $1`, [ev.id]);
      const n = await copyRows(
        c,
        spec.target,
        ['event_id', ...constNames, ...cols.map((x) => x[1]), 'ingest_run_id'],
        rows.map((r) => [ev.id, ...constVals, ...convertRow(r, cols, spec.source), runId]),
      );
      summary.rows[spec.target] = (summary.rows[spec.target] ?? 0) + n;
      const state: FeedState = rows.length ? 'present' : fp.n > 0 ? 'no_data' : 'missing';
      await setAvail(c, 'event', ev.id, spec.feed, '', state, rows.length, fingerprint, null, runId);
    });
  }
}

async function ingestSession(
  pool: Pool,
  src: SqliteDb,
  tsrc: SqliteDb,
  subset: SubsetInfo | null,
  ev: EventPlan,
  s: SessionPlan,
  runId: number,
  opts: IngestOptions,
  summary: Summary,
  log: (m: string) => void,
): Promise<boolean> {
  const ctx = [ev.year, ev.round, ev.sourceName, s.sourceName] as const;
  const where = `_year = ? AND _round = ? AND _event = ? AND _session = ?`;
  const label = `${ev.year} R${ev.round} ${ev.sourceName} / ${s.sourceName}`;

  const feedPlans = SESSION_TABLES.map((spec) => {
    const fp = src.prepare(`SELECT count(*) AS n, max(rowid) AS m FROM ${spec.source} WHERE ${where}`).get(...ctx) as { n: number; m: number | null };
    return { spec, fingerprint: `${fp.n}:${fp.m ?? 0}`, count: fp.n };
  });

  const wantTelemetry = !opts.skipTelemetry && (!subset || subset.telemetrySessions.has(ctxKey(...ctx)));
  const teleWhere = `year = ? AND round = ? AND session = ?${ev.round === 0 ? ' AND event = ?' : ''}`;
  const teleArgs: (string | number)[] = ev.round === 0 ? [ev.year, ev.round, s.sourceName, ev.sourceName] : [ev.year, ev.round, s.sourceName];
  let teleFingerprint: string | null = null;
  if (wantTelemetry) {
    const counts = tsrc.prepare(`SELECT driver, count(*) AS n FROM telemetry WHERE ${teleWhere} GROUP BY driver ORDER BY driver`).all(...teleArgs) as {
      driver: string;
      n: number;
    }[];
    teleFingerprint = counts.map((c) => `${c.driver}=${c.n}`).join(',') || 'empty';
  }

  const changed: typeof feedPlans = [];
  for (const p of feedPlans) {
    if (opts.force || (await storedFingerprint(pool, 'session', s.id, p.spec.feed)) !== p.fingerprint) changed.push(p);
  }
  const teleChanged = wantTelemetry && (opts.force || (await storedFingerprint(pool, 'session', s.id, 'telemetry')) !== teleFingerprint);
  const needsNotImportedMark =
    !wantTelemetry &&
    !opts.skipTelemetry &&
    (
      await pool.query(
        `SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM telemetry_summary WHERE session_id = $1)
           AND NOT EXISTS (SELECT 1 FROM feed_availability WHERE scope = 'session' AND scope_id = $1 AND feed = 'telemetry' AND driver = '' AND state = 'not_imported')`,
        [s.id],
      )
    ).rowCount === 1;

  if (!changed.length && !teleChanged && !needsNotImportedMark) return false;

  const started = Date.now();
  await withTransaction(pool, async (c) => {
    for (const { spec, fingerprint, count } of changed) {
      const rows = src.prepare(`SELECT * FROM ${spec.source} WHERE ${where} ORDER BY rowid`).all(...ctx) as Row[];
      const real = rows.filter((r) => r._no_data === 0);
      if (spec.target) {
        const cols = availableCols(src, spec.source, spec.cols);
        await c.query(`DELETE FROM ${spec.target} WHERE session_id = $1`, [s.id]);
        let out = real.map((r) => [s.id, ...convertRow(r, cols, spec.source), runId]);
        if (spec.target === 'session_drivers') {
          const seen = new Set<unknown>();
          out = out.filter((row) => {
            const k = row[1];
            if (seen.has(k)) {
              summary.anomalies.push(`${label}: duplicate driver ${String(k)} in t_session_drivers (first kept)`);
              return false;
            }
            seen.add(k);
            return true;
          });
        }
        const n = await copyRows(c, spec.target, ['session_id', ...cols.map((x) => x[1]), 'ingest_run_id'], out);
        summary.rows[spec.target] = (summary.rows[spec.target] ?? 0) + n;
      }
      const state: FeedState = real.length ? 'present' : count > 0 ? 'no_data' : 'missing';
      await setAvail(c, 'session', s.id, spec.feed, '', state, real.length, fingerprint, null, runId);
      if (spec.perDriver) {
        await c.query(`DELETE FROM feed_availability WHERE scope = 'session' AND scope_id = $1 AND feed = $2 AND driver <> ''`, [s.id, spec.feed]);
        const byDriver = new Map<string, { real: number; any: number }>();
        for (const r of rows) {
          const d = r._driver === null || r._driver === undefined ? '' : String(r._driver);
          if (!d) continue;
          const e = byDriver.get(d) ?? { real: 0, any: 0 };
          e.any++;
          if (r._no_data === 0) e.real++;
          byDriver.set(d, e);
        }
        for (const [d, e] of byDriver) await setAvail(c, 'session', s.id, spec.feed, d, e.real ? 'present' : 'no_data', e.real, null, null, runId);
      }
    }

    if (teleChanged) {
      const n = await ingestTelemetry(c, tsrc, ev, s, teleWhere, teleArgs, runId, summary);
      await setAvail(c, 'session', s.id, 'telemetry', '', n > 0 ? 'present' : 'no_data', n, teleFingerprint, null, runId);
      summary.telemetry_sessions++;
      summary.telemetry_rows += n;
    } else if (needsNotImportedMark) {
      await setAvail(c, 'session', s.id, 'telemetry', '', 'not_imported', null, null, null, runId);
    }

    await c.query(`UPDATE sessions SET ingest_run_id = $2, ingested_at = now() WHERE id = $1`, [s.id, runId]);
  });
  log(`${label}: ${changed.length} feeds${teleChanged ? ' + telemetry' : ''} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return true;
}

async function ingestTelemetry(
  c: PoolClient,
  tsrc: SqliteDb,
  ev: EventPlan,
  s: SessionPlan,
  teleWhere: string,
  teleArgs: (string | number)[],
  runId: number,
  summary: Summary,
): Promise<number> {
  await ensureTelemetryPartition(c, ev.year);
  await c.query(`DELETE FROM telemetry WHERE year = $1 AND session_id = $2`, [ev.year, s.id]);
  await c.query(`DELETE FROM telemetry_summary WHERE session_id = $1`, [s.id]);

  interface Sum {
    samples: number;
    car: number;
    pos: number;
    min: number | null;
    max: number | null;
  }
  const sums = new Map<number, Sum>();
  const drs = new Map<number, string>();
  let skippedNullTs = 0;
  const label = `${ev.year} R${ev.round} ${s.sourceName}`;

  const stmt = tsrc.prepare(
    `SELECT driver, ts, rpm, speed, gear, throttle, brake, drs, drs_no, x, y, z FROM telemetry WHERE ${teleWhere} ORDER BY driver, ts`,
  );
  const tbl = `telemetry_y${ev.year}`;
  const intOrNull = (v: unknown, col: string): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    const conv = convert(v, 'int', 'telemetry', col);
    return conv as number | null;
  };
  const smallint = (v: unknown, col: string): number | null => {
    const n = intOrNull(v, col);
    if (n !== null && (n > 32767 || n < -32768)) throw new ConversionError('telemetry', col, v, 'int');
    return n;
  };
  const real = (v: unknown, col: string): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    return convert(v, 'float', 'telemetry', col) as number | null;
  };

  let lastDriverText = '';
  let lastDriver = 0;
  function* rows() {
    for (const r of stmt.iterate(...teleArgs) as Iterable<Record<string, unknown>>) {
      if (r.ts === null || r.ts === undefined) {
        skippedNullTs++;
        continue;
      }
      const dText = String(r.driver);
      if (dText !== lastDriverText) {
        lastDriverText = dText;
        lastDriver = parseDriverNumber(dText);
      }
      const ts = intOrNull(r.ts, 'ts')!;
      const drsNo = smallint(r.drs_no, 'drs_no');
      if (drsNo !== null && r.drs !== null && r.drs !== undefined && !drs.has(drsNo)) drs.set(drsNo, String(r.drs));
      const rpm = intOrNull(r.rpm, 'rpm');
      const speed = smallint(r.speed, 'speed');
      const x = real(r.x, 'x');
      let sum = sums.get(lastDriver);
      if (!sum) {
        sum = { samples: 0, car: 0, pos: 0, min: null, max: null };
        sums.set(lastDriver, sum);
      }
      sum.samples++;
      if (rpm !== null || speed !== null) sum.car++;
      if (x !== null) sum.pos++;
      if (sum.min === null || ts < sum.min) sum.min = ts;
      if (sum.max === null || ts > sum.max) sum.max = ts;
      yield [
        ts,
        s.id,
        lastDriver,
        x,
        real(r.y, 'y'),
        real(r.z, 'z'),
        rpm,
        ev.year,
        speed,
        smallint(r.gear, 'gear'),
        smallint(r.throttle, 'throttle'),
        smallint(r.brake, 'brake'),
        drsNo,
      ] as (number | null)[];
    }
  }
  const n = await copyRows(c, tbl, ['ts_ns', 'session_id', 'driver_number', 'x', 'y', 'z', 'rpm', 'year', 'speed', 'gear', 'throttle', 'brake', 'drs'], rows());
  if (skippedNullTs) summary.anomalies.push(`${label}: ${skippedNullTs} telemetry rows without a timestamp were not imported`);

  for (const [d, sm] of sums) {
    await c.query(
      `INSERT INTO telemetry_summary (session_id, driver_number, samples, car_samples, pos_samples, min_ts_ns, max_ts_ns, ingest_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s.id, d, sm.samples, sm.car, sm.pos, sm.min, sm.max, runId],
    );
  }
  for (const [code, lbl] of drs) {
    await c.query(`INSERT INTO drs_codes (code, label) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`, [code, lbl]);
  }

  await c.query(`DELETE FROM feed_availability WHERE scope = 'session' AND scope_id = $1 AND feed = 'telemetry' AND driver <> ''`, [s.id]);
  const listed = (await c.query<{ driver_number: string }>(`SELECT driver_number FROM session_drivers WHERE session_id = $1`, [s.id])).rows.map((r) => r.driver_number);
  const all = new Set<string>([...listed, ...[...sums.keys()].map(String)]);
  for (const d of all) {
    const sm = sums.get(Number(d));
    let state: FeedState = 'no_data';
    let detail: string | null = null;
    if (sm) {
      if (sm.car > 0 && sm.pos > 0) state = 'present';
      else {
        state = 'partial';
        detail = sm.car > 0 ? 'position' : 'car';
      }
    }
    await setAvail(c, 'session', s.id, 'telemetry', d, state, sm?.samples ?? 0, null, detail, runId);
  }
  return n;
}

async function postProcess(pool: Pool, log: (m: string) => void) {
  log('post-processing derived fields');
  await pool.query(`UPDATE session_drivers SET driver_id = NULL WHERE driver_id IS NOT NULL`);
  await pool.query(`
    UPDATE session_drivers sd SET driver_id = r.driver_id
    FROM results r WHERE r.session_id = sd.session_id AND r.driver_number = sd.driver_number AND nullif(r.driver_id, '') IS NOT NULL`);
  await pool.query(`
    UPDATE session_drivers sd SET driver_id = x.driver_id
    FROM (
      SELECT DISTINCT ON (s.event_id, dr.driver_number) s.event_id, dr.driver_number, upper(dr.abbreviation) AS abbr, dr.driver_id
      FROM driver_reference dr JOIN sessions s ON s.id = dr.session_id
      WHERE nullif(dr.driver_id, '') IS NOT NULL ORDER BY s.event_id, dr.driver_number
    ) x, sessions s2
    WHERE s2.id = sd.session_id AND s2.event_id = x.event_id AND x.driver_number = sd.driver_number
      AND x.abbr = upper(sd.abbreviation) AND sd.driver_id IS NULL`);
  await pool.query(`
    UPDATE session_drivers sd SET driver_id = x.driver_id
    FROM (
      SELECT DISTINCT e.year, s.driver_number, upper(s.abbreviation) AS abbr, s.driver_id
      FROM session_drivers s JOIN sessions ss ON ss.id = s.session_id JOIN events e ON e.id = ss.event_id
      WHERE s.driver_id IS NOT NULL
    ) x, sessions s2, events e2
    WHERE s2.id = sd.session_id AND e2.id = s2.event_id AND x.year = e2.year AND x.driver_number = sd.driver_number
      AND x.abbr = upper(sd.abbreviation) AND sd.driver_id IS NULL`);
  await pool.query(`
    UPDATE session_drivers sd SET driver_id = x.driver_id
    FROM (
      SELECT upper(full_name) AS n, min(driver_id) AS driver_id FROM session_drivers
      WHERE driver_id IS NOT NULL AND full_name IS NOT NULL GROUP BY upper(full_name) HAVING count(DISTINCT driver_id) = 1
    ) x
    WHERE upper(sd.full_name) = x.n AND sd.driver_id IS NULL`);
  await withTransaction(pool, async (c) => {
    await c.query(`DELETE FROM team_names`);
    await c.query(`
      INSERT INTO team_names (year, team_name, constructor_id, colour)
      SELECT n.year, n.team_name, v.cid, col.colour
      FROM (
        SELECT DISTINCT e.year, r.team_name FROM results r JOIN sessions s ON s.id = r.session_id JOIN events e ON e.id = s.event_id
        WHERE nullif(r.team_name, '') IS NOT NULL
      ) n
      LEFT JOIN LATERAL (
        SELECT cid FROM results r JOIN sessions s ON s.id = r.session_id JOIN events e ON e.id = s.event_id
        JOIN standings_drivers sd ON sd.event_id = e.id AND sd.driver_id = nullif(r.driver_id, '')
        CROSS JOIN LATERAL unnest(sd.constructor_ids) AS cid
        WHERE e.year = n.year AND r.team_name = n.team_name AND s.kind IN ('race', 'sprint')
        GROUP BY cid ORDER BY count(*) DESC, cid LIMIT 1
      ) v ON true
      LEFT JOIN LATERAL (
        SELECT sd2.team_colour AS colour FROM session_drivers sd2 JOIN sessions s2 ON s2.id = sd2.session_id JOIN events e2 ON e2.id = s2.event_id
        WHERE e2.year = n.year AND sd2.team_name = n.team_name AND nullif(sd2.team_colour, '') IS NOT NULL
        GROUP BY sd2.team_colour ORDER BY count(*) DESC LIMIT 1
      ) col ON true`);
  });
  await pool.query(`
    UPDATE sessions s SET stream_start_utc = x.t0 FROM (
      SELECT session_id,
             to_timestamp(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM utc) - ts_ns / 1e9)) AS t0
      FROM team_radio WHERE utc IS NOT NULL AND ts_ns IS NOT NULL GROUP BY session_id
    ) x WHERE x.session_id = s.id`);
  await pool.query(`
    UPDATE sessions s SET total_laps = x.n FROM (
      SELECT session_id, max(total_laps) AS n FROM progress GROUP BY session_id
    ) x WHERE x.session_id = s.id`);
  await pool.query(`
    UPDATE sessions s SET total_laps = x.n FROM (
      SELECT session_id, max(laps) AS n FROM results GROUP BY session_id
    ) x WHERE x.session_id = s.id AND s.total_laps IS NULL AND s.kind IN ('race', 'sprint')`);
  await pool.query(`
    UPDATE sessions s SET time_from_ns = x.a, time_to_ns = x.b FROM (
      SELECT session_id, min(min_ts_ns) AS a, max(max_ts_ns) AS b FROM telemetry_summary GROUP BY session_id
    ) x WHERE x.session_id = s.id`);
  await pool.query(`
    UPDATE sessions s SET time_from_ns = x.a, time_to_ns = x.b FROM (
      SELECT session_id, min(coalesce(start_ns, end_ns - lap_time_ns)) AS a, max(end_ns) AS b FROM laps GROUP BY session_id
    ) x WHERE x.session_id = s.id AND s.time_from_ns IS NULL`);
}
