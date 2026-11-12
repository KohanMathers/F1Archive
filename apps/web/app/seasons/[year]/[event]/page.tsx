import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { DERIVED_DATA_NOTES, FEEDS, type EventSummary, type FeedKey, type FeedState } from '@f1archive/shared';
import { find } from '@/lib/server';
import { to } from '@/lib/routes';
import { day, sessionStart } from '@/lib/time';
import { Driver, Gap, Title } from '@/components/marks';

interface Ev extends EventSummary {
  feeds: { feed: FeedKey; state: FeedState; rows: number | null }[];
  standings_after: { position: number; driver_id: string; abbreviation: string; name: string; points: number }[];
  podium: { position: number; abbreviation: string; driver_id: string; team_name: string; full_name: string; team_colour: string }[];
}

type P = { params: Promise<{ year: string; event: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { year, event } = await params;
  const e = await find<Ev>(`/events/${year}/${event}`);
  return { title: e ? `${year} ${e.name}` : 'Event' };
}

export default async function EventPage({ params }: P) {
  const { year, event } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const e = await find<Ev>(`/events/${year}/${event}`);
  if (!e) notFound();
  const y = Number(year);
  const place = [...new Set([e.circuit, e.location, e.country].filter(Boolean))].join(', ');
  const copied = y === 2018 && e.round === 1 ? DERIVED_DATA_NOTES.circuitCopied2018Australia : y === 2024 && e.round >= 1 && e.round <= 9 ? DERIVED_DATA_NOTES.circuitCopied2024 : null;
  const eventFeeds = e.feeds.filter((f) => f.feed !== 'event_info');

  return (
    <div className="wrap page">
      <Title
        crumbs={[{ href: '/seasons', label: 'Seasons' }, { href: to.season(y), label: year }, { label: e.name }]}
        sub={
          <>
            {e.is_testing ? 'Pre-season testing' : `Round ${e.round}`},{' '}
            {e.circuit_key != null ? (
              <Link className="link" href={to.circuit(e.circuit_key)}>
                {place}
              </Link>
            ) : (
              place
            )}
            , {day(e.start_utc)} to {day(e.end_utc)}.{e.official_name ? ` Officially the ${e.official_name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}.` : ''}
          </>
        }
      >
        {year} {e.name}
      </Title>

      <div className="cols">
        <section>
          <h2>Sessions</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Session</th>
                <th>Start</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {e.sessions.map((s) => (
                <tr key={s.key}>
                  <td>{s.status === 'archived' ? <Link href={to.session(s.year, s.event, s.slug)}>{s.name}</Link> : s.name}</td>
                  <td className="t-muted">{sessionStart(s.start_local, s.start_utc)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {s.status === 'archived' ? (
                      s.has_telemetry ? (
                        <Link className="link" href={to.replay(s.year, s.event, s.slug)}>
                          Replay
                        </Link>
                      ) : (
                        <span className="t-muted">no telemetry</span>
                      )
                    ) : (
                      <Gap state={s.status === 'upcoming' ? 'upcoming' : 'missing'} at={{ year: y, event, session: s.slug, feed: 'session_info' }} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {e.podium.length > 0 && (
            <>
              <h2 style={{ marginTop: 32 }}>Race result, top three</h2>
              <table className="tbl">
                <tbody>
                  {e.podium.map((p) => (
                    <tr key={p.position}>
                      <td className="pos mono-sm">{p.position}</td>
                      <td>
                        <Driver code={p.abbreviation} colour={p.team_colour} />
                      </td>
                      <td>{p.driver_id ? <Link href={to.driver(p.driver_id)}>{p.full_name}</Link> : p.full_name}</td>
                      <td className="t-muted">{p.team_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <aside>
          <h2>Circuit and standings data</h2>
          <table className="tbl dense">
            <tbody>
              {eventFeeds.map((f) => (
                <tr key={f.feed}>
                  <td>{FEEDS[f.feed]?.label ?? f.feed}</td>
                  <td className="n">{f.state === 'present' ? f.rows : <Gap at={{ year: y, event, feed: f.feed }} state={f.state} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {copied && <p className="note t-small">{copied}</p>}

          {e.standings_after.length > 0 && (
            <>
              <h2 style={{ marginTop: 24 }}>Championship after this event</h2>
              <table className="tbl dense">
                <tbody>
                  {e.standings_after.map((d) => (
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
        </aside>
      </div>
    </div>
  );
}
