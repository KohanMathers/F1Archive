import Link from 'next/link';
import type { Metadata } from 'next';
import { get } from '@/lib/server';
import { to } from '@/lib/routes';
import { teamColour } from '@/lib/time';
import { Title } from '@/components/marks';

export const metadata: Metadata = { title: 'Teams', description: 'Every constructor in the archive and the names it raced under.' };

interface T {
  constructor_id: string;
  name: string;
  nationality: string | null;
  seasons: number[];
  latest_colour: string | null;
  names: string[];
}

export default async function Teams() {
  const teams = await get<T[]>('/teams');
  const latest = Math.max(...teams.flatMap((t) => t.seasons));
  return (
    <div className="wrap page">
      <Title sub="Constructors as identified by Jolpica. A rebrand that Jolpica treats as a new constructor, such as Toro Rosso to AlphaTauri to RB, is listed separately.">Teams</Title>
      {[true, false].map((cur) => (
        <section key={String(cur)} className="sect" style={{ marginTop: 24 }}>
          <h2>{cur ? `${latest} grid` : 'Earlier teams'}</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Constructor</th>
                <th>Entered as</th>
                <th>Nationality</th>
                <th className="n">Seasons</th>
              </tr>
            </thead>
            <tbody>
              {teams
                .filter((t) => t.seasons.includes(latest) === cur)
                .map((t) => (
                  <tr key={t.constructor_id}>
                    <td>
                      <span className="drv" style={{ fontFamily: 'var(--sans)', fontWeight: 500, fontSize: 14 }}>
                        <i style={{ background: teamColour(t.latest_colour) }} />
                        <Link href={to.team(t.constructor_id)}>{t.name}</Link>
                      </span>
                    </td>
                    <td className="t-muted wrap-cell">{t.names.join(', ')}</td>
                    <td className="t-muted">{t.nationality}</td>
                    <td className="n">{t.seasons[0] === t.seasons.at(-1) ? t.seasons[0] : `${t.seasons[0]}–${t.seasons.at(-1)}`}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
