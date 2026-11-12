import type { FastifyPluginAsync } from 'fastify';
import type { LapRow } from '@f1archive/shared';
import { getSessionDetail, getTimeline, getTrackOutline, resolveSession } from '../lib/archive.js';
import { ARCHIVE_CACHE, sessionParams, type SessionParams } from '../lib/schemas.js';

const driverQuery = {
  type: 'object',
  properties: { driver: { type: 'string', pattern: '^[0-9]{1,5}$', description: 'Car number in this session' } },
} as const;

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const base = '/sessions/:year/:event/:session';
  const radioUrl = (ref: { year: number; event_slug: string; slug: string }) => (id: number) => `/media/radio/${ref.year}/${ref.event_slug}/${ref.slug}/${id}.mp3`;

  app.get<{ Params: SessionParams }>(
    base,
    { schema: { tags: ['session'], summary: 'Session detail: drivers, feed availability, time range', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      return getSessionDetail(db, ref);
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/drivers`,
    { schema: { tags: ['session'], summary: 'Drivers in the session', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      return (await getSessionDetail(db, ref)).drivers;
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/results`,
    { schema: { tags: ['session'], summary: 'Classification', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      const r = await db.query(
        `SELECT r.driver_number, coalesce(nullif(r.driver_id, ''), sd.driver_id) AS driver_id, r.abbreviation, r.team_name, r.position, r.position_text, r.grid_position,
                r.q1_ns, r.q2_ns, r.q3_ns, r.laps, r.status, r.points, r.time_ns, r.fastest_lap_rank, r.fastest_lap_number,
                r.fastest_lap_time_ns, r.fastest_lap_avg_speed, sd.full_name, sd.team_colour, tn.constructor_id
         FROM results r LEFT JOIN session_drivers sd ON sd.session_id = r.session_id AND sd.driver_number = r.driver_number
         LEFT JOIN team_names tn ON tn.year = $2 AND tn.team_name = r.team_name
         WHERE r.session_id = $1 ORDER BY r.position NULLS LAST, r.driver_number`,
        [ref.id, ref.year],
      );
      return r.rows;
    },
  );

  app.get<{ Params: SessionParams; Querystring: { driver?: string } }>(
    `${base}/laps`,
    {
      schema: {
        tags: ['session'],
        summary: 'Laps with sector times, speed traps, pit times and tyre compound',
        description: 'The compound is derived: the latest stint record at or before the lap end.',
        params: sessionParams,
        querystring: driverQuery,
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      const r = await db.query<LapRow>(
        `SELECT l.driver_number AS driver, l.lap_no AS lap, l.lap_time_ns, l.s1_ns, l.s2_ns, l.s3_ns, l.start_ns, l.end_ns,
                l.pit_in_ns, l.pit_out_ns, l.position, l.is_personal_best, l.deleted, l.deleted_reason, l.track_status,
                l.speed_i1, l.speed_i2, l.speed_fl, l.speed_st, l.is_accurate,
                st.compound, st.stint_age AS tyre_age
         FROM laps l
         LEFT JOIN LATERAL (
           SELECT compound, stint_age FROM stints s WHERE s.session_id = l.session_id AND s.driver_number = l.driver_number AND s.ts_ns <= l.end_ns
           ORDER BY s.ts_ns DESC LIMIT 1
         ) st ON true
         WHERE l.session_id = $1 ${req.query.driver ? 'AND l.driver_number = $2' : ''}
         ORDER BY l.driver_number, l.lap_no`,
        req.query.driver ? [ref.id, req.query.driver] : [ref.id],
      );
      return r.rows;
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/stints`,
    { schema: { tags: ['session'], summary: 'Tyre stints, summarised: one row per driver per stint', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      const r = await db.query(
        `SELECT driver_number AS driver, stint,
                (array_agg(compound ORDER BY ts_ns DESC) FILTER (WHERE compound IS NOT NULL))[1] AS compound,
                bool_or(new) AS new, min(start_lap) AS start_lap, max(stint_age) AS max_age, min(ts_ns) AS from_ns, max(ts_ns) AS to_ns
         FROM stints WHERE session_id = $1 AND stint IS NOT NULL GROUP BY driver_number, stint ORDER BY driver_number, stint`,
        [ref.id],
      );
      return r.rows;
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/pit-stops`,
    { schema: { tags: ['session'], summary: 'Pit stops (races and sprints)', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      const r = await db.query(
        `SELECT p.driver_id, p.stop_number, p.lap, p.duration_ns, p.time_of_day_ns, sd.driver_number, sd.abbreviation, sd.team_colour
         FROM pit_stops p LEFT JOIN session_drivers sd ON sd.session_id = p.session_id AND sd.driver_id = p.driver_id
         WHERE p.session_id = $1 ORDER BY p.lap, p.stop_number`,
        [ref.id],
      );
      return r.rows;
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/weather`,
    { schema: { tags: ['session'], summary: 'Weather samples', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      return (
        await db.query(
          `SELECT ts_ns, air_temp_c, track_temp_c, humidity_pct, pressure_mbar, rainfall, wind_direction_deg, wind_speed_ms
           FROM weather WHERE session_id = $1 ORDER BY ts_ns`,
          [ref.id],
        )
      ).rows;
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/race-control`,
    { schema: { tags: ['session'], summary: 'Race control messages', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      return (
        await db.query(
          `SELECT id, ts_ns, message, category, flag, scope, sector, driver_number, lap, status FROM race_control WHERE session_id = $1 ORDER BY ts_ns, id`,
          [ref.id],
        )
      ).rows;
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/radio`,
    {
      schema: {
        tags: ['session'],
        summary: 'Team radio clips with recording URLs',
        description:
          'Every clip F1 published for the session. `audio_url` is null when this deployment does not hold the recording; `source_url` is the original location on F1\'s archive.',
        params: sessionParams,
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      const url = radioUrl(ref);
      const r = await db.query(
        `SELECT r.id, r.ts_ns, r.utc, r.driver_number, r.path, r.file_available, r.file_bytes, sd.abbreviation, sd.full_name, sd.team_name, sd.team_colour
         FROM team_radio r LEFT JOIN session_drivers sd ON sd.session_id = r.session_id AND sd.driver_number = r.driver_number
         WHERE r.session_id = $1 ORDER BY r.ts_ns, r.id`,
        [ref.id],
      );
      return r.rows.map((x) => ({
        id: Number(x.id),
        t_ns: x.ts_ns,
        utc: x.utc ? new Date(x.utc).toISOString() : null,
        driver: x.driver_number,
        abbreviation: x.abbreviation,
        full_name: x.full_name,
        team_name: x.team_name,
        team_colour: x.team_colour,
        channel: x.abbreviation ? `${x.abbreviation} car radio` : null,
        audio_url: x.file_available ? url(Number(x.id)) : null,
        bytes: x.file_bytes,
        source_url: ref.archive_path && x.path ? `https://livetiming.formula1.com/static/${ref.archive_path}${x.path}` : null,
      }));
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/timeline`,
    {
      schema: {
        tags: ['session'],
        summary: 'Chronological session timeline: track status periods, race control, radio, pit stops, laps',
        params: sessionParams,
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      return getTimeline(db, ref, radioUrl(ref));
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/track`,
    {
      schema: {
        tags: ['session'],
        summary: 'Circuit outline reconstructed from one clean lap of position data, plus corner, marshal light and marshal sector positions',
        params: sessionParams,
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      return getTrackOutline(db, ref);
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/intervals`,
    {
      schema: {
        tags: ['session'],
        summary: 'Live timing intervals: position, gap to leader and gap to the car ahead through the session (columnar)',
        description:
          'A running record: each entry is the state from that session time until the next entry for the same driver. Gaps are the verbatim published text ("+1.234", "1 L", "LAP 12" for the leader); they are empty in sessions where F1 publishes none (e.g. qualifying).',
        params: sessionParams,
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      const r = await db.query({
        text: `SELECT driver_number, ts_ns, position, gap_to_leader, gap_to_car_ahead FROM intervals WHERE session_id = $1 ORDER BY driver_number, ts_ns`,
        values: [ref.id],
        rowMode: 'array',
      });
      const drivers: Record<string, { ts_ns: number[]; position: (number | null)[]; gap_to_leader: (string | null)[]; gap_to_car_ahead: (string | null)[] }> = {};
      for (const [d, ts, pos, gl, ga] of r.rows as [string, number, number | null, string | null, string | null][]) {
        const s = (drivers[d] ??= { ts_ns: [], position: [], gap_to_leader: [], gap_to_car_ahead: [] });
        s.ts_ns.push(ts);
        s.position.push(pos);
        s.gap_to_leader.push(gl);
        s.gap_to_car_ahead.push(ga);
      }
      return { session: ref.key, drivers };
    },
  );

  app.get<{ Params: SessionParams }>(
    `${base}/positions-by-lap`,
    { schema: { tags: ['session'], summary: 'Running order at the end of each lap (from lap timing)', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      return (
        await db.query(
          `SELECT driver_number AS driver, lap_no AS lap, position, end_ns FROM laps WHERE session_id = $1 AND position IS NOT NULL ORDER BY lap_no, position`,
          [ref.id],
        )
      ).rows;
    },
  );
};
