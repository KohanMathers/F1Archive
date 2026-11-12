import type { Pool } from '@f1archive/db';
import {
  TRACK_STATUS,
  normaliseColour,
  sessionKind,
  type EventSummary,
  type FeedKey,
  type FeedState,
  type FeedStatus,
  type SessionDetail,
  type SessionDriver,
  type SessionSummary,
  type TimelineEvent,
  type TrackOutline,
  type TrackPeriod,
} from '@f1archive/shared';
import { Cache } from './cache.js';
import { notFound } from './errors.js';

export interface SessionRef {
  id: number;
  event_id: number;
  year: number;
  round: number;
  event_slug: string;
  event_name: string;
  event_source_name: string;
  slug: string;
  source_name: string;
  status: 'archived' | 'missing' | 'upcoming';
  archive_path: string | null;
  key: string;
}

const refCache = new Cache<SessionRef | null>(5000, 60_000);

export async function resolveSession(db: Pool, year: number, eventSlug: string, sessionSlug: string): Promise<SessionRef> {
  const ref = await refCache.get(`${year}/${eventSlug}/${sessionSlug}`, async () => {
    const r = await db.query<SessionRef>(
      `SELECT s.id, s.event_id, e.year, e.round, e.slug AS event_slug, e.name AS event_name, e.source_name AS event_source_name,
              s.slug, s.source_name, s.status, s.archive_path, e.year || '-' || e.slug || '-' || s.slug AS key
       FROM sessions s JOIN events e ON e.id = s.event_id WHERE e.year = $1 AND e.slug = $2 AND s.slug = $3`,
      [year, eventSlug, sessionSlug],
    );
    return r.rows[0] ?? null;
  });
  if (!ref) throw notFound(`Session ${year}/${eventSlug}/${sessionSlug}`);
  return ref;
}

export function clearCaches() {
  refCache.clear();
  detailCache.clear();
  outlineCache.clear();
}

export const SESSION_SUMMARY_SQL = `
  SELECT e.year || '-' || e.slug || '-' || s.slug AS key, e.year, e.slug AS event, s.slug, s.source_name AS name, s.kind,
         s.scheduled_start_utc AS start_utc, s.start_local, s.status,
         EXISTS (SELECT 1 FROM telemetry_summary t WHERE t.session_id = s.id) AS has_telemetry,
         EXISTS (SELECT 1 FROM team_radio r WHERE r.session_id = s.id) AS has_radio
  FROM sessions s JOIN events e ON e.id = s.event_id`;

export function mapSession(r: Record<string, unknown>): SessionSummary {
  return {
    key: r.key as string,
    year: r.year as number,
    event: r.event as string,
    slug: r.slug as string,
    name: r.name as string,
    kind: (r.kind as SessionSummary['kind']) ?? sessionKind(r.name as string),
    start_utc: r.start_utc ? new Date(r.start_utc as string).toISOString() : null,
    start_local: (r.start_local as string) ?? null,
    status: r.status as SessionSummary['status'],
    has_telemetry: !!r.has_telemetry,
    has_radio: !!r.has_radio,
  };
}

export async function listEvents(db: Pool, year: number, eventSlug?: string): Promise<EventSummary[]> {
  const evs = await db.query(
    `SELECT id, year, slug, round, name, official_name, country, location, circuit_short_name AS circuit, circuit_key, format,
            is_testing, start_utc, end_utc
     FROM events WHERE year = $1 ${eventSlug ? 'AND slug = $2' : ''} ORDER BY start_utc NULLS LAST, round`,
    eventSlug ? [year, eventSlug] : [year],
  );
  if (!evs.rows.length) return [];
  const ss = await db.query(`${SESSION_SUMMARY_SQL} WHERE s.event_id = ANY($1::int[]) ORDER BY s.scheduled_start_utc NULLS LAST, s.id`, [
    evs.rows.map((e) => e.id),
  ]);
  const byEvent = new Map<string, SessionSummary[]>();
  for (const r of ss.rows) {
    const k = r.event as string;
    if (!byEvent.has(k)) byEvent.set(k, []);
    byEvent.get(k)!.push(mapSession(r));
  }
  return evs.rows.map((e) => ({
    key: `${e.year}-${e.slug}`,
    year: e.year,
    slug: e.slug,
    round: e.round,
    name: e.name,
    official_name: e.official_name,
    country: e.country,
    location: e.location,
    circuit: e.circuit,
    circuit_key: e.circuit_key,
    format: e.format,
    is_testing: e.is_testing,
    start_utc: e.start_utc ? new Date(e.start_utc).toISOString() : null,
    end_utc: e.end_utc ? new Date(e.end_utc).toISOString() : null,
    sessions: byEvent.get(e.slug) ?? [],
  }));
}

const detailCache = new Cache<SessionDetail>(500, 60_000);

export function getSessionDetail(db: Pool, ref: SessionRef): Promise<SessionDetail> {
  return detailCache.get(String(ref.id), async () => {
    const s = (
      await db.query(
        `${SESSION_SUMMARY_SQL.replace('SELECT ', `SELECT s.end_utc, s.gmt_offset, s.archive_path, s.stream_start_utc, s.total_laps,
           s.time_from_ns, s.time_to_ns, e.name AS event_name, e.round AS event_round, e.circuit_short_name AS circuit, e.circuit_key, `)}
         WHERE s.id = $1`,
        [ref.id],
      )
    ).rows[0]!;
    const drivers = await db.query(
      `SELECT sd.driver_number AS number, sd.abbreviation, sd.full_name, sd.broadcast_name, sd.team_name, sd.team_colour,
              sd.reference, sd.driver_id, sd.headshot_url, sd.country_code,
              fa.state AS telemetry, ts.samples AS telemetry_samples
       FROM session_drivers sd
       LEFT JOIN feed_availability fa ON fa.scope = 'session' AND fa.scope_id = sd.session_id AND fa.feed = 'telemetry' AND fa.driver = sd.driver_number
       LEFT JOIN telemetry_summary ts ON ts.session_id = sd.session_id AND ts.driver_number::text = sd.driver_number
       LEFT JOIN results r ON r.session_id = sd.session_id AND r.driver_number = sd.driver_number
       WHERE sd.session_id = $1
       ORDER BY r.position NULLS LAST, sd.line NULLS LAST, sd.driver_number`,
      [ref.id],
    );
    const sessionTelemetry = (
      await db.query<{ state: FeedState }>(`SELECT state FROM feed_availability WHERE scope = 'session' AND scope_id = $1 AND feed = 'telemetry' AND driver = ''`, [ref.id])
    ).rows[0]?.state;
    const feeds = await db.query<{ feed: FeedKey; state: FeedState; rows: number | null }>(
      `SELECT feed, state, rows FROM feed_availability WHERE scope = 'session' AND scope_id = $1 AND driver = '' ORDER BY feed`,
      [ref.id],
    );
    const notes: string[] = [];
    if (ref.year === 2021 && ref.source_name === 'Sprint Qualifying')
      notes.push('In 2021 the session F1 called "Sprint Qualifying" was the short Saturday race that set the Sunday grid.');
    const detail: SessionDetail = {
      ...mapSession(s),
      event_name: s.event_name,
      event_round: s.event_round,
      circuit: s.circuit,
      circuit_key: s.circuit_key,
      end_utc: s.end_utc ? new Date(s.end_utc).toISOString() : null,
      gmt_offset: s.gmt_offset,
      archive_path: s.archive_path,
      stream_start_utc: s.stream_start_utc ? new Date(s.stream_start_utc).toISOString() : null,
      time_range_ns: s.time_from_ns != null && s.time_to_ns != null ? { from: s.time_from_ns, to: s.time_to_ns } : null,
      total_laps: s.total_laps,
      drivers: drivers.rows.map(
        (d): SessionDriver => ({
          ...d,
          team_colour: normaliseColour(d.team_colour),
          telemetry: (d.telemetry as FeedState | null) ?? (sessionTelemetry === 'not_imported' ? 'not_imported' : 'no_data'),
          telemetry_samples: d.telemetry_samples ?? null,
        }),
      ),
      feeds: feeds.rows.map((f): FeedStatus => ({ feed: f.feed, state: f.state, rows: f.rows })),
      notes,
    };
    return detail;
  });
}

export interface Timeline {
  session: string;
  periods: TrackPeriod[];
  events: TimelineEvent[];
  laps: { lap: number; t_ns: number }[];
}

export async function getTimeline(db: Pool, ref: SessionRef, radioUrl: (id: number) => string | null): Promise<Timeline> {
  const [ts, rc, radio, pits, status, progress, weather] = await Promise.all([
    db.query(`SELECT ts_ns, status, message FROM track_status WHERE session_id = $1 ORDER BY ts_ns`, [ref.id]),
    db.query(`SELECT id, ts_ns, message, category, flag, scope, sector, driver_number, lap FROM race_control WHERE session_id = $1 ORDER BY ts_ns, id`, [ref.id]),
    db.query(`SELECT id, ts_ns, driver_number, file_available FROM team_radio WHERE session_id = $1 ORDER BY ts_ns, id`, [ref.id]),
    db.query(
      `SELECT driver_number, lap_no, pit_in_ns, pit_out_ns FROM laps WHERE session_id = $1 AND (pit_in_ns IS NOT NULL OR pit_out_ns IS NOT NULL) ORDER BY coalesce(pit_in_ns, pit_out_ns)`,
      [ref.id],
    ),
    db.query(`SELECT ts_ns, status FROM status_events WHERE session_id = $1 ORDER BY ts_ns`, [ref.id]),
    db.query(`SELECT DISTINCT ON (current_lap) current_lap, ts_ns FROM progress WHERE session_id = $1 AND current_lap IS NOT NULL ORDER BY current_lap, ts_ns`, [ref.id]),
    db.query(`SELECT ts_ns, rainfall FROM weather WHERE session_id = $1 ORDER BY ts_ns`, [ref.id]),
  ]);

  const periods: TrackPeriod[] = [];
  const events: TimelineEvent[] = [];
  for (let i = 0; i < ts.rows.length; i++) {
    const r = ts.rows[i]!;
    const meta = TRACK_STATUS[r.status as string] ?? { label: r.message ?? `Status ${r.status}`, tone: 'yellow' as const };
    const next = ts.rows[i + 1];
    periods.push({ status: r.status, label: meta.label, tone: meta.tone, from_ns: r.ts_ns, to_ns: next ? next.ts_ns : null });
    if (r.status !== '1' || i > 0) events.push({ t_ns: r.ts_ns, type: 'track_status', label: meta.label, detail: r.message, tone: meta.tone });
  }
  for (const r of rc.rows) {
    events.push({
      t_ns: r.ts_ns,
      type: 'race_control',
      label: r.message,
      detail: null,
      fields: ([['Category', r.category], ['Flag', r.flag], ['Scope', r.scope], ['Sector', r.sector], ['Lap', r.lap]] as [string, unknown][])
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)] as [string, string]),
      driver: r.driver_number,
      tone: r.flag ?? r.category,
      id: `rc-${r.id}`,
    });
  }
  for (const r of radio.rows) {
    events.push({
      t_ns: r.ts_ns,
      type: 'radio',
      label: 'Team radio',
      driver: r.driver_number,
      audio_url: r.file_available ? radioUrl(Number(r.id)) : null,
      id: `radio-${r.id}`,
    });
  }
  for (const r of pits.rows) {
    if (r.pit_in_ns != null) events.push({ t_ns: r.pit_in_ns, type: 'pit', label: 'Pit in', driver: r.driver_number, fields: [['Lap', String(r.lap_no)]] });
    if (r.pit_out_ns != null) events.push({ t_ns: r.pit_out_ns, type: 'pit', label: 'Pit out', driver: r.driver_number, fields: [['Lap', String(r.lap_no)]] });
  }
  for (const r of status.rows) events.push({ t_ns: r.ts_ns, type: 'session_status', label: `Session ${String(r.status).toLowerCase()}` });
  let lastRain: boolean | null = null;
  for (const r of weather.rows) {
    if (r.rainfall === null) continue;
    if (lastRain !== null && r.rainfall !== lastRain) events.push({ t_ns: r.ts_ns, type: 'weather', label: r.rainfall ? 'Rain started' : 'Rain stopped' });
    lastRain = r.rainfall;
  }
  const lapMarks = progress.rows.map((r) => ({ lap: r.current_lap as number, t_ns: r.ts_ns as number }));
  for (const l of lapMarks) if (l.lap > 1) events.push({ t_ns: l.t_ns, type: 'lap', label: `Lap ${l.lap}` });
  events.sort((a, b) => a.t_ns - b.t_ns);
  return { session: ref.key, periods, events, laps: lapMarks };
}

const outlineCache = new Cache<TrackOutline>(300, 3600_000);

export function getTrackOutline(db: Pool, ref: SessionRef): Promise<TrackOutline> {
  return outlineCache.get(String(ref.id), async () => {
    const points = (
      await db.query(
        `SELECT kind, number, letter, x, y, angle FROM circuit_points WHERE event_id = $1 AND x IS NOT NULL AND y IS NOT NULL ORDER BY kind, number, letter`,
        [ref.event_id],
      )
    ).rows;
    const corners = points.filter((p) => p.kind === 'corner').map(({ kind: _k, ...p }) => p);
    const marshal = (kind: string) => points.filter((p) => p.kind === kind).map((p) => ({ number: p.number, x: p.x, y: p.y, angle: p.angle }));
    const marshal_lights = marshal('marshal_light');
    const marshal_sectors = marshal('marshal_sector');
    const laps = (
      await db.query(
        `SELECT l.driver_number, l.lap_no, l.start_ns, l.end_ns FROM laps l
         JOIN telemetry_summary t ON t.session_id = l.session_id AND t.driver_number::text = l.driver_number AND t.pos_samples > 0
         WHERE l.session_id = $1 AND l.lap_time_ns IS NOT NULL AND l.start_ns IS NOT NULL AND l.end_ns IS NOT NULL
           AND coalesce(l.deleted, false) = false AND l.pit_in_ns IS NULL AND l.pit_out_ns IS NULL
         ORDER BY l.lap_time_ns LIMIT 8`,
        [ref.id],
      )
    ).rows;
    for (const lap of laps) {
      const raw = (
        await db.query<{ x: number; y: number }>(
          `SELECT x, y FROM telemetry WHERE session_id = $1 AND driver_number = $2 AND ts_ns BETWEEN $3 AND $4
             AND x IS NOT NULL AND NOT (x = 0 AND y = 0 AND z = 0) ORDER BY ts_ns`,
          [ref.id, Number(lap.driver_number), lap.start_ns, lap.end_ns],
        )
      ).rows;
      const pts = raw.filter((p, i) => i === 0 || p.x !== raw[i - 1]!.x || p.y !== raw[i - 1]!.y);
      if (pts.length < 100) continue;
      const step = Math.max(1, Math.floor(pts.length / 900));
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < pts.length; i += step) {
        xs.push(pts[i]!.x);
        ys.push(pts[i]!.y);
      }
      xs.push(pts[0]!.x);
      ys.push(pts[0]!.y);
      return {
        session: ref.key,
        x: xs,
        y: ys,
        source: { driver: lap.driver_number, lap: lap.lap_no },
        corners,
        marshal_lights,
        marshal_sectors,
        bounds: bounds(xs, ys, corners),
        rotation: 0,
      };
    }
    return { session: ref.key, x: [], y: [], source: null, corners, marshal_lights, marshal_sectors, bounds: corners.length ? bounds([], [], corners) : null, rotation: 0 };
  });
}

function bounds(xs: number[], ys: number[], corners: { x: number; y: number }[]) {
  const ax = [...xs, ...corners.map((c) => c.x)];
  const ay = [...ys, ...corners.map((c) => c.y)];
  return { minX: Math.min(...ax), maxX: Math.max(...ax), minY: Math.min(...ay), maxY: Math.max(...ay) };
}
