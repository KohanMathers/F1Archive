import Link from 'next/link';
import type { Metadata } from 'next';
import type { SearchResult } from '@f1archive/shared';
import { get } from '@/lib/server';
import { Title } from '@/components/marks';

export const metadata: Metadata = { title: 'Search' };

const KIND: Record<SearchResult['type'], string> = {
  driver: 'driver',
  event: 'Grand Prix',
  session: 'session',
  circuit: 'circuit',
  season: 'season',
  constructor: 'team',
};

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const results = q ? await get<SearchResult[]>(`/search?q=${encodeURIComponent(q)}&limit=50`).catch(() => null) : [];
  return (
    <div className="wrap page" style={{ maxWidth: 880 }}>
      <Title>Search</Title>
      <form action="/search" role="search" className="row" style={{ marginBottom: 24 }}>
        <input name="q" type="search" aria-label="Search" defaultValue={q} placeholder="Driver, Grand Prix, circuit, team or year" style={{ flex: 1 }} autoFocus />
        <button className="btn primary" type="submit">
          Search
        </button>
      </form>
      {results === null && <p className="err">Search is not responding.</p>}
      {q && results && results.length === 0 && <p className="t-muted">No matches for “{q}”.</p>}
      {results && results.length > 0 && (
        <table className="tbl">
          <tbody>
            {results.map((r) => (
              <tr key={`${r.type}${r.href}`}>
                <td>
                  <Link href={r.href} style={{ fontWeight: 500 }}>
                    {r.title}
                  </Link>
                  {r.subtitle && <div className="t-small t-muted">{r.subtitle}</div>}
                </td>
                <td className="t-muted t-small" style={{ textAlign: 'right' }}>
                  {KIND[r.type]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
