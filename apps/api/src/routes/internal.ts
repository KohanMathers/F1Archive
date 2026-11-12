import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { Cache } from '../lib/cache.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

function authorised(req: FastifyRequest): boolean {
  const token = config.cacheClearToken;
  const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  return !!token && !!given && timingSafeEqual(digest(given), digest(token));
}

export const internalRoutes: FastifyPluginAsync = async (app) => {
  app.post('/cache-clear', { schema: { hide: true } }, async (req, reply) => {
    if (!authorised(req)) return reply.status(404).send({ error: { code: 'not_found', message: `No route ${req.method} ${req.url}` } });
    const caches = Cache.clearAll();
    req.log.info({ caches }, 'archive caches cleared');
    return reply.status(204).send();
  });
};
