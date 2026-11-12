'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  TELEMETRY_CHANNELS,
  formatBytes,
  type EventSummary,
  type ExportCategory,
  type ExportEstimate,
  type ExportFormat,
  type ExportJob,
  type ExportRequest,
  type SeasonSummary,
  type TelemetryChannel,
} from '@f1archive/shared';
import { load, post } from '@/lib/client';

interface Category {
  key: ExportCategory;
  label: string;
  description: string;
  columns: { name: string; type: string; unit: string | null; derived: boolean }[];
}

const FORMATS: [ExportFormat, string, string][] = [
  ['csv', 'CSV', 'One file per category. Spreadsheets, pandas, R.'],
  ['parquet', 'Parquet', 'Typed and compressed, one file per category. pandas, Polars, DuckDB, Spark.'],
  ['sqlite', 'SQLite', 'One database file with indexes and column descriptions.'],
  ['jsonl', 'JSON Lines', 'One object per line; streams well.'],
  ['json', 'JSON', 'One array per category; up to 5 million rows.'],
];

const KINDS: [string, string][] = [
  ['race', 'Races'],
  ['sprint', 'Sprints'],
  ['qualifying', 'Qualifying'],
  ['sprint-qualifying', 'Sprint qualifying and shootouts'],
  ['practice', 'Practice'],
  ['testing', 'Testing'],
];

const flip = <T,>(a: T[], v: T) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);

export function Builder() {
  const sp = useSearchParams();
  const router = useRouter();
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [evs, setEvs] = useState<Record<number, EventSummary[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const [years, setYears] = useState<number[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [sessions, setSessions] = useState<string[]>(() => (sp.get('sessions') ?? '').split(',').filter(Boolean));
  const [kinds, setKinds] = useState<string[]>([]);
  const [categories, setCategories] = useState<ExportCategory[]>(['sessions', 'laps', 'weather']);
  const [drivers, setDrivers] = useState('');
  const [channels, setChannels] = useState<TelemetryChannel[]>([]);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [fromS, setFromS] = useState('');
  const [toS, setToS] = useState('');

  const [est, setEst] = useState<ExportEstimate | null>(null);
  const [resolved, setResolved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    load<SeasonSummary[]>('/api/v1/seasons').then(setSeasons).catch((e) => setError(e.message));
    load<Category[]>('/api/v1/exports/schema').then(setCats).catch(() => undefined);
    for (const k of sessions) expand(`y${k.slice(0, 4)}`, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function expand(key: string, force?: boolean) {
    setOpen((o) => ({ ...o, [key]: force ?? !o[key] }));
    const y = Number(key.slice(1));
    if (key.startsWith('y') && y && !evs[y]) load<EventSummary[]>(`/api/v1/seasons/${y}/events`).then((e) => setEvs((m) => ({ ...m, [y]: e })));
  }

  const req: ExportRequest = useMemo(
    () => ({
      format,
      categories,
      sessions,
      selection: { years, events, session_kinds: kinds },
      drivers: drivers.split(/[\s,]+/).filter(Boolean),
      time_from_ns: fromS ? Math.round(Number(fromS) * 1e9) : null,
      time_to_ns: toS ? Math.round(Number(toS) * 1e9) : null,
      telemetry_channels: channels,
    }),
    [format, categories, sessions, years, events, kinds, drivers, fromS, toS, channels],
  );
  const none = !years.length && !events.length && !sessions.length;

  useEffect(() => {
    setEst(null);
    setError(null);
    if (none || !categories.length) return;
    setBusy(true);
    let ok = true;
    const id = setTimeout(() => {
      post<{ request: ExportRequest; estimate: ExportEstimate }>('/api/v1/exports/estimate', req)
        .then((r) => ok && (setEst(r.estimate), setResolved(r.request.sessions)))
        .catch((e) => ok && setError(e.message))
        .finally(() => ok && setBusy(false));
    }, 400);
    return () => {
      ok = false;
      clearTimeout(id);
    };
  }, [req, none, categories.length]);

  async function start(only?: string[]) {
    setStarting(true);
    setError(null);
    try {
      const j = await post<ExportJob>('/api/v1/exports', only ? { ...req, sessions: only, selection: undefined } : req);
      router.push(`/exports/${j.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  return (
    <div className="build">
      <div>
        <section className="step">
          <h2>Sessions</h2>
          <p className="t-muted t-small">Tick whole seasons, single events or single sessions. They are combined.</p>
          <div className="row" style={{ gap: 4, marginBottom: 8 }}>
            <span className="t-small t-muted">Limit seasons and events to:</span>
            {KINDS.map(([k, label]) => (
              <button key={k} className="tog" aria-pressed={kinds.includes(k)} onClick={() => setKinds((x) => flip(x, k))}>
                {label}
              </button>
            ))}
          </div>
          <div className="tree">
            {seasons.map((s) => (
              <div key={s.year}>
                <div className="r">
                  <button className="tw" aria-expanded={!!open[`y${s.year}`]} aria-label={`Show events in ${s.year}`} onClick={() => expand(`y${s.year}`)}>
                    {open[`y${s.year}`] ? '▾' : '▸'}
                  </button>
                  <label className="chk">
                    <input type="checkbox" checked={years.includes(s.year)} onChange={() => setYears((x) => flip(x, s.year))} />
                    <b style={{ fontWeight: 600 }}>{s.year}</b>
                    <span className="t-muted t-small">all {s.sessions_archived} sessions</span>
                  </label>
                </div>
                {open[`y${s.year}`] && (
                  <div className="kids">
                    {!evs[s.year] && <div className="t-muted t-small">Loading</div>}
                    {evs[s.year]?.map((e) => {
                      const whole = years.includes(s.year);
                      return (
                        <div key={e.key}>
                          <div className="r">
                            <button className="tw" aria-expanded={!!open[e.key]} aria-label={`Show sessions of ${e.name}`} onClick={() => expand(e.key)}>
                              {open[e.key] ? '▾' : '▸'}
                            </button>
                            <label className="chk">
                              <input type="checkbox" disabled={whole} checked={whole || events.includes(e.key)} onChange={() => setEvents((x) => flip(x, e.key))} />
                              {e.is_testing ? 'Testing' : `Round ${e.round}`}: {e.name}
                            </label>
                          </div>
                          {open[e.key] &&
                            e.sessions.map((x) => (
                              <label key={x.key} className="chk r leaf">
                                <input
                                  type="checkbox"
                                  disabled={x.status !== 'archived' || whole || events.includes(e.key)}
                                  checked={whole || events.includes(e.key) || sessions.includes(x.key)}
                                  onChange={() => setSessions((v) => flip(v, x.key))}
                                />
                                {x.name}
                                {x.status !== 'archived' && <span className="t-muted t-small"> ({x.status})</span>}
                                {x.has_telemetry && <span className="t-muted t-small"> with telemetry</span>}
                              </label>
                            ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          {sessions.length > 0 && (
            <div className="row t-small" style={{ marginTop: 8, gap: 4 }}>
              <span className="t-muted">Single sessions:</span>
              {sessions.map((k) => (
                <button key={k} className="tog" aria-pressed onClick={() => setSessions((x) => x.filter((y) => y !== k))} title="Remove">
                  {k} (remove)
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="step">
          <h2>What to include</h2>
          <div className="opts">
            {cats.map((c) => (
              <label key={c.key} className="opt">
                <input type="checkbox" checked={categories.includes(c.key)} onChange={() => setCategories((x) => flip(x, c.key))} />
                <span>
                  {c.label}
                  <small>
                    {c.description} {c.columns.length} columns.
                  </small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="step">
          <h2>Filters</h2>
          <div className="stack">
            <label className="f">
              Drivers, by car number or code, separated by commas. Applies to driver-level data.
              <input type="text" value={drivers} placeholder="VER, HAM or 33, 44" onChange={(e) => setDrivers(e.target.value)} />
            </label>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label className="f">
                From (seconds of session time)
                <input type="number" min={0} value={fromS} onChange={(e) => setFromS(e.target.value)} style={{ width: 200 }} />
              </label>
              <label className="f">
                To
                <input type="number" min={0} value={toS} onChange={(e) => setToS(e.target.value)} style={{ width: 200 }} />
              </label>
            </div>
            <p className="t-small t-muted" style={{ margin: 0 }}>
              Session time counts from the start of each session’s data stream, usually about an hour before the session starts.
            </p>
            {categories.includes('telemetry') && (
              <div className="row" style={{ gap: 4 }}>
                <span className="t-small t-muted">Telemetry channels (none ticked means all):</span>
                {TELEMETRY_CHANNELS.map((c) => (
                  <button key={c} className="tog" aria-pressed={channels.includes(c)} onClick={() => setChannels((x) => flip(x, c))}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="step">
          <h2>Format</h2>
          <div className="opts">
            {FORMATS.map(([k, label, help]) => (
              <label key={k} className="opt">
                <input type="radio" name="format" checked={format === k} onChange={() => setFormat(k)} />
                <span>
                  {label}
                  <small>{help}</small>
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <aside>
        <h2>Estimate {busy && <span className="t-muted t-small">updating</span>}</h2>
        {none ? (
          <p className="t-muted">Choose at least one season, event or session.</p>
        ) : !categories.length ? (
          <p className="t-muted">Choose at least one kind of data.</p>
        ) : est ? (
          <>
            <table className="tbl dense">
              <tbody>
                <tr>
                  <td>Sessions</td>
                  <td className="n">{est.sessions.toLocaleString('en-GB')}</td>
                </tr>
                {Object.entries(est.rows).map(([k, n]) => (
                  <tr key={k}>
                    <td className="t-muted">{cats.find((c) => c.key === k)?.label ?? k}</td>
                    <td className="n">{(n ?? 0).toLocaleString('en-GB')}</td>
                  </tr>
                ))}
                <tr>
                  <td>Rows{est.rows.telemetry ? ', telemetry estimated' : ''}</td>
                  <td className="n">{est.total_rows.toLocaleString('en-GB')}</td>
                </tr>
                <tr>
                  <td>Size before zipping, roughly</td>
                  <td className="n">{formatBytes(est.estimated_bytes)}</td>
                </tr>
              </tbody>
            </table>
            {est.within_limits ? (
              <button className="btn primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} disabled={starting} onClick={() => start()}>
                {starting ? 'Starting' : 'Build export'}
              </button>
            ) : (
              <div style={{ marginTop: 12 }}>
                <p className="note warn">{est.limit_reason}</p>
                {est.suggested_split?.map((part, i) => (
                  <button key={i} className="btn sm" style={{ display: 'flex', marginTop: 4 }} disabled={starting} onClick={() => start(part)}>
                    Build part {i + 1} of {est.suggested_split!.length}: {part.length} sessions from {part[0]}
                  </button>
                ))}
              </div>
            )}
            <p className="t-small t-muted" style={{ marginTop: 12 }}>
              Finished exports are kept for 48 hours. You can leave the progress page and come back to it.
            </p>
            {resolved.length > 0 && (
              <details className="t-small">
                <summary className="t-muted">Sessions included ({resolved.length})</summary>
                <div className="mono-sm t-muted" style={{ maxHeight: 200, overflow: 'auto' }}>
                  {resolved.map((k) => (
                    <div key={k}>{k}</div>
                  ))}
                </div>
              </details>
            )}
          </>
        ) : (
          !error && <p className="t-muted">Estimating</p>
        )}
        {error && <p className="err">{error}</p>}
      </aside>
    </div>
  );
}
