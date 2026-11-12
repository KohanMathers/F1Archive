import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { find } from '@/lib/server';
import { to } from '@/lib/routes';
import { teamColour } from '@/lib/time';
import { Title } from '@/components/marks';

interface T {
  constructor_id: string;
  name: string;
  nationality: string | null;
  latest_colour: string | null;
  summary: { seasons: number; races: number; wins: number; podiums: number; championships: number };
  seasons: {
    year: number;
    names: string[];
    colour: string | null;
    championship_position: number | null;
    championship_points: number | null;
    wins: number;
    podiums: number;
    races: number;
    in_progress: boolean;
    drivers: { driver_id: string | null; full_name: string | null; abbreviation: string | null; races: number; points: number; wins: number; best: number | null }[];
  }[];
}

type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const t = /^[a-z0-9_]+$/.test(id) ? await find<T>(`/teams/${id}`) : null;
  return { title: t?.name ?? 'Team' };
}

export default async function TeamPage({ params }: P) {
  const { id } = await params;
  if (!/^[a-z0-9_]+$/.test(id)) notFound();
  const t = await find<T>(`/teams/${id}`);
  if (!t) notFound();
  const s = t.summary;
  return (
    <div className="wrap page">
      <Title crumbs={[{ href: '/teams', label: 'Teams' }, { label: t.name }]} sub={t.nationality ? `${t.nationality} constructor.` : undefined}>
        <span className="row" style={{ gap: 12 }}>
          <span style={{ width: 4, height: 28, background: teamColour(t.latest_colour) }} aria-hidden />
          {t.name}
        </span>
      </Title>
      <p>
        {s.races} Grands Prix over {s.seasons} season{s.seasons === 1 ? '' : 's'} in the archive, with {s.wins} wins, {s.podiums} podium finishes
        {s.championships ? ` and ${s.championships} constructors’ title${s.championships > 1 ? 's' : ''}` : ''}. Sprints are not counted, and the archive starts in
        2018.
      </p>
      <table className="tbl" style={{ marginTop: 24 }}>
        <thead>
          <tr>
            <th>Season</th>
            <th>Entered as</th>
            <th className="n">Championship</th>
            <th className="n">Points</th>
            <th className="n">Races</th>
            <th className="n">Wins</th>
            <th className="n">Podiums</th>
            <th>Drivers</th>
          </tr>
        </thead>
        <tbody>
          {t.seasons.map((y) => (
            <tr key={y.year}>
              <td>
                <Link href={to.season(y.year)} style={{ fontWeight: 600 }}>
                  {y.year}
                </Link>
                {y.in_progress && <div className="t-small t-muted">in progress</div>}
              </td>
              <td>
                <span className="drv" style={{ fontFamily: 'var(--sans)', fontWeight: 400, fontSize: 14 }}>
                  <i style={{ background: teamColour(y.colour) }} />
                  {y.names.join(', ')}
                </span>
              </td>
              <td className="n">
                {y.championship_position ?? ''}
              </td>
              <td className="n">{y.championship_points ?? ''}</td>
              <td className="n">{y.races}</td>
              <td className="n">{y.wins || ''}</td>
              <td className="n">{y.podiums || ''}</td>
              <td className="wrap-cell" style={{ minWidth: 220 }}>
                {y.drivers.map((d, i) => (
                  <span key={d.driver_id ?? d.full_name ?? i}>
                    {i > 0 && ', '}
                    {d.driver_id ? <Link href={to.driver(d.driver_id)}>{d.full_name ?? d.abbreviation}</Link> : d.full_name}
                    <span className="t-muted t-small">
                      {' '}
                      ({d.races} races, {d.points} pts)
                    </span>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
