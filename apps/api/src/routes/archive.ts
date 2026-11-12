import type { FastifyPluginAsync } from 'fastify';
import type { ArchiveStats, CalendarRound, SearchResult, SeasonSummary } from '@f1archive/shared';
import { Cache } from '../lib/cache.js';
import { listEvents, mapSession, SESSION_SUMMARY_SQL } from '../lib/archive.js';
import { notFound } from '../lib/errors.js';
import { ARCHIVE_CACHE, eventParams, seasonParams } from '../lib/schemas.js';

const statsCache = new Cache<ArchiveStats>(1, 60_000);

export const archiveRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/stats', { schema: { tags: ['archive'], summary: 'Archive statistics, computed live from the database' } }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    return statsCache.get('stats', async () => {
      const r = (
        await db.query(`SELECT
          (SELECT count(*) FROM seasons) AS seasons,
          (SELECT count(*) FROM events WHERE NOT schedule_only) AS events,
          (SELECT count(*) FROM sessions) AS sessions,
          (SELECT count(*) FROM sessions WHERE status = 'archived') AS sessions_archived,
          (SELECT count(DISTINCT coalesce(driver_id, 'name:' || upper(full_name))) FROM session_drivers) AS drivers,
          (SELECT coalesce(sum(samples), 0) FROM telemetry_summary) AS telemetry_samples,
          (SELECT count(*) FROM laps) AS laps,
          (SELECT count(*) FROM team_radio) AS team_radio_messages,
          (SELECT count(*) FROM team_radio WHERE file_available) AS team_radio_recordings_available,
          (SELECT count(*) FROM race_control) AS race_control_messages,
          (SELECT count(*) FROM weather) AS weather_samples,
          (SELECT max(finished_at) FROM ingest_runs WHERE status = 'succeeded') AS last_ingest,
          (SELECT source_kind FROM ingest_runs WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1) AS kind`)
      ).rows[0];
      return {
        seasons: Number(r.seasons),
        events: Number(r.events),
        sessions: Number(r.sessions),
        sessions_archived: Number(r.sessions_archived),
        drivers: Number(r.drivers),
        telemetry_samples: Number(r.telemetry_samples),
        laps: Number(r.laps),
        team_radio_messages: Number(r.team_radio_messages),
        team_radio_recordings_available: Number(r.team_radio_recordings_available),
        race_control_messages: Number(r.race_control_messages),
        weather_samples: Number(r.weather_samples),
        last_ingest_utc: r.last_ingest ? new Date(r.last_ingest).toISOString() : null,
        deployment: r.kind === 'subset' ? 'subset' : 'full',
      };
    });
  });

  app.get('/seasons', { schema: { tags: ['archive'], summary: 'All seasons with counts, champions and completeness' } }, async (_req, reply) => {
    reply.header('cache-control', ARCHIVE_CACHE);
    const r = await db.query(`
      WITH last_event AS (
        SELECT DISTINCT ON (year) year, id FROM events
        WHERE id IN (SELECT event_id FROM standings_drivers) ORDER BY year, round DESC
      )
      SELECT y.year,
        (SELECT count(*) FROM events e WHERE e.year = y.year AND NOT e.schedule_only) AS events,
        (SELECT count(*) FROM sessions s JOIN events e ON e.id = s.event_id WHERE e.year = y.year) AS sessions,
        (SELECT count(*) FROM sessions s JOIN events e ON e.id = s.event_id WHERE e.year = y.year AND s.status = 'archived') AS archived,
        (SELECT count(*) FROM sessions s JOIN events e ON e.id = s.event_id WHERE e.year = y.year AND s.status <> 'upcoming') AS held,
        (SELECT json_build_object('driver_id', sd.driver_id, 'name', concat_ws(' ', rd.given_name, rd.family_name), 'points', sd.points)
           FROM standings_drivers sd LEFT JOIN ref_drivers rd ON rd.driver_id = sd.driver_id
           WHERE sd.event_id = le.id AND sd.position = 1 LIMIT 1) AS champion_driver,
        (SELECT json_build_object('constructor_id', sc.constructor_id, 'name', coalesce(rc.name, sc.constructor_id), 'points', sc.points)
           FROM standings_constructors sc LEFT JOIN ref_constructors rc ON rc.constructor_id = sc.constructor_id
           WHERE sc.event_id = le.id AND sc.position = 1 LIMIT 1) AS champion_constructor,
        (SELECT bool_or(e.schedule_only) OR bool_or(s.status = 'upcoming') FROM events e LEFT JOIN sessions s ON s.event_id = e.id WHERE e.year = y.year) AS in_progress
      FROM seasons y LEFT JOIN last_event le ON le.year = y.year ORDER BY y.year DESC`);
    return r.rows.map(
      (x): SeasonSummary & { in_progress: boolean } => ({
        year: x.year,
        events: Number(x.events),
        sessions: Number(x.sessions),
        sessions_archived: Number(x.archived),
        champion_driver: x.champion_driver,
        champion_constructor: x.champion_constructor,
        completeness: Number(x.held) ? Number(x.archived) / Number(x.held) : null,
        in_progress: !!x.in_progress,
      }),
    );
  });

  app.get<{ Params: { year: number } }>(
    '/seasons/:year',
    { schema: { tags: ['archive'], summary: 'A season: events with their sessions, team colours, final standings', params: seasonParams } },
    async (req, reply) => {
      const { year } = req.params;
      const exists = await db.query('SELECT 1 FROM seasons WHERE year = $1', [year]);
      if (!exists.rowCount) throw notFound(`Season ${year}`);
      reply.header('cache-control', ARCHIVE_CACHE);
      const [events, teams, standings] = await Promise.all([
        listEvents(db, year),
        db.query(`SELECT key, short_name, colour_official, colour_fastf1 FROM season_teams WHERE year = $1 ORDER BY short_name`, [year]),
        db.query(
          `WITH le AS (SELECT e.id, e.round, e.name, e.slug FROM events e WHERE e.year = $1 AND e.id IN (SELECT event_id FROM standings_drivers) ORDER BY e.round DESC LIMIT 1)
           SELECT le.round, le.name, le.slug,
             (SELECT json_agg(json_build_object('position', sd.position, 'driver_id', sd.driver_id, 'abbreviation', sd.abbreviation,
                 'name', concat_ws(' ', rd.given_name, rd.family_name), 'points', sd.points, 'wins', sd.wins, 'constructor_ids', sd.constructor_ids) ORDER BY sd.position)
              FROM standings_drivers sd LEFT JOIN ref_drivers rd ON rd.driver_id = sd.driver_id WHERE sd.event_id = le.id) AS drivers,
             (SELECT json_agg(json_build_object('position', sc.position, 'constructor_id', sc.constructor_id, 'name', coalesce(rc.name, sc.constructor_id),
                 'points', sc.points, 'wins', sc.wins) ORDER BY sc.position)
              FROM standings_constructors sc LEFT JOIN ref_constructors rc ON rc.constructor_id = sc.constructor_id WHERE sc.event_id = le.id) AS constructors
           FROM le`,
          [year],
        ),
      ]);
      return { year, events, teams: teams.rows, standings: standings.rows[0] ?? null };
    },
  );

  app.get<{ Params: { year: number } }>(
    '/seasons/:year/events',
    { schema: { tags: ['archive'], summary: 'Events of a season', params: seasonParams } },
    async (req, reply) => {
      reply.header('cache-control', ARCHIVE_CACHE);
      return listEvents(db, req.params.year);
    },
  );

  app.get<{ Params: { year: number; event: string } }>(
    '/events/:year/:event',
    { schema: { tags: ['archive'], summary: 'An event with sessions, circuit data availability and standings after it', params: eventParams } },
    async (req, reply) => {
      const [ev] = await listEvents(db, req.params.year, req.params.event);
      if (!ev) throw notFound(`Event ${req.params.year}/${req.params.event}`);
      reply.header('cache-control', ARCHIVE_CACHE);
      const id = (await db.query('SELECT id FROM events WHERE year = $1 AND slug = $2', [req.params.year, req.params.event])).rows[0].id;
      const [feeds, standings, winner] = await Promise.all([
        db.query(`SELECT feed, state, rows FROM feed_availability WHERE scope = 'event' AND scope_id = $1 ORDER BY feed`, [id]),
        db.query(
          `SELECT sd.position, sd.driver_id, sd.abbreviation, concat_ws(' ', rd.given_name, rd.family_name) AS name, sd.points, sd.wins
           FROM standings_drivers sd LEFT JOIN ref_drivers rd ON rd.driver_id = sd.driver_id WHERE sd.event_id = $1 ORDER BY sd.position LIMIT 10`,
          [id],
        ),
        db.query(
          `SELECT r.position, r.abbreviation, coalesce(nullif(r.driver_id, ''), sd.driver_id) AS driver_id, r.team_name, sd.full_name, sd.team_colour
           FROM results r JOIN sessions s ON s.id = r.session_id LEFT JOIN session_drivers sd ON sd.session_id = r.session_id AND sd.driver_number = r.driver_number
           WHERE s.event_id = $1 AND s.kind = 'race' AND r.position BETWEEN 1 AND 3 ORDER BY r.position`,
          [id],
        ),
      ]);
      return { ...ev, feeds: feeds.rows, standings_after: standings.rows, podium: winner.rows };
    },
  );

  app.get<{ Params: { year: number } }>(
    '/seasons/:year/calendar',
    {
      schema: {
        tags: ['archive'],
        summary: 'Rounds of a season with race winners and a sketch of each circuit',
        description:
          'The sketch joins the circuit markers (corners and marshal posts) in lap order. Rounds without markers borrow the latest earlier sketch of the same circuit (or, for rounds not yet run whose circuit is not known, of the same Grand Prix) and say which year it is from.',
        params: seasonParams,
      },
    },
    async (req, reply) => {
      const { year } = req.params;
      const exists = await db.query('SELECT 1 FROM seasons WHERE year = $1', [year]);
      if (!exists.rowCount) throw notFound(`Season ${year}`);
      reply.header('cache-control', ARCHIVE_CACHE);
      const rows = (
        await db.query(
          `SELECT e.round, e.slug, e.name, e.circuit_short_name, e.country, e.start_utc, e.end_utc,
             (SELECT json_build_object('abbreviation', r.abbreviation, 'name', sd.full_name, 'team_colour', sd.team_colour)
                FROM results r JOIN sessions s ON s.id = r.session_id
                LEFT JOIN session_drivers sd ON sd.session_id = r.session_id AND sd.driver_number = r.driver_number
                WHERE s.event_id = e.id AND s.kind = 'race' AND r.position = 1 LIMIT 1) AS winner,
             sk.year AS sketch_year, sk.pts AS sketch
           FROM events e
           LEFT JOIN LATERAL (
             SELECT src.year, json_agg(json_build_array(round(cp.x)::int, round(cp.y)::int) ORDER BY cp.length) AS pts
             FROM events src JOIN circuit_points cp ON cp.event_id = src.id
             WHERE (src.id = e.id
                    OR (e.circuit_key > 0 AND src.circuit_key = e.circuit_key AND src.year <= e.year)
                    -- Rounds not yet run often have no circuit key: use the same Grand Prix's last visit.
                    OR (coalesce(e.circuit_key, 0) = 0 AND src.slug = e.slug AND src.year < e.year))
               AND cp.x IS NOT NULL AND cp.length IS NOT NULL
             GROUP BY src.id, src.year, src.start_utc
             ORDER BY (src.id = e.id) DESC, src.start_utc DESC
             LIMIT 1
           ) sk ON true
           WHERE e.year = $1 AND NOT e.is_testing
           ORDER BY e.round`,
          [year],
        )
      ).rows;
      return rows.map(
        (r): CalendarRound => ({
          round: r.round,
          event: r.slug,
          name: r.name,
          circuit: r.circuit_short_name,
          country: r.country,
          start_utc: r.start_utc?.toISOString() ?? null,
          end_utc: r.end_utc?.toISOString() ?? null,
          winner: r.winner,
          sketch: r.sketch ? despike(r.sketch) : null,
          sketch_year: r.sketch && r.sketch_year !== year ? r.sketch_year : null,
        }),
      );
    },
  );

  app.get<{ Querystring: { limit?: number } }>(
    '/recent',
    {
      schema: {
        tags: ['archive'],
        summary: 'Most recently archived sessions',
        querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 8 } } },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=120');
      const r = await db.query(
        `${SESSION_SUMMARY_SQL.replace('SELECT ', 'SELECT e.name AS event_name, s.ingested_at, ')}
         WHERE s.status = 'archived' ORDER BY s.scheduled_start_utc DESC NULLS LAST LIMIT $1`,
        [req.query.limit ?? 8],
      );
      return r.rows.map((x) => ({ ...mapSession(x), event_name: x.event_name, ingested_utc: x.ingested_at ? new Date(x.ingested_at).toISOString() : null }));
    },
  );

  app.get<{ Querystring: { telemetry?: boolean; year?: number; limit?: number } }>(
    '/sessions',
    {
      schema: {
        tags: ['archive'],
        summary: 'List archived sessions, optionally only those with telemetry',
        querystring: {
          type: 'object',
          properties: {
            telemetry: { type: 'boolean' },
            year: { type: 'integer', minimum: 1950, maximum: 2200 },
            limit: { type: 'integer', minimum: 1, maximum: 2000, default: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', ARCHIVE_CACHE);
      const where = [`s.status = 'archived'`];
      const vals: unknown[] = [];
      if (req.query.telemetry) where.push('EXISTS (SELECT 1 FROM telemetry_summary t WHERE t.session_id = s.id)');
      if (req.query.year) {
        vals.push(req.query.year);
        where.push(`e.year = $${vals.length}`);
      }
      vals.push(req.query.limit ?? 200);
      const r = await db.query(
        `${SESSION_SUMMARY_SQL.replace('SELECT ', 'SELECT e.name AS event_name, ')} WHERE ${where.join(' AND ')}
         ORDER BY s.scheduled_start_utc DESC NULLS LAST LIMIT $${vals.length}`,
        vals,
      );
      return r.rows.map((x) => ({ ...mapSession(x), event_name: x.event_name }));
    },
  );

  app.get<{ Querystring: { q: string; limit?: number; type?: string } }>(
    '/search',
    {
      schema: {
        tags: ['archive'],
        summary: 'Search drivers, events, sessions, circuits, seasons and teams',
        querystring: {
          type: 'object',
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 100 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            type: { type: 'string', enum: ['driver', 'event', 'session', 'circuit', 'season', 'constructor'] },
          },
        },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'public, max-age=300');
      const q = req.query.q.trim();
      const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
      const conds = words.map((_, i) => `terms ILIKE '%' || $${i + 3} || '%'`);
      const r = await db.query<SearchResult & { score: number }>(
        `SELECT type, title, subtitle, href, similarity(terms, $1) * weight AS score FROM search_index
         WHERE (${conds.join(' AND ')}) ${req.query.type ? `AND type = '${req.query.type}'` : ''}
         ORDER BY score DESC, title LIMIT $2`,
        [q, req.query.limit ?? 20, ...words.map((w) => w.replace(/[%_\\]/g, (m) => `\\${m}`))],
      );
      return r.rows.map(({ score: _s, ...x }) => x);
    },
  );

  app.get('/drivers', { schema: { tags: ['archive'], summary: 'Every driver who started a Grand Prix in the archive' } }, async (_req, reply) => {
    reply.header('cache-control', ARCHIVE_CACHE);
    const r = await db.query(`
      SELECT x.driver_id, rd.given_name, rd.family_name, rd.nationality,
             min(x.year) AS first_year, max(x.year) AS last_year,
             count(*)::int AS races,
             count(*) FILTER (WHERE x.position = 1)::int AS wins,
             (array_agg(x.abbreviation ORDER BY x.start DESC))[1] AS abbreviation,
             (array_agg(x.team_colour ORDER BY x.start DESC))[1] AS team_colour,
             (array_agg(x.team_name ORDER BY x.start DESC))[1] AS team_name
      FROM (
        -- Some results carry no Jolpica id; fall back to the id linked on the session's driver.
        SELECT coalesce(nullif(r.driver_id, ''), sd.driver_id) AS driver_id, e.year, r.position, r.abbreviation, r.team_name,
               sd.team_colour, s.scheduled_start_utc AS start
        FROM results r JOIN sessions s ON s.id = r.session_id JOIN events e ON e.id = s.event_id
        LEFT JOIN session_drivers sd ON sd.session_id = r.session_id AND sd.driver_number = r.driver_number
        WHERE s.kind = 'race'
      ) x
      LEFT JOIN ref_drivers rd ON rd.driver_id = x.driver_id
      WHERE x.driver_id IS NOT NULL
      GROUP BY x.driver_id, rd.given_name, rd.family_name, rd.nationality
      ORDER BY max(x.year) DESC, rd.family_name`);
    return r.rows;
  });

  app.get<{ Params: { driverId: string } }>(
    '/drivers/:driverId',
    {
      schema: {
        tags: ['archive'],
        summary: 'A driver: reference details and every archived session',
        params: { type: 'object', required: ['driverId'], properties: { driverId: { type: 'string', pattern: '^[a-z0-9_]+$', maxLength: 60 } } },
      },
    },
    async (req, reply) => {
      const id = req.params.driverId;
      const [ref, sessions] = await Promise.all([
        db.query(`SELECT * FROM ref_drivers WHERE driver_id = $1`, [id]),
        db.query(
          `SELECT e.year, e.slug AS event, e.name AS event_name, e.round, s.slug, s.source_name AS name, s.kind, s.scheduled_start_utc AS start_utc,
                  sd.driver_number, sd.abbreviation, sd.team_name, sd.team_colour, sd.full_name, sd.headshot_url,
                  r.position, r.position_text, r.grid_position, r.points, r.status,
                  EXISTS (SELECT 1 FROM telemetry_summary t WHERE t.session_id = s.id AND t.driver_number::text = sd.driver_number) AS has_telemetry,
                  tn.constructor_id
           FROM session_drivers sd JOIN sessions s ON s.id = sd.session_id JOIN events e ON e.id = s.event_id
           LEFT JOIN results r ON r.session_id = sd.session_id AND r.driver_number = sd.driver_number
           LEFT JOIN team_names tn ON tn.year = e.year AND tn.team_name = sd.team_name
           WHERE sd.driver_id = $1 ORDER BY s.scheduled_start_utc DESC`,
          [id],
        ),
      ]);
      if (!ref.rowCount && !sessions.rowCount) throw notFound(`Driver ${id}`);
      reply.header('cache-control', ARCHIVE_CACHE);
      const races = sessions.rows.filter((s) => s.kind === 'race');
      return {
        driver_id: id,
        reference: ref.rows[0] ?? null,
        latest: sessions.rows[0] ? { full_name: sessions.rows[0].full_name, headshot_url: sessions.rows[0].headshot_url, team_name: sessions.rows[0].team_name, team_colour: sessions.rows[0].team_colour, abbreviation: sessions.rows[0].abbreviation, number: sessions.rows[0].driver_number } : null,
        summary: {
          races: races.length,
          wins: races.filter((r) => r.position === 1).length,
          podiums: races.filter((r) => r.position >= 1 && r.position <= 3).length,
          points: races.reduce((a, r) => a + (r.points ?? 0), 0),
          seasons: [...new Set(sessions.rows.map((s) => s.year))],
        },
        sessions: sessions.rows.map((s) => ({ ...s, start_utc: s.start_utc ? new Date(s.start_utc).toISOString() : null })),
      };
    },
  );

  app.get('/teams', { schema: { tags: ['archive'], summary: 'Every constructor in the archive with its seasons and names' } }, async (_req, reply) => {
    reply.header('cache-control', ARCHIVE_CACHE);
    const r = await db.query(`
      SELECT tn.constructor_id, coalesce(rc.name, tn.constructor_id) AS name, rc.nationality,
             array_agg(DISTINCT tn.year ORDER BY tn.year) AS seasons,
             (array_agg(tn.team_name ORDER BY tn.year DESC))[1] AS latest_name,
             (array_agg(tn.colour ORDER BY tn.year DESC))[1] AS latest_colour,
             array_agg(DISTINCT tn.team_name) AS names
      FROM team_names tn LEFT JOIN ref_constructors rc ON rc.constructor_id = tn.constructor_id
      WHERE tn.constructor_id IS NOT NULL
      GROUP BY tn.constructor_id, rc.name, rc.nationality
      ORDER BY max(tn.year) DESC, coalesce(rc.name, tn.constructor_id)`);
    return r.rows;
  });

  app.get<{ Params: { id: string } }>(
    '/teams/:id',
    {
      schema: {
        tags: ['archive'],
        summary: 'A constructor: seasons, championship results, drivers, wins and podiums',
        description: 'Keyed by Jolpica constructor id. The F1 team names used each season are linked to it by F1Archive (see docs/DATA.md).',
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-z0-9_]+$', maxLength: 60 } } },
      },
    },
    async (req, reply) => {
      const id = req.params.id;
      const names = await db.query<{ year: number; team_name: string; colour: string | null }>(
        `SELECT year, team_name, colour FROM team_names WHERE constructor_id = $1 ORDER BY year`,
        [id],
      );
      if (!names.rowCount) throw notFound(`Team ${id}`);
      const [ref, seasons, drivers] = await Promise.all([
        db.query(`SELECT constructor_id, name, nationality FROM ref_constructors WHERE constructor_id = $1`, [id]),
        db.query(
          `WITH last_event AS (
             SELECT DISTINCT ON (e.year) e.year, e.id FROM events e
             WHERE e.id IN (SELECT event_id FROM standings_constructors) ORDER BY e.year, e.round DESC
           ),
           res AS (
             SELECT e.year, r.position, r.points FROM results r JOIN sessions s ON s.id = r.session_id JOIN events e ON e.id = s.event_id
             JOIN team_names tn ON tn.year = e.year AND tn.team_name = r.team_name
             WHERE tn.constructor_id = $1 AND s.kind = 'race'
           )
           SELECT y.year,
             (SELECT array_agg(team_name ORDER BY team_name) FROM team_names WHERE constructor_id = $1 AND year = y.year) AS names,
             (SELECT colour FROM team_names WHERE constructor_id = $1 AND year = y.year LIMIT 1) AS colour,
             sc.position AS championship_position, sc.points AS championship_points,
             (SELECT count(*) FROM res WHERE res.year = y.year AND res.position = 1)::int AS wins,
             (SELECT count(*) FROM res WHERE res.year = y.year AND res.position BETWEEN 1 AND 3)::int AS podiums,
             (SELECT count(DISTINCT e.id) FROM results r JOIN sessions s ON s.id = r.session_id JOIN events e ON e.id = s.event_id
                JOIN team_names tn ON tn.year = e.year AND tn.team_name = r.team_name
                WHERE tn.constructor_id = $1 AND s.kind = 'race' AND e.year = y.year)::int AS races,
             le.id IS NOT NULL AND EXISTS (SELECT 1 FROM events e WHERE e.year = y.year AND e.schedule_only) AS in_progress
           FROM (SELECT DISTINCT year FROM team_names WHERE constructor_id = $1) y
           LEFT JOIN last_event le ON le.year = y.year
           LEFT JOIN standings_constructors sc ON sc.event_id = le.id AND sc.constructor_id = $1
           ORDER BY y.year DESC`,
          [id],
        ),
        db.query(
          `SELECT e.year, coalesce(nullif(r.driver_id, ''), sd.driver_id) AS driver_id, max(sd.full_name) AS full_name, max(r.abbreviation) AS abbreviation,
                  count(*)::int AS races, sum(coalesce(r.points, 0)) AS points,
                  count(*) FILTER (WHERE r.position = 1)::int AS wins,
                  min(r.position) AS best
           FROM results r JOIN sessions s ON s.id = r.session_id JOIN events e ON e.id = s.event_id
           JOIN team_names tn ON tn.year = e.year AND tn.team_name = r.team_name
           LEFT JOIN session_drivers sd ON sd.session_id = r.session_id AND sd.driver_number = r.driver_number
           WHERE tn.constructor_id = $1 AND s.kind = 'race'
           GROUP BY e.year, coalesce(nullif(r.driver_id, ''), sd.driver_id)
           ORDER BY e.year DESC, count(*) DESC`,
          [id],
        ),
      ]);
      reply.header('cache-control', ARCHIVE_CACHE);
      const byYear = new Map<number, unknown[]>();
      for (const d of drivers.rows) {
        if (!byYear.has(d.year)) byYear.set(d.year, []);
        byYear.get(d.year)!.push(d);
      }
      const s = seasons.rows;
      return {
        constructor_id: id,
        name: ref.rows[0]?.name ?? names.rows.at(-1)!.team_name,
        nationality: ref.rows[0]?.nationality ?? null,
        latest_colour: names.rows.at(-1)!.colour,
        summary: {
          seasons: s.length,
          races: s.reduce((a, x) => a + x.races, 0),
          wins: s.reduce((a, x) => a + x.wins, 0),
          podiums: s.reduce((a, x) => a + x.podiums, 0),
          championships: s.filter((x) => x.championship_position === 1 && !x.in_progress).length,
        },
        seasons: s.map((x) => ({ ...x, drivers: byYear.get(x.year) ?? [] })),
      };
    },
  );

  app.get<{ Params: { key: number } }>(
    '/circuits/:key',
    {
      schema: {
        tags: ['archive'],
        summary: 'A circuit (by F1 circuit key) and every event held there',
        params: { type: 'object', required: ['key'], properties: { key: { type: 'integer', minimum: 0 } } },
      },
    },
    async (req, reply) => {
      const evs = await db.query(
        `SELECT e.year, e.slug, e.name, e.round, e.location, e.country, e.circuit_short_name, e.start_utc,
           (SELECT json_build_object('abbreviation', r.abbreviation, 'driver_id', coalesce(nullif(r.driver_id, ''), sd.driver_id), 'team_name', r.team_name)
              FROM results r JOIN sessions s ON s.id = r.session_id
              LEFT JOIN session_drivers sd ON sd.session_id = r.session_id AND sd.driver_number = r.driver_number
              WHERE s.event_id = e.id AND s.kind = 'race' AND r.position = 1 LIMIT 1) AS winner
         FROM events e WHERE e.circuit_key = $1 ORDER BY e.year DESC, e.round DESC`,
        [req.params.key],
      );
      if (!evs.rowCount) throw notFound(`Circuit ${req.params.key}`);
      reply.header('cache-control', ARCHIVE_CACHE);
      const first = evs.rows[0];
      return { circuit_key: req.params.key, name: first.circuit_short_name, location: first.location, country: first.country, events: evs.rows };
    },
  );
};

function despike(pts: [number, number][]): [number, number][] {
  let p = pts;
  for (let pass = 0; pass < 2 && p.length > 8; pass++) {
    p = p.filter((c, i) => {
      const a = p[(i - 1 + p.length) % p.length]!;
      const b = p[(i + 1) % p.length]!;
      const ux = c[0] - a[0];
      const uy = c[1] - a[1];
      const vx = b[0] - c[0];
      const vy = b[1] - c[1];
      const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
      return cos > -0.6;
    });
  }
  return p;
}
