import Link from 'next/link';
import type { ArchiveStats, CalendarRound, SeasonSummary, SessionDetail, SessionSummary } from '@f1archive/shared';
import { SeasonCalendar } from '@/components/SeasonCalendar';
import { SearchInput } from '@/components/SearchField';
import { find, get } from '@/lib/server';
import { to } from '@/lib/routes';
import { dayShort } from '@/lib/time';

const CONTENTS: { href: string; name: string; line: string }[] = [
  { href: '/seasons', name: 'Seasons', line: 'Every Grand Prix weekend since 2018, with results, laps, tyres, weather, race control and team radio for each session.' },
  { href: '/telemetry', name: 'Replay', line: 'A session played back on the circuit map, with telemetry traces, live gaps, race control and radio on one timeline.' },
  { href: '/compare', name: 'Compare laps', line: 'Up to four laps from any session or season, aligned by distance, with the time gained or lost along the lap.' },
  { href: '/drivers', name: 'Drivers', line: 'Every driver who started a race in the archive and every session they took part in.' },
  { href: '/teams', name: 'Teams', line: 'Each constructor by season, with the names it entered under, its drivers and its results.' },
  { href: '/research', name: 'Data', line: 'Download any selection as CSV, Parquet, SQLite or JSON, browse the tables, or use the API.' },
];

const MOMENTS = [
  { y: 2021, e: 'abu-dhabi', s: 'race', d: ['33', '44'], t: 9070e9 as number | undefined, name: '2021 Abu Dhabi Grand Prix', line: 'The championship was settled on the last lap after a late Safety Car restart.' },
  { y: 2021, e: 'british', s: 'race', d: ['33', '44'], t: undefined, name: '2021 British Grand Prix', line: 'Verstappen and Hamilton collided at Copse on lap 1; the race was red-flagged.' },
  { y: 2023, e: 'singapore', s: 'race', d: ['55', '4'], t: undefined, name: '2023 Singapore Grand Prix', line: "Sainz kept Norris within DRS range to the flag and ended Red Bull's run of wins." },
  { y: 2024, e: 'sao-paulo', s: 'race', d: ['1', '31'], t: undefined, name: '2024 São Paulo Grand Prix', line: 'Verstappen won in the wet from 17th on the grid.' },
];

type Recent = SessionSummary & { event_name: string };

export default async function Home() {
  const [stats, seasons, recent] = await Promise.all([
    find<ArchiveStats>('/stats', 60),
    get<(SeasonSummary & { in_progress: boolean })[]>('/seasons'),
    get<Recent[]>('/recent?limit=10', 120),
  ]);
  const moments = (await Promise.all(MOMENTS.map((m) => find<SessionDetail>(`/sessions/${m.y}/${m.e}/${m.s}`).then((d) => (d ? m : null))))).filter(
    (m): m is (typeof MOMENTS)[number] => !!m,
  );
  const first = seasons.at(-1)?.year;
  const last = seasons[0]?.year;
  const calendar = last ? await find<CalendarRound[]>(`/seasons/${last}/calendar`, 300) : null;
  const latest = seasons[0];

  return (
    <div className="wrap page home">
      <header style={{ maxWidth: '80ch', marginBottom: 32 }}>
        <h1>F1Archive</h1>
        <p className="intro" style={{ marginTop: 8 }}>
          An independent archive of Formula 1 timing, telemetry, team radio and race control data
          {first && last ? `, from ${first} to the latest race of ${last}` : ''}. Every session can be looked up, replayed and downloaded.
        </p>
        <form action="/search" role="search" className="row" style={{ marginTop: 16, maxWidth: 640, flexWrap: 'nowrap' }}>
          <SearchInput name="q" aria-label="Search the archive" placeholder="Search for a driver, Grand Prix, circuit, team or year" style={{ height: 40 }} />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </header>

      {calendar && calendar.length > 0 && last && (
        <section aria-labelledby="calendar" style={{ marginBottom: 48 }}>
          <div className="sect-head">
            <h2 id="calendar">
              The {last} season{latest?.in_progress ? ' so far' : ''}
            </h2>
            <Link className="link" href={to.season(last)}>
              Standings and every session
            </Link>
          </div>
          <SeasonCalendar year={last} rounds={calendar} now={Date.now()} />
        </section>
      )}

      <div className="cols">
        <div>
          <section aria-labelledby="contents">
            <h2 id="contents">In the archive</h2>
            <dl className="contents">
              {CONTENTS.map((c) => (
                <div key={c.href}>
                  <dt>
                    <Link href={c.href}>{c.name}</Link>
                  </dt>
                  <dd>{c.line}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="sect" aria-labelledby="seasons">
            <h2 id="seasons">Seasons</h2>
            <div className="years">
              {seasons.map((s) => (
                <Link key={s.year} href={to.season(s.year)} title={`${s.events} events, ${s.sessions_archived} sessions archived`}>
                  {s.year}
                </Link>
              ))}
            </div>
          </section>

          {moments.length > 0 && (
            <section className="sect" aria-labelledby="moments">
              <h2 id="moments">Races worth replaying</h2>
              <ul className="list moments">
                {moments.map((m) => (
                  <li key={m.name} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 16 }}>
                    <div style={{ minWidth: 0 }}>
                      <Link className="name" href={to.session(m.y, m.e, m.s)}>
                        {m.name}
                      </Link>
                      <div className="t-muted">{m.line}</div>
                    </div>
                    <Link className="link nowrap" href={to.replay(m.y, m.e, m.s, m.d, m.t)} style={{ whiteSpace: 'nowrap' }}>
                      Replay
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside aria-labelledby="recent">
          <h2 id="recent">Recently archived</h2>
          <table className="tbl dense">
            <tbody>
              {recent.map((s) => (
                <tr key={s.key}>
                  <td className="mono-sm t-muted" style={{ width: '7ch' }}>
                    {dayShort(s.start_utc)}
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>
                    <Link href={to.session(s.year, s.event, s.slug)}>
                      {s.event_name.replace(/ Grand Prix$/, ' GP')}, {s.name}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats && (
            <p className="t-small t-muted" style={{ marginTop: 16 }}>
              {stats.sessions_archived.toLocaleString('en-GB')} of {stats.sessions.toLocaleString('en-GB')} scheduled sessions are archived, with{' '}
              {stats.team_radio_messages.toLocaleString('en-GB')} team radio messages and {stats.race_control_messages.toLocaleString('en-GB')} race control
              messages. Where something is missing, the page says so and{' '}
              <Link className="link" href="/docs/gaps">
                explains why
              </Link>
              .
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
