import { TRADEMARK_NOTICE } from '@f1archive/shared';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import archiver from 'archiver';
import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { resolveSession } from '../lib/archive.js';
import { ApiHttpError, notFound } from '../lib/errors.js';
import { slug, year } from '../lib/schemas.js';

function clipFile(archivePath: string | null, clipPath: string | null): string | null {
  if (!archivePath || !clipPath) return null;
  const rel = normalize(archivePath + clipPath);
  if (rel.startsWith('..') || rel.startsWith(sep) || rel.includes(`..${sep}`) || !rel.toLowerCase().endsWith('.mp3')) return null;
  return join(config.radioDir, rel);
}

function zipName(y: number, ev: string, s: string) {
  return `f1archive-radio-${y}-${ev}-${s}.zip`;
}

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get<{ Params: { year: number; event: string; session: string; id: number } }>(
    '/radio/:year/:event/:session/:id.mp3',
    {
      schema: {
        tags: ['media'],
        summary: 'Team radio recording (audio/mpeg, supports Range requests)',
        params: {
          type: 'object',
          required: ['year', 'event', 'session', 'id'],
          properties: { year, event: slug, session: slug, id: { type: 'integer', minimum: 1 } },
        },
        querystring: { type: 'object', properties: { download: { type: 'string' } } },
      },
      compress: false,
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      const r = (await db.query(`SELECT path, driver_number, ts_ns FROM team_radio WHERE id = $1 AND session_id = $2`, [req.params.id, ref.id])).rows[0];
      if (!r) throw notFound('Radio clip');
      const file = clipFile(ref.archive_path, r.path);
      let size = 0;
      try {
        size = file ? statSync(file).size : 0;
      } catch {
        size = 0;
      }
      if (!file || !size) throw new ApiHttpError(404, 'recording_unavailable', 'This deployment does not hold this recording.');

      const download = (req.query as { download?: string }).download !== undefined;
      if (download && !config.radioDownloads) throw new ApiHttpError(403, 'downloads_disabled', 'Downloading recordings is disabled on this deployment.');
      const name = `${ref.key}-${r.driver_number ?? 'radio'}-${req.params.id}.mp3`;
      reply.header('accept-ranges', 'bytes');
      reply.header('cache-control', 'public, max-age=604800, immutable');
      reply.header('content-type', 'audio/mpeg');
      reply.header('content-disposition', `${download ? 'attachment' : 'inline'}; filename="${name}"`);

      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range && (range[1] || range[2])) {
        let start = range[1] ? Number(range[1]) : size - Number(range[2]);
        let end = range[1] && range[2] ? Number(range[2]) : size - 1;
        start = Math.max(0, start);
        end = Math.min(size - 1, end);
        if (start > end) {
          reply.header('content-range', `bytes */${size}`);
          return reply.status(416).send();
        }
        reply.status(206);
        reply.header('content-range', `bytes ${start}-${end}/${size}`);
        reply.header('content-length', end - start + 1);
        return reply.send(createReadStream(file, { start, end }));
      }
      reply.header('content-length', size);
      return reply.send(createReadStream(file));
    },
  );

  app.get<{ Params: { year: number; event: string; session: string } }>(
    '/radio/:year/:event/:session.zip',
    {
      schema: {
        tags: ['media'],
        summary: 'Every available team radio recording of a session, as a zip (streamed)',
        params: { type: 'object', required: ['year', 'event', 'session'], properties: { year, event: slug, session: slug } },
      },
      compress: false,
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      if (!config.radioDownloads) throw new ApiHttpError(403, 'downloads_disabled', 'Downloading recordings is disabled on this deployment.');
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      const clips = (
        await db.query(
          `SELECT r.id, r.path, r.ts_ns, r.utc, r.driver_number, sd.abbreviation FROM team_radio r
           LEFT JOIN session_drivers sd ON sd.session_id = r.session_id AND sd.driver_number = r.driver_number
           WHERE r.session_id = $1 AND r.file_available ORDER BY r.ts_ns, r.id`,
          [ref.id],
        )
      ).rows;
      if (!clips.length) throw new ApiHttpError(404, 'recording_unavailable', 'This deployment holds no recordings for this session.');
      const zip = archiver('zip', { store: true });
      const index = ['clip,session_time_s,utc,driver_number,abbreviation,source_path'];
      for (const c of clips) {
        const file = clipFile(ref.archive_path, c.path);
        if (!file) continue;
        const t = c.ts_ns != null ? (c.ts_ns / 1e9).toFixed(3) : '';
        const name = `${String(t).padStart(10, '0')}_${c.abbreviation ?? c.driver_number}_${c.id}.mp3`;
        zip.file(file, { name });
        index.push([name, t, c.utc ? new Date(c.utc).toISOString() : '', c.driver_number ?? '', c.abbreviation ?? '', c.path].join(','));
      }
      zip.append(index.join('\n') + '\n', { name: 'index.csv' });
      zip.append(
        `Team radio recordings for ${ref.key}, from F1Archive (f1archive.org), an independent and unofficial archive.\n` +
        `${TRADEMARK_NOTICE}\n` +
        'Recordings were published by Formula 1 on its live timing archive. File names start with the session time in seconds.\n',
        { name: 'README.txt' },
      );
      void zip.finalize();
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', `attachment; filename="${zipName(ref.year, ref.event_slug, ref.slug)}"`);
      return reply.send(zip);
    },
  );
};
