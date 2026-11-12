'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  sprintQualifyingWasARace,
  distanceDelta,
  formatLapTime,
  formatSessionTime,
  interpolateMonotone,
  lapTrace,
  lowerIndex,
  type LapRow,
  type SessionDetail,
  type TimelineEvent,
  type TrackOutline,
  type TrackPeriod,
} from '@f1archive/shared';
import { circuitTime, teamColour, toneClass, tyreColour } from '@/lib/time';
import { why } from '@/lib/routes';
import { CarData, CHANNELS, Positions, drsOpen, gapSeconds, intervalAt, isLeaderText, lapSamples, type Channel, type Intervals, type LapSamples } from './data';
import { TrackCanvas, type Car, type TrackHandle } from './TrackCanvas';
import { flagLookup } from './flags';
import { Timeline, type TimelineHandle } from './Timeline';
import { PATTERNS, Traces, type Lane, type Line } from './Traces';

export interface SessionTimeline {
  periods: TrackPeriod[];
  events: TimelineEvent[];
  laps: { lap: number; t_ns: number }[];
}

interface Props {
  detail: SessionDetail;
  timeline: SessionTimeline;
  outline: TrackOutline;
  laps: LapRow[];
  initial: { drivers: string[]; t: number | null; mode: 'time' | 'lap' };
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const MAX = 6;

const LANES: Record<Channel, Lane> = {
  speed: { key: 'speed', label: 'Speed', unit: 'km/h', min: 0, max: 360, h: 104 },
  throttle: { key: 'throttle', label: 'Throttle', unit: '%', min: 0, max: 100, h: 60 },
  brake: { key: 'brake', label: 'Brake', unit: '', min: 0, max: 1, h: 28, step: true, fmt: (v) => (v >= 0.5 ? 'on' : 'off') },
  rpm: { key: 'rpm', label: 'RPM', unit: 'rpm', min: 0, max: 15000, h: 60, fmt: (v) => `${(v / 1000).toFixed(1)}k` },
  gear: { key: 'gear', label: 'Gear', unit: '', min: 0, max: 8, h: 48, step: true },
  drs: { key: 'drs', label: 'DRS', unit: '', min: 0, max: 1, h: 24, step: true, fmt: (v) => (v >= 0.5 ? 'open' : 'shut') },
};

const FEED_KINDS: [TimelineEvent['type'], string][] = [
  ['race_control', 'Race control'],
  ['radio', 'Radio'],
  ['track_status', 'Track status'],
  ['pit', 'Pit lane'],
  ['session_status', 'Session'],
  ['weather', 'Weather'],
  ['lap', 'Laps'],
];

export function Replay({ detail, timeline, outline, laps, initial }: Props) {
  const api = `/api/v1/sessions/${detail.year}/${detail.event}/${detail.slug}`;
  const at = { year: detail.year, event: detail.event, session: detail.slug };
  const clock = { stream_start_utc: detail.stream_start_utc, gmt_offset: detail.gmt_offset };
  const drivers = detail.drivers;
  const byNum = useMemo(() => new Map(drivers.map((d) => [d.number, d])), [drivers]);
  const colour = useCallback((n: string) => teamColour(byNum.get(n)?.team_colour), [byNum]);
  const code = useCallback((n: string | null | undefined) => (n ? (byNum.get(n)?.abbreviation ?? n) : ''), [byNum]);
  const hasTel = (n: string) => ['present', 'partial'].includes(byNum.get(n)?.telemetry ?? '');
  const lapsBy = useMemo(() => {
    const m = new Map<string, LapRow[]>();
    for (const l of laps) (m.get(l.driver) ?? m.set(l.driver, []).get(l.driver)!).push(l);
    return m;
  }, [laps]);

  const t0 = detail.time_range_ns?.from ?? timeline.events[0]?.t_ns ?? 0;
  const t1 = detail.time_range_ns?.to ?? timeline.events.at(-1)?.t_ns ?? t0 + 3600e9;
  const start = useMemo(() => {
    if (initial.t != null && initial.t >= t0 && initial.t <= t1) return initial.t;
    const s = timeline.events.find((e) => e.type === 'session_status' && /started/i.test(e.label));
    return s?.t_ns ?? laps.map((l) => l.start_ns).filter((x): x is number => x != null).sort((a, b) => a - b)[0] ?? t0;
  }, [initial.t, t0, t1, timeline.events, laps]);
  const hasMap = outline.x.length > 1;

  const [sel, setSel] = useState<string[]>(() => {
    const ok = initial.drivers.filter((d) => byNum.has(d)).slice(0, MAX);
    return ok.length ? ok : drivers.filter((d) => d.telemetry === 'present').slice(0, 2).map((d) => d.number);
  });
  const [refPick, setRefPick] = useState<string | null>(null);
  const ref = refPick && sel.includes(refPick) ? refPick : (sel[0] ?? null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [now, setNow] = useState(start);
  const [mode, setMode] = useState<'time' | 'lap'>(initial.mode);
  const [win, setWin] = useState(60);
  const [chans, setChans] = useState<Channel[]>([...CHANNELS]);
  const [showGap, setShowGap] = useState(true);
  const [corners, setCorners] = useState(true);
  const [marshal, setMarshal] = useState(true);
  const standing = useRef(new Map<string, { laps: number | null; racing: boolean }>());
  const [kinds, setKinds] = useState<string[]>(['race_control', 'radio', 'track_status', 'pit', 'session_status', 'weather']);
  const [radioAuto, setRadioAuto] = useState(true);
  const [radioSel, setRadioSel] = useState(false);
  const [follow, setFollow] = useState(true);
  const [towerCol, setTowerCol] = useState<'interval' | 'leader' | 'lap'>('interval');
  const [version, setVersion] = useState(0);
  const [onAir, setOnAir] = useState<TimelineEvent | null>(null);
  const [lapZoom, setLapZoom] = useState<[number, number] | null>(null);

  const tRef = useRef(start);
  const live = useRef({ speed, sel, radioAuto, radioSel });
  live.current = { speed, sel, radioAuto, radioSel };
  const map = useRef<TrackHandle>(null);
  const tl = useRef<TimelineHandle>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const queue = useRef<TimelineEvent[]>([]);
  const feedEl = useRef<HTMLDivElement>(null);
  const lastUi = useRef(0);

  const pos = useMemo(() => new Positions(api, t0, t1), [api, t0, t1]);
  const car = useMemo(() => new CarData(api, t0, t1), [api, t0, t1]);
  const flagsAt = useMemo(() => flagLookup(timeline.events, timeline.periods), [timeline.events, timeline.periods]);
  const radios = useMemo(() => timeline.events.filter((e) => e.type === 'radio' && e.audio_url), [timeline.events]);

  const frame = useCallback(
    (forceUi = false) => {
      const t = tRef.current;
      pos.want(t, Math.ceil(live.current.speed / 4) + 1);
      if (hasMap) {
        const cars: Car[] = [];
        for (const [id, [x, y]] of pos.at(t)) {
          const st = standing.current.get(id);
          cars.push({ id, code: code(id), colour: colour(id), x, y, selected: live.current.sel.includes(id), lapsDone: st?.laps ?? null, racing: st ? st.racing : true });
        }
        map.current?.paint(cars, flagsAt(t), t);
      }
      tl.current?.at(t);
      const ms = performance.now();
      if (forceUi || ms - lastUi.current > 100) {
        lastUi.current = ms;
        setNow(t);
      }
    },
    [pos, hasMap, code, colour, flagsAt],
  );
  useEffect(() => pos.subscribe(() => frame(true)), [pos, frame]);
  useEffect(() => car.subscribe(() => setVersion((v) => v + 1)), [car]);
  useEffect(() => frame(true), [frame, sel, corners, marshal]);

  const playClip = useCallback((e: TimelineEvent) => {
    const a = audio.current;
    if (!a || !e.audio_url) return;
    a.src = e.audio_url;
    void a.play().catch(() => undefined);
    setOnAir(e);
  }, []);

  const seek = useCallback(
    (t: number) => {
      tRef.current = Math.min(t1, Math.max(t0, t));
      queue.current = [];
      frame(true);
    },
    [t0, t1, frame],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (ms: number) => {
      const prev = tRef.current;
      const next = Math.min(t1, prev + (ms - last) * 1e6 * live.current.speed);
      last = ms;
      tRef.current = next;
      if (live.current.radioAuto && live.current.speed <= 4) {
        for (const e of radios) {
          if (e.t_ns <= prev || e.t_ns > next) continue;
          if (live.current.radioSel && e.driver && !live.current.sel.includes(e.driver)) continue;
          if (audio.current && !audio.current.paused) {
            if (queue.current.length < 3) queue.current.push(e);
          } else playClip(e);
        }
      }
      frame();
      if (next >= t1) return setPlaying(false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, t1, radios, frame, playClip]);

  useEffect(() => {
    if (playing) return;
    const id = setTimeout(() => {
      const u = new URL(window.location.href);
      u.searchParams.set('drivers', sel.join(','));
      u.searchParams.set('t', String(Math.round(now)));
      if (mode === 'lap') u.searchParams.set('mode', 'lap');
      else u.searchParams.delete('mode');
      window.history.replaceState(null, '', u);
    }, 500);
    return () => clearTimeout(id);
  }, [playing, sel, now, mode]);

  const marks = useMemo(() => {
    if (timeline.laps.length) return timeline.laps.map((l) => l.t_ns);
    return (ref ? (lapsBy.get(ref) ?? []) : []).map((l) => l.start_ns).filter((x): x is number => x != null);
  }, [timeline.laps, lapsBy, ref]);
  const jumpLap = (dir: 1 | -1) => {
    const t = tRef.current;
    const m = [...marks].sort((a, b) => a - b);
    const target = dir > 0 ? m.find((x) => x > t + 1e9) : m.reverse().find((x) => x < t - 2e9);
    if (target != null) seek(target);
  };
  const incidents = useMemo(() => timeline.events.filter((e) => e.type === 'race_control' || (e.type === 'track_status' && e.tone !== 'green')), [timeline.events]);
  const jumpIncident = (dir: 1 | -1) => {
    const t = tRef.current;
    const e = dir > 0 ? incidents.find((x) => x.t_ns > t + 1e9) : [...incidents].reverse().find((x) => x.t_ns < t - 2e9);
    if (e) seek(e.t_ns - 3e9);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === ' ') (e.preventDefault(), setPlaying((p) => !p));
      else if (e.key === 'ArrowRight') seek(tRef.current + (e.shiftKey ? 30e9 : 5e9));
      else if (e.key === 'ArrowLeft') seek(tRef.current - (e.shiftKey ? 30e9 : 5e9));
      else if (e.key === ']') jumpLap(1);
      else if (e.key === '[') jumpLap(-1);
      else if (e.key === '.') setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)]!);
      else if (e.key === ',') setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)]!);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const [iv, setIv] = useState<Intervals | null>(null);
  useEffect(() => {
    let ok = true;
    fetch(`${api}/intervals`)
      .then((r) => (r.ok ? r.json() : { drivers: {} }))
      .then((j: { drivers: Intervals }) => ok && setIv(j.drivers))
      .catch(() => ok && setIv({}));
    return () => void (ok = false);
  }, [api]);
  const liveGaps = useMemo(() => !!iv && Object.values(iv).some((s) => s.gap_to_leader.some((g) => !!g)), [iv]);
  useEffect(() => {
    if (iv && !liveGaps) setTowerCol('lap');
  }, [iv, liveGaps]);

  const tower = useMemo(() => {
    const rows = drivers.map((d) => {
      const ls = lapsBy.get(d.number) ?? [];
      let last: LapRow | null = null;
      for (const l of ls) if (l.end_ns != null && l.end_ns <= now) last = l;
      const cur = ls.find((l) => l.start_ns != null && l.end_ns != null && l.start_ns <= now && now < l.end_ns) ?? null;
      const pit = !!cur && ((cur.pit_in_ns != null && cur.pit_in_ns <= now) || (cur.pit_out_ns != null && now <= cur.pit_out_ns));
      const lastEnd = ls.at(-1)?.end_ns ?? null;
      const out = !cur && lastEnd != null && now > lastEnd + 240e9;
      const g = iv ? intervalAt(iv[d.number], now) : null;
      return { d, last, cur, pit, out, g, p: g?.position ?? last?.position ?? ls[0]?.position ?? null };
    });
    return rows.sort((a, b) => Number(a.out) - Number(b.out) || (a.p ?? 99) - (b.p ?? 99));
  }, [drivers, lapsBy, now, iv]);
  useEffect(() => {
    standing.current = new Map(tower.map((r) => [r.d.number, { laps: r.last?.lap ?? null, racing: !r.pit && !r.out }]));
  }, [tower]);

  const feed = useMemo(
    () => timeline.events.filter((e) => kinds.includes(e.type) && !(e.type === 'radio' && radioSel && e.driver && !sel.includes(e.driver))),
    [timeline.events, kinds, radioSel, sel],
  );
  const nowIdx = useMemo(() => {
    let k = -1;
    for (let i = 0; i < feed.length && feed[i]!.t_ns <= now; i++) k = i;
    return k;
  }, [feed, now]);
  useEffect(() => {
    const box = feedEl.current;
    const el = box?.querySelector<HTMLElement>(`[data-i="${nowIdx}"]`);
    if (!follow || !box || !el) return;
    const rel = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const top = Math.max(0, rel - 40);
    if (Math.abs(box.scrollTop - top) < 2) return;
    box.scrollTo({ top, behavior: Math.abs(box.scrollTop - top) > 600 ? 'auto' : 'smooth' });
  }, [nowIdx, follow]);

  const from = now - win * 0.75e9;
  const to = now + win * 0.25e9;
  useEffect(() => {
    if (mode === 'time' && sel.length) car.want(sel, from - 30e9, to + 60e9 * Math.max(1, speed));
  }, [mode, sel, car, Math.floor(from / 30e9), speed]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeView = useMemo(() => {
    if (mode !== 'time') return null;
    let loading = false;
    const lines: Line[] = [];
    sel.forEach((d, i) => {
      if (!hasTel(d)) return;
      const { s, complete } = car.slice(d, from - 2e9, to + 2e9);
      if (!complete) loading = true;
      lines.push({ id: d, label: code(d), colour: colour(d), dash: PATTERNS[i % PATTERNS.length]!.dash, x: s.ts_ns.map((t) => t / 1e9), v: { ...s, drs: s.drs.map(drsOpen) } });
    });
    let gapLane: Lane | null = null;
    if (showGap && liveGaps && iv) {
      let max = 0;
      sel.forEach((d, i) => {
        const s = iv[d];
        if (!s) return;
        const a = Math.max(0, lowerIndex(s.ts_ns, from));
        const z = Math.min(s.ts_ns.length - 1, lowerIndex(s.ts_ns, to) + 1);
        const x: number[] = [];
        const v: (number | null)[] = [];
        for (let k = a; k <= z; k++) {
          const g = gapSeconds(s.gap_to_leader[k] ?? null);
          x.push(Math.max(s.ts_ns[k]!, from) / 1e9);
          v.push(g);
          if (g != null) max = Math.max(max, g);
        }
        lines.push({ id: `${d}-gap`, label: code(d), colour: colour(d), dash: PATTERNS[i % PATTERNS.length]!.dash, x, v: { gap: v } });
      });
      const top = max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
      gapLane = { key: 'gap', label: 'Gap', unit: 's to P1', min: 0, max: top, h: 64, step: true, fmt: (n) => n.toFixed(1) };
    }
    return { lines, loading, gapLane };
  }, [mode, sel, car, from, to, version, showGap, liveGaps, iv, code, colour]); // eslint-disable-line react-hooks/exhaustive-deps

  const refLap = useMemo(() => {
    if (!ref) return null;
    return (lapsBy.get(ref) ?? []).find((l) => l.start_ns != null && l.end_ns != null && l.start_ns <= now && now < l.end_ns) ?? null;
  }, [ref, lapsBy, now]);
  const lapNo = refLap?.lap ?? null;
  const [lapSet, setLapSet] = useState<Map<string, LapSamples> | null>(null);
  const lapKey = `${lapNo}/${sel.join(',')}`;
  useEffect(() => {
    if (mode !== 'lap' || lapNo == null) return;
    let ok = true;
    setLapSet(null);
    Promise.all(sel.map((d) => lapSamples(api, d, lapNo).then((r) => [d, r] as const).catch(() => null))).then((r) => {
      if (!ok) return;
      setLapSet(new Map(r.filter((x): x is readonly [string, LapSamples] => !!x)));
      setLapZoom(null);
    });
    return () => void (ok = false);
  }, [mode, lapKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const lapView = useMemo(() => {
    if (mode !== 'lap' || !lapSet || lapNo == null || !ref) return null;
    const tr = new Map<string, { t: ReturnType<typeof lapTrace>; idx: number[]; ls: LapSamples }>();
    for (const [d, ls] of lapSet) {
      if (!ls.samples) continue;
      const idx = ls.samples.speed.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
      if (idx.length < 10) continue;
      tr.set(d, { t: lapTrace(idx.map((i) => ls.samples!.ts_ns[i]!), idx.map((i) => ls.samples!.speed[i]!), ls.lap.start_ns), idx, ls });
    }
    const base = tr.get(ref);
    let dmax = 0;
    let span = 0;
    const lines: Line[] = [];
    sel.forEach((d, i) => {
      const x = tr.get(d);
      if (!x) return;
      const v: Record<string, (number | null)[]> = {};
      for (const c of CHANNELS) v[c] = x.idx.map((k) => (c === 'drs' ? drsOpen(x.ls.samples!.drs[k] ?? null) : (x.ls.samples![c][k] ?? null)));
      if (base && d !== ref) {
        const delta = distanceDelta(base.t, x.t);
        const dv = Array.from(delta, (q) => q ?? NaN);
        v.delta = Array.from(x.t.distance, (dist) => {
          const q = interpolateMonotone(base.t.distance, dv, dist);
          return q == null || Number.isNaN(q) ? null : q;
        });
        for (const q of v.delta) if (q != null) dmax = Math.max(dmax, Math.abs(q));
      } else v.delta = Array.from(x.t.distance, () => 0);
      span = Math.max(span, x.t.distance[x.t.distance.length - 1] ?? 0);
      lines.push({ id: d, label: code(d), colour: colour(d), dash: PATTERNS[i % PATTERNS.length]!.dash, x: x.t.distance, v });
    });
    const cursor = base ? interpolateMonotone(base.t.elapsed, base.t.distance, (now - base.ls.lap.start_ns) / 1e9) : null;
    return { lines, span, cursor, bound: Math.max(0.5, Math.ceil(dmax * 2) / 2), times: [...tr.entries()], missing: sel.filter((d) => !tr.has(d)) };
  }, [mode, lapSet, lapNo, ref, sel, now, code, colour]);

  const leaderLap = timeline.laps.filter((l) => l.t_ns <= now).at(-1)?.lap ?? null;
  const status = timeline.periods.find((p) => p.from_ns <= now && (p.to_ns == null || now < p.to_ns));
  const toggle = (n: string) => setSel((s) => (s.includes(n) ? s.filter((x) => x !== n) : s.length >= MAX ? [...s.slice(1), n] : [...s, n]));
  const lanes = chans.map((c) => LANES[c]);
  const noTel = sel.filter((d) => byNum.get(d)?.telemetry !== 'present');

  return (
    <div>
      <audio
        ref={audio}
        preload="none"
        onEnded={() => {
          setOnAir(null);
          const n = queue.current.shift();
          if (n) playClip(n);
        }}
        onPause={() => !audio.current?.ended && setOnAir(null)}
      />

      <div className="rp-drivers" role="group" aria-label="Drivers to show">
        {drivers.map((d) => {
          const i = sel.indexOf(d.number);
          return (
            <button key={d.number} className="tog" aria-pressed={i >= 0} onClick={() => toggle(d.number)} title={`${d.full_name ?? d.number}${hasTel(d.number) ? '' : ', no telemetry'}`}>
              <span className="drv">
                <i style={{ background: colour(d.number) }} />
                {d.abbreviation ?? d.number}
              </span>
              {i > 0 && <span className="t-muted">{PATTERNS[i]!.name}</span>}
              {!hasTel(d.number) && <span className="t-muted">no data</span>}
            </button>
          );
        })}
        {sel.length > 1 && (
          <label className="row t-small t-muted" style={{ marginLeft: 8 }}>
            Reference
            <select value={ref ?? ''} onChange={(e) => setRefPick(e.target.value)}>
              {sel.map((d) => (
                <option key={d} value={d}>
                  {code(d)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="rp-grid">
        <section className="pane p-map" aria-label="Circuit">
          <div className="pane-h">
            <h3>Circuit</h3>
            <div className="row t-small">
              {status && status.tone !== 'green' && <span className={`st ${toneClass(status.tone)}`}>{status.label}</span>}
              {leaderLap != null && (
                <span className="mono-sm">
                  Lap {leaderLap}
                  {detail.total_laps ? ` of ${detail.total_laps}` : ''}
                </span>
              )}
              {outline.corners.length > 0 ? (
                <label className="chk">
                  <input type="checkbox" checked={corners} onChange={(e) => setCorners(e.target.checked)} /> Corner numbers
                </label>
              ) : (
                <span className="gap">
                  No corner numbers.{' '}
                  <Link className="why" href={why({ year: detail.year, event: detail.event, feed: 'circuit_corners' })}>
                    Why?
                  </Link>
                </span>
              )}
              {outline.marshal_lights.length > 0 ? (
                <label
                  className="chk"
                  title="Panels light in their sector's flag. Blue panels follow race control's blue flag messages and, in races, cars about to be lapped (worked out from car positions)."
                >
                  <input type="checkbox" checked={marshal} onChange={(e) => setMarshal(e.target.checked)} /> Marshal lights
                </label>
              ) : (
                <span className="gap">
                  No marshal lights.{' '}
                  <Link className="why" href={why({ year: detail.year, event: detail.event, feed: 'marshal_lights' })}>
                    Why?
                  </Link>
                </span>
              )}
            </div>
          </div>
          <div className="pane-b">
            {hasMap ? (
              <>
                <TrackCanvas ref={map} outline={outline} corners={corners} marshalLights={marshal} inferBlue={detail.kind === 'race' || detail.kind === 'sprint' || sprintQualifyingWasARace(detail.year, detail.name)} onPick={toggle} />
                <div className="map-clock">{circuitTime(now, clock)}</div>
                {!pos.has(now) && <div className="map-note">Loading positions</div>}
              </>
            ) : (
              <div style={{ padding: 16 }}>
                <div className="missing">
                  <b>No position data for this session</b>, so cars cannot be placed on the circuit.{' '}
                  <Link className="why" href={why({ ...at, feed: 'telemetry', driver: drivers.find((d) => hasTel(d.number))?.number })}>
                    Why is this missing?
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="pane p-tower" aria-label="Running order">
          <div className="pane-h">
            <h3>Order</h3>
            <div className="seg" role="group" aria-label="Column">
              {liveGaps && (
                <>
                  <button aria-pressed={towerCol === 'interval'} onClick={() => setTowerCol('interval')} title="Gap to the car ahead">
                    Interval
                  </button>
                  <button aria-pressed={towerCol === 'leader'} onClick={() => setTowerCol('leader')} title="Gap to the leader">
                    Leader
                  </button>
                </>
              )}
              <button aria-pressed={towerCol === 'lap'} onClick={() => setTowerCol('lap')} title="Last lap time">
                Lap
              </button>
            </div>
          </div>
          <ol className="tower">
            {tower.map((r) => {
              const tyre = r.cur?.compound ?? r.last?.compound;
              const right =
                towerCol === 'lap' || !r.g
                  ? r.last
                    ? formatLapTime(r.last.lap_time_ns)
                    : ''
                  : isLeaderText(r.g.leader)
                    ? 'leader'
                    : ((towerCol === 'interval' ? r.g.ahead : r.g.leader) ?? '');
              return (
                <li key={r.d.number} className={`${sel.includes(r.d.number) ? 'sel' : ''} ${r.out ? 'out' : ''}`}>
                  <button onClick={() => toggle(r.d.number)} aria-pressed={sel.includes(r.d.number)}>
                    <span className="p">{r.out ? '' : (r.p ?? '')}</span>
                    <span className="bar" style={{ background: colour(r.d.number) }} />
                    <span className="c">{r.d.abbreviation}</span>
                    {r.out ? (
                      <span className="st out">OUT</span>
                    ) : r.pit ? (
                      <span className="st pit">PIT</span>
                    ) : tyre ? (
                      <span className="tyre" style={{ borderColor: tyreColour(tyre), color: tyreColour(tyre) }} title={tyre.toLowerCase()}>
                        {tyre[0]}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="g">{r.out ? '' : right}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="pane p-feed" aria-label="Session events">
          <div className="pane-h">
            <h3>Race control and radio</h3>
            <label className="chk t-small">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow playback
            </label>
          </div>
          <div className="feed-tools">
            {FEED_KINDS.map(([k, label]) => (
              <button key={k} className="tog" aria-pressed={kinds.includes(k)} onClick={() => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}>
                {label}
              </button>
            ))}
            <label className="chk t-small" style={{ width: '100%', marginTop: 4 }}>
              <input type="checkbox" checked={radioAuto} onChange={(e) => setRadioAuto(e.target.checked)} /> Play radio as it happens (up to 4x speed)
            </label>
            <label className="chk t-small">
              <input type="checkbox" checked={radioSel} onChange={(e) => setRadioSel(e.target.checked)} /> Only selected drivers’ radio
            </label>
            {/* Always takes its space so the list below does not move when radio starts or stops */}
            <div className="row t-small on-air" style={{ visibility: onAir ? 'visible' : 'hidden' }} aria-hidden={!onAir}>
              Playing {onAir ? code(onAir.driver) : ''} radio
              <button className="btn sm quiet" onClick={() => audio.current?.pause()} tabIndex={onAir ? 0 : -1}>
                Stop
              </button>
            </div>
          </div>
          <div className="feed" ref={feedEl}>
            {feed.length === 0 && <p className="t-muted" style={{ padding: 12 }}>Nothing of the selected kinds.</p>}
            {feed.map((e, i) => (
              <div key={`${e.type}${e.id ?? i}${e.t_ns}`} data-i={i} className={`fe k-${e.type} ${i === nowIdx ? 'now' : i > nowIdx ? 'future' : ''}`}>
                <button className="time" title="Go to this moment" onClick={() => seek(e.t_ns - (e.type === 'radio' ? 1e9 : 3e9))}>
                  {circuitTime(e.t_ns, clock)}
                </button>
                <div className="msg">
                  {e.driver && (
                    <span className="drv" style={{ marginRight: 6 }}>
                      <i style={{ background: colour(e.driver) }} />
                      {code(e.driver)}
                    </span>
                  )}
                  {e.type === 'radio' ? 'team radio' : e.type === 'track_status' ? <span className={`st ${toneClass(e.tone)}`}>{e.label}</span> : e.label}
                  {e.fields && e.fields.length > 0 && (
                    <div className="fields">
                      {e.fields.map(([k, v]) => (
                        <span key={k}>
                          {k}
                          {/* The feed publishes values like "DOUBLE YELLOW" shown in sentence case */}
                          <b>{v.length > 2 && v === v.toUpperCase() ? v.charAt(0) + v.slice(1).toLowerCase() : v}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {e.type === 'radio' &&
                  (e.audio_url ? (
                    <button className="play-sm" aria-label={`Play ${code(e.driver)} radio`} onClick={() => playClip(e)}>
                      ▶
                    </button>
                  ) : (
                    <Link className="why t-small" href={why({ ...at, feed: 'team_radio', recording: true })}>
                      no audio
                    </Link>
                  ))}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rp-ctrl" aria-label="Playback">
        <div className="bar">
          <div className="row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => jumpLap(-1)} title="Previous lap ([)">
              Prev lap
            </button>
            <button className="btn sm" onClick={() => seek(tRef.current - 10e9)} title="Back 10 seconds (left arrow, Shift for 30)">
              -10 s
            </button>
            <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (space)">
              {playing ? '❚❚' : '▶'}
            </button>
            <button className="btn sm" onClick={() => seek(tRef.current + 10e9)} title="Forward 10 seconds (right arrow)">
              +10 s
            </button>
            <button className="btn sm" onClick={() => jumpLap(1)} title="Next lap (])">
              Next lap
            </button>
          </div>
          <div className="seg" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn sm" onClick={() => jumpIncident(-1)}>
              Previous incident
            </button>
            <button className="btn sm" onClick={() => jumpIncident(1)}>
              Next incident
            </button>
          </div>
          <div className="clock">
            {circuitTime(now, clock)} <span>local, +{formatSessionTime(now - t0, 1)} into the session</span>
          </div>
        </div>
        <Timeline ref={tl} from={t0} to={t1} periods={timeline.periods} events={timeline.events} laps={timeline.laps} onSeek={seek} label={(t) => circuitTime(t, clock)} />
        <div className="tl-key">
          <span><i style={{ background: 'var(--flag-yellow)' }} />yellow flag</span>
          <span><i style={{ background: 'var(--flag-sc)' }} />Safety Car</span>
          <span><i style={{ background: 'repeating-linear-gradient(-45deg, var(--flag-yellow) 0 2px, transparent 2px 4px)' }} />Virtual Safety Car</span>
          <span><i style={{ background: 'var(--flag-red)' }} />red flag</span>
          <span>Marks below the bar: race control, team radio, pit lane.</span>
        </div>
      </section>

      <section className="rp-traces" aria-label="Telemetry">
        <div className="pane-h">
          <div className="row">
            <h3>Telemetry</h3>
            <div className="seg" role="group" aria-label="Chart">
              <button aria-pressed={mode === 'time'} onClick={() => setMode('time')}>
                Around the playhead
              </button>
              <button aria-pressed={mode === 'lap'} onClick={() => setMode('lap')}>
                Current lap by distance
              </button>
            </div>
            {mode === 'time' && (
              <div className="seg" role="group" aria-label="Window">
                {[30, 60, 120, 300].map((w) => (
                  <button key={w} aria-pressed={win === w} onClick={() => setWin(w)}>
                    {w < 60 ? `${w} s` : `${w / 60} min`}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 4 }}>
            {CHANNELS.map((c) => (
              <button key={c} className="tog" aria-pressed={chans.includes(c)} onClick={() => setChans((x) => (x.includes(c) ? x.filter((y) => y !== c) : CHANNELS.filter((y) => x.includes(y) || y === c)))}>
                {LANES[c].label}
              </button>
            ))}
            {mode === 'time' && liveGaps && (
              <button className="tog" aria-pressed={showGap} onClick={() => setShowGap((g) => !g)}>
                Gap to leader
              </button>
            )}
          </div>
        </div>
        {sel.length === 0 ? (
          <p className="t-muted" style={{ padding: 12 }}>Select drivers above to show their telemetry.</p>
        ) : mode === 'time' && timeView ? (
          <>
            <Traces
              lanes={timeView.gapLane ? [timeView.gapLane, ...lanes] : lanes}
              lines={timeView.lines}
              range={[from / 1e9, to / 1e9]}
              cursor={now / 1e9}
              fmtX={(x) => circuitTime(x * 1e9, clock)}
              xLabel="local time"
              onSeek={(x) => seek(x * 1e9)}
              empty={timeView.lines.length === 0 ? 'No telemetry for the selected drivers.' : timeView.loading && timeView.lines.every((l) => l.x.length === 0) ? 'Loading telemetry' : null}
            />
            <div className="t-small t-muted" style={{ padding: '0 12px 10px' }}>
              {noTel.map((d) => (
                <span key={d} style={{ marginRight: 16 }}>
                  {code(d)}: {byNum.get(d)?.telemetry === 'partial' ? 'partial telemetry' : 'no telemetry'}.{' '}
                  <Link className="why" href={why({ ...at, feed: 'telemetry', driver: d })}>
                    Why?
                  </Link>
                </span>
              ))}
              Original samples. Click a trace to move the playhead.
            </div>
          </>
        ) : lapNo == null ? (
          <p className="t-muted" style={{ padding: 12 }}>
            {code(ref)} is not on a timed lap at this moment. Move the playhead onto a lap.
          </p>
        ) : !lapView ? (
          <p className="t-muted" style={{ padding: 12 }}>Loading lap {lapNo}</p>
        ) : (
          <>
            <table className="tbl dense" style={{ margin: '8px 12px 0', width: 'auto' }}>
              <thead>
                <tr>
                  <th>Lap {lapNo}</th>
                  <th className="n">Time</th>
                  <th className="n">Sector 1</th>
                  <th className="n">Sector 2</th>
                  <th className="n">Sector 3</th>
                </tr>
              </thead>
              <tbody>
                {lapView.times.map(([d, x]) => (
                  <tr key={d}>
                    <td>
                      <span className="drv">
                        <i style={{ background: colour(d) }} />
                        {code(d)}
                      </span>
                    </td>
                    <td className="n">{formatLapTime(x.ls.lap.lap_time_ns)}</td>
                    <td className="n">{formatLapTime(x.ls.lap.s1_ns)}</td>
                    <td className="n">{formatLapTime(x.ls.lap.s2_ns)}</td>
                    <td className="n">{formatLapTime(x.ls.lap.s3_ns)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Traces
              lanes={sel.length > 1 ? [{ key: 'delta', label: 'Delta', unit: `s vs ${code(ref)}`, min: -lapView.bound, max: lapView.bound, h: 64, zero: true, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}` }, ...lanes] : lanes}
              lines={lapView.lines}
              range={lapZoom ?? [0, lapView.span]}
              bounds={[0, lapView.span]}
              cursor={lapView.cursor}
              fmtX={(x) => `${Math.round(x)} m`}
              xLabel="distance"
              onRange={setLapZoom}
              empty={lapView.lines.length === 0 ? `No telemetry for lap ${lapNo}.` : null}
            />
            <p className="t-small t-muted" style={{ padding: '0 12px 10px', margin: 0 }}>
              {lapView.missing.length > 0 && `No lap ${lapNo} data for ${lapView.missing.map(code).join(', ')}. `}
              Distance is derived by integrating speed. Delta is time behind {code(ref)} at the same distance; positive is slower. Drag to pan, Ctrl or Shift with the wheel to zoom.
            </p>
          </>
        )}
      </section>
      <p className="t-small t-muted" style={{ marginTop: 8 }}>
        Keys: space plays or pauses, arrows move 5 s (30 s with Shift), [ and ] change lap, comma and full stop change speed. Car positions are interpolated between samples, never across a gap longer than 2 s.
      </p>
    </div>
  );
}
