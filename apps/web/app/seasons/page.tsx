import Link from 'next/link';
import type { Metadata } from 'next';
import type { SeasonSummary } from '@f1archive/shared';
import { get } from '@/lib/server';
import { to } from '@/lib/routes';
import { Title } from '@/components/marks';

export const metadata: Metadata = { title: 'Seasons', description: 'Every Formula 1 season in the archive, with how much of each is archived.' };

type Season = SeasonSummary & { in_progress: boolean };

export default async function Seasons() {
  const seasons = await get<Season[]>('/seasons');
  return (
    <div className="wrap page">
      <Title sub="Archived is the share of sessions that have taken place and are in the archive. Every gap is explained on its session page.">Seasons</Title>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Season</th>
              <th className="n">Events</th>
              <th className="n">Sessions</th>
              <th className="n">Archived</th>
              <th>Drivers’ champion</th>
              <th>Constructors’ champion</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.year}>
                <td>
                  <Link href={to.season(s.year)} style={{ fontWeight: 600 }}>
                    {s.year}
                  </Link>
                  {s.in_progress && <span className="t-muted t-small"> in progress</span>}
                </td>
                <td className="n">{s.events}</td>
                <td className="n">
                  {s.sessions_archived}/{s.sessions}
                </td>
                <td className="n">{s.completeness == null ? '' : `${(Math.floor(s.completeness * 1000) / 10).toFixed(1)}%`}</td>
                <td>
                  {s.champion_driver ? (
                    <>
                      <Link href={to.driver(s.champion_driver.driver_id)}>{s.champion_driver.name}</Link>
                      <span className="t-muted">
                        {' '}
                        {s.in_progress ? 'leads with' : 'with'} {s.champion_driver.points} pts
                      </span>
                    </>
                  ) : (
                    <span className="t-muted">no standings</span>
                  )}
                </td>
                <td>
                  {s.champion_constructor ? (
                    <>
                      <Link href={to.team(s.champion_constructor.constructor_id)}>{s.champion_constructor.name}</Link>
                      {s.in_progress && <span className="t-muted"> leading</span>}
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
