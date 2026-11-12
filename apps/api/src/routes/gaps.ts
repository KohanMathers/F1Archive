import type { FastifyPluginAsync } from 'fastify';
import { documentedGaps, explainGap, FEEDS, isFeedKey, type FeedKey, type FeedState, DERIVED_DATA_NOTES } from '@f1archive/shared';
import { resolveSession } from '../lib/archive.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ARCHIVE_CACHE, sessionParams, type SessionParams, slug, year } from '../lib/schemas.js';

export const gapRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/gaps', { schema: { tags: ['gaps'], summary: 'All documented gaps in the archive and the feed catalogue' } }, async (_req, reply) => {
    reply.header('cache-control', ARCHIVE_CACHE);
    return { documented: documentedGaps(), feeds: Object.values(FEEDS), derived_notes: DERIVED_DATA_NOTES };
  });

  app.get<{ Querystring: { year: number; event: string; session?: string; feed: string; driver?: string } }>(
    '/gaps/explain',
    {
      schema: {
        tags: ['gaps'],
        summary: 'Explain why a feed is missing for an event, session or driver',
        querystring: {
          type: 'object',
          required: ['year', 'event', 'feed'],
          properties: {
            year,
            event: slug,
            session: slug,
            feed: { type: 'string', maxLength: 40 },
            driver: { type: 'string', pattern: '^[0-9]{1,5}$' },
          },
        },
      },
    },
    async (req, reply) => {
      const { year: y, event, session, driver } = req.query;
      if (!isFeedKey(req.query.feed)) throw badRequest(`Unknown feed "${req.query.feed}"`);
      const feed: FeedKey = req.query.feed;
      const ev = (await db.query(`SELECT id, round, source_name, name FROM events WHERE year = $1 AND slug = $2`, [y, event])).rows[0];
      if (!ev) throw notFound(`Event ${y}/${event}`);

      let state: FeedState = 'missing';
      let rows: number | null = null;
      let detail: string | null = null;
      let sessionName: string | undefined;
      let sessionLabel: string | null = null;
      if (FEEDS[feed].scope === 'event') {
        const fa = (await db.query(`SELECT state, rows, detail FROM feed_availability WHERE scope = 'event' AND scope_id = $1 AND feed = $2 AND driver = ''`, [ev.id, feed])).rows[0];
        if (fa) ({ state, rows, detail } = fa);
      } else {
        if (!session) throw badRequest('session is required for session and driver feeds');
        const ref = await resolveSession(db, y, event, session);
        sessionName = ref.source_name;
        sessionLabel = ref.source_name;
        if (ref.status !== 'archived') state = ref.status === 'upcoming' ? 'upcoming' : 'missing';
        else {
          const fa =
            (driver &&
              (
                await db.query(`SELECT state, rows, detail FROM feed_availability WHERE scope = 'session' AND scope_id = $1 AND feed = $2 AND driver = $3`, [
                  ref.id,
                  feed,
                  driver,
                ])
              ).rows[0]) ||
            (await db.query(`SELECT state, rows, detail FROM feed_availability WHERE scope = 'session' AND scope_id = $1 AND feed = $2 AND driver = ''`, [ref.id, feed])).rows[0];
          if (fa) ({ state, rows, detail } = fa);
        }
      }
      const explanation = explainGap({
        feed,
        state,
        year: y,
        round: ev.round,
        event: ev.source_name,
        session: sessionName,
        driver,
        missingHalf: detail === 'car' || detail === 'position' ? detail : undefined,
      });
      reply.header('cache-control', ARCHIVE_CACHE);
      return {
        context: { year: y, event: ev.name, event_slug: event, session: sessionLabel, session_slug: session ?? null, driver: driver ?? null },
        feed: { key: feed, label: FEEDS[feed].label, description: FEEDS[feed].description },
        state,
        rows,
        explanation,
      };
    },
  );

  app.get<{ Params: SessionParams }>(
    '/sessions/:year/:event/:session/availability',
    { schema: { tags: ['gaps'], summary: 'Availability of every feed for a session, including per driver', params: sessionParams } },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', ARCHIVE_CACHE);
      const r = await db.query(
        `SELECT feed, driver, state, rows, detail FROM feed_availability WHERE scope = 'session' AND scope_id = $1 ORDER BY feed, driver`,
        [ref.id],
      );
      return { session: ref.key, status: ref.status, feeds: r.rows };
    },
  );
};
