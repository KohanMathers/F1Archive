import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { find } from '@/lib/server';
import { to } from '@/lib/routes';
import { day, teamColour } from '@/lib/time';
import { Title } from '@/components/marks';

interface D {
  driver_id: string;
  reference: { given_name: string; family_name: string; date_of_birth: string | null; nationality: string | null; permanent_number: string | null } | null;
  latest: { full_name: string; team_name: string; team_colour: string; abbreviation: string; number: string } | null;
  summary: { races: number; wins: number; podiums: number; points: number; seasons: number[] };
  sessions: {
    year: number;
    event: string;
    event_name: string;
    slug: string;
    name: string;
    kind: string;
    driver_number: string;
    team_name: string;
    team_colour: string;
    constructor_id: string | null;
    position: number | null;
    position_text: string | null;
    grid_position: number | null;
    points: number | null;
    status: string | null;
    has_telemetry: boolean;
  }[];
}

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const d = /^[a-z0-9_]+$/.test(id) ? await find<D>(`/drivers/${id}`) : null;
  return { title: d?.reference ? `${d.reference.given_name} ${d.reference.family_name}` : 'Driver' };
}

export default async function DriverPage({ params }: P) {
  const { id } = await params;
  if (!/^[a-z0-9_]+$/.test(id)) notFound();
  const d = await find<D>(`/drivers/${id}`);
  if (!d) notFound();
  const name = d.reference ? `${d.reference.given_name} ${d.reference.family_name}` : (d.latest?.full_name ?? id);
  const starts = d.sessions.filter((s) => s.kind === 'race' || s.kind === 'sprint');
  const years = [...new Set(starts.map((s) => s.year))];
  const facts = [
    d.reference?.nationality,
    d.reference?.date_of_birth ? `born ${day(d.reference.date_of_birth)}` : null,
    d.reference?.permanent_number ? `car ${d.reference.permanent_number}` : null,
  ].filter(Boolean);

  return (
    <div className="wrap page">
      <Title crumbs={[{ href: '/drivers', label: 'Drivers' }, { label: name }]} sub={facts.length ? `${facts.join(', ')}.` : undefined}>
        <span className="row" style={{ gap: 12 }}>
          <span style={{ width: 4, height: 28, background: teamColour(d.latest?.team_colour) }} aria-hidden />
          {name}
        </span>
      </Title>
      <p>
        {d.summary.races} Grand Prix starts in the archive ({d.summary.seasons[d.summary.seasons.length - 1]}–{d.summary.seasons[0]}), {d.summary.wins} wins,{' '}
        {d.summary.podiums} podium finishes and {d.summary.points} points. These cover 2018 onwards only, not a whole career.
      </p>
      {years.map((y) => (
        <section key={y} className="sect" style={{ marginTop: 32 }}>
          <h2>{y}</h2>
          <table className="tbl dense">
            <thead>
              <tr>
                <th>Event</th>
                <th>Session</th>
                <th>Team</th>
                <th className="n">Grid</th>
                <th className="n">Result</th>
                <th className="n">Points</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {starts
                .filter((s) => s.year === y)
                .map((s) => (
                  <tr key={`${s.event}${s.slug}`}>
                    <td>
                      <Link href={to.session(s.year, s.event, s.slug)}>{s.event_name}</Link>
                    </td>
                    <td className="t-muted">{s.name}</td>
                    <td>
                      <span className="drv" style={{ fontFamily: 'var(--sans)', fontWeight: 400, fontSize: 14 }}>
                        <i style={{ background: teamColour(s.team_colour) }} />
                        {s.constructor_id ? <Link href={to.team(s.constructor_id)}>{s.team_name}</Link> : s.team_name}
                      </span>
                    </td>
                    <td className="n">{s.grid_position ?? ''}</td>
                    <td className="n">{s.position_text ?? s.position ?? ''}</td>
                    <td className="n">{s.points || ''}</td>
                    <td>
                      {s.has_telemetry && (
                        <Link className="link t-small" href={to.replay(s.year, s.event, s.slug, [s.driver_number])}>
                          Replay
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
