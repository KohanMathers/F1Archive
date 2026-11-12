import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)('API', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.EXPORT_MAX_ROWS = '1000000';
    process.env.CACHE_CLEAR_TOKEN = 'test-token';
    process.env.NOTICE_TOKEN = 'notice-token';
    const { buildServer } = await import('../src/server.js');
    app = await buildServer({ logger: false });
  });
  afterAll(async () => app?.close());

  const get = (url: string) => app.inject({ method: 'GET', url });

  it('serves live stats', async () => {
    const r = await get('/api/v1/stats');
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.seasons).toBeGreaterThan(0);
    expect(s.sessions_archived).toBeLessThanOrEqual(s.sessions);
  });

  it('returns structured 404s and validation errors', async () => {
    const nf = await get('/api/v1/sessions/2021/nowhere/race');
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error.code).toBe('not_found');
    const bad = await get('/api/v1/sessions/2021/abu-dhabi/race/telemetry?drivers=VER;DROP');
    expect(bad.statusCode).toBe(400);
  });

  it('caps telemetry windows and pages through them', async () => {
    const r = await get('/api/v1/sessions/2021/abu-dhabi/race/telemetry?drivers=33&from_ns=0&to_ns=99999999999999&channels=speed');
    expect(r.statusCode).toBe(200);
    const w = r.json();
    expect(w.to_ns - w.from_ns).toBeLessThanOrEqual(900e9);
    expect(w.next_from_ns).not.toBeNull();
    expect(Object.keys(w.drivers['33'])).toEqual(['ts_ns', 'speed']);
    const ts: number[] = w.drivers['33'].ts_ns;
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('explains documented gaps', async () => {
    const r = await get('/api/v1/gaps/explain?year=2018&event=bahrain&session=qualifying&feed=laps');
    expect(r.json().explanation.id).toBe('session-2018-bahrain-early-format');
    const p = await get('/api/v1/gaps/explain?year=2018&event=australian&session=race&feed=telemetry&driver=44');
    expect(p.json().state).toBe('partial');
    expect(p.json().explanation.id).toBe('telemetry-car-only');
  });

  it('refuses oversized exports with a reason and a split instead of truncating', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/exports/estimate',
      payload: { format: 'csv', categories: ['telemetry'], selection: { years: [2021] } },
    });
    const e = r.json().estimate;
    expect(e.within_limits).toBe(false);
    expect(e.limit_reason).toMatch(/limit/);
    expect(e.suggested_split?.length).toBeGreaterThan(1);
    const start = await app.inject({ method: 'POST', url: '/api/v1/exports', payload: { format: 'csv', categories: ['telemetry'], selection: { years: [2021] } } });
    expect(start.statusCode).toBe(422);
  });

  it('keeps track-wide race control messages when filtering by driver', async () => {
    const all = (await get('/api/v1/data/race_control?sessions=2021-abu-dhabi-race&limit=1')).json().page.total;
    const ver = (await get('/api/v1/data/race_control?sessions=2021-abu-dhabi-race&drivers=VER&limit=1')).json().page.total;
    expect(ver).toBeGreaterThan(10);
    expect(ver).toBeLessThan(all);
  });

  it('serves live timing intervals as a sorted running record', async () => {
    const r = (await get('/api/v1/sessions/2021/abu-dhabi/race/intervals')).json();
    const ver = r.drivers['33'];
    expect(ver.ts_ns.length).toBeGreaterThan(100);
    expect([...ver.ts_ns].sort((a: number, b: number) => a - b)).toEqual(ver.ts_ns);
    expect(ver.gap_to_leader.some((g: string | null) => g && /^\+\d/.test(g))).toBe(true);
  });

  it('links team names to constructors and builds team pages', async () => {
    const list = (await get('/api/v1/teams')).json() as { constructor_id: string; names: string[] }[];
    expect(list.find((t) => t.constructor_id === 'red_bull')?.names).toContain('Red Bull Racing');
    const rb = (await get('/api/v1/teams/red_bull')).json();
    const y2022 = rb.seasons.find((s: { year: number }) => s.year === 2022);
    expect(y2022.championship_position).toBe(1);
    expect(y2022.wins).toBe(17);
    const results = (await get('/api/v1/sessions/2021/abu-dhabi/race/results')).json();
    expect(results[0].constructor_id).toBe('red_bull');
    expect((await get('/api/v1/teams/nope')).statusCode).toBe(404);
  });

  it('lists drivers, counting results that lack a Jolpica id through the session link', async () => {
    const r = await get('/api/v1/drivers');
    expect(r.statusCode).toBe(200);
    const rows = r.json() as { driver_id: string; races: number }[];
    expect(rows.every((d) => d.driver_id)).toBe(true);
    const rb = (await get('/api/v1/teams/red_bull')).json();
    const y2018 = rb.seasons.find((s: { year: number }) => s.year === 2018);
    expect(y2018.drivers.length).toBe(2);
  });

  it('keeps stationary cars in the position stream (no gaps over 2 s while on the grid)', async () => {
    const tl = (await get('/api/v1/sessions/2021/abu-dhabi/race/timeline')).json();
    const start = tl.events.find((e: { type: string; label: string }) => e.type === 'session_status' && /started/i.test(e.label)).t_ns;
    const r = (await get(`/api/v1/sessions/2021/abu-dhabi/race/positions?from_ns=${start - 60e9}&to_ns=${start}`)).json();
    const ts: number[] = r.drivers['33'].ts_ns;
    const worst = Math.max(...ts.slice(1).map((t, i) => t - ts[i]!));
    expect(worst).toBeLessThan(2e9);
  });

  it('includes marshal lights and sectors with the track outline', async () => {
    const t = (await get('/api/v1/sessions/2021/abu-dhabi/race/track')).json();
    expect(t.marshal_sectors.length).toBe(20);
    expect(t.marshal_lights.length).toBe(20);
    expect(t.marshal_sectors[0]).toMatchObject({ number: 1 });
    const madrid = (await get('/api/v1/sessions/2026/spanish/race/track')).json();
    expect(madrid.marshal_lights).toEqual([]);
  });

  it('clears caches only with the token, and otherwise looks like an unknown route', async () => {
    const post = (auth?: string) => app.inject({ method: 'POST', url: '/api/internal/cache-clear', headers: auth ? { authorization: auth } : {} });
    const unknown = await app.inject({ method: 'POST', url: '/api/internal/nothing-here' });
    for (const r of [await post(), await post('Bearer wrong'), await post('test-token')]) {
      expect(r.statusCode).toBe(404);
      expect(r.json().error.code).toBe(unknown.json().error.code);
    }
    expect((await post('Bearer test-token')).statusCode).toBe(204);
    const docs = (await get('/api/docs/json')).json();
    expect(Object.keys(docs.paths).some((p) => p.includes('internal'))).toBe(false);
  });

  it('sets, shows and clears the site notice, only with its own token', async () => {
    const set = (payload: unknown, auth = 'Bearer notice-token') =>
      app.inject({ method: 'POST', url: '/api/admin/notice', headers: { authorization: auth }, payload: payload as object });
    const later = new Date(Date.now() + 3600e3).toISOString();
    expect((await set({ message: 'x', expiry: later }, 'Bearer test-token')).statusCode).toBe(404);
    expect((await set({ message: 'x', expiry: later }, '')).statusCode).toBe(404);
    expect((await set({ message: '', expiry: later })).statusCode).toBe(400);
    expect((await set({ message: 'x', expiry: '2026-11-11' })).statusCode).toBe(400);
    expect((await set({ message: 'x', expiry: '2020-01-01T00:00:00Z' })).statusCode).toBe(400);
    const ok = await set({ message: '  Back on Friday.  ', expiry: later });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ message: 'Back on Friday.', expiry: later });
    const shown = await get('/api/notice');
    expect(shown.statusCode).toBe(200);
    expect(shown.json().message).toBe('Back on Friday.');
    const clear = (auth: string) => app.inject({ method: 'POST', url: '/api/admin/notice/clear', headers: { authorization: auth } });
    expect((await clear('Bearer wrong')).statusCode).toBe(404);
    expect((await clear('Bearer notice-token')).json()).toEqual({ cleared: true });
    expect((await get('/api/notice')).statusCode).toBe(204);
    const docs = (await get('/api/docs/json')).json();
    expect(Object.keys(docs.paths).some((p) => p.includes('notice'))).toBe(false);
  });

  it('accepts parquet exports', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/exports/estimate', payload: { format: 'parquet', categories: ['laps'], sessions: ['2021-abu-dhabi-race'] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().estimate.within_limits).toBe(true);
  });

  it('serves radio by id only, with Range support', async () => {
    const list = (await get('/api/v1/sessions/2021/abu-dhabi/race/radio')).json() as { id: number; audio_url: string | null }[];
    const clip = list.find((c) => c.audio_url);
    if (!clip) return;
    const r = await app.inject({ method: 'GET', url: clip.audio_url!, headers: { range: 'bytes=0-99' } });
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-range']).toMatch(/^bytes 0-99\//);
    expect(r.rawPayload.length).toBe(100);
  });
});
