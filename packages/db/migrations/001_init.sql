CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE ingest_runs (
  id            SERIAL PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted')),
  source_path   TEXT NOT NULL,
  source_kind   TEXT NOT NULL CHECK (source_kind IN ('full', 'subset')),
  source_info   JSONB NOT NULL DEFAULT '{}',
  options       JSONB NOT NULL DEFAULT '{}',
  summary       JSONB NOT NULL DEFAULT '{}',
  error         TEXT,
  app_version   TEXT
);

CREATE TABLE ref_drivers (
  driver_id        TEXT PRIMARY KEY,
  abbreviation     TEXT,
  permanent_number TEXT,
  given_name       TEXT,
  family_name      TEXT,
  date_of_birth    TEXT,
  nationality      TEXT,
  ingest_run_id    INT REFERENCES ingest_runs(id)
);
CREATE INDEX ref_drivers_name_trgm ON ref_drivers USING gin ((coalesce(given_name, '') || ' ' || coalesce(family_name, '')) gin_trgm_ops);

CREATE TABLE ref_constructors (
  constructor_id TEXT PRIMARY KEY,
  name           TEXT,
  nationality    TEXT,
  ingest_run_id  INT REFERENCES ingest_runs(id)
);

CREATE TABLE ref_circuits (
  circuit_id    TEXT PRIMARY KEY,
  name          TEXT,
  locality      TEXT,
  country       TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  ingest_run_id INT REFERENCES ingest_runs(id)
);

CREATE TABLE ref_finishing_statuses (
  status_id     TEXT PRIMARY KEY,
  status        TEXT,
  count         BIGINT,
  ingest_run_id INT REFERENCES ingest_runs(id)
);

CREATE TABLE seasons (
  year SMALLINT PRIMARY KEY
);

CREATE TABLE season_teams (
  year            SMALLINT NOT NULL REFERENCES seasons(year),
  key             TEXT NOT NULL,
  short_name      TEXT,
  colour_official TEXT,
  colour_fastf1   TEXT,
  colours_raw     JSONB,
  ingest_run_id   INT REFERENCES ingest_runs(id),
  PRIMARY KEY (year, key)
);

CREATE TABLE season_compounds (
  year          SMALLINT NOT NULL REFERENCES seasons(year),
  compound      TEXT NOT NULL,
  ingest_run_id INT REFERENCES ingest_runs(id),
  PRIMARY KEY (year, compound)
);

CREATE TABLE events (
  id                 SERIAL PRIMARY KEY,
  year               SMALLINT NOT NULL REFERENCES seasons(year),
  round              SMALLINT NOT NULL,
  source_name        TEXT NOT NULL,
  slug               TEXT NOT NULL,
  name               TEXT NOT NULL,
  official_name      TEXT,
  country            TEXT,
  location           TEXT,
  format             TEXT,
  circuit_key        INT,
  circuit_short_name TEXT,
  meeting_key        INT,
  is_testing         BOOLEAN NOT NULL,
  schedule_only      BOOLEAN NOT NULL DEFAULT false,
  start_utc          TIMESTAMPTZ,
  end_utc            TIMESTAMPTZ,
  ingest_run_id      INT REFERENCES ingest_runs(id),
  UNIQUE (year, slug),
  UNIQUE (year, round, source_name)
);
CREATE INDEX events_name_trgm ON events USING gin (name gin_trgm_ops);

CREATE TABLE circuit_points (
  event_id      INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('corner', 'marshal_light', 'marshal_sector')),
  number        INT,
  letter        TEXT,
  x             DOUBLE PRECISION,
  y             DOUBLE PRECISION,
  angle         DOUBLE PRECISION,
  length        DOUBLE PRECISION,
  ingest_run_id INT REFERENCES ingest_runs(id)
);
CREATE INDEX circuit_points_event ON circuit_points (event_id, kind);

CREATE TABLE standings_drivers (
  event_id        INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position        INT,
  position_text   TEXT,
  points          NUMERIC,
  wins            INT,
  driver_id       TEXT,
  abbreviation    TEXT,
  constructor_ids TEXT[],
  ingest_run_id   INT REFERENCES ingest_runs(id)
);
CREATE INDEX standings_drivers_event ON standings_drivers (event_id);

CREATE TABLE standings_constructors (
  event_id       INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position       INT,
  position_text  TEXT,
  points         NUMERIC,
  wins           INT,
  constructor_id TEXT,
  ingest_run_id  INT REFERENCES ingest_runs(id)
);
CREATE INDEX standings_constructors_event ON standings_constructors (event_id);

CREATE TABLE sessions (
  id                  SERIAL PRIMARY KEY,
  event_id            INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_name         TEXT NOT NULL,
  slug                TEXT NOT NULL,
  kind                TEXT NOT NULL,
  scheduled_start_utc TIMESTAMPTZ,
  start_local         TEXT,
  end_local           TEXT,
  end_utc             TIMESTAMPTZ,
  gmt_offset          TEXT,
  f1_key              INT,
  archive_path        TEXT,
  archive_status      TEXT,
  status              TEXT NOT NULL CHECK (status IN ('archived', 'missing', 'upcoming')),
  stream_start_utc    TIMESTAMPTZ,
  total_laps          INT,
  time_from_ns        BIGINT,
  time_to_ns          BIGINT,
  ingest_run_id       INT REFERENCES ingest_runs(id),
  ingested_at         TIMESTAMPTZ,
  UNIQUE (event_id, slug)
);

CREATE TABLE feed_availability (
  scope         TEXT NOT NULL CHECK (scope IN ('season', 'event', 'session')),
  scope_id      INT NOT NULL,
  feed          TEXT NOT NULL,
  driver        TEXT NOT NULL DEFAULT '',
  state         TEXT NOT NULL CHECK (state IN ('present', 'partial', 'no_data', 'missing', 'not_imported', 'upcoming')),
  rows          BIGINT,
  detail        TEXT,
  fingerprint   TEXT,
  ingest_run_id INT REFERENCES ingest_runs(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_id, feed, driver)
);

CREATE TABLE session_drivers (
  session_id     INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number  TEXT NOT NULL,
  abbreviation   TEXT,
  broadcast_name TEXT,
  full_name      TEXT,
  team_name      TEXT,
  team_colour    TEXT,
  reference      TEXT,
  headshot_url   TEXT,
  country_code   TEXT,
  line           INT,
  driver_id      TEXT,
  ingest_run_id  INT REFERENCES ingest_runs(id),
  PRIMARY KEY (session_id, driver_number)
);
CREATE INDEX session_drivers_driver_id ON session_drivers (driver_id);
CREATE INDEX session_drivers_abbr ON session_drivers (abbreviation);

CREATE TABLE results (
  session_id            INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number         TEXT,
  driver_id             TEXT,
  abbreviation          TEXT,
  team_name             TEXT,
  position              INT,
  position_text         TEXT,
  grid_position         INT,
  q1_ns                 BIGINT,
  q2_ns                 BIGINT,
  q3_ns                 BIGINT,
  laps                  INT,
  status                TEXT,
  points                NUMERIC,
  time_ns               BIGINT,
  fastest_lap_rank      INT,
  fastest_lap_number    INT,
  fastest_lap_time_ns   BIGINT,
  fastest_lap_avg_speed DOUBLE PRECISION,
  ingest_run_id         INT REFERENCES ingest_runs(id)
);
CREATE INDEX results_session ON results (session_id);
CREATE INDEX results_driver ON results (driver_id);

CREATE TABLE laps (
  session_id       INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number    TEXT NOT NULL,
  lap_no           INT,
  lap_time_ns      BIGINT,
  s1_ns            BIGINT,
  s2_ns            BIGINT,
  s3_ns            BIGINT,
  speed_i1         DOUBLE PRECISION,
  speed_i2         DOUBLE PRECISION,
  speed_fl         DOUBLE PRECISION,
  speed_st         DOUBLE PRECISION,
  pit_stop_no      INT,
  pit_in_ns        BIGINT,
  pit_out_ns       BIGINT,
  is_personal_best BOOLEAN,
  end_ns           BIGINT,
  start_ns         BIGINT,
  track_status     TEXT,
  position         INT,
  fastf1_generated BOOLEAN,
  is_accurate      BOOLEAN,
  deleted          BOOLEAN,
  deleted_reason   TEXT,
  ingest_run_id    INT REFERENCES ingest_runs(id)
);
CREATE INDEX laps_lookup ON laps (session_id, driver_number, lap_no);

CREATE TABLE best_stats (
  session_id          INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number       TEXT,
  best_lap_ns         BIGINT,
  best_lap_number     INT,
  best_lap_position   INT,
  best_s1_ns          BIGINT,
  best_s1_position    INT,
  best_s2_ns          BIGINT,
  best_s2_position    INT,
  best_s3_ns          BIGINT,
  best_s3_position    INT,
  best_speed_i1       DOUBLE PRECISION,
  best_speed_i1_position INT,
  best_speed_i2       DOUBLE PRECISION,
  best_speed_i2_position INT,
  best_speed_fl       DOUBLE PRECISION,
  best_speed_fl_position INT,
  best_speed_st       DOUBLE PRECISION,
  best_speed_st_position INT,
  ts_ns               BIGINT,
  ingest_run_id       INT REFERENCES ingest_runs(id)
);
CREATE INDEX best_stats_session ON best_stats (session_id);

CREATE TABLE pit_stops (
  session_id     INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_id      TEXT,
  stop_number    INT,
  lap            INT,
  duration_ns    BIGINT,
  time_of_day_ns BIGINT,
  ingest_run_id  INT REFERENCES ingest_runs(id)
);
CREATE INDEX pit_stops_session ON pit_stops (session_id);

CREATE TABLE progress (
  session_id    INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts_ns         BIGINT,
  current_lap   INT,
  total_laps    INT,
  ingest_run_id INT REFERENCES ingest_runs(id)
);
CREATE INDEX progress_session ON progress (session_id, ts_ns);

CREATE TABLE weather (
  session_id     INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts_ns          BIGINT,
  air_temp_c     DOUBLE PRECISION,
  track_temp_c   DOUBLE PRECISION,
  humidity_pct   DOUBLE PRECISION,
  pressure_mbar  DOUBLE PRECISION,
  rainfall       BOOLEAN,
  wind_direction_deg DOUBLE PRECISION,
  wind_speed_ms  DOUBLE PRECISION,
  ingest_run_id  INT REFERENCES ingest_runs(id)
);
CREATE INDEX weather_session ON weather (session_id, ts_ns);

CREATE TABLE track_status (
  session_id    INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts_ns         BIGINT,
  status        TEXT,
  message       TEXT,
  ingest_run_id INT REFERENCES ingest_runs(id)
);
CREATE INDEX track_status_session ON track_status (session_id, ts_ns);

CREATE TABLE status_events (
  session_id    INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts_ns         BIGINT,
  status        TEXT,
  ingest_run_id INT REFERENCES ingest_runs(id)
);
CREATE INDEX status_events_session ON status_events (session_id, ts_ns);

CREATE TABLE session_clock (
  session_id    INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts_ns         BIGINT,
  remaining_ns  BIGINT,
  extrapolating BOOLEAN,
  ingest_run_id INT REFERENCES ingest_runs(id)
);
CREATE INDEX session_clock_session ON session_clock (session_id, ts_ns);

CREATE TABLE race_control (
  id            BIGSERIAL PRIMARY KEY,
  session_id    INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts_ns         BIGINT,
  message       TEXT,
  category      TEXT,
  flag          TEXT,
  scope         TEXT,
  sector        INT,
  driver_number TEXT,
  lap           INT,
  status        TEXT,
  ingest_run_id INT REFERENCES ingest_runs(id)
);
CREATE INDEX race_control_session ON race_control (session_id, ts_ns);

CREATE TABLE team_radio (
  id             BIGSERIAL PRIMARY KEY,
  session_id     INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number  TEXT,
  path           TEXT,
  utc            TIMESTAMPTZ,
  ts_ns          BIGINT,
  file_available BOOLEAN NOT NULL DEFAULT false,
  file_bytes     BIGINT,
  ingest_run_id  INT REFERENCES ingest_runs(id)
);
CREATE INDEX team_radio_session ON team_radio (session_id, ts_ns);

CREATE TABLE top_three (
  session_id       INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position         INT,
  driver_number    TEXT,
  abbreviation     TEXT,
  broadcast_name   TEXT,
  full_name        TEXT,
  team_name        TEXT,
  team_colour      TEXT,
  lap_time         TEXT,
  lap_state        TEXT,
  diff_to_ahead    TEXT,
  diff_to_leader   TEXT,
  overall_fastest  BOOLEAN,
  personal_fastest BOOLEAN,
  ts_ns            BIGINT,
  derived          BOOLEAN,
  ingest_run_id    INT REFERENCES ingest_runs(id)
);
CREATE INDEX top_three_session ON top_three (session_id);

CREATE TABLE prediction_drivers (
  session_id         INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number      TEXT,
  current_position   INT,
  current_points     NUMERIC,
  predicted_position INT,
  predicted_points   NUMERIC,
  ts_ns              BIGINT,
  ingest_run_id      INT REFERENCES ingest_runs(id)
);
CREATE INDEX prediction_drivers_session ON prediction_drivers (session_id);

CREATE TABLE prediction_teams (
  session_id         INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  team_id            TEXT,
  team_name          TEXT,
  current_position   INT,
  current_points     NUMERIC,
  predicted_position INT,
  predicted_points   NUMERIC,
  ts_ns              BIGINT,
  ingest_run_id      INT REFERENCES ingest_runs(id)
);
CREATE INDEX prediction_teams_session ON prediction_teams (session_id);

CREATE TABLE intervals (
  session_id         INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number      TEXT NOT NULL,
  ts_ns              BIGINT,
  position           INT,
  gap_to_leader      TEXT,
  gap_to_car_ahead   TEXT,
  ingest_run_id      INT REFERENCES ingest_runs(id)
);
CREATE INDEX intervals_lookup ON intervals (session_id, driver_number, ts_ns);

CREATE TABLE stints (
  session_id    INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number TEXT NOT NULL,
  ts_ns         BIGINT,
  stint         INT,
  compound      TEXT,
  new           BOOLEAN,
  tyres_changed BOOLEAN,
  stint_age     INT,
  start_lap     INT,
  lap_flags     INT,
  ingest_run_id INT REFERENCES ingest_runs(id)
);
CREATE INDEX stints_lookup ON stints (session_id, driver_number, ts_ns);

CREATE TABLE driver_reference (
  session_id       INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number    TEXT NOT NULL,
  driver_id        TEXT,
  abbreviation     TEXT,
  permanent_number TEXT,
  given_name       TEXT,
  family_name      TEXT,
  date_of_birth    TEXT,
  nationality      TEXT,
  ingest_run_id    INT REFERENCES ingest_runs(id)
);
CREATE INDEX driver_reference_session ON driver_reference (session_id);

CREATE TABLE telemetry (
  ts_ns         BIGINT   NOT NULL,
  session_id    INT      NOT NULL,
  driver_number INT      NOT NULL,
  x             REAL,
  y             REAL,
  z             REAL,
  rpm           INT,
  year          SMALLINT NOT NULL,
  speed         SMALLINT,
  gear          SMALLINT,
  throttle      SMALLINT,
  brake         SMALLINT,
  drs           SMALLINT
) PARTITION BY LIST (year);
CREATE INDEX telemetry_lookup ON telemetry (session_id, driver_number, ts_ns);

CREATE TABLE drs_codes (
  code  SMALLINT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE telemetry_summary (
  session_id    INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  driver_number INT NOT NULL,
  samples       BIGINT NOT NULL,
  car_samples   BIGINT NOT NULL,
  pos_samples   BIGINT NOT NULL,
  min_ts_ns     BIGINT,
  max_ts_ns     BIGINT,
  ingest_run_id INT REFERENCES ingest_runs(id),
  PRIMARY KEY (session_id, driver_number)
);

CREATE TABLE export_jobs (
  id            UUID PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'expired', 'cancelled')),
  request       JSONB NOT NULL,
  estimate      JSONB,
  rows_written  BIGINT NOT NULL DEFAULT 0,
  rows_total    BIGINT,
  stage         TEXT,
  file_name     TEXT,
  file_bytes    BIGINT,
  error         TEXT,
  requester_ip  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  heartbeat_at  TIMESTAMPTZ
);
CREATE INDEX export_jobs_queue ON export_jobs (status, created_at);

CREATE TABLE search_index (
  type     TEXT NOT NULL,
  title    TEXT NOT NULL,
  subtitle TEXT,
  href     TEXT NOT NULL,
  terms    TEXT NOT NULL,
  weight   REAL NOT NULL DEFAULT 1
);
CREATE INDEX search_index_terms_trgm ON search_index USING gin (terms gin_trgm_ops);

CREATE TABLE team_names (
  year           SMALLINT NOT NULL,
  team_name      TEXT NOT NULL,
  constructor_id TEXT,
  colour         TEXT,
  PRIMARY KEY (year, team_name)
);
CREATE INDEX team_names_constructor ON team_names (constructor_id, year);

CREATE TABLE site_notice (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  message    TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  set_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);