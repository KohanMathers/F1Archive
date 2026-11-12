import { TRADEMARK_NOTICE } from '@f1archive/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { createPool, type Pool } from '@f1archive/db';
import { config } from './config.js';
import { ApiHttpError } from './lib/errors.js';
import { archiveRoutes } from './routes/archive.js';
import { sessionRoutes } from './routes/session.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { gapRoutes } from './routes/gaps.js';
import { exportRoutes } from './routes/exports.js';
import { dataRoutes } from './routes/data.js';
import { mediaRoutes } from './routes/media.js';
import { internalRoutes } from './routes/internal.js';
import { noticeRoutes } from './routes/notice.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
  }
}

export async function buildServer(opts: { db?: Pool; logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
    ajv: { customOptions: { coerceTypes: 'array', removeAdditional: false, allErrors: false } },
  });
  app.decorate('db', opts.db ?? createPool({ max: 20, statementTimeoutMs: config.statementTimeoutMs, applicationName: 'f1archive-api' }));

  await app.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip'], brotliOptions: { params: { 1: 4 } } as never });
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/api/health',
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'F1Archive API',
        version: 'v1',
        description: [
          'Public API of F1Archive, an independent and unofficial archive of Formula 1 data. ' + TRADEMARK_NOTICE,
          '',
          '**Conventions.** Durations and session times are integer nanoseconds in fields ending `_ns`. A *session time* is time since the start of the session\'s data stream. Wall-clock times are ISO 8601 UTC in fields ending `_utc`. Missing values are `null` — never `0`.',
          '',
          '**Identifiers.** Seasons are years; events and sessions are slugs (`/sessions/2021/abu-dhabi/race`). Session keys (`2021-abu-dhabi-race`) are stable across database rebuilds.',
          '',
          '**Bulk data.** Large datasets are produced asynchronously by export jobs (`POST /api/v1/exports`), not by paging through endpoints.',
          '',
          '**Rate limits.** Requests are limited per client IP; responses carry `x-ratelimit-*` headers.',
        ].join('\n'),
      },
      servers: [{ url: config.publicBaseUrl }],
      tags: [
        { name: 'archive', description: 'Seasons, events, sessions, drivers, search' },
        { name: 'session', description: 'Per-session data: results, laps, weather, race control, radio, timeline' },
        { name: 'telemetry', description: 'Car and position telemetry, by time window' },
        { name: 'gaps', description: 'Data availability and explanations for missing data' },
        { name: 'exports', description: 'Asynchronous research exports' },
        { name: 'data', description: 'Paginated tabular access (Data Explorer)' },
        { name: 'media', description: 'Team radio recordings' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs', uiConfig: { docExpansion: 'list', deepLinking: true } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiHttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { validation?: unknown; statusCode?: number; message: string; code?: string };
    if (e.validation) return reply.status(400).send({ error: { code: 'bad_request', message: e.message } });
    if (e.statusCode === 429) return reply.status(429).send({ error: { code: 'rate_limited', message: e.message } });
    if (e.code === '57014') {
      return reply.status(503).send({ error: { code: 'query_timeout', message: 'The query took too long. Narrow the request (fewer sessions, a shorter time window).' } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Internal error' } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: `No route ${req.method} ${req.url}` } }));

  app.get('/api/health', { schema: { hide: true } }, async () => {
    await app.db.query('SELECT 1');
    return { ok: true, version: config.version };
  });

  await app.register(archiveRoutes, { prefix: '/api/v1' });
  await app.register(sessionRoutes, { prefix: '/api/v1' });
  await app.register(telemetryRoutes, { prefix: '/api/v1' });
  await app.register(gapRoutes, { prefix: '/api/v1' });
  await app.register(exportRoutes, { prefix: '/api/v1' });
  await app.register(dataRoutes, { prefix: '/api/v1' });
  await app.register(mediaRoutes, { prefix: '/media' });
  await app.register(internalRoutes, { prefix: '/api/internal' });
  await app.register(noticeRoutes);

  app.addHook('onClose', async () => {
    if (!opts.db) await app.db.end();
  });
  return app;
}
