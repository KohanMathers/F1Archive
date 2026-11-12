import { randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { CATEGORIES, CATEGORY_KEYS, estimateExport } from '@f1archive/db';
import { TELEMETRY_CHANNELS, type ExportJob, type ExportRequest } from '@f1archive/shared';
import { config } from '../config.js';
import { ApiHttpError, badRequest, notFound } from '../lib/errors.js';

const requestSchema = {
  type: 'object',
  required: ['format', 'categories'],
  additionalProperties: false,
  properties: {
    format: { type: 'string', enum: ['csv', 'jsonl', 'json', 'sqlite', 'parquet'] },
    categories: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', enum: CATEGORY_KEYS } },
    sessions: { type: 'array', maxItems: 5000, items: { type: 'string', pattern: '^[0-9]{4}-[a-z0-9-]+$', maxLength: 120 }, default: [] },
    selection: {
      type: 'object',
      additionalProperties: false,
      properties: {
        years: { type: 'array', maxItems: 100, items: { type: 'integer', minimum: 1950, maximum: 2200 } },
        events: { type: 'array', maxItems: 2000, items: { type: 'string', pattern: '^[0-9]{4}-[a-z0-9-]+$', maxLength: 100 } },
        session_kinds: { type: 'array', maxItems: 10, items: { type: 'string', enum: ['practice', 'qualifying', 'sprint-qualifying', 'sprint', 'race', 'testing', 'other'] } },
      },
    },
    drivers: { type: 'array', maxItems: 100, items: { type: 'string', pattern: '^[A-Za-z0-9]{1,5}$' } },
    time_from_ns: { type: ['integer', 'null'] },
    time_to_ns: { type: ['integer', 'null'] },
    telemetry_channels: { type: 'array', maxItems: 9, items: { type: 'string', enum: TELEMETRY_CHANNELS } },
  },
} as const;

export const exportRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  async function normalise(req: ExportRequest): Promise<ExportRequest> {
    const keys = new Set(req.sessions ?? []);
    const sel = req.selection;
    if (sel && ((sel.years?.length ?? 0) > 0 || (sel.events?.length ?? 0) > 0)) {
      const r = await db.query<{ key: string }>(
        `SELECT e.year || '-' || e.slug || '-' || s.slug AS key FROM sessions s JOIN events e ON e.id = s.event_id
         WHERE s.status = 'archived'
           AND (e.year = ANY($1::int[]) OR (e.year || '-' || e.slug) = ANY($2::text[]))
           AND (cardinality($3::text[]) = 0 OR s.kind = ANY($3::text[]))
         ORDER BY e.year, e.round, s.scheduled_start_utc`,
        [sel.years ?? [], sel.events ?? [], sel.session_kinds ?? []],
      );
      for (const x of r.rows) keys.add(x.key);
    }
    if (!keys.size) throw badRequest('Select at least one session (sessions or selection).');
    if (req.time_from_ns != null && req.time_to_ns != null && req.time_to_ns < req.time_from_ns) throw badRequest('time_to_ns must be >= time_from_ns');
    return { ...req, sessions: [...keys] };
  }

  function toJob(r: Record<string, any>): ExportJob {
    return {
      id: r.id,
      status: r.status,
      request: r.request,
      estimate: r.estimate,
      progress: { rows_written: Number(r.rows_written), rows_total: r.rows_total != null ? Number(r.rows_total) : null, stage: r.stage },
      file: r.status === 'done' && r.file_name ? { name: r.file_name, bytes: Number(r.file_bytes), url: `/api/v1/exports/${r.id}/download` } : null,
      error: r.error,
      created_utc: new Date(r.created_at).toISOString(),
      finished_utc: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      expires_utc: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    };
  }

  app.get('/exports/schema', { schema: { tags: ['exports'], summary: 'Every exportable category with its columns, types and units' } }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    return Object.values(CATEGORIES).map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      columns: c.columns.map((col) => ({ name: col.name, type: col.type, unit: col.unit ?? null, description: col.description, derived: col.derived ?? false })),
    }));
  });

  app.post<{ Body: ExportRequest }>(
    '/exports/estimate',
    { schema: { tags: ['exports'], summary: 'Estimate rows and size of an export without starting it', body: requestSchema } },
    async (req) => {
      const r = await normalise(req.body);
      return { request: r, estimate: await estimateExport(db, r) };
    },
  );

  app.post<{ Body: ExportRequest }>(
    '/exports',
    {
      schema: {
        tags: ['exports'],
        summary: 'Start an export job',
        description:
          'Exports run in the background. Poll GET /exports/{id} for progress and download the zip when done. Requests over the limits are refused with an explanation and a suggested split — they are never silently truncated.',
        body: requestSchema,
      },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const r = await normalise(req.body);
      const estimate = await estimateExport(db, r);
      if (!estimate.within_limits) throw new ApiHttpError(422, 'export_too_large', estimate.limit_reason ?? 'Export exceeds limits', { estimate });
      const active = await db.query(`SELECT count(*)::int AS n FROM export_jobs WHERE requester_ip = $1 AND status IN ('queued', 'running')`, [req.ip]);
      if (active.rows[0].n >= config.maxActiveExportsPerClient)
        throw new ApiHttpError(429, 'too_many_exports', `You already have ${active.rows[0].n} exports in progress. Wait for one to finish.`);
      const id = randomUUID();
      const row = (
        await db.query(
          `INSERT INTO export_jobs (id, status, request, estimate, rows_total, requester_ip) VALUES ($1, 'queued', $2, $3, $4, $5) RETURNING *`,
          [id, JSON.stringify(r), JSON.stringify(estimate), estimate.total_rows, req.ip],
        )
      ).rows[0];
      reply.status(202);
      return toJob(row);
    },
  );

  const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } as const;

  app.get<{ Params: { id: string } }>('/exports/:id', { schema: { tags: ['exports'], summary: 'Export job status', params: idParams } }, async (req, reply) => {
    const r = await db.query(`SELECT * FROM export_jobs WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) throw notFound('Export');
    reply.header('cache-control', 'no-store');
    return toJob(r.rows[0]);
  });

  app.delete<{ Params: { id: string } }>('/exports/:id', { schema: { tags: ['exports'], summary: 'Cancel a queued export', params: idParams } }, async (req) => {
    const r = await db.query(`UPDATE export_jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'queued' RETURNING *`, [req.params.id]);
    if (!r.rowCount) throw badRequest('Only queued exports can be cancelled.');
    return toJob(r.rows[0]);
  });

  app.get<{ Params: { id: string } }>(
    '/exports/:id/download',
    { schema: { tags: ['exports'], summary: 'Download a finished export (zip)', params: idParams }, compress: false },
    async (req, reply) => {
      const r = await db.query(`SELECT status, file_name FROM export_jobs WHERE id = $1`, [req.params.id]);
      const job = r.rows[0];
      if (!job) throw notFound('Export');
      if (job.status === 'expired') throw new ApiHttpError(410, 'expired', 'This export has expired. Start it again from the dataset builder.');
      if (job.status !== 'done' || !job.file_name) throw badRequest('Export is not ready.');
      const path = join(config.exportDir, job.file_name);
      let size: number;
      try {
        size = statSync(path).size;
      } catch {
        throw new ApiHttpError(410, 'expired', 'The export file is no longer available.');
      }
      reply.header('content-type', 'application/zip');
      reply.header('content-length', size);
      reply.header('content-disposition', `attachment; filename="${job.file_name}"`);
      return reply.send(createReadStream(path));
    },
  );
};
