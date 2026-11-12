import type { FastifyPluginAsync } from 'fastify';
import { TELEMETRY_CHANNELS, type TelemetryChannel, type TelemetrySeries, type TelemetryWindow } from '@f1archive/shared';
import { config } from '../config.js';
import { resolveSession, type SessionRef } from '../lib/archive.js';
import { badRequest, notFound } from '../lib/errors.js';
import { sessionParams, TELEMETRY_CACHE, type SessionParams, slug, year } from '../lib/schemas.js';

const CHANNEL_SQL: Record<TelemetryChannel, string> = {
  speed: 'speed',
  rpm: 'rpm',
  gear: 'gear',
  throttle: 'throttle',
  brake: 'brake',
  drs: 'drs',
  x: 'x',
  y: 'y',
  z: 'z',
};

interface WindowQuery {
  drivers: string;
  from_ns?: number;
  to_ns?: number;
  channels?: string;
}

function parseChannels(s: string | undefined): TelemetryChannel[] {
  if (!s) return TELEMETRY_CHANNELS;
  const out = s.split(',').map((c) => c.trim()) as TelemetryChannel[];
  for (const c of out) if (!TELEMETRY_CHANNELS.includes(c)) throw badRequest(`Unknown channel "${c}". Valid: ${TELEMETRY_CHANNELS.join(', ')}`);
  return out;
}

function parseDrivers(s: string): number[] {
  const out = [...new Set(s.split(',').map((d) => d.trim()).filter(Boolean))];
  if (!out.length) throw badRequest('drivers is required (car numbers, comma separated)');
  if (out.length > config.telemetry.maxDrivers) throw badRequest(`At most ${config.telemetry.maxDrivers} drivers per request`);
  return out.map((d) => {
    if (!/^\d{1,5}$/.test(d)) throw badRequest(`Invalid driver number "${d}"`);
    return Number(d);
  });
}

async function sessionRange(app: { db: import('@f1archive/db').Pool }, ref: SessionRef) {
  const r = await app.db.query<{ a: number | null; b: number | null }>(`SELECT time_from_ns AS a, time_to_ns AS b FROM sessions WHERE id = $1`, [ref.id]);
  return r.rows[0] ?? { a: null, b: null };
}

export const telemetryRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const windowSchema = {
    type: 'object',
    required: ['drivers'],
    properties: {
      drivers: { type: 'string', description: 'Comma-separated car numbers (max 6)', maxLength: 64 },
      from_ns: { type: 'integer', description: 'Window start, session time in ns. Defaults to the start of the data.' },
      to_ns: { type: 'integer', description: `Window end, session time in ns. Window is capped at ${config.telemetry.maxWindowNs / 1e9} s.` },
      channels: { type: 'string', description: `Comma-separated subset of ${TELEMETRY_CHANNELS.join(', ')}`, maxLength: 128 },
    },
  } as const;

  async function window(ref: SessionRef, q: WindowQuery): Promise<TelemetryWindow & { next_from_ns: number | null }> {
    const drivers = parseDrivers(q.drivers);
    const channels = parseChannels(q.channels);
    const range = await sessionRange(app, ref);
    const from = q.from_ns ?? range.a ?? 0;
    let to = q.to_ns ?? from + config.telemetry.maxWindowNs;
    if (to < from) throw badRequest('to_ns must be >= from_ns');
    if (to - from > config.telemetry.maxWindowNs) to = from + config.telemetry.maxWindowNs;
    const cols = channels.map((c) => CHANNEL_SQL[c]);
    const limit = config.telemetry.maxSamples;
    const r = await db.query({
      text: `SELECT driver_number, ts_ns, ${cols.join(', ')} FROM telemetry
             WHERE year = $1 AND session_id = $2 AND driver_number = ANY($3::int[]) AND ts_ns BETWEEN $4 AND $5
             ORDER BY driver_number, ts_ns LIMIT $6`,
      values: [ref.year, ref.id, drivers, from, to, limit + 1],
      rowMode: 'array',
    });
    const truncated = r.rows.length > limit;
    const rows = truncated ? r.rows.slice(0, limit) : r.rows;
    const out: Record<string, TelemetrySeries> = {};
    for (const d of drivers) {
      const s: TelemetrySeries = { ts_ns: [] };
      for (const c of channels) s[c] = [];
      out[String(d)] = s;
    }
    let lastTs = from;
    for (const row of rows as unknown[][]) {
      const s = out[String(row[0])]!;
      s.ts_ns.push(row[1] as number);
      for (let i = 0; i < channels.length; i++) (s[channels[i]!] as (number | null)[]).push(row[i + 2] as number | null);
      lastTs = Math.max(lastTs, row[1] as number);
    }
    let next: number | null = null;
    if (truncated) next = lastTs;
    else if (range.b !== null && to < range.b) next = to + 1;
    return { session: ref.key, from_ns: from, to_ns: to, channels, drivers: out, truncated, next_from_ns: next };
  }

  app.get<{ Params: SessionParams; Querystring: WindowQuery }>(
    '/sessions/:year/:event/:session/telemetry',
    {
      schema: {
        tags: ['telemetry'],
        summary: 'Telemetry for up to 6 drivers in a time window (columnar)',
        description:
          'Returns original-resolution samples. Car data and position data share one timeline, so a sample may have nulls for one half. Page through a session with `next_from_ns`.',
        params: sessionParams,
        querystring: windowSchema,
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      reply.header('cache-control', TELEMETRY_CACHE);
      return window(ref, req.query);
    },
  );

  app.get<{ Params: SessionParams & { driver: string }; Querystring: Omit<WindowQuery, 'drivers'> }>(
    '/telemetry/:year/:event/:session/:driver',
    {
      schema: {
        tags: ['telemetry'],
        summary: 'Telemetry for one driver (number or abbreviation), paged by time window',
        params: {
          type: 'object',
          required: ['year', 'event', 'session', 'driver'],
          properties: { year, event: slug, session: slug, driver: { type: 'string', pattern: '^[A-Za-z0-9]{1,5}$' } },
        },
        querystring: {
          type: 'object',
          properties: { from_ns: windowSchema.properties.from_ns, to_ns: windowSchema.properties.to_ns, channels: windowSchema.properties.channels },
        },
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      let num = req.params.driver;
      if (!/^\d+$/.test(num)) {
        const r = await db.query<{ driver_number: string }>(`SELECT driver_number FROM session_drivers WHERE session_id = $1 AND upper(abbreviation) = upper($2)`, [
          ref.id,
          num,
        ]);
        if (!r.rowCount) throw notFound(`Driver ${num} in this session`);
        num = r.rows[0]!.driver_number;
      }
      reply.header('cache-control', TELEMETRY_CACHE);
      return window(ref, { ...req.query, drivers: num });
    },
  );

  app.get<{ Params: SessionParams; Querystring: { from_ns: number; to_ns: number } }>(
    '/sessions/:year/:event/:session/positions',
    {
      schema: {
        tags: ['telemetry'],
        summary: 'Positions (x, y) of every car in a time window, for the circuit map',
        description: `Window capped at ${config.telemetry.positionsMaxWindowNs / 1e9} s. Only samples that carry position data are returned.`,
        params: sessionParams,
        querystring: {
          type: 'object',
          required: ['from_ns', 'to_ns'],
          properties: { from_ns: { type: 'integer' }, to_ns: { type: 'integer' } },
        },
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      const { from_ns } = req.query;
      let { to_ns } = req.query;
      if (to_ns < from_ns) throw badRequest('to_ns must be >= from_ns');
      if (to_ns - from_ns > config.telemetry.positionsMaxWindowNs) to_ns = from_ns + config.telemetry.positionsMaxWindowNs;
      const r = await db.query({
        text: `SELECT driver_number, ts_ns, x, y FROM telemetry
               WHERE year = $1 AND session_id = $2 AND ts_ns BETWEEN $3 AND $4 AND x IS NOT NULL
               ORDER BY driver_number, ts_ns`,
        values: [ref.year, ref.id, from_ns, to_ns],
        rowMode: 'array',
      });
      const out: Record<string, { ts_ns: number[]; x: number[]; y: number[] }> = {};
      for (const row of r.rows as [number, number, number, number][]) {
        const k = String(row[0]);
        const s = (out[k] ??= { ts_ns: [], x: [], y: [] });
        const n = s.x.length;
        if (n && s.x[n - 1] === row[2] && s.y[n - 1] === row[3] && row[1] - s.ts_ns[n - 1]! < 1e9) continue;
        s.ts_ns.push(row[1]);
        s.x.push(row[2]);
        s.y.push(row[3]);
      }
      reply.header('cache-control', TELEMETRY_CACHE);
      return { session: ref.key, from_ns, to_ns, drivers: out };
    },
  );

  app.get<{ Params: SessionParams & { driver: string; lap: number } }>(
    '/sessions/:year/:event/:session/laps/:driver/:lap/telemetry',
    {
      schema: {
        tags: ['telemetry'],
        summary: 'All telemetry samples within one lap, for lap comparisons',
        params: {
          type: 'object',
          required: ['year', 'event', 'session', 'driver', 'lap'],
          properties: { year, event: slug, session: slug, driver: { type: 'string', pattern: '^[0-9]{1,5}$' }, lap: { type: 'integer', minimum: 0 } },
        },
      },
    },
    async (req, reply) => {
      const ref = await resolveSession(db, req.params.year, req.params.event, req.params.session);
      const lap = (
        await db.query(
          `SELECT l.lap_no, l.lap_time_ns, l.s1_ns, l.s2_ns, l.s3_ns, l.start_ns, l.end_ns, l.deleted, l.pit_in_ns, l.pit_out_ns,
                  sd.abbreviation, sd.full_name, sd.team_colour, sd.team_name
           FROM laps l LEFT JOIN session_drivers sd ON sd.session_id = l.session_id AND sd.driver_number = l.driver_number
           WHERE l.session_id = $1 AND l.driver_number = $2 AND l.lap_no = $3 LIMIT 1`,
          [ref.id, req.params.driver, req.params.lap],
        )
      ).rows[0];
      if (!lap) throw notFound(`Lap ${req.params.lap} for driver ${req.params.driver}`);
      const start = lap.start_ns ?? (lap.end_ns != null && lap.lap_time_ns != null ? lap.end_ns - lap.lap_time_ns : null);
      if (start == null || lap.end_ns == null) {
        reply.header('cache-control', TELEMETRY_CACHE);
        return { session: ref.key, driver: req.params.driver, lap, samples: null, reason: 'This lap has no start or end time in the timing data.' };
      }
      const r = await db.query({
        text: `SELECT ts_ns, speed, rpm, gear, throttle, brake, drs, x, y FROM telemetry
               WHERE year = $1 AND session_id = $2 AND driver_number = $3 AND ts_ns BETWEEN $4 AND $5 ORDER BY ts_ns`,
        values: [ref.year, ref.id, Number(req.params.driver), start, lap.end_ns],
        rowMode: 'array',
      });
      const names = ['ts_ns', 'speed', 'rpm', 'gear', 'throttle', 'brake', 'drs', 'x', 'y'] as const;
      const series: Record<string, (number | null)[]> = Object.fromEntries(names.map((n) => [n, []]));
      for (const row of r.rows as (number | null)[][]) names.forEach((n, i) => series[n]!.push(row[i] ?? null));
      reply.header('cache-control', TELEMETRY_CACHE);
      return { session: ref.key, driver: req.params.driver, lap: { ...lap, start_ns: start }, samples: series };
    },
  );
};
