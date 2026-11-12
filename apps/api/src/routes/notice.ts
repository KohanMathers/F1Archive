import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export interface SiteNotice {
  message: string;
  expiry: string;
  set_at: string;
}

const MAX_MESSAGE = 1000;
const digest = (s: string) => createHash('sha256').update(s).digest();

function authorised(req: FastifyRequest): boolean {
  const token = config.noticeToken;
  const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  return !!token && !!given && timingSafeEqual(digest(given), digest(token));
}

const unknownRoute = (req: FastifyRequest, reply: FastifyReply) =>
  reply.status(404).send({ error: { code: 'not_found', message: `No route ${req.method} ${req.url}` } });

const badRequest = (reply: FastifyReply, message: string) => reply.status(400).send({ error: { code: 'bad_request', message } });

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export const noticeRoutes: FastifyPluginAsync = async (app) => {
  const current = async (): Promise<SiteNotice | null> => {
    const r = await app.db.query<{ message: string; expires_at: Date; set_at: Date }>(
      `SELECT message, expires_at, set_at FROM site_notice WHERE expires_at > now()`,
    );
    const n = r.rows[0];
    return n ? { message: n.message, expiry: n.expires_at.toISOString(), set_at: n.set_at.toISOString() } : null;
  };

  app.get('/api/notice', { schema: { hide: true } }, async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    const n = await current();
    return n ?? reply.status(204).send();
  });

  app.post('/api/admin/notice', { schema: { hide: true } }, async (req, reply) => {
    if (!authorised(req)) return unknownRoute(req, reply);
    const body = (req.body ?? {}) as { message?: unknown; expiry?: unknown };
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return badRequest(reply, '"message" must be a non-empty string.');
    if (message.length > MAX_MESSAGE) return badRequest(reply, `"message" must be at most ${MAX_MESSAGE} characters.`);
    const expiry = typeof body.expiry === 'string' ? body.expiry.trim() : '';
    if (!ISO_WITH_ZONE.test(expiry) || Number.isNaN(Date.parse(expiry))) {
      return badRequest(reply, '"expiry" must be an ISO 8601 date and time with a time zone, e.g. 2026-11-13T18:00:00Z.');
    }
    if (Date.parse(expiry) <= Date.now()) return badRequest(reply, '"expiry" is in the past.');
    await app.db.query(
      `INSERT INTO site_notice (id, message, expires_at, set_at) VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET message = EXCLUDED.message, expires_at = EXCLUDED.expires_at, set_at = EXCLUDED.set_at`,
      [message, expiry],
    );
    req.log.info({ expiry }, 'site notice set');
    return current();
  });

  app.post('/api/admin/notice/clear', { schema: { hide: true } }, async (req, reply) => {
    if (!authorised(req)) return unknownRoute(req, reply);
    const r = await app.db.query(`DELETE FROM site_notice`);
    req.log.info({ removed: r.rowCount }, 'site notice cleared');
    return { cleared: (r.rowCount ?? 0) > 0 };
  });
};
