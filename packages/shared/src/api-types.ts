import type { FeedKey, FeedState } from './feeds.js';
import type { SessionKind } from './ids.js';

export interface Paginated<T> {
  data: T[];
  page: { limit: number; offset: number; total: number | null; next_offset: number | null };
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface ArchiveStats {
  seasons: number;
  events: number;
  sessions: number;
  sessions_archived: number;
  drivers: number;
  telemetry_samples: number;
  laps: number;
  team_radio_messages: number;
  team_radio_recordings_available: number;
  race_control_messages: number;
  weather_samples: number;
  last_ingest_utc: string | null;
  deployment: 'full' | 'subset';
}

export interface CalendarRound {
  round: number;
  event: string;
  name: string;
  circuit: string | null;
  country: string | null;
  start_utc: string | null;
  end_utc: string | null;
  winner: { abbreviation: string | null; name: string | null; team_colour: string | null } | null;
  sketch: [number, number][] | null;
  sketch_year: number | null;
}

export interface SeasonSummary {
  year: number;
  events: number;
  sessions: number;
  sessions_archived: number;
  champion_driver: { driver_id: string; name: string; points: number | null } | null;
  champion_constructor: { constructor_id: string; name: string; points: number | null } | null;
  completeness: number | null;
}

export interface EventSummary {
  key: string;
  year: number;
  slug: string;
  round: number;
  name: string;
  official_name: string | null;
  country: string | null;
  location: string | null;
  circuit: string | null;
  circuit_key: number | null;
  format: string | null;
  is_testing: boolean;
  start_utc: string | null;
  end_utc: string | null;
  sessions: SessionSummary[];
}

export interface SessionSummary {
  key: string;
  year: number;
  event: string;
  slug: string;
  name: string;
  kind: SessionKind;
  start_utc: string | null;
  start_local: string | null;
  status: 'archived' | 'missing' | 'upcoming';
  has_telemetry: boolean;
  has_radio: boolean;
}

export interface FeedStatus {
  feed: FeedKey;
  state: FeedState;
  rows: number | null;
  driver?: string;
}

export interface SessionDriver {
  number: string;
  abbreviation: string | null;
  full_name: string | null;
  broadcast_name: string | null;
  team_name: string | null;
  team_colour: string | null;
  reference: string | null;
  driver_id: string | null;
  headshot_url: string | null;
  country_code: string | null;
  telemetry: FeedState;
  telemetry_samples: number | null;
}

export interface SessionDetail extends SessionSummary {
  event_name: string;
  event_round: number;
  circuit: string | null;
  circuit_key: number | null;
  end_utc: string | null;
  gmt_offset: string | null;
  archive_path: string | null;
  stream_start_utc: string | null;
  time_range_ns: { from: number; to: number } | null;
  total_laps: number | null;
  drivers: SessionDriver[];
  feeds: FeedStatus[];
  notes: string[];
}

export interface TimelineEvent {
  t_ns: number;
  type: 'track_status' | 'race_control' | 'radio' | 'pit' | 'session_status' | 'lap' | 'weather';
  label: string;
  detail?: string | null;
  fields?: [string, string][];
  driver?: string | null;
  tone?: string | null;
  audio_url?: string | null;
  id?: string;
}

export interface TrackPeriod {
  status: string;
  label: string;
  tone: string;
  from_ns: number;
  to_ns: number | null;
}

export interface TelemetrySeries {
  ts_ns: number[];
  speed?: (number | null)[];
  rpm?: (number | null)[];
  gear?: (number | null)[];
  throttle?: (number | null)[];
  brake?: (number | null)[];
  drs?: (number | null)[];
  x?: (number | null)[];
  y?: (number | null)[];
  z?: (number | null)[];
}

export type TelemetryChannel = 'speed' | 'rpm' | 'gear' | 'throttle' | 'brake' | 'drs' | 'x' | 'y' | 'z';
export const TELEMETRY_CHANNELS: TelemetryChannel[] = ['speed', 'rpm', 'gear', 'throttle', 'brake', 'drs', 'x', 'y', 'z'];

export const CHANNEL_UNITS: Record<TelemetryChannel, string> = {
  speed: 'km/h',
  rpm: 'rpm',
  gear: 'gear',
  throttle: '%',
  brake: 'on/off',
  drs: 'raw code',
  x: 'F1 track units',
  y: 'F1 track units',
  z: 'F1 track units',
};

export interface TelemetryWindow {
  session: string;
  from_ns: number;
  to_ns: number;
  channels: TelemetryChannel[];
  drivers: Record<string, TelemetrySeries>;
  truncated: boolean;
}

export interface LapRow {
  driver: string;
  lap: number;
  lap_time_ns: number | null;
  s1_ns: number | null;
  s2_ns: number | null;
  s3_ns: number | null;
  start_ns: number | null;
  end_ns: number | null;
  pit_in_ns: number | null;
  pit_out_ns: number | null;
  position: number | null;
  compound: string | null;
  tyre_age: number | null;
  is_personal_best: boolean | null;
  deleted: boolean | null;
  deleted_reason: string | null;
  track_status: string | null;
  speed_i1: number | null;
  speed_i2: number | null;
  speed_fl: number | null;
  speed_st: number | null;
  is_accurate: boolean | null;
}

export interface MarshalPoint {
  number: number;
  x: number;
  y: number;
  angle: number | null;
}

export interface TrackOutline {
  session: string;
  x: number[];
  y: number[];
  source: { driver: string; lap: number } | null;
  corners: { number: number; letter: string | null; x: number; y: number; angle: number | null }[];
  marshal_lights: MarshalPoint[];
  marshal_sectors: MarshalPoint[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
  rotation: number;
}

export interface SearchResult {
  type: 'driver' | 'event' | 'session' | 'circuit' | 'season' | 'constructor';
  title: string;
  subtitle: string | null;
  href: string;
}

export type ExportFormat = 'csv' | 'jsonl' | 'json' | 'sqlite' | 'parquet';
export type ExportCategory =
  | 'sessions'
  | 'drivers'
  | 'results'
  | 'laps'
  | 'stints'
  | 'pit_stops'
  | 'weather'
  | 'race_control'
  | 'team_radio'
  | 'track_status'
  | 'telemetry';

export interface ExportSelection {
  years?: number[];
  events?: string[];
  session_kinds?: string[];
}

export interface ExportRequest {
  format: ExportFormat;
  categories: ExportCategory[];
  sessions: string[];
  selection?: ExportSelection;
  drivers?: string[];
  time_from_ns?: number | null;
  time_to_ns?: number | null;
  telemetry_channels?: TelemetryChannel[];
}

export interface ExportEstimate {
  sessions: number;
  rows: Partial<Record<ExportCategory, number>>;
  total_rows: number;
  estimated_bytes: number;
  within_limits: boolean;
  limit_reason: string | null;
  suggested_split: string[][] | null;
}

export interface ExportJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'expired' | 'cancelled';
  request: ExportRequest;
  estimate: ExportEstimate | null;
  progress: { rows_written: number; rows_total: number | null; stage: string | null };
  file: { name: string; bytes: number; url: string } | null;
  error: string | null;
  created_utc: string;
  finished_utc: string | null;
  expires_utc: string | null;
}
