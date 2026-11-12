# Data

## Principles

- The SQLite archive is the source of truth. It is opened read-only (`query_only`), mounted read-only in Docker, and never migrated or modified.
- PostgreSQL is a rebuildable projection of it (`worker ingest`).
- Values are converted only between storage types, never between units. A value that does not fit its declared type stops the ingestion with the table, column and value, instead of being coerced or dropped.
- Missing stays missing: SQL `NULL`, never `0` or `''` and text fields keep the source's own empty strings verbatim.
- Every row carries `ingest_run_id`; `ingest_runs` records source path, subset or full, options, row counts, anomalies and any source columns that are not mapped yet.

## Mapping

| Source                                                                              | Production                                                                                              | Notes                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `t_ref_drivers`, `t_ref_constructors`, `t_ref_circuits`, `t_ref_finishing_statuses` | `ref_*`                                                                                                 | Replaced wholesale each run.                                                          |
| `t_season_events` + `t_event_info`                                                  | `seasons`, `events`                                                                                     | Events only in the season schedule are `schedule_only` (e.g. upcoming 2026 rounds).   |
| `t_season_teams`, `t_season_compounds`                                              | `season_teams` (colours split out, raw JSON kept), `season_compounds`                                   |                                                                                       |
| `t_event_sessions` + `t_session_info`                                               | `sessions`                                                                                              | `status` = archived / missing / upcoming.                                             |
| `t_event_circuit_corners`, `_marshal_lights`, `_marshal_sectors`                    | `circuit_points` (`kind`)                                                                               | Same coordinate system as telemetry.                                                  |
| `t_event_standings_*`                                                               | `standings_*`                                                                                           | `ConstructorIds` -> `text[]`. Redundant `Season`/`Round` columns are not copied.      |
| `t_session_*`, `t_driver_*`                                                         | one table each (`laps`, `results`, `weather`, `race_control`, `team_radio`, `stints`, `intervals`, ...) | Column-by-column map in `apps/worker/src/ingest/tables.ts`. Durations -> `BIGINT` ns. |
| `t_session_broadcast_*`                                                             | availability only                                                                                       | Stream URLs are not republished.                                                      |
| `telemetry`                                                                         | `telemetry` partitioned by season (`telemetry_y2021`, ...) + `telemetry_summary`                        | `drs_no` stored as `drs`; text labels in `drs_codes`.                                 |
| `_no_data` placeholders                                                             | `feed_availability`                                                                                     | Placeholder rows are not copied; their meaning is.                                    |

### Feed availability

Every feed of every session (and every driver, for driver-level feeds and telemetry) gets a state in `feed_availability`:

| State          | Meaning                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `present`      | Real rows.                                                                                       |
| `partial`      | Telemetry with only the car feed or only the position feed (`detail` says which half is absent). |
| `no_data`      | Only a `_no_data = 1` placeholder: the API answered with nothing.                                |
| `missing`      | No rows at all: the request failed, or the session was never archived.                           |
| `not_imported` | The source has it but this deployment left it out (development subset).                          |
| `upcoming`     | Scheduled, not held yet.                                                                         |

"Why is this missing?" combines that state with the documented catalogue in `packages/shared/src/gaps.ts`. When no documented entry matches, the generic explanation for the state is shown and labelled as generic.

## Units and time

|                                                          |                                                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durations, lap/sector times, `Timestamp`, `telemetry.ts` | integer nanoseconds*(`*_ns`)                                                                                                                                                       |
| Session time                                             | ns since the start of the session's data stream; the shared timeline for telemetry, laps, race control, radio, weather, track status                                               |
| `sessions.stream_start_utc`                              | derived: median of `team_radio.utc − ts_ns` per session. Used to show local wall-clock time. NULL when a session has no radio.                                                     |
| Local time                                               | `stream_start_utc + session time + gmt_offset` (offset from `t_session_info.GmtOffset`, ns)                                                                                        |
| Speed                                                    | km/h · throttle % (can exceed 100 in the raw feed) · brake 0/1 · temperatures °C · pressure mbar · wind m/s                                                                        |
| x, y, z                                                  | F1's own track coordinate system. The unit is not documented by the source; it is commonly reported to be 1/10 m but this is not verified here, so the site says "F1 track units". |
| DRS                                                      | raw code kept; observed labels: 0/1 `DISABLED`, 2/3 `UNKNOWN`, 8 `ELIGIBLE`, 10/12/14 `ENABLED` (open).                                                                            |

## Identifiers

- `year` + event slug + session slug: `2021/abu-dhabi/race`; session key `2021-abu-dhabi-race`. Derived from the source's names (`eventSlug`, `sessionSlug` in `packages/shared/src/ids.ts`), so they are stable across rebuilds. Testing events become `pre-season-testing-N`. A clash inside one season would get `-r<round>` (none exists today).
- Internal integer ids (`events.id`, `sessions.id`) are surrogate keys and never exposed as public identifiers.
- Drivers: car number within a session (text, as in the source) and Jolpica `driver_id` across sessions.

### How `session_drivers.driver_id` is linked

1. From that session's results (`DriverId`, ignoring the empty strings practice results carry).
2. From the driver reference stored against the same event's race only if the abbreviation also matches (reserve drivers sometimes run in practice under a race driver's car number).
3. Same season, same car number and same abbreviation.
4. Identical full name anywhere in the archive, when that name maps to exactly one id.

### How team names are linked to constructors (`team_names`)

F1 publishes a team name per session ("Red Bull Racing", "Kick Sauber"); Jolpica identifies constructors by id (`red_bull`, `sauber`). For every season and team name, each race or sprint result votes with the constructor ids of that driver in the standings after the event, and the most common id wins so a driver who changed teams mid-season (and so carries two ids) cannot flip a team. Rebuilt on every ingest. Two notable results: 2018 "Racing Point" maps to `force_india` (Jolpica keeps the 2018 entry as one constructor), and rebrands that Jolpica treats as new constructors (Toro Rosso -> AlphaTauri -> RB) are separate teams.

Reserve and test drivers who never started a Grand Prix have no Jolpica id and therefore no driver page; they still appear in their sessions.

## Found in the data

These are properties of the source that the code handles explicitly. None of them is "fixed" in the stored data.

- **Telemetry timeline.** Each row is a new sample from *one* of the two feeds (car or position), with the other feed's latest values carried forward; only rows before a feed's first sample have that half NULL. Exports keep this exactly. The circuit map and track outline use only rows where the position changes, i.e. the actual position samples at their own timestamps.
- **(0, 0, 0) positions** appear before a car's first real fix (in the garage). The map does not draw a car at exactly (0, 0); the data is unchanged.
- **Empty strings for "none".** Track-wide race control messages have `DriverNumber = ''` (36,611 rows); practice results have `DriverId = ''`. Kept verbatim; treated as "no driver" when filtering and linking.
- **2023 Qatar schedule** has three extra schedule entries with a blank session type and no path, duplicates of the Sprint Shootout (at its original start time, 20 min before the actual one), Sprint and Race. They are matched by start time and dropped, and the run records it.
- **2020 British GP Practice 1** lists Sergio Pérez under car numbers `0` and `65535` (he was replaced that weekend). Kept as published.
- **Pit stop `Time`** (Jolpica) is a local time of day in ns since local midnight, not a session time, e.g. Verstappen's 2021 Abu Dhabi stop on lap 13 is `62562e9` ns = 17:22:42 local. Stored as `time_of_day_ns`.
- **`results.time_ns`** is the winner's total race time but a gap to the winner for everyone else (source semantics), documented on the column.
- **`ArchiveStatus`** is `{"Status":"Generating"}` on every stored session: it is the status at fetch time, not a statement that the session is incomplete.
- **Team radio** identifies the car's channel (`MAXVER01_33_...`), not the speaker.

## Derived data

Everything below is computed by F1Archive, marked as derived wherever it is shown or exported, and never stored in place of source data:

- `sessions.stream_start_utc`, `total_laps` (from the lap counter, else results), `time_from_ns`/`time_to_ns`.
- Tyre compound per lap (latest stint record at or before the lap end).
- Lap distance and time delta in comparisons (trapezoidal integration of speed).
- The track outline (one clean lap of position data, de-duplicated and thinned to ≤ 900 points).
- The running order in the viewer (position at the end of each driver's last completed lap).
