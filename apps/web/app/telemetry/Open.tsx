'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SessionDetail } from '@f1archive/shared';
import { load } from '@/lib/client';
import { to } from '@/lib/routes';
import { teamColour } from '@/lib/time';
import { SessionSelect, type Chosen } from '@/components/SessionSelect';

export function Open() {
  const router = useRouter();
  const [c, setC] = useState<Chosen | null>(null);
  const [d, setD] = useState<SessionDetail | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => {
    setD(null);
    setSel([]);
    if (c)
      load<SessionDetail>(`/api/v1/sessions/${c.year}/${c.event.slug}/${c.session.slug}`).then((x) => {
        setD(x);
        setSel(x.drivers.filter((r) => r.telemetry === 'present').slice(0, 2).map((r) => r.number));
      });
  }, [c]);
  return (
    <div className="stack">
      <SessionSelect onChange={setC} telemetryOnly />
      {d && (
        <>
          <div className="row" style={{ gap: 4 }}>
            {d.drivers.map((r) => (
              <button
                key={r.number}
                className="tog"
                aria-pressed={sel.includes(r.number)}
                onClick={() => setSel((s) => (s.includes(r.number) ? s.filter((x) => x !== r.number) : s.length < 6 ? [...s, r.number] : s))}
              >
                <span className="drv">
                  <i style={{ background: teamColour(r.team_colour) }} />
                  {r.abbreviation ?? r.number}
                </span>
                {r.telemetry !== 'present' && <span className="t-muted">no data</span>}
              </button>
            ))}
          </div>
          <div>
            <button className="btn primary" onClick={() => c && router.push(to.replay(c.year, c.event.slug, c.session.slug, sel))}>
              Open replay{sel.length ? ` with ${sel.length} driver${sel.length > 1 ? 's' : ''}` : ''}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
