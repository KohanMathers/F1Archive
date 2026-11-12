import type { ExportCategory, ExportEstimate, ExportRequest, TelemetryChannel } from '@f1archive/shared';
import type pg from 'pg';

export type ColType = 'text' | 'integer' | 'real' | 'boolean' | 'timestamp';

export interface ExportColumn {
  name: string;
  type: ColType;
  unit?: string;
  description: string;
  sql: string;
  channel?: TelemetryChannel;
  derived?: boolean;
}

export interface CategoryDef {
  key: ExportCategory;
  label: string;
  description: string;
  from: string;
  driverCol?: string;
  keepUnattributed?: boolean;
  timeCol?: string;
  orderBy: string;
  columns: ExportColumn[];
  bytesPerRow: number;
}

const SESSION_COLS: ExportColumn[] = [
  { name: 'session_key', type: 'text', description: 'Stable session identifier, e.g. 2021-abu-dhabi-race.', sql: `e.year || '-' || e.slug || '-' || s.slug` },
];

const JOIN = `JOIN sessions s ON s.id = x.session_id JOIN events e ON e.id = s.event_id`;

export const CATEGORIES: Record<ExportCategory, CategoryDef> = {
  sessions: {
    key: 'sessions',
    label: 'Session information',
    description: 'One row per session: event, circuit, schedule and archive status.',
    from: `sessions s JOIN events e ON e.id = s.event_id`,
    orderBy: 'e.year, e.round, s.scheduled_start_utc',
    bytesPerRow: 400,
    columns: [
      ...SESSION_COLS,
      { name: 'year', type: 'integer', description: 'Season.', sql: 'e.year' },
      { name: 'round', type: 'integer', description: 'Round number. Testing events are round 0.', sql: 'e.round' },
      { name: 'event', type: 'text', description: 'Event name.', sql: 'e.name' },
      { name: 'event_slug', type: 'text', description: 'Event identifier within the season.', sql: 'e.slug' },
      { name: 'official_event_name', type: 'text', description: 'Official event name.', sql: 'e.official_name' },
      { name: 'circuit', type: 'text', description: 'Circuit short name (F1).', sql: 'e.circuit_short_name' },
      { name: 'circuit_key', type: 'integer', description: 'F1 circuit key.', sql: 'e.circuit_key' },
      { name: 'location', type: 'text', description: 'Location.', sql: 'e.location' },
      { name: 'country', type: 'text', description: 'Country.', sql: 'e.country' },
      { name: 'event_format', type: 'text', description: 'conventional, sprint or testing.', sql: 'e.format' },
      { name: 'session', type: 'text', description: 'Session name as published by F1.', sql: 's.source_name' },
      { name: 'session_slug', type: 'text', description: 'Session identifier within the event.', sql: 's.slug' },
      { name: 'session_kind', type: 'text', description: 'practice, qualifying, sprint-qualifying, sprint, race, testing or other.', sql: 's.kind' },
      { name: 'scheduled_start_utc', type: 'timestamp', description: 'Scheduled start (UTC).', sql: 's.scheduled_start_utc' },
      { name: 'start_local', type: 'text', description: 'Start in local time with offset, as published.', sql: 's.start_local' },
      { name: 'status', type: 'text', description: 'archived, missing or upcoming in this archive.', sql: 's.status' },
      { name: 'stream_start_utc', type: 'timestamp', unit: 'UTC', description: 'UTC instant of session time 0, derived from team radio timestamps.', sql: 's.stream_start_utc', derived: true },
      { name: 'total_laps', type: 'integer', description: 'Scheduled/final lap count for races and sprints.', sql: 's.total_laps' },
      { name: 'archive_path', type: 'text', description: "Folder of the session on F1's live timing archive.", sql: 's.archive_path' },
    ],
  },
  drivers: {
    key: 'drivers',
    label: 'Session drivers',
    description: 'Drivers in each session with team and colour.',
    from: `session_drivers x ${JOIN}`,
    driverCol: 'x.driver_number',
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.line NULLS LAST',
    bytesPerRow: 200,
    columns: [
      ...SESSION_COLS,
      { name: 'driver_number', type: 'text', description: 'Car number in this session.', sql: 'x.driver_number' },
      { name: 'abbreviation', type: 'text', description: 'Three-letter abbreviation.', sql: 'x.abbreviation' },
      { name: 'full_name', type: 'text', description: 'Name as published by F1.', sql: 'x.full_name' },
      { name: 'team_name', type: 'text', description: 'Team name in this session.', sql: 'x.team_name' },
      { name: 'team_colour', type: 'text', description: 'Team colour hex as published by F1.', sql: 'x.team_colour' },
      { name: 'driver_id', type: 'text', description: 'Jolpica/Ergast driver identifier.', sql: 'x.driver_id' },
      { name: 'reference', type: 'text', description: 'F1 driver reference, e.g. MAXVER01.', sql: 'x.reference' },
      { name: 'country_code', type: 'text', description: 'Country code.', sql: 'x.country_code' },
    ],
  },
  results: {
    key: 'results',
    label: 'Results',
    description: 'Classification, grid, qualifying times, points and status.',
    from: `results x ${JOIN}`,
    driverCol: 'x.driver_number',
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.position NULLS LAST',
    bytesPerRow: 200,
    columns: [
      ...SESSION_COLS,
      { name: 'driver_number', type: 'text', description: 'Car number.', sql: 'x.driver_number' },
      { name: 'driver_id', type: 'text', description: 'Jolpica driver id.', sql: 'x.driver_id' },
      { name: 'abbreviation', type: 'text', description: 'Abbreviation.', sql: 'x.abbreviation' },
      { name: 'team_name', type: 'text', description: 'Team.', sql: 'x.team_name' },
      { name: 'position', type: 'integer', description: 'Classified position.', sql: 'x.position' },
      { name: 'position_text', type: 'text', description: 'Position as text (e.g. R for retired).', sql: 'x.position_text' },
      { name: 'grid_position', type: 'integer', description: 'Starting grid position.', sql: 'x.grid_position' },
      { name: 'q1_ns', type: 'integer', unit: 'ns', description: 'Q1 time.', sql: 'x.q1_ns' },
      { name: 'q2_ns', type: 'integer', unit: 'ns', description: 'Q2 time.', sql: 'x.q2_ns' },
      { name: 'q3_ns', type: 'integer', unit: 'ns', description: 'Q3 time.', sql: 'x.q3_ns' },
      { name: 'laps', type: 'integer', description: 'Laps completed.', sql: 'x.laps' },
      { name: 'status', type: 'text', description: 'Finishing status.', sql: 'x.status' },
      { name: 'points', type: 'real', description: 'Points scored.', sql: 'x.points' },
      { name: 'time_ns', type: 'integer', unit: 'ns', description: "Winner: total race time. Others: gap to the winner (source semantics).", sql: 'x.time_ns' },
      { name: 'fastest_lap_rank', type: 'integer', description: 'Rank of the driver\'s fastest lap.', sql: 'x.fastest_lap_rank' },
      { name: 'fastest_lap_number', type: 'integer', description: 'Lap number of the fastest lap.', sql: 'x.fastest_lap_number' },
      { name: 'fastest_lap_time_ns', type: 'integer', unit: 'ns', description: 'Fastest lap time.', sql: 'x.fastest_lap_time_ns' },
      { name: 'fastest_lap_avg_speed', type: 'real', unit: 'km/h', description: 'Average speed of the fastest lap.', sql: 'x.fastest_lap_avg_speed' },
    ],
  },
  laps: {
    key: 'laps',
    label: 'Lap timing',
    description: 'Lap and sector times, speed traps, pit in/out, position and tyre compound.',
    from: `laps x ${JOIN} LEFT JOIN session_drivers sd ON sd.session_id = x.session_id AND sd.driver_number = x.driver_number`,
    driverCol: 'x.driver_number',
    timeCol: 'x.end_ns',
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.driver_number, x.lap_no',
    bytesPerRow: 220,
    columns: [
      ...SESSION_COLS,
      { name: 'driver_number', type: 'text', description: 'Car number.', sql: 'x.driver_number' },
      { name: 'abbreviation', type: 'text', description: 'Abbreviation.', sql: 'sd.abbreviation' },
      { name: 'lap', type: 'integer', description: 'Lap number.', sql: 'x.lap_no' },
      { name: 'lap_time_ns', type: 'integer', unit: 'ns', description: 'Lap time.', sql: 'x.lap_time_ns' },
      { name: 's1_ns', type: 'integer', unit: 'ns', description: 'Sector 1 time.', sql: 'x.s1_ns' },
      { name: 's2_ns', type: 'integer', unit: 'ns', description: 'Sector 2 time.', sql: 'x.s2_ns' },
      { name: 's3_ns', type: 'integer', unit: 'ns', description: 'Sector 3 time.', sql: 'x.s3_ns' },
      { name: 'lap_start_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time at lap start.', sql: 'x.start_ns' },
      { name: 'lap_end_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time at lap end.', sql: 'x.end_ns' },
      { name: 'pit_in_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time of pit entry on this lap.', sql: 'x.pit_in_ns' },
      { name: 'pit_out_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time of pit exit on this lap.', sql: 'x.pit_out_ns' },
      { name: 'position', type: 'integer', description: 'Position at the end of the lap.', sql: 'x.position' },
      { name: 'speed_i1', type: 'real', unit: 'km/h', description: 'Intermediate 1 speed trap.', sql: 'x.speed_i1' },
      { name: 'speed_i2', type: 'real', unit: 'km/h', description: 'Intermediate 2 speed trap.', sql: 'x.speed_i2' },
      { name: 'speed_fl', type: 'real', unit: 'km/h', description: 'Finish line speed.', sql: 'x.speed_fl' },
      { name: 'speed_st', type: 'real', unit: 'km/h', description: 'Speed trap.', sql: 'x.speed_st' },
      { name: 'is_personal_best', type: 'boolean', description: 'Personal best at the time.', sql: 'x.is_personal_best' },
      { name: 'track_status', type: 'text', description: 'Track status codes seen during the lap.', sql: 'x.track_status' },
      { name: 'deleted', type: 'boolean', description: 'Lap time deleted.', sql: 'x.deleted' },
      { name: 'deleted_reason', type: 'text', description: 'Reason for deletion.', sql: 'x.deleted_reason' },
      { name: 'is_accurate', type: 'boolean', description: 'FastF1 accuracy flag.', sql: 'x.is_accurate' },
      { name: 'fastf1_generated', type: 'boolean', description: 'Row generated by FastF1 rather than read from timing.', sql: 'x.fastf1_generated' },
      {
        name: 'compound',
        type: 'text',
        description: 'Tyre compound: the latest stint record at or before the lap end (joined from stints).',
        derived: true,
        sql: `(SELECT st.compound FROM stints st WHERE st.session_id = x.session_id AND st.driver_number = x.driver_number AND st.ts_ns <= x.end_ns ORDER BY st.ts_ns DESC LIMIT 1)`,
      },
    ],
  },
  stints: {
    key: 'stints',
    label: 'Tyre stints',
    description: 'Running record of tyre stints: one row each time the tyre state changes.',
    from: `stints x ${JOIN}`,
    driverCol: 'x.driver_number',
    timeCol: 'x.ts_ns',
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.driver_number, x.ts_ns',
    bytesPerRow: 110,
    columns: [
      ...SESSION_COLS,
      { name: 'driver_number', type: 'text', description: 'Car number.', sql: 'x.driver_number' },
      { name: 'ts_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time of the update.', sql: 'x.ts_ns' },
      { name: 'stint', type: 'integer', description: 'Stint number.', sql: 'x.stint' },
      { name: 'compound', type: 'text', description: 'Tyre compound.', sql: 'x.compound' },
      { name: 'new', type: 'boolean', description: 'New set.', sql: 'x.new' },
      { name: 'tyres_changed', type: 'boolean', description: 'Tyres changed.', sql: 'x.tyres_changed' },
      { name: 'stint_age', type: 'integer', unit: 'laps', description: 'Tyre age.', sql: 'x.stint_age' },
      { name: 'start_lap', type: 'integer', description: 'Lap the stint started.', sql: 'x.start_lap' },
      { name: 'lap_flags', type: 'integer', description: 'Raw lap flags.', sql: 'x.lap_flags' },
    ],
  },
  pit_stops: {
    key: 'pit_stops',
    label: 'Pit stops',
    description: 'Pit stops for races and sprints (Jolpica).',
    from: `pit_stops x ${JOIN}`,
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.lap, x.stop_number',
    bytesPerRow: 100,
    columns: [
      ...SESSION_COLS,
      { name: 'driver_id', type: 'text', description: 'Jolpica driver id.', sql: 'x.driver_id' },
      { name: 'stop_number', type: 'integer', description: 'Stop number.', sql: 'x.stop_number' },
      { name: 'lap', type: 'integer', description: 'Lap.', sql: 'x.lap' },
      { name: 'duration_ns', type: 'integer', unit: 'ns', description: 'Pit lane duration.', sql: 'x.duration_ns' },
      { name: 'time_of_day_ns', type: 'integer', unit: 'ns since local midnight', description: 'Local time of day of the stop (not session time).', sql: 'x.time_of_day_ns' },
    ],
  },
  weather: {
    key: 'weather',
    label: 'Weather',
    description: 'Weather samples through the session (roughly one per minute).',
    from: `weather x ${JOIN}`,
    timeCol: 'x.ts_ns',
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.ts_ns',
    bytesPerRow: 110,
    columns: [
      ...SESSION_COLS,
      { name: 'ts_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time.', sql: 'x.ts_ns' },
      { name: 'air_temp_c', type: 'real', unit: '°C', description: 'Air temperature.', sql: 'x.air_temp_c' },
      { name: 'track_temp_c', type: 'real', unit: '°C', description: 'Track temperature.', sql: 'x.track_temp_c' },
      { name: 'humidity_pct', type: 'real', unit: '%', description: 'Relative humidity.', sql: 'x.humidity_pct' },
      { name: 'pressure_mbar', type: 'real', unit: 'mbar', description: 'Air pressure.', sql: 'x.pressure_mbar' },
      { name: 'rainfall', type: 'boolean', description: 'Rainfall indicator.', sql: 'x.rainfall' },
      { name: 'wind_direction_deg', type: 'real', unit: '°', description: 'Wind direction.', sql: 'x.wind_direction_deg' },
      { name: 'wind_speed_ms', type: 'real', unit: 'm/s', description: 'Wind speed.', sql: 'x.wind_speed_ms' },
    ],
  },
  race_control: {
    key: 'race_control',
    label: 'Race control',
    description: 'Race control messages.',
    from: `race_control x ${JOIN}`,
    driverCol: 'x.driver_number',
    keepUnattributed: true,
    timeCol: 'x.ts_ns',
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.ts_ns, x.id',
    bytesPerRow: 160,
    columns: [
      ...SESSION_COLS,
      { name: 'ts_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time.', sql: 'x.ts_ns' },
      { name: 'category', type: 'text', description: 'Flag, SafetyCar, Drs, CarEvent or Other.', sql: 'x.category' },
      { name: 'flag', type: 'text', description: 'Flag shown, if any.', sql: 'x.flag' },
      { name: 'scope', type: 'text', description: 'Track, Sector or Driver.', sql: 'x.scope' },
      { name: 'sector', type: 'integer', description: 'Marshal sector.', sql: 'x.sector' },
      { name: 'driver_number', type: 'text', description: 'Driver the message concerns.', sql: 'x.driver_number' },
      { name: 'lap', type: 'integer', description: 'Lap.', sql: 'x.lap' },
      { name: 'status', type: 'text', description: 'Status (e.g. DRS ENABLED/DISABLED).', sql: 'x.status' },
      { name: 'message', type: 'text', description: 'Message text.', sql: 'x.message' },
    ],
  },
  team_radio: {
    key: 'team_radio',
    label: 'Team radio',
    description: 'Team radio clip metadata. Recordings are referenced by their path on F1\'s archive.',
    from: `team_radio x ${JOIN}`,
    driverCol: 'x.driver_number',
    timeCol: 'x.ts_ns',
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.ts_ns, x.id',
    bytesPerRow: 170,
    columns: [
      ...SESSION_COLS,
      { name: 'ts_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time of the clip.', sql: 'x.ts_ns' },
      { name: 'utc', type: 'timestamp', unit: 'UTC', description: 'Wall-clock time of the clip.', sql: 'x.utc' },
      { name: 'driver_number', type: 'text', description: 'Driver whose channel the clip is from.', sql: 'x.driver_number' },
      { name: 'recording_path', type: 'text', description: "Clip path relative to the session folder on F1's archive.", sql: 'x.path' },
      { name: 'archive_path', type: 'text', description: "Session folder on F1's archive.", sql: 's.archive_path' },
      { name: 'recording_available', type: 'boolean', description: 'Whether F1Archive holds a copy of the recording.', sql: 'x.file_available' },
    ],
  },
  track_status: {
    key: 'track_status',
    label: 'Track status',
    description: 'Track status changes: green, yellow, SC, VSC, red.',
    from: `track_status x ${JOIN}`,
    timeCol: 'x.ts_ns',
    orderBy: 'e.year, e.round, s.scheduled_start_utc, x.ts_ns',
    bytesPerRow: 80,
    columns: [
      ...SESSION_COLS,
      { name: 'ts_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time.', sql: 'x.ts_ns' },
      { name: 'status', type: 'text', description: 'Status code (1 clear, 2 yellow, 4 SC, 5 red, 6 VSC, 7 VSC ending).', sql: 'x.status' },
      { name: 'message', type: 'text', description: 'Status message.', sql: 'x.message' },
    ],
  },
  telemetry: {
    key: 'telemetry',
    label: 'Telemetry',
    description:
      "Original-resolution samples exactly as stored in the source archive. The car feed and the position feed are merged onto one timeline: each row is a new sample from one feed, with the other feed's latest values carried forward (empty before that feed's first sample).",
    from: `telemetry x ${JOIN}`,
    driverCol: 'x.driver_number::text',
    timeCol: 'x.ts_ns',
    orderBy: 'x.session_id, x.driver_number, x.ts_ns',
    bytesPerRow: 75,
    columns: [
      ...SESSION_COLS,
      { name: 'driver_number', type: 'text', description: 'Car number.', sql: 'x.driver_number::text' },
      { name: 'ts_ns', type: 'integer', unit: 'ns (session time)', description: 'Session time of the sample.', sql: 'x.ts_ns' },
      { name: 'speed', type: 'integer', unit: 'km/h', description: 'Speed.', sql: 'x.speed', channel: 'speed' },
      { name: 'rpm', type: 'integer', unit: 'rpm', description: 'Engine speed.', sql: 'x.rpm', channel: 'rpm' },
      { name: 'gear', type: 'integer', description: 'Gear.', sql: 'x.gear', channel: 'gear' },
      { name: 'throttle', type: 'integer', unit: '%', description: 'Throttle. The raw feed sometimes reports values just over 100.', sql: 'x.throttle', channel: 'throttle' },
      { name: 'brake', type: 'integer', description: 'Brake on (1) or off (0).', sql: 'x.brake', channel: 'brake' },
      { name: 'drs', type: 'integer', description: 'Raw DRS code (see drs_label).', sql: 'x.drs', channel: 'drs' },
      { name: 'drs_label', type: 'text', description: 'DRS state label for the raw code, as published.', sql: '(SELECT label FROM drs_codes d WHERE d.code = x.drs)', channel: 'drs' },
      { name: 'x', type: 'real', unit: 'F1 track units', description: 'Position x, F1 coordinate system.', sql: 'x.x', channel: 'x' },
      { name: 'y', type: 'real', unit: 'F1 track units', description: 'Position y.', sql: 'x.y', channel: 'y' },
      { name: 'z', type: 'real', unit: 'F1 track units', description: 'Position z.', sql: 'x.z', channel: 'z' },
    ],
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as ExportCategory[];

export function columnsFor(cat: CategoryDef, req: ExportRequest): ExportColumn[] {
  if (cat.key !== 'telemetry' || !req.telemetry_channels?.length) return cat.columns;
  const want = new Set(req.telemetry_channels);
  return cat.columns.filter((c) => !c.channel || want.has(c.channel));
}

export interface BuiltQuery {
  text: string;
  fromWhere: string;
  values: unknown[];
}

export function buildQuery(cat: CategoryDef, req: ExportRequest, sessionIds: number[]): BuiltQuery {
  const cols = columnsFor(cat, req);
  const sessionRef = cat.key === 'sessions' ? 's.id' : 'x.session_id';
  const where: string[] = [`${sessionRef} = ANY($1::int[])`];
  const values: unknown[] = [sessionIds];
  const drivers = (req.drivers ?? []).map((d) => d.trim()).filter(Boolean);
  if (cat.driverCol && drivers.length) {
    values.push([...new Set([...drivers, ...drivers.map((d) => d.toUpperCase())])]);
    const p = `$${values.length}::text[]`;
    const match = `${cat.driverCol} IN (SELECT sd2.driver_number FROM session_drivers sd2 WHERE sd2.session_id = ${sessionRef}
         AND (sd2.driver_number = ANY(${p}) OR upper(sd2.abbreviation) = ANY(${p})))`;
    where.push(cat.keepUnattributed ? `(nullif(${cat.driverCol}, '') IS NULL OR ${match})` : match);
  }
  if (cat.timeCol && req.time_from_ns != null) {
    values.push(req.time_from_ns);
    where.push(`${cat.timeCol} >= $${values.length}`);
  }
  if (cat.timeCol && req.time_to_ns != null) {
    values.push(req.time_to_ns);
    where.push(`${cat.timeCol} <= $${values.length}`);
  }
  const select = cols.map((c) => `${c.sql} AS "${c.name}"`).join(', ');
  const fromWhere = `FROM ${cat.from} WHERE ${where.join(' AND ')}`;
  return { text: `SELECT ${select} ${fromWhere} ORDER BY ${cat.orderBy}`, fromWhere, values };
}

export interface ExportLimits {
  maxRows: number;
  maxSessions: number;
}

export function exportLimits(): ExportLimits {
  return {
    maxRows: Number(process.env.EXPORT_MAX_ROWS ?? 250_000_000),
    maxSessions: Number(process.env.EXPORT_MAX_SESSIONS ?? 2000),
  };
}

export async function resolveSessionKeys(db: pg.Pool, keys: string[]): Promise<{ ids: number[]; byKey: Map<string, number>; unknown: string[]; years: Map<number, number> }> {
  const r = await db.query<{ id: number; key: string; year: number }>(
    `SELECT s.id, e.year || '-' || e.slug || '-' || s.slug AS key, e.year FROM sessions s JOIN events e ON e.id = s.event_id
     WHERE e.year || '-' || e.slug || '-' || s.slug = ANY($1::text[])`,
    [keys],
  );
  const byKey = new Map(r.rows.map((x) => [x.key, x.id]));
  const years = new Map(r.rows.map((x) => [x.id, x.year]));
  return { ids: r.rows.map((x) => x.id), byKey, unknown: keys.filter((k) => !byKey.has(k)), years };
}

export async function estimateExport(db: pg.Pool, req: ExportRequest): Promise<ExportEstimate> {
  const limits = exportLimits();
  const { ids, byKey } = await resolveSessionKeys(db, req.sessions);
  const rows: ExportEstimate['rows'] = {};
  const perSessionTelemetry = new Map<number, number>();
  for (const key of req.categories) {
    const cat = CATEGORIES[key];
    if (!cat) continue;
    if (key === 'telemetry') {
      const drivers = (req.drivers ?? []).map((d) => d.trim().toUpperCase()).filter(Boolean);
      const r = await db.query<{ session_id: number; n: number; span: number; a: number; b: number }>(
        `SELECT t.session_id, sum(t.samples)::bigint AS n, min(t.min_ts_ns) AS a, max(t.max_ts_ns) AS b
         FROM telemetry_summary t
         LEFT JOIN session_drivers sd ON sd.session_id = t.session_id AND sd.driver_number = t.driver_number::text
         WHERE t.session_id = ANY($1::int[])
           AND (cardinality($2::text[]) = 0 OR t.driver_number::text = ANY($2::text[]) OR upper(sd.abbreviation) = ANY($2::text[]))
         GROUP BY t.session_id`,
        [ids, drivers],
      );
      let total = 0;
      for (const x of r.rows) {
        let n = Number(x.n);
        if ((req.time_from_ns != null || req.time_to_ns != null) && x.b > x.a) {
          const from = Math.max(x.a, req.time_from_ns ?? x.a);
          const to = Math.min(x.b, req.time_to_ns ?? x.b);
          n = Math.round((n * Math.max(0, to - from)) / (x.b - x.a));
        }
        perSessionTelemetry.set(x.session_id, n);
        total += n;
      }
      rows.telemetry = total;
    } else {
      const q = buildQuery(cat, { ...req, telemetry_channels: [] }, ids);
      const countSql = `SELECT count(*)::bigint AS n ${q.fromWhere}`;
      rows[key] = Number((await db.query<{ n: number }>(countSql, q.values)).rows[0]!.n);
    }
  }
  const totalRows = Object.values(rows).reduce((a, b) => a + (b ?? 0), 0);
  const fmtFactor = req.format === 'json' || req.format === 'jsonl' ? 2.6 : req.format === 'sqlite' ? 1.1 : req.format === 'parquet' ? 0.3 : 1;
  const bytes = Math.round(
    Object.entries(rows).reduce((a, [k, n]) => a + (n ?? 0) * CATEGORIES[k as ExportCategory].bytesPerRow, 0) * fmtFactor,
  );

  let reason: string | null = null;
  if (ids.length === 0) reason = 'No sessions selected.';
  else if (ids.length > limits.maxSessions) reason = `More than ${limits.maxSessions} sessions selected.`;
  else if (totalRows > limits.maxRows)
    reason = `This export has about ${totalRows.toLocaleString('en-GB')} rows; the limit per export is ${limits.maxRows.toLocaleString('en-GB')}.`;
  else if (req.format === 'json' && totalRows > 5_000_000)
    reason = 'Plain JSON is limited to 5,000,000 rows because it must be read whole. Use JSON Lines (jsonl) for larger exports.';

  let split: string[][] | null = null;
  if (reason && ids.length > 1 && totalRows > limits.maxRows) {
    const nonTele = totalRows - (rows.telemetry ?? 0);
    const perSessionOther = nonTele / ids.length;
    split = [];
    let cur: string[] = [];
    let curRows = 0;
    for (const [key, id] of byKey) {
      const n = (perSessionTelemetry.get(id) ?? 0) + perSessionOther;
      if (cur.length && curRows + n > limits.maxRows * 0.9) {
        split.push(cur);
        cur = [];
        curRows = 0;
      }
      cur.push(key);
      curRows += n;
    }
    if (cur.length) split.push(cur);
  }

  return {
    sessions: ids.length,
    rows,
    total_rows: totalRows,
    estimated_bytes: bytes,
    within_limits: reason === null,
    limit_reason: reason,
    suggested_split: split,
  };
}
