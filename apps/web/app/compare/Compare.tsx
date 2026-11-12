'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDelta, formatLapTime, interpolateMonotone, lapTrace, type LapRow, type SessionDetail } from '@f1archive/shared';
import { load } from '@/lib/client';
import { teamColour } from '@/lib/time';
import { tokens } from '@/lib/tokens';
import { why } from '@/lib/routes';
import { SessionSelect, type Chosen } from '@/components/SessionSelect';
import { PATTERNS, Traces, type Lane, type Line } from '@/components/replay/Traces';
import { drsOpen, lapSamples, type LapSamples } from '@/components/replay/data';

interface Slot {
  year: number;
  event: string;
  session: string;
  driver: string;
  lap: string;
}
const KEYS = ['a', 'b', 'c', 'd'] as const;
const SLOT = ['#2a71d2', '#d07932', '#0b9655', '#7c25c2'];

const parse = (v: string | null): Slot | null => {
  const m = v && /^(\d{4})\/([a-z0-9-]+)\/([a-z0-9-]+)\/(\d{1,5})\/(\d+|fastest)$/.exec(v);
  return m ? { year: +m[1]!, event: m[2]!, session: m[3]!, driver: m[4]!, lap: m[5]! } : null;
};
const str = (s: Slot) => `${s.year}/${s.event}/${s.session}/${s.driver}/${s.lap}`;
const apiOf = (s: Slot) => `/api/v1/sessions/${s.year}/${s.event}/${s.session}`;

interface Loaded {
  slot: Slot;
  detail: SessionDetail | null;
  laps: LapRow[];
  lap: number | null;
  data: LapSamples | null;
  error?: string;
}

async function fetchSlot(slot: Slot): Promise<Loaded> {
  try {
    const [detail, laps] = await Promise.all([load<SessionDetail>(apiOf(slot)), load<LapRow[]>(`${apiOf(slot)}/laps?driver=${slot.driver}`)]);
    let lap: number | null = null;
    if (slot.lap === 'fastest') {
      lap = laps.filter((l) => l.lap_time_ns != null && !l.deleted && l.start_ns != null && l.pit_in_ns == null && l.pit_out_ns == null).sort((a, b) => a.lap_time_ns! - b.lap_time_ns!)[0]?.lap ?? null;
    } else lap = Number(slot.lap);
    if (lap == null) return { slot, detail, laps, lap, data: null, error: 'No timed lap for this driver.' };
    return { slot, detail, laps, lap, data: await lapSamples(apiOf(slot), slot.driver, lap).catch(() => null) };
  } catch (e) {
    return { slot, detail: null, laps: [], lap: null, data: null, error: (e as Error).message };
  }
}

const LANES: Lane[] = [
  { key: 'speed', label: 'Speed', unit: 'km/h', min: 0, max: 360, h: 120 },
  { key: 'throttle', label: 'Throttle', unit: '%', min: 0, max: 100, h: 60 },
  { key: 'brake', label: 'Brake', unit: '', min: 0, max: 1, h: 26, step: true, fmt: (v) => (v >= 0.5 ? 'on' : 'off') },
  { key: 'gear', label: 'Gear', unit: '', min: 0, max: 8, h: 56, step: true },
  { key: 'rpm', label: 'RPM', unit: 'rpm', min: 0, max: 15000, h: 60, fmt: (v) => `${(v / 1000).toFixed(1)}k` },
  { key: 'drs', label: 'DRS', unit: '', min: 0, max: 1, h: 24, step: true, fmt: (v) => (v >= 0.5 ? 'open' : 'shut') },
];

export function Compare() {
  const sp = useSearchParams();
  const router = useRouter();
  const slots = useMemo(() => KEYS.map((k) => parse(sp.get(k))).filter((s): s is Slot => !!s), [sp]);
  const [loaded, setLoaded] = useState<(Loaded | null)[]>([]);
  const [align, setAlign] = useState<'distance' | 'time'>('distance');
  const [zoom, setZoom] = useState<[number, number] | null>(null);

  useEffect(() => {
    let ok = true;
    setLoaded(slots.map(() => null));
    setZoom(null);
    slots.forEach((s, i) => fetchSlot(s).then((r) => ok && setLoaded((p) => Object.assign([...p], { [i]: r }))));
    return () => void (ok = false);
  }, [slots]);

  const write = (next: Slot[]) => router.replace(`/compare?${next.slice(0, 4).map((s, i) => `${KEYS[i]}=${str(s)}`).join('&')}`, { scroll: false });

  const view = useMemo(() => {
    const ready = loaded.map((l, i) => ({ l, i })).filter((x): x is { l: Loaded; i: number } => !!x.l?.data?.samples);
    const tr = ready.map(({ l, i }) => {
      const s = l.data!.samples!;
      const idx = s.speed.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0);
      return { l, i, idx, t: lapTrace(idx.map((k) => s.ts_ns[k]!), idx.map((k) => s.speed[k]!), l.data!.lap.start_ns) };
    });
    const base = tr[0];
    let dmax = 0;
    const lines: Line[] = tr.map(({ l, i, idx, t }, j) => {
      const s = l.data!.samples!;
      const v: Record<string, (number | null)[]> = {};
      for (const c of ['speed', 'throttle', 'brake', 'gear', 'rpm', 'drs'] as const) v[c] = idx.map((k) => (c === 'drs' ? drsOpen(s.drs[k] ?? null) : (s[c][k] ?? null)));
      v.delta = Array.from(t.distance, (d, k) => {
        if (!base || j === 0) return 0;
        const r = interpolateMonotone(base.t.distance, base.t.elapsed, d);
        if (r == null) return null;
        const q = t.elapsed[k]! - r;
        dmax = Math.max(dmax, Math.abs(q));
        return q;
      });
      return { id: String(i), label: `${'ABCD'[i]} ${l.detail?.drivers.find((x) => x.number === l.slot.driver)?.abbreviation ?? l.slot.driver}`, colour: SLOT[i]!, dash: PATTERNS[i]!.dash, x: align === 'distance' ? t.distance : t.elapsed, v };
    });
    const span = Math.max(0, ...lines.map((x) => (x.x.length ? x.x[x.x.length - 1]! : 0)));
    return { tr, lines, span, bound: Math.max(0.5, Math.ceil(dmax * 2) / 2) };
  }, [loaded, align]);

  const sameTrack = useMemo(() => {
    const k = loaded.map((l) => l?.detail?.circuit_key);
    return k.length > 1 && k.every((x) => x != null && x === k[0]);
  }, [loaded]);
  const seasons = new Set(slots.map((s) => s.year)).size;
  const lanes = align === 'distance' && view.lines.length > 1 ? [{ key: 'delta', label: 'Delta', unit: 's vs A', min: -view.bound, max: view.bound, h: 72, zero: true, fmt: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}` }, ...LANES] : LANES;

  return (
    <>
      <div style={{ borderTop: '1px solid var(--line)' }}>
        {slots.map((s, i) => (
          <SlotRow key={`${i}${str(s)}`} i={i} slot={s} loaded={loaded[i] ?? null} onChange={(n) => write(slots.map((x, k) => (k === i ? n : x)))} onRemove={() => write(slots.filter((_, k) => k !== i))} />
        ))}
        {slots.length < 4 && <AddRow first={!slots.length} prefill={slots.at(-1) ?? null} onAdd={(s) => write([...slots, s])} />}
      </div>

      {view.tr.length > 0 && (
        <>
          <div className="tbl-wrap" style={{ marginTop: 24 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th>Lap</th>
                  <th className="n">Time</th>
                  <th className="n">To A</th>
                  <th className="n">Sector 1</th>
                  <th className="n">Sector 2</th>
                  <th className="n">Sector 3</th>
                  <th className="n">Top speed</th>
                  <th className="n">Slowest</th>
                  <th className="n">Full throttle</th>
                </tr>
              </thead>
              <tbody>
                {view.tr.map(({ l, i, idx }) => {
                  const s = l.data!.samples!;
                  const sp2 = idx.map((k) => s.speed[k]!);
                  const thr = idx.map((k) => s.throttle[k]).filter((v): v is number => v != null);
                  const d = l.detail?.drivers.find((x) => x.number === l.slot.driver);
                  const ref = view.tr[0]!.l.data!.lap.lap_time_ns;
                  return (
                    <tr key={i}>
                      <td>
                        <span className="slot-k" style={{ background: SLOT[i], display: 'inline-block', width: 20 }}>
                          {'ABCD'[i]}
                        </span>
                      </td>
                      <td>
                        <span className="drv" style={{ marginRight: 8 }}>
                          <i style={{ background: teamColour(d?.team_colour) }} />
                          {d?.abbreviation}
                        </span>
                        {l.slot.year} {l.detail?.event_name}, {l.detail?.name}, lap {l.lap}
                      </td>
                      <td className="n">{formatLapTime(l.data!.lap.lap_time_ns)}</td>
                      <td className="n">{i === 0 ? '' : formatDelta((l.data!.lap.lap_time_ns ?? NaN) - (ref ?? NaN))}</td>
                      <td className="n">{formatLapTime(l.data!.lap.s1_ns)}</td>
                      <td className="n">{formatLapTime(l.data!.lap.s2_ns)}</td>
                      <td className="n">{formatLapTime(l.data!.lap.s3_ns)}</td>
                      <td className="n">{Math.max(...sp2)} km/h</td>
                      <td className="n">{Math.min(...sp2)} km/h</td>
                      <td className="n">{thr.length ? Math.round((thr.filter((v) => v >= 98).length / thr.length) * 100) : ''}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {seasons > 1 && (
            <p className="note">
              These laps come from different seasons. The numbers are absolute: car, tyres, rules and sometimes the layout all differ, so the gap is not only the drivers.
            </p>
          )}
          <div className="cmp">
            <section className="pane">
              <div className="pane-h">
                <h3>Traces</h3>
                <div className="seg" role="group" aria-label="Align by">
                  <button aria-pressed={align === 'distance'} onClick={() => (setAlign('distance'), setZoom(null))}>
                    By distance
                  </button>
                  <button aria-pressed={align === 'time'} onClick={() => (setAlign('time'), setZoom(null))}>
                    By time
                  </button>
                </div>
              </div>
              <Traces
                lanes={lanes}
                lines={view.lines}
                range={zoom ?? [0, view.span]}
                bounds={[0, view.span]}
                cursor={null}
                fmtX={(x) => (align === 'distance' ? `${Math.round(x)} m` : `${x.toFixed(1)} s`)}
                xLabel={align === 'distance' ? 'distance' : 'time into lap'}
                onRange={setZoom}
              />
              <p className="t-small t-muted" style={{ padding: '0 12px 10px', margin: 0 }}>
                Distance is derived by integrating speed. Delta is time behind lap A at the same distance; positive is slower. Line patterns: A solid, B dashed, C dotted, D dash-dot.
              </p>
            </section>
            <section className="pane">
              <div className="pane-h">
                <h3>Quickest by section</h3>
              </div>
              <div style={{ padding: 12 }}>
                {view.tr.length > 1 && sameTrack ? (
                  <Sections tr={view.tr} />
                ) : (
                  <p className="t-muted">{view.tr.length < 2 ? 'Add a second lap.' : 'Only shown when every lap is on the same circuit.'}</p>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {loaded.map((l, i) =>
        l && (l.error || !l.data?.samples) ? (
          <p key={i} className="missing" style={{ marginTop: 12 }}>
            <b>Lap {'ABCD'[i]}</b>: {l.error ?? l.data?.reason ?? 'no telemetry for this lap'}.{' '}
            <Link className="why" href={why({ year: l.slot.year, event: l.slot.event, session: l.slot.session, feed: 'telemetry', driver: l.slot.driver })}>
              Why is this missing?
            </Link>
          </p>
        ) : null,
      )}
    </>
  );
}

function SlotRow({ i, slot, loaded, onChange, onRemove }: { i: number; slot: Slot; loaded: Loaded | null; onChange: (s: Slot) => void; onRemove: () => void }) {
  return (
    <div className="slot">
      <span className="slot-k" style={{ background: SLOT[i] }}>
        {'ABCD'[i]}
      </span>
      <div className="stack" style={{ minWidth: 0 }}>
        <SessionSelect
          telemetryOnly
          initial={{ year: slot.year, event: slot.event, session: slot.session }}
          onChange={(c) => {
            if (c && (c.year !== slot.year || c.event.slug !== slot.event || c.session.slug !== slot.session)) onChange({ year: c.year, event: c.event.slug, session: c.session.slug, driver: slot.driver, lap: 'fastest' });
          }}
        />
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="f">
            Driver
            <select value={slot.driver} onChange={(e) => onChange({ ...slot, driver: e.target.value, lap: 'fastest' })}>
              {!loaded?.detail && <option value={slot.driver}>{slot.driver}</option>}
              {loaded?.detail?.drivers.map((d) => (
                <option key={d.number} value={d.number} disabled={d.telemetry !== 'present' && d.telemetry !== 'partial'}>
                  {d.abbreviation}, {d.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            Lap
            <select value={slot.lap} onChange={(e) => onChange({ ...slot, lap: e.target.value })}>
              <option value="fastest">Fastest clean lap{slot.lap === 'fastest' && loaded?.lap ? ` (lap ${loaded.lap})` : ''}</option>
              {loaded?.laps.map((l) => (
                <option key={l.lap} value={String(l.lap)} disabled={l.start_ns == null}>
                  Lap {l.lap}, {formatLapTime(l.lap_time_ns)}
                  {l.pit_in_ns != null || l.pit_out_ns != null ? ', pit' : ''}
                  {l.deleted ? ', deleted' : ''}
                </option>
              ))}
            </select>
          </label>
          <button className="btn quiet sm" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function AddRow({ first, prefill, onAdd }: { first: boolean; prefill: Slot | null; onAdd: (s: Slot) => void }) {
  const [c, setC] = useState<Chosen | null>(null);
  const [d, setD] = useState<SessionDetail | null>(null);
  const [driver, setDriver] = useState('');
  useEffect(() => {
    setD(null);
    if (c)
      load<SessionDetail>(`/api/v1/sessions/${c.year}/${c.event.slug}/${c.session.slug}`).then((x) => {
        setD(x);
        setDriver(x.drivers.find((r) => r.telemetry === 'present')?.number ?? '');
      });
  }, [c]);
  return (
    <div className="slot">
      <span className="slot-k" style={{ color: 'var(--muted)', border: '1px solid var(--line)' }}>
        +
      </span>
      <div className="stack" style={{ minWidth: 0 }}>
        <div className="t-muted">{first ? 'Choose the reference lap (A).' : 'Add a lap.'}</div>
        <SessionSelect telemetryOnly initial={prefill ? { year: prefill.year, event: prefill.event, session: prefill.session } : null} onChange={setC} />
        {d && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="f">
              Driver
              <select value={driver} onChange={(e) => setDriver(e.target.value)}>
                {d.drivers.map((r) => (
                  <option key={r.number} value={r.number} disabled={r.telemetry !== 'present' && r.telemetry !== 'partial'}>
                    {r.abbreviation}, {r.full_name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary" disabled={!driver || !c} onClick={() => c && onAdd({ year: c.year, event: c.event.slug, session: c.session.slug, driver, lap: 'fastest' })}>
              Add their fastest lap
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Sections({ tr }: { tr: { l: Loaded; i: number; idx: number[]; t: ReturnType<typeof lapTrace> }[] }) {
  const el = useRef<HTMLCanvasElement>(null);
  const N = 30;
  const won = useMemo(() => {
    const total = Math.min(...tr.map((x) => x.t.distance[x.t.distance.length - 1] ?? 0));
    const out: number[] = [];
    for (let k = 0; k < N; k++) {
      let best = -1;
      let bt = Infinity;
      tr.forEach((x, j) => {
        const a = interpolateMonotone(x.t.distance, x.t.elapsed, (total * k) / N);
        const b = interpolateMonotone(x.t.distance, x.t.elapsed, (total * (k + 1)) / N);
        if (a != null && b != null && b - a < bt) [bt, best] = [b - a, j];
      });
      out.push(best);
    }
    return { out, total };
  }, [tr]);

  useEffect(() => {
    const c = el.current;
    const a = tr[0];
    if (!c || !a) return;
    const s = a.l.data!.samples!;
    const pts = a.idx
      .map((k, n) => ({ x: s.x[k], y: s.y[k], d: a.t.distance[n]! }))
      .filter((p): p is { x: number; y: number; d: number } => p.x != null && p.y != null && !(p.x === 0 && p.y === 0));
    const w = c.clientWidth;
    const h = c.clientHeight;
    const r = window.devicePixelRatio || 1;
    c.width = w * r;
    c.height = h * r;
    const g = c.getContext('2d')!;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.clearRect(0, 0, w, h);
    if (pts.length < 10) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min((w - 24) / (x1 - x0 || 1), (h - 24) / (y1 - y0 || 1));
    const ox = (w - (x1 - x0) * k) / 2;
    const oy = (h - (y1 - y0) * k) / 2;
    const P = (x: number, y: number): [number, number] => [ox + (x - x0) * k, h - (oy + (y - y0) * k)];
    g.lineWidth = 6;
    g.lineCap = 'round';
    for (let n = 1; n < pts.length; n++) {
      const w2 = won.out[Math.min(N - 1, Math.floor((pts[n]!.d / won.total) * N))] ?? -1;
      g.strokeStyle = w2 >= 0 ? SLOT[tr[w2]!.i]! : tokens().trackCasing;
      g.beginPath();
      g.moveTo(...P(pts[n - 1]!.x, pts[n - 1]!.y));
      g.lineTo(...P(pts[n]!.x, pts[n]!.y));
      g.stroke();
    }
  }, [tr, won]);

  return (
    <>
      <canvas ref={el} style={{ width: '100%', height: 280, display: 'block' }} role="img" aria-label="Circuit coloured by the quickest lap in each section" />
      <table className="tbl dense" style={{ marginTop: 8 }}>
        <tbody>
          {tr.map((x, j) => (
            <tr key={x.i}>
              <td>
                <span className="slot-k" style={{ background: SLOT[x.i], display: 'inline-block', width: 20 }}>
                  {'ABCD'[x.i]}
                </span>
              </td>
              <td>quickest in</td>
              <td className="n">
                {won.out.filter((w) => w === j).length} of {N} sections
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
