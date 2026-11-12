import type { FastifyPluginAsync } from 'fastify';
import { CATEGORIES, CATEGORY_KEYS, buildQuery, columnsFor, resolveSessionKeys } from '@f1archive/db';
import type { ExportCategory, ExportRequest, TelemetryChannel } from '@f1archive/shared';
import { badRequest } from '../lib/errors.js';
import { ARCHIVE_CACHE } from '../lib/schemas.js';

interface Q {
  sessions: string;
  drivers?: string;
  limit?: number;
  offset?: number;
  from_ns?: number;
  to_ns?: number;
  channels?: string;
}

export const dataRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  app.get<{ Params: { category: ExportCategory }; Querystring: Q }>(
    '/data/:category',
    {
      schema: {
        tags: ['data'],
        summary: 'Paginated rows of one data category for selected sessions',
        description: 'Columns are identical to research exports (see /exports/schema). Telemetry is limited to one session and 5,000 rows per page.',
        params: { type: 'object', required: ['category'], properties: { category: { type: 'string', enum: CATEGORY_KEYS } } },
        querystring: {
          type: 'object',
          required: ['sessions'],
          properties: {
            sessions: { type: 'string', maxLength: 4000, description: 'Comma-separated session keys' },
            drivers: { type: 'string', maxLength: 300, description: 'Comma-separated car numbers or abbreviations' },
            limit: { type: 'integer', minimum: 1, maximum: 5000, default: 100 },
            offset: { type: 'integer', minimum: 0, maximum: 50_000_000, default: 0 },
            from_ns: { type: 'integer' },
            to_ns: { type: 'integer' },
            channels: { type: 'string', maxLength: 128 },
          },
        },
      },
    },
    async (req, reply) => {
      const cat = CATEGORIES[req.params.category];
      const keys = req.query.sessions.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
      const { ids, unknown } = await resolveSessionKeys(db, keys);
      if (!ids.length) throw badRequest(`No known sessions in "${req.query.sessions}"`, { unknown });
      if (cat.key === 'telemetry' && ids.length > 1) throw badRequest('Telemetry can be browsed one session at a time. Use a research export for more.');
      const request: ExportRequest = {
        format: 'csv',
        categories: [cat.key],
        sessions: keys,
        drivers: req.query.drivers?.split(',').map((d) => d.trim()).filter(Boolean),
        time_from_ns: req.query.from_ns ?? null,
        time_to_ns: req.query.to_ns ?? null,
        telemetry_channels: req.query.channels?.split(',').filter(Boolean) as TelemetryChannel[] | undefined,
      };
      const q = buildQuery(cat, request, ids);
      const limit = req.query.limit ?? 100;
      const offset = req.query.offset ?? 0;
      const rows = await db.query({ text: `${q.text} LIMIT ${limit + 1} OFFSET ${offset}`, values: q.values });
      const total =
        cat.key === 'telemetry' ? null : Number((await db.query<{ n: number }>(`SELECT count(*)::bigint AS n ${q.fromWhere}`, q.values)).rows[0]!.n);
      const more = rows.rows.length > limit;
      reply.header('cache-control', ARCHIVE_CACHE);
      return {
        category: cat.key,
        columns: columnsFor(cat, request).map((c) => ({ name: c.name, type: c.type, unit: c.unit ?? null, description: c.description, derived: c.derived ?? false })),
        data: rows.rows.slice(0, limit).map((r) => {
          for (const k of Object.keys(r)) if (r[k] instanceof Date) r[k] = (r[k] as Date).toISOString();
          return r;
        }),
        page: { limit, offset, total, next_offset: more ? offset + limit : null },
        unknown_sessions: unknown,
      };
    },
  );
};
