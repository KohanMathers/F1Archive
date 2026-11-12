'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ExportCategory } from '@f1archive/shared';
import { SessionSelect, type Chosen } from '@/components/SessionSelect';
import { to } from '@/lib/routes';

const TABLES: [ExportCategory, string][] = [
  ['results', 'Results'],
  ['laps', 'Laps'],
  ['stints', 'Tyre stints'],
  ['pit_stops', 'Pit stops'],
  ['weather', 'Weather'],
  ['race_control', 'Race control'],
  ['team_radio', 'Team radio'],
  ['track_status', 'Track status'],
  ['drivers', 'Drivers'],
  ['sessions', 'Session'],
  ['telemetry', 'Telemetry'],
];

interface Page {
  columns: { name: string; type: string; unit: string | null; description: string; derived: boolean }[];
  data: Record<string, unknown>[];
  page: { limit: number; offset: number; total: number | null; next_offset: number | null };
}

export function Tables() {
  const [c, setC] = useState<Chosen | null>(null);
  const [table, setTable] = useState<ExportCategory>('laps');
  const [drivers, setDrivers] = useState('');
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = c?.session.key ?? null;

  useEffect(() => setOffset(0), [key, table, drivers, limit]);
  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    setBusy(true);
    setErr(null);
    const q = new URLSearchParams({ sessions: key, limit: String(limit), offset: String(offset) });
    if (drivers.trim()) q.set('drivers', drivers.replace(/\s+/g, ''));
    fetch(`/api/v1/data/${table}?${q}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error?.message ?? r.statusText);
        setPage(j);
      })
      .catch((e) => e.name !== 'AbortError' && setErr(e.message))
      .finally(() => setBusy(false));
    return () => ctl.abort();
  }, [key, table, drivers, offset, limit]);

  return (
    <div className="stack">
      <SessionSelect onChange={setC} />
      <div className="row" style={{ gap: 4 }} role="group" aria-label="Table">
        {TABLES.map(([k, label]) => (
          <button key={k} className="tog" aria-pressed={table === k} onClick={() => setTable(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="f">
          Drivers
          <input type="text" value={drivers} placeholder="VER, 44" onChange={(e) => setDrivers(e.target.value)} />
        </label>
        <label className="f">
          Rows per page
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[50, 100, 500, 1000].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        {key && (
          <a className="btn" href={`/research?sessions=${key}`}>
            Export this session
          </a>
        )}
      </div>

      {!key && <p className="t-muted">Choose a session.</p>}
      {err && <p className="err">{err}</p>}
      {key && page && (
        <>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="t-muted t-small">
              Rows {(page.page.offset + 1).toLocaleString('en-GB')} to {(page.page.offset + page.data.length).toLocaleString('en-GB')}
              {page.page.total != null ? ` of ${page.page.total.toLocaleString('en-GB')}` : ''}
              {busy ? ', loading' : ''}
            </span>
            <span className="row" style={{ gap: 4 }}>
              <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                Previous page
              </button>
              <button className="btn sm" disabled={page.page.next_offset == null} onClick={() => setOffset(page.page.next_offset!)}>
                Next page
              </button>
            </span>
          </div>
          {page.data.length === 0 ? (
            <p className="t-muted">
              No rows.{' '}
              <Link className="link" href={`${to.session(c!.year, c!.event.slug, c!.session.slug)}?tab=data`}>
                See what this session has
              </Link>
              .
            </p>
          ) : (
            <div className="tbl-wrap" style={{ maxHeight: '70vh' }}>
              <table className="tbl dense">
                <thead>
                  <tr>
                    {page.columns.map((col) => (
                      <th key={col.name} className={col.type === 'integer' || col.type === 'real' ? 'n' : undefined} title={`${col.description}${col.unit ? ` Unit: ${col.unit}.` : ''}${col.derived ? ' Derived by F1Archive.' : ''}`}>
                        {col.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.data.map((r, i) => (
                    <tr key={i}>
                      {page.columns.map((col) => {
                        const v = r[col.name];
                        return (
                          <td key={col.name} className={col.type === 'integer' || col.type === 'real' ? 'n' : undefined}>
                            {v == null ? <span className="t-muted">null</span> : String(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="t-small t-muted">
            <code>null</code> means the source has no value; it is never written as zero. Columns ending in <code>_ns</code> are nanoseconds.
          </p>
        </>
      )}
    </div>
  );
}
