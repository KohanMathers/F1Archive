import Link from 'next/link';
import type { Metadata } from 'next';
import { get } from '@/lib/server';
import { to } from '@/lib/routes';
import { Driver, Title } from '@/components/marks';

export const metadata: Metadata = { title: 'Drivers', description: 'Every driver who started a Grand Prix in the archive.' };

interface Row {
  driver_id: string;
  given_name: string | null;
  family_name: string | null;
  nationality: string | null;
  first_year: number;
  last_year: number;
  races: number;
  wins: number;
  abbreviation: string;
  team_colour: string | null;
  team_name: string | null;
}

export default async function Drivers() {
  const rows = await get<Row[]>('/drivers');
  const latest = Math.max(...rows.map((r) => r.last_year));
  const groups: [string, Row[]][] = [
    [`Raced in ${latest}`, rows.filter((r) => r.last_year === latest)],
    ['Earlier', rows.filter((r) => r.last_year !== latest)],
  ];
  return (
    <div className="wrap page">
      <Title sub="Drivers who started at least one Grand Prix since 2018. Reserve drivers who only ran in practice appear on their session pages.">Drivers</Title>
      {groups.map(([label, list]) => (
        <section key={label} className="sect" style={{ marginTop: 24 }}>
          <h2>{label}</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>Last team</th>
                <th>Nationality</th>
                <th className="n">Seasons</th>
                <th className="n">Races</th>
                <th className="n">Wins</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.driver_id}>
                  <td style={{ width: '7ch' }}>
                    <Driver code={r.abbreviation} colour={r.team_colour} />
                  </td>
                  <td>
                    <Link href={to.driver(r.driver_id)}>{[r.given_name, r.family_name].filter(Boolean).join(' ') || r.driver_id}</Link>
                  </td>
                  <td className="t-muted">{r.team_name}</td>
                  <td className="t-muted">{r.nationality}</td>
                  <td className="n">{r.first_year === r.last_year ? r.first_year : `${r.first_year}–${r.last_year}`}</td>
                  <td className="n">{r.races}</td>
                  <td className="n">{r.wins || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
