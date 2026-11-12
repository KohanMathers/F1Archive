import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { find } from '@/lib/server';
import { to } from '@/lib/routes';
import { day } from '@/lib/time';
import { Title } from '@/components/marks';

interface C {
  circuit_key: number;
  name: string;
  location: string | null;
  country: string | null;
  events: { year: number; slug: string; name: string; start_utc: string | null; winner: { abbreviation: string; driver_id: string; team_name: string } | null }[];
}

type P = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { key } = await params;
  const c = /^\d+$/.test(key) ? await find<C>(`/circuits/${key}`) : null;
  return { title: c?.name ?? 'Circuit' };
}

export default async function Circuit({ params }: P) {
  const { key } = await params;
  if (!/^\d+$/.test(key)) notFound();
  const c = await find<C>(`/circuits/${key}`);
  if (!c) notFound();
  return (
    <div className="wrap page">
      <Title
        crumbs={[{ href: '/seasons', label: 'Seasons' }, { label: c.name }]}
        sub={`${[c.location, c.country].filter(Boolean).join(', ')}. ${c.events.length} events in the archive, grouped by F1’s circuit key rather than the event name.`}
      >
        {c.name}
      </Title>
      <table className="tbl">
        <thead>
          <tr>
            <th>Season</th>
            <th>Event</th>
            <th>Date</th>
            <th>Race winner</th>
          </tr>
        </thead>
        <tbody>
          {c.events.map((e) => (
            <tr key={`${e.year}${e.slug}`}>
              <td className="mono-sm">{e.year}</td>
              <td>
                <Link href={to.event(e.year, e.slug)}>{e.name}</Link>
              </td>
              <td className="mono-sm t-muted">{day(e.start_utc)}</td>
              <td>
                {e.winner ? (
                  <>
                    <Link href={to.driver(e.winner.driver_id)}>{e.winner.abbreviation}</Link> <span className="t-muted">{e.winner.team_name}</span>
                  </>
                ) : (
                  <span className="t-muted">no race result</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
