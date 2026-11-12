import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { EventSummary } from '@f1archive/shared';
import { find } from '@/lib/server';
import { to } from '@/lib/routes';
import { dayShort, teamColour } from '@/lib/time';
import { Title } from '@/components/marks';

interface Season {
  year: number;
  events: EventSummary[];
  teams: { key: string; short_name: string; colour_official: string | null }[];
  standings: {
    round: number;
    drivers: { position: number; driver_id: string; abbreviation: string; name: string; points: number; wins: number }[] | null;
    constructors: { position: number; constructor_id: string; name: string; points: number; wins: number }[] | null;
  } | null;
}

type P = { params: Promise<{ year: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { year } = await params;
  return { title: `${year} season` };
}

export default async function SeasonPage({ params }: P) {
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const s = await find<Season>(`/seasons/${year}`);
  if (!s) notFound();
  const gps = s.events.filter((e) => !e.is_testing);
  const lastRound = Math.max(0, ...gps.map((e) => e.round));
  const final = s.standings?.round === lastRound;

  return (
    <div className="wrap page">
      <Title
        crumbs={[{ href: '/seasons', label: 'Seasons' }, { label: year }]}
        sub={`${gps.length} Grands Prix${s.events.length > gps.length ? ` and ${s.events.length - gps.length} pre-season test${s.events.length - gps.length > 1 ? 's' : ''}` : ''}. Sessions with telemetry are marked with a square.`}
      >
        {year} season
      </Title>
      <div className="cols">
        <ol className="list">
          {s.events.map((e) => (
            <li key={e.key} style={{ display: 'grid', gridTemplateColumns: '4ch minmax(0, 1fr) auto', gap: 12 }}>
              <span className="mono-sm t-muted" style={{ lineHeight: '24px' }}>
                {e.is_testing ? 'T' : String(e.round).padStart(2, '0')}
              </span>
              <div style={{ minWidth: 0 }}>
                <Link href={to.event(e.year, e.slug)} style={{ fontWeight: 600, lineHeight: '24px' }}>
                  {e.name}
                </Link>
                <span className="t-muted"> {[...new Set([e.circuit, e.location, e.country].filter(Boolean))].join(', ')}</span>
                <div className="sessions">
                  {e.sessions.map((x) =>
                    x.status === 'archived' ? (
                      <Link key={x.key} href={to.session(x.year, x.event, x.slug)} className={x.has_telemetry ? 'tel' : undefined}>
                        {x.name}
                      </Link>
                    ) : (
                      <span key={x.key} className="off" title={x.status === 'upcoming' ? 'Not run yet' : 'Not in the archive'}>
                        {x.name} ({x.status === 'upcoming' ? 'upcoming' : 'missing'})
                      </span>
                    ),
                  )}
                </div>
              </div>
              <span className="mono-sm t-muted" style={{ lineHeight: '24px' }}>
                {dayShort(e.start_utc)}–{dayShort(e.end_utc)}
              </span>
            </li>
          ))}
        </ol>

        <aside>
          {s.standings?.drivers && (
            <>
              <h2>{final ? 'Drivers’ championship' : `Drivers after round ${s.standings.round}`}</h2>
              <table className="tbl dense">
                <tbody>
                  {s.standings.drivers.map((d) => (
                    <tr key={d.driver_id}>
                      <td className="pos mono-sm">{d.position}</td>
                      <td>
                        <Link href={to.driver(d.driver_id)}>{d.name || d.abbreviation}</Link>
                      </td>
                      <td className="n">{d.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {s.standings?.constructors && (
            <>
              <h2 style={{ marginTop: 24 }}>{final ? 'Constructors’ championship' : 'Constructors'}</h2>
              <table className="tbl dense">
                <tbody>
                  {s.standings.constructors.map((c) => {
                    const team = s.teams.find((t) => t.short_name.toLowerCase() === c.name.toLowerCase());
                    return (
                      <tr key={c.constructor_id}>
                        <td className="pos mono-sm">{c.position}</td>
                        <td>
                          <span className="drv" style={{ fontFamily: 'var(--sans)', fontWeight: 400, fontSize: 14 }}>
                            <i style={{ background: teamColour(team?.colour_official) }} />
                            <Link href={to.team(c.constructor_id)}>{c.name}</Link>
                          </span>
                        </td>
                        <td className="n">{c.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
